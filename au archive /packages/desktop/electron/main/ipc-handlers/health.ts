/**
 * Health IPC Handlers
 * Handles health:* IPC channels
 */
import { ipcMain } from 'electron';
import { getHealthMonitor } from '../../services/health-monitor';
import { getBackupScheduler } from '../../services/backup-scheduler';
import { getIntegrityChecker } from '../../services/integrity-checker';
import { getDiskSpaceMonitor } from '../../services/disk-space-monitor';
import { getMaintenanceScheduler } from '../../services/maintenance-scheduler';
import { getRecoverySystem } from '../../services/recovery-system';

export function registerHealthHandlers() {
  ipcMain.handle('health:getDashboard', async () => {
    try {
      const healthMonitor = getHealthMonitor();
      return await healthMonitor.getDashboardData();
    } catch (error) {
      console.error('Error getting health dashboard:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('health:getStatus', async () => {
    try {
      const healthMonitor = getHealthMonitor();
      return await healthMonitor.getHealthStatus();
    } catch (error) {
      console.error('Error getting health status:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('health:runCheck', async () => {
    try {
      const healthMonitor = getHealthMonitor();
      return await healthMonitor.runHealthCheck();
    } catch (error) {
      console.error('Error running health check:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('health:createBackup', async () => {
    try {
      const backupScheduler = getBackupScheduler();
      const result = await backupScheduler.createBackup();
      return result;
    } catch (error) {
      console.error('Error creating backup:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('health:getBackupStats', async () => {
    try {
      const backupScheduler = getBackupScheduler();
      return await backupScheduler.getBackupStats();
    } catch (error) {
      console.error('Error getting backup stats:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('health:getDiskSpace', async () => {
    try {
      const diskSpaceMonitor = getDiskSpaceMonitor();
      return await diskSpaceMonitor.checkDiskSpace();
    } catch (error) {
      console.error('Error checking disk space:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('health:checkIntegrity', async () => {
    try {
      const integrityChecker = getIntegrityChecker();
      return await integrityChecker.runFullCheck();
    } catch (error) {
      console.error('Error checking database integrity:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Check for locations with GPS but missing region fields.
   * Returns a list of locations that need region data backfilled.
   * Use this to find "silent enrichment failures" where GPS was applied
   * but geocoding/region calculation failed.
   */
  ipcMain.handle('health:checkLocationDataIntegrity', async () => {
    try {
      const integrityChecker = getIntegrityChecker();
      return await integrityChecker.checkLocationDataIntegrity();
    } catch (error) {
      console.error('Error checking location data integrity:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('health:runMaintenance', async () => {
    try {
      const maintenanceScheduler = getMaintenanceScheduler();
      return await maintenanceScheduler.runFullMaintenance();
    } catch (error) {
      console.error('Error running maintenance:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('health:getMaintenanceSchedule', async () => {
    try {
      const maintenanceScheduler = getMaintenanceScheduler();
      // MaintenanceScheduler is manual-only, return basic status
      return { mode: 'manual', enabled: true };
    } catch (error) {
      console.error('Error getting maintenance schedule:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('health:getRecoveryState', async () => {
    try {
      const recoverySystem = getRecoverySystem();
      const needsRecovery = await recoverySystem.checkNeedsRecovery();
      return { needsRecovery, status: needsRecovery ? 'needs_recovery' : 'healthy' };
    } catch (error) {
      console.error('Error getting recovery state:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('health:attemptRecovery', async () => {
    try {
      const recoverySystem = getRecoverySystem();
      return await recoverySystem.offerRecovery();
    } catch (error) {
      console.error('Error attempting recovery:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });
}
