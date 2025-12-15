# OPT-113: Auto-Archive Implementation Guide

**For**: Junior/Mid-level developers implementing auto-archive feature
**Prerequisites**: Understanding of TypeScript, Electron IPC, SQLite, Svelte

---

## Overview

This guide walks through implementing automatic web source archiving. When a user saves a bookmark, the system automatically queues an archive job that runs in the background.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           USER ACTION                                │
│                    (Save bookmark in browser)                        │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    RENDERER PROCESS (Svelte)                         │
│                                                                      │
│   WebBrowser.svelte ──► window.electron.websources.create(url)       │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ IPC
┌─────────────────────────────────────────────────────────────────────┐
│                     MAIN PROCESS (Electron)                          │
│                                                                      │
│   websources.ts IPC Handler                                          │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  1. Validate input                                            │  │
│   │  2. Create web source record (status='pending')               │  │
│   │  3. Check if job already queued for this source  ◄── NEW      │  │
│   │  4. Add job to JobQueue (queue='websource-archive') ◄── NEW   │  │
│   │  5. Return source to renderer                                 │  │
│   └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ (async, background)
┌─────────────────────────────────────────────────────────────────────┐
│                     JOB WORKER SERVICE                               │
│                                                                      │
│   Polls for pending jobs, processes 'websource-archive' queue       │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  1. Claim job from queue                                      │  │
│   │  2. Check if source still exists (not deleted)   ◄── NEW      │  │
│   │  3. Check browser profile lock                   ◄── NEW      │  │
│   │  4. Call orchestrator.archiveSource(sourceId)                 │  │
│   │  5. Emit completion event via IPC                ◄── NEW      │  │
│   │  6. Mark job complete or failed                               │  │
│   └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR SERVICE                              │
│                                                                      │
│   websource-orchestrator-service.ts                                  │
│   - Captures: Screenshot, PDF, HTML, WARC                            │
│   - Extracts: Images, Videos, Text, Metadata                         │
│   - Updates: Database with results                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## File Changes Summary

| File | Type | Lines | Purpose |
|------|------|-------|---------|
| `websources.ts` | MODIFY | +60 | Auto-queue job after create |
| `job-worker-service.ts` | MODIFY | +45 | Handle websource-archive queue |
| `websource-capture-service.ts` | MODIFY | +25 | Profile lock detection |
| `Settings.svelte` | MODIFY | +50 | Global "Archive All" button |
| `LocationDetail.svelte` | MODIFY | +50 | Location "Archive All" button |
| `preload.cjs` | MODIFY | +15 | Event listener for completion |
| `electron.d.ts` | MODIFY | +10 | Type definitions |

---

## Phase 1: Profile Lock Detection

### File: `websource-capture-service.ts`

**Location**: `packages/desktop/electron/services/websource-capture-service.ts`

**Why**: Chrome locks its profile directory while running. We need to detect this and use a fallback.

**What to add**:

```typescript
// Add after imports, before getResearchBrowserProfilePath()

/**
 * Check if a Chrome profile is locked (browser is running)
 * Chrome creates a 'SingletonLock' file when running
 */
export function isProfileLocked(profilePath: string): boolean {
  const lockFiles = [
    path.join(profilePath, 'SingletonLock'),
    path.join(profilePath, 'lockfile'),
  ];

  for (const lockFile of lockFiles) {
    if (fs.existsSync(lockFile)) {
      return true;
    }
  }
  return false;
}
```

**Modify `getResearchBrowserProfilePath()`**:

```typescript
export function getResearchBrowserProfilePath(): string {
  const platform = process.platform;
  let profilePath: string;

  if (platform === 'darwin') {
    profilePath = path.join(process.env.HOME || '', 'Library', 'Application Support', 'Chromium');
  } else if (platform === 'linux') {
    profilePath = path.join(process.env.HOME || '', '.config', 'chromium');
  } else {
    profilePath = path.join(process.env.LOCALAPPDATA || '', 'Chromium', 'User Data');
  }

  // Check if profile exists AND is not locked
  if (fs.existsSync(profilePath) && !isProfileLocked(profilePath)) {
    console.log('[WebSource] Using Research Browser profile:', profilePath);
    return profilePath;
  }

  // Log why we're using fallback
  if (fs.existsSync(profilePath)) {
    console.log('[WebSource] Research Browser profile LOCKED, using fallback');
  } else {
    console.log('[WebSource] Research Browser profile not found, using fallback');
  }

  // Fallback to app-managed profile
  const { app } = require('electron');
  const fallbackDir = path.join(app.getPath('userData'), 'browser-profile');
  if (!fs.existsSync(fallbackDir)) {
    fs.mkdirSync(fallbackDir, { recursive: true });
  }
  return fallbackDir;
}
```

