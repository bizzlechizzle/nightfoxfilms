/**
 * MetricsCollector - Time-series performance metrics collection
 *
 * Collects counters, gauges, and histograms for:
 * - Import pipeline throughput
 * - Job queue performance
 * - File operation timing
 * - Resource usage
 *
 * @module services/monitoring/metrics-collector
 */

import { EventEmitter } from 'events';
import { getLogger } from '../logger-service';

const logger = getLogger();

export interface Metric {
  name: string;
  value: number;
  timestamp: number;
  tags: Record<string, string>;
  type: 'counter' | 'gauge' | 'histogram';
}

export interface MetricsSummary {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, HistogramStats>;
}

export interface HistogramStats {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface TimerHandle {
  end: (tags?: Record<string, string>) => number;
}

/**
 * In-memory metrics collector with periodic flushing
 * Emits events for real-time subscribers
 */
export class MetricsCollector extends EventEmitter {
  private metrics: Metric[] = [];
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histogramValues: Map<string, number[]> = new Map();
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly maxMetricsInMemory: number;
  private readonly flushIntervalMs: number;

  constructor(options?: { maxMetricsInMemory?: number; flushIntervalMs?: number }) {
    super();
    this.maxMetricsInMemory = options?.maxMetricsInMemory ?? 10000;
    this.flushIntervalMs = options?.flushIntervalMs ?? 60000; // 1 minute default
  }

  /**
   * Start periodic flushing to database
   */
  start(flushCallback?: (metrics: Metric[]) => Promise<void>): void {
    if (this.flushInterval) {
      return;
    }

    this.flushInterval = setInterval(async () => {
      const metricsToFlush = this.flush();
      if (metricsToFlush.length > 0 && flushCallback) {
        try {
          await flushCallback(metricsToFlush);
        } catch (error) {
          logger.error('MetricsCollector', 'Failed to flush metrics', error as Error);
        }
      }
    }, this.flushIntervalMs);

    logger.info('MetricsCollector', 'Started metrics collection', {
      flushIntervalMs: this.flushIntervalMs,
      maxMetricsInMemory: this.maxMetricsInMemory,
    });
  }

  /**
   * Stop periodic flushing
   */
  stop(): Metric[] {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    return this.flush();
  }

  /**
   * Flush collected metrics and return them
   */
  flush(): Metric[] {
    const flushed = [...this.metrics];
    this.metrics = [];
    return flushed;
  }

  /**
   * Counter: monotonically increasing value
   * Use for: files processed, bytes transferred, errors encountered
   */
  incrementCounter(name: string, value = 1, tags: Record<string, string> = {}): void {
    const key = this.makeKey(name, tags);
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + value);

    this.record(name, value, tags, 'counter');
  }

  /**
   * Get current counter value
   */
  getCounter(name: string, tags: Record<string, string> = {}): number {
    const key = this.makeKey(name, tags);
    return this.counters.get(key) ?? 0;
  }

  /**
   * Gauge: point-in-time value
   * Use for: queue depth, active workers, memory usage
   */
  gauge(name: string, value: number, tags: Record<string, string> = {}): void {
    const key = this.makeKey(name, tags);
    this.gauges.set(key, value);

    this.record(name, value, tags, 'gauge');
  }

  /**
   * Get current gauge value
   */
  getGauge(name: string, tags: Record<string, string> = {}): number | undefined {
    const key = this.makeKey(name, tags);
    return this.gauges.get(key);
  }

  /**
   * Histogram: distribution of values
   * Use for: latencies, file sizes, batch sizes
   */
  histogram(name: string, value: number, tags: Record<string, string> = {}): void {
    const key = this.makeKey(name, tags);
    const values = this.histogramValues.get(key) ?? [];
    values.push(value);

    // Keep only last 1000 values per histogram to limit memory
    if (values.length > 1000) {
      values.shift();
    }
    this.histogramValues.set(key, values);

    this.record(name, value, tags, 'histogram');
  }

  /**
   * Get histogram statistics
   */
  getHistogramStats(name: string, tags: Record<string, string> = {}): HistogramStats | null {
    const key = this.makeKey(name, tags);
    const values = this.histogramValues.get(key);

    if (!values || values.length === 0) {
      return null;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      count: values.length,
      sum,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / values.length,
      p50: this.percentile(sorted, 50),
      p90: this.percentile(sorted, 90),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
    };
  }

  /**
   * Timer: measure duration of an operation
   * Returns a handle that must be called to end timing
   */
  timer(name: string, tags: Record<string, string> = {}): TimerHandle {
    const start = performance.now();

    return {
      end: (additionalTags?: Record<string, string>): number => {
        const duration = performance.now() - start;
        this.histogram(name, duration, { ...tags, ...additionalTags });
        return duration;
      },
    };
  }

