# Where's Waldo 6: Import UX - Background Processing and Progress Feedback

Date: 2025-11-22
Status: IMPLEMENTED

---

## Executive Summary

The import process is working on the backend, but the user experience is broken:
1. **No progress feedback** - UI shows static "Importing..." with no updates
2. **App appears frozen** - User can't interact with the app during import
3. **Can't navigate away** - User is stuck watching a blank progress indicator
4. **Map pins disappear** - Heavy I/O blocks the renderer's event loop

This is a **critical UX failure** for an archive app where importing is a core function.

---

## The Problem (User's Perspective)

1. User drops 15 NEF files (25MB each = 375MB total)
2. UI shows "Importing 15 file(s)..."
3. App becomes unresponsive
4. Map pins disappear (Leaflet can't render)
5. User waits 30+ seconds with no feedback
6. No way to know if it's working or broken
7. Can't do anything else in the app

---

## Root Cause Analysis

### Problem 1: Frontend Blocks on `await`

**Location:** `src/pages/LocationDetail.svelte:299-304`

```javascript
// This blocks the entire component until ALL files are imported
const result = await window.electronAPI.media.import({
  files: filesForImport,
  locid: location.locid,
  auth_imp: currentUser,
  deleteOriginals: false,
});
```

**Impact:** JavaScript is single-threaded. The `await` prevents any other code from running in this component. The UI can't update, events can't fire, nothing can happen.

### Problem 2: Progress Listener Exists But Is NEVER Used

**Backend has progress support:**
- `file-import-service.ts:166` - `onProgress?: (current: number, total: number) => void`
- `file-import-service.ts:192-193` - Calls `onProgress(i + 1, files.length)`
- `ipc-handlers.ts:619` - `_event.sender.send('media:import:progress', { current, total })`

**Preload has listener:**
- `preload.cjs:80-84` - `onImportProgress(callback)` sets up IPC listener

**Frontend NEVER calls it:**
- `LocationDetail.svelte` - No call to `window.electronAPI.media.onImportProgress()`
- Progress events are sent but nobody is listening

### Problem 3: Heavy I/O Blocks Main Process

For each file, the import does:
1. **SHA256 hash** - Reads entire file (25MB)
2. **ExifTool** - Spawns external process
3. **File copy** - Writes entire file (25MB)
4. **SHA256 verify** - Reads copied file again (25MB)
5. **Database insert** - SQLite write

For 15 files at 25MB each:
- 375MB read for initial hash
- 375MB read by ExifTool
- 375MB written to archive
- 375MB read for verification
- **Total: ~1.5GB of I/O**

This blocks the Electron main process event loop, which prevents:
- IPC messages from being processed
- Window updates from happening
- Other handlers from responding

### Problem 4: Single Transaction = All or Nothing

**Location:** `file-import-service.ts:178-245`

```javascript
return await this.db.transaction().execute(async (trx) => {
  // ALL files are imported in ONE transaction
  for (let i = 0; i < files.length; i++) {
    // ... import each file
  }
});
```

If ANY file fails, the ENTIRE import is rolled back. No partial results.

### Problem 5: No Global Import State

There's no way to:
- See import progress on the Dashboard
- Know if an import is running from other pages
- Resume or cancel an import

---

## What Would Be Different (WWYDD)

### Premium Archive App UX

1. **Drag files anywhere** - Import starts immediately
2. **Toast notification** - "Importing 15 files" with progress bar
3. **Navigate freely** - User can browse locations, view map, etc.
4. **Dashboard widget** - Shows active import with live progress
5. **Background processing** - Import continues even when navigating
6. **Notifications** - "Import complete: 15 files added"
7. **Queue system** - Multiple imports can be queued
8. **Pause/Resume/Cancel** - User control over long imports
9. **Error recovery** - Failed files shown separately, can retry

---

## The Fix: Architecture

### Global Import Store

Create a Svelte store that tracks import state globally:

```typescript
// src/stores/import-store.ts
interface ImportJob {
  id: string;
  locid: string;
  locationName: string;
  totalFiles: number;
  processedFiles: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  startedAt: Date;
  completedAt?: Date;
  results?: ImportSessionResult;
  error?: string;
}

interface ImportState {
  activeJob: ImportJob | null;
  recentJobs: ImportJob[];
}
```

### Fire-and-Forget Import

Start the import, but don't `await` it. Let it run in the background:

```javascript
// Start import (non-blocking)
startBackgroundImport(files, location);

// User can navigate away immediately
router.navigate('/dashboard');
```

### Progress Subscription

Subscribe to progress events globally:

```javascript
// In App.svelte or a layout component
onMount(() => {
  const unsubscribe = window.electronAPI.media.onImportProgress((progress) => {
    importStore.updateProgress(progress.current, progress.total);
  });
  return unsubscribe;
});
```

### Dashboard Import Widget

Show active imports on the Dashboard:

```svelte
{#if $importStore.activeJob}
  <ImportProgressCard job={$importStore.activeJob} />
{/if}
```

---

## Implementation Guide

### Step 1: Create Import Store

**File:** `src/stores/import-store.ts`

```typescript
import { writable, derived } from 'svelte/store';

export interface ImportJob {
  id: string;
  locid: string;
  locationName: string;
  totalFiles: number;
  processedFiles: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

function createImportStore() {
  const { subscribe, set, update } = writable<{
    activeJob: ImportJob | null;
    recentJobs: ImportJob[];
  }>({
    activeJob: null,
    recentJobs: [],
  });

  return {
    subscribe,

    startJob(locid: string, locationName: string, totalFiles: number) {
      const job: ImportJob = {
        id: crypto.randomUUID(),
        locid,
        locationName,
        totalFiles,
        processedFiles: 0,
        status: 'running',
        startedAt: new Date(),
      };
      update(state => ({ ...state, activeJob: job }));
      return job.id;
    },

    updateProgress(current: number, total: number) {
      update(state => {
        if (state.activeJob) {
          return {
            ...state,
            activeJob: { ...state.activeJob, processedFiles: current, totalFiles: total }
          };
        }
        return state;
      });
    },

    completeJob(results?: any, error?: string) {
      update(state => {
        if (state.activeJob) {
          const completedJob = {
            ...state.activeJob,
            status: error ? 'error' : 'completed',
            completedAt: new Date(),
            error,
          };
          return {
            activeJob: null,
            recentJobs: [completedJob, ...state.recentJobs.slice(0, 9)],
          };
        }
        return state;
      });
    },

    clear() {
      set({ activeJob: null, recentJobs: [] });
    }
  };
}

export const importStore = createImportStore();

// Derived store for quick checks
export const isImporting = derived(importStore, $store => $store.activeJob !== null);
export const importProgress = derived(importStore, $store => {
  if (!$store.activeJob) return null;
  return {
    current: $store.activeJob.processedFiles,
    total: $store.activeJob.totalFiles,
    percent: Math.round(($store.activeJob.processedFiles / $store.activeJob.totalFiles) * 100),
    locationName: $store.activeJob.locationName,
  };
});
```

### Step 2: Create Import Progress Component

**File:** `src/components/ImportProgress.svelte`

```svelte
<script lang="ts">
  import { importProgress, isImporting } from '../stores/import-store';
</script>

{#if $isImporting && $importProgress}
  <div class="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg border border-gray-200 p-4 w-80 z-50">
    <div class="flex items-center justify-between mb-2">
      <span class="text-sm font-medium text-gray-700">Importing to {$importProgress.locationName}</span>
      <span class="text-xs text-gray-500">{$importProgress.current}/{$importProgress.total}</span>
    </div>
    <div class="w-full bg-gray-200 rounded-full h-2">
      <div
        class="bg-accent h-2 rounded-full transition-all duration-300"
        style="width: {$importProgress.percent}%"
      ></div>
    </div>
    <p class="text-xs text-gray-500 mt-1">
      {$importProgress.percent}% complete
    </p>
  </div>
{/if}
```

### Step 3: Set Up Global Progress Listener

**File:** `src/App.svelte` (or layout component)

Add at the top of the script:

```javascript
import { onMount, onDestroy } from 'svelte';
import { importStore } from './stores/import-store';

let unsubscribeProgress: (() => void) | null = null;

onMount(() => {
  // Subscribe to import progress events from main process
  if (window.electronAPI?.media?.onImportProgress) {
    unsubscribeProgress = window.electronAPI.media.onImportProgress((progress) => {
      importStore.updateProgress(progress.current, progress.total);
    });
  }
});

onDestroy(() => {
  if (unsubscribeProgress) {
    unsubscribeProgress();
  }
});
```

And include the component:

```svelte
<ImportProgress />
```

### Step 4: Update LocationDetail.svelte

Replace the blocking import with fire-and-forget:

```javascript
import { importStore } from '../stores/import-store';
import { goto } from '$app/navigation'; // or your router

async function importFilePaths(filePaths: string[]) {
  if (!location || !window.electronAPI?.media) return;

  const filesForImport = filePaths.map((filePath) => {
    const parts = filePath.split(/[\\/]/);
    const fileName = parts[parts.length - 1];
    return { filePath, originalName: fileName };
  });

  // Start tracking in global store
  importStore.startJob(location.locid, location.locnam, filePaths.length);

  // Start import (fire-and-forget - don't await)
  window.electronAPI.media.import({
    files: filesForImport,
    locid: location.locid,
    auth_imp: currentUser,
    deleteOriginals: false,
  }).then((result) => {
    importStore.completeJob(result);
    // Optionally reload location data
    loadLocation();
  }).catch((error) => {
    importStore.completeJob(null, error.message);
  });

  // User can continue using the app immediately
  // Show toast or notification
  importProgress = `Import started (${filePaths.length} files)`;
  setTimeout(() => { importProgress = ''; }, 3000);
}
```

### Step 5: Add Dashboard Import Widget

**File:** `src/pages/Dashboard.svelte`

Add to imports:
```javascript
import { importStore, isImporting, importProgress } from '../stores/import-store';
```

Add to template:
```svelte
<!-- Active Import Section -->
{#if $isImporting && $importProgress}
  <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
    <h3 class="text-lg font-semibold text-gray-800 mb-4">Active Import</h3>
    <div class="flex items-center gap-4">
      <div class="flex-1">
        <p class="text-sm text-gray-600 mb-1">
          Importing to <strong>{$importProgress.locationName}</strong>
        </p>
        <div class="w-full bg-gray-200 rounded-full h-3">
          <div
            class="bg-accent h-3 rounded-full transition-all duration-300"
            style="width: {$importProgress.percent}%"
          ></div>
        </div>
        <p class="text-xs text-gray-500 mt-1">
          {$importProgress.current} of {$importProgress.total} files ({$importProgress.percent}%)
        </p>
      </div>
    </div>
  </div>
{/if}

<!-- Recent Imports -->
{#if $importStore.recentJobs.length > 0}
  <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
    <h3 class="text-lg font-semibold text-gray-800 mb-4">Recent Imports</h3>
    <div class="space-y-2">
      {#each $importStore.recentJobs.slice(0, 5) as job}
        <div class="flex items-center justify-between text-sm">
          <span>{job.locationName}</span>
          <span class="text-gray-500">
            {job.totalFiles} files - {job.status === 'completed' ? 'Done' : 'Failed'}
          </span>
        </div>
      {/each}
    </div>
  </div>
{/if}
```

---

## Performance Optimizations (Future)

### 1. Chunked Transactions

Instead of one transaction for all files, batch them:

```javascript
const BATCH_SIZE = 5;
for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE);
  await this.db.transaction().execute(async (trx) => {
    for (const file of batch) {
      await this.importSingleFile(file, deleteOriginal, trx);
    }
  });
  // Allow event loop to process other tasks
  await new Promise(resolve => setImmediate(resolve));
}
```

### 2. Worker Threads for SHA256

Move heavy CPU work off the main thread:

```javascript
// Use worker_threads for hashing
const { Worker } = require('worker_threads');

async function hashInWorker(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./hash-worker.js', {
      workerData: { filePath }
    });
    worker.on('message', resolve);
    worker.on('error', reject);
  });
}
```

### 3. Parallel File Processing

Process multiple files at once (careful with memory):

```javascript
const CONCURRENCY = 3;
const chunks = chunkArray(files, CONCURRENCY);
for (const chunk of chunks) {
  await Promise.all(chunk.map(file => this.importSingleFile(file, ...)));
}
```

---

## Files Created/Modified

| File | Action | Status |
|------|--------|--------|
| `src/stores/import-store.ts` | CREATE | DONE |
| `src/components/ImportProgress.svelte` | CREATE | DONE |
| `src/App.svelte` | MODIFY | DONE |
| `src/pages/LocationDetail.svelte` | MODIFY | DONE |
| `src/pages/Dashboard.svelte` | MODIFY | DONE |

### Implementation Summary

**Note:** Svelte 5 runes mode requires using `$derived()` instead of `$:` reactive statements.
The ImportProgress component was updated to use `let activeJob = $derived($importStore.activeJob);`

1. **`src/stores/import-store.ts`** - New Svelte store for global import state
   - `importStore` - Main store with startJob, updateProgress, completeJob methods
   - `isImporting` - Derived boolean for quick checks
   - `importProgress` - Derived progress object (current, total, percent, locationName)
   - `recentImports` - Derived array of completed jobs

2. **`src/components/ImportProgress.svelte`** - Floating progress indicator
   - Fixed position bottom-right corner
   - Shows progress bar, file count, percentage
   - Displays elapsed time
   - Informs user they can continue using the app

3. **`src/App.svelte`** - Global progress listener
   - Subscribes to `media:import:progress` IPC events
   - Updates import store with progress
   - Includes ImportProgress component globally

4. **`src/pages/LocationDetail.svelte`** - Fire-and-forget import
   - Removed blocking `await` on import
   - Uses `.then()/.catch()` pattern for non-blocking
   - Integrates with global import store
   - Checks if import already in progress before starting new one

5. **`src/pages/Dashboard.svelte`** - Import status widget
   - Shows active import with live progress bar
   - Links to location being imported to
   - Shows recent completed imports from current session
   - Displays success/failure status

---

## Verification Checklist

After implementation:

1. [ ] Drop files on location - import starts
2. [ ] Progress toast appears with percentage
3. [ ] User can navigate to Dashboard while import runs
4. [ ] Dashboard shows active import with live progress
5. [ ] Map pins remain visible during import
6. [ ] Import completes and shows notification
7. [ ] Recent imports appear on Dashboard
8. [ ] Location page shows new files after refresh

---

## Previous Bugs Reference

| Waldo | Issue | Fixed |
|-------|-------|-------|
| 1 | Preload ESM/CJS mismatch | Yes |
| 2 | Vite bundler adds ESM wrapper | Yes |
| 3 | Custom copy plugin for preload | Yes |
| 4 | webUtils undefined, file.path fallback | Yes |
| 5 | RAW formats missing from extension lists | Yes |
| **6** | **Import UX - blocking, no progress** | Yes |

---

## Lessons Learned

1. **Backend having features != frontend using them** - Progress API existed but wasn't connected
2. **`await` is blocking** - Long operations freeze the UI
3. **Archive apps need import-first design** - Import is the core function
4. **Global state for async operations** - Long-running tasks need app-wide visibility
5. **Test with real data volumes** - 15 files at 25MB each is different than 3 JPGs

---

End of Report
