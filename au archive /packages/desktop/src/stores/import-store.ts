/**
 * Global import state management
 * Tracks active and recent import jobs across the app
 * ADR-049: Uses unified 16-char hex IDs
 */
import { writable, derived } from 'svelte/store';

/**
 * ADR-049: Generate 16-char hex ID (client-side equivalent of server's generateId)
 */
function generateClientId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export interface ImportJob {
  id: string;
  locid: string;
  locationName: string;
  totalFiles: number;
  processedFiles: number;
  // OPT-088: Percent from orchestrator (weighted by step, not just file count)
  percent: number;
  // FIX 4.1: Track current filename being processed
  currentFilename?: string;
  // FIX 4.3: Track import ID for cancellation
  importId?: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  imported?: number;
  duplicates?: number;
  errors?: number;
}

interface ImportState {
  activeJob: ImportJob | null;
  recentJobs: ImportJob[];
}

function createImportStore() {
  const { subscribe, set, update } = writable<ImportState>({
    activeJob: null,
    recentJobs: [],
  });

  return {
    subscribe,

    /**
     * Start a new import job
     */
    startJob(locid: string, locationName: string, totalFiles: number): string {
      const job: ImportJob = {
        id: generateClientId(),
        locid,
        locationName,
        totalFiles,
        processedFiles: 0,
        percent: 0,  // OPT-088: Initialize at 0, will be updated by orchestrator
        status: 'running',
        startedAt: new Date(),
      };
      update(state => ({ ...state, activeJob: job }));
      return job.id;
    },

    /**
     * Set the importId for the active job (called immediately when import starts)
     * FIX: This ensures cancel works before any progress events arrive
     */
    setImportId(importId: string) {
      update(state => {
        if (state.activeJob) {
          return {
            ...state,
            activeJob: {
              ...state.activeJob,
              importId,
            },
          };
        }
        return state;
      });
    },

    /**
     * Update progress of active job
     * OPT-088: Now accepts percent from orchestrator (weighted by step)
     * FIX 4.1: Now includes filename being processed
     * FIX 4.3: Now includes importId for cancellation
     */
    updateProgress(current: number, total: number, percent: number, filename?: string, importId?: string) {
      update(state => {
        if (state.activeJob) {
          return {
            ...state,
            activeJob: {
              ...state.activeJob,
              processedFiles: current,
              totalFiles: total,
              percent,  // OPT-088: Use orchestrator's weighted percent
              currentFilename: filename,
              importId: importId || state.activeJob.importId,
            },
          };
        }
        return state;
      });
    },

    /**
     * FIX 4.3: Cancel active import
     * Returns true if cancel was successful, false if no importId available
     */
    async cancelImport(): Promise<boolean> {
      let importId: string | undefined;
      update(state => {
        importId = state.activeJob?.importId;
        if (state.activeJob) {
          return {
            ...state,
            activeJob: {
              ...state.activeJob,
              status: 'cancelled' as const,
            },
          };
        }
        return state;
      });

      if (!importId) {
        console.warn('[importStore] Cannot cancel: no importId available yet');
        return false;
      }

      if (window.electronAPI?.media?.cancelImport) {
        try {
          await window.electronAPI.media.cancelImport(importId);
          return true;
        } catch (e) {
          console.error('Failed to cancel import:', e);
          return false;
        }
      }
      return false;
    },

    /**
     * Mark job as complete (success or error)
     */
    completeJob(results?: { imported: number; duplicates: number; errors: number }, error?: string) {
      update(state => {
        if (state.activeJob) {
          const completedJob: ImportJob = {
            ...state.activeJob,
            status: error ? 'error' : 'completed',
            completedAt: new Date(),
            processedFiles: state.activeJob.totalFiles,
            error,
            imported: results?.imported,
            duplicates: results?.duplicates,
            errors: results?.errors,
          };
          return {
            activeJob: null,
            recentJobs: [completedJob, ...state.recentJobs.slice(0, 9)],
          };
        }
        return state;
      });
    },

    /**
     * Clear all import history
     */
    clear() {
      set({ activeJob: null, recentJobs: [] });
    },

    /**
     * Clear just the recent jobs
     */
    clearRecent() {
      update(state => ({ ...state, recentJobs: [] }));
    },
  };
}

export const importStore = createImportStore();

// Derived store for quick checks
export const isImporting = derived(importStore, $store => $store.activeJob !== null);

/**
 * OPT-105: Simplified progress display
 *
 * The backend (orchestrator) now emits granular per-file progress events.
 * We no longer need aggressive sandbagging - just pass through real values.
 * CSS transitions in the UI handle visual smoothing.
 *
 * Previous OPT-104 sandbagging was too aggressive (150ms/1% limit) and made
 * progress feel sluggish even when real data was available.
 */
export const importProgress = derived(importStore, ($store) => {
  if (!$store.activeJob) return null;
  const job = $store.activeJob;

  // OPT-105: Use real values directly from orchestrator
  // UI will use CSS transitions for visual smoothing
  return {
    current: job.processedFiles,
    total: job.totalFiles,
    percent: Math.round(job.percent),
    locationName: job.locationName,
    locid: job.locid,
    currentFilename: job.currentFilename,
  };
});

// Derived store for recent completed jobs
export const recentImports = derived(importStore, $store => $store.recentJobs);
