# Unified Image Processing Pipeline

**Issue:** Multiple image import entry points with inconsistent post-processing
**Goal:** Ensure ALL images receive the same metadata extraction, thumbnail generation, and tagging regardless of import source

---

## 1. Current State Analysis

### Import Entry Points

| Entry Point | Location | What It Does |
|-------------|----------|--------------|
| **Standard Import v2** | `orchestrator.ts` → `finalizer.ts` | Local file imports with full job queue |
| **Web Image Downloader** | `image-downloader.ts:importStaged()` | Web images via Research Browser |

### Jobs Queued by Each Path

| Job Type | Standard Import | Web Downloader | Gap? |
|----------|-----------------|----------------|------|
| EXIFTOOL | ✅ HIGH priority | ❌ Missing | **YES** |
| THUMBNAIL | ✅ NORMAL priority | ❌ Missing | **YES** |
| IMAGE_TAGGING | ✅ BACKGROUND priority | ✅ Manual queue | No |
| GPS_ENRICHMENT | ✅ Per-location | ❌ Missing | **YES** |
| LOCATION_STATS | ✅ Per-location | ❌ Missing | **YES** |
| BAGIT | ✅ Per-location | ❌ Missing | **YES** |
| LOCATION_TAG_AGGREGATION | ✅ Per-location | ❌ Missing | **YES** |

### Root Cause

Web image downloader (`image-downloader.ts:530-580`) manually imports and only queues the IMAGE_TAGGING job. It bypasses the `Finalizer.buildJobList()` method which queues all standard processing jobs.

---

## 2. Standard Image Processing Pipeline (Authoritative)

This is the complete job chain that should be applied to ALL imported images:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PER-FILE JOBS (run for each image)                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────┐         │
│  │ 1. EXIFTOOL (HIGH priority)                             │         │
│  │    - Extracts: dimensions, date taken, GPS, camera info │         │
│  │    - Updates: meta_exiftool, meta_width, meta_height,   │         │
│  │               meta_date_taken, meta_gps_lat/lng         │         │
│  └────────────────┬───────────────────────────────────────┘         │
│                   │                                                  │
│                   ▼                                                  │
│  ┌────────────────────────────────────────────────────────┐         │
│  │ 2. THUMBNAIL (NORMAL priority, depends on ExifTool)     │         │
│  │    - Generates: 400px (sm), 800px (lg), 1920px (preview)│         │
│  │    - RAW/HEIC: extracts embedded preview first          │         │
│  │    - Updates: thumb_path_sm, thumb_path_lg, preview_path│         │
│  └────────────────┬───────────────────────────────────────┘         │
│                   │                                                  │
│                   ▼                                                  │
│  ┌────────────────────────────────────────────────────────┐         │
│  │ 3. IMAGE_TAGGING (BACKGROUND priority, depends on Exif) │         │
│  │    - RAM++ or local inference                           │         │
│  │    - Updates: auto_tags, view_type, quality_score       │         │
│  └────────────────────────────────────────────────────────┘         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│              PER-LOCATION JOBS (run once after all file jobs)       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────┐         │
│  │ 4. GPS_ENRICHMENT (NORMAL priority)                     │         │
│  │    - Aggregates GPS from media to location              │         │
│  │    - Filters: images > videos, only enriches if better  │         │
│  │    - Never overwrites map-confirmed GPS                 │         │
│  └────────────────┬───────────────────────────────────────┘         │
│                   │                                                  │
│                   ▼                                                  │
│  ┌────────────────────────────────────────────────────────┐         │
│  │ 5. LOCATION_STATS (BACKGROUND priority)                 │         │
│  │    - Recalculates: img_count, vid_count, doc_count      │         │
│  │    - Calculates: total_size_bytes, date ranges          │         │
│  └────────────────┬───────────────────────────────────────┘         │
│                   │                                                  │
│                   ▼                                                  │
│  ┌────────────────────────────────────────────────────────┐         │
│  │ 6. BAGIT (BACKGROUND priority)                          │         │
│  │    - Updates RFC 8493 archive manifest                  │         │
│  │    - Creates: bagit.txt, bag-info.txt, manifest-sha256  │         │
│  └────────────────┬───────────────────────────────────────┘         │
│                   │                                                  │
│                   ▼                                                  │
│  ┌────────────────────────────────────────────────────────┐         │
│  │ 7. LOCATION_TAG_AGGREGATION (BACKGROUND priority)       │         │
│  │    - Aggregates tags from all images                    │         │
│  │    - Suggests location type/era                         │         │
│  │    - Auto-applies if confident                          │         │
│  └────────────────────────────────────────────────────────┘         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Proposed Solution

