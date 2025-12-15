/**
 * Reference Map Points Deduplication Service
 *
 * Two-tier deduplication:
 * 1. GPS-based cleanup within ref_map_points (~10m = 4 decimal places)
 * 2. Cross-table matching against catalogued locations (locs table)
 *
 * Migration 39: Adds aka_names column for storing merged alternate names.
 *
 * For GPS duplicate groups:
 * - Keeps the pin with the best (longest/most descriptive) name
 * - Stores alternate names in aka_names field (pipe-separated)
 * - Deletes the duplicate pins
 *
 * Also provides import-time duplicate checking to prevent future duplicates.
 */

import type { Kysely } from 'kysely';
import type { Database } from '../main/database.types';
import { generateId } from '../main/ipc-validation';
import { normalizedSimilarity, normalizeName } from './jaro-winkler-service';
import {
  calculateNameMatch,
  calculateMultiSignalMatch,
  isGenericName,
  hasBlockingConflict,
  type NameMatchResult,
} from './token-set-service';
import { haversineDistance } from './geo-utils';
import { DUPLICATE_CONFIG } from '../../src/lib/constants';
import { getStateCodeFromName, isValidStateCode } from './us-state-codes';

// Use centralized constants for duplicate detection
const {
  GPS_RADIUS_METERS,
  NAME_MATCH_RADIUS_METERS,
  NAME_SIMILARITY_THRESHOLD,
  GENERIC_NAME_GPS_RADIUS_METERS,
  GPS_MERGE_THRESHOLD_METERS,
  NAME_DEDUP_THRESHOLD,
  NAME_DEDUP_GPS_RADIUS_METERS,
} = DUPLICATE_CONFIG;

/**
 * Normalize a state value to a 2-letter code for comparison.
 * Handles "NY", "New York", "new york", etc.
 */
function normalizeState(state: string | null | undefined): string | null {
  if (!state) return null;
  const trimmed = state.trim().toUpperCase();
  // If it's already a valid 2-letter code, return it
  if (trimmed.length === 2 && isValidStateCode(trimmed)) {
    return trimmed;
  }
  // Try to get code from full name
  return getStateCodeFromName(state) || trimmed;
}

/**
 * Types for import preview and deduplication
 */
export type MatchConfidence = 'gps' | 'name_gps' | 'name_state' | 'exact_name' | 'name_only';

export interface DuplicateMatch {
  type: 'catalogued' | 'reference';
  matchType?: MatchConfidence; // How the match was determined
  newPoint: {
    name: string | null;
    lat: number;
    lng: number;
    state?: string | null; // State from the ref point (for auto-fill)
  };
  existingId: string;
  existingName: string;
  existingState?: string; // State of the existing location
  existingHasGps?: boolean; // Whether the existing location has GPS coordinates
  nameSimilarity?: number;
  distanceMeters?: number;
  mapName?: string;
  needsConfirmation?: boolean; // True for state-based matches that need user review
  /** Token-based match details */
  sharedTokens?: string[];
  /** Confidence tier from multi-signal matching */
  confidenceTier?: 'high' | 'medium' | 'low' | 'none';
  /** Total confidence score (0-100) */
  confidenceScore?: number;
  /** Whether name match was blocked (different place) */
  blocked?: boolean;
  /** Block reason if blocked */
  blockReason?: string;
  /** Whether this is a generic name match */
  isGenericNameMatch?: boolean;
}

export interface DedupeResult {
  totalParsed: number;
  newPoints: Array<{
    name: string | null;
    description: string | null;
    lat: number;
    lng: number;
    state: string | null;
    category: string | null;
    rawMetadata: Record<string, unknown> | null;
  }>;
  cataloguedMatches: DuplicateMatch[];
  referenceMatches: DuplicateMatch[];
}

export interface CataloguedMatch {
  pointId: string;
  pointName: string | null;
  mapName: string;
  matchedLocid: string;
  matchedLocName: string;
  nameSimilarity: number;
  distanceMeters: number;
}

export interface DedupStats {
  totalPoints: number;
  uniqueLocations: number;
  duplicateGroups: number;
  pointsRemoved: number;
  pointsWithAka: number;
}

export interface DuplicateGroup {
  roundedLat: number;
  roundedLng: number;
  points: Array<{
    pointId: string;
    name: string | null;
    mapId: string;
    description: string | null;
  }>;
}

/**
 * Score a name for quality - higher is better
 * Prefers longer, more descriptive names over short/generic ones
 */
