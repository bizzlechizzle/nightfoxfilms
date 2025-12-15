/**
 * Location IPC Handlers
 * Handles all location:* IPC channels
 * Migration 25: Activity tracking - passes current user to repository
 * Migration 25 - Phase 3: Author attribution via location_authors table
 * Migration 38: Duplicate detection for pin-to-location conversion
 * OPT-031: Uses shared user service for getCurrentUser
 * ADR-046: Updated validation from UUID to BLAKE3 16-char hex for locid
 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import { Blake3IdSchema } from '../ipc-validation';
import type { Database } from '../database.types';
import { SQLiteLocationRepository } from '../../repositories/sqlite-location-repository';
import { SQLiteLocationAuthorsRepository } from '../../repositories/sqlite-location-authors-repository';
import { SQLiteLocationViewsRepository } from '../../repositories/sqlite-location-views-repository';
import { SQLiteLocationExclusionsRepository } from '../../repositories/sqlite-location-exclusions-repository';
import { LocationInputSchema } from '@au-archive/core';
import type { LocationFilters } from '@au-archive/core';
import { AddressService, type NormalizedAddress } from '../../services/address-service';
import { LocationDuplicateService } from '../../services/location-duplicate-service';
// OPT-031: Use shared user service
import { getCurrentUser } from '../../services/user-service';
// BagIt: Initialize bag on location creation, update bag-info on metadata changes
import { getBagItService } from './bagit';
// Timeline: Initialize timeline events on location creation
import { getTimelineService } from './timeline';

export function registerLocationHandlers(db: Kysely<Database>) {
  const locationRepo = new SQLiteLocationRepository(db);
  // Migration 25 - Phase 3: Location authors repository for attribution tracking
  const authorsRepo = new SQLiteLocationAuthorsRepository(db);
  // Migration 34: Location views repository for per-user view tracking
  const viewsRepo = new SQLiteLocationViewsRepository(db);
  // Migration 38: Duplicate detection for pin-to-location conversion
  const exclusionsRepo = new SQLiteLocationExclusionsRepository(db);
  const duplicateService = new LocationDuplicateService(db);

  ipcMain.handle('location:findAll', async (_event, filters?: LocationFilters) => {
    try {
      return await locationRepo.findAll(filters);
    } catch (error) {
      console.error('Error finding locations:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('location:findById', async (_event, id: unknown) => {
    try {
      const validatedId = Blake3IdSchema.parse(id);
      const location = await locationRepo.findById(validatedId);
      return location;
    } catch (error) {
      console.error('Error finding location:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('location:create', async (_event, input: unknown) => {
    try {
      const validatedInput = LocationInputSchema.parse(input);

      // Migration 25: Inject current user context
      const currentUser = await getCurrentUser(db);
      if (currentUser) {
        validatedInput.created_by_id = currentUser.userId;
        validatedInput.created_by = currentUser.username;
        validatedInput.modified_by_id = currentUser.userId;
        validatedInput.modified_by = currentUser.username;
      }

      const location = await locationRepo.create(validatedInput);

      // Migration 25 - Phase 3: Track the creator in location_authors table
      if (currentUser && location) {
        await authorsRepo.trackUserContribution(location.locid, currentUser.userId, 'create').catch((err) => {
          console.warn('[Location IPC] Failed to track creator:', err);
          // Non-fatal - don't fail location creation
        });
      }

      // BagIt: Initialize bag for new location (non-blocking)
      // ADR-046: Initialize BagIt bag (removed loc12/slocnam)
      if (location) {
        try {
          const bagItService = getBagItService();
          if (bagItService) {
            await bagItService.initializeBag({
              locid: location.locid,
              locnam: location.locnam,
              category: location.category || null,
              access: null,
              address_state: location.address?.state || null,
              address_city: location.address?.city || null,
              address_county: location.address?.county || null,
              address_zipcode: location.address?.zipcode || null,
              address_street: location.address?.street || null,
              gps_lat: location.gps?.lat || null,
              gps_lng: location.gps?.lng || null,
              gps_source: location.gps?.source || null,
              gps_verified_on_map: location.gps?.verifiedOnMap ? 1 : 0,
              gps_accuracy: location.gps?.accuracy || null,
              census_region: null,
              census_division: null,
              state_direction: null,
              cultural_region: null,
              notes: null,
              locadd: location.locadd || null,
              locup: location.locup || null,
            });
            console.log(`[BagIt] Initialized bag for new location: ${location.locnam}`);
          }
        } catch (e) { console.warn('[Location IPC] Failed to initialize BagIt bag (non-fatal):', e); }
      }

      // Timeline: Initialize timeline events for new location (non-blocking)
      if (location) {
        try {
          const timelineService = getTimelineService();
          if (timelineService) {
            await timelineService.initializeLocationTimeline(
              location.locid,
              location.locadd || null,
              currentUser?.userId
            );
            console.log(`[Timeline] Initialized timeline for new location: ${location.locnam}`);
          }
        } catch (e) { console.warn('[Location IPC] Failed to initialize timeline (non-fatal):', e); }
      }

      return location;
    } catch (error) {
      console.error('Error creating location:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('location:update', async (_event, id: unknown, input: unknown) => {
    try {
      const validatedId = Blake3IdSchema.parse(id);
      const validatedInput = LocationInputSchema.partial().parse(input);

      // Migration 25: Inject current user context for modification tracking
      const currentUser = await getCurrentUser(db);
      if (currentUser) {
        validatedInput.modified_by_id = currentUser.userId;
        validatedInput.modified_by = currentUser.username;
      }

      const location = await locationRepo.update(validatedId, validatedInput);

      // Migration 25 - Phase 3: Track the contributor in location_authors table
      if (currentUser) {
        await authorsRepo.trackUserContribution(validatedId, currentUser.userId, 'edit').catch((err) => {
          console.warn('[Location IPC] Failed to track contributor:', err);
          // Non-fatal - don't fail location update
        });
      }

      // BagIt: Update bag-info.txt when metadata changes (non-blocking)
      if (location) {
        try {
          const bagItService = getBagItService();
          // ADR-046: Update BagIt info (removed loc12/slocnam)
          if (bagItService) {
            await bagItService.updateBagInfo({
              locid: location.locid,
              locnam: location.locnam,
              category: location.category || null,
              access: null,
              address_state: location.address?.state || null,
              address_city: location.address?.city || null,
              address_county: location.address?.county || null,
              address_zipcode: location.address?.zipcode || null,
              address_street: location.address?.street || null,
              gps_lat: location.gps?.lat || null,
              gps_lng: location.gps?.lng || null,
              gps_source: location.gps?.source || null,
              gps_verified_on_map: location.gps?.verifiedOnMap ? 1 : 0,
              gps_accuracy: location.gps?.accuracy || null,
              census_region: null,
              census_division: null,
              state_direction: null,
              cultural_region: null,
              notes: null,
              locadd: location.locadd || null,
              locup: location.locup || null,
            }, []);
            console.log(`[BagIt] Updated bag-info for location: ${location.locnam}`);
          }
        } catch (e) { console.warn('[Location IPC] Failed to update BagIt bag-info (non-fatal):', e); }
      }

      return location;
    } catch (error) {
      console.error('Error updating location:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('location:delete', async (_event, id: unknown) => {
    try {
      const validatedId = Blake3IdSchema.parse(id);
      await locationRepo.delete(validatedId);
    } catch (error) {
      console.error('Error deleting location:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('location:count', async (_event, filters?: LocationFilters) => {
    try {
      return await locationRepo.count(filters);
    } catch (error) {
      console.error('Error counting locations:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * OPT-037: Find locations within map viewport bounds
   * Spatial query for Atlas - only loads visible locations
   */
  ipcMain.handle('location:findInBounds', async (_event, bounds: unknown) => {
    try {
      const BoundsSchema = z.object({
        north: z.number().min(-90).max(90),
        south: z.number().min(-90).max(90),
        east: z.number().min(-180).max(180),
        west: z.number().min(-180).max(180),
      });
      const validatedBounds = BoundsSchema.parse(bounds);
      return await locationRepo.findInBounds(validatedBounds);
    } catch (error) {
      console.error('Error finding locations in bounds:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * OPT-043: Ultra-fast map location query - lean MapLocation type
   * Returns only essential fields for Atlas (10x faster than findInBounds)
   * - SELECT 11 columns instead of 60+ (90% less data)
   * - No JSON.parse for gps_leaflet_data, sublocs, regions
   * - Direct row mapping (no mapRowToLocation transformation)
   *
   * OPT-044: Added performance monitoring and slow query detection
   */
  ipcMain.handle('location:findInBoundsForMap', async (_event, bounds: unknown) => {
    const startTime = performance.now();
    try {
      const BoundsSchema = z.object({
        north: z.number().min(-90).max(90),
        south: z.number().min(-90).max(90),
        east: z.number().min(-180).max(180),
        west: z.number().min(-180).max(180),
      });
      const validatedBounds = BoundsSchema.parse(bounds);
      const result = await locationRepo.findInBoundsForMap(validatedBounds);

      // OPT-044: Performance monitoring - log timing in dev, warn if slow
      const elapsed = performance.now() - startTime;
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Atlas] findInBoundsForMap: ${result.length} locations in ${elapsed.toFixed(1)}ms`);
      }

      // Slow query detection: >500ms for <1000 results indicates index problem
      if (elapsed > 500 && result.length < 1000) {
        console.warn(
          `[Atlas] SLOW MAP QUERY DETECTED: ${elapsed.toFixed(0)}ms for ${result.length} locations. ` +
          `Check idx_locs_map_bounds index exists. This should complete in <50ms.`
        );
      }

      return result;
    } catch (error) {
      const elapsed = performance.now() - startTime;
      console.error(`[Atlas] findInBoundsForMap FAILED after ${elapsed.toFixed(0)}ms:`, error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * OPT-037: Count locations within map viewport bounds
   */
  ipcMain.handle('location:countInBounds', async (_event, bounds: unknown) => {
    try {
      const BoundsSchema = z.object({
        north: z.number().min(-90).max(90),
        south: z.number().min(-90).max(90),
        east: z.number().min(-180).max(180),
        west: z.number().min(-180).max(180),
      });
      const validatedBounds = BoundsSchema.parse(bounds);
      return await locationRepo.countInBounds(validatedBounds);
    } catch (error) {
      console.error('Error counting locations in bounds:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('location:findNearby', async (_event, lat: number, lng: number, radiusKm: number) => {
    try {
      if (typeof lat !== 'number' || lat < -90 || lat > 90) {
        throw new Error('Invalid latitude');
      }
      if (typeof lng !== 'number' || lng < -180 || lng > 180) {
        throw new Error('Invalid longitude');
      }
      if (typeof radiusKm !== 'number' || radiusKm <= 0 || radiusKm > 1000) {
        throw new Error('Invalid radius (must be 0-1000 km)');
      }
      return await locationRepo.findNearby(lat, lng, radiusKm);
    } catch (error) {
      console.error('Error finding nearby locations:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('location:random', async () => {
    try {
      const count = await db.selectFrom('locs').select((eb) => eb.fn.count('locid').as('count')).executeTakeFirst();
      const total = Number(count?.count || 0);
      if (total === 0) return null;

      const randomOffset = Math.floor(Math.random() * total);
      const result = await db
        .selectFrom('locs')
        .selectAll()
        .limit(1)
        .offset(randomOffset)
        .executeTakeFirst();

      if (!result) return null;
      return await locationRepo.findById(result.locid);
    } catch (error) {
      console.error('Error getting random location:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('location:undocumented', async () => {
    try {
      return await locationRepo.findAll({ documented: false });
    } catch (error) {
      console.error('Error getting undocumented locations:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('location:historical', async () => {
    try {
      return await locationRepo.findAll({ historic: true });
    } catch (error) {
      console.error('Error getting historical locations:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('location:favorites', async () => {
    try {
      return await locationRepo.findAll({ favorite: true });
    } catch (error) {
      console.error('Error getting favorite locations:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('location:toggleFavorite', async (_event, id: unknown) => {
    try {
      const validatedId = Blake3IdSchema.parse(id);
      const location = await locationRepo.findById(validatedId);
      if (!location) {
        throw new Error('Location not found');
      }
      const newFavoriteState = !location.favorite;

      // Migration 25: Track who toggled favorite
      const currentUser = await getCurrentUser(db);
      const updateData: { favorite: boolean; modified_by_id?: string; modified_by?: string } = {
        favorite: newFavoriteState,
      };
      if (currentUser) {
        updateData.modified_by_id = currentUser.userId;
        updateData.modified_by = currentUser.username;
      }

      await locationRepo.update(validatedId, updateData);
      return newFavoriteState;
    } catch (error) {
      console.error('Error toggling favorite:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Kanye9: Check for duplicate locations by address
   * Returns potential matches with confidence scores
   */
  ipcMain.handle('location:checkDuplicates', async (_event, address: unknown) => {
    try {
      // Validate input address
      const AddressSchema = z.object({
        street: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        county: z.string().nullable().optional(),
        state: z.string().nullable().optional(),
        zipcode: z.string().nullable().optional(),
      });

      const newAddress = AddressSchema.parse(address) as NormalizedAddress;

      // Get all existing locations with addresses
      const allLocations = await locationRepo.findAll();
      const existingAddresses = allLocations
        .filter(loc => loc.address && (loc.address.street || loc.address.city || loc.address.zipcode))
        .map(loc => ({
          id: loc.locid,
          name: loc.locnam,
          address: {
            street: loc.address?.street || null,
            city: loc.address?.city || null,
            county: loc.address?.county || null,
            state: loc.address?.state || null,
            zipcode: loc.address?.zipcode || null,
          } as NormalizedAddress,
        }));

      // Find duplicates using AddressService
      const duplicates = AddressService.findDuplicates(newAddress, existingAddresses);

      // Enrich with location names
      return duplicates.map(dup => {
        const loc = existingAddresses.find(e => e.id === dup.id);
        return {
          ...dup,
          name: loc?.name || 'Unknown',
          address: loc?.address,
        };
      });
    } catch (error) {
      console.error('Error checking duplicates:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * DECISION-012: Backfill region fields for existing locations
   * Calculates Census region, division, state direction, and cultural region
   * for all locations that don't have these fields populated yet.
   */
  ipcMain.handle('location:backfillRegions', async () => {
    try {
      console.log('[Location IPC] Starting region backfill...');
      const result = await locationRepo.backfillRegions();
      console.log(`[Location IPC] Region backfill complete: ${result.updated}/${result.total} locations updated`);
      return result;
    } catch (error) {
      console.error('Error backfilling regions:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * DECISION-017: Update cultural regions and verification status
   * Updates local cultural region, country cultural region, and their verification flags
   */
  ipcMain.handle('location:updateRegionData', async (_event, id: unknown, regionData: unknown) => {
    try {
      const validatedId = Blake3IdSchema.parse(id);

      // Validate region data
      const RegionDataSchema = z.object({
        culturalRegion: z.string().nullable(),
        localCulturalRegionVerified: z.boolean(),
        countryCulturalRegion: z.string().nullable(),
        countryCulturalRegionVerified: z.boolean(),
      });

      const validatedRegionData = RegionDataSchema.parse(regionData);

      // Migration 25: Get current user for modification tracking
      const currentUser = await getCurrentUser(db);
      const now = new Date().toISOString();

      // Update directly in database
      await db.updateTable('locs')
        .set({
          cultural_region: validatedRegionData.culturalRegion,
          local_cultural_region_verified: validatedRegionData.localCulturalRegionVerified ? 1 : 0,
          country_cultural_region: validatedRegionData.countryCulturalRegion,
          country_cultural_region_verified: validatedRegionData.countryCulturalRegionVerified ? 1 : 0,
          locup: now,
          // Migration 25: Activity tracking
          modified_by_id: currentUser?.userId || null,
          modified_by: currentUser?.username || null,
          modified_at: now,
        })
        .where('locid', '=', validatedId)
        .execute();

      console.log(`[Location IPC] Updated region data for location ${validatedId}`);
    } catch (error) {
      console.error('Error updating region data:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Get distinct categories for autocomplete
  ipcMain.handle('location:getDistinctCategories', async () => {
    try {
      const categories = await db
        .selectFrom('locs')
        .select('category')
        .distinct()
        .where('category', 'is not', null)
        .where('category', '!=', '')
        .orderBy('category')
        .execute();

      return categories.map(r => r.category).filter(Boolean) as string[];
    } catch (error) {
      console.error('Error getting distinct categories:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * OPT-036: Get all filter options in a single efficient call
   * Uses SELECT DISTINCT queries for each filter dimension
   * Much faster than loading all locations and computing client-side
   */
  ipcMain.handle('location:getFilterOptions', async () => {
    try {
      return await locationRepo.getFilterOptions();
    } catch (error) {
      console.error('Error getting filter options:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Get distinct classes for autocomplete
  ipcMain.handle('location:getDistinctClasses', async () => {
    try {
      const classes = await db
        .selectFrom('locs')
        .select('class')
        .distinct()
        .where('class', 'is not', null)
        .where('class', '!=', '')
        .orderBy('class')
        .execute();

      return classes.map(r => r.class).filter(Boolean) as string[];
    } catch (error) {
      console.error('Error getting distinct classes:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Migration 34: Track location views with per-user tracking
   * Records view in location_views table and updates denormalized count on locs
   */
  ipcMain.handle('location:trackView', async (_event, id: unknown) => {
    try {
      const validatedId = Blake3IdSchema.parse(id);

      // Get current user - required for per-user tracking
      const currentUser = await getCurrentUser(db);
      if (!currentUser) {
        // If no user logged in, fall back to simple counter (no per-user tracking)
        return await locationRepo.trackView(validatedId);
      }

      // Track with per-user view record
      return await viewsRepo.trackView(validatedId, currentUser.userId);
    } catch (error) {
      console.error('Error tracking view:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Migration 34: Get view statistics for a location
   */
  ipcMain.handle('location:getViewStats', async (_event, id: unknown) => {
    try {
      const validatedId = Blake3IdSchema.parse(id);
      return await viewsRepo.getViewStats(validatedId);
    } catch (error) {
      console.error('Error getting view stats:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Migration 34: Get view history for a location
   */
  ipcMain.handle('location:getViewHistory', async (_event, id: unknown, limit?: number) => {
    try {
      const validatedId = Blake3IdSchema.parse(id);
      return await viewsRepo.getViewHistory(validatedId, limit ?? 50);
    } catch (error) {
      console.error('Error getting view history:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Dashboard: Find recently viewed locations with hero thumbnails
   */
  ipcMain.handle('location:findRecentlyViewed', async (_event, limit?: number) => {
    try {
      return await locationRepo.findRecentlyViewed(limit ?? 5);
    } catch (error) {
      console.error('Error finding recently viewed locations:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Dashboard: Find project locations with hero thumbnails
   */
  ipcMain.handle('location:findProjects', async (_event, limit?: number) => {
    try {
      return await locationRepo.findProjects(limit ?? 5);
    } catch (error) {
      console.error('Error finding project locations:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Migration 38: Check for duplicate locations before creation
   * ADR: ADR-pin-conversion-duplicate-prevention.md
   *
   * Checks by GPS proximity (≤150m) OR name similarity (≥50%)
   * Returns match info if duplicate found, null otherwise
   */
  ipcMain.handle('location:checkDuplicateByNameAndGps', async (_event, input: unknown) => {
    try {
      const InputSchema = z.object({
        name: z.string().min(1),
        lat: z.number().nullable().optional(),
        lng: z.number().nullable().optional(),
      });

      const validatedInput = InputSchema.parse(input);

      // Get all exclusions for filtering
      const exclusions = await exclusionsRepo.getAllExclusions();

      return await duplicateService.checkForDuplicate(validatedInput, exclusions);
    } catch (error) {
      console.error('Error checking for duplicates:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => e.message).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Migration 38: Record that two names refer to different places
   * ADR: ADR-pin-conversion-duplicate-prevention.md
   *
   * Prevents future duplicate prompts for this pair
   */
  ipcMain.handle('location:addExclusion', async (_event, nameA: unknown, nameB: unknown) => {
    try {
      const validatedNameA = z.string().min(1).parse(nameA);
      const validatedNameB = z.string().min(1).parse(nameB);

      const currentUser = await getCurrentUser(db);
      await exclusionsRepo.addExclusion(validatedNameA, validatedNameB, currentUser?.username);

      return { success: true };
    } catch (error) {
      console.error('Error adding exclusion:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => e.message).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Migration 38: Get count of stored exclusions (for debugging/stats)
   */
  ipcMain.handle('location:getExclusionCount', async () => {
    try {
      return await exclusionsRepo.count();
    } catch (error) {
      console.error('Error getting exclusion count:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  return locationRepo;
}
