import { Kysely } from 'kysely';
import path from 'path';
import fs from 'fs/promises';
import type { Database, LocsTable } from '../main/database.types';
import {
  LocationRepository,
  LocationFilters,
  Location,
  LocationInput,
  LocationEntity
} from '@au-archive/core';
import { generateLocationId } from '../services/crypto-service';

/**
 * OPT-043: Lean location type for map display - only essential fields
 * Eliminates JSON.parse overhead and reduces data transfer by ~90%
 */
export interface MapLocation {
  locid: string;
  locnam: string;
  category?: string;
  gps_lat: number;
  gps_lng: number;
  gps_accuracy?: number;
  gps_source?: string;
  gps_verified_on_map: boolean;
  address_state?: string;
  address_city?: string;
  favorite: boolean;
}
import { AddressNormalizer } from '../services/address-normalizer';
// Kanye9: AddressService for libpostal-powered normalization
import { AddressService } from '../services/address-service';
// FIX 6.7: Import GPS validator for proximity search
import { GPSValidator } from '../services/gps-validator';
// DECISION-012: Region auto-population service
import { calculateRegionFields } from '../services/region-service';
// ADV-005: Import logger for deletion audit
import { getLogger } from '../services/logger-service';
// OPT-036: MediaPathService for thumbnail/preview path derivation
import { MediaPathService } from '../services/media-path-service';
// OPT-037: LocationEnrichmentService for auto-enrichment from GPS
import { LocationEnrichmentService, GPSSource } from '../services/location-enrichment-service';
import { GeocodingService } from '../services/geocoding-service';

export class SQLiteLocationRepository implements LocationRepository {
  // OPT-037: Lazy-initialized enrichment service to avoid circular dependencies
  private enrichmentService: LocationEnrichmentService | null = null;

  constructor(private readonly db: Kysely<Database>) {}

  /**
   * OPT-037: Get or create the enrichment service (lazy initialization)
   * This avoids circular dependencies at construction time.
   */
  private getEnrichmentService(): LocationEnrichmentService {
    if (!this.enrichmentService) {
      const geocodingService = new GeocodingService(this.db);
      this.enrichmentService = new LocationEnrichmentService(this.db, geocodingService);
    }
    return this.enrichmentService;
  }

  async create(input: LocationInput): Promise<Location> {
    // ADR-046: Use BLAKE3 16-char ID instead of UUID+loc12
    const locid = generateLocationId();
    const slocnam = input.slocnam || LocationEntity.generateShortName(input.locnam);
    const locadd = new Date().toISOString();

    // Kanye9: Process address through AddressService for raw + normalized storage
    let addressRecord = null;
    let normalizedStreet: string | null = null;
    let normalizedCity: string | null = null;
    let normalizedCounty: string | null = null;
    let normalizedState: string | null = null;
    let normalizedZipcode: string | null = null;

    if (input.address) {
      // Process structured address input
      addressRecord = AddressService.processStructured({
        street: input.address.street,
        houseNumber: null, // Not typically provided separately
        city: input.address.city,
        county: input.address.county,
        state: input.address.state,
        zipcode: input.address.zipcode,
      });

      normalizedStreet = addressRecord.normalized.street;
      normalizedCity = addressRecord.normalized.city;
      normalizedCounty = addressRecord.normalized.county || AddressNormalizer.normalizeCounty(input.address.county);
      normalizedState = addressRecord.normalized.state;
      normalizedZipcode = addressRecord.normalized.zipcode;
    }

    // DECISION-012: Auto-populate region fields from state/GPS/county
    const regionFields = calculateRegionFields({
      state: normalizedState,
      county: normalizedCounty,
      lat: input.gps?.lat,
      lng: input.gps?.lng,
    });

    // ADR-046: Removed loc12 and sub12 from insert - locid is the only ID now
    await this.db
      .insertInto('locs')
      .values({
        locid,
        locnam: input.locnam,
        slocnam,
        akanam: input.akanam || null,
        category: input.category || null,
        class: input.class || null,
        gps_lat: input.gps?.lat || null,
        gps_lng: input.gps?.lng || null,
        gps_accuracy: input.gps?.accuracy || null,
        gps_source: input.gps?.source || null,
        gps_verified_on_map: input.gps?.verifiedOnMap ? 1 : 0,
        gps_captured_at: input.gps?.capturedAt || null,
        gps_leaflet_data: input.gps?.leafletData ? JSON.stringify(input.gps.leafletData) : null,
        // Kanye9: Store geocode tier for accurate map zoom
        gps_geocode_tier: input.gps?.geocodeTier || null,
        gps_geocode_query: input.gps?.geocodeQuery || null,
        address_street: normalizedStreet,
        address_city: normalizedCity,
        address_county: normalizedCounty,
        address_state: normalizedState,
        address_zipcode: normalizedZipcode,
        address_confidence: input.address?.confidence || null,
        address_geocoded_at: input.address?.geocodedAt || null,
        // Kanye9: Store raw + normalized + parsed for premium archive
        address_raw: addressRecord?.raw || null,
        address_normalized: addressRecord ? AddressService.format(addressRecord.normalized) : null,
        address_parsed_json: addressRecord ? JSON.stringify(addressRecord.parsed) : null,
        address_source: addressRecord?.source || null,
        // DECISION-010: Verification flags (default to 0/false on create)
        address_verified: input.address?.verified ? 1 : 0,
        location_verified: 0,
        // P0: condition and status removed - use access only
        documentation: input.documentation || null,
        access: input.access || null,
        historic: input.historic ? 1 : 0,
        favorite: input.favorite ? 1 : 0,
        // DECISION-013: Information box fields
        built_year: input.builtYear || null,
        built_type: input.builtType || null,
        abandoned_year: input.abandonedYear || null,
        abandoned_type: input.abandonedType || null,
        project: input.project ? 1 : 0,
        doc_interior: input.docInterior ? 1 : 0,
        doc_exterior: input.docExterior ? 1 : 0,
        doc_drone: input.docDrone ? 1 : 0,
        doc_web_history: input.docWebHistory ? 1 : 0,
        doc_map_find: input.docMapFind ? 1 : 0,
        status_changed_at: input.statusChangedAt || null,
        // DECISION-019: Information Box overhaul fields (historicalName removed)
        locnam_verified: input.locnamVerified ? 1 : 0,
        historical_name_verified: 0,
        akanam_verified: input.akanamVerified ? 1 : 0,
        // Hero image defaults (Kanye6)
        hero_focal_x: 0.5,
        hero_focal_y: 0.5,
        // View tracking defaults (Migration 33)
        view_count: 0,
        // Media stats defaults
        img_count: 0,
        vid_count: 0,
        doc_count: 0,
        map_count: 0,
        total_size_bytes: 0,
        sublocs: null,
        is_host_only: input.isHostOnly ? 1 : 0,
        locadd,
        locup: null,
        auth_imp: input.auth_imp || null,
        regions: null,
        state: null,
        // DECISION-012: Census region fields (auto-populated)
        census_region: regionFields.censusRegion,
        census_division: regionFields.censusDivision,
        state_direction: regionFields.stateDirection,
        cultural_region: regionFields.culturalRegion,
        // DECISION-017: Country Cultural Region and geographic hierarchy
        country_cultural_region: regionFields.countryCulturalRegion,
        country_cultural_region_verified: 0,
        local_cultural_region_verified: 0,
        country: 'United States',
        continent: 'North America',
        // Migration 25: Activity tracking
        created_by_id: input.created_by_id || null,
        created_by: input.created_by || input.auth_imp || null,
        modified_by_id: input.created_by_id || null,
        modified_by: input.created_by || input.auth_imp || null,
        modified_at: locadd,
      })
      .execute();

    // OPT-037: Auto-enrich from GPS if coordinates were provided
    // This runs reverse geocoding to get address + region data
    if (input.gps?.lat != null && input.gps?.lng != null) {
      try {
        const enrichment = this.getEnrichmentService();
        // Map input source to GPSSource type, default to 'manual'
        const source: GPSSource = (input.gps.source as GPSSource) || 'manual';
        await enrichment.enrichFromGPS(locid, {
          lat: input.gps.lat,
          lng: input.gps.lng,
          source,
          stateHint: input.address?.state,
        });
        console.log(`[LocationRepository] Auto-enriched location ${locid} from GPS`);
      } catch (enrichError) {
        // Non-fatal: log and continue - location was created successfully
        console.warn(`[LocationRepository] Auto-enrichment failed for ${locid}:`, enrichError);
      }
    }

    const location = await this.findById(locid);
    if (!location) {
      throw new Error('Failed to create location');
    }
    return location;
  }