---

## Phase 2: Job Worker Handler

### File: `job-worker-service.ts`

**Location**: `packages/desktop/electron/services/job-worker-service.ts`

**Why**: The job worker needs to know how to process `websource-archive` queue jobs.

**Find the `processJob` method and add a new case**:

```typescript
// In the switch statement that handles different queue types
case 'websource-archive': {
  const { sourceId } = payload as { sourceId: string };

  // Import orchestrator lazily to avoid circular deps
  const { getOrchestrator } = await import('./websource-orchestrator-service');
  const { SQLiteWebSourcesRepository } = await import('../repositories/sqlite-websources-repository');

  const repo = new SQLiteWebSourcesRepository(this.db);

  // Check if source still exists (user might have deleted it)
  const source = await repo.findById(sourceId);
  if (!source) {
    console.log(`[JobWorker] Source ${sourceId} no longer exists, skipping archive`);
    return { skipped: true, reason: 'Source deleted' };
  }

  // Check if already archived
  if (source.status === 'complete') {
    console.log(`[JobWorker] Source ${sourceId} already archived, skipping`);
    return { skipped: true, reason: 'Already archived' };
  }

  // Run archive
  const orchestrator = getOrchestrator(this.db);
  const result = await orchestrator.archiveSource(sourceId);

  // Emit completion event for UI
  const { BrowserWindow } = await import('electron');
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send('websources:archive-complete', {
      sourceId,
      success: result.success,
      error: result.error,
    });
  }

  return result;
}
```

---

## Phase 3: Auto-Queue on Create

### File: `websources.ts`

**Location**: `packages/desktop/electron/main/ipc-handlers/websources.ts`

**Why**: When a web source is created, automatically queue an archive job.

**Modify the `websources:create` handler**:

```typescript
// Add import at top
import { JobQueue } from '../../services/job-queue';

// Store job queue instance
let jobQueue: JobQueue | null = null;

const getJobQueueInstance = (db: Kysely<Database>) => {
  if (!jobQueue) {
    jobQueue = new JobQueue(db);
  }
  return jobQueue;
};

// Modify the create handler
ipcMain.handle('websources:create', async (_event, input: unknown) => {
  try {
    const validatedInput = WebSourceInputSchema.parse(input) as WebSourceInput;
    const source = await webSourcesRepo.create(validatedInput);

    // Auto-queue archive job (non-blocking)
    try {
      const queue = getJobQueueInstance(db);

      // Check if job already exists for this source
      const existingJobs = await db
        .selectFrom('jobs')
        .select('job_id')
        .where('queue', '=', 'websource-archive')
        .where('status', 'in', ['pending', 'processing'])
        .where('payload', 'like', `%"sourceId":"${source.source_id}"%`)
        .execute();

      if (existingJobs.length === 0) {
        await queue.addJob({
          queue: 'websource-archive',
          payload: { sourceId: source.source_id },
          priority: 5, // Lower than media import (default 10)
        });
        console.log(`[WebSources] Auto-queued archive for ${source.source_id}`);
      } else {
        console.log(`[WebSources] Archive already queued for ${source.source_id}`);
      }
    } catch (queueError) {
      // Don't fail create if queue fails - log and continue
      console.error('[WebSources] Failed to queue archive job:', queueError);
    }

    return source;
  } catch (error) {
    console.error('Error creating web source:', error);
    if (error instanceof z.ZodError) {
      throw new Error(
        `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
});
```

**Add new IPC handler for archiving by location**:

```typescript
/**
 * Archive all pending sources for a specific location
 */
