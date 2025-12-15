import { app } from 'electron';
import Database from 'better-sqlite3';
import { join } from 'path';
import { promises as fs } from 'fs';
import { existsSync, statSync } from 'fs';
import { getLogger } from './logger-service';
import { getDatabasePath } from '../main/database';

const logger = getLogger();

export interface MaintenanceResult {
  operation: 'VACUUM' | 'ANALYZE' | 'BOTH';
  success: boolean;
  duration: number;
  spaceRecovered?: number;
  dbSizeBefore?: number;
  dbSizeAfter?: number;
  timestamp: string;
}

export interface MaintenanceHistory {
  lastVacuum: string | null;
  lastAnalyze: string | null;
  vacuumCount: number;
  analyzeCount: number;
}

/**
 * Simplified Maintenance Scheduler
 * Manual VACUUM and ANALYZE operations only
 * No automatic scheduling
 * FIX: Uses canonical getDatabasePath() instead of hardcoded path
 */
export class MaintenanceScheduler {
  private readonly HISTORY_FILE = 'maintenance-history.json';

  private historyFilePath: string;
  private isRunningMaintenance = false;

  private get dbPath(): string {
    return getDatabasePath();
  }

  constructor() {
    // Use userData directory which is writable on all platforms
    this.historyFilePath = join(app.getPath('userData'), this.HISTORY_FILE);
  }

  async initialize(): Promise<void> {
    logger.info('MaintenanceScheduler', 'Maintenance scheduler initialized (manual mode)');
  }

  /**
   * Load maintenance history from disk
   */
  private async loadHistory(): Promise<MaintenanceHistory> {
    try {
      if (existsSync(this.historyFilePath)) {
        const content = await fs.readFile(this.historyFilePath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.error('MaintenanceScheduler', 'Failed to load history', error as Error);
    }

    return {
      lastVacuum: null,
      lastAnalyze: null,
      vacuumCount: 0,
      analyzeCount: 0,
    };
  }

  /**
   * Save maintenance history to disk
   */
  private async saveHistory(history: MaintenanceHistory): Promise<void> {
    try {
      await fs.writeFile(
        this.historyFilePath,
        JSON.stringify(history, null, 2),
        'utf-8'
      );
    } catch (error) {
      logger.error('MaintenanceScheduler', 'Failed to save history', error as Error);
    }
  }

  /**
   * Run VACUUM operation
   */
  async runVacuum(): Promise<MaintenanceResult> {
    if (this.isRunningMaintenance) {
      logger.warn('MaintenanceScheduler', 'Maintenance already in progress');
      return {
        operation: 'VACUUM',
        success: false,
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    this.isRunningMaintenance = true;
    const startTime = Date.now();

    try {
      // Get database size before VACUUM
      const dbSizeBefore = existsSync(this.dbPath) ? statSync(this.dbPath).size : 0;

      logger.info('MaintenanceScheduler', 'Starting VACUUM operation', {
        dbSizeBefore,
      });

      // Run VACUUM
      const db = new Database(this.dbPath);
      db.exec('VACUUM;');
      db.close();

      // Get database size after VACUUM
      const dbSizeAfter = existsSync(this.dbPath) ? statSync(this.dbPath).size : 0;
      const spaceRecovered = dbSizeBefore - dbSizeAfter;
      const duration = Date.now() - startTime;

      // Update history
      const history = await this.loadHistory();
      history.lastVacuum = new Date().toISOString();
      history.vacuumCount++;
      await this.saveHistory(history);

      logger.info('MaintenanceScheduler', 'VACUUM completed', {
        dbSizeBefore,
        dbSizeAfter,
        spaceRecovered,
        duration,
      });

      return {
        operation: 'VACUUM',
        success: true,
        duration,
        spaceRecovered,
        dbSizeBefore,
        dbSizeAfter,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('MaintenanceScheduler', 'VACUUM failed', error as Error);
      return {
        operation: 'VACUUM',
        success: false,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } finally {
      this.isRunningMaintenance = false;
    }
  }

  /**
   * Run ANALYZE operation
   */
  async runAnalyze(): Promise<MaintenanceResult> {
    if (this.isRunningMaintenance) {
      logger.warn('MaintenanceScheduler', 'Maintenance already in progress');
      return {
        operation: 'ANALYZE',
        success: false,
        duration: 0,
        timestamp: new Date().toISOString(),
      };
    }

    this.isRunningMaintenance = true;
    const startTime = Date.now();

    try {
      logger.info('MaintenanceScheduler', 'Starting ANALYZE operation');

      // Run ANALYZE
      const db = new Database(this.dbPath);
      db.exec('ANALYZE;');
      db.close();

      const duration = Date.now() - startTime;

      // Update history
      const history = await this.loadHistory();
      history.lastAnalyze = new Date().toISOString();
      history.analyzeCount++;
      await this.saveHistory(history);

      logger.info('MaintenanceScheduler', 'ANALYZE completed', {
        duration,
      });

      return {
        operation: 'ANALYZE',
        success: true,
        duration,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('MaintenanceScheduler', 'ANALYZE failed', error as Error);
      return {
        operation: 'ANALYZE',
        success: false,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } finally {
      this.isRunningMaintenance = false;
    }
  }

  /**
   * Run both VACUUM and ANALYZE
   */
  async runFullMaintenance(): Promise<MaintenanceResult> {
    const startTime = Date.now();

    const vacuumResult = await this.runVacuum();
    if (!vacuumResult.success) {
      return vacuumResult;
    }

    const analyzeResult = await this.runAnalyze();
    if (!analyzeResult.success) {
      return analyzeResult;
    }

    return {
      operation: 'BOTH',
      success: true,
      duration: Date.now() - startTime,
      spaceRecovered: vacuumResult.spaceRecovered,
      dbSizeBefore: vacuumResult.dbSizeBefore,
      dbSizeAfter: vacuumResult.dbSizeAfter,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get maintenance history
   */
  async getHistory(): Promise<MaintenanceHistory> {
    return this.loadHistory();
  }
}

// Singleton instance
let schedulerInstance: MaintenanceScheduler | null = null;

export function getMaintenanceScheduler(): MaintenanceScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new MaintenanceScheduler();
  }
  return schedulerInstance;
}
