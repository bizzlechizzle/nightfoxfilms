/**
 * WorkerPool - Thread pool management for parallel hashing
 *
 * Per Import Spec v2.0:
 * - Configurable concurrency (default: CPU cores - 1)
 * - Task distribution (round-robin)
 * - Graceful shutdown
 * - Worker restart on crash
 * - Built-in p-queue for concurrency control
 *
 * @module services/worker-pool
 */

import { Worker } from 'worker_threads';
import { generateId } from '../main/ipc-validation';
import path from 'path';
import { fileURLToPath } from 'url';
import PQueue from 'p-queue';
import { getHardwareProfile } from './hardware-profile';

// Get the directory of this module for worker path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task result from worker
 */
export interface HashResult {
  filePath: string;
  hash?: string;
  error?: string;
}

/**
 * Internal pending task tracker
 */
interface PendingTask {
  id: string;
  filePath: string;
  resolve: (result: HashResult) => void;
  reject: (error: Error) => void;
}

/**
 * Worker state
 */
interface WorkerState {
  worker: Worker;
  id: string;
  isReady: boolean;
  hasNativeB3sum: boolean;
  taskCount: number;
}

/**
 * Pool configuration options
 */
export interface WorkerPoolOptions {
  /**
   * Number of worker threads (default: CPU cores - 1, minimum 1)
   */
  concurrency?: number;

  /**
   * Timeout for hash operations in ms (default: 60000 = 60s)
   */
  taskTimeout?: number;

  /**
   * Whether to restart workers that crash (default: true)
   */
  restartOnCrash?: boolean;
}

/**
 * Worker pool for parallel file hashing
 */
export class WorkerPool {
  private workers: WorkerState[] = [];
  private pendingTasks: Map<string, PendingTask> = new Map();
  private roundRobinIndex = 0;
  private isShuttingDown = false;
  private readonly queue: PQueue;
  private readonly concurrency: number;
  private readonly taskTimeout: number;
  private readonly restartOnCrash: boolean;
  private readonly workerPath: string;

  constructor(options?: WorkerPoolOptions) {
    // v2.1: Use hardware profile for concurrency
    const hw = getHardwareProfile();
    this.concurrency = options?.concurrency ?? hw.hashWorkers;
    this.taskTimeout = options?.taskTimeout ?? 60000;
    this.restartOnCrash = options?.restartOnCrash ?? true;

    // Initialize p-queue for concurrency control
    this.queue = new PQueue({ concurrency: this.concurrency });

    // Resolve worker path relative to this module
    // In production: dist-electron/main/*.js (bundled)
    // Worker: dist-electron/workers/hash.worker.cjs
    // NOTE: .cjs extension required because package.json has "type": "module"
    this.workerPath = path.join(__dirname, '..', 'workers', 'hash.worker.cjs');

    // Lifecycle logging only - per-hash logging removed in OPT-108
  }

  /**
   * Start the worker pool
   * Creates worker threads and waits for them to be ready
   */
  async start(): Promise<void> {
    const startPromises: Promise<void>[] = [];

    for (let i = 0; i < this.concurrency; i++) {
      startPromises.push(this.createWorker());
    }

    await Promise.all(startPromises);
  }

  /**
   * Create a single worker
   */
  private async createWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      const workerId = `hash-worker-${generateId().slice(0, 8)}`;