  async findById(id: string): Promise<Location | null> {
    const row = await this.db
      .selectFrom('locs')
      .selectAll()
      .where('locid', '=', id)
      .executeTakeFirst();

    if (!row) return null;

    return this.mapRowToLocation(row);
  }

  async findAll(filters?: LocationFilters): Promise<Location[]> {
    let query = this.db.selectFrom('locs').selectAll();

    if (filters?.state) {
      query = query.where('address_state', '=', filters.state);
    }

    if (filters?.category) {
      query = query.where('category', '=', filters.category);
    }

    if (filters?.hasGPS) {
      query = query.where('gps_lat', 'is not', null).where('gps_lng', 'is not', null);
    }

    if (filters?.search) {
      query = query.where((eb) =>
        eb.or([
          eb('locnam', 'like', `%${filters.search}%`),
          eb('akanam', 'like', `%${filters.search}%`)
        ])
      );
    }

    if (filters?.documented === false) {
      query = query.where('documentation', '=', 'No Visit / Keyboard Scout');
    }

    if (filters?.historic === true) {
      query = query.where('historic', '=', 1);
    }

    if (filters?.favorite === true) {
      query = query.where('favorite', '=', 1);
    }

    // DECISION-013: New filters
    if (filters?.project === true) {
      query = query.where('project', '=', 1);
    }

    if (filters?.county) {
      query = query.where('address_county', '=', filters.county);
    }

    if (filters?.class) {
      query = query.where('class', '=', filters.class);
    }

    if (filters?.access) {
      query = query.where('access', '=', filters.access);
    }

    // OPT-036: Census region filters (database-side for performance)
    const filtersAny = filters as any;
    if (filtersAny?.censusRegion) {
      query = query.where('census_region', '=', filtersAny.censusRegion);
    }
    if (filtersAny?.censusDivision) {
      query = query.where('census_division', '=', filtersAny.censusDivision);
    }
    if (filtersAny?.culturalRegion) {
      query = query.where('cultural_region', '=', filtersAny.culturalRegion);
    }
    if (filtersAny?.city) {
      query = query.where('address_city', '=', filtersAny.city);
    }

    query = query.orderBy('locadd', 'desc');

    // OPT-036: Pagination support
    if (filtersAny?.limit) {
      query = query.limit(filtersAny.limit);
    }
    if (filtersAny?.offset) {
      query = query.offset(filtersAny.offset);
    }

    const rows = await query.execute();
    return rows.map((row) => this.mapRowToLocation(row));
  }

