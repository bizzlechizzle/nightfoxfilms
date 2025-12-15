import { getLogger } from './logger-service';
import { getBackupScheduler } from './backup-scheduler';
import { getIntegrityChecker } from './integrity-checker';
import { getDiskSpaceMonitor } from './disk-space-monitor';
import { getMaintenanceScheduler } from './maintenance-scheduler';
import { getConfigService } from './config-service';
import { getMetricsCollector, MetricNames } from './monitoring/metrics-collector';
import { getAlertManager } from './monitoring/alert-manager';
import type { BackupManifest } from './backup-scheduler';
import type { IntegrityResult } from './integrity-checker';
import type { DiskSpaceInfo } from './disk-space-monitor';
import type { MaintenanceHistory } from './maintenance-scheduler';

const logger = getLogger();
const metrics = getMetricsCollector();

export interface HealthStatus {
  overall: 'healthy' | 'warning' | 'critical';
  components: {
    database: ComponentHealth;
    backups: ComponentHealth;
    diskSpace: ComponentHealth;
  };
  lastCheck: string;
  recommendations: string[];
}

export interface ComponentHealth {
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  details?: Record<string, unknown>;
}

export interface HealthDashboardData {
  status: HealthStatus;
  backupManifest: BackupManifest;
  diskSpace: DiskSpaceInfo;
  maintenanceHistory: MaintenanceHistory;
  lastIntegrityCheck: IntegrityResult | null;
}

/**
 * Simplified Health Monitor
 * Manual checks only, no automatic periodic monitoring
 */
export class HealthMonitor {
  private lastIntegrityCheck: IntegrityResult | null = null;
  private isInitialized = false;

  /**
   * Initialize health monitoring services
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('HealthMonitor', 'Already initialized');
      return;
    }

    logger.info('HealthMonitor', 'Initializing health monitoring (manual mode)');
    const startTime = Date.now();

    try {
      // Initialize all subsystems
      const backupScheduler = getBackupScheduler();
      await backupScheduler.initialize();

      const maintenanceScheduler = getMaintenanceScheduler();
      await maintenanceScheduler.initialize();

      // Run initial integrity check if enabled in config
      const config = getConfigService().get();
      if (config.monitoring.integrity.checkOnStartup) {
        const integrityChecker = getIntegrityChecker();
        this.lastIntegrityCheck = await integrityChecker.runQuickCheck();

        if (!this.lastIntegrityCheck.isHealthy) {
          logger.error('HealthMonitor', 'Database integrity check failed on startup', undefined, {
            errors: this.lastIntegrityCheck.errors,
          });
        }
      } else {
        logger.info('HealthMonitor', 'Skipping integrity check on startup (disabled in config)');
      }

      const duration = Date.now() - startTime;

      this.isInitialized = true;
      logger.info('HealthMonitor', 'Health monitoring initialized', { duration });
    } catch (error) {
      logger.error('HealthMonitor', 'Failed to initialize monitoring systems', error as Error);
      throw error;
    }
  }

  /**
   * Get current health status (manual check)
   */
  async getHealthStatus(): Promise<HealthStatus> {
    const recommendations: string[] = [];

    // Check database integrity
    const integrityChecker = getIntegrityChecker();
    const integrityResult = this.lastIntegrityCheck || (await integrityChecker.runQuickCheck());
    const databaseHealth: ComponentHealth = {
      status: integrityResult.isHealthy ? 'healthy' : 'critical',
      message: integrityResult.isHealthy
        ? 'Database integrity verified'
        : `Database has ${integrityResult.errors.length} integrity issues`,
      details: {
        errors: integrityResult.errors,
        warnings: integrityResult.warnings,
        lastCheck: integrityResult.timestamp,
      },
    };

    if (!integrityResult.isHealthy) {
      recommendations.push('Database integrity issues detected - consider restoring from backup');
    }

    // Check backups
    const backupScheduler = getBackupScheduler();
    const manifest = await backupScheduler.getManifest();
    let backupStatus: ComponentHealth['status'] = 'healthy';
    let backupMessage = `${manifest.backups.length} backups available`;

    if (manifest.backups.length === 0) {
      backupStatus = 'critical';
      backupMessage = 'No backups available';
      recommendations.push('Create your first backup');
    } else if (manifest.backups.length < 3) {
      backupStatus = 'warning';
      backupMessage = `Only ${manifest.backups.length} backups available`;
      recommendations.push('Consider creating more backups for safety');
    }

    const backupsHealth: ComponentHealth = {
      status: backupStatus,
      message: backupMessage,
      details: {
        count: manifest.backups.length,
        lastBackup: manifest.lastBackup,
      },
    };

    // Check disk space
    const diskSpaceMonitor = getDiskSpaceMonitor();
    const diskSpace = await diskSpaceMonitor.checkDiskSpace();
    const diskSpaceHealth: ComponentHealth = {
      status:
        diskSpace.status === 'healthy'
          ? 'healthy'
          : diskSpace.status === 'warning'
          ? 'warning'
          : 'critical',
      message: `${diskSpaceMonitor.formatSize(diskSpace.available)} available`,
      details: {
        available: diskSpace.available,
        total: diskSpace.total,
        percentUsed: diskSpace.percentUsed,
      },
    };

    if (diskSpace.status === 'warning') {
      recommendations.push('Disk space is low - consider freeing up space');
    } else if (diskSpace.status === 'critical' || diskSpace.status === 'emergency') {
      recommendations.push('Critical disk space - some operations may be blocked');
    }

    // Determine overall status
    const statuses = [databaseHealth.status, backupsHealth.status, diskSpaceHealth.status];

    let overall: HealthStatus['overall'] = 'healthy';
    if (statuses.includes('critical')) {
      overall = 'critical';
    } else if (statuses.includes('warning')) {
      overall = 'warning';
    }

    // Record metrics for health status
    metrics.gauge(MetricNames.SYSTEM_DISK_FREE, diskSpace.available, {});
    metrics.gauge(MetricNames.SYSTEM_MEMORY_USED, process.memoryUsage().rss, {});
    metrics.gauge(MetricNames.SYSTEM_MEMORY_HEAP, process.memoryUsage().heapUsed, {});

    // Check alert conditions
    const alertManager = getAlertManager();
    // Convert disk space to the format AlertManager expects
    const diskPercentFree = (diskSpace.available / diskSpace.total) * 100;
    const diskSpaceFreeGB = diskSpace.available / (1024 * 1024 * 1024);
    await alertManager.checkAlerts({
      diskSpacePercent: diskPercentFree,
      diskSpaceFreeGB,
      jobsPending: 0,
      jobsProcessing: 0,
      jobsFailed: 0,
      jobsDead: 0,
      oldestJobAgeMinutes: 0,
      activeImports: 0,
      importErrorRate: 0,
      workersActive: 1,
      workersIdle: 0,
      errorsLastHour: 0,
      errorRatePerMinute: 0,
    });

    return {
      overall,
      components: {
        database: databaseHealth,
        backups: backupsHealth,
        diskSpace: diskSpaceHealth,
      },
      lastCheck: new Date().toISOString(),
      recommendations,
    };
  }

