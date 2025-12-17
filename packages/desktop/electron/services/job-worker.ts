/**
 * Job Worker Service
 *
 * Background job processor with smart concurrency:
 * - Light tasks (blake3, thumbnail): Run in parallel (up to 4 concurrent)
 * - Medium tasks (proxy): Run semi-parallel (up to 2 concurrent)
 * - Heavy ML tasks (screenshot_extract): Run sequential (1 at a time)
 */

import { EventEmitter } from 'events';
import { jobsRepository } from '../repositories/jobs-repository';
import type { Job, JobStatus, JobProgress, JobType } from '@nightfox/core';

// Concurrency configuration per job type
const CONCURRENCY_CONFIG: Record<JobType, number> = {
  blake3: 4, // Fast hash computation, can run many in parallel
  thumbnail: 4, // Quick ffmpeg frame extract
  proxy: 2, // Moderate ffmpeg transcode
  screenshot_extract: 1, // Heavy ML processing, sequential only
  thumbnail_update: 4, // Just database + file copy
  ai_caption: 2, // API calls, moderate parallel
};

// Priority order (higher = more important)
const PRIORITY_CONFIG: Record<JobType, number> = {
  blake3: 100, // Validation first
  thumbnail: 90, // UI needs thumbnails
  proxy: 50, // Background generation
  screenshot_extract: 40, // Can wait
  thumbnail_update: 80, // Quick update
  ai_caption: 30, // Optional enhancement
};

export type JobHandler = (
  job: Job,
  onProgress: (percent: number, message?: string) => void
) => Promise<void>;

export interface JobWorkerOptions {
  pollIntervalMs?: number;
  maxRetries?: number;
  handlers?: Partial<Record<JobType, JobHandler>>;
}

export class JobWorker extends EventEmitter {
  private isRunning = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private activeJobs: Map<number, { job: Job; startTime: number }> = new Map();
  private handlers: Map<JobType, JobHandler> = new Map();
  private pollIntervalMs: number;
  private processingPromises: Map<number, Promise<void>> = new Map();

  constructor(options: JobWorkerOptions = {}) {
    super();
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;

    // Register any provided handlers
    if (options.handlers) {
      for (const [type, handler] of Object.entries(options.handlers)) {
        if (handler) {
          this.handlers.set(type as JobType, handler);
        }
      }
    }
  }