### Option A: Shared Job Builder Function (Recommended)

Create a single function that builds the standard job list for any image import:

```typescript
// New file: packages/desktop/electron/services/import/job-builder.ts

/**
 * Builds the standard job list for imported images.
 * This is the SINGLE SOURCE OF TRUTH for image processing jobs.
 *
 * All import paths (local files, web images) MUST use this function.
 */
export function buildImageJobList(params: {
  imghash: string;
  archivePath: string;
  locid: string;
  subid: string | null;
  mediaType: 'image';
}): JobInput[] {
  const { imghash, archivePath, locid, subid } = params;
  const jobs: JobInput[] = [];

  const basePayload = {
    hash: imghash,
    mediaType: 'image',
    archivePath,
    locid,
    subid,
  };

  // 1. ExifTool (HIGH priority)
  const exifJobId = generateId();
  jobs.push({
    queue: IMPORT_QUEUES.EXIFTOOL,
    priority: JOB_PRIORITY.HIGH,
    jobId: exifJobId,
    payload: basePayload,
  });

  // 2. Thumbnail (NORMAL priority, depends on ExifTool)
  jobs.push({
    queue: IMPORT_QUEUES.THUMBNAIL,
    priority: JOB_PRIORITY.NORMAL,
    payload: basePayload,
    dependsOn: exifJobId,
  });

  // 3. Image Tagging (BACKGROUND priority, depends on ExifTool)
  jobs.push({
    queue: IMPORT_QUEUES.IMAGE_TAGGING,
    priority: JOB_PRIORITY.BACKGROUND,
    payload: {
      imghash,
      imagePath: archivePath,
      locid,
      subid,
    },
    dependsOn: exifJobId,
  });

  return jobs;
}

/**
 * Builds per-location jobs that run after all file jobs.
 */
export function buildLocationJobList(params: {
  locid: string;
  subid: string | null;
  lastExifJobId: string;
  hasImages: boolean;
}): JobInput[] {
  // ... GPS_ENRICHMENT, LOCATION_STATS, BAGIT, LOCATION_TAG_AGGREGATION
}
```

### Option B: Route Web Imports Through Finalizer

Make web imports use the same `Finalizer.buildJobList()` method by creating a synthetic `FinalizedFile` array.

---

## 4. Implementation Checklist

### Phase 1: Documentation (This Plan)
- [x] Document current import flows
- [x] Identify gaps in web image pipeline
- [x] Define standard processing pipeline
- [ ] User approval

### Phase 2: Code Changes
- [ ] Create `job-builder.ts` with shared job building logic
- [ ] Update `finalizer.ts` to use shared job builder
- [ ] Update `image-downloader.ts` to use shared job builder
- [ ] Add per-location jobs to web import path

### Phase 3: Verification
- [ ] Test local file import → verify all jobs queued
- [ ] Test web image import → verify all jobs queued
- [ ] Compare job queue after both import types
- [ ] Verify thumbnails, ExifTool data, tags for web images

### Phase 4: Documentation Update
- [ ] Update `docs/workflows/import.md` with unified pipeline
- [ ] Add reference to `job-builder.ts` as single source of truth
- [ ] Update `lilbits.md` if new scripts added

---

## 5. Files to Modify

| File | Change |
|------|--------|
| `packages/desktop/electron/services/import/job-builder.ts` | **NEW** - Shared job building logic |
| `packages/desktop/electron/services/import/finalizer.ts` | Refactor to use `job-builder.ts` |
| `packages/desktop/electron/main/ipc-handlers/image-downloader.ts` | Use `job-builder.ts` instead of manual queue |
| `docs/workflows/import.md` | Document unified pipeline |

---

## 6. Current Code References

### Finalizer.buildJobList() - Current Implementation
Location: `packages/desktop/electron/services/import/finalizer.ts:759-927`

This is the **authoritative job building logic** that should be extracted and shared.

### Web Downloader - Current Implementation
Location: `packages/desktop/electron/main/ipc-handlers/image-downloader.ts:556-574`

