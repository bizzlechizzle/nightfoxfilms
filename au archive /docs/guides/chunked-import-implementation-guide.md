# Chunked Import Implementation Guide (OPT-034b)

## Overview

This guide explains the chunked import system implemented to fix IPC timeout errors and memory issues when importing large numbers of files.

**Problem Solved:**
- `IPC timeout after 120000ms on channel: media:import` on large imports (50+ files)
- Potential OOM (Out of Memory) with very large imports (10,000+ files)

**Solution:**
- Dynamic timeout that scales with file count
- Chunked processing that bounds memory per batch

---

## Architecture

### Before (Single IPC Call)
```
Frontend ──[1000 files]──> IPC ──> Main Process ──> [timeout after 2min]
```

### After (Chunked IPC Calls)
```
Frontend ──[50 files]──> IPC ──> Main Process ──> Success
         ──[50 files]──> IPC ──> Main Process ──> Success
         ──[50 files]──> IPC ──> Main Process ──> Success
         ... (20 chunks total)
```

---

## Constants Reference

| Constant | Value | Purpose |
|----------|-------|---------|
| `IMPORT_CHUNK_SIZE` | 50 | Files per IPC call |
| `IMPORT_CHUNK_DELAY` | 100ms | Pause between chunks for GC |
| `IMPORT_BASE_TIMEOUT` | 60,000ms | Base overhead (1 minute) |
| `IMPORT_PER_FILE_TIMEOUT` | 5,000ms | Per-file allowance (5 seconds) |
| `IMPORT_MIN_TIMEOUT` | 120,000ms | Floor (2 minutes) |
| `IMPORT_MAX_TIMEOUT` | 300,000ms | Ceiling (5 minutes) |

---

## File Changes

### 1. `packages/desktop/electron/preload/preload.cjs`

**What changed:**
- Added dynamic timeout constants
- Added `calculateImportTimeout(fileCount)` function
- Modified `media.import` and `media.phaseImport` to use dynamic timeout

**Key code:**
```javascript
// Calculate timeout based on file count
function calculateImportTimeout(fileCount) {
  const calculated = IMPORT_BASE_TIMEOUT + (fileCount * IMPORT_PER_FILE_TIMEOUT);
  return Math.max(IMPORT_MIN_TIMEOUT, Math.min(calculated, IMPORT_MAX_TIMEOUT));
}

// Apply dynamic timeout to import calls
import: (input) => {
  const fileCount = input?.files?.length || 1;
  const timeout = calculateImportTimeout(fileCount);
  return invoke("media:import", timeout)(input);
},
```

**Why CommonJS:** The preload script MUST be pure CommonJS (not ES modules) per `claude.md` rules. Using `function` declarations and `require()` is mandatory.

---

### 2. `packages/desktop/src/pages/Imports.svelte`

**What changed:**
- `importFilePaths()` now chunks files into batches of 50
- Each chunk is a separate IPC call
- Results are aggregated across all chunks
- Progress updates show chunk progress for large imports

**Key code:**
```typescript
// Chunk files into batches
const chunks: string[][] = [];
for (let i = 0; i < filePaths.length; i += IMPORT_CHUNK_SIZE) {
  chunks.push(filePaths.slice(i, i + IMPORT_CHUNK_SIZE));
}

// Process each chunk sequentially
for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
  const chunk = chunks[chunkIdx];

  // IPC call for this chunk only
  const result = await window.electronAPI.media.import({
    files: filesForImport,
    locid: selectedLocation,
    // ... other params
  });

  // Aggregate results
  totalImported += result.imported;
  totalDuplicates += result.duplicates;
  totalErrors += result.errors;

  // Pause between chunks for GC
  if (chunkIdx < chunks.length - 1) {
    await new Promise(resolve => setTimeout(resolve, IMPORT_CHUNK_DELAY));
  }
}
```

---

### 3. `packages/desktop/src/pages/LocationDetail.svelte`

**What changed:**
- Same chunking pattern as Imports.svelte
- Additional handling for GPS warnings and failed files across chunks
- Uses `importStore` for progress tracking

**Key differences from Imports.svelte:**
- Collects `allFailedFiles` and `allGpsWarnings` across chunks
- Shows toast notifications after aggregating all chunk results
- Scrolls to media gallery after successful import

---

## How to Test

### Small Import (< 50 files)
1. Select 10-20 files for import
2. Verify import completes with same behavior as before
3. Progress bar should work normally

### Large Import (100+ files)
1. Select 100+ files for import
2. Verify progress shows "Chunk X/Y" messages
3. Verify import completes without timeout
4. Check final totals match actual files imported

### Partial Failure
1. Include some corrupt/unreadable files in import
2. Verify failed chunk doesn't stop entire import
3. Verify error count is accurate in final summary

---

## Timeout Calculation Examples

| File Count | Formula | Timeout |
|------------|---------|---------|
| 10 | 60s + (10 × 5s) = 110s | 120s (min floor) |
| 50 | 60s + (50 × 5s) = 310s | 300s (max ceiling) |
| 100 | 60s + (100 × 5s) = 560s | 300s (max ceiling) |

Note: Max timeout is 5 minutes per chunk. With 50 files per chunk, a 1000-file import = 20 chunks × 5 min max = 100 minutes theoretical max.

---

## Memory Impact

### Before
- All file metadata loaded into single array
- Single `results` array accumulates all ImportResult objects
- 10,000 files × ~2KB = ~20MB just for results

### After
- Only 50 files in memory at a time
- Results aggregated as counts, not full objects
- Memory bounded regardless of import size

---

## Error Handling

### Chunk-Level Failures
If a chunk fails (network error, IPC timeout):
1. All files in that chunk counted as errors
2. Next chunk continues processing
3. Final summary shows accurate totals

### File-Level Failures
Within each chunk:
1. Individual file errors tracked in `results.errors`
2. Failed files collected in `allFailedFiles` array
3. Retry functionality still works with failed files

---

## Backwards Compatibility

| Scenario | Behavior |
|----------|----------|
| Single file import | Single chunk, 2-min timeout (same as before) |
| 10 file import | Single chunk, 2-min timeout (same as before) |
| 50 file import | Single chunk, ~5-min timeout |
| 100 file import | 2 chunks, ~5-min timeout per chunk |

---

## Related Documentation

- `docs/workflows/import.md` - Import workflow overview
- `docs/optimization/adversarial-audit.md` - ADV-006 (large import memory)
- `docs/optimization/phase6-critical-log.md` - OPT-034 (IPC timeout wrapper)

---

## Changelog

| Date | Change |
|------|--------|
| 2025-12-01 | Initial implementation of OPT-034b chunked imports |
