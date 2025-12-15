import Database from 'better-sqlite3';
import { getDatabasePath, getDatabase } from '../main/database';
import { getLogger } from './logger-service';
// OPT-037: Import enrichment services for GPS/address gap repair
import { GeocodingService } from './geocoding-service';
import { LocationEnrichmentService, GPSSource } from './location-enrichment-service';

const logger = getLogger();

export interface IntegrityResult {
  isHealthy: boolean;
  errors: string[];
  warnings: string[];
  timestamp: string;
  checkDuration: number;
}

/**
 * Required tables that must exist for a healthy database
 */
const REQUIRED_TABLES = ['locs', 'slocs', 'imgs', 'vids', 'docs', 'maps'];

/**
 * Database integrity verification service
 * Runs PRAGMA integrity_check and foreign_key_check
 * FIX: Also verifies required tables exist (empty DB = unhealthy)
 */
export class IntegrityChecker {
  private lastCheckTime: Date | null = null;
  private lastResult: IntegrityResult | null = null;

  /**
   * Check if required schema tables exist
   */
  private checkRequiredTables(db: Database.Database): string[] {
    const errors: string[] = [];
    const tables = db.pragma('table_list') as Array<{ name: string }>;
    const tableNames = tables.map(t => t.name);

    for (const required of REQUIRED_TABLES) {
      if (!tableNames.includes(required)) {
        errors.push(`Required table "${required}" is missing`);
      }
    }

    return errors;
  }