      try {
        const worker = new Worker(this.workerPath, {
          workerData: { workerId },
        });

        const state: WorkerState = {
          worker,
          id: workerId,
          isReady: false,
          hasNativeB3sum: false,
          taskCount: 0,
        };

        // Handle worker ready message
        const onReady = (message: { type: string; hasNativeB3sum?: boolean }) => {
          if (message.type === 'ready') {
            state.isReady = true;
            state.hasNativeB3sum = message.hasNativeB3sum ?? false;
            this.workers.push(state);
            resolve();
          }
        };

        // Handle hash results
        const onMessage = (message: { type: string; id: string; hash?: string; error?: string }) => {
          if (message.type === 'ready') {
            onReady(message);
            return;
          }

          if (message.type === 'hash') {
            const pending = this.pendingTasks.get(message.id);
            if (pending) {
              this.pendingTasks.delete(message.id);
              state.taskCount--;

              if (message.error) {
                pending.resolve({
                  filePath: pending.filePath,
                  error: message.error,
                });
              } else {
                pending.resolve({
                  filePath: pending.filePath,
                  hash: message.hash,
                });
              }
            }
          }
        };

        worker.on('message', onMessage);

        worker.on('error', (error) => {
          console.error(`[WorkerPool] Worker ${workerId} error:`, error);

          // Fail all pending tasks for this worker
          for (const [id, pending] of this.pendingTasks.entries()) {
            pending.resolve({
              filePath: pending.filePath,
              error: `Worker error: ${error.message}`,
            });
            this.pendingTasks.delete(id);
          }

          if (!state.isReady) {
            reject(error);
          } else if (this.restartOnCrash && !this.isShuttingDown) {
            // Remove crashed worker and restart
            const index = this.workers.indexOf(state);
            if (index > -1) {
              this.workers.splice(index, 1);
            }
            this.createWorker().catch(console.error);
          }
        });

        worker.on('exit', (code) => {
          // Remove from workers list
          const index = this.workers.indexOf(state);
          if (index > -1) {
            this.workers.splice(index, 1);
          }

          // Restart if not shutting down and exit was unexpected
          if (code !== 0 && this.restartOnCrash && !this.isShuttingDown) {
            this.createWorker().catch(console.error);
          }
        });

        // Timeout for worker initialization
        setTimeout(() => {
          if (!state.isReady) {
            worker.terminate();
            reject(new Error(`Worker ${workerId} failed to initialize within timeout`));
          }
        }, 10000);

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Hash a single file
   */
  async hash(filePath: string): Promise<HashResult> {
    if (this.isShuttingDown) {
      return { filePath, error: 'Worker pool is shutting down' };
    }

    if (this.workers.length === 0) {
      return { filePath, error: 'No workers available' };
    }

    const result = await this.queue.add(async () => {
      return new Promise<HashResult>((resolve) => {
        const taskId = generateId();

        // Select worker using round-robin
        const worker = this.workers[this.roundRobinIndex % this.workers.length];
        this.roundRobinIndex++;

        // Track pending task
        const pending: PendingTask = {
          id: taskId,
          filePath,
          resolve,
          reject: (error) => resolve({ filePath, error: error.message }),
        };
        this.pendingTasks.set(taskId, pending);
        worker.taskCount++;

        // Set timeout
        const timeout = setTimeout(() => {
          if (this.pendingTasks.has(taskId)) {
            this.pendingTasks.delete(taskId);
            worker.taskCount--;
            resolve({ filePath, error: 'Hash operation timed out' });
          }
        }, this.taskTimeout);

        // Override resolve to clear timeout
        const originalResolve = pending.resolve;
        pending.resolve = (result) => {
          clearTimeout(timeout);
          originalResolve(result);
        };

        // Send task to worker
        worker.worker.postMessage({
          type: 'hash',
          id: taskId,
          filePath,
        });
      });
    });

    // Handle case where queue returns undefined (e.g., if aborted)
    return result ?? { filePath, error: 'Queue operation cancelled' };
  }

  /**
   * Hash multiple files in parallel
   * Returns results in same order as input
   */
  async hashBatch(filePaths: string[]): Promise<HashResult[]> {
    const promises = filePaths.map(filePath => this.hash(filePath));
    return Promise.all(promises);
  }

  /**
   * Hash multiple files with progress callback
   */
  async hashBatchWithProgress(
    filePaths: string[],
    onProgress: (completed: number, total: number) => void
  ): Promise<HashResult[]> {
    const total = filePaths.length;
    let completed = 0;
    const results: HashResult[] = new Array(total);

    const promises = filePaths.map(async (filePath, index) => {
      const result = await this.hash(filePath);
      results[index] = result;
      completed++;
      onProgress(completed, total);
      return result;
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    workers: number;
    pendingTasks: number;
    queueSize: number;
    queuePending: number;
  } {
    return {
      workers: this.workers.length,
      pendingTasks: this.pendingTasks.size,
      queueSize: this.queue.size,
      queuePending: this.queue.pending,
    };
  }

  /**
   * Check if pool has native b3sum support
   */
  hasNativeB3sum(): boolean {
    return this.workers.some(w => w.hasNativeB3sum);
  }

  /**
   * Gracefully shutdown the pool
   * Waits for pending tasks to complete
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Wait for queue to drain
    await this.queue.onIdle();

    // Terminate all workers
    const terminatePromises = this.workers.map(state => {
      return new Promise<void>((resolve) => {
        state.worker.once('exit', () => resolve());
        state.worker.terminate();
      });
    });

    await Promise.all(terminatePromises);

    this.workers = [];
    this.pendingTasks.clear();
  }
}

// Singleton instance for application-wide use
let poolInstance: WorkerPool | null = null;

/**
 * Get the singleton WorkerPool instance
 * Creates and starts the pool on first call
 */
export async function getWorkerPool(options?: WorkerPoolOptions): Promise<WorkerPool> {
  if (!poolInstance) {
    poolInstance = new WorkerPool(options);
    await poolInstance.start();
  }
  return poolInstance;
}

/**
 * Shutdown the singleton WorkerPool instance
 */
export async function shutdownWorkerPool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.shutdown();
    poolInstance = null;
  }
}
