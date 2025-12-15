/**
 * Import Intelligence Service
 *
 * Smart matching engine that scans the archive when GPS is detected during import.
 * Checks locations, sub-locations, and reference map points to prevent duplicates
 * and suggest existing locations for media import.
 *
 * "Smart as fuck" - finds matches before duplicates happen.
 */

import type { Kysely } from 'kysely';
import type { Database } from '../main/database.types';
import { haversineDistance, getBoundingBox } from './geo-utils';
import { jaroWinklerSimilarity } from './jaro-winkler-service';

/**
 * Match result from intelligence scan
 */
export interface IntelligenceMatch {
  source: 'location' | 'sublocation' | 'refmap';
  id: string;
  name: string;
  type: string | null;
  state: string | null;
  distanceMeters: number;
  distanceFeet: number;
  confidence: number;           // 0-100
  confidenceLabel: string;      // "Exact Match", "Very Likely", "Possible", "Nearby"
  reasons: string[];            // ["Exact GPS match", "Type matches", etc.]
  // Extra context for UI
  mediaCount?: number;          // Photos/videos at this location
  heroThumbPath?: string | null;
  parentName?: string;          // For sub-locations
  mapName?: string;             // For reference map points
}

/**
 * Intelligence scan result
 */
export interface IntelligenceScanResult {
  scanned: {
    locations: number;
    sublocations: number;
    refmaps: number;
  };
  matches: IntelligenceMatch[];
  scanTimeMs: number;
}

/**
 * Configuration for intelligence scanning
 */
export const INTELLIGENCE_CONFIG = {
  // Search radius in meters (~1/3 mile)
  SCAN_RADIUS_METERS: 500,

  // Confidence thresholds
  EXACT_MATCH: 80,
  LIKELY_MATCH: 60,
  POSSIBLE_MATCH: 35,      // Lowered to catch ~400ft matches

  // Max results to return
  MAX_MATCHES: 5,

  // Distance scoring brackets (meters) - more generous scoring
  // Anything in scan radius should at least be "Possible Match"
  DISTANCE_EXACT: 20,      // ~65 ft - same spot
  DISTANCE_VERY_CLOSE: 75, // ~250 ft - same property
  DISTANCE_CLOSE: 200,     // ~660 ft - adjacent
  DISTANCE_NEAR: 350,      // ~1150 ft
  DISTANCE_FAR: 500,       // ~1/3 mile
} as const;

export class ImportIntelligenceService {
  constructor(private db: Kysely<Database>) {}

