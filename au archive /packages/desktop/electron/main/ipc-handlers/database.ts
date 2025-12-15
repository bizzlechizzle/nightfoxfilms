/**
 * Database IPC Handlers
 * Handles database:* IPC channels
 */
import { ipcMain, dialog } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { sql } from 'kysely';
import { getDatabasePath, getDefaultDbPath, closeDatabase, getDatabase } from '../database';
import {
  getCustomDatabasePath,
  setCustomDatabasePath,
} from '../../services/bootstrap-config';
import { getBackupScheduler } from '../../services/backup-scheduler';
import { getDatabaseArchiveService } from '../../services/database-archive-service';

export function registerDatabaseHandlers() {
  ipcMain.handle('database:backup', async () => {
    try {
      const dbPath = getDatabasePath();
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const defaultFilename = `au-archive-backup-${timestamp}.db`;

      const result = await dialog.showSaveDialog({
        title: 'Backup Database',
        defaultPath: defaultFilename,
        filters: [
          { name: 'SQLite Database', extensions: ['db'] },
          { name: 'All Files', extensions: ['*'] }
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, message: 'Backup canceled' };
      }

      await fs.copyFile(dbPath, result.filePath);
      return { success: true, path: result.filePath };
    } catch (error) {
      console.error('Error backing up database:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('database:restore', async () => {
    try {
      const dbPath = getDatabasePath();

      const result = await dialog.showOpenDialog({
        title: 'Restore Database from Backup',
        filters: [
          { name: 'SQLite Database', extensions: ['db'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, message: 'Restore canceled' };
      }

      const backupPath = result.filePaths[0];

      // Verify backup file is valid SQLite
      try {
        const Database = (await import('better-sqlite3')).default;
        const testDb = new Database(backupPath, { readonly: true });
        const tables = testDb.pragma('table_list') as Array<{ name: string }>;
        const hasLocsTable = tables.some(t => t.name === 'locs');
        testDb.close();

        if (!hasLocsTable) {
          return { success: false, message: 'Invalid database file: missing required tables' };
        }
      } catch {
        return { success: false, message: 'Invalid database file: not a valid SQLite database' };
      }

      // Create pre-restore backup
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const autoBackupPath = dbPath.replace('.db', `-pre-restore-${timestamp}.db`);
      await fs.copyFile(dbPath, autoBackupPath);

      closeDatabase();
      await fs.copyFile(backupPath, dbPath);

      return {
        success: true,
        message: 'Database restored successfully. Please restart the application.',
        requiresRestart: true,
        autoBackupPath
      };
    } catch (error) {
      console.error('Error restoring database:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('database:getLocation', async () => {
    try {
      const currentPath = getDatabasePath();
      const defaultPath = getDefaultDbPath();
      const customPath = getCustomDatabasePath();
      const isCustom = !!customPath;

      return { currentPath, defaultPath, customPath, isCustom };
    } catch (error) {
      console.error('Error getting database location:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('database:changeLocation', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Database Location',
        properties: ['openDirectory', 'createDirectory'],
        message: 'Select a folder where the database file will be stored',
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, message: 'Selection canceled' };
      }

      const newFolder = result.filePaths[0];
      const newDbPath = path.join(newFolder, 'au-archive.db');
      const currentDbPath = getDatabasePath();

      if (newDbPath === currentDbPath) {
        return { success: false, message: 'Selected location is the same as current' };
      }

      // Check if db exists at new location
      try {
        await fs.access(newDbPath);
        const existsResult = await dialog.showMessageBox({
          type: 'question',
          buttons: ['Use Existing', 'Replace with Current', 'Cancel'],
          defaultId: 2,
          title: 'Database Exists',
          message: 'A database already exists at this location.',
          detail: 'Do you want to use the existing database or replace it with your current database?',
        });

        if (existsResult.response === 2) {
          return { success: false, message: 'Operation canceled' };
        }

        if (existsResult.response === 1) {
          closeDatabase();
          await fs.copyFile(currentDbPath, newDbPath);
        }
      } catch {
        closeDatabase();
        await fs.copyFile(currentDbPath, newDbPath);
      }

      setCustomDatabasePath(newDbPath);

      return {
        success: true,
        message: 'Database location changed. Please restart the application.',
        newPath: newDbPath,
        requiresRestart: true,
      };
    } catch (error) {
      console.error('Error changing database location:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('database:resetLocation', async () => {
    try {
      const customPath = getCustomDatabasePath();

      if (!customPath) {
        return { success: false, message: 'Already using default location' };
      }

      const defaultPath = getDefaultDbPath();

      const result = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Copy Database', 'Just Reset (Keep Data at Custom Location)', 'Cancel'],
        defaultId: 0,
        title: 'Reset Database Location',
        message: 'Reset to default database location?',
        detail: `Current: ${customPath}\nDefault: ${defaultPath}\n\nDo you want to copy your database to the default location?`,
      });

      if (result.response === 2) {
        return { success: false, message: 'Operation canceled' };
      }

      if (result.response === 0) {
        closeDatabase();
        await fs.copyFile(customPath, defaultPath);
      }

      setCustomDatabasePath(undefined);

      return {
        success: true,
        message: 'Database location reset to default. Please restart the application.',
        newPath: defaultPath,
        requiresRestart: true,
      };
    } catch (error) {
      console.error('Error resetting database location:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Phase 2: Get database stats (health + backup count)
  ipcMain.handle('database:getStats', async () => {
    try {
      const db = getDatabase();
      const scheduler = getBackupScheduler();

      // Check database integrity using raw SQL
      let integrityOk = true;
      try {
        const result = await sql<{ integrity_check: string }>`PRAGMA integrity_check`.execute(db);
        integrityOk = result.rows.length === 1 && result.rows[0].integrity_check === 'ok';
      } catch {
        integrityOk = false;
      }

      // Get backup count from scheduler
      const backupStats = await scheduler.getBackupStats();

      return {
        integrityOk,
        backupCount: backupStats.totalBackups,
        lastBackup: backupStats.lastBackup,
      };
    } catch (error) {
      console.error('Error getting database stats:', error);
      return { integrityOk: true, backupCount: 0, lastBackup: null };
    }
  });

  // Phase 2: Export backup to user-selected location
  ipcMain.handle('database:exportBackup', async () => {
    try {
      const dbPath = getDatabasePath();
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const defaultFilename = `au-archive-backup-${timestamp}.db`;

      const result = await dialog.showSaveDialog({
        title: 'Export Database Backup',
        defaultPath: defaultFilename,
        filters: [
          { name: 'SQLite Database', extensions: ['db'] },
          { name: 'All Files', extensions: ['*'] }
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, message: 'Export canceled' };
      }

      await fs.copyFile(dbPath, result.filePath);
      return { success: true, path: result.filePath };
    } catch (error) {
      console.error('Error exporting database:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Phase 2: List internal backups
  ipcMain.handle('database:listBackups', async () => {
    try {
      const scheduler = getBackupScheduler();
      const manifest = await scheduler.getManifest();

      // Format backups for UI
      const backups = manifest.backups
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)) // Newest first
        .map(backup => ({
          id: backup.backupId,
          date: new Date(backup.timestamp).toLocaleString(),
          size: formatSize(backup.size),
          path: backup.filePath,
        }));

      return { success: true, backups };
    } catch (error) {
      console.error('Error listing backups:', error);
      return { success: false, message: 'Failed to list backups', backups: [] };
    }
  });

  // Phase 2: Restore from internal backup
  ipcMain.handle('database:restoreFromInternal', async (_, backupId: string) => {
    try {
      const scheduler = getBackupScheduler();
      const manifest = await scheduler.getManifest();

      const backup = manifest.backups.find(b => b.backupId === backupId);
      if (!backup) {
        return { success: false, message: 'Backup not found' };
      }

      // Verify backup file exists
      try {
        await fs.access(backup.filePath);
      } catch {
        return { success: false, message: 'Backup file not found on disk' };
      }

      const dbPath = getDatabasePath();

      // Create pre-restore backup
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const autoBackupPath = dbPath.replace('.db', `-pre-restore-${timestamp}.db`);
      await fs.copyFile(dbPath, autoBackupPath);

      closeDatabase();
      await fs.copyFile(backup.filePath, dbPath);

      return {
        success: true,
        message: 'Database restored successfully. Please restart the application.',
        requiresRestart: true,
        autoBackupPath,
      };
    } catch (error) {
      console.error('Error restoring from internal backup:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Database Archive Export: Manual trigger for exporting to archive folder
  ipcMain.handle('database:archiveExport', async () => {
    try {
      const archiveService = getDatabaseArchiveService();
      const isConfigured = await archiveService.isArchiveConfigured();

      if (!isConfigured) {
        return {
          success: false,
          message: 'Archive folder not configured. Set archive location in Settings first.',
        };
      }

      const result = await archiveService.exportToArchive();

      if (result.success) {
        return {
          success: true,
          message: 'Database exported to archive folder',
          path: result.path,
          size: formatSize(result.size),
          timestamp: result.timestamp,
        };
      } else {
        return {
          success: false,
          message: result.error || 'Export failed',
        };
      }
    } catch (error) {
      console.error('Error exporting database to archive:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Database Archive Export: Get status of last archive export
  ipcMain.handle('database:archiveStatus', async () => {
    try {
      const archiveService = getDatabaseArchiveService();
      const isConfigured = await archiveService.isArchiveConfigured();

      if (!isConfigured) {
        return {
          configured: false,
          exported: false,
          verified: false,
          lastExport: null,
        };
      }

      const info = await archiveService.getLastExportInfo();
      if (!info) {
        return {
          configured: true,
          exported: false,
          verified: false,
          lastExport: null,
        };
      }

      // Verify the export integrity
      const verified = await archiveService.verifyExport();

      return {
        configured: true,
        exported: true,
        verified,
        lastExport: {
          exportedAt: info.exported_at,
          appVersion: info.app_version,
          locationCount: info.location_count,
          imageCount: info.image_count,
          videoCount: info.video_count,
          documentCount: info.document_count,
          mapCount: info.map_count,
          checksum: info.checksum,
        },
      };
    } catch (error) {
      console.error('Error getting archive status:', error);
      return {
        configured: false,
        exported: false,
        verified: false,
        lastExport: null,
      };
    }
  });
}

// Helper to format file size
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
