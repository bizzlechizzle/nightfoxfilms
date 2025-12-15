/**
 * Geocoding IPC Handlers
 * Handles geocode:* IPC channels
 * Kanye9: Added cascade geocoding for zipcode-only and county-only support
 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';
import { GeocodingService } from '../../services/geocoding-service';
import { AddressService, type NormalizedAddress } from '../../services/address-service';

export function registerGeocodeHandlers(db: Kysely<Database>) {
  const geocodingService = new GeocodingService(db);

  // Initialize geocoding cache table
  geocodingService.initCache().catch((error) => {
    console.warn('Failed to initialize geocoding cache:', error);
  });

  ipcMain.handle('geocode:reverse', async (_event, lat: unknown, lng: unknown) => {
    try {
      const GeoInputSchema = z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      });

      const { lat: validLat, lng: validLng } = GeoInputSchema.parse({ lat, lng });
      const result = await geocodingService.reverseGeocode(validLat, validLng);

      if (!result) {
        return null;
      }

      return {
        lat: result.lat,
        lng: result.lng,
        displayName: result.displayName,
        address: result.address,
        confidence: result.confidence,
        source: result.source,
      };
    } catch (error) {
      console.error('Error reverse geocoding:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('geocode:forward', async (_event, address: unknown) => {
    try {
      const validAddress = z.string().min(3).max(500).parse(address);
      const result = await geocodingService.forwardGeocode(validAddress);

      if (!result) {
        return null;
      }

      return {
        lat: result.lat,
        lng: result.lng,
        displayName: result.displayName,
        address: result.address,
        confidence: result.confidence,
        source: result.source,
      };
    } catch (error) {
      console.error('Error forward geocoding:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Kanye9: Cascade geocoding - tries multiple query strategies until one succeeds
   * Supports: full address → city+state → zipcode → county+state → state only
   */
  ipcMain.handle('geocode:forwardCascade', async (_event, address: unknown) => {
    try {
      // Validate input as NormalizedAddress
      const AddressSchema = z.object({
        street: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        county: z.string().nullable().optional(),
        state: z.string().nullable().optional(),
        zipcode: z.string().nullable().optional(),
      });

      const validAddress = AddressSchema.parse(address) as NormalizedAddress;

      // Get cascade queries from AddressService
      const queries = AddressService.getGeocodingCascade(validAddress);

      if (queries.length === 0) {
        console.log('[Geocode] No valid queries for cascade geocoding');
        return null;
      }

      console.log(`[Geocode] Cascade geocoding with ${queries.length} queries:`, queries);

      // Try each query until one succeeds
      for (const query of queries) {
        try {
          const result = await geocodingService.forwardGeocode(query);

          if (result?.lat && result?.lng) {
            const tier = AddressService.getGeocodingTier(validAddress, query);
            console.log(`[Geocode] Cascade success at tier ${tier.tier}: ${tier.description}`);

            return {
              lat: result.lat,
              lng: result.lng,
              displayName: result.displayName,
              address: result.address,
              confidence: result.confidence,
              source: result.source,
              // Cascade metadata
              cascadeTier: tier.tier,
              cascadeDescription: tier.description,
              cascadeQuery: query,
              expectedAccuracy: tier.expectedAccuracy,
            };
          }
        } catch (err) {
          // Continue to next query on failure
          console.log(`[Geocode] Query "${query}" failed, trying next...`);
        }
      }

      console.log('[Geocode] All cascade queries failed');
      return null;
    } catch (error) {
      console.error('Error in cascade geocoding:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('geocode:clearCache', async (_event, daysOld: unknown = 90) => {
    try {
      const validDays = z.number().int().positive().max(365).parse(daysOld);
      const deleted = await geocodingService.clearOldCache(validDays);
      return { deleted };
    } catch (error) {
      console.error('Error clearing geocode cache:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  return geocodingService;
}
