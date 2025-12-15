/**
 * Location Duplicate Detection Service
 *
 * Provides safety net to prevent duplicate locations in the archive.
 * Checks for matches by:
 * 1. GPS proximity (within 150m = same physical site)
 * 2. Name similarity (≥80% combined score = JW + Token Set Ratio)
 * 3. Blocking word detection (prevents North/South false positives)
 * 4. Generic name handling (requires GPS for "House", "Church", etc.)
 *
 * ADR Reference: ADR-pin-conversion-duplicate-prevention.md
 * Updated: 2025-12-11 with Token Set Ratio and blocking word detection
 */

import type { Kysely } from 'kysely';
import type { Database } from '../main/database.types';
import { haversineDistance, getBoundingBox } from './geo-utils';
import {
  calculateNameMatch,
  calculateMultiSignalMatch,
  isGenericName,
  hasUncertainty,
  isPlaceholder,
  type NameMatchResult,
  type MultiSignalResult,
} from './token-set-service';
import { DUPLICATE_CONFIG } from '../../src/lib/constants';

// Use centralized constants for duplicate detection
const { GPS_RADIUS_METERS, NAME_SIMILARITY_THRESHOLD, GENERIC_NAME_GPS_RADIUS_METERS } = DUPLICATE_CONFIG;

/**
 * Input for duplicate check
 */
