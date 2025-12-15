import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { getDatabasePath } from '../main/database';
import { getLogger } from './logger-service';
import { getConfigService } from './config-service';
// FIX 5.4: Import sendToRenderer for backup notifications
import { sendToRenderer } from '../main/index';
// Database Archive Export: Also export to archive folder after internal backup
import { getDatabaseArchiveService } from './database-archive-service';

const logger = getLogger();

export interface BackupMetadata {
  backupId: string;
  filePath: string;
  timestamp: string;
  size: number;
  verified: boolean;
}

export interface BackupManifest {
  backups: BackupMetadata[];
  lastBackup: string | null;
}

/**
 * Simplified backup system
 * Keeps last N backups (configurable), deletes oldest when exceeded
 */
export class BackupScheduler {
  private backupDir: string;
  private manifestPath: string;
  private isRunning: boolean = false;

  constructor() {
    // Use userData directory which is writable on all platforms
    this.backupDir = path.join(app.getPath('userData'), 'backups');
    this.manifestPath = path.join(this.backupDir, 'backups.json');
  }

  private getMaxBackups(): number {
    const config = getConfigService().get();
    return config.backup.maxBackups;
  }

  async initialize(): Promise<void> {
    await this.ensureBackupDirectory();
    logger.info('BackupScheduler', 'Backup scheduler initialized', {
      backupDir: this.backupDir,
      maxBackups: this.getMaxBackups(),
    });
  }

  private async ensureBackupDirectory(): Promise<void> {
    if (!existsSync(this.backupDir)) {
      await fs.mkdir(this.backupDir, { recursive: true });
    }
  }