function scoreName(name: string | null): number {
  if (!name) return 0;

  let score = name.length;

  // Penalize coordinate-style names (e.g., "44.29951983081727,-75.9590595960617")
  if (/^-?\d+\.\d+,-?\d+\.\d+$/.test(name)) {
    score = 1;
  }

  // Penalize very short names
  if (name.length < 5) {
    score -= 10;
  }

  // Penalize generic names
  const genericPatterns = [
    /^house$/i,
    /^building$/i,
    /^place$/i,
    /^location$/i,
    /^point$/i,
    /^site$/i,
  ];
  for (const pattern of genericPatterns) {
    if (pattern.test(name)) {
      score -= 20;
    }
  }

  // Bonus for names with proper nouns (capitalized words)
  const properNouns = name.match(/[A-Z][a-z]+/g);
  if (properNouns) {
    score += properNouns.length * 5;
  }

  // Bonus for descriptive suffixes
  const descriptiveSuffixes = [
    /factory/i,
    /hospital/i,
    /school/i,
    /church/i,
    /theater/i,
    /theatre/i,
    /mill/i,
    /farm/i,
    /brewery/i,
    /county/i,
    /poorhouse/i,
  ];
  for (const suffix of descriptiveSuffixes) {
    if (suffix.test(name)) {
      score += 10;
    }
  }

  return score;
}

/**
 * Pick the best name from a group of duplicates
 * Returns the name with the highest score
 */
function pickBestName(names: (string | null)[]): string | null {
  const validNames = names.filter((n): n is string => n !== null && n.trim() !== '');
  if (validNames.length === 0) return null;

  let bestName = validNames[0];
  let bestScore = scoreName(bestName);

  for (const name of validNames.slice(1)) {
    const score = scoreName(name);
    if (score > bestScore) {
      bestName = name;
      bestScore = score;
    }
  }

  return bestName;
}

/**
 * Collect alternate names (excluding the primary name)
 */
function collectAkaNames(names: (string | null)[], primaryName: string | null): string | null {
  const validNames = names.filter((n): n is string =>
    n !== null &&
    n.trim() !== '' &&
    n !== primaryName &&
    // Exclude coordinate-style names from AKA
    !/^-?\d+\.\d+,-?\d+\.\d+$/.test(n)
  );

  // Remove duplicates (case-insensitive)
  const uniqueNames = [...new Set(validNames.map(n => n.toLowerCase()))]
    .map(lower => validNames.find(n => n.toLowerCase() === lower)!);

  if (uniqueNames.length === 0) return null;
  return uniqueNames.join(' | ');
}

export class RefMapDedupService {
  constructor(private db: Kysely<Database>) {}

