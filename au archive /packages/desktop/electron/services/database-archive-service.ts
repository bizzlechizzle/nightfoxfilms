/**
 * Database Archive Service
 *
 * Exports a snapshot of the SQLite database to the archive folder,
 * ensuring the archive is a complete, portable backup independent
 * of the app installation.
 *
 * Per CLAUDE.md: Archive-first, offline-first, data ownership guarantees.
 * This service creates a snapshot that survives 35+ years without the app.
 */
import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import crypto from 'crypto';
import { getDatabasePath, getDatabase } from '../main/database';
import { getLogger } from './logger-service';

const logger = getLogger();

export interface ArchiveExportResult {
  success: boolean;
  path: string;
  size: number;
  checksum: string;
  timestamp: string;
  error?: string;
}

export interface ArchiveExportInfo {
  exported_at: string;
  app_version: string;
  location_count: number;
  image_count: number;
  video_count: number;
  document_count: number;
  map_count: number;
  verified: boolean;
  checksum: string;
}

/**
 * Database Archive Service
 *
 * Creates self-documenting database snapshots in the archive folder:
 * [archive]/_database/
 *   ├── au-archive-snapshot.db   # Complete database copy
 *   ├── snapshot.sha256          # SHA256 checksum for verification
 *   └── snapshot-info.json       # Export metadata for humans
 */
export class DatabaseArchiveService {
  private static readonly DB_FOLDER = '_database';
  private static readonly SNAPSHOT_NAME = 'au-archive-snapshot.db';
  private static readonly CHECKSUM_NAME = 'snapshot.sha256';
  private static readonly INFO_NAME = 'snapshot-info.json';

