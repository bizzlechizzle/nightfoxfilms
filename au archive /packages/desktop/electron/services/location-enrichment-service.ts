/**
 * LocationEnrichmentService
 *
 * Centralized service for enriching locations with GPS, address, and region data.
 * This is THE canonical way to add GPS from external sources (reference maps, media EXIF, etc.)
 *
 * Pipeline:
 * 1. Reverse geocode GPS → address (street, city, county, state, zipcode)
 * 2. Calculate region fields (census, direction, cultural regions)
 * 3. Update location with all fields atomically
 *
 * Why this exists:
 * Previously, enrichment logic was duplicated across 4+ handlers. When a new handler
 * was added, developers had to remember to include geocoding + region calculation.
 * This led to bugs where handlers only updated GPS without the full pipeline.
 *
 * Now: All enrichment goes through this service. Fix once, fixed everywhere.
 *
 * @see docs/decisions/PLAN-location-enrichment-service.md
 */

import type { Kysely } from 'kysely';
import type { Database } from '../main/database.types';
import { GeocodingService } from './geocoding-service';
import { calculateRegionFields } from './region-service';
import { AddressNormalizer } from './address-normalizer';

/**
 * GPS source types for tracking provenance
 */
export type GPSSource =
  | 'ref_map_import'    // From reference map batch import
  | 'ref_map_point'     // From individual ref point match
  | 'media_gps'         // From photo/video EXIF
  | 'user_map_click'    // User verified on map
  | 'manual';           // Manually entered coordinates

/**
 * Input for GPS enrichment
 */
export interface EnrichmentInput {
  /** Latitude in decimal degrees */
  lat: number;
  /** Longitude in decimal degrees */
  lng: number;
  /** Source of GPS data (for provenance tracking) */
  source: GPSSource;
  /** State hint from ref point (fallback if geocode fails) */
  stateHint?: string | null;
  /** Skip reverse geocoding (e.g., if already have address) */
  skipGeocode?: boolean;
  /** Skip region calculation */
  skipRegions?: boolean;
}

/**
 * Address data returned from enrichment
 */
export interface EnrichedAddress {
  street: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zipcode: string | null;
}

/**
 * Region data returned from enrichment
 */
export interface EnrichedRegions {
  censusRegion: string | null;
  censusDivision: string | null;
  stateDirection: string | null;
  culturalRegion: string | null;
  countryCulturalRegion: string | null;
}

/**
 * Result of enrichment operation
 */
export interface EnrichmentResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** What was actually updated */
  updated: {
    gps: boolean;
    address: boolean;
    regions: boolean;
  };
  /** Address data if geocoded */
  address?: EnrichedAddress;
  /** Region data if calculated */
  regions?: EnrichedRegions;
  /** Error message if failed */
  error?: string;
}

/**
 * LocationEnrichmentService
 *
 * Single source of truth for enriching locations from GPS coordinates.
 * Use this service instead of directly updating GPS fields.
 */
