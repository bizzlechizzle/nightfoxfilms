/**
 * FIX 6.5: Geocoding Cache Service
 * Provides a local database of geocoding results that builds over time
 * Alternative to a static US location database - grows as locations are geocoded
 *
 * Benefits:
 * - No external data files needed
 * - Learns your specific locations over time
 * - Reduces API calls to Nominatim
 * - Provides offline geocoding for known locations
 */
import { Kysely, sql } from 'kysely';
import type { Database } from '../main/database.types';
import { generateId } from '../main/ipc-validation';

export interface GeocodeCacheEntry {
  id: string;
  query_type: 'forward' | 'reverse';
  query_key: string; // normalized query for deduplication
  query_text: string; // original query
  lat: number | null;
  lng: number | null;
  street: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zipcode: string | null;
  country: string | null;
  display_name: string | null;
  confidence: 'high' | 'medium' | 'low';
  hit_count: number;
  created_at: string;
  last_used_at: string;
}

export class GeocodingCache {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * ADV-001/ADV-004: Escape LIKE pattern special characters
   * Prevents SQL injection and unexpected wildcard matching
   */
  private escapeLikePattern(value: string): string {
    // Escape LIKE wildcards: % and _
    // Also escape the escape character itself if we use one
    return value.replace(/[%_\\]/g, '\\$&');
  }

  /**
   * Generate a normalized cache key for deduplication
   */
  private generateCacheKey(queryType: 'forward' | 'reverse', query: string | { lat: number; lng: number }): string {
    if (queryType === 'forward') {
      // Normalize: lowercase, collapse whitespace, remove punctuation
      return (query as string).toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    } else {
      const coords = query as { lat: number; lng: number };
      // Round to 5 decimal places (~1 meter precision)
      return `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`;
    }
  }

  /**
   * Look up cached geocoding result
   */
  async lookup(queryType: 'forward' | 'reverse', query: string | { lat: number; lng: number }): Promise<GeocodeCacheEntry | null> {
    const cacheKey = this.generateCacheKey(queryType, query);

    const result = await this.db
      .selectFrom('geocode_cache' as any)
      .selectAll()
      .where('query_type', '=', queryType)
      .where('query_key', '=', cacheKey)
      .executeTakeFirst();

    if (result) {
      // Update hit count and last used timestamp
      await this.db
        .updateTable('geocode_cache' as any)
        .set({
          hit_count: (result as any).hit_count + 1,
          last_used_at: new Date().toISOString(),
        })
        .where('id', '=', (result as any).id)
        .execute();

      return result as GeocodeCacheEntry;
    }

    return null;
  }

  /**
   * Store a geocoding result in the cache
   */
  async store(entry: Omit<GeocodeCacheEntry, 'id' | 'hit_count' | 'created_at' | 'last_used_at'>): Promise<void> {
    const id = generateId();
    const now = new Date().toISOString();

    try {
      await this.db
        .insertInto('geocode_cache' as any)
        .values({
          id,
          ...entry,
          hit_count: 1,
          created_at: now,
          last_used_at: now,
        })
        .onConflict((oc) => oc
          .columns(['query_type', 'query_key'] as any)
          .doUpdateSet({
            hit_count: sql`hit_count + 1` as any,
            last_used_at: now,
          } as any)
        )
        .execute();
    } catch (error) {
      // If table doesn't exist, create it
      await this.ensureTable();
      // Retry the insert
      await this.db
        .insertInto('geocode_cache' as any)
        .values({
          id,
          ...entry,
          hit_count: 1,
          created_at: now,
          last_used_at: now,
        })
        .execute();
    }
  }

  /**
   * Search the cache for matching locations
   * Useful for autocomplete and location suggestions
   * ADV-001: Uses escaped LIKE pattern to prevent injection
   */
  async search(query: string, limit: number = 10): Promise<GeocodeCacheEntry[]> {
    const normalized = query.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    // ADV-001: Escape LIKE wildcards before building pattern
    const escapedPattern = this.escapeLikePattern(normalized);

    const results = await this.db
      .selectFrom('geocode_cache' as any)
      .selectAll()
      .where('query_key', 'like', `%${escapedPattern}%`)
      .orderBy('hit_count', 'desc')
      .limit(limit)
      .execute();

    return results as GeocodeCacheEntry[];
  }

