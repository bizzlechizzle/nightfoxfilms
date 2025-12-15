/**
 * BagIt Integrity Service - Background Validation Scheduler
 *
 * Handles weekly integrity checks of all location BagIt packages.
 * Validates checksums, updates bag_status in database, and reports errors.
 *
 * Schedule:
 * - Runs on app launch if >7 days since last check
 * - Can be triggered manually via IPC
 * - Non-blocking background operation
 */

import { Kysely } from 'kysely';
import { BagItService, BagStatus, BagValidationResult, MediaFile, BagLocation, BagSubLocation } from './bagit-service';
import type { Database } from '../main/database.types';

const VALIDATION_INTERVAL_DAYS = 7;

export interface IntegrityCheckResult {
  totalLocations: number;
  validCount: number;
  incompleteCount: number;
  invalidCount: number;
  noneCount: number;
  errors: Array<{ locid: string; locnam: string; error: string }>;
  durationMs: number;
}

export interface IntegrityProgress {
  current: number;
  total: number;
  currentLocation: string;
  status: 'running' | 'complete' | 'error';
}

export class BagItIntegrityService {
  private isRunning = false;
  private progressCallback?: (progress: IntegrityProgress) => void;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly bagItService: BagItService,
    private readonly archivePath: string
  ) {}

  /**
   * Check if validation is due (>7 days since last check)
   */
  async isValidationDue(): Promise<boolean> {
    try {
      const result = await this.db
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'bagit_last_validation')
        .executeTakeFirst();

      if (!result) {
        return true; // Never validated
      }

      const lastValidation = new Date(result.value);
      const now = new Date();
      const daysSince = (now.getTime() - lastValidation.getTime()) / (1000 * 60 * 60 * 24);

      return daysSince >= VALIDATION_INTERVAL_DAYS;
    } catch {
      return true; // Error reading setting, run validation
    }
  }

  /**
   * Schedule validation if due
   * Called on app startup
   */
  async scheduleValidationIfDue(): Promise<void> {
    if (await this.isValidationDue()) {
      console.log('[BagIt] Validation due, starting background check...');
      // Run in background, don't await
      this.validateAllBags().catch((err) => {
        console.error('[BagIt] Background validation failed:', err);
      });
    } else {
      console.log('[BagIt] Validation not due, skipping');
    }
  }

  /**
   * Set progress callback for UI updates
   */
  setProgressCallback(callback: (progress: IntegrityProgress) => void): void {
    this.progressCallback = callback;
  }

  /**
   * Validate all locations' BagIt packages
   */
  async validateAllBags(): Promise<IntegrityCheckResult> {
    if (this.isRunning) {
      throw new Error('Validation already in progress');
    }

    this.isRunning = true;
    const startTime = Date.now();

    const result: IntegrityCheckResult = {
      totalLocations: 0,
      validCount: 0,
      incompleteCount: 0,
      invalidCount: 0,
      noneCount: 0,
      errors: [],
      durationMs: 0,
    };

    try {
      // Get all locations
      const locations = await this.db
        .selectFrom('locs')
        .select([
          'locid',
          'locnam',
          'category',
          'access',
          'address_state',
          'address_city',
          'address_county',
          'address_zipcode',
          'address_street',
          'gps_lat',
          'gps_lng',
          'gps_source',
          'gps_verified_on_map',
          'gps_accuracy',
          'census_region',
          'census_division',
          'state_direction',
          'cultural_region',
        ])
        .execute();

      result.totalLocations = locations.length;

      for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];

        // Report progress
        if (this.progressCallback) {
          this.progressCallback({
            current: i + 1,
            total: locations.length,
            currentLocation: loc.locnam,
            status: 'running',
          });
        }

        try {
          // Get media files for this location
          const mediaFiles = await this.getMediaFilesForLocation(loc.locid);

          // ADR-046: Convert DB row to BagLocation (removed loc12/slocnam)
          const bagLocation: BagLocation = {
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
          };

          // Use quick validation for scheduled checks
          const validationResult = await this.bagItService.quickValidate(bagLocation, mediaFiles);

          // Update database
          await this.updateBagStatus(loc.locid, validationResult);

          // Count results
          switch (validationResult.status) {
            case 'valid':
              result.validCount++;
              break;
            case 'incomplete':
              result.incompleteCount++;
              break;
            case 'invalid':
              result.invalidCount++;
              result.errors.push({
                locid: loc.locid,
                locnam: loc.locnam,
                error: validationResult.error || 'Unknown error',
              });
              break;
            case 'none':
              result.noneCount++;
              break;
          }
        } catch (err) {
          result.invalidCount++;
          result.errors.push({
            locid: loc.locid,
            locnam: loc.locnam,
            error: String(err),
          });

          // Update database with error
          await this.updateBagStatus(loc.locid, {
            status: 'invalid',
            error: String(err),
          });
        }
      }

      // Update last validation time
      await this.db
        .insertInto('settings')
        .values({ key: 'bagit_last_validation', value: new Date().toISOString() })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: new Date().toISOString() }))
        .execute();

      result.durationMs = Date.now() - startTime;

      // Report completion
      if (this.progressCallback) {
        this.progressCallback({
          current: locations.length,
          total: locations.length,
          currentLocation: '',
          status: 'complete',
        });
      }

      console.log(
        `[BagIt] Validation complete: ${result.validCount} valid, ${result.incompleteCount} incomplete, ${result.invalidCount} invalid, ${result.noneCount} no bag (${result.durationMs}ms)`
      );

      return result;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Validate a single location's BagIt package (full validation)
   */
  async validateSingleBag(locid: string): Promise<BagValidationResult> {
    // Get location
    const loc = await this.db
      .selectFrom('locs')
      .select([
        'locid',
        'locnam',
        'category',
        'access',
        'address_state',
        'address_city',
        'address_county',
        'address_zipcode',
        'address_street',
        'gps_lat',
        'gps_lng',
        'gps_source',
        'gps_verified_on_map',
        'gps_accuracy',
        'census_region',
        'census_division',
        'state_direction',
        'cultural_region',
      ])
      .where('locid', '=', locid)
      .executeTakeFirst();

    if (!loc) {
      throw new Error(`Location not found: ${locid}`);
    }

    // Get media files
    const mediaFiles = await this.getMediaFilesForLocation(locid);

    // ADR-046: Convert to BagLocation (removed loc12/slocnam)
    const bagLocation: BagLocation = {
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
    };

    // Full validation
    const result = await this.bagItService.validateBag(bagLocation, mediaFiles);

    // Update database
    await this.updateBagStatus(locid, result);

    return result;
  }

  /**
   * OPT-093: Validate a single sub-location's BagIt package (full validation)
   * ADR-046: Removed sub12/loc12/slocnam references
   */
  async validateSubLocationBag(subid: string): Promise<BagValidationResult> {
    // Get sub-location with parent info (ADR-046: removed sub12)
    const subloc = await this.db
      .selectFrom('slocs')
      .select([
        'subid',
        'subnam',
        'ssubname',
        'category',
        'status',
        'gps_lat',
        'gps_lng',
        'gps_source',
        'gps_verified_on_map',
        'gps_accuracy',
        'locid',
        'created_date',
        'modified_date',
      ])
      .where('subid', '=', subid)
      .executeTakeFirst();

    if (!subloc) {
      throw new Error(`Sub-location not found: ${subid}`);
    }

    // Get parent location info for path construction (ADR-046: removed loc12/slocnam)
    const parentLoc = await this.db
      .selectFrom('locs')
      .select(['locid', 'locnam', 'category', 'address_state'])
      .where('locid', '=', subloc.locid)
      .executeTakeFirst();

    if (!parentLoc) {
      throw new Error(`Parent location not found for sub-location: ${subid}`);
    }

    // Get media files for this sub-location
    const mediaFiles = await this.getMediaFilesForSubLocation(subid);

    // ADR-046: Convert to BagSubLocation (removed sub12/parentLoc12/parentSlocnam)
    const bagSubLocation: BagSubLocation = {
      subid: subloc.subid,
      subnam: subloc.subnam,
      ssubname: subloc.ssubname,
      category: subloc.category,
      status: subloc.status,
      gps_lat: subloc.gps_lat,
      gps_lng: subloc.gps_lng,
      gps_source: subloc.gps_source,
      gps_verified_on_map: subloc.gps_verified_on_map,
      gps_accuracy: subloc.gps_accuracy,
      created_date: subloc.created_date,
      modified_date: subloc.modified_date,
      parentLocid: parentLoc.locid,
      parentLocnam: parentLoc.locnam,
      parentCategory: parentLoc.category,
      parentState: parentLoc.address_state,
    };

    // Full validation using sub-location specific method
    const result = await this.bagItService.validateSubLocationBag(bagSubLocation, mediaFiles);

    // Update sub-location bag status
    await this.updateSubLocationBagStatus(subid, result);

    return result;
  }

  /**
   * OPT-093: Update a sub-location's BagIt manifest after import
   * ADR-046: Removed sub12/loc12/slocnam references
   */
  async updateSubLocationManifest(subid: string): Promise<void> {
    // Get sub-location with parent info (ADR-046: removed sub12)
    const subloc = await this.db
      .selectFrom('slocs')
      .select([
        'subid',
        'subnam',
        'ssubname',
        'category',
        'status',
        'gps_lat',
        'gps_lng',
        'gps_source',
        'gps_verified_on_map',
        'gps_accuracy',
        'locid',
        'created_date',
        'modified_date',
      ])
      .where('subid', '=', subid)
      .executeTakeFirst();

    if (!subloc) {
      throw new Error(`Sub-location not found: ${subid}`);
    }

    // Get parent location info for path construction (ADR-046: removed loc12/slocnam)
    const parentLoc = await this.db
      .selectFrom('locs')
      .select(['locid', 'locnam', 'category', 'address_state'])
      .where('locid', '=', subloc.locid)
      .executeTakeFirst();

    if (!parentLoc) {
      throw new Error(`Parent location not found for sub-location: ${subid}`);
    }

    // Get media files for this sub-location
    const mediaFiles = await this.getMediaFilesForSubLocation(subid);

    // ADR-046: Convert to BagSubLocation (removed sub12/parentLoc12/parentSlocnam)
    const bagSubLocation: BagSubLocation = {
      subid: subloc.subid,
      subnam: subloc.subnam,
      ssubname: subloc.ssubname,
      category: subloc.category,
      status: subloc.status,
      gps_lat: subloc.gps_lat,
      gps_lng: subloc.gps_lng,
      gps_source: subloc.gps_source,
      gps_verified_on_map: subloc.gps_verified_on_map,
      gps_accuracy: subloc.gps_accuracy,
      created_date: subloc.created_date,
      modified_date: subloc.modified_date,
      parentLocid: parentLoc.locid,
      parentLocnam: parentLoc.locnam,
      parentCategory: parentLoc.category,
      parentState: parentLoc.address_state,
    };

    // Update manifest
    await this.bagItService.updateSubLocationManifest(bagSubLocation, mediaFiles);

    // Set bag status to valid after update
    await this.updateSubLocationBagStatus(subid, { status: 'valid' });
  }

  /**
   * Get the last validation date
   */
  async getLastValidationDate(): Promise<Date | null> {
    const result = await this.db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'bagit_last_validation')
      .executeTakeFirst();

    return result ? new Date(result.value) : null;
  }

  /**
   * Get summary of bag statuses across all locations
   */
  async getBagStatusSummary(): Promise<{
    valid: number;
    incomplete: number;
    invalid: number;
    none: number;
  }> {
    const results = await this.db
      .selectFrom('locs')
      .select([(eb) => eb.fn.count<number>('locid').as('count'), 'bag_status'])
      .groupBy('bag_status')
      .execute();

    const summary = { valid: 0, complete: 0, incomplete: 0, invalid: 0, none: 0 };

    for (const row of results) {
      const status = (row.bag_status || 'none') as BagStatus;
      if (status in summary) {
        summary[status] = Number(row.count);
      }
    }

    return summary;
  }

  // ============ Private Methods ============

  /**
   * Get all media files for a location
   */
  private async getMediaFilesForLocation(locid: string): Promise<MediaFile[]> {
    const files: MediaFile[] = [];

    // Get images
    const images = await this.db
      .selectFrom('imgs')
      .select(['imghash', 'imgloc'])
      .where('locid', '=', locid)
      .where('hidden', '=', 0)
      .execute();

    for (const img of images) {
      try {
        const stats = await import('fs/promises').then((fs) => fs.stat(img.imgloc));
        files.push({
          hash: img.imghash,
          path: img.imgloc,
          type: 'image',
          size: stats.size,
        });
      } catch {
        // File doesn't exist, will be caught in validation
      }
    }

    // Get videos
    const videos = await this.db
      .selectFrom('vids')
      .select(['vidhash', 'vidloc'])
      .where('locid', '=', locid)
      .where('hidden', '=', 0)
      .execute();

    for (const vid of videos) {
      try {
        const stats = await import('fs/promises').then((fs) => fs.stat(vid.vidloc));
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
    const docs = await this.db
      .selectFrom('docs')
      .select(['dochash', 'docloc'])
      .where('locid', '=', locid)
      .where('hidden', '=', 0)
      .execute();

    for (const doc of docs) {
      try {
        const stats = await import('fs/promises').then((fs) => fs.stat(doc.docloc));
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
    const maps = await this.db
      .selectFrom('maps')
      .select(['maphash', 'maploc'])
      .where('locid', '=', locid)
      .execute();

    for (const map of maps) {
      try {
        const stats = await import('fs/promises').then((fs) => fs.stat(map.maploc));
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

  /**
   * Update bag status in database
   */
  private async updateBagStatus(locid: string, result: BagValidationResult): Promise<void> {
    await this.db
      .updateTable('locs')
      .set({
        bag_status: result.status,
        bag_last_verified: new Date().toISOString(),
        bag_last_error: result.error || null,
      })
      .where('locid', '=', locid)
      .execute();
  }

  /**
   * OPT-093: Get all media files for a sub-location
   */
  private async getMediaFilesForSubLocation(subid: string): Promise<MediaFile[]> {
    const files: MediaFile[] = [];

    // Get images
    const images = await this.db
      .selectFrom('imgs')
      .select(['imghash', 'imgloc'])
      .where('subid', '=', subid)
      .where('hidden', '=', 0)
      .execute();

    for (const img of images) {
      try {
        const stats = await import('fs/promises').then((fs) => fs.stat(img.imgloc));
        files.push({
          hash: img.imghash,
          path: img.imgloc,
          type: 'image',
          size: stats.size,
        });
      } catch {
        // File doesn't exist, will be caught in validation
      }
    }

    // Get videos
    const videos = await this.db
      .selectFrom('vids')
      .select(['vidhash', 'vidloc'])
      .where('subid', '=', subid)
      .where('hidden', '=', 0)
      .execute();

    for (const vid of videos) {
      try {
        const stats = await import('fs/promises').then((fs) => fs.stat(vid.vidloc));
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
    const docs = await this.db
      .selectFrom('docs')
      .select(['dochash', 'docloc'])
      .where('subid', '=', subid)
      .where('hidden', '=', 0)
      .execute();

    for (const doc of docs) {
      try {
        const stats = await import('fs/promises').then((fs) => fs.stat(doc.docloc));
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
    const maps = await this.db
      .selectFrom('maps')
      .select(['maphash', 'maploc'])
      .where('subid', '=', subid)
      .execute();

    for (const map of maps) {
      try {
        const stats = await import('fs/promises').then((fs) => fs.stat(map.maploc));
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

  /**
   * OPT-093: Update sub-location bag status in database
   * Note: slocs table will need bag_status, bag_last_verified, bag_last_error columns
   * These are added in Migration 56 along with stats columns
   */
  private async updateSubLocationBagStatus(subid: string, result: BagValidationResult): Promise<void> {
    // Note: This requires the slocs table to have bag_* columns
    // If migration hasn't added them, this will silently fail
    try {
      await this.db
        .updateTable('slocs')
        .set({
          bag_status: result.status,
          bag_last_verified: new Date().toISOString(),
          bag_last_error: result.error || null,
        })
        .where('subid', '=', subid)
        .execute();
    } catch (err) {
      // Columns may not exist yet - log and continue
      console.log(`[BagIt] Could not update sub-location bag status (columns may not exist): ${err}`);
    }
  }
}
