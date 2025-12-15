/**
 * AlertManager - Proactive problem detection and notification
 *
 * Monitors system health and triggers alerts when thresholds are exceeded.
 * Supports cooldowns to prevent alert fatigue.
 *
 * @module services/monitoring/alert-manager
 */

import { EventEmitter } from 'events';
import { getLogger } from '../logger-service';
import { getMetricsCollector, MetricNames } from './metrics-collector';

const logger = getLogger();

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Alert {
  id: string;
  name: string;
  severity: AlertSeverity;
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  severity: AlertSeverity;
  condition: (metrics: AlertMetrics) => boolean;
  getMessage: (metrics: AlertMetrics) => string;
  cooldownMs: number; // Minimum time between alerts
  enabled: boolean;
}

export interface AlertMetrics {
  // Disk space
  diskSpacePercent: number;
  diskSpaceFreeGB: number;

  // Job queue
  jobsPending: number;
  jobsProcessing: number;
  jobsFailed: number;
  jobsDead: number;
  oldestJobAgeMinutes: number;

  // Import
  activeImports: number;
  importErrorRate: number; // Errors per minute in last hour

  // Workers
  workersActive: number;
  workersIdle: number;

  // Errors
  errorsLastHour: number;
  errorRatePerMinute: number;
}

/**
 * AlertManager monitors metrics and fires alerts
 */
export class AlertManager extends EventEmitter {
  private rules: AlertRule[] = [];
  private lastAlertTime: Map<string, number> = new Map();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private alertHistory: Alert[] = [];
  private readonly maxAlertHistory: number;

  constructor(options?: { maxAlertHistory?: number }) {
    super();
    this.maxAlertHistory = options?.maxAlertHistory ?? 100;
    this.initializeDefaultRules();
  }

  /**
   * Initialize default alert rules
   */
  private initializeDefaultRules(): void {
    this.rules = [
      {
        id: 'disk_space_critical',
        name: 'Critical Disk Space',
        description: 'Disk space below 5%',
        severity: 'critical',
        condition: (m) => m.diskSpacePercent < 5,
        getMessage: (m) => `Critical: Only ${m.diskSpaceFreeGB.toFixed(1)}GB free (${m.diskSpacePercent.toFixed(1)}%)`,
        cooldownMs: 5 * 60 * 1000, // 5 minutes
        enabled: true,
      },
      {
        id: 'disk_space_low',
        name: 'Low Disk Space',
        description: 'Disk space below 15%',
        severity: 'warning',
        condition: (m) => m.diskSpacePercent >= 5 && m.diskSpacePercent < 15,
        getMessage: (m) => `Warning: Disk space at ${m.diskSpacePercent.toFixed(1)}% (${m.diskSpaceFreeGB.toFixed(1)}GB free)`,
        cooldownMs: 15 * 60 * 1000, // 15 minutes
        enabled: true,
      },
      {
        id: 'job_queue_stuck',
        name: 'Job Queue Stuck',
        description: 'Oldest job is older than 60 minutes',
        severity: 'warning',
        condition: (m) => m.oldestJobAgeMinutes > 60,
        getMessage: (m) => `Job stuck in queue for ${m.oldestJobAgeMinutes.toFixed(0)} minutes`,
        cooldownMs: 10 * 60 * 1000, // 10 minutes
        enabled: true,
      },
      {
        id: 'high_error_rate',
        name: 'High Error Rate',
        description: 'More than 10 errors in the last hour',
        severity: 'warning',
        condition: (m) => m.errorsLastHour > 10,
        getMessage: (m) => `High error rate: ${m.errorsLastHour} errors in the last hour`,
        cooldownMs: 10 * 60 * 1000, // 10 minutes
        enabled: true,
      },
      {
        id: 'dead_letter_queue_growing',
        name: 'Dead Letter Queue Growing',
        description: 'More than 5 jobs in dead letter queue',
        severity: 'warning',
        condition: (m) => m.jobsDead > 5,
        getMessage: (m) => `${m.jobsDead} jobs have permanently failed and need attention`,
        cooldownMs: 30 * 60 * 1000, // 30 minutes
        enabled: true,
      },
      {
        id: 'no_workers_available',
        name: 'No Workers Available',
        description: 'All workers are busy with pending jobs',
        severity: 'warning',
        condition: (m) => m.workersIdle === 0 && m.jobsPending > 10,
        getMessage: (m) => `All workers busy with ${m.jobsPending} jobs pending`,
        cooldownMs: 5 * 60 * 1000, // 5 minutes
        enabled: true,
      },
    ];
  }

  /**
   * Add a custom alert rule
   */
  addRule(rule: AlertRule): void {
    // Remove existing rule with same ID
    this.rules = this.rules.filter(r => r.id !== rule.id);
    this.rules.push(rule);
  }

