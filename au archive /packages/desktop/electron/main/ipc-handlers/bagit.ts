/**
 * BagIt IPC Handlers
 *
 * Exposes BagIt functionality to the renderer process:
 * - bagit:regenerate - Regenerate bag for a location
 * - bagit:validate - Validate single location
 * - bagit:validateAll - Validate all locations
 * - bagit:status - Get bag status for location
 * - bagit:summary - Get summary of all bag statuses
 * - bagit:lastValidation - Get last validation date
 */

import { ipcMain, BrowserWindow } from 'electron';
import { Kysely } from 'kysely';
import { BagItService, BagLocation, MediaFile } from '../../services/bagit-service';
import { BagItIntegrityService, IntegrityProgress } from '../../services/bagit-integrity-service';
import type { Database } from '../database.types';

// Cached service instances (recreated if archive path changes)
let cachedArchivePath: string | null = null;
let bagItService: BagItService | null = null;
let integrityService: BagItIntegrityService | null = null;

/**
 * Get archive path from settings
 */
async function getArchivePath(db: Kysely<Database>): Promise<string> {
  const result = await db
    .selectFrom('settings')
    .select('value')
    .where('key', '=', 'archive_folder')
    .executeTakeFirst();

  if (!result?.value) {
    throw new Error('Archive folder not configured. Please set it in Settings.');
  }

  return result.value;
}

/**
 * Get or create BagIt service instance
 */
async function getOrCreateServices(
  db: Kysely<Database>
): Promise<{ bagIt: BagItService; integrity: BagItIntegrityService }> {
  const archivePath = await getArchivePath(db);

  // Recreate services if archive path changed
  if (archivePath !== cachedArchivePath || !bagItService || !integrityService) {
    cachedArchivePath = archivePath;
    bagItService = new BagItService(archivePath);
    integrityService = new BagItIntegrityService(db, bagItService, archivePath);

    // Set up progress callback to emit to renderer
    integrityService.setProgressCallback((progress: IntegrityProgress) => {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        win.webContents.send('bagit:progress', progress);
      }
    });
  }

  return { bagIt: bagItService, integrity: integrityService };
}

export function registerBagItHandlers(db: Kysely<Database>): void {
  /**
   * Regenerate BagIt package for a location
   */
  ipcMain.handle('bagit:regenerate', async (_event, locid: string) => {
    const { bagIt } = await getOrCreateServices(db);

    // Get location data
    const loc = await db
      .selectFrom('locs')
      .selectAll()
      .where('locid', '=', locid)
      .executeTakeFirst();

    if (!loc) {
      throw new Error(`Location not found: ${locid}`);
    }

    // Get media files
    const mediaFiles = await getMediaFilesForLocation(db, locid);

    // Convert to BagLocation
    const bagLocation = locationToBagLocation(loc);

    // Regenerate
    await bagIt.regenerateBag(bagLocation, mediaFiles);

    // Update status
    await db
      .updateTable('locs')
      .set({
        bag_status: 'valid',
        bag_last_verified: new Date().toISOString(),
        bag_last_error: null,
      })
      .where('locid', '=', locid)
      .execute();

    return { success: true };
  });

  /**
   * Validate single location's BagIt package
   */
  ipcMain.handle('bagit:validate', async (_event, locid: string) => {
    const { integrity } = await getOrCreateServices(db);
    return await integrity.validateSingleBag(locid);
  });

  /**
   * Validate all locations' BagIt packages
   */
  ipcMain.handle('bagit:validateAll', async () => {
    const { integrity } = await getOrCreateServices(db);
    return await integrity.validateAllBags();
  });

  /**
   * Get bag status for a location
   */
  ipcMain.handle('bagit:status', async (_event, locid: string) => {
    const result = await db
      .selectFrom('locs')
      .select(['bag_status', 'bag_last_verified', 'bag_last_error'])
      .where('locid', '=', locid)
      .executeTakeFirst();

    return result || { bag_status: 'none', bag_last_verified: null, bag_last_error: null };
  });

  /**
   * Get summary of all bag statuses
   */
  ipcMain.handle('bagit:summary', async () => {
    const { integrity } = await getOrCreateServices(db);
    return await integrity.getBagStatusSummary();
  });

  /**
   * Get last validation date
   */
  ipcMain.handle('bagit:lastValidation', async () => {
    const { integrity } = await getOrCreateServices(db);
    const date = await integrity.getLastValidationDate();
    return date ? date.toISOString() : null;
  });

  /**
   * Check if validation is due
   */
  ipcMain.handle('bagit:isValidationDue', async () => {
    const { integrity } = await getOrCreateServices(db);
    return await integrity.isValidationDue();
  });

  /**
   * Schedule validation if due (called on app startup)
   */
  ipcMain.handle('bagit:scheduleValidation', async () => {
    try {
      const { integrity } = await getOrCreateServices(db);
      await integrity.scheduleValidationIfDue();
      return { success: true };
    } catch (err) {
      // Archive path may not be configured yet
      console.log('[BagIt] Skipping scheduled validation:', err);
      return { success: false, error: String(err) };
    }
  });

  console.log('[IPC] BagIt handlers registered');
}