  /**
   * OPT-036: Get filter options using efficient SELECT DISTINCT queries
   * Returns all unique values for filter dropdowns in a single call
   */
  async getFilterOptions(): Promise<{
    states: string[];
    categories: string[];
    classes: string[];
    cities: string[];
    counties: string[];
    censusRegions: string[];
    censusDivisions: string[];
    culturalRegions: string[];
  }> {
    // Run all SELECT DISTINCT queries in parallel for maximum performance
    const [
      statesResult,
      categoriesResult,
      classesResult,
      citiesResult,
      countiesResult,
      censusRegionsResult,
      censusDivisionsResult,
      culturalRegionsResult,
    ] = await Promise.all([
      this.db.selectFrom('locs').select('address_state').distinct().where('address_state', 'is not', null).orderBy('address_state').execute(),
      this.db.selectFrom('locs').select('category').distinct().where('category', 'is not', null).orderBy('category').execute(),
      this.db.selectFrom('locs').select('class').distinct().where('class', 'is not', null).orderBy('class').execute(),
      this.db.selectFrom('locs').select('address_city').distinct().where('address_city', 'is not', null).orderBy('address_city').execute(),
      this.db.selectFrom('locs').select('address_county').distinct().where('address_county', 'is not', null).orderBy('address_county').execute(),
      this.db.selectFrom('locs').select('census_region').distinct().where('census_region', 'is not', null).orderBy('census_region').execute(),
      this.db.selectFrom('locs').select('census_division').distinct().where('census_division', 'is not', null).orderBy('census_division').execute(),
      this.db.selectFrom('locs').select('cultural_region').distinct().where('cultural_region', 'is not', null).orderBy('cultural_region').execute(),
    ]);

    return {
      states: statesResult.map(r => r.address_state!).filter(Boolean),
      categories: categoriesResult.map(r => r.category!).filter(Boolean),
      classes: classesResult.map(r => r.class!).filter(Boolean),
      cities: citiesResult.map(r => r.address_city!).filter(Boolean),
      counties: countiesResult.map(r => r.address_county!).filter(Boolean),
      censusRegions: censusRegionsResult.map(r => r.census_region!).filter(Boolean),
      censusDivisions: censusDivisionsResult.map(r => r.census_division!).filter(Boolean),
      culturalRegions: culturalRegionsResult.map(r => r.cultural_region!).filter(Boolean),
    };
  }