  /**
   * Find all duplicate groups in ref_map_points using Haversine distance.
   * Uses GPS_MERGE_THRESHOLD_METERS (default 50m) for same-building tolerance.
   *
   * Algorithm: Union-Find with distance-based clustering
   * - For each point, find all points within GPS_MERGE_THRESHOLD_METERS
   * - Group them into the same cluster
   * - Much more accurate than simple GPS rounding
   */
  async findDuplicateGroups(): Promise<DuplicateGroup[]> {
    // Get all points
    const points = await this.db
      .selectFrom('ref_map_points')
      .select([
        'point_id',
        'name',
        'map_id',
        'description',
        'lat',
        'lng',
      ])
      .execute();

    if (points.length === 0) return [];

    // Union-Find data structure for clustering
    const parent = new Map<string, string>();
    const pointsById = new Map<string, typeof points[0]>();

    for (const point of points) {
      parent.set(point.point_id, point.point_id);
      pointsById.set(point.point_id, point);
    }

    // Find root with path compression
    const find = (id: string): string => {
      if (parent.get(id) !== id) {
        parent.set(id, find(parent.get(id)!));
      }
      return parent.get(id)!;
    };

    // Union two clusters
    const union = (id1: string, id2: string): void => {
      const root1 = find(id1);
      const root2 = find(id2);
      if (root1 !== root2) {
        parent.set(root2, root1);
      }
    };

    // Use GPS_MERGE_THRESHOLD_METERS (default 50m) for clustering
    const mergeThreshold = GPS_MERGE_THRESHOLD_METERS ?? 50;

    // Compare all pairs - O(n²) but typically small datasets
    // For large datasets (>10k), could use spatial indexing
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const distance = haversineDistance(
          points[i].lat, points[i].lng,
          points[j].lat, points[j].lng
        );

        if (distance <= mergeThreshold) {
          union(points[i].point_id, points[j].point_id);
        }
      }
    }

    // Collect clusters
    const clusters = new Map<string, DuplicateGroup>();

    for (const point of points) {
      const root = find(point.point_id);

      if (!clusters.has(root)) {
        // Use the root point's coordinates as the group's coordinates
        const rootPoint = pointsById.get(root)!;
        clusters.set(root, {
          roundedLat: rootPoint.lat,
          roundedLng: rootPoint.lng,
          points: [],
        });
      }

      clusters.get(root)!.points.push({
        pointId: point.point_id,
        name: point.name,
        mapId: point.map_id,
        description: point.description,
      });
    }

    // Return only groups with duplicates (2+ points)
    return Array.from(clusters.values()).filter(g => g.points.length > 1);
  }

  /**
   * Find duplicate groups based on name similarity within the same state.
   * Uses Token Set Ratio for word-order independent matching.
   *
   * This catches cases like:
   * - "Union Station - Lockport" ↔ "Lockport Union Train Station"
   * - Same name from different map sources with slightly different GPS
   *
   * Only matches within NAME_DEDUP_GPS_RADIUS_METERS (500m) to avoid
   * matching same-named places in different cities.
   */
  async findNameDuplicateGroups(): Promise<DuplicateGroup[]> {
    // Get all points with state info
    const points = await this.db
      .selectFrom('ref_map_points')
      .select([
        'point_id',
        'name',
        'map_id',
        'description',
        'lat',
        'lng',
        'state',
      ])
      .where('name', 'is not', null)
      .execute();

    if (points.length === 0) return [];

    // Group by state first (blocking strategy for efficiency)
    const byState = new Map<string, typeof points>();
    for (const point of points) {
      const stateKey = normalizeState(point.state) || 'UNKNOWN';
      if (!byState.has(stateKey)) {
        byState.set(stateKey, []);
      }
      byState.get(stateKey)!.push(point);
    }

    // Union-Find for clustering
    const parent = new Map<string, string>();
    const pointsById = new Map<string, typeof points[0]>();

    for (const point of points) {
      parent.set(point.point_id, point.point_id);
      pointsById.set(point.point_id, point);
    }

    const find = (id: string): string => {
      if (parent.get(id) !== id) {
        parent.set(id, find(parent.get(id)!));
      }
      return parent.get(id)!;
    };

    const union = (id1: string, id2: string): void => {
      const root1 = find(id1);
      const root2 = find(id2);
      if (root1 !== root2) {
        parent.set(root2, root1);
      }
    };

    const nameThreshold = NAME_DEDUP_THRESHOLD ?? 0.85;
    const gpsRadius = NAME_DEDUP_GPS_RADIUS_METERS ?? 500;

    // Compare within each state
    for (const [_state, statePoints] of byState) {
      for (let i = 0; i < statePoints.length; i++) {
        for (let j = i + 1; j < statePoints.length; j++) {
          const p1 = statePoints[i];
          const p2 = statePoints[j];

          // Skip if names don't meet threshold
          if (!p1.name || !p2.name) continue;

          // Use Token Set Ratio for name matching
          const nameMatch = calculateNameMatch(p1.name, p2.name);

          // Skip blocked matches (North vs South, etc.)
          if (nameMatch.blocked) continue;

          // Check if names are similar enough
          if (nameMatch.score < nameThreshold) continue;

          // Check GPS distance (must be in same general area)
          const distance = haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
          if (distance > gpsRadius) continue;

          // Skip if both are generic names without close GPS
          const p1Generic = isGenericName(p1.name);
          const p2Generic = isGenericName(p2.name);
          if ((p1Generic || p2Generic) && distance > (GENERIC_NAME_GPS_RADIUS_METERS ?? 25)) {
            continue;
          }

          // Merge into same cluster
          union(p1.point_id, p2.point_id);

          console.log(`[RefMapDedup] Name match: "${p1.name}" ↔ "${p2.name}" (${Math.round(nameMatch.score * 100)}%, ${Math.round(distance)}m)`);
        }
      }
    }

    // Collect clusters
    const clusters = new Map<string, DuplicateGroup>();

    for (const point of points) {
      const root = find(point.point_id);

      if (!clusters.has(root)) {
        const rootPoint = pointsById.get(root)!;
        clusters.set(root, {
          roundedLat: rootPoint.lat,
          roundedLng: rootPoint.lng,
          points: [],
        });
      }

      clusters.get(root)!.points.push({
        pointId: point.point_id,
        name: point.name,
        mapId: point.map_id,
        description: point.description,
      });
    }

    // Return only groups with duplicates (2+ points)
    // Exclude groups already found by GPS dedup
    return Array.from(clusters.values()).filter(g => g.points.length > 1);
  }

  /**
   * Run deduplication on all ref_map_points
   * Two-pass deduplication:
   * 1. GPS-based: Merge points within GPS_MERGE_THRESHOLD_METERS (50m)
   * 2. Name-based: Merge points with similar names (85%+) within 500m in same state
   *
   * Returns stats about what was cleaned up
   */
  async deduplicate(): Promise<DedupStats> {
    const stats: DedupStats = {
      totalPoints: 0,
      uniqueLocations: 0,
      duplicateGroups: 0,
      pointsRemoved: 0,
      pointsWithAka: 0,
    };

    // Get initial count
    const countResult = await this.db
      .selectFrom('ref_map_points')
      .select(eb => eb.fn.count('point_id').as('count'))
      .executeTakeFirst();
    stats.totalPoints = Number(countResult?.count || 0);

    // ========================================================================
    // PASS 1: GPS-based deduplication (within 50m)
    // ========================================================================
    console.log(`[RefMapDedup] Pass 1: GPS-based deduplication (${GPS_MERGE_THRESHOLD_METERS ?? 50}m threshold)`);
    const gpsDuplicateGroups = await this.findDuplicateGroups();
    console.log(`[RefMapDedup] Found ${gpsDuplicateGroups.length} GPS duplicate groups`);

    for (const group of gpsDuplicateGroups) {
      await this.mergeGroup(group, stats, 'GPS');
    }

    stats.duplicateGroups += gpsDuplicateGroups.length;

    // ========================================================================
    // PASS 2: Name-based deduplication (85%+ similarity within 500m)
    // ========================================================================
    console.log(`[RefMapDedup] Pass 2: Name-based deduplication (${Math.round((NAME_DEDUP_THRESHOLD ?? 0.85) * 100)}% threshold)`);
    const nameDuplicateGroups = await this.findNameDuplicateGroups();
    console.log(`[RefMapDedup] Found ${nameDuplicateGroups.length} name-based duplicate groups`);

    for (const group of nameDuplicateGroups) {
      await this.mergeGroup(group, stats, 'Name');
    }

    stats.duplicateGroups += nameDuplicateGroups.length;

    // Calculate final unique locations
    stats.uniqueLocations = stats.totalPoints - stats.pointsRemoved;

    console.log(`[RefMapDedup] Complete:`);
    console.log(`  Total points before: ${stats.totalPoints}`);
    console.log(`  Points removed: ${stats.pointsRemoved}`);
    console.log(`  Unique locations: ${stats.uniqueLocations}`);
    console.log(`  Points with AKA names: ${stats.pointsWithAka}`);

    return stats;
  }

  /**
   * Merge a duplicate group - keeps best name, stores alternates in aka_names
   */
  private async mergeGroup(
    group: DuplicateGroup,
    stats: DedupStats,
    mergeType: 'GPS' | 'Name'
  ): Promise<void> {
    const names = group.points.map(p => p.name);
    const bestName = pickBestName(names);
    const akaNames = collectAkaNames(names, bestName);

    // Find the point to keep (the one with the best name score)
    let keepPoint = group.points[0];
    let keepScore = scoreName(keepPoint.name);

    for (const point of group.points.slice(1)) {
      const score = scoreName(point.name);
      if (score > keepScore) {
        keepPoint = point;
        keepScore = score;
      }
    }

    // Update the keeper with the best name and AKA names
    await this.db
      .updateTable('ref_map_points')
      .set({
        name: bestName,
        aka_names: akaNames,
      })
      .where('point_id', '=', keepPoint.pointId)
      .execute();

    if (akaNames) {
      stats.pointsWithAka++;
    }

    // Delete the duplicates
    const deleteIds = group.points
      .filter(p => p.pointId !== keepPoint.pointId)
      .map(p => p.pointId);

    if (deleteIds.length > 0) {
      await this.db
        .deleteFrom('ref_map_points')
        .where('point_id', 'in', deleteIds)
        .execute();

      stats.pointsRemoved += deleteIds.length;

      console.log(`[RefMapDedup] [${mergeType}] Merged ${group.points.length} pins at (${group.roundedLat.toFixed(4)}, ${group.roundedLng.toFixed(4)})`);
      console.log(`  Kept: "${bestName}" | AKA: "${akaNames || 'none'}"`);
    }
  }

  /**
   * Check if a point already exists near the given GPS coordinates.
   * Uses Haversine distance with GPS_MERGE_THRESHOLD_METERS (50m).
   * Also checks for name similarity if name is provided.
   *
   * @param lat Latitude
   * @param lng Longitude
   * @param name Optional name for additional matching
   * @returns Existing point if found, null otherwise
   */
  async findExistingPoint(lat: number, lng: number, name?: string | null): Promise<{
    pointId: string;
    name: string | null;
    akaNames: string | null;
    matchType: 'gps' | 'name';
    distance: number;
    nameSimilarity?: number;
  } | null> {
    const mergeThreshold = GPS_MERGE_THRESHOLD_METERS ?? 50;

    // Use bounding box for initial filter (faster than checking all points)
    // 0.001 degrees ≈ 111m latitude, varies for longitude
    const latBuffer = mergeThreshold / 111000 * 1.5; // 1.5x buffer for safety
    const lngBuffer = mergeThreshold / (111000 * Math.cos(lat * Math.PI / 180)) * 1.5;

    const candidates = await this.db
      .selectFrom('ref_map_points')
      .select(['point_id', 'name', 'aka_names', 'lat', 'lng', 'state'])
      .where('lat', '>=', lat - latBuffer)
      .where('lat', '<=', lat + latBuffer)
      .where('lng', '>=', lng - lngBuffer)
      .where('lng', '<=', lng + lngBuffer)
      .execute();

    // Check GPS proximity first
    for (const candidate of candidates) {
      const distance = haversineDistance(lat, lng, candidate.lat, candidate.lng);

      if (distance <= mergeThreshold) {
        return {
          pointId: candidate.point_id,
          name: candidate.name,
          akaNames: candidate.aka_names,
          matchType: 'gps',
          distance,
        };
      }
    }

    // If name provided, check for name similarity within NAME_DEDUP_GPS_RADIUS_METERS
    if (name) {
      const nameRadius = NAME_DEDUP_GPS_RADIUS_METERS ?? 500;
      const nameThreshold = NAME_DEDUP_THRESHOLD ?? 0.85;

      // Expand search for name matching
      const nameCandidates = await this.db
        .selectFrom('ref_map_points')
        .select(['point_id', 'name', 'aka_names', 'lat', 'lng', 'state'])
        .where('name', 'is not', null)
        .execute();

      for (const candidate of nameCandidates) {
        if (!candidate.name) continue;

        const distance = haversineDistance(lat, lng, candidate.lat, candidate.lng);
        if (distance > nameRadius) continue;

        // Check name similarity using Token Set Ratio
        const nameMatch = calculateNameMatch(name, candidate.name);

        if (nameMatch.blocked) continue;

        if (nameMatch.score >= nameThreshold) {
          // Also check against aka_names
          let bestScore = nameMatch.score;
          if (candidate.aka_names) {
            for (const aka of candidate.aka_names.split(' | ')) {
              const akaMatch = calculateNameMatch(name, aka.trim());
              if (!akaMatch.blocked && akaMatch.score > bestScore) {
                bestScore = akaMatch.score;
              }
            }
          }

          return {
            pointId: candidate.point_id,
            name: candidate.name,
            akaNames: candidate.aka_names,
            matchType: 'name',
            distance,
            nameSimilarity: bestScore,
          };
        }
      }
    }

    return null;
  }

  /**
   * Add a new point, merging with existing if duplicate found.
   * Checks both GPS proximity and name similarity.
   * Returns the point ID (either new or existing)
   */
  async addOrMergePoint(
    mapId: string,
    name: string | null,
    lat: number,
    lng: number,
    description: string | null,
    state: string | null,
    category: string | null,
    rawMetadata: Record<string, unknown> | null
  ): Promise<{ pointId: string; merged: boolean; matchType?: 'gps' | 'name' }> {
    const existing = await this.findExistingPoint(lat, lng, name);

    if (existing) {
      // Merge: Add new name to AKA if different
      const existingNames = [existing.name, ...(existing.akaNames?.split(' | ') || [])];
      const newNameLower = name?.toLowerCase();

      const isDifferentName = name &&
        !existingNames.some(n => n?.toLowerCase() === newNameLower);

      if (isDifferentName) {
        const updatedAka = existing.akaNames
          ? `${existing.akaNames} | ${name}`
          : name;

        await this.db
          .updateTable('ref_map_points')
          .set({ aka_names: updatedAka })
          .where('point_id', '=', existing.pointId)
          .execute();

        console.log(`[RefMapDedup] Merged "${name}" into existing point "${existing.name}" (${existing.matchType} match, ${Math.round(existing.distance)}m)`);
      }

      return { pointId: existing.pointId, merged: true, matchType: existing.matchType };
    }

    // No duplicate - insert new point (ADR-049: uses generateId for 16-char hex)
    const pointId = generateId();

    await this.db
      .insertInto('ref_map_points')
      .values({
        point_id: pointId,
        map_id: mapId,
        name,
        description,
        lat,
        lng,
        state,
        category,
        raw_metadata: rawMetadata ? JSON.stringify(rawMetadata) : null,
        aka_names: null,
      })
      .execute();

    return { pointId, merged: false };
  }

  /**
   * Get deduplication preview without making changes.
   * Shows both GPS-based and name-based duplicate groups.
   */
  async preview(): Promise<{
    stats: DedupStats;
    groups: Array<{
      lat: number;
      lng: number;
      bestName: string | null;
      akaNames: string | null;
      pointCount: number;
      allNames: string[];
      matchType: 'gps' | 'name';
    }>;
  }> {
    // Get both GPS and name-based duplicate groups
    const gpsDuplicateGroups = await this.findDuplicateGroups();
    const nameDuplicateGroups = await this.findNameDuplicateGroups();

    const countResult = await this.db
      .selectFrom('ref_map_points')
      .select(eb => eb.fn.count('point_id').as('count'))
      .executeTakeFirst();

    const totalPoints = Number(countResult?.count || 0);
    let pointsRemoved = 0;
    let pointsWithAka = 0;

    // Process GPS groups
    const gpsGroups = gpsDuplicateGroups.map(group => {
      const names = group.points.map(p => p.name).filter((n): n is string => n !== null);
      const bestName = pickBestName(group.points.map(p => p.name));
      const akaNames = collectAkaNames(group.points.map(p => p.name), bestName);

      pointsRemoved += group.points.length - 1;
      if (akaNames) pointsWithAka++;

      return {
        lat: group.roundedLat,
        lng: group.roundedLng,
        bestName,
        akaNames,
        pointCount: group.points.length,
        allNames: names,
        matchType: 'gps' as const,
      };
    });

    // Process name groups
    const nameGroups = nameDuplicateGroups.map(group => {
      const names = group.points.map(p => p.name).filter((n): n is string => n !== null);
      const bestName = pickBestName(group.points.map(p => p.name));
      const akaNames = collectAkaNames(group.points.map(p => p.name), bestName);

      pointsRemoved += group.points.length - 1;
      if (akaNames) pointsWithAka++;

      return {
        lat: group.roundedLat,
        lng: group.roundedLng,
        bestName,
        akaNames,
        pointCount: group.points.length,
        allNames: names,
        matchType: 'name' as const,
      };
    });

    // Combine groups
    const groups = [...gpsGroups, ...nameGroups];

    return {
      stats: {
        totalPoints,
        uniqueLocations: totalPoints - pointsRemoved,
        duplicateGroups: groups.length,
        pointsRemoved,
        pointsWithAka,
      },
      groups,
    };
  }

  // ========================================================================
  // CROSS-TABLE METHODS - Check ref_map_points against locs table
  // ========================================================================

  /**
   * Find ref_map_points that match existing locations in the locs table.
   * These are points that have already been "catalogued" as real locations.
   * Returns matches based on GPS proximity, name similarity, or state+name.
   */
  async findCataloguedRefPoints(): Promise<CataloguedMatch[]> {
    // Get all ref points with their state
    const refPoints = await this.db
      .selectFrom('ref_map_points')
      .innerJoin('ref_maps', 'ref_maps.map_id', 'ref_map_points.map_id')
      .select([
        'ref_map_points.point_id',
        'ref_map_points.name',
        'ref_map_points.lat',
        'ref_map_points.lng',
        'ref_map_points.state',
        'ref_maps.map_name',
      ])
      .execute();

    // Get ALL catalogued locations (including those without GPS)
    const locations = await this.db
      .selectFrom('locs')
      .select(['locid', 'locnam', 'gps_lat', 'gps_lng', 'akanam', 'state'])
      .execute();

    const matches: CataloguedMatch[] = [];

    for (const point of refPoints) {
      const pointStateNorm = normalizeState(point.state);

      for (const loc of locations) {
        const locHasGps = loc.gps_lat != null && loc.gps_lng != null;
        const locStateNorm = normalizeState(loc.state);

        if (locHasGps) {
          // LOCATION HAS GPS - use distance-based matching
          const distance = haversineDistance(point.lat, point.lng, loc.gps_lat!, loc.gps_lng!);

          if (distance <= GPS_RADIUS_METERS) {
            // GPS match - high confidence
            const nameSim = point.name && loc.locnam
              ? normalizedSimilarity(point.name, loc.locnam)
              : 0;

            matches.push({
              pointId: point.point_id,
              pointName: point.name,
              mapName: point.map_name,
              matchedLocid: loc.locid,
              matchedLocName: loc.locnam,
              nameSimilarity: Math.round(nameSim * 100),
              distanceMeters: Math.round(distance),
            });
            break; // Found match, move to next point
          }

          // Check name similarity with distance limit using Token Set Ratio
          if (point.name) {
            const namesToCheck = [loc.locnam, loc.akanam].filter(Boolean) as string[];

            let foundMatch = false;
            for (const locName of namesToCheck) {
              // Use Token Set Ratio for word-order independent matching
              const nameMatch = calculateNameMatch(point.name, locName);

              // Skip blocked matches
              if (nameMatch.blocked) continue;

              const nameSim = nameMatch.score;
              const isExactMatch = nameSim >= 0.99;
              const isSimilarMatch = nameSim >= NAME_SIMILARITY_THRESHOLD && distance <= NAME_MATCH_RADIUS_METERS;

              if (isExactMatch || isSimilarMatch) {
                matches.push({
                  pointId: point.point_id,
                  pointName: point.name,
                  mapName: point.map_name,
                  matchedLocid: loc.locid,
                  matchedLocName: loc.locnam,
                  nameSimilarity: Math.round(nameSim * 100),
                  distanceMeters: Math.round(distance),
                });
                foundMatch = true;
                break;
              }
            }
            if (foundMatch) break;
          }
        } else if (locStateNorm && pointStateNorm) {
          // LOCATION HAS NO GPS BUT HAS STATE - use state-based matching
          const sameState = locStateNorm === pointStateNorm;

          if (sameState && point.name) {
            const namesToCheck = [loc.locnam, loc.akanam].filter(Boolean) as string[];

            let foundMatch = false;
            for (const locName of namesToCheck) {
              // Use Token Set Ratio for word-order independent matching
              const nameMatch = calculateNameMatch(point.name, locName);

              // Skip blocked matches
              if (nameMatch.blocked) continue;

              if (nameMatch.score >= NAME_SIMILARITY_THRESHOLD) {
                // State + name match
                matches.push({
                  pointId: point.point_id,
                  pointName: point.name,
                  mapName: point.map_name,
                  matchedLocid: loc.locid,
                  matchedLocName: loc.locnam,
                  nameSimilarity: Math.round(nameMatch.score * 100),
                  distanceMeters: 0, // No GPS, no distance
                });
                foundMatch = true;
                break;
              }
            }
            if (foundMatch) break;
          }
        } else if (point.name) {
          // LOCATION HAS NO GPS AND NO STATE - exact name match only
          const namesToCheck = [loc.locnam, loc.akanam].filter(Boolean) as string[];

          let foundMatch = false;
          for (const locName of namesToCheck) {
            const nameSim = normalizedSimilarity(point.name, locName);

            if (nameSim >= 0.99) { // 99%+ = exact match only
              matches.push({
                pointId: point.point_id,
                pointName: point.name,
                mapName: point.map_name,
                matchedLocid: loc.locid,
                matchedLocName: loc.locnam,
                nameSimilarity: Math.round(nameSim * 100),
                distanceMeters: 0, // No GPS, no distance
              });
              foundMatch = true;
              break;
            }
          }
          if (foundMatch) break;
        }
      }
    }

    return matches;
  }

  /**
   * Check incoming points against existing ref_map_points and locs.
   * Used during import preview to identify duplicates before importing.
   */
  async checkForDuplicates(points: Array<{
    name: string | null;
    description: string | null;
    lat: number;
    lng: number;
    state: string | null;
    category: string | null;
    rawMetadata: Record<string, unknown> | null;
  }>): Promise<DedupeResult> {
    const result: DedupeResult = {
      totalParsed: points.length,
      newPoints: [],
      cataloguedMatches: [],
      referenceMatches: [],
    };

    // Get existing ref points for checking
    const existingRefPoints = await this.db
      .selectFrom('ref_map_points')
      .innerJoin('ref_maps', 'ref_maps.map_id', 'ref_map_points.map_id')
      .select([
        'ref_map_points.point_id',
        'ref_map_points.name',
        'ref_map_points.lat',
        'ref_map_points.lng',
        'ref_maps.map_name',
      ])
      .execute();

    // Get ALL catalogued locations (including those without GPS)
    const locations = await this.db
      .selectFrom('locs')
      .select(['locid', 'locnam', 'gps_lat', 'gps_lng', 'akanam', 'state'])
      .execute();

    // Track locations already matched for enrichment - one ref point per location
    const matchedEnrichmentLocIds = new Set<string>();

    for (const point of points) {
      let isDuplicate = false;
      const pointStateNorm = normalizeState(point.state);
      const pointIsGeneric = point.name ? isGenericName(point.name) : false;

      // Check against catalogued locations (locs table)
      for (const loc of locations) {
        const locHasGps = loc.gps_lat != null && loc.gps_lng != null;
        const locStateNorm = normalizeState(loc.state);

        if (locHasGps) {
          // LOCATION HAS GPS - use multi-signal matching
          const distance = haversineDistance(point.lat, point.lng, loc.gps_lat!, loc.gps_lng!);

          if (distance <= GPS_RADIUS_METERS) {
            // GPS match - high confidence, auto-skip
            const nameMatch = point.name && loc.locnam
              ? calculateNameMatch(point.name, loc.locnam)
              : null;

            result.cataloguedMatches.push({
              type: 'catalogued',
              matchType: 'gps',
              newPoint: { name: point.name, lat: point.lat, lng: point.lng, state: point.state },
              existingId: loc.locid,
              existingName: loc.locnam,
              existingState: locStateNorm || undefined,
              existingHasGps: true,
              nameSimilarity: nameMatch ? Math.round(nameMatch.score * 100) : 0,
              distanceMeters: Math.round(distance),
              needsConfirmation: false,
              sharedTokens: nameMatch?.sharedTokens,
              confidenceTier: 'high',
              confidenceScore: 90,
            });
            isDuplicate = true;
            break;
          }

          // Check name similarity with distance limit using Token Set Ratio
          if (point.name) {
            const namesToCheck = [loc.locnam, loc.akanam].filter(Boolean) as string[];

            for (const locName of namesToCheck) {
              // Use new multi-signal matching
              const multiSignal = calculateMultiSignalMatch({
                name1: point.name,
                name2: locName,
                lat1: point.lat,
                lng1: point.lng,
                lat2: loc.gps_lat,
                lng2: loc.gps_lng,
                state1: pointStateNorm,
                state2: locStateNorm,
              });

              // Skip blocked matches (North vs South, Building A vs B)
              if (multiSignal.nameMatch.blocked) {
                continue;
              }

              const nameSim = multiSignal.nameMatch.score;
              const isExactMatch = nameSim >= 0.99;
              const isSimilarMatch = nameSim >= NAME_SIMILARITY_THRESHOLD && distance <= NAME_MATCH_RADIUS_METERS;

              // Generic name handling: require close GPS
              const locIsGeneric = isGenericName(locName);
              if ((pointIsGeneric || locIsGeneric) && distance > (GENERIC_NAME_GPS_RADIUS_METERS ?? 25)) {
                continue;
              }

              if (isExactMatch || isSimilarMatch) {
                result.cataloguedMatches.push({
                  type: 'catalogued',
                  matchType: 'name_gps',
                  newPoint: { name: point.name, lat: point.lat, lng: point.lng, state: point.state },
                  existingId: loc.locid,
                  existingName: loc.locnam,
                  existingState: locStateNorm || undefined,
                  existingHasGps: true,
                  nameSimilarity: Math.round(nameSim * 100),
                  distanceMeters: Math.round(distance),
                  needsConfirmation: multiSignal.nameMatch.requiresUserReview,
                  sharedTokens: multiSignal.nameMatch.sharedTokens,
                  confidenceTier: multiSignal.tier,
                  confidenceScore: multiSignal.totalScore,
                  isGenericNameMatch: pointIsGeneric || locIsGeneric,
                });
                isDuplicate = true;
                break;
              }
            }
            if (isDuplicate) break;
          }
        } else if (locStateNorm && pointStateNorm) {
          // LOCATION HAS NO GPS BUT HAS STATE - use state-based matching
          if (matchedEnrichmentLocIds.has(loc.locid)) continue;

          const sameState = locStateNorm === pointStateNorm;

          if (sameState && point.name) {
            const namesToCheck = [loc.locnam, loc.akanam].filter(Boolean) as string[];

            for (const locName of namesToCheck) {
              // Use Token Set Ratio for word-order independent matching
              const nameMatch = calculateNameMatch(point.name, locName);

              // Skip blocked matches
              if (nameMatch.blocked) {
                continue;
              }

              if (nameMatch.score >= NAME_SIMILARITY_THRESHOLD) {
                // State + name match - needs user confirmation
                result.cataloguedMatches.push({
                  type: 'catalogued',
                  matchType: 'name_state',
                  newPoint: { name: point.name, lat: point.lat, lng: point.lng, state: point.state },
                  existingId: loc.locid,
                  existingName: loc.locnam,
                  existingState: locStateNorm,
                  existingHasGps: false,
                  nameSimilarity: Math.round(nameMatch.score * 100),
                  needsConfirmation: true,
                  sharedTokens: nameMatch.sharedTokens,
                  confidenceTier: 'medium',
                  confidenceScore: 50 + Math.round(nameMatch.score * 35),
                  isGenericNameMatch: pointIsGeneric || isGenericName(locName),
                });
                matchedEnrichmentLocIds.add(loc.locid);
                isDuplicate = true;
                break;
              }
            }
            if (isDuplicate) break;
          }
        } else if (point.name) {
          // LOCATION HAS NO GPS AND NO STATE - name match for enrichment
          if (matchedEnrichmentLocIds.has(loc.locid)) continue;

          const namesToCheck = [loc.locnam, loc.akanam].filter(Boolean) as string[];

          for (const locName of namesToCheck) {
            const nameMatch = calculateNameMatch(point.name, locName);

            // Skip blocked matches and generic names without GPS
            if (nameMatch.blocked) continue;
            if (pointIsGeneric || isGenericName(locName)) continue; // Generic names need GPS

            if (nameMatch.score >= 0.95) { // Higher threshold for name-only matches
              result.cataloguedMatches.push({
                type: 'catalogued',
                matchType: 'name_only',
                newPoint: { name: point.name, lat: point.lat, lng: point.lng, state: point.state },
                existingId: loc.locid,
                existingName: loc.locnam,
                existingHasGps: false,
                nameSimilarity: Math.round(nameMatch.score * 100),
                needsConfirmation: true,
                sharedTokens: nameMatch.sharedTokens,
                confidenceTier: 'low',
                confidenceScore: Math.round(nameMatch.score * 35),
              });
              matchedEnrichmentLocIds.add(loc.locid);
              isDuplicate = true;
              break;
            }
          }
          if (isDuplicate) break;
        }
      }

      if (isDuplicate) continue;

      // Check against existing ref_map_points (GPS proximity ~150m now, not 10m)
      for (const refPoint of existingRefPoints) {
        const distance = haversineDistance(point.lat, point.lng, refPoint.lat, refPoint.lng);

        // Use consistent 150m threshold for ref point matching too
        if (distance <= GPS_RADIUS_METERS) {
          const nameMatch = point.name && refPoint.name
            ? calculateNameMatch(point.name, refPoint.name)
            : null;

          // Skip if blocking conflict detected
          if (nameMatch?.blocked) {
            continue;
          }

          result.referenceMatches.push({
            type: 'reference',
            newPoint: { name: point.name, lat: point.lat, lng: point.lng },
            existingId: refPoint.point_id,
            existingName: refPoint.name || 'Unnamed',
            mapName: refPoint.map_name,
            distanceMeters: Math.round(distance),
            nameSimilarity: nameMatch ? Math.round(nameMatch.score * 100) : undefined,
            sharedTokens: nameMatch?.sharedTokens,
          });
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        result.newPoints.push(point);
      }
    }

    return result;
  }

  /**
   * Delete ref_map_points by their IDs.
   * Used when purging catalogued points or after conversion to locations.
   */
  async deleteRefPoints(pointIds: string[]): Promise<number> {
    if (pointIds.length === 0) return 0;

    const result = await this.db
      .deleteFrom('ref_map_points')
      .where('point_id', 'in', pointIds)
      .execute();

    const deleted = Number(result[0]?.numDeletedRows ?? 0);
    console.log(`[RefMapDedup] Deleted ${deleted} ref_map_points`);
    return deleted;
  }
}

export default RefMapDedupService;
