/**
 * JobQueue - SQLite-backed priority queue with dependency support
 *
 * Per Import Spec v2.0:
 * - SQLite persistence (no Redis dependency)
 * - Priority ordering (higher = more important)
 * - Job dependencies (wait for parent job to complete)
 * - Retry with exponential backoff (max 3 attempts)
 * - Dead letter queue for failed jobs
 * - Atomic job claiming with locking
 *
 * @module services/job-queue
 */

import { generateId } from '../main/ipc-validation';
import type { Kysely } from 'kysely';
import type { Database, JobsTable } from '../main/database.types';
import { getLogger } from './logger-service';
import { getMetricsCollector, MetricNames } from './monitoring/metrics-collector';

const logger = getLogger();
const metrics = getMetricsCollector();

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead';

export interface JobInput<T = unknown> {
  queue: string;
  payload: T;
  priority?: number;          // Higher = more important (default: 10)
  dependsOn?: string;         // job_id this job depends on
  maxAttempts?: number;       // Max retries (default: 3)
  jobId?: string;             // OPT-087: Pre-generated job ID for dependency synchronization
}

export interface Job<T = unknown> {
  jobId: string;
  queue: string;
  priority: number;
  status: JobStatus;
  payload: T;
  dependsOn: string | null;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  result: unknown | null;
  createdAt: string;  // ISO string for IPC serialization
  startedAt: string | null;  // ISO string for IPC serialization
  completedAt: string | null;  // ISO string for IPC serialization
}

export interface JobQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dead: number;
  total: number;
}

/**
 * SQLite-backed job queue with priority and dependency support
 */
export class JobQueue {
  private readonly workerId: string;
  private readonly staleLockTimeoutMs: number;