  async update(id: string, input: Partial<LocationInput>): Promise<Location> {
    const locup = new Date().toISOString();

    const updates: Record<string, unknown> = {
      locup,
      // Migration 25: Activity tracking
      modified_at: locup,
    };

    // Migration 25: Track who modified if provided
    if ((input as any).modified_by_id !== undefined) {
      updates.modified_by_id = (input as any).modified_by_id;
    }
    if ((input as any).modified_by !== undefined) {
      updates.modified_by = (input as any).modified_by;
    } else if (input.auth_imp !== undefined) {
      updates.modified_by = input.auth_imp;
    }

    if (input.locnam !== undefined) updates.locnam = input.locnam;
    if (input.slocnam !== undefined) updates.slocnam = input.slocnam;
    if (input.akanam !== undefined) updates.akanam = input.akanam;
    if (input.category !== undefined) updates.category = input.category;
    if (input.class !== undefined) updates.class = input.class;

    if (input.gps !== undefined) {
      updates.gps_lat = input.gps.lat;
      updates.gps_lng = input.gps.lng;
      updates.gps_accuracy = input.gps.accuracy || null;
      updates.gps_source = input.gps.source;
      updates.gps_verified_on_map = input.gps.verifiedOnMap ? 1 : 0;
      updates.gps_captured_at = input.gps.capturedAt || null;
      updates.gps_leaflet_data = input.gps.leafletData ? JSON.stringify(input.gps.leafletData) : null;
      // Kanye9: Store geocode tier for accurate map zoom
      updates.gps_geocode_tier = input.gps.geocodeTier || null;
      updates.gps_geocode_query = input.gps.geocodeQuery || null;
    }

    if (input.address !== undefined) {
      // Kanye9: Process address through AddressService for raw + normalized storage
      const addressRecord = AddressService.processStructured({
        street: input.address.street,
        houseNumber: null,
        city: input.address.city,
        county: input.address.county,
        state: input.address.state,
        zipcode: input.address.zipcode,
      });

      updates.address_street = addressRecord.normalized.street;
      updates.address_city = addressRecord.normalized.city;
      updates.address_county = addressRecord.normalized.county || AddressNormalizer.normalizeCounty(input.address.county);
      updates.address_state = addressRecord.normalized.state;
      updates.address_zipcode = addressRecord.normalized.zipcode;
      updates.address_confidence = input.address.confidence || null;
      updates.address_geocoded_at = input.address.geocodedAt || null;
      // Kanye9: Store raw + normalized + parsed for premium archive
      updates.address_raw = addressRecord.raw;
      updates.address_normalized = AddressService.format(addressRecord.normalized);
      updates.address_parsed_json = JSON.stringify(addressRecord.parsed);
      updates.address_source = addressRecord.source;
      // DECISION-010: Address verification flag
      if (input.address.verified !== undefined) {
        updates.address_verified = input.address.verified ? 1 : 0;
      }
    }

    // P0: condition and status removed - use access only
    if (input.documentation !== undefined) updates.documentation = input.documentation;
    if (input.access !== undefined) updates.access = input.access;
    if (input.historic !== undefined) updates.historic = input.historic ? 1 : 0;
    if (input.favorite !== undefined) updates.favorite = input.favorite ? 1 : 0;
    if (input.hero_imghash !== undefined) updates.hero_imghash = input.hero_imghash;
    if (input.hero_focal_x !== undefined) updates.hero_focal_x = input.hero_focal_x;
    if (input.hero_focal_y !== undefined) updates.hero_focal_y = input.hero_focal_y;
    if (input.auth_imp !== undefined) updates.auth_imp = input.auth_imp;
    // DECISION-013: Information box fields
    if (input.builtYear !== undefined) updates.built_year = input.builtYear;
    if (input.builtType !== undefined) updates.built_type = input.builtType;
    if (input.abandonedYear !== undefined) updates.abandoned_year = input.abandonedYear;
    if (input.abandonedType !== undefined) updates.abandoned_type = input.abandonedType;
    if (input.project !== undefined) updates.project = input.project ? 1 : 0;
    if (input.docInterior !== undefined) updates.doc_interior = input.docInterior ? 1 : 0;
    if (input.docExterior !== undefined) updates.doc_exterior = input.docExterior ? 1 : 0;
    if (input.docDrone !== undefined) updates.doc_drone = input.docDrone ? 1 : 0;
    if (input.docWebHistory !== undefined) updates.doc_web_history = input.docWebHistory ? 1 : 0;
    if (input.docMapFind !== undefined) updates.doc_map_find = input.docMapFind ? 1 : 0;
    if (input.statusChangedAt !== undefined) updates.status_changed_at = input.statusChangedAt;
    // DECISION-019: Information Box overhaul fields (historicalName removed)
    if (input.locnamVerified !== undefined) updates.locnam_verified = input.locnamVerified ? 1 : 0;
    if (input.akanamVerified !== undefined) updates.akanam_verified = input.akanamVerified ? 1 : 0;
    // OPT-062: Host-only location flag
    if (input.isHostOnly !== undefined) updates.is_host_only = input.isHostOnly ? 1 : 0;

    // Kanye9: Handle flat GPS field updates (for cascade geocoding and other direct updates)
    const inputAny = input as any;
    if (inputAny.gps_lat !== undefined) updates.gps_lat = inputAny.gps_lat;
    if (inputAny.gps_lng !== undefined) updates.gps_lng = inputAny.gps_lng;
    if (inputAny.gps_source !== undefined) updates.gps_source = inputAny.gps_source;
    if (inputAny.gps_geocode_tier !== undefined) updates.gps_geocode_tier = inputAny.gps_geocode_tier;
    if (inputAny.gps_geocode_query !== undefined) updates.gps_geocode_query = inputAny.gps_geocode_query;

    // DECISION-012: Handle region field updates
    // Cultural region can be set directly by user
    if (inputAny.culturalRegion !== undefined) {
      updates.cultural_region = inputAny.culturalRegion;
    }
    // Census fields can also be set directly (for backfill or manual override)
    if (inputAny.censusRegion !== undefined) {
      updates.census_region = inputAny.censusRegion;
    }
    if (inputAny.censusDivision !== undefined) {
      updates.census_division = inputAny.censusDivision;
    }
    if (inputAny.stateDirection !== undefined) {
      updates.state_direction = inputAny.stateDirection;
    }

    // DECISION-017: Handle Country Cultural Region and verification field updates
    if (inputAny.countryCulturalRegion !== undefined) {
      updates.country_cultural_region = inputAny.countryCulturalRegion;
    }
    if (inputAny.countryCulturalRegionVerified !== undefined) {
      updates.country_cultural_region_verified = inputAny.countryCulturalRegionVerified ? 1 : 0;
    }
    if (inputAny.localCulturalRegionVerified !== undefined) {
      updates.local_cultural_region_verified = inputAny.localCulturalRegionVerified ? 1 : 0;
    }
    if (inputAny.country !== undefined) {
      updates.country = inputAny.country;
    }
    if (inputAny.continent !== undefined) {
      updates.continent = inputAny.continent;
    }

    // DECISION-012: Auto-recalculate region fields when address or GPS changes
    if (input.address !== undefined || input.gps !== undefined) {
      // Get current location to get existing values for fields not being updated
      const current = await this.findById(id);
      if (current) {
        const newState = input.address?.state ?? current.address?.state;
        const newCounty = input.address?.county ?? current.address?.county;
        const newLat = input.gps?.lat ?? current.gps?.lat;
        const newLng = input.gps?.lng ?? current.gps?.lng;
        const existingCulturalRegion = inputAny.culturalRegion ?? current.culturalRegion;
        const existingCountryCulturalRegion = inputAny.countryCulturalRegion ?? current.countryCulturalRegion;

        const regionFields = calculateRegionFields({
          state: newState,
          county: newCounty,
          lat: newLat,
          lng: newLng,
          existingCulturalRegion,
          existingCountryCulturalRegion,
        });

        // Always update Census fields when address/GPS changes
        updates.census_region = regionFields.censusRegion;
        updates.census_division = regionFields.censusDivision;
        updates.state_direction = regionFields.stateDirection;
        // Only update cultural region if not already set
        if (!existingCulturalRegion && regionFields.culturalRegion) {
          updates.cultural_region = regionFields.culturalRegion;
        }
        // Only update country cultural region if not already set
        if (!existingCountryCulturalRegion && regionFields.countryCulturalRegion) {
          updates.country_cultural_region = regionFields.countryCulturalRegion;
        }
      }
    }

    await this.db
      .updateTable('locs')
      .set(updates)
      .where('locid', '=', id)
      .execute();

    // OPT-037: Re-enrich from GPS when coordinates change
    // This handles the case where GPS is updated but address was not provided
    const gpsUpdated = input.gps?.lat !== undefined || input.gps?.lng !== undefined;
    const inputAnyGps = input as any;
    const flatGpsUpdated = inputAnyGps.gps_lat !== undefined || inputAnyGps.gps_lng !== undefined;

    if (gpsUpdated || flatGpsUpdated) {
      // Get the updated location to check if we need enrichment
      const updatedLoc = await this.findById(id);

      // Only enrich if we have GPS but missing county (indicates need for reverse geocode)
      if (updatedLoc?.gps?.lat != null && updatedLoc?.gps?.lng != null && !updatedLoc.address?.county) {
        try {
          const enrichment = this.getEnrichmentService();
          const source: GPSSource = (updatedLoc.gps.source as GPSSource) || 'manual';
          await enrichment.enrichFromGPS(id, {
            lat: updatedLoc.gps.lat,
            lng: updatedLoc.gps.lng,
            source,
            stateHint: updatedLoc.address?.state,
          });
          console.log(`[LocationRepository] Re-enriched location ${id} after GPS update`);
        } catch (enrichError) {
          // Non-fatal: log and continue
          console.warn(`[LocationRepository] Re-enrichment failed for ${id}:`, enrichError);
        }
      }
    }

    const location = await this.findById(id);
    if (!location) {
      throw new Error('Failed to update location');
    }
    return location;
  }

