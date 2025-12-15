/**
 * Import Intelligence IPC Handlers
 * ADR-046: Updated locid validation from UUID to BLAKE3 16-char hex
 *
 * Handles import-intelligence:* IPC channels for smart location matching.
 */

import { ipcMain } from 'electron';
import { z } from 'zod';
import { Blake3IdSchema } from '../ipc-validation';
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';
import { ImportIntelligenceService } from '../../services/import-intelligence-service';

export function registerImportIntelligenceHandlers(db: Kysely<Database>) {
  const intelligenceService = new ImportIntelligenceService(db);

  /**
   * Scan archive for matches near a GPS point
   * This is the main intelligence entry point
   */
  ipcMain.handle(
    'import-intelligence:scan',
    async (
      _event,
      lat: number,
      lng: number,
      hints?: { filename?: string; inferredType?: string; inferredState?: string },
      excludeRefPointId?: string | null
    ) => {
      try {
        // Validate GPS coordinates
        if (typeof lat !== 'number' || lat < -90 || lat > 90) {
          throw new Error('Invalid latitude');
        }
        if (typeof lng !== 'number' || lng < -180 || lng > 180) {
          throw new Error('Invalid longitude');
        }

        const result = await intelligenceService.scan(lat, lng, hints, excludeRefPointId);

        console.log(
          `[Import Intelligence] Scanned ${result.scanned.locations} locations, ` +
            `${result.scanned.sublocations} sub-locations, ${result.scanned.refmaps} ref points. ` +
            `Found ${result.matches.length} matches in ${result.scanTimeMs}ms` +
            (excludeRefPointId ? ` (excluding ref point ${excludeRefPointId})` : '')
        );

        return result;
      } catch (error) {
        console.error('[Import Intelligence] Scan error:', error);
        const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
      }
    }
  );

  /**
   * Add an AKA name to an existing location
   * Used when user confirms a new name is an alias for existing location
   */
  ipcMain.handle('import-intelligence:addAkaName', async (_event, locid: unknown, newName: unknown) => {
    try {
      const validatedLocid = Blake3IdSchema.parse(locid);
      const validatedName = z.string().min(1).max(500).parse(newName);

      await intelligenceService.addAkaName(validatedLocid, validatedName);

      console.log(`[Import Intelligence] Added AKA name "${validatedName}" to location ${validatedLocid}`);

      return { success: true };
    } catch (error) {
      console.error('[Import Intelligence] Add AKA error:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map((e) => e.message).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Quick check if GPS point is near any existing locations
   * Lighter-weight than full scan - just returns boolean + count
   */
  ipcMain.handle('import-intelligence:hasNearby', async (_event, lat: number, lng: number) => {
    try {
      if (typeof lat !== 'number' || lat < -90 || lat > 90) {
        throw new Error('Invalid latitude');
      }
      if (typeof lng !== 'number' || lng < -180 || lng > 180) {
        throw new Error('Invalid longitude');
      }

      const result = await intelligenceService.scan(lat, lng);

      return {
        hasNearby: result.matches.length > 0,
        count: result.matches.length,
        topMatch: result.matches[0] || null,
      };
    } catch (error) {
      console.error('[Import Intelligence] hasNearby error:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  return intelligenceService;
}
