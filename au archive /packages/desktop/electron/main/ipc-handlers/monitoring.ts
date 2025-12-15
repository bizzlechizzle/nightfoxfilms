/**
 * Monitoring IPC Handlers
 * Handles monitoring:* IPC channels for observability dashboard
 */
import { ipcMain, BrowserWindow } from 'electron';
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';
import {
  getMetricsCollector,
  getTracer,
  getAlertManager,
  type Metric,
  type Span,
  type Alert,
} from '../../services/monitoring';
import { getLogger } from '../../services/logger-service';

const logger = getLogger();

// Store main window reference for alert notifications
let mainWindow: BrowserWindow | null = null;

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

export function registerMonitoringHandlers(db: Kysely<Database>) {
  const metrics = getMetricsCollector();
  const tracer = getTracer();
  const alertManager = getAlertManager();

  // ==========================================
  // Metrics Handlers
  // ==========================================

  /**
   * Get current metrics summary (counters, gauges, histograms)
   */
  ipcMain.handle('monitoring:getMetricsSummary', async () => {
    try {
      return metrics.getSummary();
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to get metrics summary', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get histogram statistics for a specific metric
   */
  ipcMain.handle('monitoring:getHistogramStats', async (_, name: string, tags?: Record<string, string>) => {
    try {
      return metrics.getHistogramStats(name, tags ?? {});
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to get histogram stats', error as Error, { name });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get metrics from database (historical)
   */
  ipcMain.handle('monitoring:getMetricsHistory', async (_, options?: {
    name?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }) => {
    try {
      let query = db.selectFrom('metrics').selectAll();

      if (options?.name) {
        query = query.where('name', '=', options.name);
      }
      if (options?.startTime) {
        query = query.where('timestamp', '>=', options.startTime);
      }
      if (options?.endTime) {
        query = query.where('timestamp', '<=', options.endTime);
      }

      query = query.orderBy('timestamp', 'desc');

      if (options?.limit) {
        query = query.limit(options.limit);
      } else {
        query = query.limit(1000); // Default limit
      }

      return await query.execute();
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to get metrics history', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ==========================================
  // Trace Handlers
  // ==========================================

  /**
   * Get active spans (currently running operations)
   */
  ipcMain.handle('monitoring:getActiveSpans', async () => {
    try {
      return tracer.getActiveSpans();
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to get active spans', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get spans for a specific trace
   */
  ipcMain.handle('monitoring:getTraceSpans', async (_, traceId: string) => {
    try {
      return tracer.getTraceSpans(traceId);
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to get trace spans', error as Error, { traceId });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get traces from database (historical)
   */
  ipcMain.handle('monitoring:getTracesHistory', async (_, options?: {
    operation?: string;
    traceId?: string;
    status?: 'running' | 'success' | 'error';
    startTime?: number;
    endTime?: number;
    limit?: number;
  }) => {
    try {
      let query = db.selectFrom('traces').selectAll();

      if (options?.operation) {
        query = query.where('operation', '=', options.operation);
      }
      if (options?.traceId) {
        query = query.where('trace_id', '=', options.traceId);
      }
      if (options?.status) {
        query = query.where('status', '=', options.status);
      }
      if (options?.startTime) {
        query = query.where('start_time', '>=', options.startTime);
      }
      if (options?.endTime) {
        query = query.where('start_time', '<=', options.endTime);
      }

      query = query.orderBy('start_time', 'desc');

      if (options?.limit) {
        query = query.limit(options.limit);
      } else {
        query = query.limit(100);
      }

      return await query.execute();
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to get traces history', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ==========================================
  // Alert Handlers
  // ==========================================

  /**
   * Get alert history
   */
  ipcMain.handle('monitoring:getAlertHistory', async (_, limit?: number) => {
    try {
      return alertManager.getAlertHistory(limit);
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to get alert history', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get alert rules
   */
  ipcMain.handle('monitoring:getAlertRules', async () => {
    try {
      return alertManager.getRules();
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to get alert rules', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Enable/disable an alert rule
   */
  ipcMain.handle('monitoring:setAlertRuleEnabled', async (_, ruleId: string, enabled: boolean) => {
    try {
      alertManager.setRuleEnabled(ruleId, enabled);
      logger.info('MonitoringHandlers', `Alert rule ${ruleId} ${enabled ? 'enabled' : 'disabled'}`);
      return { success: true };
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to set alert rule enabled', error as Error, { ruleId, enabled });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Acknowledge an alert in the database
   */
  ipcMain.handle('monitoring:acknowledgeAlert', async (_, alertId: number, userId?: string) => {
    try {
      await db
        .updateTable('alert_history')
        .set({
          acknowledged: 1,
          acknowledged_at: Date.now(),
          acknowledged_by: userId ?? null,
        })
        .where('id', '=', alertId)
        .execute();

      logger.info('MonitoringHandlers', 'Alert acknowledged', { alertId, userId });
      return { success: true };
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to acknowledge alert', error as Error, { alertId });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get unacknowledged alerts from database
   */
  ipcMain.handle('monitoring:getUnacknowledgedAlerts', async (_, limit?: number) => {
    try {
      return await db
        .selectFrom('alert_history')
        .selectAll()
        .where('acknowledged', '=', 0)
        .orderBy('timestamp', 'desc')
        .limit(limit ?? 50)
        .execute();
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to get unacknowledged alerts', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ==========================================
  // Job Audit Handlers
  // ==========================================

  /**
   * Get job audit log (execution history)
   */
  ipcMain.handle('monitoring:getJobAuditLog', async (_, options?: {
    queue?: string;
    jobId?: string;
    assetHash?: string;
    status?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }) => {
    try {
      let query = db.selectFrom('job_audit_log').selectAll();

      if (options?.queue) {
        query = query.where('queue', '=', options.queue);
      }
      if (options?.jobId) {
        query = query.where('job_id', '=', options.jobId);
      }
      if (options?.assetHash) {
        query = query.where('asset_hash', '=', options.assetHash);
      }
      if (options?.status) {
        query = query.where('status', '=', options.status as 'started' | 'success' | 'error' | 'timeout');
      }
      if (options?.startTime) {
        query = query.where('started_at', '>=', options.startTime);
      }
      if (options?.endTime) {
        query = query.where('started_at', '<=', options.endTime);
      }

      query = query.orderBy('started_at', 'desc');

      if (options?.limit) {
        query = query.limit(options.limit);
      } else {
        query = query.limit(100);
      }

      return await query.execute();
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to get job audit log', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get job performance stats by queue
   */
  ipcMain.handle('monitoring:getJobPerformanceStats', async (_, options?: {
    queue?: string;
    startTime?: number;
    endTime?: number;
  }) => {
    try {
      // Get count and avg duration by queue and status
      let query = db
        .selectFrom('job_audit_log')
        .select([
          'queue',
          'status',
          (eb) => eb.fn.count<number>('id').as('count'),
          (eb) => eb.fn.avg<number>('duration').as('avg_duration'),
        ])
        .groupBy(['queue', 'status']);

      if (options?.queue) {
        query = query.where('queue', '=', options.queue);
      }
      if (options?.startTime) {
        query = query.where('started_at', '>=', options.startTime);
      }
      if (options?.endTime) {
        query = query.where('started_at', '<=', options.endTime);
      }

      return await query.execute();
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to get job performance stats', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ==========================================
  // Import Audit Handlers
  // ==========================================

  /**
   * Get import audit log for a session
   */
  ipcMain.handle('monitoring:getImportAuditLog', async (_, sessionId: string) => {
    try {
      return await db
        .selectFrom('import_audit_log')
        .selectAll()
        .where('session_id', '=', sessionId)
        .orderBy('timestamp', 'asc')
        .execute();
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to get import audit log', error as Error, { sessionId });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ==========================================
  // Health Snapshot Handlers
  // ==========================================

  /**
   * Get health snapshots (historical health state)
   */
  ipcMain.handle('monitoring:getHealthSnapshots', async (_, options?: {
    startTime?: number;
    endTime?: number;
    limit?: number;
  }) => {
    try {
      let query = db.selectFrom('health_snapshots').selectAll();

      if (options?.startTime) {
        query = query.where('timestamp', '>=', options.startTime);
      }
      if (options?.endTime) {
        query = query.where('timestamp', '<=', options.endTime);
      }

      query = query.orderBy('timestamp', 'desc');

      if (options?.limit) {
        query = query.limit(options.limit);
      } else {
        query = query.limit(100);
      }

      return await query.execute();
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to get health snapshots', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ==========================================
  // Monitoring System Control
  // ==========================================

  /**
   * Start monitoring services (metrics collection, alert checking)
   */
  ipcMain.handle('monitoring:start', async () => {
    try {
      // Start metrics collection with database persistence
      metrics.start(async (metricsToFlush: Metric[]) => {
        if (metricsToFlush.length === 0) return;

        const values = metricsToFlush.map(m => ({
          name: m.name,
          value: m.value,
          timestamp: m.timestamp,
          type: m.type,
          tags: m.tags ? JSON.stringify(m.tags) : null,
        }));

        await db.insertInto('metrics').values(values).execute();
      });

      // Set up trace persistence
      tracer.setPersistCallback(async (span: Span) => {
        await db.insertInto('traces').values({
          span_id: span.spanId,
          trace_id: span.traceId,
          parent_span_id: span.parentSpanId,
          operation: span.operation,
          start_time: span.startTime,
          end_time: span.endTime,
          duration: span.duration,
          status: span.status,
          tags: JSON.stringify(span.tags),
          logs: JSON.stringify(span.logs),
        }).execute();
      });

      // Set up alert persistence and notification
      alertManager.on('alert', async (alert: Alert) => {
        // Persist to database
        await db.insertInto('alert_history').values({
          alert_id: alert.id,
          name: alert.name,
          severity: alert.severity,
          message: alert.message,
          timestamp: alert.timestamp,
          context: alert.context ? JSON.stringify(alert.context) : null,
          acknowledged: 0,
          acknowledged_at: null,
          acknowledged_by: null,
        }).execute();

        // Notify renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('monitoring:alert', alert);
        }
      });

      // Start alert checking (every 30 seconds)
      alertManager.start(30000);

      logger.info('MonitoringHandlers', 'Monitoring services started');
      return { success: true };
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to start monitoring', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Stop monitoring services
   */
  ipcMain.handle('monitoring:stop', async () => {
    try {
      const remainingMetrics = metrics.stop();
      alertManager.stop();

      // Flush remaining metrics
      if (remainingMetrics.length > 0) {
        const values = remainingMetrics.map(m => ({
          name: m.name,
          value: m.value,
          timestamp: m.timestamp,
          type: m.type,
          tags: m.tags ? JSON.stringify(m.tags) : null,
        }));

        await db.insertInto('metrics').values(values).execute();
      }

      logger.info('MonitoringHandlers', 'Monitoring services stopped');
      return { success: true };
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to stop monitoring', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Clean up old monitoring data (data retention)
   */
  ipcMain.handle('monitoring:cleanup', async (_, options?: {
    metricsOlderThanDays?: number;
    tracesOlderThanDays?: number;
    alertsOlderThanDays?: number;
  }) => {
    try {
      const metricsRetention = options?.metricsOlderThanDays ?? 30;
      const tracesRetention = options?.tracesOlderThanDays ?? 7;
      const alertsRetention = options?.alertsOlderThanDays ?? 90;

      const now = Date.now();
      const metricsThreshold = now - (metricsRetention * 24 * 60 * 60 * 1000);
      const tracesThreshold = now - (tracesRetention * 24 * 60 * 60 * 1000);
      const alertsThreshold = now - (alertsRetention * 24 * 60 * 60 * 1000);

      // Delete old metrics
      const metricsDeleted = await db
        .deleteFrom('metrics')
        .where('timestamp', '<', metricsThreshold)
        .executeTakeFirst();

      // Delete old traces
      const tracesDeleted = await db
        .deleteFrom('traces')
        .where('start_time', '<', tracesThreshold)
        .executeTakeFirst();

      // Delete old acknowledged alerts
      const alertsDeleted = await db
        .deleteFrom('alert_history')
        .where('timestamp', '<', alertsThreshold)
        .where('acknowledged', '=', 1)
        .executeTakeFirst();

      // Delete old job audit logs (keep 30 days)
      const jobAuditDeleted = await db
        .deleteFrom('job_audit_log')
        .where('started_at', '<', metricsThreshold)
        .executeTakeFirst();

      // Delete old import audit logs (keep 30 days)
      const importAuditDeleted = await db
        .deleteFrom('import_audit_log')
        .where('timestamp', '<', metricsThreshold)
        .executeTakeFirst();

      // Delete old health snapshots (keep 30 days)
      const healthSnapshotsDeleted = await db
        .deleteFrom('health_snapshots')
        .where('timestamp', '<', metricsThreshold)
        .executeTakeFirst();

      logger.info('MonitoringHandlers', 'Monitoring data cleanup completed', {
        metricsDeleted: Number(metricsDeleted?.numDeletedRows ?? 0),
        tracesDeleted: Number(tracesDeleted?.numDeletedRows ?? 0),
        alertsDeleted: Number(alertsDeleted?.numDeletedRows ?? 0),
        jobAuditDeleted: Number(jobAuditDeleted?.numDeletedRows ?? 0),
        importAuditDeleted: Number(importAuditDeleted?.numDeletedRows ?? 0),
        healthSnapshotsDeleted: Number(healthSnapshotsDeleted?.numDeletedRows ?? 0),
      });

      return {
        success: true,
        deleted: {
          metrics: Number(metricsDeleted?.numDeletedRows ?? 0),
          traces: Number(tracesDeleted?.numDeletedRows ?? 0),
          alerts: Number(alertsDeleted?.numDeletedRows ?? 0),
          jobAudit: Number(jobAuditDeleted?.numDeletedRows ?? 0),
          importAudit: Number(importAuditDeleted?.numDeletedRows ?? 0),
          healthSnapshots: Number(healthSnapshotsDeleted?.numDeletedRows ?? 0),
        },
      };
    } catch (error) {
      logger.error('MonitoringHandlers', 'Failed to cleanup monitoring data', error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  logger.info('MonitoringHandlers', 'Monitoring IPC handlers registered');
}