  constructor(
    private readonly db: Kysely<Database>,
    options?: {
      workerId?: string;
      staleLockTimeoutMs?: number;
    }
  ) {
    this.workerId = options?.workerId ?? `worker-${generateId().slice(0, 8)}`;
    this.staleLockTimeoutMs = options?.staleLockTimeoutMs ?? 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get the worker ID for this queue instance
   */
  getWorkerId(): string {
    return this.workerId;
  }

  /**
   * Add a single job to the queue
   */
  async addJob<T>(input: JobInput<T>): Promise<string> {
    const jobId = generateId();
    const now = new Date().toISOString();

    await this.db
      .insertInto('jobs')
      .values({
        job_id: jobId,
        queue: input.queue,
        priority: input.priority ?? 10,
        status: 'pending',
        payload: JSON.stringify(input.payload),
        depends_on: input.dependsOn ?? null,
        attempts: 0,
        max_attempts: input.maxAttempts ?? 3,
        error: null,
        result: null,
        created_at: now,
        started_at: null,
        completed_at: null,
        locked_by: null,
        locked_at: null,
        retry_after: null,    // Migration 50: exponential backoff
        last_error: null,     // Migration 50: error history
      })
      .execute();

    // Record metric
    metrics.incrementCounter(MetricNames.JOBS_ENQUEUED, 1, { queue: input.queue });

    return jobId;
  }

  /**
   * Add multiple jobs to the queue in a single transaction
   * OPT-087: Accepts optional pre-generated job IDs for dependency synchronization
   */
  async addBulk<T>(inputs: JobInput<T>[]): Promise<string[]> {
    const jobIds: string[] = [];
    const now = new Date().toISOString();

    const values = inputs.map(input => {
      // OPT-087: Use pre-generated jobId if provided, otherwise generate new one
      const jobId = input.jobId || generateId();
      jobIds.push(jobId);
      return {
        job_id: jobId,
        queue: input.queue,
        priority: input.priority ?? 10,
        status: 'pending' as const,
        payload: JSON.stringify(input.payload),
        depends_on: input.dependsOn ?? null,
        attempts: 0,
        max_attempts: input.maxAttempts ?? 3,
        error: null,
        result: null,
        created_at: now,
        started_at: null,
        completed_at: null,
        locked_by: null,
        locked_at: null,
        retry_after: null,    // Migration 50: exponential backoff
        last_error: null,     // Migration 50: error history
      };
    });

    if (values.length > 0) {
      await this.db
        .insertInto('jobs')
        .values(values)
        .execute();
    }

    return jobIds;
  }

  /**
   * Get the next available job from the specified queue
   * Uses atomic locking to prevent concurrent workers from claiming the same job
   */
  async getNext<T>(queue: string): Promise<Job<T> | null> {
    const now = new Date().toISOString();
    const staleThreshold = new Date(Date.now() - this.staleLockTimeoutMs).toISOString();

    // First, release any stale locks (jobs that have been processing too long)
    await this.db
      .updateTable('jobs')
      .set({
        status: 'pending',
        locked_by: null,
        locked_at: null,
      })
      .where('status', '=', 'processing')
      .where('locked_at', '<', staleThreshold)
      .execute();

    // Find the next available job that:
    // 1. Is in the specified queue
    // 2. Has status 'pending'
    // 3. Has no dependency OR dependency is completed
    // 4. Is not locked
    // 5. retry_after is null OR retry_after <= now (exponential backoff)
    const pendingJob = await this.db
      .selectFrom('jobs')
      .selectAll()
      .where('queue', '=', queue)
      .where('status', '=', 'pending')
      .where('locked_by', 'is', null)
      // Respect retry_after for exponential backoff
      .where(eb => eb.or([
        eb('retry_after', 'is', null),
        eb('retry_after', '<=', now),
      ]))
      .where(eb => eb.or([
        eb('depends_on', 'is', null),
        eb.exists(
          eb.selectFrom('jobs as parent')
            .select('parent.job_id')
            .whereRef('parent.job_id', '=', 'jobs.depends_on')
            .where('parent.status', '=', 'completed')
        ),
      ]))
      .orderBy('priority', 'desc')
      .orderBy('created_at', 'asc')
      .limit(1)
      .executeTakeFirst();

    if (!pendingJob) {
      return null;
    }

    // Atomically claim the job
    const result = await this.db
      .updateTable('jobs')
      .set({
        status: 'processing',
        locked_by: this.workerId,
        locked_at: now,
        started_at: now,
        attempts: pendingJob.attempts + 1,
      })
      .where('job_id', '=', pendingJob.job_id)
      .where('status', '=', 'pending')
      .where('locked_by', 'is', null)
      .executeTakeFirst();

    // If no rows were updated, another worker claimed it
    if (!result.numUpdatedRows || result.numUpdatedRows === BigInt(0)) {
      return null;
    }

    return this.mapRowToJob<T>(pendingJob);
  }

  /**
   * Get multiple available jobs from the queue (batch fetch)
   * Uses atomic locking to prevent concurrent workers from claiming the same jobs.
   * This is the key to aggressive parallelism - fill ALL worker slots in one poll.
   *
   * @param queue - Queue name to fetch from
   * @param limit - Maximum number of jobs to fetch
   * @returns Array of claimed jobs
   */
  async getNextBatch<T>(queue: string, limit: number): Promise<Job<T>[]> {
    if (limit <= 0) return [];

    const now = new Date().toISOString();
    const staleThreshold = new Date(Date.now() - this.staleLockTimeoutMs).toISOString();

    // First, release any stale locks (jobs that have been processing too long)
    await this.db
      .updateTable('jobs')
      .set({
        status: 'pending',
        locked_by: null,
        locked_at: null,
      })
      .where('status', '=', 'processing')
      .where('locked_at', '<', staleThreshold)
      .execute();

    // Find next available jobs that:
    // 1. Are in the specified queue
    // 2. Have status 'pending'
    // 3. Have no dependency OR dependency is completed
    // 4. Are not locked
    // 5. retry_after is null OR retry_after <= now
    const pendingJobs = await this.db
      .selectFrom('jobs')
      .selectAll()
      .where('queue', '=', queue)
      .where('status', '=', 'pending')
      .where('locked_by', 'is', null)
      .where(eb => eb.or([
        eb('retry_after', 'is', null),
        eb('retry_after', '<=', now),
      ]))
      .where(eb => eb.or([
        eb('depends_on', 'is', null),
        eb.exists(
          eb.selectFrom('jobs as parent')
            .select('parent.job_id')
            .whereRef('parent.job_id', '=', 'jobs.depends_on')
            .where('parent.status', '=', 'completed')
        ),
      ]))
      .orderBy('priority', 'desc')
      .orderBy('created_at', 'asc')
      .limit(limit)
      .execute();

    if (pendingJobs.length === 0) return [];

    // Atomically claim all jobs in a transaction
    const claimedJobs: Job<T>[] = [];

    await this.db.transaction().execute(async (trx) => {
      for (const job of pendingJobs) {
        const result = await trx
          .updateTable('jobs')
          .set({
            status: 'processing',
            locked_by: this.workerId,
            locked_at: now,
            started_at: now,
            attempts: job.attempts + 1,
          })
          .where('job_id', '=', job.job_id)
          .where('status', '=', 'pending')
          .where('locked_by', 'is', null)
          .executeTakeFirst();

        // Only add if we actually claimed it (no race condition)
        if (result.numUpdatedRows && result.numUpdatedRows > BigInt(0)) {
          claimedJobs.push(this.mapRowToJob<T>(job));
        }
      }
    });

    if (claimedJobs.length > 0) {
      logger.debug('JobQueue', `Claimed ${claimedJobs.length}/${pendingJobs.length} jobs from ${queue}`);
    }

    return claimedJobs;
  }

  /**
   * Mark a job as completed with optional result
   */
  async complete(jobId: string, result?: unknown, queue?: string): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .updateTable('jobs')
      .set({
        status: 'completed',
        result: result ? JSON.stringify(result) : null,
        completed_at: now,
        locked_by: null,
        locked_at: null,
      })
      .where('job_id', '=', jobId)
      .execute();

    // Record metric
    metrics.incrementCounter(MetricNames.JOBS_COMPLETED, 1, { queue: queue ?? 'unknown' });
  }