  /**
   * Scan the archive for matches near a GPS point.
   * This is the main entry point for import intelligence.
   * @param excludeRefPointId - Optional ref point ID to exclude from results (e.g., when creating from that point)
   */
  async scan(
    lat: number,
    lng: number,
    hints?: {
      filename?: string;
      inferredType?: string;
      inferredState?: string;
    },
    excludeRefPointId?: string | null
  ): Promise<IntelligenceScanResult> {
    const startTime = Date.now();
    const allMatches: IntelligenceMatch[] = [];

    // Get bounding box for efficient queries
    const bbox = getBoundingBox(lat, lng, INTELLIGENCE_CONFIG.SCAN_RADIUS_METERS);

    // Scan all sources in parallel
    const [locationMatches, sublocationMatches, refmapMatches] = await Promise.all([
      this.scanLocations(lat, lng, bbox, hints),
      this.scanSublocations(lat, lng, bbox, hints),
      this.scanRefmaps(lat, lng, bbox, hints, excludeRefPointId),
    ]);

    allMatches.push(...locationMatches.matches);
    allMatches.push(...sublocationMatches.matches);
    allMatches.push(...refmapMatches.matches);

    // Sort by confidence (highest first), then by distance (closest first)
    allMatches.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.distanceMeters - b.distanceMeters;
    });

    // Limit results
    const topMatches = allMatches.slice(0, INTELLIGENCE_CONFIG.MAX_MATCHES);

    return {
      scanned: {
        locations: locationMatches.count,
        sublocations: sublocationMatches.count,
        refmaps: refmapMatches.count,
      },
      matches: topMatches,
      scanTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Scan locations table
   */
  private async scanLocations(
    lat: number,
    lng: number,
    bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
    hints?: { filename?: string; inferredType?: string; inferredState?: string }
  ): Promise<{ matches: IntelligenceMatch[]; count: number }> {
    // Query locations within bounding box
    const candidates = await this.db
      .selectFrom('locs')
      .selectAll()
      .where('gps_lat', 'is not', null)
      .where('gps_lng', 'is not', null)
      .where('gps_lat', '>=', bbox.minLat)
      .where('gps_lat', '<=', bbox.maxLat)
      .where('gps_lng', '>=', bbox.minLng)
      .where('gps_lng', '<=', bbox.maxLng)
      .execute();

    const matches: IntelligenceMatch[] = [];

    for (const candidate of candidates) {
      if (!candidate.gps_lat || !candidate.gps_lng) continue;

      const distance = haversineDistance(lat, lng, candidate.gps_lat, candidate.gps_lng);
      if (distance > INTELLIGENCE_CONFIG.SCAN_RADIUS_METERS) continue;

      // Get media count for this location
      const locid = candidate.locid as string;
      const mediaCount = await this.getLocationMediaCount(locid);

      const match = this.scoreMatch(
        { lat, lng, ...hints },
        {
          id: locid,
          name: candidate.locnam,
          type: candidate.category,
          state: candidate.address_state,
          lat: candidate.gps_lat,
          lng: candidate.gps_lng,
        },
        distance,
        'location'
      );

      match.mediaCount = mediaCount;
      match.heroThumbPath = null; // Skip thumbnail lookup for performance

      if (match.confidence >= INTELLIGENCE_CONFIG.POSSIBLE_MATCH) {
        matches.push(match);
      }
    }

    return { matches, count: candidates.length };
  }

  /**
   * Scan sub-locations table
   */
  private async scanSublocations(
    lat: number,
    lng: number,
    bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
    hints?: { filename?: string; inferredType?: string; inferredState?: string }
  ): Promise<{ matches: IntelligenceMatch[]; count: number }> {
    // Query sub-locations within bounding box
    const candidates = await this.db
      .selectFrom('slocs')
      .selectAll()
      .where('gps_lat', 'is not', null)
      .where('gps_lng', 'is not', null)
      .where('gps_lat', '>=', bbox.minLat)
      .where('gps_lat', '<=', bbox.maxLat)
      .where('gps_lng', '>=', bbox.minLng)
      .where('gps_lng', '<=', bbox.maxLng)
      .execute();

    const matches: IntelligenceMatch[] = [];

    for (const candidate of candidates) {
      if (!candidate.gps_lat || !candidate.gps_lng) continue;

      const distance = haversineDistance(lat, lng, candidate.gps_lat, candidate.gps_lng);
      if (distance > INTELLIGENCE_CONFIG.SCAN_RADIUS_METERS) continue;

      // Get media count for this sub-location
      const subid = candidate.subid as string;
      const mediaCount = await this.getSublocationMediaCount(subid);

      const match = this.scoreMatch(
        { lat, lng, ...hints },
        {
          id: subid,
          name: candidate.subnam,
          type: candidate.category,
          state: null, // Sub-locations don't have state directly
          lat: candidate.gps_lat,
          lng: candidate.gps_lng,
        },
        distance,
        'sublocation'
      );

      match.mediaCount = mediaCount;
      match.heroThumbPath = null; // Skip thumbnail lookup for performance
      // Look up parent name separately if needed
      match.parentName = undefined;

      if (match.confidence >= INTELLIGENCE_CONFIG.POSSIBLE_MATCH) {
        matches.push(match);
      }
    }

    return { matches, count: candidates.length };
  }

  /**
   * Scan reference map points
   * @param excludeRefPointId - Optional ref point ID to exclude (e.g., when creating a location from that point)
   */
  private async scanRefmaps(
    lat: number,
    lng: number,
    bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
    hints?: { filename?: string; inferredType?: string; inferredState?: string },
    excludeRefPointId?: string | null
  ): Promise<{ matches: IntelligenceMatch[]; count: number }> {
    // Query reference points within bounding box
    const candidates = await this.db
      .selectFrom('ref_map_points')
      .innerJoin('ref_maps', 'ref_map_points.map_id', 'ref_maps.map_id')
      .select([
        'ref_map_points.point_id',
        'ref_map_points.name',
        'ref_map_points.lat',
        'ref_map_points.lng',
        'ref_map_points.state',
        'ref_map_points.category',
        'ref_maps.map_name',
      ])
      .where('ref_map_points.lat', '>=', bbox.minLat)
      .where('ref_map_points.lat', '<=', bbox.maxLat)
      .where('ref_map_points.lng', '>=', bbox.minLng)
      .where('ref_map_points.lng', '<=', bbox.maxLng)
      .execute();

    const matches: IntelligenceMatch[] = [];

    for (const candidate of candidates) {
      // Skip the ref point we're creating from (prevents self-matching)
      if (excludeRefPointId && candidate.point_id === excludeRefPointId) {
        continue;
      }

      const distance = haversineDistance(lat, lng, candidate.lat, candidate.lng);
      if (distance > INTELLIGENCE_CONFIG.SCAN_RADIUS_METERS) continue;

      const match = this.scoreMatch(
        { lat, lng, ...hints },
        {
          id: candidate.point_id,
          name: candidate.name || 'Unnamed Point',
          type: candidate.category,
          state: candidate.state,
          lat: candidate.lat,
          lng: candidate.lng,
        },
        distance,
        'refmap'
      );

      match.mapName = candidate.map_name;

      if (match.confidence >= INTELLIGENCE_CONFIG.POSSIBLE_MATCH) {
        matches.push(match);
      }
    }

    return { matches, count: candidates.length };
  }

  /**
   * Score a potential match based on multiple factors
   */
  private scoreMatch(
    input: {
      lat: number;
      lng: number;
      filename?: string;
      inferredType?: string;
      inferredState?: string;
    },
    candidate: {
      id: string;
      name: string;
      type: string | null;
      state: string | null;
      lat: number;
      lng: number;
    },
    distanceMeters: number,
    source: 'location' | 'sublocation' | 'refmap'
  ): IntelligenceMatch {
    const reasons: string[] = [];
    let score = 0;

    // DISTANCE SCORING (primary factor - up to 50 points)
    // Brackets tuned so anything in scan radius qualifies as "Possible Match"
    if (distanceMeters < INTELLIGENCE_CONFIG.DISTANCE_EXACT) {
      score += 50;
      reasons.push('Exact GPS match (within 65ft)');
    } else if (distanceMeters < INTELLIGENCE_CONFIG.DISTANCE_VERY_CLOSE) {
      score += 45;
      reasons.push('Same property (within 250ft)');
    } else if (distanceMeters < INTELLIGENCE_CONFIG.DISTANCE_CLOSE) {
      score += 40;
      reasons.push(`${Math.round(distanceMeters * 3.281)}ft away`);
    } else if (distanceMeters < INTELLIGENCE_CONFIG.DISTANCE_NEAR) {
      score += 35;
      reasons.push(`${Math.round(distanceMeters * 3.281)}ft away`);
    } else if (distanceMeters < INTELLIGENCE_CONFIG.DISTANCE_FAR) {
      score += 30;
      reasons.push(`${Math.round(distanceMeters * 3.281)}ft away`);
    }

    // TYPE MATCH (up to 25 points)
    if (input.inferredType && candidate.type) {
      const typeSimilarity = jaroWinklerSimilarity(
        input.inferredType.toLowerCase(),
        candidate.type.toLowerCase()
      );
      if (typeSimilarity > 0.9) {
        score += 25;
        reasons.push(`Type matches: ${candidate.type}`);
      } else if (typeSimilarity > 0.7) {
        score += 15;
        reasons.push(`Similar type: ${candidate.type}`);
      }
    }

    // FILENAME HINTS (up to 20 points)
    if (input.filename) {
      const locationHint = this.extractLocationHint(input.filename);
      if (locationHint) {
        const nameSimilarity = jaroWinklerSimilarity(
          locationHint.toLowerCase(),
          candidate.name.toLowerCase()
        );
        if (nameSimilarity > 0.8) {
          score += 20;
          reasons.push(`Filename suggests "${locationHint}"`);
        } else if (nameSimilarity > 0.6) {
          score += 10;
          reasons.push(`Filename may relate to "${candidate.name}"`);
        }
      }
    }

    // STATE MATCH (up to 5 points - sanity check)
    if (input.inferredState && candidate.state) {
      if (input.inferredState.toUpperCase() === candidate.state.toUpperCase()) {
        score += 5;
        // Don't add to reasons - it's expected
      }
    }

    // Determine confidence label
    let confidenceLabel: string;
    if (score >= INTELLIGENCE_CONFIG.EXACT_MATCH) {
      confidenceLabel = 'Exact Match';
    } else if (score >= INTELLIGENCE_CONFIG.LIKELY_MATCH) {
      confidenceLabel = 'Very Likely';
    } else if (score >= INTELLIGENCE_CONFIG.POSSIBLE_MATCH) {
      confidenceLabel = 'Possible Match';
    } else {
      confidenceLabel = 'Nearby';
    }

    return {
      source,
      id: candidate.id,
      name: candidate.name,
      type: candidate.type,
      state: candidate.state,
      distanceMeters: Math.round(distanceMeters),
      distanceFeet: Math.round(distanceMeters * 3.281),
      confidence: Math.min(score, 100),
      confidenceLabel,
      reasons,
    };
  }

  /**
   * Extract potential location name hints from filename
   * e.g., "IMG_johnson_city_power_001.jpg" -> "johnson city power"
   */
  private extractLocationHint(filename: string): string | null {
    // Remove extension
    const name = filename.replace(/\.[^/.]+$/, '');

    // Remove common prefixes
    const cleaned = name
      .replace(/^(IMG|DSC|DCIM|VID|MOV|DJI|GOPR)[\s_-]*/i, '')
      .replace(/[\s_-]+\d+$/, '') // Remove trailing numbers
      .replace(/[_-]/g, ' ')
      .trim();

    // If it looks like just numbers/dates, skip
    if (/^\d+$/.test(cleaned) || /^\d{4}[-/]\d{2}[-/]\d{2}/.test(cleaned)) {
      return null;
    }

    // If we have something meaningful (3+ chars, not just numbers)
    if (cleaned.length >= 3 && /[a-zA-Z]{2,}/.test(cleaned)) {
      return cleaned;
    }

    return null;
  }

  /**
   * Get media count for a location
   */
  private async getLocationMediaCount(locid: string): Promise<number> {
    const [imgCount, vidCount] = await Promise.all([
      this.db
        .selectFrom('imgs')
        .select((eb) => eb.fn.count('imghash').as('count'))
        .where('locid', '=', locid)
        .executeTakeFirst(),
      this.db
        .selectFrom('vids')
        .select((eb) => eb.fn.count('vidhash').as('count'))
        .where('locid', '=', locid)
        .executeTakeFirst(),
    ]);

    return Number(imgCount?.count || 0) + Number(vidCount?.count || 0);
  }

  /**
   * Get media count for a sub-location
   */
  private async getSublocationMediaCount(subid: string): Promise<number> {
    const [imgCount, vidCount] = await Promise.all([
      this.db
        .selectFrom('imgs')
        .select((eb) => eb.fn.count('imghash').as('count'))
        .where('subid', '=', subid)
        .executeTakeFirst(),
      this.db
        .selectFrom('vids')
        .select((eb) => eb.fn.count('vidhash').as('count'))
        .where('subid', '=', subid)
        .executeTakeFirst(),
    ]);

    return Number(imgCount?.count || 0) + Number(vidCount?.count || 0);
  }

  /**
   * Add an AKA name to an existing location
   */
  async addAkaName(locid: string, newName: string): Promise<void> {
    const location = await this.db
      .selectFrom('locs')
      .select(['akanam'])
      .where('locid', '=', locid)
      .executeTakeFirst();

    if (!location) {
      throw new Error('Location not found');
    }

    // Parse existing AKA names
    const existingNames = location.akanam
      ? location.akanam.split(',').map((n) => n.trim()).filter(Boolean)
      : [];

    // Don't add if already exists
    if (existingNames.some((n) => n.toLowerCase() === newName.toLowerCase())) {
      return;
    }

    // Add new name
    existingNames.push(newName.trim());

    await this.db
      .updateTable('locs')
      .set({
        akanam: existingNames.join(', '),
        locup: new Date().toISOString(),
      })
      .where('locid', '=', locid)
      .execute();
  }
}