  /**
   * OPT-036: Delete location with full file cleanup
   *
   * 1. Collects all media SHAs for thumbnail/preview cleanup
   * 2. Deletes DB records (CASCADE handles media tables)
   * 3. Background cleanup of files (non-blocking for fast UI response)
   *    - Location folder (original media + BagIt archive)
   *    - Thumbnails/previews/posters (global hash-bucketed)
   *    - Video proxies
   */
  async delete(id: string): Promise<void> {
    const logger = getLogger();

    // 1. Get location for folder path construction
    const location = await this.findById(id);
    if (!location) {
      throw new Error(`Location not found: ${id}`);
    }

    // 2. Collect all media hashes with separate queries (simpler, reliable)
    const imgHashes = await this.db
      .selectFrom('imgs')
      .select('imghash as hash')
      .where('locid', '=', id)
      .execute();

    const vidHashes = await this.db
      .selectFrom('vids')
      .select('vidhash as hash')
      .where('locid', '=', id)
      .execute();

    const docHashes = await this.db
      .selectFrom('docs')
      .select('dochash as hash')
      .where('locid', '=', id)
      .execute();

    // Combine with type annotations
    const mediaHashes: Array<{ hash: string; type: 'img' | 'vid' | 'doc' }> = [
      ...imgHashes.map(r => ({ hash: r.hash, type: 'img' as const })),
      ...vidHashes.map(r => ({ hash: r.hash, type: 'vid' as const })),
      ...docHashes.map(r => ({ hash: r.hash, type: 'doc' as const })),
    ];

    // 3. Get video proxy paths (separate table with trigger cleanup)
    const videoHashes = mediaHashes.filter(m => m.type === 'vid').map(m => m.hash);
    const proxyPaths: string[] = [];
    if (videoHashes.length > 0) {
      const proxies = await this.db
        .selectFrom('video_proxies')
        .select('proxy_path')
        .where('vidhash', 'in', videoHashes)
        .execute();
      proxyPaths.push(...proxies.map(p => p.proxy_path).filter((p): p is string => !!p));
    }

    // 4. Audit log BEFORE deletion
    // ADR-046: Removed loc12 from audit log - locid is the only ID now
    logger.info('LocationRepository', `DELETION AUDIT: Deleting location with files`, {
      locid: id,
      locnam: location.locnam,
      state: location.address?.state,
      category: location.category,
      media_count: mediaHashes.length,
      video_proxies: proxyPaths.length,
      deleted_at: new Date().toISOString(),
    });

    // 5. Delete DB records FIRST (fast, atomic with CASCADE)
    await this.db.deleteFrom('locs').where('locid', '=', id).execute();

    // 6. Background file cleanup (non-blocking for instant UI response)
    const archivePath = await this.getArchivePath();
    // ADR-046: New folder structure uses STATE/LOCID instead of STATE-TYPE/SLOCNAM-LOC12
    const state = location.address?.state?.toUpperCase() || 'XX';

    setImmediate(async () => {
      try {
        // 6a. Delete location folder (contains all original media + BagIt)
        // ADR-046: New structure: locations/[STATE]/[LOCID]/
        if (archivePath) {
          const locationFolder = path.join(
            archivePath,
            'locations',
            state,
            id
          );

          try {
            await fs.rm(locationFolder, { recursive: true, force: true });
            logger.info('LocationRepository', `Deleted location folder: ${locationFolder}`);
          } catch (folderErr) {
            // Folder might not exist if no media was ever imported
            logger.warn('LocationRepository', `Could not delete folder (may not exist): ${locationFolder}`);
          }
        }

        // 6b. Delete thumbnails/previews/posters by hash
        if (archivePath && mediaHashes.length > 0) {
          const mediaPathService = new MediaPathService(archivePath);

          for (const { hash, type } of mediaHashes) {
            // Thumbnails (all sizes including legacy)
            for (const size of [400, 800, 1920, undefined] as const) {
              const thumbPath = mediaPathService.getThumbnailPath(hash, size as 400 | 800 | 1920 | undefined);
              await fs.unlink(thumbPath).catch(() => {});
            }

            // Previews (images/RAW only)
            if (type === 'img') {
              const previewPath = mediaPathService.getPreviewPath(hash);
              await fs.unlink(previewPath).catch(() => {});
            }

            // Posters (videos only)
            if (type === 'vid') {
              const posterPath = mediaPathService.getPosterPath(hash);
              await fs.unlink(posterPath).catch(() => {});
            }
          }
        }

        // 6c. Delete video proxies
        for (const proxyPath of proxyPaths) {
          await fs.unlink(proxyPath).catch(() => {});
        }

        logger.info('LocationRepository', `File cleanup complete for location ${id}`);
      } catch (err) {
        logger.warn('LocationRepository', `Background file cleanup error for ${id}`, {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    });
  }

  /**
   * Get archive path from settings
   */
  private async getArchivePath(): Promise<string | null> {
    const result = await this.db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'archive_path')
      .executeTakeFirst();
    return result?.value || null;
  }

  async count(filters?: LocationFilters): Promise<number> {
    let query = this.db.selectFrom('locs').select((eb) => eb.fn.countAll().as('count'));

    if (filters?.state) {
      query = query.where('address_state', '=', filters.state);
    }

    if (filters?.category) {
      query = query.where('category', '=', filters.category);
    }

    if (filters?.hasGPS) {
      query = query.where('gps_lat', 'is not', null).where('gps_lng', 'is not', null);
    }

    if (filters?.search) {
      query = query.where((eb) =>
        eb.or([
          eb('locnam', 'like', `%${filters.search}%`),
          eb('akanam', 'like', `%${filters.search}%`)
        ])
      );
    }

    // CONSISTENCY: Match findAll filters
    if (filters?.historic === true) {
      query = query.where('historic', '=', 1);
    }

    if (filters?.favorite === true) {
      query = query.where('favorite', '=', 1);
    }

    // DECISION-013: New filters
    if (filters?.project === true) {
      query = query.where('project', '=', 1);
    }

    if (filters?.county) {
      query = query.where('address_county', '=', filters.county);
    }

    if (filters?.class) {
      query = query.where('class', '=', filters.class);
    }

    if (filters?.access) {
      query = query.where('access', '=', filters.access);
    }

    const result = await query.executeTakeFirst();
    return Number(result?.count || 0);
  }

  /**
   * Map database row to Location entity
   * ADR-046: Removed loc12 and sub12 - locid is the only ID now
   */
  private mapRowToLocation(row: LocsTable): Location {
    return {
      locid: row.locid,
      locnam: row.locnam,
      slocnam: row.slocnam ?? undefined,
      akanam: row.akanam ?? undefined,
      category: row.category ?? undefined,
      class: row.class ?? undefined,
      // GPS: Use explicit null check to handle coordinates at 0 (equator/prime meridian)
      gps:
        row.gps_lat !== null && row.gps_lat !== undefined &&
        row.gps_lng !== null && row.gps_lng !== undefined
          ? {
              lat: row.gps_lat,
              lng: row.gps_lng,
              accuracy: row.gps_accuracy ?? undefined,
              source: (row.gps_source ?? 'manual_entry') as any,
              verifiedOnMap: row.gps_verified_on_map === 1,
              capturedAt: row.gps_captured_at ?? undefined,
              leafletData: row.gps_leaflet_data ? JSON.parse(row.gps_leaflet_data) : undefined,
              // Kanye9: Include geocode tier for accurate map zoom
              geocodeTier: row.gps_geocode_tier ?? undefined,
              geocodeQuery: row.gps_geocode_query ?? undefined,
            }
          : undefined,
      address: {
        street: row.address_street ?? undefined,
        city: row.address_city ?? undefined,
        county: row.address_county ?? undefined,
        state: row.address_state ?? undefined,
        zipcode: row.address_zipcode ?? undefined,
        confidence: (row.address_confidence ?? undefined) as any,
        geocodedAt: row.address_geocoded_at ?? undefined,
        verified: row.address_verified === 1,
      },
      // P0: condition and status removed - use access only
      documentation: row.documentation ?? undefined,
      access: row.access ?? undefined,
      historic: row.historic === 1,
      favorite: row.favorite === 1,
      // DECISION-013: Information box fields
      builtYear: row.built_year ?? undefined,
      builtType: (row.built_type ?? undefined) as any,
      abandonedYear: row.abandoned_year ?? undefined,
      abandonedType: (row.abandoned_type ?? undefined) as any,
      project: row.project === 1,
      docInterior: row.doc_interior === 1,
      docExterior: row.doc_exterior === 1,
      docDrone: row.doc_drone === 1,
      docWebHistory: row.doc_web_history === 1,
      docMapFind: row.doc_map_find === 1,
      statusChangedAt: row.status_changed_at ?? undefined,
      hero_imghash: row.hero_imghash ?? undefined,
      hero_focal_x: row.hero_focal_x ?? 0.5,
      hero_focal_y: row.hero_focal_y ?? 0.5,
      sublocs: row.sublocs ? JSON.parse(row.sublocs) : [],
      locadd: row.locadd ?? new Date().toISOString(),
      locup: row.locup ?? undefined,
      auth_imp: row.auth_imp ?? undefined,
      regions: row.regions ? JSON.parse(row.regions) : [],
      state: row.state ?? undefined,
      // DECISION-011/012: Cultural and Census region fields
      culturalRegion: row.cultural_region ?? undefined,
      censusRegion: row.census_region ?? undefined,
      censusDivision: row.census_division ?? undefined,
      stateDirection: row.state_direction ?? undefined,
      // DECISION-010: Location-level verification (set when BOTH address AND GPS verified)
      locationVerified: row.location_verified === 1,
      // DECISION-017: Country Cultural Region and geographic hierarchy
      countryCulturalRegion: row.country_cultural_region ?? undefined,
      countryCulturalRegionVerified: row.country_cultural_region_verified === 1,
      localCulturalRegionVerified: row.local_cultural_region_verified === 1,
      country: row.country ?? 'United States',
      continent: row.continent ?? 'North America',
      // DECISION-019: Information Box overhaul fields (historicalName removed)
      locnamVerified: row.locnam_verified === 1,
      akanamVerified: row.akanam_verified === 1,
      // Migration 25: Activity tracking
      createdById: row.created_by_id ?? undefined,
      createdBy: row.created_by ?? undefined,
      modifiedById: row.modified_by_id ?? undefined,
      modifiedBy: row.modified_by ?? undefined,
      modifiedAt: row.modified_at ?? undefined,
      // Migration 33: View tracking for Nerd Stats
      viewCount: row.view_count ?? 0,
      lastViewedAt: row.last_viewed_at ?? undefined,
      // OPT-062: Host-only location flag
      isHostOnly: row.is_host_only === 1,
    };
  }

  /**
   * FIX 6.7: Find locations within a radius of given coordinates
   * Uses Haversine formula for great-circle distance calculation
   * @param lat Center latitude
   * @param lng Center longitude
   * @param radiusKm Radius in kilometers
   * @returns Locations sorted by distance from center
   */
  async findNearby(lat: number, lng: number, radiusKm: number): Promise<Array<Location & { distance: number }>> {
    // Get all locations with GPS coordinates
    const rows = await this.db
      .selectFrom('locs')
      .selectAll()
      .where('gps_lat', 'is not', null)
      .where('gps_lng', 'is not', null)
      .execute();

    // Calculate distance for each and filter by radius
    const radiusMeters = radiusKm * 1000;
    const locationsWithDistance: Array<Location & { distance: number }> = [];

    for (const row of rows) {
      const distance = GPSValidator.haversineDistance(lat, lng, row.gps_lat!, row.gps_lng!);
      if (distance <= radiusMeters) {
        const location = this.mapRowToLocation(row);
        locationsWithDistance.push({
          ...location,
          distance: Math.round(distance), // Distance in meters
        });
      }
    }

    // Sort by distance (closest first)
    locationsWithDistance.sort((a, b) => a.distance - b.distance);

    return locationsWithDistance;
  }

  /**
   * DECISION-012/017: Backfill region fields for all existing locations
   * Calculates Census region, division, state direction, cultural region,
   * and country cultural region for locations that don't have these fields populated yet.
   * @returns Number of locations updated
   */
  async backfillRegions(): Promise<{ updated: number; total: number }> {
    // Get all locations
    const rows = await this.db
      .selectFrom('locs')
      .selectAll()
      .execute();

    let updated = 0;

    for (const row of rows) {
      // Calculate region fields
      const regionFields = calculateRegionFields({
        state: row.address_state,
        county: row.address_county,
        lat: row.gps_lat,
        lng: row.gps_lng,
        existingCulturalRegion: row.cultural_region,
        existingCountryCulturalRegion: row.country_cultural_region,
      });

      // Check if any fields need updating
      const needsUpdate =
        (regionFields.censusRegion && !row.census_region) ||
        (regionFields.censusDivision && !row.census_division) ||
        (regionFields.stateDirection && !row.state_direction) ||
        (regionFields.culturalRegion && !row.cultural_region) ||
        (regionFields.countryCulturalRegion && !row.country_cultural_region);

      if (needsUpdate) {
        await this.db
          .updateTable('locs')
          .set({
            census_region: regionFields.censusRegion ?? row.census_region,
            census_division: regionFields.censusDivision ?? row.census_division,
            state_direction: regionFields.stateDirection ?? row.state_direction,
            cultural_region: regionFields.culturalRegion ?? row.cultural_region,
            country_cultural_region: regionFields.countryCulturalRegion ?? row.country_cultural_region,
          })
          .where('locid', '=', row.locid)
          .execute();

        updated++;
      }
    }

    return { updated, total: rows.length };
  }

  /**
   * Migration 33: Track location views for Nerd Stats
   * Increments view_count and updates last_viewed_at timestamp
   * @param locid Location ID to track
   * @returns Updated view count
   */
  async trackView(locid: string): Promise<number> {
    const now = new Date().toISOString();

    await this.db
      .updateTable('locs')
      .set((eb) => ({
        view_count: eb('view_count', '+', 1),
        last_viewed_at: now,
      }))
      .where('locid', '=', locid)
      .execute();

    // Get the updated count
    const result = await this.db
      .selectFrom('locs')
      .select('view_count')
      .where('locid', '=', locid)
      .executeTakeFirst();

    return result?.view_count ?? 0;
  }

  /**
   * OPT-037: Find locations within map viewport bounds
   * Spatial query for Atlas - only loads visible locations
   * @param bounds Map viewport bounds (north, south, east, west)
   * @param limit Maximum locations to return (default 500)
   * @returns Locations with GPS within bounds
   */
  async findInBounds(bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }, limit: number = 500): Promise<Location[]> {
    // Handle date line crossing (east < west)
    let query = this.db
      .selectFrom('locs')
      .selectAll()
      .where('gps_lat', 'is not', null)
      .where('gps_lng', 'is not', null)
      .where('gps_lat', '<=', bounds.north)
      .where('gps_lat', '>=', bounds.south);

    if (bounds.east >= bounds.west) {
      // Normal case: east is greater than west
      query = query
        .where('gps_lng', '<=', bounds.east)
        .where('gps_lng', '>=', bounds.west);
    } else {
      // Date line crossing: longitude wraps around
      query = query.where((eb) =>
        eb.or([
          eb('gps_lng', '>=', bounds.west),
          eb('gps_lng', '<=', bounds.east),
        ])
      );
    }

    query = query.limit(limit);

    const rows = await query.execute();
    return rows.map((row) => this.mapRowToLocation(row));
  }

  /**
   * OPT-037: Count locations visible in viewport (for UI feedback)
   */
  async countInBounds(bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }): Promise<number> {
    let query = this.db
      .selectFrom('locs')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('gps_lat', 'is not', null)
      .where('gps_lng', 'is not', null)
      .where('gps_lat', '<=', bounds.north)
      .where('gps_lat', '>=', bounds.south);

    if (bounds.east >= bounds.west) {
      query = query
        .where('gps_lng', '<=', bounds.east)
        .where('gps_lng', '>=', bounds.west);
    } else {
      query = query.where((eb) =>
        eb.or([
          eb('gps_lng', '>=', bounds.west),
          eb('gps_lng', '<=', bounds.east),
        ])
      );
    }

    const result = await query.executeTakeFirst();
    return Number(result?.count || 0);
  }

