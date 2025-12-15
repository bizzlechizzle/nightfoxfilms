# SMB-Optimized Import Workflow

**Version:** 2.2
**ADR:** ADR-046-smb-optimized-import
**Updated:** 2025-12-09

---

## Overview

This document describes the SMB-optimized import pipeline that reduces network I/O by 50% and prevents SMB connection crashes during large imports.

---

## Problem Statement

When importing files over SMB (Server Message Block) network connections:

1. **Double-read problem**: The original pipeline reads every file twice:
   - Step 2 (Hash): Read file from network to compute BLAKE3 hash
   - Step 3 (Copy): Read file from network again to copy to archive

2. **Concurrency overwhelm**: SMB protocol has limited concurrent operation capacity (~4-6 operations) regardless of bandwidth. The original pipeline used up to 22 concurrent operations.

3. **Result**: 35GB imports caused 70GB of network reads with 22 concurrent operations, crashing SMB connections on 10GbE networks.

---

## Solution: Inline Hashing

The optimized pipeline detects network sources and computes the BLAKE3 hash **during** the streaming copy operation:

```
BEFORE: Source → [Hash Worker] → Source → [Copier] → Dest
AFTER:  Source → [Stream + Hash] → Dest (SINGLE READ)
```

---

## Architecture

### Network Detection

All three components (Orchestrator, Copier, Validator) detect network paths using the same logic:

```typescript
private detectNetworkPath(path: string): boolean {
  // macOS mounted volumes
  if (path.startsWith('/Volumes/')) {
    const volumeName = path.split('/')[2] || '';
    // Exclude known local volumes
    if (volumeName === 'Macintosh HD' ||
        volumeName.includes('SSD') ||
        volumeName.includes('Internal')) {
      return false;
    }
    return true;
  }
  // Explicit network paths
  if (path.startsWith('//') ||
      path.startsWith('smb://') ||
      path.startsWith('nfs://')) {
    return true;
  }
  return false;
}
```

### Pipeline Flows

**Local Source (Traditional):**
```
Step 1: Scan          → Collect file metadata
Step 2: Hash          → Parallel BLAKE3 (22 workers)
Step 3: Copy          → Parallel copy (24 workers)
Step 4: Validate      → Re-hash destination (22 workers)
Step 5: Finalize      → DB insert, queue metadata jobs
```

**Network Source (Optimized):**
```
Step 1: Scan          → Collect file metadata
Step 2: SKIP          → Hash computed inline during copy
Step 3: Copy+Hash     → Streaming copy with inline BLAKE3 (4 workers)
Step 3b: Dedup        → Check DB, delete duplicate copies
Step 4: Validate      → Re-hash destination (4 workers)
Step 5: Finalize      → DB insert, queue metadata jobs
```

---

## Implementation Details

### 1. Orchestrator (orchestrator.ts)

**Network detection:**
```typescript
const isNetworkSource = this.detectNetworkSource(paths);
```

**Skip hash step for network sources:**
```typescript
if (isNetworkSource) {
  // Create files with null hash - computed during copy
  hashResult = {
    files: scanResult.files.map(f => ({
      ...f,
      hash: null,  // <-- Key: null hash triggers inline mode
      hashError: null,
      isDuplicate: false,
      duplicateIn: null,
    })),
    totalHashed: 0,
    totalDuplicates: 0,
    totalErrors: 0,
    hashingTimeMs: 0,
  };
}
```

**Post-copy duplicate detection:**
```typescript
if (isNetworkSource) {
  const duplicatesRemoved = await this.detectAndRemoveDuplicatesPostCopy(
    copyResult,
    sessionId
  );
}
```

### 2. Copier (copier.ts)

**Inline hashing mode detection:**
```typescript
// In copyFileFast()
const useInlineHash = file.hash === null;

if (useInlineHash) {
  // Stream copy with hash computation
  const streamResult = await this.copyFileStreaming(
    file.originalPath,
    tempPath
  );
  finalHash = streamResult.hash;
  bytesCopied = streamResult.bytesCopied;
} else {
  // Traditional copy (hash already computed)
  await fs.copyFile(file.originalPath, tempPath);
  finalHash = file.hash!;
  bytesCopied = file.size;
}
```

**Streaming copy with inline hash:**
```typescript
private async copyFileStreaming(
  sourcePath: string,
  tempPath: string
): Promise<{ hash: string; bytesCopied: number }> {
  const hasher = createBlake3Hash();
  let bytesCopied = 0;

  const source = createReadStream(sourcePath);
  const dest = createWriteStream(tempPath);

  // Hash bytes as they stream through
  source.on('data', (chunk: Buffer) => {
    hasher.update(chunk);
    bytesCopied += chunk.length;
  });

  // Pipeline handles backpressure
  await pipeline(source, dest);

  const hash = hasher.digest('hex').substring(0, HASH_LENGTH);
  return { hash, bytesCopied };
}
```

### 3. Validator (validator.ts)