  /**
   * Register a handler for a job type
   */
  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
    console.log(`[JobWorker] Registered handler for: ${type}`);
  }

  /**
   * Start the job worker
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.emit('started');
    console.log('[JobWorker] Started');

    // Immediate first poll
    this.poll();

    // Set up polling interval
    this.pollTimer = setInterval(() => {
      this.poll();
    }, this.pollIntervalMs);
  }

  /**
   * Stop the job worker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for active jobs to complete
    if (this.processingPromises.size > 0) {
      console.log(`[JobWorker] Waiting for ${this.processingPromises.size} active jobs to complete...`);
      await Promise.all(this.processingPromises.values());
    }

    this.emit('stopped');
    console.log('[JobWorker] Stopped');
  }

  /**
   * Poll for and process available jobs
   */
  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Get pending jobs
      const pendingJobs = jobsRepository.findPending(10);
      if (pendingJobs.length === 0) return;

      console.log(`[JobWorker] Found ${pendingJobs.length} pending jobs, handlers: ${Array.from(this.handlers.keys()).join(', ')}`);


      // Group jobs by type to check concurrency
      const jobsByType = new Map<JobType, Job[]>();
      for (const job of pendingJobs) {
        const type = job.job_type as JobType;
        if (!jobsByType.has(type)) {
          jobsByType.set(type, []);
        }
        jobsByType.get(type)!.push(job);
      }

      // Process jobs respecting concurrency limits
      for (const [type, jobs] of jobsByType) {
        const maxConcurrency = CONCURRENCY_CONFIG[type] ?? 1;
        const currentActive = this.countActiveByType(type);
        const available = maxConcurrency - currentActive;

        if (available <= 0) continue;

        // Sort by priority within type
        const sortedJobs = jobs.slice(0, available).sort((a, b) => b.priority - a.priority);

        for (const job of sortedJobs) {
          // Don't process if we've exceeded concurrency during this loop
          if (this.countActiveByType(type) >= maxConcurrency) break;

          // Try to claim and process the job
          this.processJob(job);
        }
      }
    } catch (error) {
      console.error('[JobWorker] Poll error:', error);
      this.emit('error', error);
    }
  }

  /**
   * Count active jobs of a specific type
   */
  private countActiveByType(type: JobType): number {
    let count = 0;
    for (const { job } of this.activeJobs.values()) {
      if (job.job_type === type) count++;
    }
    return count;
  }

  /**
   * Process a single job
   */
  private processJob(job: Job): void {
    const type = job.job_type as JobType;
    const handler = this.handlers.get(type);

    if (!handler) {
      console.warn(`[JobWorker] No handler registered for job type: ${type}`);
      jobsRepository.fail(job.id, `No handler for job type: ${type}`);
      return;
    }

    // Claim the job atomically
    const claimed = jobsRepository.claim(job.id);
    if (!claimed) {
      // Job was claimed by another worker or already processed
      return;
    }

    const startTime = Date.now();
    this.activeJobs.set(job.id, { job: claimed, startTime });

    // Emit progress start
    this.emitProgress(claimed, 0, 'processing', 'Starting...');

    // Create progress callback
    const onProgress = (percent: number, message?: string) => {
      this.emitProgress(claimed, percent, 'processing', message);
    };

    // Execute handler
    const promise = handler(claimed, onProgress)
      .then(() => {
        const processingTimeMs = Date.now() - startTime;
        jobsRepository.complete(job.id, processingTimeMs);
        this.emitProgress(claimed, 100, 'complete', 'Done');
        console.log(`[JobWorker] Completed job ${job.id} (${type}) in ${processingTimeMs}ms`);
      })
      .catch((error: Error) => {
        const errorMessage = error.message || String(error);
        jobsRepository.fail(job.id, errorMessage);
        this.emitProgress(claimed, 0, 'error', errorMessage);
        console.error(`[JobWorker] Failed job ${job.id} (${type}):`, errorMessage);
      })
      .finally(() => {
        this.activeJobs.delete(job.id);
        this.processingPromises.delete(job.id);
      });

    this.processingPromises.set(job.id, promise);
  }

  /**
   * Emit job progress event
   */
  private emitProgress(job: Job, percent: number, status: JobStatus, message?: string): void {
    const progress: JobProgress = {
      job_id: job.id,
      job_type: job.job_type,
      progress_percent: percent,
      status,
      message,
    };
    this.emit('progress', progress);
  }

  /**
   * Get current stats
   */
  getStats(): {
    isRunning: boolean;
    activeJobs: number;
    activeByType: Record<string, number>;
    queueStats: ReturnType<typeof jobsRepository.getStats>;
  } {
    const activeByType: Record<string, number> = {};
    for (const { job } of this.activeJobs.values()) {
      activeByType[job.job_type] = (activeByType[job.job_type] || 0) + 1;
    }

    return {
      isRunning: this.isRunning,
      activeJobs: this.activeJobs.size,
      activeByType,
      queueStats: jobsRepository.getStats(),
    };
  }

  /**
   * Create a job with appropriate priority
   */
  static createJob(
    type: JobType,
    payload: Record<string, unknown>,
    options?: {
      file_id?: number | null;
      couple_id?: number | null;
      depends_on_job_id?: number | null;
      priority?: number;
    }
  ): Job {
    return jobsRepository.create({
      job_type: type,
      payload_json: JSON.stringify(payload),
      file_id: options?.file_id ?? null,
      couple_id: options?.couple_id ?? null,
      depends_on_job_id: options?.depends_on_job_id ?? null,
      priority: options?.priority ?? PRIORITY_CONFIG[type] ?? 0,
    });
  }

  /**
   * Queue multiple jobs for a file import (in dependency order)
   */
  static queueImportJobs(
    fileId: number,
    coupleId: number | null,
    filePath: string,
    options?: {
      skipBlake3?: boolean;
      skipThumbnail?: boolean;
      skipProxy?: boolean;
      skipScreenshots?: boolean;
    }
  ): Job[] {
    const jobs: Job[] = [];
    let lastJobId: number | undefined;

    // 1. Blake3 validation (always first, unless skipped)
    if (!options?.skipBlake3) {
      const blake3Job = this.createJob(
        'blake3',
        { file_path: filePath },
        { file_id: fileId, couple_id: coupleId }
      );
      jobs.push(blake3Job);
      lastJobId = blake3Job.id;
    }

    // 2. Thumbnail (depends on blake3 if it ran)
    if (!options?.skipThumbnail) {
      const thumbnailJob = this.createJob(
        'thumbnail',
        { file_path: filePath },
        {
          file_id: fileId,
          couple_id: coupleId,
          depends_on_job_id: lastJobId,
        }
      );
      jobs.push(thumbnailJob);
      // Don't update lastJobId - proxy/screenshots can run in parallel with thumbnail
    }

    // 3. Proxy generation (depends on blake3 if it ran)
    if (!options?.skipProxy) {
      const proxyJob = this.createJob(
        'proxy',
        { file_path: filePath },
        {
          file_id: fileId,
          couple_id: coupleId,
          depends_on_job_id: lastJobId,
        }
      );
      jobs.push(proxyJob);
    }

    // 4. Screenshot extraction (depends on blake3 if it ran)
    if (!options?.skipScreenshots) {
      const screenshotJob = this.createJob(
        'screenshot_extract',
        { file_path: filePath },
        {
          file_id: fileId,
          couple_id: coupleId,
          depends_on_job_id: lastJobId,
        }
      );
      jobs.push(screenshotJob);
    }

    return jobs;
  }
}

// Singleton instance
let workerInstance: JobWorker | null = null;

export function getJobWorker(): JobWorker {
  if (!workerInstance) {
    workerInstance = new JobWorker();
  }
  return workerInstance;
}

export function startJobWorker(): void {
  getJobWorker().start();
}

export function stopJobWorker(): Promise<void> {
  return getJobWorker().stop();
}
