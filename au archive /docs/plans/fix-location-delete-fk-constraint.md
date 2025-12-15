# PLAN: Fix Location Delete Foreign Key Constraint Failure

**Issue ID:** OPT-036
**Date:** 2025-12-01
**Status:** IMPLEMENTED
**Revision:** 2 (Performance optimized)
**Implemented:** 2025-12-01

## Problem Statement

Deleting a location fails with:
```
SqliteError: FOREIGN KEY constraint failed
```

This occurs because the media tables (`imgs`, `vids`, `docs`, `maps`) have foreign key references to `locs(locid)` but are **missing `ON DELETE CASCADE`**.

### Current Schema (Problem)

```sql
-- In database.ts SCHEMA_SQL (lines 102, 132, 164, 188):
locid TEXT REFERENCES locs(locid),  -- NO CASCADE!
```

When a location is deleted, SQLite blocks it because child media records still reference the parent.

### Expected Behavior

Per user statement: "This is absolutely supposed to delete files on the disk."

## Root Cause Analysis

1. **Schema Definition** (`database.ts:102-188`): Core media tables created without `ON DELETE CASCADE`
2. **Migration Gap**: SQLite cannot alter constraints on existing tables without table rebuild
3. **Repository Method** (`sqlite-location-repository.ts:413-445`): Simple `DELETE FROM locs` with no cascade handling

## Gaps Identified in Original Plan

| Gap | Description | Resolution |
|-----|-------------|------------|
| BagIt Archive | `_archive/` folder not deleted | Delete entire location folder |
| Video Proxies | `.cache/video-proxies/` files orphaned | Delete proxy files by vidsha |
| Thumbnails | Global `.thumbnails/` bucketed by hash | Delete by hash after collecting SHAs |
| Previews | Global `.previews/` bucketed by hash | Delete by hash after collecting SHAs |
| Posters | Global `.posters/` bucketed by hash | Delete by hash after collecting SHAs |
| Sub-location Media | Media with `subid` FK might be missed | Query by locid covers all (slocs CASCADE to locs) |
| Ref Map Links | `linked_locid` in ref_map_points | Already `ON DELETE SET NULL` ✓ |

## Performance Optimizations

| Original Approach | Optimized Approach | Impact |
|-------------------|-------------------|--------|
| Query imgs, vids, docs separately (3 queries) | Single UNION query for all SHAs | 3x fewer round-trips |
| Delete files one-by-one O(n) | Delete location folder recursively O(1) | Massive speedup for large locations |
| Sync file deletion blocks UI | Background file cleanup after DB commit | Instant UI response |
| Query all thumbnail paths from DB | Derive paths from SHA + MediaPathService | No extra DB queries |

## Architecture: File Storage Layout

```
[archivePath]/
├── locations/                           # Per-location folders
│   └── NY-Hospital/
│       └── StPeters-abc123def456/       # Location folder (DELETE THIS)
│           ├── org-img-abc123def456/    # Original images
│           ├── org-vid-abc123def456/    # Original videos
│           ├── org-doc-abc123def456/    # Original documents
│           └── _archive/                # BagIt self-documenting archive
│
├── .thumbnails/                         # Global, hash-bucketed
│   └── a3/
│       ├── a3d5e8f9..._400.jpg         # Need to delete by SHA
│       ├── a3d5e8f9..._800.jpg
│       └── a3d5e8f9..._1920.jpg
│
├── .previews/                           # Global, hash-bucketed (RAW files)
│   └── a3/
│       └── a3d5e8f9....jpg
│
├── .posters/                            # Global, hash-bucketed (video frames)
│   └── b7/
│       └── b7c4a2e1....jpg
│
└── .cache/
    └── video-proxies/                   # Optimized video files
        └── b7c4a2e1....mp4
```

## Implementation Plan

### Step 1: Add Migration 43 - Rebuild Media Tables with CASCADE

**File:** `packages/desktop/electron/main/database.ts`

Add after Migration 42. This is a table rebuild migration that:
1. Creates new tables with proper `ON DELETE CASCADE`
2. Copies all data
3. Drops old tables
4. Renames new tables

