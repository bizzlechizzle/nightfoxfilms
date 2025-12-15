/**
 * Reference Map Matcher Service
 *
 * Matches user-entered location names against imported reference map points
 * using Token Set Ratio + Jaro-Winkler for word-order independent matching.
 *
 * Key improvement: Uses Token Set Ratio to match names like:
 * - "Union Station - Lockport" ↔ "Lockport Union Train Station" (100% match)
 * - Word order doesn't matter, shared tokens are weighted highly
 *
 * Used during location creation to suggest GPS coordinates from reference data.
 */

import { Kysely } from 'kysely';
import type { Database } from '../main/database.types';
import { normalizeName } from './jaro-winkler-service';
import {
  calculateNameMatch,
  hasBlockingConflict,
  isGenericName,
  shouldExcludeFromSuggestions,
  type NameMatchResult,
} from './token-set-service';
import { DUPLICATE_CONFIG } from '../../src/lib/constants';

/**
 * A matched reference map point with similarity score
 */
export interface RefMapMatch {
  pointId: string;
  mapId: string;
  name: string;
  description: string | null;
  lat: number;
  lng: number;
  state: string | null;
  category: string | null;
  mapName: string;
  /** Combined score (max of Jaro-Winkler and Token Set Ratio) */
  score: number;
  /** Alternate known names for this location (pipe-separated) */
  akaNames: string | null;
  /** Tokens shared between query and match name */
  sharedTokens?: string[];
  /** Jaro-Winkler score component */
  jaroWinklerScore?: number;
  /** Token Set Ratio score component */
  tokenSetScore?: number;
  /** Whether this is a generic name (House, Church, etc.) */
  isGenericName?: boolean;
}

/**
 * Options for finding matches
 */
export interface MatchOptions {
  /** Minimum similarity score (default from DUPLICATE_CONFIG) */
  threshold?: number;
  /** Maximum number of results (default 3) */
  limit?: number;
  /** Filter by state (optimization) */
  state?: string | null;
  /** Minimum query length to search (default 3) */
  minQueryLength?: number;
}

const DEFAULT_OPTIONS: Required<MatchOptions> = {
  threshold: DUPLICATE_CONFIG.NAME_SIMILARITY_THRESHOLD,
  limit: 3,
  state: null,
  minQueryLength: 3,
};

/**
 * Reference Map Matcher Service
 *
 * Finds potential matches for location names in imported reference maps.
 */