  /**
   * Get summary of all metrics
   */
  getSummary(): MetricsSummary {
    const counters: Record<string, number> = {};
    const gauges: Record<string, number> = {};
    const histograms: Record<string, HistogramStats> = {};

    for (const [key, value] of this.counters) {
      counters[key] = value;
    }

    for (const [key, value] of this.gauges) {
      gauges[key] = value;
    }

    for (const [key] of this.histogramValues) {
      const stats = this.getHistogramStatsForKey(key);
      if (stats) {
        histograms[key] = stats;
      }
    }

    return { counters, gauges, histograms };
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.metrics = [];
    this.counters.clear();
    this.gauges.clear();
    this.histogramValues.clear();
  }

  private record(
    name: string,
    value: number,
    tags: Record<string, string>,
    type: Metric['type']
  ): void {
    const metric: Metric = {
      name,
      value,
      timestamp: Date.now(),
      tags,
      type,
    };

    this.metrics.push(metric);

    // Trim if we exceed max
    if (this.metrics.length > this.maxMetricsInMemory) {
      this.metrics = this.metrics.slice(-this.maxMetricsInMemory);
    }

    // Emit for real-time subscribers
    this.emit('metric', metric);
  }

  private makeKey(name: string, tags: Record<string, string>): string {
    const tagStr = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return tagStr ? `${name}{${tagStr}}` : name;
  }

  private getHistogramStatsForKey(key: string): HistogramStats | null {
    const values = this.histogramValues.get(key);
    if (!values || values.length === 0) {
      return null;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      count: values.length,
      sum,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / values.length,
      p50: this.percentile(sorted, 50),
      p90: this.percentile(sorted, 90),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
    };
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }
}

// Singleton instance
let metricsInstance: MetricsCollector | null = null;

export function getMetricsCollector(): MetricsCollector {
  if (!metricsInstance) {
    metricsInstance = new MetricsCollector();
  }
  return metricsInstance;
}

// ==========================================
// Standard metric names for the application
// ==========================================

export const MetricNames = {
  // Import pipeline
  IMPORT_STARTED: 'import.started',
  IMPORT_COMPLETED: 'import.completed',
  IMPORT_FAILED: 'import.failed',
  IMPORT_FILES_SCANNED: 'import.files.scanned',
  IMPORT_FILES_PROCESSED: 'import.files.processed',
  IMPORT_FILES_DUPLICATES: 'import.files.duplicates',
  IMPORT_FILES_ERRORS: 'import.files.errors',
  IMPORT_BYTES_PROCESSED: 'import.bytes.processed',
  IMPORT_DURATION: 'import.duration',
  IMPORT_THROUGHPUT_MBPS: 'import.throughput.mbps',

  // Per-step timing
  IMPORT_SCAN_DURATION: 'import.scan.duration',
  IMPORT_HASH_DURATION: 'import.hash.duration',
  IMPORT_COPY_DURATION: 'import.copy.duration',
  IMPORT_VALIDATE_DURATION: 'import.validate.duration',
  IMPORT_FINALIZE_DURATION: 'import.finalize.duration',

  // File operations
  FILE_HASH_DURATION: 'file.hash.duration',
  FILE_COPY_DURATION: 'file.copy.duration',
  FILE_SIZE: 'file.size',

  // Job queue
  JOBS_ENQUEUED: 'jobs.enqueued',
  JOBS_COMPLETED: 'jobs.completed',
  JOBS_FAILED: 'jobs.failed',
  JOBS_RETRIED: 'jobs.retried',
  JOBS_DEAD: 'jobs.dead',
  JOBS_DURATION: 'jobs.duration',
  JOBS_QUEUE_DEPTH: 'jobs.queue.depth',
  JOBS_QUEUE_OLDEST: 'jobs.queue.oldest',

  // Workers
  WORKERS_ACTIVE: 'workers.active',
  WORKERS_IDLE: 'workers.idle',

  // Resource usage
  SYSTEM_MEMORY_USED: 'system.memory.used',
  SYSTEM_MEMORY_HEAP: 'system.memory.heap',
  SYSTEM_DISK_FREE: 'system.disk.free',

  // Errors
  ERRORS_COUNT: 'errors.count',
  ERRORS_DISK_FULL: 'errors.disk_full',
  ERRORS_PERMISSION_DENIED: 'errors.permission_denied',
  ERRORS_HASH_MISMATCH: 'errors.hash_mismatch',
} as const;