```typescript
// Migration 43: Fix foreign key constraints for location deletion
// Core media tables (imgs, vids, docs, maps) need ON DELETE CASCADE
// SQLite requires table rebuild to modify constraints
const imgsFkCheck = sqlite.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='imgs'"
).get() as { sql: string } | undefined;
const needsCascadeFix = imgsFkCheck?.sql && !imgsFkCheck.sql.includes('ON DELETE CASCADE');

if (needsCascadeFix) {
  console.log('Running migration 43: Adding ON DELETE CASCADE to media tables');

  sqlite.exec('PRAGMA foreign_keys = OFF');

  // Get current column definitions for each table, rebuild with CASCADE
  // ... (full implementation in code)

  sqlite.exec('PRAGMA foreign_keys = ON');
  console.log('Migration 43 completed: CASCADE constraints added');
}
```

### Step 2: Enhance Repository Delete Method (Optimized)

**File:** `packages/desktop/electron/repositories/sqlite-location-repository.ts`

```typescript
async delete(id: string): Promise<void> {
  const logger = getLogger();
  const fs = await import('fs/promises');
  const path = await import('path');

  // 1. Get location for folder path construction
  const location = await this.findById(id);
  if (!location) {
    throw new Error(`Location not found: ${id}`);
  }

  // 2. Collect all media SHAs in ONE query (for thumbnail/preview cleanup)
  const mediaShas = await this.db
    .selectNoFrom((eb) => [
      eb.selectFrom('imgs')
        .select(['imgsha as sha', eb.lit('img').as('type')])
        .where('locid', '=', id)
        .unionAll(
          eb.selectFrom('vids')
            .select(['vidsha as sha', eb.lit('vid').as('type')])
            .where('locid', '=', id)
        )
        .unionAll(
          eb.selectFrom('docs')
            .select(['docsha as sha', eb.lit('doc').as('type')])
            .where('locid', '=', id)
        )
        .as('media')
    ])
    .execute();

  // 3. Get video proxy paths (separate table)
  const videoShas = mediaShas.filter(m => m.type === 'vid').map(m => m.sha);
  const proxyPaths: string[] = [];
  if (videoShas.length > 0) {
    const proxies = await this.db
      .selectFrom('video_proxies')
      .select('proxy_path')
      .where('vidsha', 'in', videoShas)
      .execute();
    proxyPaths.push(...proxies.map(p => p.proxy_path).filter(Boolean));
  }

  // 4. Audit log BEFORE deletion
  logger.info('LocationRepository', `DELETION AUDIT: Deleting location`, {
    locid: id,
    locnam: location.locnam,
    loc12: location.loc12,
    state: location.address?.state,
    type: location.type,
    media_count: mediaShas.length,
    deleted_at: new Date().toISOString(),
  });

  // 5. Delete DB records FIRST (fast, atomic with CASCADE)
  await this.db.deleteFrom('locs').where('locid', '=', id).execute();

  // 6. Background file cleanup (non-blocking)
  setImmediate(async () => {
    try {
      // 6a. Delete location folder (contains all original media + BagIt)
      const archivePath = await this.getArchivePath();
      if (archivePath && location.loc12) {
        const state = location.address?.state?.toUpperCase() || 'XX';
        const locType = location.type || 'Unknown';
        const slocnam = location.slocnam || location.locnam.substring(0, 8);

        const locationFolder = path.join(
          archivePath,
          'locations',
          `${state}-${locType}`,
          `${slocnam}-${location.loc12}`
        );

        await fs.rm(locationFolder, { recursive: true, force: true });
        logger.info('LocationRepository', `Deleted location folder: ${locationFolder}`);
      }

      // 6b. Delete thumbnails/previews/posters by SHA
      const mediaPathService = new MediaPathService(archivePath);
      for (const { sha, type } of mediaShas) {
        // Thumbnails (all sizes)
        for (const size of [400, 800, 1920, undefined]) {
          const thumbPath = mediaPathService.getThumbnailPath(sha, size);
          await fs.unlink(thumbPath).catch(() => {});
        }

        // Previews (images only)
        if (type === 'img') {
          const previewPath = mediaPathService.getPreviewPath(sha);
          await fs.unlink(previewPath).catch(() => {});
        }

        // Posters (videos only)
        if (type === 'vid') {
          const posterPath = mediaPathService.getPosterPath(sha);
          await fs.unlink(posterPath).catch(() => {});
        }
      }

      // 6c. Delete video proxies
      for (const proxyPath of proxyPaths) {
        await fs.unlink(proxyPath).catch(() => {});
      }

      logger.info('LocationRepository', `File cleanup complete for ${id}`);
    } catch (err) {
      logger.warn('LocationRepository', `Background file cleanup error`, err);
    }
  });
}

private async getArchivePath(): Promise<string | null> {
  const result = await this.db
    .selectFrom('settings')
    .select('value')
    .where('key', '=', 'archive_path')
    .executeTakeFirst();
  return result?.value || null;
}
```

