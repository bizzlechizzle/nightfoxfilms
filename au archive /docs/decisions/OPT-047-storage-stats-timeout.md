# OPT-047: Fix Settings Storage Stats IPC Timeout

## Problem

When the Settings page loads, `loadStorageStats()` calls `storage:getStats` which times out after 30 seconds, causing:
1. A beachball/spinner blocking the Settings UI
2. Error: `IPC timeout after 30000ms on channel: storage:getStats`

This violates the **Data Ownership Contract** which states:
> "Settings page lists archive path, disk usage, and detected edition so users always know where data lives."

Users cannot audit their archive if the Settings page freezes.

## Root Cause

**File**: `packages/desktop/electron/main/ipc-handlers/storage.ts:13-38`

The `getDirectorySize()` function recursively walks the entire archive directory, performing a sequential `fs.promises.stat()` call for **every single file**:

```typescript
async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;
  const files = await fs.promises.readdir(dirPath, { withFileTypes: true });

  for (const file of files) {
    const filePath = path.join(dirPath, file.name);
    if (file.isDirectory()) {
      totalSize += await getDirectorySize(filePath);  // Recursive
    } else if (file.isFile()) {
      const stats = await fs.promises.stat(filePath); // SLOW: one syscall per file
      totalSize += stats.size;
    }
  }
  return totalSize;
}
```

**Performance math**: With a large archive:
- 10,000 files × ~3ms per stat = 30+ seconds
- Nested subdirectories add recursive overhead
- Network/external drives make it worse

## Architectural Gap Identified

The **Hashing Contract** requires SHA256 for every imported file, but we never store `file_size`:

> "Every media file's provenance (hash, path, importer, timestamps) is auditable at any time."

File size is part of provenance. Without it:
1. We cannot compute archive size from the database
2. We cannot detect file corruption (size mismatch)
3. We cannot display file sizes in UI without hitting disk

## Solution: Database-Backed File Size Tracking

### Design Principles

1. **Source of truth in database** — Archive size computed from `file_size_bytes` columns in media tables
2. **Auditable at any time** — File sizes stored at import, verifiable against disk
3. **No filesystem traversal on Settings load** — O(1) database query
4. **Integrity verification** — Optional background job to verify sizes match disk

### Implementation Steps

#### Step 1: Add `file_size_bytes` column to media tables (Migration 44)

**File**: `packages/desktop/electron/main/database.ts`

Add to `imgs`, `vids`, `docs`, `maps` tables:
```sql
ALTER TABLE imgs ADD COLUMN file_size_bytes INTEGER;
ALTER TABLE vids ADD COLUMN file_size_bytes INTEGER;
ALTER TABLE docs ADD COLUMN file_size_bytes INTEGER;
ALTER TABLE maps ADD COLUMN file_size_bytes INTEGER;
```

Create indexes for fast aggregation:
```sql
CREATE INDEX IF NOT EXISTS idx_imgs_size ON imgs(file_size_bytes) WHERE file_size_bytes IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vids_size ON vids(file_size_bytes) WHERE file_size_bytes IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docs_size ON docs(file_size_bytes) WHERE file_size_bytes IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_maps_size ON maps(file_size_bytes) WHERE file_size_bytes IS NOT NULL;
```

#### Step 2: Capture file size at import time

**File**: `packages/desktop/electron/services/file-import-service.ts`

After `fs.copyFile()` succeeds (line ~1096), stat the destination and store size:
```typescript
const destStats = await fs.stat(targetPath);
const fileSizeBytes = destStats.size;
// Include in database insert
```

Update repository insert calls to include `file_size_bytes`.

#### Step 3: Replace `getDirectorySize()` with database query

**File**: `packages/desktop/electron/main/ipc-handlers/storage.ts`

Replace filesystem traversal with:
```typescript
const result = await db
  .selectFrom('imgs').select(eb => eb.fn.sum<number>('file_size_bytes').as('total'))
  .unionAll(
    db.selectFrom('vids').select(eb => eb.fn.sum<number>('file_size_bytes').as('total'))
  )
  .unionAll(
    db.selectFrom('docs').select(eb => eb.fn.sum<number>('file_size_bytes').as('total'))
  )
  .unionAll(
    db.selectFrom('maps').select(eb => eb.fn.sum<number>('file_size_bytes').as('total'))
  )
  .execute();

const archiveBytes = result.reduce((sum, row) => sum + (row.total || 0), 0);
```

This is O(1) — instant regardless of archive size.

#### Step 4: Add generated content size tracking

Generated files (thumbnails, previews, proxies) are not in media tables. Track separately:

**Option A**: Store in settings table as cached values
- `generated_thumbnails_bytes`
- `generated_previews_bytes`
- `generated_proxies_bytes`
- `generated_size_updated_at`

**Option B**: Add to `thumbnail_cache` table (if exists)

Update these values incrementally when thumbnails/previews are generated or deleted.

