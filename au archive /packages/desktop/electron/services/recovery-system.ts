import { app, dialog } from 'electron';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join } from 'path';
import { getLogger } from './logger-service';
import { getIntegrityChecker } from './integrity-checker';
import { getBackupScheduler } from './backup-scheduler';
import { getDatabasePath } from '../main/database';

const logger = getLogger();

export interface RecoveryResult {
  success: boolean;
  action: 'none' | 'backup_restored' | 'emergency_backup';
  message: string;
  timestamp: string;
}

/**
 * Simplified Recovery System
 * Detects corruption → Shows dialog → Restores from backup
 * FIX: Uses canonical getDatabasePath() instead of hardcoded path
 */
export class RecoverySystem {
  private get dbPath(): string {
    return getDatabasePath();
  }

  /**
   * Check if database needs recovery
   */
  async checkNeedsRecovery(): Promise<boolean> {
    try {
      const integrityChecker = getIntegrityChecker();
      const result = await integrityChecker.runQuickCheck();
      return !result.isHealthy;
    } catch (error) {
      logger.error('RecoverySystem', 'Failed to check if recovery needed', error as Error);
      return true; // Assume recovery needed on error
    }
  }

  /**
   * Offer recovery to user via dialog
   */
  async offerRecovery(): Promise<RecoveryResult> {
    const startTime = Date.now();

    try {
      // Create emergency backup of corrupted database
      await this.createEmergencyBackup();

      // Get available backups
      const backupScheduler = getBackupScheduler();
      const manifest = await backupScheduler.getManifest();

      if (manifest.backups.length === 0) {
        await dialog.showErrorBox(
          'Database Corrupted',
          'No backups available. Cannot restore database.'
        );

        return {
          success: false,
          action: 'none',
          message: 'No backups available',
          timestamp: new Date().toISOString(),
        };
      }

      // Show recovery dialog
      const choice = await dialog.showMessageBox({
        type: 'warning',
        title: 'Database Corrupted',
        message: `Database corruption detected. ${manifest.backups.length} backup(s) available.`,
        detail: 'Restore from most recent backup?',
        buttons: ['Restore from Backup', 'Exit Application'],
        defaultId: 0,
        cancelId: 1,
      });

      if (choice.response === 1) {
        // User chose to exit
        return {
          success: false,
          action: 'none',
          message: 'User declined recovery',
          timestamp: new Date().toISOString(),
        };
      }

      // Restore from most recent backup
      const mostRecentBackup = await backupScheduler.getMostRecentBackup();
      if (!mostRecentBackup) {
        return {
          success: false,
          action: 'none',
          message: 'No backup found',
          timestamp: new Date().toISOString(),
        };
      }

      await fs.copyFile(mostRecentBackup.filePath, this.dbPath);

      // Verify restored database
      const integrityChecker = getIntegrityChecker();
      const verifyResult = await integrityChecker.runQuickCheck();

      if (verifyResult.isHealthy) {
        await dialog.showMessageBox({
          type: 'info',
          title: 'Recovery Successful',
          message: 'Database restored successfully',
          detail: 'Application will now restart.',
          buttons: ['OK'],
        });

        logger.info('RecoverySystem', 'Database restored successfully', {
          backup: mostRecentBackup.filePath,
        });

        return {
          success: true,
          action: 'backup_restored',
          message: 'Database restored from backup',
          timestamp: new Date().toISOString(),
        };
      } else {
        await dialog.showErrorBox(
          'Recovery Failed',
          'Restored database is still corrupted. Application will exit.'
        );

        return {
          success: false,
          action: 'none',
          message: 'Restored database still corrupted',
          timestamp: new Date().toISOString(),
        };
      }
    } catch (error) {
      logger.error('RecoverySystem', 'Recovery process failed', error as Error);

      await dialog.showErrorBox(
        'Recovery Error',
        `Recovery failed: ${(error as Error).message}\n\nApplication will exit.`
      );

      return {
        success: false,
        action: 'none',
        message: `Recovery error: ${(error as Error).message}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Create emergency backup of corrupted database
   */
  private async createEmergencyBackup(): Promise<void> {
    try {
      // Use userData directory which is writable on all platforms
      const emergencyDir = join(app.getPath('userData'), 'emergency-backups');
      if (!existsSync(emergencyDir)) {
        await fs.mkdir(emergencyDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const emergencyPath = join(emergencyDir, `corrupted-${timestamp}.db`);

      await fs.copyFile(this.dbPath, emergencyPath);

      logger.info('RecoverySystem', 'Emergency backup created', {
        path: emergencyPath,
      });
    } catch (error) {
      logger.error('RecoverySystem', 'Failed to create emergency backup', error as Error);
    }
  }

  /**
   * Check database health and offer recovery if needed
   */
  async checkAndRecover(): Promise<RecoveryResult | null> {
    const needsRecovery = await this.checkNeedsRecovery();

    if (!needsRecovery) {
      return null;
    }

    logger.warn('RecoverySystem', 'Database corruption detected - offering recovery');
    return this.offerRecovery();
  }
}

// Singleton instance
let recoveryInstance: RecoverySystem | null = null;

export function getRecoverySystem(): RecoverySystem {
  if (!recoveryInstance) {
    recoveryInstance = new RecoverySystem();
  }
  return recoveryInstance;
}
