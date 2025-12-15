/**
 * Tracer - Distributed tracing for multi-step operations
 *
 * Provides request-scoped tracing for import pipelines and job execution.
 * Each trace contains multiple spans showing timing and relationships.
 *
 * @module services/monitoring/tracer
 */

import { generateId } from '../../main/ipc-validation';
import { getLogger } from '../logger-service';

const logger = getLogger();

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operation: string;
  startTime: number;
  endTime: number | null;
  duration: number | null;
  status: 'running' | 'success' | 'error';
  tags: Record<string, unknown>;
  logs: SpanLog[];
}

export interface SpanLog {
  timestamp: number;
  message: string;
  fields?: Record<string, unknown>;
}

export interface SpanHandle {
  spanId: string;
  traceId: string;
  log: (message: string, fields?: Record<string, unknown>) => void;
  setTag: (key: string, value: unknown) => void;
  setTags: (tags: Record<string, unknown>) => void;
  child: (operation: string, tags?: Record<string, unknown>) => SpanHandle;
  end: (status?: 'success' | 'error', tags?: Record<string, unknown>) => Span;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
}

/**
 * Tracer for creating and managing distributed traces
 */
export class Tracer {
  private activeSpans: Map<string, Span> = new Map();
  private completedSpans: Span[] = [];
  private readonly maxCompletedSpans: number;
  private persistCallback?: (span: Span) => Promise<void>;

  constructor(options?: { maxCompletedSpans?: number }) {
    this.maxCompletedSpans = options?.maxCompletedSpans ?? 1000;
  }

  /**
   * Set callback for persisting completed spans
   */
  setPersistCallback(callback: (span: Span) => Promise<void>): void {
    this.persistCallback = callback;
  }

  /**
   * Start a new root span (new trace)
   */
  startSpan(operation: string, tags?: Record<string, unknown>): SpanHandle {
    return this.createSpan(operation, null, tags);
  }

  /**
   * Start a child span within an existing trace
   */
  startChildSpan(
    operation: string,
    parent: TraceContext | SpanHandle,
    tags?: Record<string, unknown>
  ): SpanHandle {
    const parentContext: TraceContext = 'traceId' in parent
      ? { traceId: parent.traceId, spanId: parent.spanId }
      : parent;
    return this.createSpan(operation, parentContext, tags);
  }

  /**
   * Get all active spans
   */
  getActiveSpans(): Span[] {
    return Array.from(this.activeSpans.values());
  }

  /**
   * Get completed spans for a trace
   */
  getTraceSpans(traceId: string): Span[] {
    return this.completedSpans.filter(s => s.traceId === traceId);
  }

  /**
   * Get a span by ID
   */
  getSpan(spanId: string): Span | undefined {
    return this.activeSpans.get(spanId) || this.completedSpans.find(s => s.spanId === spanId);
  }

  /**
   * Clear all completed spans (useful for testing)
   */
  reset(): void {
    this.activeSpans.clear();
    this.completedSpans = [];
  }

  /**
   * Wrap an async function with tracing
   */
  async trace<T>(
    operation: string,
    fn: (span: SpanHandle) => Promise<T>,
    tags?: Record<string, unknown>
  ): Promise<T> {
    const span = this.startSpan(operation, tags);

    try {
      const result = await fn(span);
      span.end('success');
      return result;
    } catch (error) {
      span.log('Error occurred', { error: (error as Error).message });
      span.end('error', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Wrap an async function with tracing as a child span
   */
  async traceChild<T>(
    operation: string,
    parent: TraceContext | SpanHandle,
    fn: (span: SpanHandle) => Promise<T>,
    tags?: Record<string, unknown>
  ): Promise<T> {
    const span = this.startChildSpan(operation, parent, tags);

    try {
      const result = await fn(span);
      span.end('success');
      return result;
    } catch (error) {
      span.log('Error occurred', { error: (error as Error).message });
      span.end('error', { error: (error as Error).message });
      throw error;
    }
  }

  private createSpan(
    operation: string,
    parentContext: TraceContext | null,
    tags?: Record<string, unknown>
  ): SpanHandle {
    const spanId = generateId();
    const traceId = parentContext?.traceId ?? generateId();
    const parentSpanId = parentContext?.spanId ?? null;

    const span: Span = {
      traceId,
      spanId,
      parentSpanId,
      operation,
      startTime: Date.now(),
      endTime: null,
      duration: null,
      status: 'running',
      tags: tags ?? {},
      logs: [],
    };

    this.activeSpans.set(spanId, span);

    const handle: SpanHandle = {
      spanId,
      traceId,

      log: (message: string, fields?: Record<string, unknown>) => {
        span.logs.push({
          timestamp: Date.now(),
          message,
          fields,
        });
      },

      setTag: (key: string, value: unknown) => {
        span.tags[key] = value;
      },

      setTags: (newTags: Record<string, unknown>) => {
        Object.assign(span.tags, newTags);
      },

      child: (childOperation: string, childTags?: Record<string, unknown>) => {
        return this.createSpan(childOperation, { traceId, spanId }, childTags);
      },

      end: (status: 'success' | 'error' = 'success', additionalTags?: Record<string, unknown>) => {
        span.endTime = Date.now();
        span.duration = span.endTime - span.startTime;
        span.status = status;

        if (additionalTags) {
          Object.assign(span.tags, additionalTags);
        }

        this.activeSpans.delete(spanId);
        this.completedSpans.push(span);

        // Trim completed spans to prevent memory growth
        if (this.completedSpans.length > this.maxCompletedSpans) {
          this.completedSpans = this.completedSpans.slice(-this.maxCompletedSpans);
        }

        // Persist if callback is set
        if (this.persistCallback) {
          this.persistCallback(span).catch(error => {
            logger.error('Tracer', 'Failed to persist span', error as Error, { spanId });
          });
        }

        return span;
      },
    };

    return handle;
  }
}

// Singleton instance
let tracerInstance: Tracer | null = null;

export function getTracer(): Tracer {
  if (!tracerInstance) {
    tracerInstance = new Tracer();
  }
  return tracerInstance;
}

// ==========================================
// Standard operation names for the application
// ==========================================

export const OperationNames = {
  // Import pipeline
  IMPORT_SESSION: 'import.session',
  IMPORT_SCAN: 'import.scan',
  IMPORT_HASH: 'import.hash',
  IMPORT_COPY: 'import.copy',
  IMPORT_VALIDATE: 'import.validate',
  IMPORT_FINALIZE: 'import.finalize',

  // Per-file operations
  FILE_SCAN: 'file.scan',
  FILE_HASH: 'file.hash',
  FILE_COPY: 'file.copy',
  FILE_VALIDATE: 'file.validate',

  // Job execution
  JOB_PROCESS: 'job.process',
  JOB_EXECUTE: 'job.execute',
  JOB_THUMBNAIL: 'job.thumbnail',
  JOB_EXIFTOOL: 'job.exiftool',
  JOB_FFPROBE: 'job.ffprobe',
  JOB_VIDEO_PROXY: 'job.video_proxy',
  JOB_LIVE_PHOTO: 'job.live_photo',
  JOB_BAGIT: 'job.bagit',

  // Database operations
  DB_TRANSACTION: 'db.transaction',
  DB_QUERY: 'db.query',
  DB_INSERT: 'db.insert',
  DB_UPDATE: 'db.update',
} as const;