  /**
   * Mark a job as failed
   * If max attempts reached, move to dead letter queue
   * @returns Info about the failure, including whether it moved to DLQ
   */
  async fail(jobId: string, error: string): Promise<{
    movedToDeadLetter: boolean;
    jobId: string;
    queue: string;
    error: string;
    attempts: number;
    payload?: unknown;
  }> {
    const now = new Date().toISOString();

    // Get current job state
    const job = await this.db
      .selectFrom('jobs')
      .selectAll()
      .where('job_id', '=', jobId)
      .executeTakeFirst();

    if (!job) {
      return {
        movedToDeadLetter: false,
        jobId,
        queue: 'unknown',
        error,
        attempts: 0,
      };
    }

    const isMaxAttempts = job.attempts >= job.max_attempts;

    // Record failure metric
    metrics.incrementCounter(MetricNames.JOBS_FAILED, 1, { queue: job.queue });

    if (isMaxAttempts) {
      // Move to dead letter queue
      await this.db.transaction().execute(async (trx) => {
        // Insert into dead letter queue
        await trx
          .insertInto('job_dead_letter')
          .values({
            job_id: job.job_id,
            queue: job.queue,
            payload: job.payload,
            error: error,
            attempts: job.attempts,
            failed_at: now,
            acknowledged: 0,
          })
          .execute();

        // Update job status to dead
        await trx
          .updateTable('jobs')
          .set({
            status: 'dead',
            error: error,
            completed_at: now,
            locked_by: null,
            locked_at: null,
          })
          .where('job_id', '=', jobId)
          .execute();
      });

      // Record dead letter metric
      metrics.incrementCounter(MetricNames.JOBS_DEAD, 1, { queue: job.queue });
      logger.warn('JobQueue', 'Job moved to dead letter queue', { jobId, queue: job.queue, attempts: job.attempts, error });

      // Return DLQ info for event emission
      return {
        movedToDeadLetter: true,
        jobId: job.job_id,
        queue: job.queue,
        error,
        attempts: job.attempts,
        payload: JSON.parse(job.payload),
      };
    } else {
      // Schedule for retry with exponential backoff
      // Delay formula: baseDelay * 2^attempts = 1s, 2s, 4s, 8s, 16s, 32s, max 60s
      const baseDelayMs = 1000;
      const maxDelayMs = 60000;
      const delayMs = Math.min(baseDelayMs * Math.pow(2, job.attempts), maxDelayMs);
      const retryAfter = new Date(Date.now() + delayMs).toISOString();

      logger.info('JobQueue', 'Job scheduled for retry', {
        jobId,
        queue: job.queue,
        attempt: job.attempts,
        maxAttempts: job.max_attempts,
        delayMs,
        error
      });

      await this.db
        .updateTable('jobs')
        .set({
          status: 'pending',
          error: null,           // Clear error field (use last_error for history)
          last_error: error,     // Store error in last_error for debugging
          retry_after: retryAfter,
          locked_by: null,
          locked_at: null,
        })
        .where('job_id', '=', jobId)
        .execute();

      // Record retry metric
      metrics.incrementCounter(MetricNames.JOBS_RETRIED, 1, { queue: job.queue });

      return {
        movedToDeadLetter: false,
        jobId: job.job_id,
        queue: job.queue,
        error,
        attempts: job.attempts,
      };
    }
  }

