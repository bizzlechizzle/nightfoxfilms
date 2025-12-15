# Import System v2.0 — Implementation Guide

> A comprehensive guide for developers working with the AU Archive Import Pipeline.

**Version:** 2.0
**Last Updated:** 2025-12-05
**Audience:** Developers new to the codebase

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Pipeline Stages](#pipeline-stages)
4. [Job Queue System](#job-queue-system)
5. [Worker Pool](#worker-pool)
6. [IPC Integration](#ipc-integration)
7. [Database Schema](#database-schema)
8. [Error Handling](#error-handling)
9. [Testing](#testing)
10. [Troubleshooting](#troubleshooting)

---

## Overview

### What is Import v2?

Import v2 is a 5-step pipeline that ingests media files into the AU Archive. It replaces the legacy single-pass import with a robust, resumable, progress-tracking system.

### Key Features

| Feature | Description |
|---------|-------------|
| **5-Step Pipeline** | Scan → Hash → Copy → Validate → Finalize |
| **Resumable** | Crash recovery via `import_sessions` table |
| **Progress Tracking** | Real-time weighted progress (5/35/40/15/5) |
| **Background Jobs** | Post-import processing (thumbnails, metadata, proxies) |
| **Parallel Hashing** | Worker threads for BLAKE3 computation |
| **Atomic Operations** | Temp-file-then-rename prevents partial files |
| **Duplicate Detection** | Hash-based deduplication before copy |

### File Locations

```
packages/desktop/electron/
├── services/
│   ├── import/
│   │   ├── index.ts           # Module exports
│   │   ├── orchestrator.ts    # Main coordinator (~500 lines)
│   │   ├── scanner.ts         # Step 1: File discovery (~350 lines)
│   │   ├── hasher.ts          # Step 2: Parallel hashing (~200 lines)
│   │   ├── copier.ts          # Step 3: Atomic copy (~250 lines)
│   │   ├── validator.ts       # Step 4: Integrity check (~150 lines)
│   │   └── finalizer.ts       # Step 5: Database commit (~450 lines)
│   ├── job-queue.ts           # SQLite-backed priority queue (~350 lines)
│   ├── worker-pool.ts         # Thread pool for hashing (~300 lines)
│   └── job-worker-service.ts  # Background job processor (~550 lines)
├── workers/
│   └── hash.worker.ts         # BLAKE3 worker thread (~50 lines)
└── main/
    └── ipc-handlers/
        └── import-v2.ts       # IPC handlers (~350 lines)
```

---

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        RENDERER (Svelte)                        │
│                                                                 │
│   window.electron.importV2.start({ paths, locid, ... })        │
│         │                              ▲                        │
│         │ IPC invoke                   │ IPC events            │
│         ▼                              │                        │
├─────────────────────────────────────────────────────────────────┤
│                        PRELOAD (CommonJS)                       │
│                                                                 │
│   ipcRenderer.invoke('import:v2:start', input)                 │
│   ipcRenderer.on('import:v2:progress', callback)               │
├─────────────────────────────────────────────────────────────────┤
│                        MAIN PROCESS                             │
│                                                                 │
│   ┌─────────────────┐    ┌─────────────────────────────────┐   │
│   │  IPC Handlers   │───▶│      ImportOrchestrator         │   │
│   │  import-v2.ts   │    │                                 │   │
│   └─────────────────┘    │  ┌───────┐ ┌───────┐ ┌───────┐ │   │
│                          │  │Scanner│▶│Hasher │▶│Copier │ │   │
│                          │  └───────┘ └───────┘ └───────┘ │   │
│                          │  ┌─────────┐ ┌─────────┐       │   │
│                          │  │Validator│▶│Finalizer│       │   │
│                          │  └─────────┘ └─────────┘       │   │
│                          └─────────────────────────────────┘   │
│                                         │                       │
│                                         ▼                       │
│   ┌─────────────────┐    ┌─────────────────────────────────┐   │
│   │   JobQueue      │◀───│     JobWorkerService            │   │
│   │   (SQLite)      │    │  (Background processing)        │   │
│   └─────────────────┘    └─────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User selects files** → Renderer calls `importV2.start()`
2. **Scanner** discovers all files, detects sidecars, pairs
3. **Hasher** computes BLAKE3 hashes in parallel via WorkerPool
4. **Copier** atomically copies non-duplicate files to archive
5. **Validator** re-hashes copied files to verify integrity
6. **Finalizer** commits to database, queues background jobs
7. **JobWorkerService** processes queued jobs (thumbnails, metadata, proxies)

---

## Pipeline Stages

### Step 1: Scanner (0-5% progress)

**File:** `services/import/scanner.ts`

**Purpose:** Discover files, detect sidecars, identify pairs.

```typescript
interface ScanResult {
  files: ScannedFile[];        // All discovered files
  totalBytes: number;          // Total size for progress
  sidecarMap: Map<string, string[]>;  // base → [.xmp, .srt, ...]
  rawJpegPairs: Map<string, string>;  // raw → jpeg
  livePhotoCandidates: Map<string, string>;  // img → mov
}
```

**Key Logic:**

```typescript
// Exclusion patterns (skip these files)
const EXCLUDED_PATTERNS = [
  /^\.DS_Store$/i,
  /^Thumbs\.db$/i,
  /^\..*$/,  // Hidden files
  /\.importing$/,  // Temp files from incomplete imports
];

// Sidecar extensions (linked to parent file)
const SIDECAR_EXTENSIONS = ['.xmp', '.srt', '.thm', '.lrf'];

// RAW extensions (may have JPEG pair)
const RAW_EXTENSIONS = ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.rw2'];
```

**How it works:**

1. Recursively walks input directories
2. Filters out excluded files
3. Groups sidecars by base filename
4. Matches RAW+JPEG pairs
5. Identifies potential Live Photos (IMG+MOV)

### Step 2: Hasher (5-40% progress)

**File:** `services/import/hasher.ts`

**Purpose:** Compute BLAKE3 hashes in parallel, detect duplicates.

```typescript
interface HashResult {
  file: ScannedFile;
  hash: string;              // 16-char BLAKE3 hex
  isDuplicate: boolean;      // Already in database
  existingRecord?: MediaRecord;
}
```

**How it works:**

1. Distributes files to WorkerPool (worker threads)
2. Each worker computes BLAKE3 hash
3. Batch-checks hashes against database
4. Marks duplicates to skip copy step

**WorkerPool Integration:**

```typescript
// In hasher.ts
const pool = await getWorkerPool();
const results = await pool.hashBatchWithProgress(
  filePaths,
  (completed, total) => {
    onProgress(5 + (completed / total) * 35);  // 5-40%
  }
);
```

### Step 3: Copier (40-80% progress)

**File:** `services/import/copier.ts`

**Purpose:** Atomically copy files to archive structure.

```typescript
interface CopyResult {
  file: ScannedFile;
  archivePath: string;       // Final path in archive
  strategy: 'hardlink' | 'reflink' | 'copy';
  success: boolean;
  error?: string;
}
```

**Copy Strategies:**

| Strategy | When Used | Speed |
|----------|-----------|-------|
| **Hardlink** | Same filesystem | Instant |
| **Reflink** | APFS (macOS) | Near-instant |
| **Copy** | Cross-device or fallback | Slow |

**Atomic Pattern:**

```typescript
// 1. Copy to temp file with .importing extension
const tempPath = `${targetPath}.importing`;
await fs.copyFile(sourcePath, tempPath);

// 2. Rename atomically (survives crash)
await fs.rename(tempPath, targetPath);
```

**Archive Path Structure:**

```
[archive]/locations/[STATE]-[TYPE]/[SLOCNAM]-[LOC12]/
├── org-img-[LOC12]/          # Images
│   ├── a7f3b2c1e9d4f086.jpg
│   └── b8c4d3e2f0a5b197.cr2
├── org-vid-[LOC12]/          # Videos
│   └── c9d5e4f3a1b6c2a8.mp4
└── org-doc-[LOC12]/          # Documents
    └── d0e6f5a4b2c7d3b9.pdf
```

### Step 4: Validator (80-95% progress)

**File:** `services/import/validator.ts`

**Purpose:** Verify copied files match source hashes.

```typescript
interface ValidationResult {
  file: ScannedFile;
  valid: boolean;
  sourceHash: string;
  destHash?: string;
  error?: string;
}
```

**How it works:**

1. Re-hashes copied files using WorkerPool
2. Compares against source hash from Step 2
3. If mismatch: deletes corrupted file, marks for retry
4. Guarantees bit-perfect copies in archive

**Why validate?**

- Silent disk corruption during copy
- Network filesystem issues
- RAM errors affecting copy buffer
- Power loss during write

### Step 5: Finalizer (95-100% progress)

**File:** `services/import/finalizer.ts`

**Purpose:** Commit to database, queue background jobs.

```typescript
interface FinalizeResult {
  imported: number;          // Successfully added
  duplicates: number;        // Skipped (already exists)
  failed: number;            // Errors during pipeline
  jobs: {                    // Background jobs queued
    exiftool: number;
    thumbnails: number;
    proxies: number;
    bagit: number;
  };
}
```

**Database Transaction:**

```typescript
await db.transaction().execute(async (trx) => {
  // 1. Insert media records
  for (const file of validFiles) {
    await insertMedia(trx, file);
  }

  // 2. Link sidecars to parent files
  await linkSidecars(trx, sidecarMap);

  // 3. Link RAW+JPEG pairs
  await linkRawJpegPairs(trx, rawJpegPairs);

  // 4. Queue background jobs
  await queueBackgroundJobs(trx, validFiles);

  // 5. Update import session status
  await updateSession(trx, sessionId, 'completed');
});
```

**Job Queue Population:**

```typescript
// Queue jobs with dependencies
await jobQueue.addBulk([
  // ExifTool runs first (priority 10)
  ...files.map(f => ({
    queue: 'import:exiftool',
    priority: 10,
    payload: { hash: f.hash, archivePath: f.archivePath },
  })),

  // Thumbnails depend on nothing (priority 20)
  ...imageFiles.map(f => ({
    queue: 'import:thumbnail',
    priority: 20,
    payload: { hash: f.hash, archivePath: f.archivePath },
  })),

  // Video proxies are lower priority (priority 50)
  ...videoFiles.map(f => ({
    queue: 'import:video-proxy',
    priority: 50,
    payload: { hash: f.hash, archivePath: f.archivePath },
  })),
]);
```

---

## Job Queue System

### Overview

The job queue uses SQLite for persistence (no Redis dependency). Jobs survive app restarts and can be resumed.

**File:** `services/job-queue.ts`

### Schema

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  queue TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  payload TEXT NOT NULL,           -- JSON
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at TEXT,
  locked_by TEXT,
  depends_on TEXT,                 -- Job ID dependency
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT
);

CREATE TABLE job_dead_letter (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  queue TEXT NOT NULL,
  payload TEXT NOT NULL,
  error TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  failed_at TEXT NOT NULL
);
```

### JobQueue API

```typescript
const queue = new JobQueue(db);

// Add single job
await queue.addJob({
  queue: 'import:thumbnail',
  priority: 20,
  payload: { hash: 'a7f3b2c1', archivePath: '/path/to/file.jpg' },
});

// Add multiple jobs
await queue.addBulk(jobs);

// Get next job (atomic claim with locking)
const job = await queue.getNext('import:thumbnail');

// Complete job
await queue.complete(job.id);

// Fail job (will retry or move to dead letter)
await queue.fail(job.id, 'ExifTool crashed');
```

### Priority System

| Priority | Queue | Description |
|----------|-------|-------------|
| 10 | `import:exiftool` | Metadata extraction (fast) |
| 20 | `import:thumbnail` | Image thumbnails (medium) |
| 30 | `import:ffprobe` | Video metadata (fast) |
| 50 | `import:video-proxy` | Video transcoding (slow) |
| 60 | `import:live-photo` | Live photo detection |
| 70 | `import:bagit` | Archive integrity |
| 80 | `import:location-stats` | Stats recalculation |

### Retry Logic

```typescript
// Exponential backoff: 1s, 4s, 9s
const backoffMs = Math.pow(attempts, 2) * 1000;

// After max_attempts (default 3), move to dead letter
if (attempts >= maxAttempts) {
  await moveToDeadLetter(job);
}
```

### Dead Letter Queue

Failed jobs go to `job_dead_letter` for analysis:

```typescript
// Get failed jobs
const failed = await queue.getDeadLetter('import:thumbnail');

// Retry from dead letter
await queue.retryFromDeadLetter(deadLetterId);

// Acknowledge (dismiss) failures
await queue.acknowledgeDeadLetter([id1, id2]);
```

---

## Worker Pool

### Overview

The worker pool manages Node.js worker threads for CPU-intensive BLAKE3 hashing.

**File:** `services/worker-pool.ts`

### Configuration

```typescript
const pool = new WorkerPool({
  concurrency: cpus().length - 1,  // Leave 1 core for main
  taskTimeout: 60000,              // 60s per file
  restartOnCrash: true,            // Auto-restart crashed workers
});
```

### Worker Thread

**File:** `workers/hash.worker.ts`

```typescript
import { parentPort, workerData } from 'worker_threads';
import { createHash } from 'blake3';
import { createReadStream } from 'fs';

parentPort.on('message', async (msg) => {
  if (msg.type === 'hash') {
    const hash = await computeBlake3(msg.filePath);
    parentPort.postMessage({
      type: 'hash',
      id: msg.id,
      hash: hash.slice(0, 16),  // 16-char hex
    });
  }
});

async function computeBlake3(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hasher = createHash();
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hasher.update(chunk));
    stream.on('end', () => resolve(hasher.digest('hex')));
    stream.on('error', reject);
  });
}
```

### Using the Pool

```typescript
import { getWorkerPool, shutdownWorkerPool } from './worker-pool';

// Get singleton instance (creates workers on first call)
const pool = await getWorkerPool();

// Hash single file
const result = await pool.hash('/path/to/file.jpg');
// { filePath: '...', hash: 'a7f3b2c1e9d4f086' }

// Hash batch with progress
const results = await pool.hashBatchWithProgress(
  filePaths,
  (completed, total) => console.log(`${completed}/${total}`)
);

// Shutdown (drain queue, terminate workers)
await shutdownWorkerPool();
```

---

## IPC Integration

### Renderer API

**File:** `preload/preload.cjs`

```javascript
// Start import
const result = await window.electron.importV2.start({
  paths: ['/Users/me/photos'],
  locid: 'loc-uuid-123',
  loc12: 'ABC123456789',
  address_state: 'NY',
  type: 'Hospital',
  slocnam: 'Main Building',
});

// Cancel running import
await window.electron.importV2.cancel(sessionId);

// Get current status
const status = await window.electron.importV2.status();

// List resumable sessions
const sessions = await window.electron.importV2.resumable();

// Resume incomplete import
await window.electron.importV2.resume(sessionId);

// Listen to progress
const unsubscribe = window.electron.importV2.onProgress((progress) => {
  console.log(`${progress.percent}% - ${progress.currentFile}`);
});

// Listen to completion
const unsubComplete = window.electron.importV2.onComplete((result) => {
  console.log(`Imported ${result.imported} files`);
});
```

### Progress Events

```typescript
interface ImportV2Progress {
  sessionId: string;
  status: 'scanning' | 'hashing' | 'copying' | 'validating' | 'finalizing';
  step: number;            // 1-5
  totalSteps: number;      // 5
  percent: number;         // 0-100
  currentFile: string;     // Current file being processed
  filesProcessed: number;
  filesTotal: number;
  bytesProcessed: number;
  bytesTotal: number;
  duplicatesFound: number;
  errorsFound: number;
  estimatedRemainingMs: number;
}
```

### Background Job Events

```typescript
// Job progress
window.electron.jobs.onProgress((progress) => {
  console.log(`Job ${progress.jobId}: ${progress.status}`);
});

// Asset ready (thumbnail, metadata, proxy)
window.electron.jobs.onAssetReady((event) => {
  if (event.type === 'thumbnail-ready') {
    // Refresh UI with new thumbnail
    refreshThumbnail(event.hash, event.paths);
  }
});
```

---

## Database Schema

### Import Sessions Table

```sql
CREATE TABLE import_sessions (
  id TEXT PRIMARY KEY,
  locid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  step INTEGER NOT NULL DEFAULT 0,
  total_files INTEGER NOT NULL DEFAULT 0,
  processed_files INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  processed_bytes INTEGER NOT NULL DEFAULT 0,
  duplicates_found INTEGER NOT NULL DEFAULT 0,
  errors_found INTEGER NOT NULL DEFAULT 0,
  scan_result TEXT,          -- JSON: ScannedFile[]
  hash_results TEXT,         -- JSON: HashResult[]
  copy_results TEXT,         -- JSON: CopyResult[]
  validation_results TEXT,   -- JSON: ValidationResult[]
  error TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (locid) REFERENCES locs(locid)
);
```

### Resume Logic

```typescript
// Check for incomplete sessions on startup
const incomplete = await db
  .selectFrom('import_sessions')
  .where('status', 'in', ['scanning', 'hashing', 'copying', 'validating'])
  .selectAll()
  .execute();

// Resume from last completed step
for (const session of incomplete) {
  const orchestrator = new ImportOrchestrator(db);
  await orchestrator.resume(session.id);
}
```

---

## Error Handling

### Pipeline Errors

```typescript
// Each stage catches and reports errors
try {
  const scanResult = await scanner.scan(paths, onProgress);
} catch (error) {
  await updateSession(sessionId, {
    status: 'failed',
    error: error.message,
  });
  throw error;
}
```

### File-Level Errors

```typescript
// Errors don't stop the entire import
const results = files.map(async (file) => {
  try {
    return await processFile(file);
  } catch (error) {
    return { file, error: error.message, success: false };
  }
});

// Report errors in final result
const failed = results.filter(r => !r.success);
console.log(`${failed.length} files failed`);
```

### Cancellation

```typescript
// AbortController for cancellation
const controller = new AbortController();

// Check abort signal in loops
for (const file of files) {
  if (controller.signal.aborted) {
    throw new Error('Import cancelled');
  }
  await processFile(file);
}

// Cancel from IPC
ipcMain.handle('import:v2:cancel', async (_, sessionId) => {
  orchestrator.cancel();
});
```

---

## Testing

### Unit Test Examples

```typescript
// test/scanner.test.ts
describe('Scanner', () => {
  it('excludes .DS_Store files', async () => {
    const scanner = new Scanner();
    const result = await scanner.scan([testDir]);
    expect(result.files.every(f => !f.name.includes('.DS_Store'))).toBe(true);
  });

  it('detects RAW+JPEG pairs', async () => {
    // Create test files: IMG_001.CR2, IMG_001.jpg
    const result = await scanner.scan([testDir]);
    expect(result.rawJpegPairs.get('IMG_001.CR2')).toBe('IMG_001.jpg');
  });
});
```

### Integration Test Examples

```typescript
// test/import-v2.integration.test.ts
describe('Import v2 Pipeline', () => {
  it('imports 10 files successfully', async () => {
    const orchestrator = new ImportOrchestrator(testDb);
    const result = await orchestrator.import({
      paths: [testMediaDir],
      locid: testLocation.locid,
      loc12: testLocation.loc12,
    });

    expect(result.imported).toBe(10);
    expect(result.failed).toBe(0);
  });

  it('resumes after crash', async () => {
    // Start import
    const orchestrator = new ImportOrchestrator(testDb);
    const promise = orchestrator.import(input);

    // Simulate crash during hashing
    await waitForStep(2);
    orchestrator.cancel();

    // Resume
    const newOrchestrator = new ImportOrchestrator(testDb);
    const result = await newOrchestrator.resume(sessionId);

    expect(result.imported).toBeGreaterThan(0);
  });
});
```

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "No workers available" | Pool not started | Call `await pool.start()` before hashing |
| "Worker failed to initialize" | Worker path wrong | Check `workerPath` in WorkerPool constructor |
| "Hash operation timed out" | Large file or slow disk | Increase `taskTimeout` |
| "Import session not found" | Session ID invalid | Check `import_sessions` table |
| "Database is locked" | Concurrent access | Ensure single connection or use WAL mode |

### Debug Logging

```typescript
// Enable verbose logging
process.env.DEBUG = 'import:*';

// Check logs for:
// [Scanner] Found 150 files, 12 sidecars
// [Hasher] Hashing with 7 workers
// [Copier] Using hardlink strategy
// [Validator] Verified 148/150 files
// [Finalizer] Committed 148 records
```

### Inspecting Job Queue

```sql
-- Pending jobs by queue
SELECT queue, COUNT(*) as count
FROM jobs
WHERE status = 'pending'
GROUP BY queue;

-- Failed jobs
SELECT * FROM job_dead_letter
ORDER BY failed_at DESC
LIMIT 10;

-- Stuck jobs (locked too long)
SELECT * FROM jobs
WHERE locked_at IS NOT NULL
AND datetime(locked_at) < datetime('now', '-5 minutes');
```

### Recovery Commands

```typescript
// Clear stuck jobs
await db
  .updateTable('jobs')
  .set({ locked_at: null, locked_by: null })
  .where('locked_at', '<', fiveMinutesAgo)
  .execute();

// Retry all dead letter jobs
const dead = await queue.getDeadLetter();
for (const job of dead) {
  await queue.retryFromDeadLetter(job.id);
}

// Reset failed import session
await db
  .updateTable('import_sessions')
  .set({ status: 'pending', step: 0, error: null })
  .where('id', '=', sessionId)
  .execute();
```

---

## Summary

Import v2 provides a robust, resumable media import pipeline:

1. **Scanner** — Discovers files, sidecars, pairs
2. **Hasher** — Parallel BLAKE3 hashing via worker threads
3. **Copier** — Atomic copy with hardlink/reflink optimization
4. **Validator** — Integrity verification of copied files
5. **Finalizer** — Database commit and background job queue

The system survives crashes, reports progress, and processes thumbnails/metadata in the background without blocking the UI.

---

*Last Updated: 2025-12-05*