  /**
   * Find cached entries by city and state
   * ADV-004: Uses escaped LIKE pattern to prevent wildcard injection
   */
  async findByLocation(city?: string, state?: string): Promise<GeocodeCacheEntry[]> {
    let query = this.db.selectFrom('geocode_cache' as any).selectAll();

    if (city) {
      // ADV-004: Escape LIKE wildcards in city parameter
      const escapedCity = this.escapeLikePattern(city);
      query = query.where('city', 'like', `%${escapedCity}%`);
    }
    if (state) {
      query = query.where('state', '=', state.toUpperCase());
    }

    return await query.orderBy('hit_count', 'desc').limit(20).execute() as GeocodeCacheEntry[];
  }

  /**
   * Get statistics about the cache
   */
  async getStats(): Promise<{
    totalEntries: number;
    forwardEntries: number;
    reverseEntries: number;
    totalHits: number;
    uniqueStates: number;
    uniqueCities: number;
  }> {
    const countResult = await this.db
      .selectFrom('geocode_cache' as any)
      .select(this.db.fn.count<number>('id').as('count'))
      .executeTakeFirst();

    const forwardResult = await this.db
      .selectFrom('geocode_cache' as any)
      .select(this.db.fn.count<number>('id').as('count'))
      .where('query_type', '=', 'forward')
      .executeTakeFirst();

    const reverseResult = await this.db
      .selectFrom('geocode_cache' as any)
      .select(this.db.fn.count<number>('id').as('count'))
      .where('query_type', '=', 'reverse')
      .executeTakeFirst();

    const hitsResult = await this.db
      .selectFrom('geocode_cache' as any)
      .select(this.db.fn.sum<number>('hit_count' as any).as('total'))
      .executeTakeFirst();

    const statesResult = await this.db
      .selectFrom('geocode_cache' as any)
      .select(this.db.fn.count<number>('state' as any).distinct().as('count'))
      .where('state', 'is not', null)
      .executeTakeFirst();

    const citiesResult = await this.db
      .selectFrom('geocode_cache' as any)
      .select(this.db.fn.count<number>('city' as any).distinct().as('count'))
      .where('city', 'is not', null)
      .executeTakeFirst();

    return {
      totalEntries: Number(countResult?.count || 0),
      forwardEntries: Number(forwardResult?.count || 0),
      reverseEntries: Number(reverseResult?.count || 0),
      totalHits: Number(hitsResult?.total || 0),
      uniqueStates: Number(statesResult?.count || 0),
      uniqueCities: Number(citiesResult?.count || 0),
    };
  }

  /**
   * Ensure the cache table exists
   */
  async ensureTable(): Promise<void> {
    await this.db.schema
      .createTable('geocode_cache')
      .ifNotExists()
      .addColumn('id', 'text', col => col.primaryKey())
      .addColumn('query_type', 'text', col => col.notNull())
      .addColumn('query_key', 'text', col => col.notNull())
      .addColumn('query_text', 'text')
      .addColumn('lat', 'real')
      .addColumn('lng', 'real')
      .addColumn('street', 'text')
      .addColumn('city', 'text')
      .addColumn('county', 'text')
      .addColumn('state', 'text')
      .addColumn('zipcode', 'text')
      .addColumn('country', 'text')
      .addColumn('display_name', 'text')
      .addColumn('confidence', 'text')
      .addColumn('hit_count', 'integer', col => col.defaultTo(1))
      .addColumn('created_at', 'text')
      .addColumn('last_used_at', 'text')
      .execute();

    // Create unique index on query_type + query_key
    await this.db.schema
      .createIndex('idx_geocode_cache_query')
      .ifNotExists()
      .on('geocode_cache')
      .columns(['query_type', 'query_key'])
      .unique()
      .execute();

    // Create index for search by city/state
    await this.db.schema
      .createIndex('idx_geocode_cache_location')
      .ifNotExists()
      .on('geocode_cache')
      .columns(['city', 'state'])
      .execute();
  }

  /**
   * Clean up old, unused cache entries
   */
  async cleanup(maxAgeDays: number = 365, minHits: number = 0): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    const result = await this.db
      .deleteFrom('geocode_cache' as any)
      .where('last_used_at', '<', cutoffDate.toISOString())
      .where('hit_count', '<=', minHits)
      .execute();

    return result.length;
  }
}

// Singleton instance
let cacheInstance: GeocodingCache | null = null;

export function getGeocodingCache(db: Kysely<Database>): GeocodingCache {
  if (!cacheInstance) {
    cacheInstance = new GeocodingCache(db);
  }
  return cacheInstance;
}