export class RefMapMatcherService {
  private db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.db = db;
  }

  /**
   * Find reference map points that match a location name
   *
   * @param query - The location name to match
   * @param options - Match options (threshold, limit, state filter)
   * @returns Array of matches sorted by score descending
   */
  async findMatches(
    query: string,
    options: MatchOptions = {}
  ): Promise<RefMapMatch[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Validate query
    const normalizedQuery = (query || '').trim();
    if (normalizedQuery.length < opts.minQueryLength) {
      return [];
    }

    try {
      // Build query - join with ref_maps to get map name, include aka_names
      let pointsQuery = this.db
        .selectFrom('ref_map_points')
        .innerJoin('ref_maps', 'ref_maps.map_id', 'ref_map_points.map_id')
        .select([
          'ref_map_points.point_id',
          'ref_map_points.map_id',
          'ref_map_points.name',
          'ref_map_points.description',
          'ref_map_points.lat',
          'ref_map_points.lng',
          'ref_map_points.state',
          'ref_map_points.category',
          'ref_map_points.aka_names',
          'ref_maps.map_name',
        ])
        .where('ref_map_points.name', 'is not', null);

      // Filter by state if provided (optimization for large datasets)
      // Match points that either have the same state OR have no state set
      // Case-insensitive comparison for flexibility
      if (opts.state) {
        const normalizedState = opts.state.toUpperCase();
        pointsQuery = pointsQuery.where(eb =>
          eb.or([
            eb('ref_map_points.state', '=', normalizedState),
            eb('ref_map_points.state', 'is', null),
          ])
        );
      }

      const points = await pointsQuery.execute();

      if (points.length === 0) {
        return [];
      }

      // Calculate similarity scores using Token Set Ratio + Jaro-Winkler
      // This enables word-order independent matching:
      // "Union Station - Lockport" matches "Lockport Union Train Station"
      const matches: RefMapMatch[] = [];

      for (const point of points) {
        if (!point.name) continue;

        // Skip non-descriptive placeholder names from suggestions
        // Filters: "House", "Buffalo Church", "House - CNY", "Point 155", etc.
        if (shouldExcludeFromSuggestions(point.name)) continue;

        // Use Token Set Ratio (includes Jaro-Winkler) for comprehensive matching
        // This is the key fix: TSR handles word reordering that JW misses
        const nameMatch = calculateNameMatch(normalizedQuery, point.name);

        // Skip blocked matches (e.g., "North Factory" vs "South Factory")
        if (nameMatch.blocked) {
          continue;
        }

        // Also check against aka_names for additional matches
        let bestMatch = nameMatch;
        if (point.aka_names) {
          const akaList = point.aka_names.split(' | ');
          for (const aka of akaList) {
            const akaMatch = calculateNameMatch(normalizedQuery, aka.trim());
            if (!akaMatch.blocked && akaMatch.score > bestMatch.score) {
              bestMatch = akaMatch;
            }
          }
        }

        // Check threshold with the best match found
        if (bestMatch.score >= opts.threshold) {
          matches.push({
            pointId: point.point_id,
            mapId: point.map_id,
            name: point.name,
            description: point.description,
            lat: point.lat,
            lng: point.lng,
            state: point.state,
            category: point.category,
            mapName: point.map_name,
            score: bestMatch.score,
            akaNames: point.aka_names,
            sharedTokens: bestMatch.sharedTokens,
            jaroWinklerScore: bestMatch.jaroWinkler,
            tokenSetScore: bestMatch.tokenSetRatio,
            isGenericName: isGenericName(point.name),
          });
        }
      }

      // Sort by score descending and limit results
      return matches
        .sort((a, b) => b.score - a.score)
        .slice(0, opts.limit);

    } catch (error) {
      console.error('[RefMapMatcher] Error finding matches:', error);
      return [];
    }
  }

  /**
   * Check if any matches exist for a query (faster than full match)
   *
   * @param query - The location name to check
   * @param options - Match options
   * @returns True if at least one match exists
   */
  async hasMatches(
    query: string,
    options: MatchOptions = {}
  ): Promise<boolean> {
    const matches = await this.findMatches(query, { ...options, limit: 1 });
    return matches.length > 0;
  }

  /**
   * Get the best single match for a query
   *
   * @param query - The location name to match
   * @param options - Match options
   * @returns The best match or null if none found
   */
  async getBestMatch(
    query: string,
    options: MatchOptions = {}
  ): Promise<RefMapMatch | null> {
    const matches = await this.findMatches(query, { ...options, limit: 1 });
    return matches.length > 0 ? matches[0] : null;
  }

  /**
   * Get statistics about reference map data
   */
  async getStats(): Promise<{
    totalPoints: number;
    pointsWithNames: number;
    uniqueStates: number;
  }> {
    try {
      const totalResult = await this.db
        .selectFrom('ref_map_points')
        .select(({ fn }) => fn.count<number>('point_id').as('count'))
        .executeTakeFirst();

      const namedResult = await this.db
        .selectFrom('ref_map_points')
        .select(({ fn }) => fn.count<number>('point_id').as('count'))
        .where('name', 'is not', null)
        .executeTakeFirst();

      const statesResult = await this.db
        .selectFrom('ref_map_points')
        .select('state')
        .distinct()
        .where('state', 'is not', null)
        .execute();

      return {
        totalPoints: totalResult?.count ?? 0,
        pointsWithNames: namedResult?.count ?? 0,
        uniqueStates: statesResult.length,
      };

    } catch (error) {
      console.error('[RefMapMatcher] Error getting stats:', error);
      return { totalPoints: 0, pointsWithNames: 0, uniqueStates: 0 };
    }
  }
}

/**
 * Create a RefMapMatcherService instance
 */
export function createRefMapMatcherService(db: Kysely<Database>): RefMapMatcherService {
  return new RefMapMatcherService(db);
}