export class LocationEnrichmentService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly geocodingService: GeocodingService
  ) {}

  /**
   * Enrich a location from GPS coordinates.
   *
   * This is THE canonical method for adding GPS + address + region data to a location.
   * All handlers that apply GPS from external sources should use this method.
   *
   * Pipeline:
   * 1. Validate input coordinates
   * 2. Reverse geocode GPS → address (unless skipGeocode)
   * 3. Calculate region fields from state/county/GPS (unless skipRegions)
   * 4. Update location with all fields atomically
   *
   * Error handling:
   * - Geocoding failure: Logs warning, continues with GPS + regions from stateHint
   * - Region calc failure: Logs warning, continues with GPS + address only
   * - Database failure: Returns error result
   *
   * @param locid - Location ID (BLAKE3 16-char hex) to enrich
   * @param input - GPS coordinates and options
   * @returns What was updated
   *
   * @example
   * // Basic usage - apply GPS from reference map
   * const result = await enrichmentService.enrichFromGPS(locid, {
   *   lat: 42.6526,
   *   lng: -73.7562,
   *   source: 'ref_map_import',
   * });
   *
   * @example
   * // With state hint fallback
   * const result = await enrichmentService.enrichFromGPS(locid, {
   *   lat: 42.6526,
   *   lng: -73.7562,
   *   source: 'ref_map_point',
   *   stateHint: 'NY',  // Used for region calc if geocode fails
   * });
   */
  async enrichFromGPS(locid: string, input: EnrichmentInput): Promise<EnrichmentResult> {
    const { lat, lng, source, stateHint, skipGeocode, skipRegions } = input;

    // Validate coordinates
    if (typeof lat !== 'number' || lat < -90 || lat > 90) {
      return { success: false, updated: { gps: false, address: false, regions: false }, error: 'Invalid latitude' };
    }
    if (typeof lng !== 'number' || lng < -180 || lng > 180) {
      return { success: false, updated: { gps: false, address: false, regions: false }, error: 'Invalid longitude' };
    }

    // Track what we're updating
    let addressData: EnrichedAddress | undefined;
    let regionData: EnrichedRegions | undefined;
    let addressUpdated = false;
    let regionsUpdated = false;

    // Step 1: Reverse geocode GPS → address
    if (!skipGeocode) {
      try {
        const geocodeResult = await this.geocodingService.reverseGeocode(lat, lng);
        if (geocodeResult?.address) {
          // Use stateCode (2-letter), NOT state (full name)
          // GeocodingService already normalizes these values
          addressData = {
            street: geocodeResult.address.street || null,
            city: geocodeResult.address.city || null,
            county: geocodeResult.address.county || null,
            state: geocodeResult.address.stateCode || null,
            zipcode: geocodeResult.address.zipcode || null,
          };
          console.log(`[LocationEnrichment] Geocoded: ${addressData.city}, ${addressData.state}`);
        }
      } catch (geoError) {
        // Non-fatal: log and continue with GPS + region calc from stateHint
        console.warn(`[LocationEnrichment] Reverse geocoding failed for ${lat},${lng}:`, geoError);
      }
    }

    // Step 2: Calculate region fields
    if (!skipRegions) {
      try {
        // Use geocoded state, or normalize stateHint as fallback
        const stateForRegion = addressData?.state || AddressNormalizer.normalizeStateCode(stateHint) || null;
        const countyForRegion = addressData?.county || null;

        const regionFields = calculateRegionFields({
          state: stateForRegion,
          county: countyForRegion,
          lat,
          lng,
        });

        regionData = {
          censusRegion: regionFields.censusRegion,
          censusDivision: regionFields.censusDivision,
          stateDirection: regionFields.stateDirection,
          culturalRegion: regionFields.culturalRegion,
          countryCulturalRegion: regionFields.countryCulturalRegion,
        };

        // HEALTH CHECK: Warn if GPS is being applied but no regions could be calculated
        // This catches the silent failure case where geocoding fails AND no valid stateHint
        const hasAnyRegion = regionData.censusRegion || regionData.stateDirection || regionData.culturalRegion;
        if (!hasAnyRegion) {
          console.warn(
            `[LocationEnrichment] ⚠️ HEALTH CHECK FAIL: GPS applied but NO REGIONS for ${locid}. ` +
            `stateForRegion=${stateForRegion}, stateHint=${stateHint}, geocodedState=${addressData?.state}. ` +
            `This location will have GPS but empty region fields!`
          );
        } else {
          console.log(`[LocationEnrichment] Regions: ${regionData.censusRegion}, ${regionData.stateDirection}`);
        }
      } catch (regionError) {
        // Non-fatal: log and continue with GPS + address only
        console.warn(`[LocationEnrichment] Region calculation failed:`, regionError);
      }
    }

    // Step 3: Build update object
    // Validate state is exactly 2 chars before including (database CHECK constraint)
    const validState = addressData?.state && addressData.state.length === 2 ? addressData.state : null;
    if (addressData?.state && addressData.state.length !== 2) {
      console.warn(`[LocationEnrichment] Invalid state "${addressData.state}", skipping state field`);
    }

    const updateFields: Record<string, unknown> = {
      // GPS fields (always set)
      gps_lat: lat,
      gps_lng: lng,
      gps_source: source,
      gps_verified_on_map: source === 'user_map_click' ? 1 : 0,
      gps_accuracy: null,
      gps_captured_at: new Date().toISOString(),
    };

    // Address fields (only if we got valid geocode data)
    if (addressData) {
      if (addressData.street) updateFields.address_street = addressData.street;
      if (addressData.city) updateFields.address_city = addressData.city;
      if (addressData.county) updateFields.address_county = addressData.county;
      if (validState) updateFields.address_state = validState;
      if (addressData.zipcode) updateFields.address_zipcode = addressData.zipcode;
      addressUpdated = true;
    }

    // Region fields (only if we calculated them AND they have actual values)
    if (regionData) {
      if (regionData.censusRegion) {
        updateFields.census_region = regionData.censusRegion;
        regionsUpdated = true;
      }
      if (regionData.censusDivision) {
        updateFields.census_division = regionData.censusDivision;
        regionsUpdated = true;
      }
      if (regionData.stateDirection) {
        updateFields.state_direction = regionData.stateDirection;
        regionsUpdated = true;
      }
      if (regionData.culturalRegion) {
        updateFields.cultural_region = regionData.culturalRegion;
        regionsUpdated = true;
      }
      if (regionData.countryCulturalRegion) {
        updateFields.country_cultural_region = regionData.countryCulturalRegion;
        regionsUpdated = true;
      }
    }

    // Step 4: Update location
    try {
      await this.db
        .updateTable('locs')
        .set(updateFields)
        .where('locid', '=', locid)
        .execute();

      console.log(`[LocationEnrichment] Enriched location ${locid}: GPS=${source}, address=${addressUpdated}, regions=${regionsUpdated}`);

      return {
        success: true,
        updated: {
          gps: true,
          address: addressUpdated,
          regions: regionsUpdated,
        },
        address: addressData,
        regions: regionData,
      };
    } catch (dbError) {
      console.error(`[LocationEnrichment] Database update failed for ${locid}:`, dbError);
      return {
        success: false,
        updated: { gps: false, address: false, regions: false },
        error: dbError instanceof Error ? dbError.message : 'Database update failed',
      };
    }
  }

  /**
   * Batch enrich multiple locations from GPS coordinates.
   *
   * Processes each location sequentially to avoid overwhelming the geocoding service.
   * Returns summary of what was updated.
   *
   * @param enrichments - Array of location IDs and GPS data
   * @returns Summary of batch operation
   */
  async enrichBatch(
    enrichments: Array<{ locid: string; input: EnrichmentInput }>
  ): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{ locid: string; result: EnrichmentResult }>;
  }> {
    const results: Array<{ locid: string; result: EnrichmentResult }> = [];
    let succeeded = 0;
    let failed = 0;

    for (const { locid, input } of enrichments) {
      const result = await this.enrichFromGPS(locid, input);
      results.push({ locid, result });
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    console.log(`[LocationEnrichment] Batch complete: ${succeeded}/${enrichments.length} succeeded`);

    return {
      total: enrichments.length,
      succeeded,
      failed,
      results,
    };
  }
}

/**
 * Factory function to create a LocationEnrichmentService instance.
 * Follows the pattern used by other services in this codebase.
 */
export function createLocationEnrichmentService(
  db: Kysely<Database>,
  geocodingService: GeocodingService
): LocationEnrichmentService {
  return new LocationEnrichmentService(db, geocodingService);
}