### Step 3: Update UI Confirmation (Optional Enhancement)

**File:** `packages/desktop/src/components/location/LocationNerdStats.svelte`

Add media count to confirmation dialog:

```svelte
<p class="text-red-600 font-medium">
  This will permanently delete this location and all associated media files.
</p>
```

No need to fetch counts - the operation is already PIN-protected.

## Files to Modify

| File | Change | Lines |
|------|--------|-------|
| `packages/desktop/electron/main/database.ts` | Add Migration 43 - rebuild media tables with CASCADE | +80 |
| `packages/desktop/electron/repositories/sqlite-location-repository.ts` | Enhance delete() with folder + SHA cleanup | +60 |
| `docs/contracts/hashing.md` | Update deletion behavior documentation | +3 |

## Performance Comparison

| Scenario | Original Plan | Optimized Plan |
|----------|---------------|----------------|
| Location with 100 images | 100+ unlink calls, 3 DB queries | 1 rm -rf, 1 UNION query |
| UI response time | Blocked until all files deleted | Instant (background cleanup) |
| Location with 0 media | Same as 100 images | Same fast path |
| Failure mid-delete | Partial state, orphan files | DB atomic, files eventually cleaned |

## Breaking Change Notice

This changes the deletion behavior from "soft delete" to "hard delete with file removal". Per user's explicit request.

**Contract Update:** `docs/contracts/hashing.md` line 17 will be updated:
```diff
- Deletions mark records inactive but never delete bytes without user command.
+ Deletions are permanent. Location delete with PIN confirmation removes all
+ associated media files from disk. This cannot be undone.
```

## Testing Checklist

- [ ] Create test location with 1+ image, 1+ video, 1+ document
- [ ] Verify files exist on disk before delete
- [ ] Delete location via PIN confirmation
- [ ] Verify DB records removed immediately (check `locs`, `imgs`, `vids`, `docs`)
- [ ] Verify location folder deleted (check `locations/STATE-TYPE/...`)
- [ ] Verify thumbnails deleted (check `.thumbnails/XX/SHA...`)
- [ ] Verify video proxies deleted (check `.cache/video-proxies/`)
- [ ] Verify audit log contains deletion record
- [ ] Test delete on location with no media (should succeed instantly)
- [ ] Test delete on location with sub-locations (slocs CASCADE verified)
- [ ] Verify ref_map_points with linked_locid are set to NULL (not deleted)

## Rollback Plan

If issues arise:
1. DB changes are atomic - restore from automatic backup
2. File deletion is best-effort - orphan files don't break the app
3. Remove Migration 43 check to prevent re-running on next launch

## Approval Required

**User:** Please confirm:
1. ✅ Location delete should remove media files from disk (not just DB records)
2. ✅ This is a destructive operation that cannot be undone
3. ✅ The PIN confirmation is sufficient authorization
4. ✅ Background file cleanup (UI responds instantly, files deleted async) is acceptable

Type **"APPROVED"** to proceed with implementation.