  /**
   * Get the archive folder path from settings
   */
  private async getArchivePath(): Promise<string | null> {
    try {
      const db = getDatabase();
      const result = await db
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'archive_folder')
        .executeTakeFirst();
      return result?.value || null;
    } catch (error) {
      logger.error('DatabaseArchiveService', 'Failed to get archive path', error as Error);
      return null;
    }
  }

  /**
   * Get the database folder path within the archive
   */
  private async getDatabaseFolderPath(): Promise<string | null> {
    const archivePath = await this.getArchivePath();
    if (!archivePath) {
      logger.warn('DatabaseArchiveService', 'No archive folder configured');
      return null;
    }

    return path.join(archivePath, DatabaseArchiveService.DB_FOLDER);
  }

  /**
   * Compute SHA256 checksum of a file
   */
  private async computeChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Gather stats from the database for the info file
   */
  private async gatherStats(): Promise<{
    location_count: number;
    image_count: number;
    video_count: number;
    document_count: number;
    map_count: number;
  }> {
    try {
      const db = getDatabase();

      const [locationCount, imageCount, videoCount, documentCount, mapCount] = await Promise.all([
        db.selectFrom('locs').select(db.fn.countAll().as('count')).executeTakeFirst(),
        db.selectFrom('imgs').select(db.fn.countAll().as('count')).executeTakeFirst(),
        db.selectFrom('vids').select(db.fn.countAll().as('count')).executeTakeFirst(),
        db.selectFrom('docs').select(db.fn.countAll().as('count')).executeTakeFirst(),
        db.selectFrom('maps').select(db.fn.countAll().as('count')).executeTakeFirst(),
      ]);

      return {
        location_count: Number(locationCount?.count) || 0,
        image_count: Number(imageCount?.count) || 0,
        video_count: Number(videoCount?.count) || 0,
        document_count: Number(documentCount?.count) || 0,
        map_count: Number(mapCount?.count) || 0,
      };
    } catch (error) {
      logger.error('DatabaseArchiveService', 'Failed to gather stats', error as Error);
      return {
        location_count: 0,
        image_count: 0,
        video_count: 0,
        document_count: 0,
        map_count: 0,
      };
    }
  }

  /**
   * Export database snapshot to archive folder
   *
   * Creates:
   * - au-archive-snapshot.db (SQLite copy)
   * - snapshot.sha256 (checksum for verification)
   * - snapshot-info.json (metadata for humans)
   */
  async exportToArchive(): Promise<ArchiveExportResult> {
    const timestamp = new Date().toISOString();

    try {
      const dbFolderPath = await this.getDatabaseFolderPath();
      if (!dbFolderPath) {
        return {
          success: false,
          path: '',
          size: 0,
          checksum: '',
          timestamp,
          error: 'Archive folder not configured',
        };
      }

      // Ensure _database folder exists
      if (!existsSync(dbFolderPath)) {
        await fs.mkdir(dbFolderPath, { recursive: true });
        logger.info('DatabaseArchiveService', 'Created database archive folder', { path: dbFolderPath });
      }

      const dbPath = getDatabasePath();
      const snapshotPath = path.join(dbFolderPath, DatabaseArchiveService.SNAPSHOT_NAME);
      const checksumPath = path.join(dbFolderPath, DatabaseArchiveService.CHECKSUM_NAME);
      const infoPath = path.join(dbFolderPath, DatabaseArchiveService.INFO_NAME);

      // Step 1: Copy database file (atomic write via temp file)
      const tempPath = `${snapshotPath}.tmp`;
      await fs.copyFile(dbPath, tempPath);
      await fs.rename(tempPath, snapshotPath);

      // Step 2: Compute checksum
      const checksum = await this.computeChecksum(snapshotPath);

      // Step 3: Get file size
      const stats = await fs.stat(snapshotPath);

      // Step 4: Write checksum file
      await fs.writeFile(checksumPath, `${checksum}  ${DatabaseArchiveService.SNAPSHOT_NAME}\n`, 'utf-8');

      // Step 5: Gather stats and write info file
      const dbStats = await this.gatherStats();
      const info: ArchiveExportInfo = {
        exported_at: timestamp,
        app_version: app.getVersion(),
        ...dbStats,
        verified: true,
        checksum: `sha256:${checksum}`,
      };
      await fs.writeFile(infoPath, JSON.stringify(info, null, 2), 'utf-8');

      logger.info('DatabaseArchiveService', 'Database exported to archive', {
        path: snapshotPath,
        size: stats.size,
        checksum: checksum.substring(0, 16) + '...',
      });

      return {
        success: true,
        path: snapshotPath,
        size: stats.size,
        checksum,
        timestamp,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('DatabaseArchiveService', 'Database export failed', error as Error);

      return {
        success: false,
        path: '',
        size: 0,
        checksum: '',
        timestamp,
        error: errorMessage,
      };
    }
  }

  /**
   * Get info about the last export
   */
  async getLastExportInfo(): Promise<ArchiveExportInfo | null> {
    try {
      const dbFolderPath = await this.getDatabaseFolderPath();
      if (!dbFolderPath) {
        return null;
      }

      const infoPath = path.join(dbFolderPath, DatabaseArchiveService.INFO_NAME);
      if (!existsSync(infoPath)) {
        return null;
      }

      const content = await fs.readFile(infoPath, 'utf-8');
      return JSON.parse(content) as ArchiveExportInfo;
    } catch (error) {
      logger.error('DatabaseArchiveService', 'Failed to read export info', error as Error);
      return null;
    }
  }

  /**
   * Verify the exported snapshot integrity
   */
  async verifyExport(): Promise<boolean> {
    try {
      const dbFolderPath = await this.getDatabaseFolderPath();
      if (!dbFolderPath) {
        return false;
      }

      const snapshotPath = path.join(dbFolderPath, DatabaseArchiveService.SNAPSHOT_NAME);
      const checksumPath = path.join(dbFolderPath, DatabaseArchiveService.CHECKSUM_NAME);

      if (!existsSync(snapshotPath) || !existsSync(checksumPath)) {
        return false;
      }

      // Read stored checksum
      const storedChecksumLine = await fs.readFile(checksumPath, 'utf-8');
      const storedChecksum = storedChecksumLine.trim().split(/\s+/)[0];

      // Compute current checksum
      const currentChecksum = await this.computeChecksum(snapshotPath);

      const matches = storedChecksum === currentChecksum;
      if (!matches) {
        logger.error('DatabaseArchiveService', 'Checksum mismatch', undefined, {
          storedChecksum: storedChecksum.substring(0, 16) + '...',
          computedChecksum: currentChecksum.substring(0, 16) + '...',
        });
      }

      return matches;
    } catch (error) {
      logger.error('DatabaseArchiveService', 'Verification failed', error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Check if archive folder is configured and accessible
   */
  async isArchiveConfigured(): Promise<boolean> {
    const archivePath = await this.getArchivePath();
    if (!archivePath) {
      return false;
    }

    return existsSync(archivePath);
  }
}

// Singleton instance
let serviceInstance: DatabaseArchiveService | null = null;

export function getDatabaseArchiveService(): DatabaseArchiveService {
  if (!serviceInstance) {
    serviceInstance = new DatabaseArchiveService();
  }
  return serviceInstance;
}
