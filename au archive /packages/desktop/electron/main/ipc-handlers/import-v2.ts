/**
 * Import System v2.0 IPC Handlers
 *
 * Per Import Spec v2.0:
 * - import:v2:start - Start new import with 5-step pipeline
 * - import:v2:cancel - Cancel running import
 * - import:v2:status - Get current import status
 * - import:v2:resume - Resume incomplete import
 * - jobs:status - Get background job queue status
 * - jobs:retry - Retry failed job from dead letter queue
 *
 * @module main/ipc-handlers/import-v2
 */

import { ipcMain, BrowserWindow } from 'electron';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';
import {
  createImportOrchestrator,
  type ImportOrchestrator,
  type ImportProgress,
  type ImportResult,
} from '../../services/import';
import { getJobWorkerService, startJobWorker, stopJobWorker } from '../../services/job-worker-service';
import { JobQueue, IMPORT_QUEUES } from '../../services/job-queue';
import { getCurrentUser } from '../../services/user-service';

// Singleton orchestrator instance
let orchestrator: ImportOrchestrator | null = null;

// Track active import abort controllers
const activeImports = new Map<string, AbortController>();

/**
 * Get the main browser window for sending events
 */
function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
}

/**
 * Send event to renderer
 */
function sendToRenderer(channel: string, data: unknown): void {
  const window = getMainWindow();
  if (window && !window.isDestroyed()) {
    const serialized = safeSerialize(data);
    window.webContents.send(channel, serialized);
  }
}

/**
 * OPT-080: NUCLEAR OPTION - Force JSON serialization to prevent structured clone errors
 * This ensures only plain objects/arrays/primitives cross the IPC boundary.
 * If this fails, it will show EXACTLY which field can't be serialized.
 */
function safeSerialize<T>(data: T): T {
  try {
    return JSON.parse(JSON.stringify(data));
  } catch (error) {
    console.error('[IPC] Serialization failed:', error);
    console.error('[IPC] Problematic data type:', typeof data);
    console.error('[IPC] Data constructor:', data?.constructor?.name);

    // Try to find the problematic field
    if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        try {
          JSON.stringify(value);
        } catch {
          console.error(`[IPC] Non-serializable field: "${key}" (type: ${typeof value}, constructor: ${value?.constructor?.name})`);
        }
      }
    }

    throw error;
  }
}

/**
 * Register Import v2.0 IPC handlers
 */