  /**
   * Get complete dashboard data
   */
  async getDashboardData(): Promise<HealthDashboardData> {
    const backupScheduler = getBackupScheduler();
    const diskSpaceMonitor = getDiskSpaceMonitor();
    const maintenanceScheduler = getMaintenanceScheduler();

    return {
      status: await this.getHealthStatus(),
      backupManifest: await backupScheduler.getManifest(),
      diskSpace: await diskSpaceMonitor.checkDiskSpace(),
      maintenanceHistory: await maintenanceScheduler.getHistory(),
      lastIntegrityCheck: this.lastIntegrityCheck,
    };
  }

  /**
   * Run manual health check
   */
  async runHealthCheck(): Promise<HealthStatus> {
    logger.info('HealthMonitor', 'Running manual health check');

    // Run fresh integrity check
    const integrityChecker = getIntegrityChecker();
    this.lastIntegrityCheck = await integrityChecker.runFullCheck();

    return this.getHealthStatus();
  }

  /**
   * Create a health snapshot for persistence
   * Returns data suitable for storing in health_snapshots table
   */
  async createSnapshot(): Promise<{
    overall_status: string;
    disk_free: number;
    disk_total: number;
    memory_used: number;
    memory_heap: number;
    job_queue_pending: number;
    job_queue_processing: number;
    error_count: number;
    components_json: string;
  }> {
    const status = await this.getHealthStatus();
    const diskSpaceMonitor = getDiskSpaceMonitor();
    const diskSpace = await diskSpaceMonitor.checkDiskSpace();
    const memUsage = process.memoryUsage();

    // Get job queue stats from metrics (if available)
    const metricsSummary = metrics.getSummary();
    const jobQueuePending = metricsSummary.gauges['jobs.queue.depth'] ?? 0;
    const jobQueueProcessing = 0; // Would need to track separately
    const errorCount = metricsSummary.counters['errors.count'] ?? 0;

    return {
      overall_status: status.overall,
      disk_free: diskSpace.available,
      disk_total: diskSpace.total,
      memory_used: memUsage.rss,
      memory_heap: memUsage.heapUsed,
      job_queue_pending: jobQueuePending,
      job_queue_processing: jobQueueProcessing,
      error_count: errorCount,
      components_json: JSON.stringify(status.components),
    };
  }

  /**
   * Shutdown monitoring systems
   */
  async shutdown(): Promise<void> {
    logger.info('HealthMonitor', 'Shutting down health monitoring');
    this.isInitialized = false;
  }
}

// Singleton instance
let monitorInstance: HealthMonitor | null = null;

export function getHealthMonitor(): HealthMonitor {
  if (!monitorInstance) {
    monitorInstance = new HealthMonitor();
  }
  return monitorInstance;
}