  /**
   * OPT-043: Lean location type for map display - only essential fields
   * Eliminates JSON.parse overhead and reduces data transfer by ~90%
   */
  static readonly MAP_LOCATION_FIELDS = [
    'locid',
    'locnam',
    'category',
    'gps_lat',
    'gps_lng',
    'gps_accuracy',
    'gps_source',
    'gps_verified_on_map',
    'address_state',
    'address_city',
    'favorite',
  ] as const;

  /**
   * OPT-043: Ultra-fast map location query - no JSON parsing, minimal columns
   * Returns lean MapLocation objects for Atlas performance
   *
   * Optimizations vs findInBounds():
   * - SELECT 11 columns instead of 60+ (90% less data)
   * - No JSON.parse for gps_leaflet_data, sublocs, regions
   * - Direct row mapping (no mapRowToLocation transformation)
   * - ~10x faster for typical map loads
   */
  async findInBoundsForMap(bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }, limit: number = 500): Promise<MapLocation[]> {
    let query = this.db
      .selectFrom('locs')
      .select([
        'locid',
        'locnam',
        'category',
        'gps_lat',
        'gps_lng',
        'gps_accuracy',
        'gps_source',
        'gps_verified_on_map',
        'address_state',
        'address_city',
        'favorite',
      ])
      .where('gps_lat', 'is not', null)
      .where('gps_lng', 'is not', null)
      .where('gps_lat', '<=', bounds.north)
      .where('gps_lat', '>=', bounds.south);

    if (bounds.east >= bounds.west) {
      query = query
        .where('gps_lng', '<=', bounds.east)
        .where('gps_lng', '>=', bounds.west);
    } else {
      // Date line crossing
      query = query.where((eb) =>
        eb.or([
          eb('gps_lng', '>=', bounds.west),
          eb('gps_lng', '<=', bounds.east),
        ])
      );
    }

    const rows = await query.limit(limit).execute();

    // OPT-043: Direct mapping - no JSON parsing, no heavy transformation
    return rows.map((row) => ({
      locid: row.locid,
      locnam: row.locnam,
      category: row.category ?? undefined,
      gps_lat: row.gps_lat!,
      gps_lng: row.gps_lng!,
      gps_accuracy: row.gps_accuracy ?? undefined,
      gps_source: row.gps_source ?? undefined,
      gps_verified_on_map: row.gps_verified_on_map === 1,
      address_state: row.address_state ?? undefined,
      address_city: row.address_city ?? undefined,
      favorite: row.favorite === 1,
    }));
  }

  /**
   * Find project locations (project flag set) with hero thumbnails for dashboard
   */
  async findProjects(limit: number = 5): Promise<Array<Location & { heroThumbPath?: string }>> {
    const rows = await this.db
      .selectFrom('locs')
      .selectAll()
      .where('project', '=', 1)
      .orderBy('locup', 'desc')
      .limit(limit)
      .execute();

    const results: Array<Location & { heroThumbPath?: string }> = [];
    for (const row of rows) {
      let heroThumbPath: string | undefined;
      if (row.hero_imghash) {
        const img = await this.db
          .selectFrom('imgs')
          .select(['thumb_path_sm', 'thumb_path_lg', 'thumb_path'])
          .where('imghash', '=', row.hero_imghash)
          .executeTakeFirst();
        heroThumbPath = img?.thumb_path_sm || img?.thumb_path_lg || img?.thumb_path || undefined;
      }
      results.push({
        ...this.mapRowToLocation(row),
        heroThumbPath,
      });
    }

    return results;
  }

  /**
   * Find recently viewed locations ordered by last_viewed_at
   * Returns locations with hero thumbnail path for dashboard display
   */
  async findRecentlyViewed(limit: number = 5): Promise<Array<Location & { heroThumbPath?: string }>> {
    const rows = await this.db
      .selectFrom('locs')
      .selectAll()
      .where('last_viewed_at', 'is not', null)
      .orderBy('last_viewed_at', 'desc')
      .limit(limit)
      .execute();

    // Get hero thumbnail paths for each location
    const results: Array<Location & { heroThumbPath?: string }> = [];
    for (const row of rows) {
      let heroThumbPath: string | undefined;
      if (row.hero_imghash) {
        const img = await this.db
          .selectFrom('imgs')
          .select(['thumb_path_sm', 'thumb_path_lg', 'thumb_path'])
          .where('imghash', '=', row.hero_imghash)
          .executeTakeFirst();
        heroThumbPath = img?.thumb_path_sm || img?.thumb_path_lg || img?.thumb_path || undefined;
      }
      results.push({
        ...this.mapRowToLocation(row),
        heroThumbPath,
      });
    }

    return results;
  }
}
