# OPT-108: Console Flooding Cleanup

## Problem

The developer console is flooded with logging output, making it impossible to see what's happening in the app. There are **614 console statements** across 56 files in the main process, plus 13 in the renderer.

## Audit Findings

### Worst Offenders (by count)

| File | Count | Category |
|------|-------|----------|
| `file-import-service.ts` | 106 | Hot path - logs every step of every file import |
| `database.ts` | 119 | Migrations - mostly one-time (acceptable) |
| `media-processing.ts` | 44 | Per-operation logging |
| `import-v2.ts` | 26 | TRACE-level debug logging left in production |
| `preload.cjs` | 23 | Logs every drop event, every IPC call |
| `preview-extractor-service.ts` | 21 | Per-file logging |
| `phase-import-service.ts` | 15 | Per-phase logging |
| `ref-maps.ts` | 14 | Per-operation logging |
| `worker-pool.ts` | 11 | Worker lifecycle logging |
| `locations.ts` | 11 | Per-operation logging |

### Logger Service (Exists but Underused)

There IS a `LogLevel` enum and `Logger` class in `logger-service.ts`:
- Writes to `~/Library/Application Support/Abandoned Archive/logs/`
- Has `ERROR`, `WARN`, `INFO`, `DEBUG` levels
- `debug()` already checks `NODE_ENV === 'development'` before console output
- **Problem**: Nobody uses it - they all use raw `console.log/warn/error`

## Solution

### Strategy: Redirect, Don't Delete

Instead of deleting logs (losing debugging capability), redirect verbose logs to the Logger service. Debug-level logs only hit console in development mode but always write to log files.

### File-by-File Changes

| File | Action | Details |
|------|--------|---------|
| `import-v2.ts` | **Delete** | All `[TRACE ...]` logs are pure debugging scaffolding |
| `file-import-service.ts` | **Replace with logger.debug()** | Per-step logs become debug level; keep summary as info |
| `preload.cjs` | **Guard with env var** | Wrap startup diagnostics in `if (process.env.DEBUG_PRELOAD)` |
| `worker-pool.ts` | **Delete per-hash logs** | Too granular; keep pool lifecycle logs |
| `media-processing.ts` | **Replace with logger.debug()** | Per-operation logs become debug level |
| `preview-extractor-service.ts` | **Replace with logger.debug()** | Per-file logs become debug level |

### Log Level Guidelines

| Level | When to Use | Console Output |
|-------|-------------|----------------|
| `logger.error()` | Errors with stack traces | Always |
| `logger.warn()` | Recoverable issues | Always |
| `logger.info()` | Batch summaries, user-visible operations | Always |
| `logger.debug()` | Per-file steps, internal state | Development only |

### Batch Summarization Pattern

Instead of:
```
[FileImport] Processing file 1 of 100
[FileImport] Processing file 2 of 100
... (98 more lines)
```

Do:
```
[FileImport] Processing 100 files...
[FileImport] Complete: 98 imported, 2 duplicates (12.3s)
```

## What to KEEP

- Migration logs in `database.ts` - run once at startup, useful for debugging upgrades
- Error logs everywhere - always needed
- Summary logs (batch complete, X imported, Y failed)
- Warning logs for recoverable issues
- Preload startup diagnostics (behind env guard)

## Acceptance Criteria

1. Running `pnpm dev` and importing 10 files produces < 20 console lines (not 100+)
2. Import progress still visible in UI
3. Errors and warnings still appear in console
4. Verbose logs still written to `~/Library/Application Support/Abandoned Archive/logs/`
5. `DEBUG_PRELOAD=1 pnpm dev` shows preload diagnostics when needed
6. `DEBUG_SQL=1 pnpm dev` shows SQL queries when needed

## Implementation Order

1. ✅ Delete TRACE logs from `import-v2.ts` (26 → 1)
2. ✅ Add `DEBUG_PRELOAD` guard to `preload.cjs` (23 → 9)
3. ✅ Delete per-hash logs from `worker-pool.ts` (11 → 1)
4. ✅ Convert `file-import-service.ts` to logger.debug() with batch summaries (106 → 64)
5. ✅ Add `DEBUG_SQL` guard to `database.ts` (was flooding console with ~180 queries/sec from job worker)
6. ⏳ Convert `media-processing.ts` to logger.debug() (44 remaining)
7. ⏳ Convert `preview-extractor-service.ts` to logger.debug() (21 remaining)
8. ⏳ Test import flow, verify console is clean

## Results

### Phase 1 Complete

**Primary Issue Fixed:** SQL query logging from better-sqlite3 verbose mode was flooding console with ~180 queries/second (job worker polling 9 queues every 100ms). Now opt-in via `DEBUG_SQL=1`.

**Console Log Cleanup:**
- Import v2 hot path: 26 → 1 (removed 25 TRACE logs)
- Preload startup: 23 → 9 (guarded with DEBUG_PRELOAD env var)
- Worker pool per-hash: 11 → 1 (removed per-hash logging)
- File import service: 106 → 64 (batch summaries instead of per-step)

**Debug Environment Variables:**
| Variable | Purpose |
|----------|---------|
| `DEBUG_PRELOAD=1` | Show preload bridge diagnostics |
| `DEBUG_SQL=1` | Show all SQL queries (better-sqlite3 verbose mode) |

### Remaining (Phase 2 - Optional)

Low priority since main flooding issue is fixed:
- media-processing.ts: 44 statements
- media-import.ts: 24 statements
- preview-extractor-service.ts: 21 statements
- database.ts: 119 (migrations, acceptable - run once at startup)