  async runFullCheck(): Promise<IntegrityResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];

    logger.info('IntegrityChecker', 'Starting full integrity check');

    try {
      const dbPath = getDatabasePath();
      const db = new Database(dbPath, { readonly: true });

      try {
        // Check required tables exist first
        const tableErrors = this.checkRequiredTables(db);
        errors.push(...tableErrors);

        // Run integrity check
        const integrityResults = db.pragma('integrity_check') as Array<{ integrity_check: string }>;

        if (integrityResults.length > 0) {
          integrityResults.forEach((row) => {
            const result = row.integrity_check;
            if (result !== 'ok') {
              errors.push(`Integrity check failed: ${result}`);
            }
          });
        }

        // Run foreign key check
        const fkResults = db.pragma('foreign_key_check') as Array<{
          table: string;
          rowid: number;
          parent: string;
          fkid: number;
        }>;

        if (fkResults.length > 0) {
          fkResults.forEach((row) => {
            errors.push(
              `Foreign key violation in table ${row.table}, rowid ${row.rowid}, parent ${row.parent}`
            );
          });
        }

        // Check for suspicious database size
        const pageCount = db.pragma('page_count', { simple: true }) as number;
        const pageSize = db.pragma('page_size', { simple: true }) as number;
        const dbSize = pageCount * pageSize;

        if (dbSize > 5 * 1024 * 1024 * 1024) {
          // > 5GB
          warnings.push('Database size is very large (>5GB), consider optimization');
        }

        // Check WAL file size
        const walSize = db.pragma('wal_checkpoint(PASSIVE)') as number[];
        if (walSize && walSize[0] > 10000) {
          // > 10000 pages
          warnings.push('WAL file is large, checkpoint recommended');
        }
      } finally {
        db.close();
      }
    } catch (error) {
      logger.error('IntegrityChecker', 'Integrity check failed', error as Error);
      errors.push(`Integrity check error: ${(error as Error).message}`);
    }

    const duration = Date.now() - startTime;
    const result: IntegrityResult = {
      isHealthy: errors.length === 0,
      errors,
      warnings,
      timestamp: new Date().toISOString(),
      checkDuration: duration,
    };

    this.lastCheckTime = new Date();
    this.lastResult = result;

    if (errors.length > 0) {
      logger.error('IntegrityChecker', 'Database integrity issues found', undefined, {
        errors,
        duration,
      });
    } else {
      logger.info('IntegrityChecker', 'Integrity check passed', {
        warnings: warnings.length,
        duration,
      });
    }

    return result;
  }

  async runQuickCheck(): Promise<IntegrityResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];

    logger.debug('IntegrityChecker', 'Running quick integrity check');

    try {
      const dbPath = getDatabasePath();
      const db = new Database(dbPath, { readonly: true });

      try {
        // Check required tables exist first
        const tableErrors = this.checkRequiredTables(db);
        errors.push(...tableErrors);

        // Quick integrity check (first 100 pages)
        const result = db.pragma('quick_check(100)', { simple: true }) as string;

        if (result !== 'ok') {
          errors.push(`Quick check failed: ${result}`);
        }

        // Foreign key check
        const fkResults = db.pragma('foreign_key_check') as Array<{
          table: string;
          rowid: number;
          parent: string;
          fkid: number;
        }>;

        if (fkResults.length > 0) {
          errors.push(`Found ${fkResults.length} foreign key violations`);
        }
      } finally {
        db.close();
      }
    } catch (error) {
      logger.error('IntegrityChecker', 'Quick check failed', error as Error);
      errors.push(`Quick check error: ${(error as Error).message}`);
    }

    const duration = Date.now() - startTime;
    const result: IntegrityResult = {
      isHealthy: errors.length === 0,
      errors,
      warnings,
      timestamp: new Date().toISOString(),
      checkDuration: duration,
    };

    this.lastResult = result;

    return result;
  }

  async verifyBackupFile(backupPath: string): Promise<IntegrityResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];

    logger.info('IntegrityChecker', 'Verifying backup file', { path: backupPath });

    try {
      const db = new Database(backupPath, { readonly: true });

      try {
        // Run integrity check on backup
        const integrityResults = db.pragma('integrity_check') as Array<{ integrity_check: string }>;

        if (integrityResults.length > 0) {
          integrityResults.forEach((row) => {
            const result = row.integrity_check;
            if (result !== 'ok') {
              errors.push(`Backup integrity check failed: ${result}`);
            }
          });
        }

        // Verify table counts
        const tables = db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
          )
          .all() as Array<{ name: string }>;

        if (tables.length === 0) {
          errors.push('Backup contains no tables');
        }
      } finally {
        db.close();
      }
    } catch (error) {
      logger.error('IntegrityChecker', 'Backup verification failed', error as Error, {
        path: backupPath,
      });
      errors.push(`Backup verification error: ${(error as Error).message}`);
    }

    const duration = Date.now() - startTime;
    const result: IntegrityResult = {
      isHealthy: errors.length === 0,
      errors,
      warnings,
      timestamp: new Date().toISOString(),
      checkDuration: duration,
    };

    if (errors.length > 0) {
      logger.error('IntegrityChecker', 'Backup file is corrupt', undefined, {
        path: backupPath,
        errors,
      });
    } else {
      logger.info('IntegrityChecker', 'Backup file verified successfully', {
        path: backupPath,
        duration,
      });
    }

    return result;
  }

  /**
   * Check for locations with GPS but missing region fields.
   * This catches the "silent enrichment failure" where GPS was applied
   * but geocoding/region calculation failed.
   */
  async checkLocationDataIntegrity(): Promise<{
    locationsWithGpsNoRegions: Array<{
      locid: string;
      locnam: string;
      address_state: string | null;
      gps_lat: number;
      gps_lng: number;
    }>;
    count: number;
  }> {
    logger.info('IntegrityChecker', 'Checking location data integrity (GPS vs regions)');

    try {
      const dbPath = getDatabasePath();
      const db = new Database(dbPath, { readonly: true });

      try {
        // Find locations with GPS but missing region fields
        const results = db.prepare(`
          SELECT locid, locnam, address_state, gps_lat, gps_lng,
                 census_region, state_direction, cultural_region
          FROM locs
          WHERE gps_lat IS NOT NULL
            AND gps_lng IS NOT NULL
            AND (census_region IS NULL OR state_direction IS NULL)
          ORDER BY locnam
          LIMIT 100
        `).all() as Array<{
          locid: string;
          locnam: string;
          address_state: string | null;
          gps_lat: number;
          gps_lng: number;
          census_region: string | null;
          state_direction: string | null;
          cultural_region: string | null;
        }>;

        // Get total count
        const countResult = db.prepare(`
          SELECT COUNT(*) as count
          FROM locs
          WHERE gps_lat IS NOT NULL
            AND gps_lng IS NOT NULL
            AND (census_region IS NULL OR state_direction IS NULL)
        `).get() as { count: number };

        if (results.length > 0) {
          logger.warn('IntegrityChecker', `Found ${countResult.count} locations with GPS but missing regions`, {
            sampleLocations: results.slice(0, 5).map(r => r.locnam),
          });
        } else {
          logger.info('IntegrityChecker', 'All locations with GPS have region fields populated');
        }

        return {
          locationsWithGpsNoRegions: results.map(r => ({
            locid: r.locid,
            locnam: r.locnam,
            address_state: r.address_state,
            gps_lat: r.gps_lat,
            gps_lng: r.gps_lng,
          })),
          count: countResult.count,
        };
      } finally {
        db.close();
      }
    } catch (error) {
      logger.error('IntegrityChecker', 'Location data integrity check failed', error as Error);
      return {
        locationsWithGpsNoRegions: [],
        count: 0,
      };
    }
  }

  getLastCheckResult(): IntegrityResult | null {
    return this.lastResult;
  }

  getLastCheckTime(): Date | null {
    return this.lastCheckTime;
  }

  shouldRunCheck(): boolean {
    if (!this.lastCheckTime) {
      return true;
    }

    const hoursSinceLastCheck =
      (Date.now() - this.lastCheckTime.getTime()) / (1000 * 60 * 60);

    // Run check every 6 hours
    return hoursSinceLastCheck >= 6;
  }

  /**
   * OPT-037: Check and fix GPS/address consistency gaps
   *
   * Finds locations that have GPS coordinates but are missing address data
   * (specifically county, which is needed for cultural region calculation).
   * Auto-repairs by running reverse geocoding + region enrichment.
   *
   * This is a self-healing mechanism that catches locations that were created
   * before repository-level enrichment was implemented, or where enrichment
   * failed during creation.
   *
   * @returns Summary of found gaps and repair results
   */
  async checkGpsAddressConsistency(): Promise<{
    found: number;
    fixed: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let found = 0;
    let fixed = 0;

    logger.info('IntegrityChecker', 'Starting GPS/address consistency check');

    try {
      const dbPath = getDatabasePath();
      const db = new Database(dbPath);

      // Find locations with GPS but no county (indicates missing geocode)
      const gaps = db.prepare(`
        SELECT locid, locnam, gps_lat, gps_lng, address_state, gps_source
        FROM locs
        WHERE gps_lat IS NOT NULL
          AND gps_lng IS NOT NULL
          AND (address_county IS NULL OR address_county = '')
      `).all() as Array<{
        locid: string;
        locnam: string;
        gps_lat: number;
        gps_lng: number;
        address_state: string | null;
        gps_source: string | null;
      }>;

      found = gaps.length;
      db.close();

      if (found > 0) {
        logger.warn('IntegrityChecker', `Found ${found} locations with GPS but no address`, {
          locations: gaps.map(g => g.locnam).slice(0, 10), // Log first 10
        });

        // Use Kysely connection for enrichment
        const kyselyDb = getDatabase();
        const geocodingService = new GeocodingService(kyselyDb);
        const enrichmentService = new LocationEnrichmentService(kyselyDb, geocodingService);

        for (const gap of gaps) {
          try {
            // Use existing GPS source or default to 'integrity_fix'
            const source: GPSSource = (gap.gps_source as GPSSource) || 'manual';

            await enrichmentService.enrichFromGPS(gap.locid, {
              lat: gap.gps_lat,
              lng: gap.gps_lng,
              source,
              stateHint: gap.address_state,
            });
            fixed++;
            logger.info('IntegrityChecker', `Fixed GPS/address gap for: ${gap.locnam}`);
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            errors.push(`Failed to fix ${gap.locnam}: ${errMsg}`);
            logger.warn('IntegrityChecker', `Failed to fix gap for ${gap.locnam}`, { error: errMsg });
          }
        }

        logger.info('IntegrityChecker', `GPS/address consistency check complete`, {
          found,
          fixed,
          errors: errors.length,
        });
      } else {
        logger.info('IntegrityChecker', 'No GPS/address gaps found');
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      errors.push(`GPS consistency check error: ${errMsg}`);
      logger.error('IntegrityChecker', 'GPS consistency check failed', error as Error);
    }

    return { found, fixed, errors };
  }
}

// Singleton instance
let checkerInstance: IntegrityChecker | null = null;

export function getIntegrityChecker(): IntegrityChecker {
  if (!checkerInstance) {
    checkerInstance = new IntegrityChecker();
  }
  return checkerInstance;
}
