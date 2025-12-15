# OPT-087: Import v2 Critical Fixes

**Date:** 2025-12-07
**Status:** Proposed (awaiting approval)
**Follows:** OPT-086 (Test Suite Modernization)
**Impact:** CRITICAL - Import pipeline broken

---

## Overview

After OPT-086, the Import v2 system has multiple critical bugs that prevent proper operation:

1. **No Thumbnails Generated** - Jobs stuck waiting for non-existent parent jobs
2. **No Video Thumbnails Generated** - Same root cause as #1
3. **No GPS Extracted** - GPS data in EXIF JSON but not written to database columns
4. **Page Does Not Refresh** - No component listening to thumbnail-ready events
5. **Progress Bar Broken** - Investigated, appears to be working (may be masked by #1)

---

## Root Cause Analysis

### Issue 1 & 2: Thumbnails Stuck (CRITICAL)

**Database Evidence:**
- 187 thumbnail jobs pending with status='pending'
- 25 ffprobe jobs pending (same issue)
- 1 gps-enrichment, 1 live-photo, 1 location-stats, 1 bagit pending
- 187 exiftool jobs completed, 25 video-proxy completed
- All pending jobs have `depends_on` pointing to UUIDs that don't exist

**Full Dependency Chain Affected:**
```
Per-File Jobs:
  exifJobId (created fresh each iteration) → BROKEN
    ├── thumbnail (depends on exifJobId) → STUCK
    └── ffprobe (depends on exifJobId, videos only) → STUCK
  video-proxy (NO dependency) → WORKING ✓

Per-Location Jobs:
  lastExifJobId (last file's exif job) → BROKEN
    ├── gps-enrichment → STUCK
    ├── live-photo → STUCK
    └── srt-telemetry (if documents)

  gpsEnrichmentJobId → BROKEN
    ├── location-stats → STUCK
    └── bagit → STUCK
```

**Root Cause Location:**
- `finalizer.ts:buildJobList()` (lines 725-780)
- `job-queue.ts:addBulk()` (lines 123-159)

**Bug Explanation:**
```typescript
// In finalizer.ts buildJobList():
const exifJobId = randomUUID();  // Creates UUID "A"
jobs.push({
  queue: IMPORT_QUEUES.EXIFTOOL,
  payload: { ...basePayload, jobId: exifJobId },  // UUID "A" in payload
});

jobs.push({
  queue: IMPORT_QUEUES.THUMBNAIL,
  dependsOn: exifJobId,  // Depends on UUID "A"
});

// In job-queue.ts addBulk():
const jobId = randomUUID();  // Creates NEW UUID "B"!
// Inserts job_id = "B" but depends_on = "A"
// UUID "A" never exists as a job_id in the database
```

**Fix Required:**
Option A: Have `addBulk()` accept pre-generated job IDs and use them
Option B: Have `buildJobList()` return job IDs after insertion and wire dependencies

**Recommended:** Option A - Less invasive, maintains current flow

---

### Issue 3: GPS Not Written to Columns (CRITICAL)

**Database Evidence:**
- 6 images have GPS in `meta_exiftool` JSON: `"gps":{"lat":43.20452,"lng":-77.963624}`
- Same 6 images have `meta_gps_lat = NULL`, `meta_gps_lng = NULL`

**Root Cause Location:**
- `job-worker-service.ts:updateMediaMetadata()` (lines 1002-1021)

**Bug Explanation:**
```typescript
// ExifToolService returns:
{
  gps: { lat: 43.20452, lng: -77.963624 }  // Nested object
}

// updateMediaMetadata() looks for:
meta_gps_lat: meta.GPSLatitude as number ?? null,  // WRONG key
meta_gps_lng: meta.GPSLongitude as number ?? null,  // WRONG key

// Should be:
meta_gps_lat: (meta.gps as { lat: number } | null)?.lat ?? null,
meta_gps_lng: (meta.gps as { lng: number } | null)?.lng ?? null,
```

**Fix Required:**
Update `updateMediaMetadata()` to read from `meta.gps.lat` and `meta.gps.lng`

---

### Issue 4: Page Does Not Refresh After Thumbnails

**Evidence:**
- `job-worker-service.ts:534` emits `asset:thumbnail-ready`
- `import-v2.ts:443-445` forwards to renderer
- `preload.cjs:613-625` exposes `jobs.onAssetReady()`
- **NO frontend component subscribes to `onAssetReady`**

**Root Cause:** Missing subscription in UI layer

**Fix Required:**
Add subscription in `App.svelte` or create an asset store that:
1. Listens to `jobs.onAssetReady` events
2. When thumbnail/metadata/proxy ready, triggers re-fetch of affected images/videos
3. Components that display media should react to this store

---

### Issue 5: Progress Bar (LIKELY WORKING)

Investigation shows progress events are properly:
1. Emitted by orchestrator via `onProgress` callback
2. Sent via `sendToRenderer('import:v2:progress', progress)`
3. Received in `LocationDetail.svelte` via `importV2.onProgress`
4. Updated in `importStore.updateProgress()`

The progress bar may appear "stuck at 0%" because:
- Jobs get stuck immediately (due to Issue #1)
- No files actually process, so progress never advances

**Verification Needed:** After fixing Issue #1, verify progress updates correctly.

---

## Proposed Fix Plan

### Fix 1: Job Dependency UUID Synchronization

**File:** `job-queue.ts`

**Change:** Modify `addBulk()` to accept optional pre-generated job IDs:

```typescript
interface JobInput<T> {
  queue: string;
  payload: T;
  priority?: number;
  dependsOn?: string;
  jobId?: string;  // NEW: Optional pre-generated ID
}

async addBulk<T>(inputs: JobInput<T>[]): Promise<string[]> {
  const jobIds: string[] = [];
  const values = inputs.map(input => {
    const jobId = input.jobId || randomUUID();  // Use provided or generate
    jobIds.push(jobId);
    return {
      job_id: jobId,
      // ... rest unchanged
    };
  });
  // ... rest unchanged
}
```

**File:** `finalizer.ts`

**Change:** Pass the pre-generated UUID to addBulk:

```typescript
const exifJobId = randomUUID();
jobs.push({
  queue: IMPORT_QUEUES.EXIFTOOL,
  jobId: exifJobId,  // NEW: Pass ID so it becomes the actual job_id
  payload: { ...basePayload },
});

jobs.push({
  queue: IMPORT_QUEUES.THUMBNAIL,
  dependsOn: exifJobId,  // Now references the correct job_id
  payload: basePayload,
});
```

---

### Fix 2: GPS Column Population

**File:** `job-worker-service.ts`

**Change:** Update `updateMediaMetadata()` to read correct path:

```typescript
private async updateMediaMetadata(hash: string, mediaType: string, metadata: unknown): Promise<void> {
  const meta = metadata as {
    width?: number;
    height?: number;
    dateTaken?: string;
    cameraMake?: string;
    cameraModel?: string;
    gps?: { lat: number; lng: number; altitude?: number } | null;
  };

  switch (mediaType) {
    case 'image':
      await this.db
        .updateTable('imgs')
        .set({
          meta_exiftool: JSON.stringify(metadata),
          meta_width: meta.width ?? null,
          meta_height: meta.height ?? null,
          meta_date_taken: meta.dateTaken ?? null,
          meta_camera_make: meta.cameraMake ?? null,
          meta_camera_model: meta.cameraModel ?? null,
          meta_gps_lat: meta.gps?.lat ?? null,  // FIXED
          meta_gps_lng: meta.gps?.lng ?? null,  // FIXED
        })
        .where('imghash', '=', hash)
        .execute();
      break;
    // Similar fix for 'video' case
  }
}
```

---

### Fix 3: Asset Ready Event Subscription

**File:** `App.svelte` (or new `src/stores/asset-store.ts`)

**Change:** Subscribe to asset ready events:

```typescript
// In onMount:
if (window.electronAPI?.jobs?.onAssetReady) {
  const unsubscribeAssets = window.electronAPI.jobs.onAssetReady((event) => {
    console.log('[App] Asset ready:', event.type, event.hash);
    // Dispatch custom event that components can listen to
    window.dispatchEvent(new CustomEvent('asset-ready', { detail: event }));
  });
  // Add to cleanup
}
```

**File:** `LocationDetail.svelte` or `ImageGrid.svelte`

**Change:** Listen and refresh:

```typescript
// In component:
$effect(() => {
  const handler = (e: CustomEvent) => {
    const { type, hash } = e.detail;
    if (type === 'thumbnail') {
      // Refresh images that match this hash
      invalidateImageCache(hash);
    }
  };
  window.addEventListener('asset-ready', handler);
  return () => window.removeEventListener('asset-ready', handler);
});
```

---

### Fix 4: Repair Existing Stuck Jobs

**One-time migration/script:** Clear stuck jobs and re-queue:

```sql
-- Option A: Delete pending jobs with invalid dependencies, re-import will recreate them
DELETE FROM jobs WHERE status = 'pending' AND depends_on IS NOT NULL
  AND depends_on NOT IN (SELECT job_id FROM jobs);

-- Option B: Remove dependency constraint so they run immediately
UPDATE jobs SET depends_on = NULL WHERE status = 'pending' AND depends_on IS NOT NULL
  AND depends_on NOT IN (SELECT job_id FROM jobs);
```

---

## Testing Plan

1. **Unit Tests:**
   - `job-queue.test.ts`: Add test for pre-generated job IDs
   - `job-worker-service.test.ts`: Add test for GPS extraction from nested object

2. **Integration Test:**
   - Import files with GPS EXIF data
   - Verify `meta_gps_lat`/`meta_gps_lng` populated
   - Verify thumbnails generated
   - Verify UI updates when thumbnails complete

3. **Manual Verification:**
   - Reset database
   - Import test files
   - Check job queue shows all jobs completed
   - Check images show thumbnails in UI
   - Check GPS data appears on map

---

## Files to Modify

| File | Change |
|------|--------|
| `job-queue.ts` | Accept optional `jobId` in `JobInput` |
| `finalizer.ts` | Pass pre-generated `jobId` to `addBulk()` |
| `job-worker-service.ts` | Fix GPS path in `updateMediaMetadata()` |
| `App.svelte` | Subscribe to `onAssetReady` events |
| `LocationDetail.svelte` | Listen and refresh on asset-ready |

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking existing imports | Schema unchanged, only job handling |
| Race conditions in job dependencies | Pre-generated UUIDs ensure consistency |
| Performance impact | Minimal - same number of queries |

---

## Decisions Made

1. **Option A**: Pre-generated IDs passed to `addBulk()` - cleaner, single transaction
2. **DELETE** stuck jobs - re-import will recreate them correctly
3. **Surgical cache invalidation** per hash - smoother UX, thumbnails "pop in"

---

## Additional Considerations

**All Job IDs Affected:**
- `exifJobId` - per file (187 files)
- `ffprobeJobId` - per video (25 videos)
- `gpsEnrichmentJobId` - per location (1)

The fix must handle ALL pre-generated IDs in `buildJobList()`:
- Line 743: `exifJobId`
- Line 753: `ffprobeJobId`
- Line 794: `gpsEnrichmentJobId`

**Future Safety:** Consider adding a startup health check that detects orphaned `depends_on` references and either cleans them or warns the user.

---

## Status: APPROVED - Ready for Implementation

End of Decision Document
