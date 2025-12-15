/**
 * Geocoding Service - Nominatim API with SQLite caching
 * Per claude.md spec: NGS (No Google Services) - Use Nominatim for geocoding
 *
 * Rate limiting: Nominatim allows 1 request/second max
 * Caching: Store results in SQLite to avoid repeat lookups
 *
 * Address Normalization: All geocoded addresses are normalized through AddressNormalizer
 * to ensure consistent storage format (2-letter state codes, proper zipcode format, etc.)
 */

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../main/database.types';
import { AddressNormalizer } from './address-normalizer';

export interface GeocodingResult {
  lat: number;
  lng: number;
  displayName: string;
  address: {
    street?: string;
    houseNumber?: string;
    city?: string;
    county?: string;
    state?: string;
    stateCode?: string;
    zipcode?: string;
    country?: string;
    countryCode?: string;
  };
  confidence: 'high' | 'medium' | 'low';
  source: 'nominatim' | 'cache';
  cachedAt?: string;
}

interface NominatimResponse {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address: {
    house_number?: string;
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    county?: string;
    state?: string;
    'ISO3166-2-lvl4'?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
  boundingbox: string[];
}

// Rate limiter - enforce 1 request per second
let lastRequestTime = 0;
const RATE_LIMIT_MS = 1100; // 1.1 seconds to be safe

async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    const waitTime = RATE_LIMIT_MS - timeSinceLastRequest;
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  lastRequestTime = Date.now();
}