export function registerImportV2Handlers(db: Kysely<Database>): void {
  // ADR-046: Validation schemas - removed loc12/slocnam (not needed for folder paths)
  // BLAKE3 16-char hex ID validator
  const Blake3IdSchema = z.string().length(16).regex(/^[a-f0-9]+$/, 'Must be 16-char lowercase hex');

  const ImportStartSchema = z.object({
    paths: z.array(z.string()),
    locid: Blake3IdSchema,
    address_state: z.string().nullable(),
    // Extended fields for full UI integration
    subid: Blake3IdSchema.nullable().optional(),
    auth_imp: z.string().nullable().optional(),
    is_contributed: z.number().optional().default(0),
    contribution_source: z.string().nullable().optional(),
  });

  const JobRetrySchema = z.object({
    deadLetterId: z.number(),
  });

  /**
   * Start a new import using v2 pipeline
   */
  ipcMain.handle('import:v2:start', async (_event, input: unknown) => {
    try {
      const validated = ImportStartSchema.parse(input);

      // Get archive path from settings
      const archiveSetting = await db
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'archive_folder')
        .executeTakeFirst();

      if (!archiveSetting?.value) {
        throw new Error('Archive folder not configured. Please set it in Settings.');
      }

      const archivePath = archiveSetting.value;

      // Get current user for activity tracking
      const currentUser = await getCurrentUser(db);

      // Create orchestrator if not exists
      if (!orchestrator) {
        orchestrator = createImportOrchestrator(db, archivePath);
      }

      // Create abort controller
      const abortController = new AbortController();

      // Progress callback sends events to renderer
      const onProgress = (progress: ImportProgress) => {
        sendToRenderer('import:v2:progress', progress);
        activeImports.set(progress.sessionId, abortController);
      };

      // Start import
      // ADR-046: Pass simplified location info (loc12/slocnam removed)
      // OPT-093: Pass subid for sub-location media assignment
      const result = await orchestrator.import(validated.paths, {
        location: {
          locid: validated.locid,
          address_state: validated.address_state,
          subid: validated.subid ?? null,
        },
        archivePath,
        user: currentUser ? {
          userId: currentUser.userId,
          username: currentUser.username,
        } : undefined,
        onProgress,
        signal: abortController.signal,
      });

      // Clean up
      activeImports.delete(result.sessionId);

      // Send completion event
      sendToRenderer('import:v2:complete', {
        sessionId: result.sessionId,
        status: result.status,
        totalImported: result.finalizationResult?.totalFinalized ?? 0,
        totalDuplicates: result.hashResult?.totalDuplicates ?? 0,
        totalErrors: result.finalizationResult?.totalErrors ?? 0,
        totalDurationMs: result.totalDurationMs,
        jobsQueued: result.finalizationResult?.jobsQueued ?? 0,
      });

      // OPT-080: Force serialization to prevent structured clone errors
      return safeSerialize(result);

    } catch (error) {
      console.error('[import:v2:start] Error:', error);
      // OPT-080: Serialize error to prevent structured clone failure in IPC
      // Complex error objects (Kysely, etc.) may have non-serializable properties
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Cancel running import
   */
  ipcMain.handle('import:v2:cancel', async (_event, sessionId: string) => {
    const abortController = activeImports.get(sessionId);
    if (abortController) {
      abortController.abort();
      activeImports.delete(sessionId);
      return { cancelled: true };
    }

    // Also try to cancel via orchestrator
    if (orchestrator) {
      orchestrator.cancel();
      return { cancelled: true };
    }

    return { cancelled: false, reason: 'No active import found' };
  });

  /**
   * Get current import status
   */
  ipcMain.handle('import:v2:status', async () => {
    if (!orchestrator) {
      return { sessionId: null, status: 'idle' };
    }
    return safeSerialize(orchestrator.getStatus());
  });

  /**
   * Get resumable import sessions
   */
  ipcMain.handle('import:v2:resumable', async () => {
    try {
      if (!orchestrator) {
        // Create temporary orchestrator to query DB
        const archiveSetting = await db
          .selectFrom('settings')
          .select('value')
          .where('key', '=', 'archive_folder')
          .executeTakeFirst();

        if (!archiveSetting?.value) {
          return [];
        }

        const tempOrchestrator = createImportOrchestrator(db, archiveSetting.value);
        return safeSerialize(await tempOrchestrator.getResumableSessions());
      }

      return safeSerialize(await orchestrator.getResumableSessions());
    } catch (error) {
      console.error('[import:v2:resumable] Error:', error);
      // OPT-080: Serialize error to prevent structured clone failure in IPC
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Resume an incomplete import
   */
  ipcMain.handle('import:v2:resume', async (_event, sessionId: string) => {
    try {
      if (!orchestrator) {
        throw new Error('Import system not initialized');
      }

      // Get session info to rebuild location
      const session = await db
        .selectFrom('import_sessions')
        .selectAll()
        .where('session_id', '=', sessionId)
        .executeTakeFirst();

      if (!session) {
        throw new Error('Session not found');
      }

      // ADR-046: Get location info (removed loc12/slocnam)
      const location = await db
        .selectFrom('locs')
        .select(['locid', 'address_state'])
        .where('locid', '=', session.locid)
        .executeTakeFirst();

      if (!location) {
        throw new Error('Location not found');
      }

      const archiveSetting = await db
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'archive_folder')
        .executeTakeFirst();

      if (!archiveSetting?.value) {
        throw new Error('Archive folder not configured');
      }

      const currentUser = await getCurrentUser(db);

      const abortController = new AbortController();
      const onProgress = (progress: ImportProgress) => {
        sendToRenderer('import:v2:progress', progress);
        activeImports.set(progress.sessionId, abortController);
      };

      // ADR-046: Simplified location (removed loc12/slocnam)
      // OPT-093: Resume currently doesn't restore subid context
      // TODO: Store subid in import_sessions table for proper resume support
      const result = await orchestrator.resume(sessionId, {
        location: {
          locid: location.locid,
          address_state: location.address_state,
          subid: null, // Resume doesn't have original subid - media goes to host
        },
        archivePath: archiveSetting.value,
        user: currentUser ? {
          userId: currentUser.userId,
          username: currentUser.username,
        } : undefined,
        onProgress,
        signal: abortController.signal,
      });

      // OPT-080: Force serialization to prevent structured clone errors
      return safeSerialize(result);
    } catch (error) {
      console.error('[import:v2:resume] Error:', error);
      // OPT-080: Serialize error to prevent structured clone failure in IPC
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get job queue statistics
   */
  ipcMain.handle('jobs:status', async () => {
    try {
      const workerService = getJobWorkerService(db);
      return safeSerialize(await workerService.getStats());
    } catch (error) {
      console.error('[jobs:status] Error:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get dead letter queue entries
   */
  ipcMain.handle('jobs:deadLetter', async (_event, queue?: string) => {
    try {
      const jobQueue = new JobQueue(db);
      return safeSerialize(await jobQueue.getDeadLetterQueue(queue));
    } catch (error) {
      console.error('[jobs:deadLetter] Error:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Retry a job from dead letter queue
   */
  ipcMain.handle('jobs:retry', async (_event, input: unknown) => {
    try {
      const validated = JobRetrySchema.parse(input);
      const jobQueue = new JobQueue(db);

      const newJobId = await jobQueue.retryDeadLetter(validated.deadLetterId);
      return { success: newJobId !== null, newJobId };
    } catch (error) {
      console.error('[jobs:retry] Error:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Acknowledge (dismiss) dead letter entries
   */
  ipcMain.handle('jobs:acknowledge', async (_event, ids: number[]) => {
    try {
      const jobQueue = new JobQueue(db);
      await jobQueue.acknowledgeDeadLetter(ids);
      return { acknowledged: ids.length };
    } catch (error) {
      console.error('[jobs:acknowledge] Error:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Clear old completed jobs
   */
  ipcMain.handle('jobs:clearCompleted', async (_event, olderThanMs?: number) => {
    try {
      const jobQueue = new JobQueue(db);
      const cleared = await jobQueue.clearCompleted(olderThanMs);
      return { cleared };
    } catch (error) {
      console.error('[jobs:clearCompleted] Error:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

}

/**
 * Start the job worker service
 */
export function initializeJobWorker(db: Kysely<Database>): void {
  const workerService = startJobWorker(db);

  // Forward worker events to renderer
  workerService.on('asset:thumbnail-ready', (data) => {
    sendToRenderer('asset:thumbnail-ready', data);
  });

  workerService.on('asset:metadata-complete', (data) => {
    sendToRenderer('asset:metadata-complete', data);
  });

  workerService.on('asset:proxy-ready', (data) => {
    sendToRenderer('asset:proxy-ready', data);
  });

  // Forward tagging events to renderer for UI refresh
  workerService.on('asset:tags-ready', (data) => {
    sendToRenderer('asset:tags-ready', data);
  });

  workerService.on('location:tags-aggregated', (data) => {
    sendToRenderer('location:tags-aggregated', data);
  });

  workerService.on('job:progress', (data) => {
    sendToRenderer('jobs:progress', data);
  });

  // Forward dead letter queue events to renderer for UI notification
  workerService.on('job:deadLetter', (data) => {
    sendToRenderer('jobs:deadLetter', data);
  });

  // OPT-092: Forward GPS enrichment events to renderer
  workerService.on('location:gps-enriched', (data) => {
    sendToRenderer('location:gps-enriched', data);
  });

}

/**
 * Shutdown job worker service
 */
export async function shutdownJobWorker(): Promise<void> {
  await stopJobWorker();
}
