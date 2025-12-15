import { app } from 'electron';
import { statfsSync } from 'fs';
import { getLogger } from './logger-service';
import { getConfigService } from './config-service';

const logger = getLogger();

export interface DiskSpaceInfo {
  available: number;
  total: number;
  used: number;
  percentUsed: number;
  status: 'healthy' | 'warning' | 'critical' | 'emergency';
}

/**
 * Disk space monitoring service
 * Monitors available disk space and prevents operations when critically low
 */
export class DiskSpaceMonitor {
  private lastCheckTime: Date | null = null;
  private lastSpaceInfo: DiskSpaceInfo | null = null;

  private getThresholds() {
    const config = getConfigService().get();
    return {
      WARNING_THRESHOLD: config.monitoring.diskSpace.warningThresholdMB * 1024 * 1024,
      CRITICAL_THRESHOLD: config.monitoring.diskSpace.criticalThresholdMB * 1024 * 1024,
      EMERGENCY_THRESHOLD: config.monitoring.diskSpace.emergencyThresholdMB * 1024 * 1024,
    };
  }

  async checkDiskSpace(): Promise<DiskSpaceInfo> {
    try {
      const userDataPath = app.getPath('userData');
      const stats = statfsSync(userDataPath);

      const available = stats.bavail * stats.bsize;
      const total = stats.blocks * stats.bsize;
      const used = total - available;
      const percentUsed = (used / total) * 100;

      const { WARNING_THRESHOLD, CRITICAL_THRESHOLD, EMERGENCY_THRESHOLD } = this.getThresholds();

      let status: DiskSpaceInfo['status'] = 'healthy';
      if (available < EMERGENCY_THRESHOLD) {
        status = 'emergency';
      } else if (available < CRITICAL_THRESHOLD) {
        status = 'critical';
      } else if (available < WARNING_THRESHOLD) {
        status = 'warning';
      }

      const spaceInfo: DiskSpaceInfo = {
        available,
        total,
        used,
        percentUsed,
        status,
      };

      this.lastCheckTime = new Date();
      this.lastSpaceInfo = spaceInfo;

      if (status !== 'healthy') {
        logger.warn('DiskSpaceMonitor', `Disk space ${status}`, {
          availableGB: (available / (1024 * 1024 * 1024)).toFixed(2),
          status,
        });
      }

      return spaceInfo;
    } catch (error) {
      logger.error('DiskSpaceMonitor', 'Failed to check disk space', error as Error);

      // Return a safe default that indicates we don't know
      return {
        available: 0,
        total: 0,
        used: 0,
        percentUsed: 100,
        status: 'emergency',
      };
    }
  }

  async canPerformOperation(estimatedSize: number = 0): Promise<boolean> {
    const spaceInfo = await this.checkDiskSpace();

    // Block operations if disk space is critical or emergency
    if (spaceInfo.status === 'critical' || spaceInfo.status === 'emergency') {
      return false;
    }

    // Check if estimated operation size would exceed threshold
    if (estimatedSize > 0) {
      const { CRITICAL_THRESHOLD } = this.getThresholds();
      if (spaceInfo.available - estimatedSize < CRITICAL_THRESHOLD) {
        logger.warn('DiskSpaceMonitor', 'Operation would exceed disk space threshold', {
          estimatedSize,
          available: spaceInfo.available,
        });
        return false;
      }
    }

    return true;
  }

  async canImportMedia(): Promise<boolean> {
    // Assume media import could require up to 1GB of space
    return await this.canPerformOperation(1 * 1024 * 1024 * 1024);
  }

  async canCreateBackup(): Promise<boolean> {
    // Backup requires space equal to database size + overhead
    // Estimate conservatively at 500MB
    return await this.canPerformOperation(500 * 1024 * 1024);
  }

  getLastSpaceInfo(): DiskSpaceInfo | null {
    return this.lastSpaceInfo;
  }

  shouldShowWarning(): boolean {
    if (!this.lastSpaceInfo) {
      return false;
    }

    return this.lastSpaceInfo.status === 'warning' || this.lastSpaceInfo.status === 'critical';
  }

  shouldBlockOperations(): boolean {
    if (!this.lastSpaceInfo) {
      return false;
    }

    return this.lastSpaceInfo.status === 'emergency';
  }

  formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}

// Singleton instance
let monitorInstance: DiskSpaceMonitor | null = null;

export function getDiskSpaceMonitor(): DiskSpaceMonitor {
  if (!monitorInstance) {
    monitorInstance = new DiskSpaceMonitor();
  }
  return monitorInstance;
}