  /**
   * Calculate exponential backoff delay for a given attempt number
   * @param attempts - Number of attempts so far
   * @returns Delay in milliseconds (1s, 2s, 4s, 8s, 16s, 32s, max 60s)
   */
  calculateRetryDelay(attempts: number): number {
    const baseDelayMs = 1000;
    const maxDelayMs = 60000;
    return Math.min(baseDelayMs * Math.pow(2, attempts), maxDelayMs);
  }

  /**
   * Get job by ID
   */
  async getJob<T>(jobId: string): Promise<Job<T> | null> {
    const row = await this.db
      .selectFrom('jobs')
      .selectAll()
      .where('job_id', '=', jobId)
      .executeTakeFirst();

    return row ? this.mapRowToJob<T>(row) : null;
  }

  /**
   * Get queue statistics
   */
  async getStats(queue?: string): Promise<JobQueueStats> {
    let query = this.db
      .selectFrom('jobs')
      .select([
        eb => eb.fn.count<number>('job_id').as('total'),
        eb => eb.fn.count<number>(
          eb.case()
            .when('status', '=', 'pending')
            .then(1)
            .end()
        ).as('pending'),
        eb => eb.fn.count<number>(
          eb.case()
            .when('status', '=', 'processing')
            .then(1)
            .end()
        ).as('processing'),
        eb => eb.fn.count<number>(
          eb.case()
            .when('status', '=', 'completed')
            .then(1)
            .end()
        ).as('completed'),
        eb => eb.fn.count<number>(
          eb.case()
            .when('status', '=', 'failed')
            .then(1)
            .end()
        ).as('failed'),
        eb => eb.fn.count<number>(
          eb.case()
            .when('status', '=', 'dead')
            .then(1)
            .end()
        ).as('dead'),
      ]);

    if (queue) {
      query = query.where('queue', '=', queue);
    }

    const result = await query.executeTakeFirst();

    return {
      pending: Number(result?.pending ?? 0),
      processing: Number(result?.processing ?? 0),
      completed: Number(result?.completed ?? 0),
      failed: Number(result?.failed ?? 0),
      dead: Number(result?.dead ?? 0),
      total: Number(result?.total ?? 0),
    };
  }