/**
 * Get BagIt service instance (for use by other modules)
 */
export function getBagItService(): BagItService | null {
  return bagItService;
}

/**
 * Get Integrity service instance (for use by other modules)
 */
export function getIntegrityService(): BagItIntegrityService | null {
  return integrityService;
}

// ============ Helper Functions ============

/**
 * Convert database location row to BagLocation interface
 * ADR-046: Removed loc12/slocnam - use locid directly
 */
function locationToBagLocation(loc: any): BagLocation {
  return {
    locid: loc.locid,
    locnam: loc.locnam,
    category: loc.category,
    access: loc.access,
    address_state: loc.address_state,
    address_city: loc.address_city,
    address_county: loc.address_county,
    address_zipcode: loc.address_zipcode,
    address_street: loc.address_street,
    gps_lat: loc.gps_lat,
    gps_lng: loc.gps_lng,
    gps_source: loc.gps_source,
    gps_verified_on_map: loc.gps_verified_on_map,
    gps_accuracy: loc.gps_accuracy,
    census_region: loc.census_region,
    census_division: loc.census_division,
    state_direction: loc.state_direction,
    cultural_region: loc.cultural_region,
    notes: loc.notes,
    locadd: loc.locadd,
    locup: loc.locup,
  };
}

/**
 * Get all media files for a location
 */
async function getMediaFilesForLocation(
  db: Kysely<Database>,
  locid: string
): Promise<MediaFile[]> {
  const files: MediaFile[] = [];
  const fs = await import('fs/promises');

  // Get images
  const images = await db
    .selectFrom('imgs')
    .select(['imghash', 'imgloc'])
    .where('locid', '=', locid)
    .where('hidden', '=', 0)
    .execute();

  for (const img of images) {
    try {
      const stats = await fs.stat(img.imgloc);
      files.push({
        hash: img.imghash,
        path: img.imgloc,
        type: 'image',
        size: stats.size,
      });
    } catch {
      // File doesn't exist, skip
    }
  }

  // Get videos
  const videos = await db
    .selectFrom('vids')
    .select(['vidhash', 'vidloc'])
    .where('locid', '=', locid)
    .where('hidden', '=', 0)
    .execute();

  for (const vid of videos) {
    try {
      const stats = await fs.stat(vid.vidloc);
      files.push({
        hash: vid.vidhash,
        path: vid.vidloc,
        type: 'video',
        size: stats.size,
      });
    } catch {
      // File doesn't exist
    }
  }

  // Get documents
  const docs = await db
    .selectFrom('docs')
    .select(['dochash', 'docloc'])
    .where('locid', '=', locid)
    .where('hidden', '=', 0)
    .execute();

  for (const doc of docs) {
    try {
      const stats = await fs.stat(doc.docloc);
      files.push({
        hash: doc.dochash,
        path: doc.docloc,
        type: 'document',
        size: stats.size,
      });
    } catch {
      // File doesn't exist
    }
  }

  // Get maps
  const maps = await db
    .selectFrom('maps')
    .select(['maphash', 'maploc'])
    .where('locid', '=', locid)
    .execute();

  for (const map of maps) {
    try {
      const stats = await fs.stat(map.maploc);
      files.push({
        hash: map.maphash,
        path: map.maploc,
        type: 'map',
        size: stats.size,
      });
    } catch {
      // File doesn't exist
    }
  }

  return files;
}