  /**
   * Remove an alert rule
   */
  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId);
  }

  /**
   * Enable/disable a rule
   */
  setRuleEnabled(ruleId: string, enabled: boolean): void {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.enabled = enabled;
    }
  }

  /**
   * Get all rules
   */
  getRules(): AlertRule[] {
    return [...this.rules];
  }

  /**
   * Start periodic alert checking
   */
  start(intervalMs = 30000, metricsProvider?: () => Promise<AlertMetrics>): void {
    if (this.checkInterval) {
      return;
    }

    this.checkInterval = setInterval(async () => {
      try {
        const metrics = metricsProvider
          ? await metricsProvider()
          : await this.getDefaultMetrics();

        await this.checkAlerts(metrics);
      } catch (error) {
        logger.error('AlertManager', 'Failed to check alerts', error as Error);
      }
    }, intervalMs);

    logger.info('AlertManager', 'Started alert monitoring', { intervalMs });
  }

  /**
   * Stop periodic alert checking
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Manually check alerts with provided metrics
   */
  async checkAlerts(metrics: AlertMetrics): Promise<Alert[]> {
    const triggeredAlerts: Alert[] = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      try {
        if (!rule.condition(metrics)) continue;

        // Check cooldown
        const lastAlert = this.lastAlertTime.get(rule.id) ?? 0;
        if (Date.now() - lastAlert < rule.cooldownMs) continue;

        // Trigger alert
        const alert = this.triggerAlert(rule, metrics);
        triggeredAlerts.push(alert);
        this.lastAlertTime.set(rule.id, Date.now());
      } catch (error) {
        logger.error('AlertManager', `Error evaluating rule ${rule.id}`, error as Error);
      }
    }

    return triggeredAlerts;
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit?: number): Alert[] {
    const history = [...this.alertHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * Clear alert history
   */
  clearHistory(): void {
    this.alertHistory = [];
  }

  /**
   * Manually trigger an alert (for testing or custom alerts)
   */
  triggerManualAlert(
    name: string,
    message: string,
    severity: AlertSeverity = 'info',
    context?: Record<string, unknown>
  ): Alert {
    const alert: Alert = {
      id: `manual_${Date.now()}`,
      name,
      severity,
      message,
      timestamp: Date.now(),
      context,
    };

    this.recordAlert(alert);
    return alert;
  }

  private triggerAlert(rule: AlertRule, metrics: AlertMetrics): Alert {
    const alert: Alert = {
      id: rule.id,
      name: rule.name,
      severity: rule.severity,
      message: rule.getMessage(metrics),
      timestamp: Date.now(),
      context: { metrics },
    };

    logger.warn('AlertManager', `Alert triggered: ${rule.name}`, {
      ruleId: rule.id,
      severity: rule.severity,
      message: alert.message,
    });

    this.recordAlert(alert);
    return alert;
  }

  private recordAlert(alert: Alert): void {
    this.alertHistory.push(alert);

    // Trim history
    if (this.alertHistory.length > this.maxAlertHistory) {
      this.alertHistory = this.alertHistory.slice(-this.maxAlertHistory);
    }

    // Emit event for real-time listeners
    this.emit('alert', alert);
  }

  private async getDefaultMetrics(): Promise<AlertMetrics> {
    // Default implementation uses MetricsCollector gauges
    const metrics = getMetricsCollector();

    return {
      diskSpacePercent: metrics.getGauge('system.disk.percent') ?? 100,
      diskSpaceFreeGB: metrics.getGauge(MetricNames.SYSTEM_DISK_FREE) ?? 0,
      jobsPending: metrics.getGauge(MetricNames.JOBS_QUEUE_DEPTH) ?? 0,
      jobsProcessing: metrics.getGauge('jobs.processing') ?? 0,
      jobsFailed: metrics.getCounter(MetricNames.JOBS_FAILED) ?? 0,
      jobsDead: metrics.getCounter(MetricNames.JOBS_DEAD) ?? 0,
      oldestJobAgeMinutes: metrics.getGauge(MetricNames.JOBS_QUEUE_OLDEST) ?? 0,
      activeImports: metrics.getGauge('import.active') ?? 0,
      importErrorRate: metrics.getGauge('import.error_rate') ?? 0,
      workersActive: metrics.getGauge(MetricNames.WORKERS_ACTIVE) ?? 0,
      workersIdle: metrics.getGauge(MetricNames.WORKERS_IDLE) ?? 0,
      errorsLastHour: metrics.getCounter(MetricNames.ERRORS_COUNT) ?? 0,
      errorRatePerMinute: metrics.getGauge('errors.rate_per_minute') ?? 0,
    };
  }
}

// Singleton instance
let alertManagerInstance: AlertManager | null = null;

export function getAlertManager(): AlertManager {
  if (!alertManagerInstance) {
    alertManagerInstance = new AlertManager();
  }
  return alertManagerInstance;
}