Currently only queues IMAGE_TAGGING:
```typescript
// Migration 76: Queue IMAGE_TAGGING job for web-sourced images
const jobQueue = new JobQueue(db);
await jobQueue.addJob({
  queue: IMPORT_QUEUES.IMAGE_TAGGING,
  priority: JOB_PRIORITY.BACKGROUND,
  payload: {
    imghash: result.imghash,
    imagePath: result.finalPath,
    locid: validInput.locationId,
    subid: null,
  },
});
```

---

## 7. Expected Outcome

After implementation:
1. **Single source of truth** for image processing jobs
2. **All images** (local + web) receive identical processing
3. **Thumbnails generated** for web images
4. **ExifTool metadata** extracted for web images
5. **Location stats** updated after web imports
6. **BagIt manifests** updated after web imports
7. **Easy to add new processing steps** - update one place

---

## 8. User Decisions

1. **Approach**: Create shared `job-builder.ts` function ✅
2. **Backfill**: Yes, backfill existing web images ✅
3. **Additional steps**: Include LIVE_PHOTO detection for completeness

---

## 9. Refined Implementation (Post-Review)

### Key Improvements Over Original Plan

1. **Post-import hook pattern** - Single function called from all import paths
2. **Debounced location jobs** - One GPS_ENRICHMENT per batch, not per image
3. **Job deduplication** - Skip jobs if output already exists (thumbnails, etc.)
4. **Processing status tracking** - Know which stages each image completed

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         IMPORT SOURCES                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │ Local Import v2  │  │ Web Downloader   │  │ Future Source    │   │
│  │ (finalizer.ts)   │  │ (image-downl.ts) │  │ (...)            │   │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘   │
│           │                     │                     │              │
│           └─────────────────────┴─────────────────────┘              │
│                                 │                                    │
│                                 ▼                                    │
│           ┌─────────────────────────────────────────┐               │
│           │        job-builder.ts                    │               │
│           │  queueImageProcessingJobs()              │               │
│           │  queueLocationPostProcessing()           │               │
│           └─────────────────────────────────────────┘               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### New Functions

```typescript
// packages/desktop/electron/services/import/job-builder.ts

/**
 * Queue all standard processing jobs for an imported image.
 * SINGLE SOURCE OF TRUTH for image processing.
 *
 * Call this from ANY import path after successful DB insert.
 */
export async function queueImageProcessingJobs(
  db: Kysely<Database>,
  params: {
    imghash: string;
    archivePath: string;
    locid: string;
    subid: string | null;
  }
): Promise<{ jobs: string[]; skipped: string[] }>;

/**
 * Queue location-level jobs after an import batch completes.
 * Should be called ONCE per import session, not per image.
 *
 * Includes: GPS_ENRICHMENT, LIVE_PHOTO, LOCATION_STATS, BAGIT, TAG_AGGREGATION
 */
export async function queueLocationPostProcessing(
  db: Kysely<Database>,
  params: {
    locid: string;
    subid: string | null;
    lastExifJobId?: string; // For dependency chain
  }
): Promise<{ jobs: string[] }>;

/**
 * Check if processing is needed (for skip logic).
 */
export function needsProcessing(
  image: { thumb_path_sm: string | null; meta_exiftool: string | null; auto_tags: string | null }
): { exiftool: boolean; thumbnail: boolean; tagging: boolean };
```

### Backfill Script

```python
# scripts/backfill-image-processing.py
# Finds web images missing processing and queues jobs

# 1. Find images with extracted_from_web=1 OR missing metadata
# 2. Check which stages are incomplete
# 3. Queue appropriate jobs via IPC or direct DB insert
```

---

## 10. Implementation Checklist (Updated)

### Phase 1: Core Infrastructure
- [ ] Create `job-builder.ts` with `queueImageProcessingJobs()`
- [ ] Create `queueLocationPostProcessing()`
- [ ] Create `needsProcessing()` helper

### Phase 2: Integration
- [ ] Update `finalizer.ts` to use `job-builder.ts`
- [ ] Update `image-downloader.ts` to use `job-builder.ts`
- [ ] Ensure location jobs are debounced (once per batch)

### Phase 3: Backfill
- [ ] Create `backfill-image-processing.py` script
- [ ] Run backfill on existing web images
- [ ] Verify processing completed

### Phase 4: Documentation
- [ ] Update `docs/workflows/import.md`
- [ ] Add `job-builder.ts` to architecture docs
- [ ] Register backfill script in `lilbits.md`