ipcMain.handle('websources:archivePendingByLocation', async (_event, locid: unknown, limit: unknown = 50) => {
  try {
    const validatedLocid = Blake3IdSchema.parse(locid);
    const validatedLimit = validate(LimitSchema, limit);

    // Find pending sources for this location
    const pendingSources = await db
      .selectFrom('web_sources')
      .select('source_id')
      .where('locid', '=', validatedLocid)
      .where('status', '=', 'pending')
      .limit(validatedLimit)
      .execute();

    const queue = getJobQueueInstance(db);
    let queued = 0;

    for (const source of pendingSources) {
      // Check if not already queued
      const existing = await db
        .selectFrom('jobs')
        .select('job_id')
        .where('queue', '=', 'websource-archive')
        .where('status', 'in', ['pending', 'processing'])
        .where('payload', 'like', `%"sourceId":"${source.source_id}"%`)
        .execute();

      if (existing.length === 0) {
        await queue.addJob({
          queue: 'websource-archive',
          payload: { sourceId: source.source_id },
          priority: 5,
        });
        queued++;
      }
    }

    return { queued, total: pendingSources.length };
  } catch (error) {
    console.error('Error archiving pending by location:', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
});

/**
 * Get count of pending sources for a location
 */
ipcMain.handle('websources:countPendingByLocation', async (_event, locid: unknown) => {
  try {
    const validatedLocid = Blake3IdSchema.parse(locid);

    const result = await db
      .selectFrom('web_sources')
      .select(db.fn.count('source_id').as('count'))
      .where('locid', '=', validatedLocid)
      .where('status', '=', 'pending')
      .executeTakeFirst();

    return Number(result?.count || 0);
  } catch (error) {
    console.error('Error counting pending by location:', error);
    return 0;
  }
});

/**
 * Get total count of pending sources (global)
 */
ipcMain.handle('websources:countPending', async () => {
  try {
    const result = await db
      .selectFrom('web_sources')
      .select(db.fn.count('source_id').as('count'))
      .where('status', '=', 'pending')
      .executeTakeFirst();

    return Number(result?.count || 0);
  } catch (error) {
    console.error('Error counting pending:', error);
    return 0;
  }
});

/**
 * Archive all pending sources (global)
 */
ipcMain.handle('websources:archiveAllPending', async (_event, limit: unknown = 100) => {
  try {
    const validatedLimit = validate(LimitSchema, limit);

    const pendingSources = await db
      .selectFrom('web_sources')
      .select('source_id')
      .where('status', '=', 'pending')
      .limit(validatedLimit)
      .execute();

    const queue = getJobQueueInstance(db);
    let queued = 0;

    for (const source of pendingSources) {
      const existing = await db
        .selectFrom('jobs')
        .select('job_id')
        .where('queue', '=', 'websource-archive')
        .where('status', 'in', ['pending', 'processing'])
        .where('payload', 'like', `%"sourceId":"${source.source_id}"%`)
        .execute();

      if (existing.length === 0) {
        await queue.addJob({
          queue: 'websource-archive',
          payload: { sourceId: source.source_id },
          priority: 5,
        });
        queued++;
      }
    }

    return { queued, total: pendingSources.length };
  } catch (error) {
    console.error('Error archiving all pending:', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
});
```

---

## Phase 4: Preload Bridge

### File: `preload.cjs`

**Location**: `packages/desktop/electron/preload/preload.cjs`

**Why**: Expose the new IPC channels and event listener to renderer.

**Add to the websources object**:

```javascript
// In the websources section, add:
archivePendingByLocation: (locid, limit) => ipcRenderer.invoke('websources:archivePendingByLocation', locid, limit),
countPendingByLocation: (locid) => ipcRenderer.invoke('websources:countPendingByLocation', locid),
countPending: () => ipcRenderer.invoke('websources:countPending'),
archiveAllPending: (limit) => ipcRenderer.invoke('websources:archiveAllPending', limit),
onArchiveComplete: (callback) => {
  const handler = (_event, result) => callback(result);
  ipcRenderer.on('websources:archive-complete', handler);
  return () => ipcRenderer.removeListener('websources:archive-complete', handler);
},
```

---

## Phase 5: Type Definitions

### File: `electron.d.ts`

**Location**: `packages/desktop/src/types/electron.d.ts`

**Add to the websources interface**:

```typescript
// In the websources interface, add:
archivePendingByLocation(locid: string, limit?: number): Promise<{ queued: number; total: number }>;
countPendingByLocation(locid: string): Promise<number>;
countPending(): Promise<number>;
archiveAllPending(limit?: number): Promise<{ queued: number; total: number }>;
onArchiveComplete(callback: (result: { sourceId: string; success: boolean; error?: string }) => void): () => void;
```

---

## Phase 6: Settings UI - Global Archive All Button

### File: `Settings.svelte`

**Location**: `packages/desktop/src/pages/Settings.svelte`

**Find the Archive/Maintenance section and add**:

```svelte
<!-- Archive Pending Web Sources button -->
<div class="flex items-center justify-between py-3 border-b border-braun-200">
  <div>
    <h4 class="font-medium text-braun-900">Archive Pending Web Sources</h4>
    <p class="text-sm text-braun-600">
      {#if pendingWebSourceCount > 0}
        {pendingWebSourceCount} web sources waiting to be archived
      {:else}
        All web sources are archived
      {/if}
    </p>
  </div>
  <button
    class="btn variant-filled-primary"
    onclick={archiveAllPendingWebSources}
    disabled={archivingWebSources || pendingWebSourceCount === 0}
  >
    {#if archivingWebSources}
      <span class="animate-spin">↻</span> Archiving...
    {:else}
      Archive All ({pendingWebSourceCount})
    {/if}
  </button>
</div>
```

**Add to script section**:

```typescript
// State for web source archiving
let pendingWebSourceCount = $state(0);
let archivingWebSources = $state(false);

// Load pending count on mount
onMount(async () => {
  // ... existing onMount code ...

  // Load pending web source count
  if (window.electron?.websources?.countPending) {
    pendingWebSourceCount = await window.electron.websources.countPending();
  }

  // Listen for archive completion to update count
  if (window.electron?.websources?.onArchiveComplete) {
    const cleanup = window.electron.websources.onArchiveComplete(async () => {
      pendingWebSourceCount = await window.electron.websources.countPending();
    });
    // Store cleanup for onDestroy
  }
});

async function archiveAllPendingWebSources() {
  if (!window.electron?.websources?.archiveAllPending) return;

  try {
    archivingWebSources = true;
    const result = await window.electron.websources.archiveAllPending();
    console.log(`Queued ${result.queued} web sources for archiving`);
    // Count will update via event listener as archives complete
  } catch (error) {
    console.error('Failed to archive web sources:', error);
  } finally {
    archivingWebSources = false;
  }
}
```

---

## Phase 7: Location Detail UI - Location-Scoped Archive All Button

### File: `LocationDetail.svelte`

**Location**: `packages/desktop/src/pages/LocationDetail.svelte`

**Find the Settings/Maintenance tab and add near the thumbnail regenerate button**:

```svelte
<!-- Archive Pending Web Sources for this location -->
<div class="flex items-center justify-between py-3 border-b border-braun-200">
  <div>
    <h4 class="font-medium text-braun-900">Archive Pending Sources</h4>
    <p class="text-sm text-braun-600">
      {#if pendingSourceCount > 0}
        {pendingSourceCount} web sources for this location need archiving
      {:else}
        All sources for this location are archived
      {/if}
    </p>
  </div>
  <button
    class="btn variant-filled-primary"
    onclick={archivePendingSources}
    disabled={archivingSources || pendingSourceCount === 0}
  >
    {#if archivingSources}
      <span class="animate-spin">↻</span> Archiving...
    {:else}
      Archive ({pendingSourceCount})
    {/if}
  </button>
</div>
```

**Add to script section**:

```typescript
// State for web source archiving
let pendingSourceCount = $state(0);
let archivingSources = $state(false);

// In loadLocation or onMount, add:
async function loadPendingSourceCount() {
  if (window.electron?.websources?.countPendingByLocation && locationId) {
    pendingSourceCount = await window.electron.websources.countPendingByLocation(locationId);
  }
}

// Call loadPendingSourceCount() after loading location data

async function archivePendingSources() {
  if (!window.electron?.websources?.archivePendingByLocation || !locationId) return;

  try {
    archivingSources = true;
    const result = await window.electron.websources.archivePendingByLocation(locationId);
    console.log(`Queued ${result.queued} sources for archiving`);
  } catch (error) {
    console.error('Failed to archive sources:', error);
  } finally {
    archivingSources = false;
    // Refresh count
    await loadPendingSourceCount();
  }
}
```

---

## Testing Checklist

### Unit Tests

1. [ ] `isProfileLocked()` returns true when lock file exists
2. [ ] `isProfileLocked()` returns false when no lock file
3. [ ] `getResearchBrowserProfilePath()` returns fallback when locked
4. [ ] Job queue duplicate prevention works
5. [ ] Archive job handler skips deleted sources
6. [ ] Archive job handler skips already-archived sources

### Integration Tests

1. [ ] Save bookmark → job appears in queue
2. [ ] Job processes → archive created
3. [ ] IPC event fires on completion
4. [ ] UI updates after archive complete
5. [ ] "Archive All" queues correct sources
6. [ ] Location-scoped "Archive All" only queues that location's sources

### Manual Tests

1. [ ] Save bookmark with Research Browser OPEN → uses fallback profile
2. [ ] Save bookmark with Research Browser CLOSED → uses main profile
3. [ ] Save same URL twice → only one job queued
4. [ ] Delete source while job pending → job skips gracefully
5. [ ] App restart with pending jobs → jobs resume

---

## Rollback Plan

All changes are additive. To rollback:

1. Remove auto-queue code from `websources:create` handler
2. Remove `websource-archive` case from job worker
3. Remove UI buttons (optional - they're harmless without backend)

No database migrations required.

---

## Performance Considerations

1. **Concurrency**: One archive at a time (job worker default)
2. **Priority**: Archive jobs at priority 5 (media import at 10)
3. **Rate limiting**: Job worker has built-in delay between jobs
4. **Memory**: Browser instance shared across archives

---

## Monitoring

Existing monitoring captures:
- `jobs.enqueued` counter
- `jobs.completed` counter
- `jobs.failed` counter
- `jobs.duration` histogram

No additional monitoring needed.