export class GeocodingService {
  private readonly USER_AGENT = 'AUArchiveDesktopApp/1.0 (https://github.com/abandonedupstate)';
  private readonly NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Initialize the geocoding cache table if it doesn't exist
   */
  async initCache(): Promise<void> {
    // Create cache table using raw SQL since it's not in the main schema
    await sql`
      CREATE TABLE IF NOT EXISTS geocode_cache (
        cache_key TEXT PRIMARY KEY,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        display_name TEXT NOT NULL,
        address_json TEXT NOT NULL,
        confidence TEXT NOT NULL,
        cached_at TEXT NOT NULL
      )
    `.execute(this.db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_geocode_cache_coords ON geocode_cache(lat, lng)
    `.execute(this.db);
  }

  /**
   * Generate cache key for reverse geocoding (round to ~11m precision)
   */
  private getCacheKey(lat: number, lng: number): string {
    // Round to 4 decimal places (~11m precision) for cache hits
    const roundedLat = Math.round(lat * 10000) / 10000;
    const roundedLng = Math.round(lng * 10000) / 10000;
    return `${roundedLat},${roundedLng}`;
  }

  /**
   * Check cache for existing result
   */
  private async checkCache(lat: number, lng: number): Promise<GeocodingResult | null> {
    const cacheKey = this.getCacheKey(lat, lng);

    try {
      const result = await sql<{
        cache_key: string;
        lat: number;
        lng: number;
        display_name: string;
        address_json: string;
        confidence: string;
        cached_at: string;
      }>`SELECT * FROM geocode_cache WHERE cache_key = ${cacheKey}`.execute(this.db);

      const cached = result.rows[0];
      if (cached) {
        const address = JSON.parse(cached.address_json);
        return {
          lat: cached.lat,
          lng: cached.lng,
          displayName: cached.display_name,
          address,
          confidence: cached.confidence as 'high' | 'medium' | 'low',
          source: 'cache',
          cachedAt: cached.cached_at,
        };
      }
    } catch (error) {
      // Cache miss or table doesn't exist yet
      console.warn('Geocode cache check failed:', error);
    }

    return null;
  }

  /**
   * Store result in cache
   */
  private async storeInCache(
    lat: number,
    lng: number,
    result: GeocodingResult
  ): Promise<void> {
    const cacheKey = this.getCacheKey(lat, lng);
    const addressJson = JSON.stringify(result.address);
    const cachedAt = new Date().toISOString();

    try {
      await sql`
        INSERT OR IGNORE INTO geocode_cache (cache_key, lat, lng, display_name, address_json, confidence, cached_at)
        VALUES (${cacheKey}, ${result.lat}, ${result.lng}, ${result.displayName}, ${addressJson}, ${result.confidence}, ${cachedAt})
      `.execute(this.db);
    } catch (error) {
      console.warn('Failed to cache geocode result:', error);
    }
  }

  /**
   * Reverse geocode: GPS coordinates -> address
   * This is the primary use case for map-click location creation
   */
  async reverseGeocode(lat: number, lng: number): Promise<GeocodingResult | null> {
    // Check cache first
    const cached = await this.checkCache(lat, lng);
    if (cached) {
      console.log('Geocode cache hit for', lat, lng);
      return cached;
    }

    // Enforce rate limit before API call
    await enforceRateLimit();

    try {
      const url = new URL(`${this.NOMINATIM_BASE}/reverse`);
      url.searchParams.set('format', 'json');
      url.searchParams.set('lat', lat.toString());
      url.searchParams.set('lon', lng.toString());
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('zoom', '18'); // Building-level detail

      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': this.USER_AGENT,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        console.error('Nominatim API error:', response.status, response.statusText);
        return null;
      }

      const data: NominatimResponse = await response.json();

      if (!data || !data.address) {
        return null;
      }

      // Parse Nominatim response into our format
      const result = this.parseNominatimResponse(data);

      // Store in cache
      await this.storeInCache(lat, lng, result);

      return result;
    } catch (error) {
      console.error('Reverse geocoding failed:', error);
      return null;
    }
  }

  /**
   * Forward geocode: address string -> GPS coordinates
   * Useful for searching locations by address
   */
  async forwardGeocode(address: string): Promise<GeocodingResult | null> {
    // Enforce rate limit before API call
    await enforceRateLimit();

    try {
      const url = new URL(`${this.NOMINATIM_BASE}/search`);
      url.searchParams.set('format', 'json');
      url.searchParams.set('q', address);
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('limit', '1');
      url.searchParams.set('countrycodes', 'us'); // Limit to US per NGS principle

      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': this.USER_AGENT,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        console.error('Nominatim API error:', response.status, response.statusText);
        return null;
      }

      const results: NominatimResponse[] = await response.json();

      if (!results || results.length === 0) {
        return null;
      }

      return this.parseNominatimResponse(results[0]);
    } catch (error) {
      console.error('Forward geocoding failed:', error);
      return null;
    }
  }

  /**
   * Parse Nominatim API response into our GeocodingResult format
   * Uses AddressNormalizer to ensure consistent address formatting
   */
  private parseNominatimResponse(data: NominatimResponse): GeocodingResult {
    const addr = data.address;

    // Determine city - Nominatim uses different fields
    const city =
      addr.city || addr.town || addr.village || addr.hamlet || addr.suburb || undefined;

    // Parse state code from ISO3166-2-lvl4 (e.g., "US-NY" -> "NY")
    let rawStateCode = addr['ISO3166-2-lvl4'];
    if (rawStateCode && rawStateCode.startsWith('US-')) {
      rawStateCode = rawStateCode.substring(3);
    }

    // Determine confidence based on precision
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    if (addr.house_number || addr.road) {
      confidence = 'high';
    } else if (city) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    // Use AddressNormalizer to ensure consistent formatting
    // This handles: state name -> 2-letter code, zipcode format, whitespace, case
    const normalizedAddress = AddressNormalizer.normalizeAddress(
      {
        street: addr.road,
        houseNumber: addr.house_number,
        city,
        county: addr.county,
        state: addr.state,
        stateCode: rawStateCode,
        zipcode: addr.postcode,
        country: addr.country,
        countryCode: addr.country_code,
      },
      confidence
    );

    return {
      lat: parseFloat(data.lat),
      lng: parseFloat(data.lon),
      displayName: data.display_name,
      address: {
        street: normalizedAddress.street || undefined,
        houseNumber: addr.house_number,
        city: normalizedAddress.city || undefined,
        county: normalizedAddress.county || undefined,
        state: addr.state, // Keep full state name for display
        stateCode: normalizedAddress.state || undefined, // Normalized 2-letter code
        zipcode: normalizedAddress.zipcode || undefined,
        country: addr.country,
        countryCode: addr.country_code?.toUpperCase(),
      },
      confidence,
      source: 'nominatim',
    };
  }

  /**
   * Clear old cache entries (optional maintenance)
   */
  async clearOldCache(daysOld: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffStr = cutoffDate.toISOString();

    try {
      const result = await sql`
        DELETE FROM geocode_cache WHERE cached_at < ${cutoffStr}
      `.execute(this.db);

      return Number(result.numAffectedRows || 0);
    } catch (error) {
      console.error('Failed to clear geocode cache:', error);
      return 0;
    }
  }
}