#### Step 5: Add "Recalculate & Verify" for integrity checking

**New IPC channel**: `storage:verifyIntegrity`

Per the Data Ownership contract:
> "Background job (optional) can re-hash random samples and compare against stored SHAs; log any mismatch and surface remediation steps."

This handler:
1. Walks filesystem (slow, but user-initiated)
2. Compares actual file sizes to stored `file_size_bytes`
3. Reports mismatches (possible corruption)
4. Updates any missing `file_size_bytes` values (backfill for existing archives)
5. Updates cached generated content sizes

#### Step 6: Backfill existing archives (one-time migration)

For existing archives with no `file_size_bytes` data:
- Migration 44 adds columns (instant)
- First "Recalculate & Verify" click backfills all values
- Show progress: "Measuring 1,234 of 5,678 files..."

#### Step 7: Update Settings UI

**File**: `packages/desktop/src/pages/Settings.svelte`

Display:
```
Archive Storage
├── Media files:     12.4 GB  (from database)
├── Thumbnails:       1.2 GB  (cached)
├── Previews:         2.1 GB  (cached)
├── Video proxies:    3.4 GB  (cached)
└── Total tracked:   19.1 GB

Disk: 234 GB free of 500 GB

[Verify Integrity] — Last verified: 3 days ago
```

If `file_size_bytes` data is incomplete (NULL values exist):
```
⚠️ Some files not yet measured
[Measure All Files] — Required for accurate totals
```

## Files to Modify

| File | Change |
|------|--------|
| `packages/desktop/electron/main/database.ts` | Migration 44: Add `file_size_bytes` columns + indexes |
| `packages/desktop/electron/main/database.types.ts` | Add `file_size_bytes` to table types |
| `packages/desktop/electron/services/file-import-service.ts` | Capture file size after copy |
| `packages/desktop/electron/repositories/sqlite-media-repository.ts` | Include `file_size_bytes` in inserts |
| `packages/desktop/electron/main/ipc-handlers/storage.ts` | Replace traversal with DB query; add verify handler |
| `packages/desktop/electron/preload/preload.cjs` | Expose `storage.verifyIntegrity()` |
| `packages/desktop/src/pages/Settings.svelte` | Show breakdown; add verify button |

## API Changes

### `storage:getStats` Response (Modified)

```typescript
{
  // Disk info (instant - uses fs.statfs)
  totalBytes: number;
  availableBytes: number;
  drivePath: string;

  // Archive size (instant - from database)
  mediaBytes: number;           // Sum of file_size_bytes from media tables
  thumbnailBytes: number;       // Cached value for .thumbnails/
  previewBytes: number;         // Cached value for .previews/
  proxyBytes: number;           // Cached value for video proxies
  archiveBytes: number;         // Total of above

  // Data quality indicators
  unmeasuredCount: number;      // Files with NULL file_size_bytes
  lastVerifiedAt: string | null; // ISO timestamp of last integrity check
}
```

### `storage:verifyIntegrity` (New)

```typescript
// Request: no params
// Response:
{
  totalFiles: number;
  measuredFiles: number;
  sizeMismatches: Array<{ sha: string; table: string; expected: number; actual: number }>;
  missingFiles: Array<{ sha: string; table: string; path: string }>;
  newMeasurements: number;      // Files that had NULL, now filled
  archiveBytes: number;         // Updated total
  verifiedAt: string;           // ISO timestamp
}

// Progress events: storage:verify:progress
{ processed: number; total: number; currentFile: string }
```

## Success Criteria

- [ ] Settings page loads storage stats in <100ms (was 30+ seconds)
- [ ] No IPC timeout errors
- [ ] `file_size_bytes` captured for all new imports
- [ ] Database query returns accurate archive size
- [ ] "Verify Integrity" can backfill existing archives
- [ ] Size mismatches logged and surfaced to user
- [ ] Generated content (thumbnails, etc.) tracked separately

## Risk Assessment

- **Medium risk**: Schema change (new columns in 4 tables)
- **Migration safe**: ALTER TABLE ADD COLUMN is non-destructive
- **Backwards compatible**: NULL values handled gracefully
- **Existing archives**: Backfill via user-initiated verify

## Alignment with Contracts

| Contract | Requirement | How This Satisfies |
|----------|-------------|-------------------|
| Data Ownership | "Settings page lists archive path, disk usage" | Archive size displayed from DB |
| Data Ownership | "Every media file's provenance... auditable at any time" | `file_size_bytes` is provenance |
| Data Ownership | "Background job can re-hash random samples" | Verify integrity compares sizes |
| Hashing | "Imports remain idempotent" | Size capture doesn't affect idempotency |

## References

- Similar fix: OPT-044/045/046 (removed O(N×M) blocking operations)
- Error: `Settings.svelte:1660 Failed to load storage stats: IPC timeout after 30000ms`
- Contract: `docs/contracts/data-ownership.md` lines 70-72