export interface DuplicateCheckInput {
  name: string;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Exclusion pair (names previously marked as "different")
 */
export interface ExclusionPair {
  nameA: string;
  nameB: string;
}

/**
 * Match details when duplicate found
 */
export interface DuplicateMatch {
  locationId: string;
  locnam: string;
  akanam: string | null;
  state: string | null;
  matchType: 'gps' | 'name' | 'combined';
  distanceMeters?: number;
  nameSimilarity?: number;
  matchedField?: 'locnam' | 'akanam';
  mediaCount: number;
  /** GPS coordinates of the matched location (for map view) */
  lat?: number | null;
  lng?: number | null;
  /** Token-based match details */
  sharedTokens?: string[];
  /** Whether this match was blocked (different place) */
  blocked?: boolean;
  /** Block reason if blocked */
  blockReason?: string;
  /** Confidence tier from multi-signal matching */
  confidenceTier?: 'high' | 'medium' | 'low' | 'none';
  /** Total confidence score (0-100) */
  confidenceScore?: number;
  /** Whether user review is recommended */
  requiresUserReview?: boolean;
  /** Whether this is a generic name match */
  isGenericNameMatch?: boolean;
}

/**
 * Result of duplicate check
 */
export interface DuplicateCheckResult {
  hasDuplicate: boolean;
  match?: DuplicateMatch;
}

/**
 * Normalize a name for comparison
 * - Lowercase
 * - Strip leading articles (The, A, An)
 * - Expand common abbreviations
 */
export function normalizeName(name: string): string {
  if (!name) return '';

  let normalized = name.toLowerCase().trim();

  // Strip leading articles
  normalized = normalized.replace(/^(the|a|an)\s+/i, '');

  // Expand abbreviations (order matters - process longer patterns first)
  const abbreviations: [RegExp, string][] = [
    [/\bst\.\s*/gi, 'saint '],
    [/\bmt\.\s*/gi, 'mount '],
    [/\bhosp\.\s*/gi, 'hospital '],
    [/\bmfg\.\s*/gi, 'manufacturing '],
    [/\bco\.\s*/gi, 'company '],
    [/\bcorp\.\s*/gi, 'corporation '],
    [/\binc\.\s*/gi, 'incorporated '],
    [/\bave\.\s*/gi, 'avenue '],
    [/\bblvd\.\s*/gi, 'boulevard '],
    [/\brd\.\s*/gi, 'road '],
  ];

  for (const [pattern, replacement] of abbreviations) {
    normalized = normalized.replace(pattern, replacement);
  }

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Check if a name pair is in the exclusion list
 */
function isExcluded(name1: string, name2: string, exclusions: ExclusionPair[]): boolean {
  const n1 = name1.toLowerCase();
  const n2 = name2.toLowerCase();

  return exclusions.some((ex) => {
    const a = ex.nameA.toLowerCase();
    const b = ex.nameB.toLowerCase();
    return (n1 === a && n2 === b) || (n1 === b && n2 === a);
  });
}

/**
 * Location Duplicate Service
 */
export class LocationDuplicateService {
  constructor(private db: Kysely<Database>) {}

  /**
   * Check if a new location would be a duplicate of an existing one.
   *
   * Uses multi-signal matching:
   * 1. GPS proximity (within 150m = same physical site)
   * 2. Name similarity (Token Set Ratio + Jaro-Winkler)
   * 3. Blocking word detection (prevents North/South false positives)
   * 4. Generic name handling (requires GPS for "House", "Church", etc.)
   *
   * @param input - Name and optional GPS coordinates
   * @param exclusions - Previously marked "different" pairs to skip
   * @returns Check result with match details if duplicate found
   */
  async checkForDuplicate(
    input: DuplicateCheckInput,
    exclusions: ExclusionPair[] = []
  ): Promise<DuplicateCheckResult> {
    const normalizedInputName = normalizeName(input.name);

    // 1. GPS CHECK (if coordinates provided)
    // GPS check takes priority - same physical location is always a duplicate
    if (input.lat != null && input.lng != null) {
      const gpsMatch = await this.checkGpsProximity(
        input.lat,
        input.lng,
        input.name,
        exclusions
      );
      if (gpsMatch) {
        return { hasDuplicate: true, match: gpsMatch };
      }
    }

    // 2. NAME CHECK with multi-signal matching
    // Pass GPS coordinates for combined scoring
    const nameMatch = await this.checkNameSimilarity(
      input.name,
      normalizedInputName,
      exclusions,
      input.lat,
      input.lng
    );
    if (nameMatch) {
      return { hasDuplicate: true, match: nameMatch };
    }

    // 3. NO MATCH
    return { hasDuplicate: false };
  }

  /**
   * Check for GPS proximity matches within 150m
   */
  private async checkGpsProximity(
    lat: number,
    lng: number,
    inputName: string,
    exclusions: ExclusionPair[]
  ): Promise<DuplicateMatch | null> {
    // Get bounding box for efficient query
    const bbox = getBoundingBox(lat, lng, GPS_RADIUS_METERS);

    // Query locations within bounding box
    const nearbyLocations = await this.db
      .selectFrom('locs')
      .select([
        'locid',
        'locnam',
        'akanam',
        'historical_name',
        'state',
        'gps_lat',
        'gps_lng',
      ])
      .where('gps_lat', '>=', bbox.minLat)
      .where('gps_lat', '<=', bbox.maxLat)
      .where('gps_lng', '>=', bbox.minLng)
      .where('gps_lng', '<=', bbox.maxLng)
      .execute();

    for (const loc of nearbyLocations) {
      if (loc.gps_lat == null || loc.gps_lng == null) continue;

      const distance = haversineDistance(lat, lng, loc.gps_lat, loc.gps_lng);

      if (distance <= GPS_RADIUS_METERS) {
        // Check if this pair was previously marked "different"
        if (isExcluded(inputName, loc.locnam, exclusions)) continue;
        if (loc.akanam && isExcluded(inputName, loc.akanam, exclusions)) continue;

        // Get media count
        const mediaCount = await this.getMediaCount(loc.locid);

        return {
          locationId: loc.locid,
          locnam: loc.locnam,
          akanam: loc.akanam,
          state: loc.state,
          matchType: 'gps',
          distanceMeters: Math.round(distance),
          mediaCount,
          lat: loc.gps_lat,
          lng: loc.gps_lng,
        };
      }
    }

    return null;
  }

  /**
   * Check for name similarity matches using Token Set Ratio + Jaro-Winkler.
   * Incorporates blocking word detection and generic name handling.
   */
  private async checkNameSimilarity(
    inputName: string,
    normalizedInputName: string,
    exclusions: ExclusionPair[],
    inputLat?: number | null,
    inputLng?: number | null
  ): Promise<DuplicateMatch | null> {
    // Check if input name is generic - requires GPS match
    const inputIsGeneric = isGenericName(inputName);
    const inputHasUncertainty = hasUncertainty(inputName);

    // Query all locations with names
    const locations = await this.db
      .selectFrom('locs')
      .select([
        'locid',
        'locnam',
        'akanam',
        'state',
        'gps_lat',
        'gps_lng',
        'address_county',
      ])
      .execute();

    let bestMatch: DuplicateMatch | null = null;
    let bestScore = 0;

    for (const loc of locations) {
      // Check against each name field
      const namesToCheck: Array<{
        field: 'locnam' | 'akanam';
        value: string | null;
      }> = [
        { field: 'locnam', value: loc.locnam },
        { field: 'akanam', value: loc.akanam },
      ];

      for (const { field, value } of namesToCheck) {
        if (!value) continue;

        // Check if this pair was previously marked "different"
        if (isExcluded(inputName, value, exclusions)) continue;

        // Use multi-signal matching for comprehensive score
        const multiSignal = calculateMultiSignalMatch({
          name1: inputName,
          name2: value,
          lat1: inputLat,
          lng1: inputLng,
          lat2: loc.gps_lat,
          lng2: loc.gps_lng,
          state1: null, // Input may not have state yet
          state2: loc.state,
          county1: null,
          county2: loc.address_county,
        });

        // Skip blocked matches (opposite directions, different building IDs, etc.)
        if (multiSignal.nameMatch.blocked) {
          continue;
        }

        // Check name similarity threshold
        const similarity = multiSignal.nameMatch.score;
        if (similarity < NAME_SIMILARITY_THRESHOLD) {
          continue;
        }

        // Generic name handling: require close GPS for generic names
        const locIsGeneric = isGenericName(value);
        const isGenericMatch = inputIsGeneric || locIsGeneric;

        if (isGenericMatch) {
          // For generic names, require GPS within 25m or skip
          if (!multiSignal.distanceMeters || multiSignal.distanceMeters > (GENERIC_NAME_GPS_RADIUS_METERS ?? 25)) {
            continue;
          }
        }

        // Calculate effective score (use multi-signal total for ranking)
        const effectiveScore = multiSignal.totalScore;

        // Keep best match
        if (effectiveScore > bestScore) {
          bestScore = effectiveScore;

          // Get media count
          const mediaCount = await this.getMediaCount(loc.locid);

          bestMatch = {
            locationId: loc.locid,
            locnam: loc.locnam,
            akanam: loc.akanam,
            state: loc.state,
            matchType: multiSignal.distanceMeters !== undefined ? 'combined' : 'name',
            nameSimilarity: Math.round(similarity * 100),
            matchedField: field,
            mediaCount,
            lat: loc.gps_lat,
            lng: loc.gps_lng,
            distanceMeters: multiSignal.distanceMeters !== undefined ? Math.round(multiSignal.distanceMeters) : undefined,
            sharedTokens: multiSignal.nameMatch.sharedTokens,
            confidenceTier: multiSignal.tier,
            confidenceScore: multiSignal.totalScore,
            requiresUserReview: multiSignal.nameMatch.requiresUserReview || inputHasUncertainty,
            isGenericNameMatch: isGenericMatch,
          };
        }
      }
    }

    return bestMatch;
  }

  /**
   * Get count of media files associated with a location
   */
  private async getMediaCount(locationId: string): Promise<number> {
    // Count images
    const imageCount = await this.db
      .selectFrom('imgs')
      .select((eb) => eb.fn.count('imghash').as('count'))
      .where('locid', '=', locationId)
      .executeTakeFirst();

    // Count videos
    const videoCount = await this.db
      .selectFrom('vids')
      .select((eb) => eb.fn.count('vidhash').as('count'))
      .where('locid', '=', locationId)
      .executeTakeFirst();

    // Count documents
    const docCount = await this.db
      .selectFrom('docs')
      .select((eb) => eb.fn.count('dochash').as('count'))
      .where('locid', '=', locationId)
      .executeTakeFirst();

    return (
      Number(imageCount?.count || 0) +
      Number(videoCount?.count || 0) +
      Number(docCount?.count || 0)
    );
  }
}

export default LocationDuplicateService;