**SMB-aware concurrency:**
```typescript
const isNetworkArchive = this.detectNetworkPath(filesToValidate[0].archivePath!);
const hw = getHardwareProfile();

// Use throttled concurrency for network archives
const concurrency = isNetworkArchive
  ? hw.copyWorkersNetwork  // 4 workers
  : hw.hashWorkers;        // 22 workers

const queue = new PQueue({ concurrency });
```

---

## Concurrency Settings

Defined in `hardware-profile.ts`:

| Tier | Local Copy | Network Copy | Local Hash | Network Validate |
|------|------------|--------------|------------|------------------|
| Beast | 24 | 4 | 22 | 4 |
| High | 16 | 4 | 10 | 4 |
| Medium | 8 | 3 | 4 | 3 |
| Low | 4 | 2 | 2 | 2 |

---

## Error Handling

### Retry with Exponential Backoff

Network operations automatically retry on transient errors:

```typescript
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 5000]; // ms
const RETRYABLE_ERRORS = [
  'EAGAIN',      // Resource temporarily unavailable
  'ECONNRESET',  // Connection reset
  'ETIMEDOUT',   // Connection timed out
  'EBUSY',       // Resource busy
  'EIO',         // I/O error
  'ENETUNREACH', // Network unreachable
  'EPIPE'        // Broken pipe
];
```

### Validation Rollback

If a copied file fails hash verification:

1. Validator detects mismatch
2. File is automatically deleted (rollback)
3. Error logged with details
4. Import continues with remaining files

---

## Integrity Guarantees

Per NDSA and Library of Congress standards:

| Requirement | Implementation |
|-------------|----------------|
| Fixity on ingest | BLAKE3 hash computed during copy stream |
| Verify after transfer | Validator re-hashes destination file |
| Hash as identifier | Files named by hash, stored as primary key |
| Mismatch handling | Invalid files automatically deleted |
| Audit trail | Metrics, traces, and logs for all operations |

---

## Duplicate Handling

### Local Source (Pre-hash)
- Duplicates detected before copy
- Duplicate files skipped (no wasted I/O)

### Network Source (Post-copy)
- Files copied first (hash unknown)
- Hash computed during copy
- DB checked for existing hash
- Duplicate files deleted after copy

**Tradeoff**: Network mode wastes one write for duplicates, but saves one full network read for every file. Net positive for large imports.

---

## Monitoring

### Metrics Emitted

```typescript
// Import started
metrics.incrementCounter(MetricNames.IMPORT_STARTED, 1);

// Files scanned
metrics.incrementCounter(MetricNames.IMPORT_FILES_SCANNED, count);

// Duplicates found
metrics.incrementCounter(MetricNames.IMPORT_FILES_DUPLICATES, count);

// Bytes processed
metrics.incrementCounter(MetricNames.IMPORT_BYTES_PROCESSED, bytes);

// Duration histogram
metrics.histogram(MetricNames.IMPORT_DURATION, durationMs);

// Throughput gauge
metrics.gauge(MetricNames.IMPORT_THROUGHPUT_MBPS, mbps);
```

### Log Messages

Key log messages to monitor:

```
[Orchestrator] Network source detected - using inline hashing (skip Step 2)
[Copier] Network SOURCE detected - using inline hashing (single read per file)
[Copier] Starting parallel copy: 1000 files, 35000.0 MB, 4 workers
[Copier] Network error ETIMEDOUT on file.jpg, retry 1/3 after 1000ms
[Validator] Starting validation: 1000 files, 4 workers (network: true)
```

---

## Testing Scenarios

| Scenario | Source | Dest | Expected Behavior |
|----------|--------|------|-------------------|
| Local → Local | Local SSD | Local SSD | Full parallelism, pre-hash |
| Local → SMB | Local SSD | SMB share | Throttled copy, full hash |
| SMB → Local | SMB share | Local SSD | Inline hash, full validate |
| SMB → SMB | SMB share | SMB share | Inline hash, throttled all |

---

## Troubleshooting

### Import Still Slow

1. Check network detection logs:
   ```
   [Copier] Initialized: X parallel workers, network dest: true/false
   ```

2. Verify concurrency:
   ```
   [Copier] Starting parallel copy: X files, Y MB, Z workers
   ```

3. Check for retries:
   ```
   [Copier] Network error ETIMEDOUT on file.jpg, retry 1/3
   ```

### Hash Mismatches

If validation reports hash mismatches:

1. Check source file stability (not being modified during import)
2. Check network reliability (packet loss, disconnections)
3. Check disk health on destination
4. Invalid files are automatically deleted - check logs

### SMB Still Crashing

If SMB connections still drop:

1. Reduce `copyWorkersNetwork` in hardware-profile.ts
2. Check SMB server configuration (max connections)
3. Check network switch/router settings
4. Consider adding delay between file operations

---

## References

- [ADR-046: SMB-Optimized Import](../decisions/ADR-046-smb-optimized-import.md)
- [Hashing Contract](../contracts/hashing.md)
- [Data Ownership Contract](../contracts/data-ownership.md)
- [Import Workflow](./import.md)