  private async loadManifest(): Promise<BackupManifest> {
    try {
      if (!existsSync(this.manifestPath)) {
        return { backups: [], lastBackup: null };
      }

      const content = await fs.readFile(this.manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.error('BackupScheduler', 'Failed to load manifest', error as Error);
      return { backups: [], lastBackup: null };
    }
  }

  private async saveManifest(manifest: BackupManifest): Promise<void> {
    try {
      await fs.writeFile(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    } catch (error) {
      logger.error('BackupScheduler', 'Failed to save manifest', error as Error);
    }
  }

  /**
   * Create backup
   */
  async createBackup(): Promise<BackupMetadata | null> {
    if (this.isRunning) {
      logger.warn('BackupScheduler', 'Backup already in progress, skipping');
      return null;
    }

    this.isRunning = true;

    try {
      const now = new Date();
      const timestamp = now.toISOString().replace(/:/g, '-').split('.')[0];

      const dbPath = getDatabasePath();
      const backupFileName = `au-archive-${timestamp}.db`;
      const backupPath = path.join(this.backupDir, backupFileName);

      logger.info('BackupScheduler', 'Creating backup', { path: backupPath });

      // Copy database file
      await fs.copyFile(dbPath, backupPath);

      // Get file size
      const stats = await fs.stat(backupPath);

      const metadata: BackupMetadata = {
        backupId: `backup-${Date.now()}`,
        filePath: backupPath,
        timestamp: now.toISOString(),
        size: stats.size,
        verified: false,
      };

      // Update manifest
      const manifest = await this.loadManifest();
      manifest.backups.push(metadata);
      manifest.lastBackup = now.toISOString();

      // Enforce retention: keep only last N backups
      await this.enforceRetention(manifest);

      await this.saveManifest(manifest);

      logger.info('BackupScheduler', 'Backup created successfully', {
        size: stats.size,
        path: backupPath,
        totalBackups: manifest.backups.length,
      });

      return metadata;
    } catch (error) {
      logger.error('BackupScheduler', 'Backup failed', error as Error);
      return null;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Enforce retention policy: keep only last N backups, delete oldest
   */
  private async enforceRetention(manifest: BackupManifest): Promise<void> {
    const maxBackups = this.getMaxBackups();

    // Sort by timestamp (oldest first)
    const sortedBackups = manifest.backups.sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    );

    // Delete excess backups
    while (sortedBackups.length > maxBackups) {
      const oldestBackup = sortedBackups.shift()!;

      try {
        if (existsSync(oldestBackup.filePath)) {
          await fs.unlink(oldestBackup.filePath);
          logger.info('BackupScheduler', 'Deleted old backup', {
            file: path.basename(oldestBackup.filePath),
          });
        }
      } catch (error) {
        logger.error('BackupScheduler', 'Failed to delete old backup', error as Error, {
          file: oldestBackup.filePath,
        });
      }
    }

    // Update manifest with remaining backups
    manifest.backups = sortedBackups;
  }

  async getManifest(): Promise<BackupManifest> {
    return this.loadManifest();
  }

  async getBackupStats(): Promise<{
    totalBackups: number;
    totalSize: number;
    lastBackup: string | null;
    oldestBackup: string | null;
  }> {
    const manifest = await this.loadManifest();

    const totalSize = manifest.backups.reduce((sum, backup) => sum + backup.size, 0);
    const oldestBackup =
      manifest.backups.length > 0
        ? manifest.backups.sort((a, b) => a.timestamp.localeCompare(b.timestamp))[0].timestamp
        : null;

    return {
      totalBackups: manifest.backups.length,
      totalSize,
      lastBackup: manifest.lastBackup,
      oldestBackup,
    };
  }

  async markBackupVerified(fileName: string): Promise<void> {
    const manifest = await this.loadManifest();
    const backup = manifest.backups.find((b) => b.filePath.includes(fileName));

    if (backup) {
      backup.verified = true;
      await this.saveManifest(manifest);
      logger.info('BackupScheduler', 'Backup marked as verified', { fileName });
    }
  }

  /**
   * Get most recent backup
   */
  async getMostRecentBackup(): Promise<BackupMetadata | null> {
    const manifest = await this.loadManifest();
    if (manifest.backups.length === 0) return null;

    return manifest.backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  }

  /**
   * FIX 5.5: Verify backup integrity by comparing file size
   * Returns true if backup file exists and size matches manifest
   */
  async verifyBackup(backupId: string): Promise<boolean> {
    const manifest = await this.loadManifest();
    const backup = manifest.backups.find(b => b.backupId === backupId);

    if (!backup) {
      logger.warn('BackupScheduler', 'Backup not found for verification', { backupId });
      return false;
    }

    try {
      if (!existsSync(backup.filePath)) {
        logger.error('BackupScheduler', 'Backup file missing', undefined, { filePath: backup.filePath });
        return false;
      }

      const stats = await fs.stat(backup.filePath);
      const sizeMatches = stats.size === backup.size;

      if (sizeMatches) {
        backup.verified = true;
        await this.saveManifest(manifest);
        logger.info('BackupScheduler', 'Backup verified successfully', { backupId, size: stats.size });
      } else {
        logger.error('BackupScheduler', 'Backup size mismatch', undefined, {
          expectedSize: backup.size,
          actualSize: stats.size
        });
      }

      return sizeMatches;
    } catch (error) {
      logger.error('BackupScheduler', 'Backup verification failed', error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * FIX 5.5: Verify and return result after backup creation
   * Also exports database snapshot to archive folder for complete portable backup
   */
  async createAndVerifyBackup(): Promise<BackupMetadata | null> {
    const backup = await this.createBackup();
    if (backup) {
      const verified = await this.verifyBackup(backup.backupId);
      backup.verified = verified;

      // Database Archive Export: Also export to archive folder
      try {
        const archiveService = getDatabaseArchiveService();
        const archiveConfigured = await archiveService.isArchiveConfigured();

        if (archiveConfigured) {
          const archiveResult = await archiveService.exportToArchive();
          if (archiveResult.success) {
            logger.info('BackupScheduler', 'Database also exported to archive folder', {
              path: archiveResult.path,
              size: archiveResult.size,
            });
          } else {
            logger.warn('BackupScheduler', 'Archive export failed (non-fatal)', {
              error: archiveResult.error,
            });
          }
        }
      } catch (archiveError) {
        // Non-fatal: internal backup succeeded, archive export is a bonus
        logger.warn('BackupScheduler', 'Archive export error (non-fatal)', { message: archiveError instanceof Error ? archiveError.message : String(archiveError) });
      }
    }
    return backup;
  }

  // FIX 5.3: Scheduled backup support
  private scheduleInterval: NodeJS.Timeout | null = null;

  /**
   * FIX 5.3: Start scheduled backups at specified interval
   * @param intervalMs - Backup interval in milliseconds (default: 24 hours)
   */
  startScheduledBackups(intervalMs: number = 24 * 60 * 60 * 1000): void {
    if (this.scheduleInterval) {
      logger.warn('BackupScheduler', 'Scheduled backups already running');
      return;
    }

    logger.info('BackupScheduler', 'Starting scheduled backups', {
      intervalHours: intervalMs / (60 * 60 * 1000)
    });

    this.scheduleInterval = setInterval(async () => {
      logger.info('BackupScheduler', 'Running scheduled backup');
      const backup = await this.createAndVerifyBackup();
      if (backup) {
        // FIX 5.4: Send success notification
        sendToRenderer('backup:status', {
          success: true,
          message: 'Scheduled backup completed successfully',
          timestamp: backup.timestamp,
          verified: backup.verified,
        });
      } else {
        logger.error('BackupScheduler', 'Scheduled backup failed');
        // FIX 5.4: Send failure notification to renderer
        sendToRenderer('backup:status', {
          success: false,
          message: 'Scheduled backup failed - please check disk space',
          timestamp: new Date().toISOString(),
        });
      }
    }, intervalMs);
  }

  /**
   * FIX 5.3: Stop scheduled backups
   */
  stopScheduledBackups(): void {
    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval);
      this.scheduleInterval = null;
      logger.info('BackupScheduler', 'Scheduled backups stopped');
    }
  }

  /**
   * Check if scheduled backups are running
   */
  isScheduleRunning(): boolean {
    return this.scheduleInterval !== null;
  }
}

// Singleton instance
let schedulerInstance: BackupScheduler | null = null;

export function getBackupScheduler(): BackupScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new BackupScheduler();
  }
  return schedulerInstance;
}