  /**
   * Get dead letter queue entries
   */
  async getDeadLetterQueue(queue?: string, limit = 100): Promise<{
    id: number;
    jobId: string;
    queue: string;
    payload: unknown;
    error: string | null;
    attempts: number;
    failedAt: string;  // ISO string for IPC serialization
    acknowledged: boolean;
  }[]> {
    let query = this.db
      .selectFrom('job_dead_letter')
      .selectAll()
      .orderBy('failed_at', 'desc')
      .limit(limit);

    if (queue) {
      query = query.where('queue', '=', queue);
    }

    const rows = await query.execute();

    return rows.map(row => ({
      id: row.id,
      jobId: row.job_id,
      queue: row.queue,
      payload: JSON.parse(row.payload),
      error: row.error,
      attempts: row.attempts,
      failedAt: row.failed_at,  // Already ISO string from DB
      acknowledged: row.acknowledged === 1,
    }));
  }

  /**
   * Acknowledge (dismiss) dead letter queue entries
   */
  async acknowledgeDeadLetter(ids: number[]): Promise<void> {
    if (ids.length === 0) return;

    await this.db
      .updateTable('job_dead_letter')
      .set({ acknowledged: 1 })
      .where('id', 'in', ids)
      .execute();
  }

  /**
   * Retry a dead letter job
   * Creates a new job with the same payload
   */
  async retryDeadLetter(id: number): Promise<string | null> {
    const entry = await this.db
      .selectFrom('job_dead_letter')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!entry) {
      return null;
    }

    // Create a new job with the same payload
    const jobId = await this.addJob({
      queue: entry.queue,
      payload: JSON.parse(entry.payload),
    });

    // Acknowledge the dead letter entry
    await this.acknowledgeDeadLetter([id]);

    return jobId;
  }

  /**
   * Clear completed jobs older than specified age
   */
  async clearCompleted(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const threshold = new Date(Date.now() - olderThanMs).toISOString();

    const result = await this.db
      .deleteFrom('jobs')
      .where('status', '=', 'completed')
      .where('completed_at', '<', threshold)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  }

  /**
   * Map database row to Job object
   */
  private mapRowToJob<T>(row: JobsTable): Job<T> {
    return {
      jobId: row.job_id,
      queue: row.queue,
      priority: row.priority,
      status: row.status,
      payload: JSON.parse(row.payload) as T,
      dependsOn: row.depends_on,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      error: row.error,
      result: row.result ? JSON.parse(row.result) : null,
      createdAt: row.created_at,  // Already ISO string from DB
      startedAt: row.started_at ?? null,  // Already ISO string from DB
      completedAt: row.completed_at ?? null,  // Already ISO string from DB
    };
  }
}

/**
 * Queue names for import system
 *
 * Per-file jobs: Run for each imported file
 * - EXIFTOOL, FFPROBE, THUMBNAIL, VIDEO_PROXY
 *
 * Per-location jobs: Run once per location after all files processed
 * - GPS_ENRICHMENT, LIVE_PHOTO, SRT_TELEMETRY, LOCATION_STATS, BAGIT
 */
export const IMPORT_QUEUES = {
  // Per-file jobs
  EXIFTOOL: 'exiftool',
  FFPROBE: 'ffprobe',
  THUMBNAIL: 'thumbnail',
  VIDEO_PROXY: 'video-proxy',

  // Per-location jobs (run after all file jobs complete)
  GPS_ENRICHMENT: 'gps-enrichment',
  LIVE_PHOTO: 'live-photo',
  SRT_TELEMETRY: 'srt-telemetry',
  LOCATION_STATS: 'location-stats',
  BAGIT: 'bagit',

  // OPT-113: Web source archiving (lower priority, runs in background)
  WEBSOURCE_ARCHIVE: 'websource-archive',

  // Migration 73: Date extraction from web sources
  DATE_EXTRACTION: 'date-extraction',

  // Migration 76: RAM++ Image Auto-Tagging (lowest priority, background only)
  IMAGE_TAGGING: 'image-tagging',
  LOCATION_TAG_AGGREGATION: 'location-tag-aggregation',
} as const;

/**
 * Job priorities (higher = more important)
 */
export const JOB_PRIORITY = {
  CRITICAL: 100,
  HIGH: 50,
  NORMAL: 10,
  LOW: 1,
  BACKGROUND: 0,
} as const;
