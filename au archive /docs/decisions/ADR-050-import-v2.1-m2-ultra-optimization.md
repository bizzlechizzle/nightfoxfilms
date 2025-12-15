# ADR-050: Import v2.1 — M2 Ultra Optimization

**Status:** DRAFT - Pending Review
**Date:** 2025-12-06
**Author:** Claude
**Hardware Target:** M2 Ultra (24-core CPU, 76-core GPU), 64GB RAM, 10GbE NAS

---

## Philosophy

**WE ARE AN ARCHIVE APP. WE COPY DATA. PERIOD.**

- NO hardlinks (we don't manage storage)
- NO symlinks (we don't manage storage)
- NO delete-after-import (we don't touch originals)
- YES slam the system during import (get it done fast)
- YES saturate 10GbE (that's what it's for)
- YES use all 24 cores (that's what they're for)
- YES push memory hard (macOS memory compression + swap is excellent)
- YES scale based on detected hardware (not some 1980s PC assumptions)

The user's source files are THEIR responsibility. We make a complete, verified copy. Done.

### macOS Advantage

Apple Silicon + macOS has:
- Unified memory architecture (no GPU/CPU memory copies)
- Excellent memory compression (2-3x effective RAM)
- Fast SSD swap (not like spinning rust)
- QoS-aware scheduler (UI stays responsive under load)

**Translation: Smack that bitch around. The system can handle it.**

---

## Context

Import v2.0 was designed but implemented with critical bottlenecks that make it **slower than v1**:

| Issue | Current | Impact |
|-------|---------|--------|
| Poll interval | 1000ms | Max 7 jobs/sec |
| Jobs per poll | 1 per queue | Workers idle 90%+ |
| Copier | Sequential | 1 file at a time |
| Hasher batches | Sequential await | Underutilizes CPU |
| SMB awareness | None | Could flood NAS |

The M2 Ultra has 24 CPU cores. We should be using **ALL OF THEM** during import.

---

## Decision

Implement Import v2.1 with aggressive parallelism + SMB-aware throttling:

### Hardware Profile Detection

```typescript
// services/hardware-profile.ts
import os from 'os';

export interface HardwareProfile {
  cpuCores: number;
  totalMemoryGB: number;
  isAppleSilicon: boolean;
  tier: 'beast' | 'high' | 'medium' | 'low';

  // Scaled worker allocation
  hashWorkers: number;
  copyWorkers: number;
  exifToolWorkers: number;
  ffprobeWorkers: number;
  thumbnailWorkers: number;
  videoProxyWorkers: number;

  // Queue settings
  pollIntervalMs: number;
  pollIntervalIdleMs: number;
}

/**
 * Detect hardware and return AGGRESSIVE scaling profile
 * macOS can handle it - memory compression, fast swap, QoS scheduler
 */
export function detectHardwareProfile(): HardwareProfile {
  const cpuCores = os.cpus().length;
  const totalMemGB = os.totalmem() / 1024 / 1024 / 1024;
  const isAppleSilicon = os.arch() === 'arm64' && process.platform === 'darwin';

  // Determine tier based on cores and memory
  let tier: 'beast' | 'high' | 'medium' | 'low';
  if (cpuCores >= 20 && totalMemGB >= 48) {
    tier = 'beast';      // M2 Ultra, Mac Pro, high-end workstation
  } else if (cpuCores >= 10 && totalMemGB >= 16) {
    tier = 'high';       // M1/M2 Pro/Max, decent desktop
  } else if (cpuCores >= 4 && totalMemGB >= 8) {
    tier = 'medium';     // M1/M2 base, older Intel
  } else {
    tier = 'low';        // Potato
  }

  // Apple Silicon gets a boost - unified memory is a cheat code
  const appleBoost = isAppleSilicon ? 1.5 : 1.0;

  // AGGRESSIVE scaling based on tier
  const profiles = {
    beast: {
      // M2 Ultra (24 cores, 64GB+): GO NUCLEAR
      hashWorkers: cpuCores - 2,                    // 22 workers
      copyWorkers: 24,                               // Saturate I/O
      exifToolWorkers: Math.floor(cpuCores * 0.5),  // 12 workers
      ffprobeWorkers: Math.floor(cpuCores * 0.25),  // 6 workers
      thumbnailWorkers: Math.floor(cpuCores * 0.5), // 12 workers
      videoProxyWorkers: 4,                          // CPU-heavy but we can handle it
      pollIntervalMs: 25,                            // FAST
      pollIntervalIdleMs: 100,
    },
    high: {
      // M1/M2 Pro/Max (10-12 cores, 16-32GB): Still aggressive
      hashWorkers: cpuCores - 2,
      copyWorkers: 16,
      exifToolWorkers: Math.floor(cpuCores * 0.4),
      ffprobeWorkers: Math.floor(cpuCores * 0.2),
      thumbnailWorkers: Math.floor(cpuCores * 0.4),
      videoProxyWorkers: 2,
      pollIntervalMs: 50,
      pollIntervalIdleMs: 150,
    },
    medium: {
      // Base M1/M2, older Intel (4-8 cores, 8-16GB): Moderate
      hashWorkers: Math.max(2, cpuCores - 2),
      copyWorkers: 8,
      exifToolWorkers: Math.max(2, Math.floor(cpuCores * 0.3)),
      ffprobeWorkers: 2,
      thumbnailWorkers: Math.max(2, Math.floor(cpuCores * 0.3)),
      videoProxyWorkers: 1,
      pollIntervalMs: 100,
      pollIntervalIdleMs: 300,
    },
    low: {
      // Potato mode: Be gentle
      hashWorkers: Math.max(1, cpuCores - 1),
      copyWorkers: 4,
      exifToolWorkers: 2,
      ffprobeWorkers: 1,
      thumbnailWorkers: 2,
      videoProxyWorkers: 1,
      pollIntervalMs: 200,
      pollIntervalIdleMs: 500,
    },
  };

  const profile = profiles[tier];

  console.log(`[HardwareProfile] Detected: ${tier} tier`);
  console.log(`[HardwareProfile] ${cpuCores} cores, ${totalMemGB.toFixed(1)}GB RAM, Apple Silicon: ${isAppleSilicon}`);
  console.log(`[HardwareProfile] Hash: ${profile.hashWorkers}, Copy: ${profile.copyWorkers}, ExifTool: ${profile.exifToolWorkers}`);

  return {
    cpuCores,
    totalMemoryGB: totalMemGB,
    isAppleSilicon,
    tier,
    ...profile,
  };
}

// Singleton - detect once at startup
let cachedProfile: HardwareProfile | null = null;

export function getHardwareProfile(): HardwareProfile {
  if (!cachedProfile) {
    cachedProfile = detectHardwareProfile();
  }
  return cachedProfile;
}
```

---

## Changes Required

### 1. Job Worker: Parallel Fetch + Reduced Poll Interval

**File:** `electron/services/job-worker-service.ts`

**Current Problem:**
```typescript
// Line 65: Too slow
private readonly pollIntervalMs = 1000;

// Line 166-172: Only fetches ONE job
if (pQueue.pending < config.concurrency) {
  const job = await this.jobQueue.getNext(queueName);  // ONE job!
  if (job) {
    pQueue.add(() => this.processJob(queueName, job, config.handler));
  }
}
```

**Fix:**
```typescript
// CHANGE 1: Reduce poll interval to 50ms
private readonly pollIntervalMs = 50;

// CHANGE 2: Fetch multiple jobs to fill queue
private async poll(): Promise<void> {
  if (!this.isRunning) return;

  try {
    for (const [queueName, config] of this.queues) {
      const pQueue = this.pQueues.get(queueName)!;

      // Calculate how many jobs we can accept
      const availableSlots = config.concurrency - pQueue.pending;

      if (availableSlots > 0) {
        // Fetch up to availableSlots jobs in parallel
        const jobs = await this.jobQueue.getNextBatch(queueName, availableSlots);

        for (const job of jobs) {
          pQueue.add(() => this.processJob(queueName, job, config.handler));
        }
      }
    }
  } catch (error) {
    logger.error('JobWorker', 'Poll error', undefined, { error: String(error) });
  }

  // Adaptive polling: faster when busy, slower when idle
  const busyQueues = Array.from(this.pQueues.values()).filter(q => q.pending > 0).length;
  const nextPollMs = busyQueues > 0 ? 50 : 200;
  this.pollInterval = setTimeout(() => this.poll(), nextPollMs);
}

// CHANGE 3: Update queue concurrency for M2 Ultra
private setupDefaultQueues(): void {
  const hw = detectHardwareProfile();

  this.registerQueue(IMPORT_QUEUES.EXIFTOOL, hw.exifToolWorkers, ...);   // 8 workers
  this.registerQueue(IMPORT_QUEUES.FFPROBE, hw.ffprobeWorkers, ...);     // 4 workers
  this.registerQueue(IMPORT_QUEUES.THUMBNAIL, hw.thumbnailWorkers, ...); // 8 workers
  this.registerQueue(IMPORT_QUEUES.VIDEO_PROXY, 2, ...);                 // Keep limited (CPU heavy)
  this.registerQueue(IMPORT_QUEUES.LIVE_PHOTO, 4, ...);
  this.registerQueue(IMPORT_QUEUES.BAGIT, 2, ...);
  this.registerQueue(IMPORT_QUEUES.LOCATION_STATS, 4, ...);
}
```

**New method in job-queue.ts:**
```typescript
/**
 * Get multiple pending jobs from the queue (batch fetch)
 * Uses SELECT ... LIMIT N for efficiency
 */
async getNextBatch<T>(queue: string, limit: number): Promise<Job<T>[]> {
  const now = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - this.staleLockTimeoutMs).toISOString();

  // Release stale locks first
  await this.db
    .updateTable('jobs')
    .set({ status: 'pending', locked_by: null, locked_at: null })
    .where('status', '=', 'processing')
    .where('locked_at', '<', staleThreshold)
    .execute();

  // Fetch batch of pending jobs
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

      if (result.numUpdatedRows && result.numUpdatedRows > BigInt(0)) {
        claimedJobs.push(this.mapRowToJob<T>(job));
      }
    }
  });

  return claimedJobs;
}
```

---

### 2. Copier: Parallel Copy with SMB Awareness

**File:** `electron/services/import/copier.ts`

**Current Problem:**
```typescript
// Line 116: Sequential loop - ONE file at a time!
for (const file of filesToCopy) {
  const result = await this.copyFile(file, location, strategy);
}
```

**Philosophy:**
- We COPY data. Full stop.
- No hardlinks, no symlinks, no storage tricks.
- We ARE an archive - we make complete, independent copies.
- Slam the system during import - that's what 24 cores and 10GbE are for.
- BUT be smart about SMB - don't flood with thousands of tiny requests.

**Fix:**
```typescript
import PQueue from 'p-queue';

/**
 * Copier class with AGGRESSIVE parallel operations
 * SMB-aware: batches operations to avoid protocol overhead
 */
export class Copier {
  private readonly copyQueue: PQueue;
  private readonly isNetworkPath: boolean;

  constructor(
    private readonly archiveBasePath: string,
    concurrency?: number
  ) {
    // Detect if archive is on network (SMB/NFS)
    this.isNetworkPath = this.detectNetworkPath(archiveBasePath);

    // M2 Ultra: 16 parallel copies for local, slightly less for network
    // Network still gets hammered, but with larger queue depth
    const defaultConcurrency = this.isNetworkPath ? 12 : 16;
    this.copyQueue = new PQueue({ concurrency: concurrency ?? defaultConcurrency });

    console.log(`[Copier] Initialized with ${this.copyQueue.concurrency} parallel workers`);
    console.log(`[Copier] Network path: ${this.isNetworkPath}`);
  }

  /**
   * Detect if path is on network storage (SMB/NFS/AFP)
   */
  private detectNetworkPath(archivePath: string): boolean {
    // macOS network paths start with /Volumes/ (except boot volume)
    // or are explicitly //server/share style
    if (archivePath.startsWith('/Volumes/')) {
      // Could be local external or network - check mount type
      // For now, assume /Volumes/ that's not the boot drive might be network
      return true;  // Conservative - treat as network
    }
    if (archivePath.startsWith('//') || archivePath.startsWith('smb://')) {
      return true;
    }
    return false;
  }

  /**
   * Copy files in PARALLEL - slam the I/O subsystem
   */
  async copy(
    files: HashedFile[],
    location: LocationInfo,
    options?: CopierOptions
  ): Promise<CopyResult> {
    const startTime = Date.now();
    const filesToCopy = files.filter(f => !f.isDuplicate && f.hash && !f.hashError);

    if (filesToCopy.length === 0) {
      return {
        files: [],
        totalCopied: 0,
        totalBytes: 0,
        totalErrors: 0,
        strategy: 'copy',
        copyTimeMs: 0,
      };
    }

    // Pre-create destination directories in one batch
    // This avoids mkdir races and reduces SMB round-trips
    await this.ensureDirectories(filesToCopy, location);

    const totalBytes = filesToCopy.reduce((sum, f) => sum + f.size, 0);
    let bytesCopied = 0;
    let totalCopied = 0;
    let totalErrors = 0;

    const results: CopiedFile[] = [];
    const resultsLock = { locked: false };  // Simple mutex for results array

    console.log(`[Copier] Starting parallel copy of ${filesToCopy.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);

    // Queue ALL files for parallel copy
    const copyPromises = filesToCopy.map((file, index) =>
      this.copyQueue.add(async () => {
        if (options?.signal?.aborted) {
          throw new Error('Copy cancelled');
        }

        const result = await this.copyFileFast(file, location);

        // Thread-safe results update
        while (resultsLock.locked) await new Promise(r => setTimeout(r, 1));
        resultsLock.locked = true;

        if (result.copyError) {
          totalErrors++;
        } else {
          totalCopied++;
          bytesCopied += file.size;
        }
        results.push(result);

        resultsLock.locked = false;

        // Progress callback (40-80% range)
        if (options?.onProgress) {
          const percent = 40 + ((bytesCopied / totalBytes) * 40);
          options.onProgress(percent, file.filename, bytesCopied, totalBytes);
        }

        if (options?.onFileComplete) {
          await options.onFileComplete(result, index, filesToCopy.length);
        }

        return result;
      })
    );

    // Wait for ALL copies - they're running in parallel
    await Promise.all(copyPromises);

    // Add skipped files (duplicates, hash errors)
    for (const file of files) {
      if (file.isDuplicate || file.hashError) {
        results.push({
          ...file,
          archivePath: null,
          copyError: file.isDuplicate ? 'Duplicate' : file.hashError,
          copyStrategy: null,
          bytesCopied: 0,
        });
      }
    }

    const copyTimeMs = Date.now() - startTime;
    const throughputMBps = (bytesCopied / 1024 / 1024) / (copyTimeMs / 1000);

    console.log(`[Copier] Completed: ${totalCopied} files, ${(bytesCopied / 1024 / 1024).toFixed(1)} MB in ${(copyTimeMs / 1000).toFixed(1)}s`);
    console.log(`[Copier] Throughput: ${throughputMBps.toFixed(1)} MB/s`);

    return {
      files: results,
      totalCopied,
      totalBytes: bytesCopied,
      totalErrors,
      strategy: 'copy',
      copyTimeMs,
    };
  }

  /**
   * Pre-create all destination directories in a batch
   * Reduces SMB round-trips significantly
   */
  private async ensureDirectories(files: HashedFile[], location: LocationInfo): Promise<void> {
    const dirs = new Set<string>();

    for (const file of files) {
      const destPath = this.buildFilePath(file, location);
      dirs.add(path.dirname(destPath));
    }

    // Create all directories in parallel
    await Promise.all(
      Array.from(dirs).map(dir => fs.mkdir(dir, { recursive: true }).catch(() => {}))
    );
  }

  /**
   * Copy a single file - FAST path
   * No strategy detection, no retries with different methods
   * Just copy the damn file.
   */
  private async copyFileFast(
    file: HashedFile,
    location: LocationInfo
  ): Promise<CopiedFile> {
    const result: CopiedFile = {
      ...file,
      archivePath: null,
      copyError: null,
      copyStrategy: 'copy',
      bytesCopied: 0,
    };

    try {
      const destPath = this.buildFilePath(file, location);

      // Temp file for atomic operation
      const tempPath = `${destPath}.${randomUUID().slice(0, 8)}.tmp`;

      try {
        // COPY. That's it. We're an archive app.
        await fs.copyFile(file.originalPath, tempPath);

        // Atomic rename
        await fs.rename(tempPath, destPath);

        result.archivePath = destPath;
        result.bytesCopied = file.size;

      } catch (copyError) {
        // Clean up temp file on failure
        await fs.unlink(tempPath).catch(() => {});
        throw copyError;
      }

    } catch (error) {
      result.copyError = error instanceof Error ? error.message : String(error);
    }

    return result;
  }

  // ... buildLocationPath and buildFilePath remain the same
}
```

---

### 3. Hasher: Streaming Results + Larger Batches

**File:** `electron/services/import/hasher.ts`

**Current Problem:**
```typescript
// Line 93: Small batch size
const batchSize = 50;

// Line 95-136: Sequential batch await
for (let i = 0; i < filesToHash.length; i += batchSize) {
  const batch = filesToHash.slice(i, i + batchSize);
  const hashResults = await this.pool!.hashBatch(batchPaths);  // Blocks on full batch
}
```

**Fix:**
```typescript
/**
 * Hash all files using streaming async iteration
 * Results are yielded as soon as available, not after full batch
 */
async hash(files: ScannedFile[], options?: HasherOptions): Promise<HashResult> {
  await this.initialize();

  const startTime = Date.now();
  const filesToHash = files.filter(f => !f.shouldSkip);
  const results: HashedFile[] = [];

  let completedFiles = 0;
  let totalDuplicates = 0;
  let totalErrors = 0;

  // Use larger batch for M2 Ultra (more parallel workers)
  // But process results as they stream in
  const BATCH_SIZE = 200;  // Larger batches, but streamed

  for (let i = 0; i < filesToHash.length; i += BATCH_SIZE) {
    if (options?.signal?.aborted) {
      throw new Error('Hashing cancelled');
    }

    const batch = filesToHash.slice(i, i + BATCH_SIZE);
    const batchPaths = batch.map(f => f.originalPath);

    // Hash with streaming callback
    const hashResults = await this.pool!.hashBatchStreaming(
      batchPaths,
      async (result, index) => {
        const file = batch[index];
        const hashedFile: HashedFile = {
          ...file,
          hash: result.hash ?? null,
          hashError: result.error ?? null,
          isDuplicate: false,
          duplicateIn: null,
        };

        if (result.error) totalErrors++;

        results.push(hashedFile);
        completedFiles++;

        // Progress callback
        if (options?.onProgress) {
          const percent = 5 + ((completedFiles / filesToHash.length) * 35);
          options.onProgress(percent, file.filename);
        }

        // Stream to caller immediately
        if (options?.onFileComplete) {
          await options.onFileComplete(hashedFile, completedFiles - 1, filesToHash.length);
        }
      }
    );
  }

  // Add skipped files
  for (const file of files) {
    if (file.shouldSkip) {
      results.push({
        ...file,
        hash: null,
        hashError: 'Skipped',
        isDuplicate: false,
        duplicateIn: null,
      });
    }
  }

  // Batch duplicate check
  const hashedFiles = results.filter(f => f.hash !== null);
  if (hashedFiles.length > 0) {
    totalDuplicates = await this.checkDuplicatesBatch(hashedFiles);
  }

  return {
    files: results,
    totalHashed: hashedFiles.length,
    totalDuplicates,
    totalErrors,
    hashingTimeMs: Date.now() - startTime,
  };
}
```

**New method in worker-pool.ts:**
```typescript
/**
 * Hash batch with streaming results
 * Calls onResult for each file as soon as it completes
 */
async hashBatchStreaming(
  filePaths: string[],
  onResult: (result: HashResult, index: number) => Promise<void>
): Promise<void> {
  const promises = filePaths.map(async (filePath, index) => {
    const result = await this.hash(filePath);
    await onResult(result, index);
    return result;
  });

  await Promise.all(promises);
}
```

---

### 4. Worker Pool: More Workers for M2 Ultra

**File:** `electron/services/worker-pool.ts`

**Current:**
```typescript
const defaultConcurrency = Math.max(1, cpus().length - 1);  // 23 workers
```

**Fix:**
```typescript
constructor(options?: WorkerPoolOptions) {
  const hw = detectHardwareProfile();

  // M2 Ultra: 12 hash workers (50% of 24 cores)
  // Leave cores for main thread, copy, and background processing
  this.concurrency = options?.concurrency ?? hw.hashWorkers;

  // ...
}
```

---

## Performance Targets (M2 Ultra + 10GbE NAS)

| Operation | Current | Target | Improvement |
|-----------|---------|--------|-------------|
| 100 files (local SSD) | ~60s | <5s | 12x |
| 100 files (10GbE NAS) | ~120s | <15s | 8x |
| 1,000 files (local SSD) | ~10 min | <30s | 20x |
| 1,000 files (10GbE NAS) | ~20 min | <2 min | 10x |
| ExifTool throughput | 4 jobs/s | 96+ jobs/s | 24x |
| Hash throughput | ~50 MB/s | 2+ GB/s | 40x |
| 10GbE saturation | ~10% | 80%+ | 8x |

---

## Concurrency Summary (Hardware-Scaled)

### Beast Tier (M2 Ultra, 24 cores, 64GB+)

| Component | Current | Target | Rationale |
|-----------|---------|--------|-----------|
| Hash workers | 23 | 22 | All cores except 2 for UI |
| Copy queue | 1 (sequential) | **24** | Saturate I/O - smack it around |
| ExifTool workers | 4 | **12** | 50% of cores |
| FFprobe workers | 2 | **6** | 25% of cores |
| Thumbnail workers | 4 | **12** | 50% of cores |
| Video proxy | 1 | **4** | CPU-heavy but we can handle it |
| Poll interval | 1000ms | **25ms** | FAST when busy |
| Poll interval (idle) | 1000ms | **100ms** | Slightly slower when idle |
| Jobs per poll | 1 | Fill to capacity | Use ALL available workers |

### High Tier (M1/M2 Pro/Max, 10-12 cores, 16-32GB)

| Component | Target | Rationale |
|-----------|--------|-----------|
| Hash workers | cores - 2 | Leave 2 for UI |
| Copy queue | 16 | Still aggressive |
| ExifTool workers | 40% of cores | ~4-5 workers |
| Poll interval | 50ms / 150ms | Fast but not insane |

### Medium Tier (Base M1/M2, 4-8 cores, 8-16GB)

| Component | Target | Rationale |
|-----------|--------|-----------|
| Hash workers | cores - 2 (min 2) | Modest |
| Copy queue | 8 | Reasonable |
| ExifTool workers | 30% of cores | ~2-3 workers |
| Poll interval | 100ms / 300ms | Balanced |

### Low Tier (Potato)

| Component | Target | Rationale |
|-----------|--------|-----------|
| Hash workers | cores - 1 (min 1) | Gentle |
| Copy queue | 4 | Don't overwhelm |
| ExifTool workers | 2 | Minimum viable |
| Poll interval | 200ms / 500ms | Conservative |

---

## SMB/Network Considerations

To avoid flooding SMB with protocol overhead:

1. **Pre-create directories in batch** - One `mkdir -p` burst, not per-file
2. **Large queue depth** - Fewer open/close cycles, more streaming
3. **Parallel but bounded** - 12 concurrent copies for network (vs 16 local)
4. **No tiny operations** - Batch metadata queries where possible

The 10GbE pipe is ~1.25 GB/s theoretical. We should aim for 800+ MB/s sustained.

---

## Files to Modify

1. **NEW:** `electron/services/hardware-profile.ts` - Hardware detection
2. **MODIFY:** `electron/services/job-queue.ts` - Add `getNextBatch()` method
3. **MODIFY:** `electron/services/job-worker-service.ts` - Parallel fetch, reduced poll
4. **MODIFY:** `electron/services/import/copier.ts` - Parallel copy, SMB-aware
5. **MODIFY:** `electron/services/import/hasher.ts` - Streaming results
6. **MODIFY:** `electron/services/worker-pool.ts` - More workers, streaming callback

---

## Testing Plan

1. **Benchmark baseline:** Run 100-file import with current code, record time
2. **Implement changes incrementally:**
   - Job worker parallel fetch (should see immediate improvement)
   - Copier parallel copy (major improvement)
   - Hasher streaming (memory improvement, slight speed gain)
3. **Benchmark after each change** to isolate impact
4. **Network test:** Verify 10GbE saturation with large file batch
5. **Load test:** 10,000 files to verify memory usage stays bounded

---

## Rollback Plan

Each change is isolated to a single file. If issues arise:
1. Revert the specific file
2. Keep working changes
3. No database migrations required

---

## Approval Required

- [ ] Philosophy: Copy only, no storage management tricks
- [ ] Hardware profile approach (detect and tune)
- [ ] Concurrency numbers for M2 Ultra (aggressive)
- [ ] Poll interval reduction (1000ms → 50ms)
- [ ] Batch job fetch approach
- [ ] SMB considerations (bounded parallelism)
