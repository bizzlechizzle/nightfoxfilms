# Kanye5.md - Complete RAW/Preview System Audit

**Created:** 2025-11-23
**Context:** Deep ultrathink analysis of RAW file viewing failure
**Branch:** `claude/add-poster-generation-types-01VGFVsFYWM8ZmDnMkcYrwHY`
**Status:** BRAINSTORM - No code changes yet

---

## Executive Summary

**THE PROBLEM:** RAW files (.nef, .cr2, .arw, etc.) show "Cannot display this file format in browser" when viewed.

**ROOT CAUSE:** All preview extraction infrastructure EXISTS but is NEVER CALLED during import.

**THE FIX:** Wire `PreviewExtractorService` and `ThumbnailService` into `file-import-service.ts`.

---

## Complete System Audit

### What EXISTS (All Working)

| Component | File | Status | Evidence |
|-----------|------|--------|----------|
| PreviewExtractorService | `electron/services/preview-extractor-service.ts` | EXISTS | 125 lines, uses ExifTool |
| ThumbnailService | `electron/services/thumbnail-service.ts` | EXISTS | ~100 lines, uses Sharp |
| PosterFrameService | `electron/services/poster-frame-service.ts` | EXISTS | ~85 lines, uses FFmpeg |
| ExifTool extractBinaryTag | `electron/services/exiftool-service.ts:107-117` | EXISTS | Works, tested |
| IPC: media:extractPreview | `electron/main/ipc-handlers/media-processing.ts:89-101` | EXISTS | Handler registered |
| IPC: media:generateThumbnail | `electron/main/ipc-handlers/media-processing.ts:75-87` | EXISTS | Handler registered |
| IPC: media:generatePoster | `electron/main/ipc-handlers/media-processing.ts:103-115` | EXISTS | Handler registered |
| Preload: extractPreview | `electron/preload/index.ts:233-234` | EXISTS | Exposed to renderer |
| Preload: generateThumbnail | `electron/preload/index.ts:231-232` | EXISTS | Exposed to renderer |
| Preload: generatePoster | `electron/preload/index.ts:235-236` | EXISTS | Exposed to renderer |
| Types: electron.d.ts | `src/types/electron.d.ts:173-175` | EXISTS | All typed correctly |
| DB Schema: thumb_path | `electron/main/database.ts:434` | EXISTS | Migration 8 added it |
| DB Schema: preview_path | `electron/main/database.ts:435` | EXISTS | Migration 8 added it |
| Repository: updateImageThumbnailPath | `electron/repositories/sqlite-media-repository.ts:216-222` | EXISTS | Works |
| Repository: updateImagePreviewPath | `electron/repositories/sqlite-media-repository.ts:227-233` | EXISTS | Works |
| MediaViewer: previewPath check | `src/components/MediaViewer.svelte:45-48` | EXISTS | Uses preview if available |
| LocationDetail: mapping | `src/pages/LocationDetail.svelte:78-79` | EXISTS | Maps thumb_path/preview_path |

### What's MISSING (The Gap)

| What Should Happen | Where It Should Happen | Current Status |
|-------------------|------------------------|----------------|
| Call PreviewExtractorService during import | `file-import-service.ts` after metadata extraction | **NOT CALLED** |
| Call ThumbnailService during import | `file-import-service.ts` after metadata extraction | **NOT CALLED** |
| Store preview_path in INSERT | `file-import-service.ts:679-700` | **NOT SET** |
| Store thumb_path in INSERT | `file-import-service.ts:679-700` | **NOT SET** |
| Pass PreviewExtractorService to FileImportService | `media-import.ts` constructor | **NOT PASSED** |
| Pass ThumbnailService to FileImportService | `media-import.ts` constructor | **NOT PASSED** |

---

## The Flow Gap (Visual)

### CURRENT FLOW (Broken)

```
Import .nef file
       |
       v
[1. Calculate SHA256 hash] ---------> hash = "a3d5e8..."
       |
       v
[2. Check duplicate] ----------------> Not duplicate, continue
       |
       v
[3. Extract metadata via ExifTool] --> width, height, dateTaken, GPS
       |
       v
[4. Copy file to archive] -----------> /archive/locations/NY-Factory/.../a3d5e8....nef
       |
       v
[5. INSERT into imgs table]
    imgsha = "a3d5e8..."
    imgloc = "/archive/.../a3d5e8...nef"
    thumb_path = NULL  <-- PROBLEM
    preview_path = NULL <-- PROBLEM
       |
       v
[Later: User views image]
       |
       v
[LocationDetail.svelte loads media]
       |
       v
[MediaViewer checks previewPath]
    previewPath = null (from database)
       |
       v
[Falls back to original path]
    src = "media://a3d5e8....nef"
       |
       v
[Browser tries to render .nef] ------> FAILS
       |
       v
"Cannot display this file format in browser"
```

### CORRECT FLOW (What Should Happen)

```
Import .nef file
       |
       v
[1. Calculate SHA256 hash] ---------> hash = "a3d5e8..."
       |
       v
[2. Check duplicate] ----------------> Not duplicate, continue
       |
       v
[3. Extract metadata via ExifTool] --> width, height, dateTaken, GPS
       |
       v
[4. EXTRACT PREVIEW (NEW)] ----------> Uses same ExifTool to extract embedded JPEG
    PreviewExtractorService.extractPreview(sourcePath, hash)
    Returns: "/archive/.previews/a3/a3d5e8....jpg"
       |
       v
[5. GENERATE THUMBNAIL (NEW)] -------> Uses Sharp to resize preview/original
    ThumbnailService.generateThumbnail(previewPath || sourcePath, hash)
    Returns: "/archive/.thumbnails/a3/a3d5e8....jpg"
       |
       v
[6. Copy file to archive] -----------> /archive/locations/NY-Factory/.../a3d5e8....nef
       |
       v
[7. INSERT into imgs table]
    imgsha = "a3d5e8..."
    imgloc = "/archive/.../a3d5e8...nef"
    thumb_path = "/archive/.thumbnails/a3/a3d5e8....jpg"  <-- SET
    preview_path = "/archive/.previews/a3/a3d5e8....jpg"  <-- SET
       |
       v
[Later: User views image]
       |
       v
[LocationDetail.svelte loads media]
       |
       v
[MediaViewer checks previewPath]
    previewPath = "/archive/.previews/a3/a3d5e8....jpg"
       |
       v
[Uses preview path]
    src = "media:///archive/.previews/a3/a3d5e8....jpg"
       |
       v
[Browser renders JPEG] --------------> SUCCESS
```

---

## Why This Happened

### kanye.md Says (Rule 4):
> "Thumbnails on Import, Not On-Demand"
> **Decision:** Generate thumbnails when files are imported, not when they're first viewed.

### file-import-service.ts Does:
```typescript
// Line 373: ExifTool IS called for metadata
const exifData = await this.exifToolService.extractMetadata(file.filePath);

// Lines 679-700: INSERT happens WITHOUT preview/thumb paths
await trx.insertInto('imgs').values({
  imgsha: hash,
  imgnam: path.basename(archivePath),
  // ... other fields
  // thumb_path: ???  <-- NOT HERE
  // preview_path: ??? <-- NOT HERE
}).execute();
```

### The Services Exist But Are Orphaned:
- `PreviewExtractorService` - Created, documented, never called
- `ThumbnailService` - Created, documented, never called
- `PosterFrameService` - Created, documented, never called

### IPC Handlers Are ON-DEMAND Only:
```typescript
// media-processing.ts - These wait for frontend to call them
ipcMain.handle('media:extractPreview', async (_event, sourcePath, hash) => {...});
ipcMain.handle('media:generateThumbnail', async (_event, sourcePath, hash) => {...});
```

The architecture was built for ON-DEMAND extraction (call when viewing), but kanye.md specifies ON-IMPORT extraction (call during import). The services were built but never wired in.

---

## WWYDD (What Would You Do Differently)

### 1. Premium Import Experience

**Current:** Silent import, no feedback on preview generation.

**Premium:**
```
Import Progress:
[============================] 100%
  File 12/15: DSC_0042.NEF

  Phase: Extracting embedded preview...
  [====================--------] 67%

  Summary:
  - 15 files imported
  - 15 previews extracted (100%)
  - 15 thumbnails generated (100%)
  - 0 failed
```

### 2. Graceful Degradation

**Current:** If preview extraction fails, no fallback logic.

**Premium:**
```typescript
// In MediaViewer.svelte
const imageSrc = $derived(() => {
  if (!currentMedia) return '';

  // 1. Try preview (for RAW files)
  if (currentMedia.previewPath) {
    return `media://${currentMedia.previewPath}`;
  }

  // 2. Check if browser-renderable
  if (isBrowserSupported(currentMedia.path)) {
    return `media://${currentMedia.path}`;
  }

  // 3. Show "generating preview..." state and trigger extraction
  // This allows on-demand fallback for files imported before fix
  return null; // Triggers extraction attempt
});
```

### 3. Retry Mechanism for Failed Extractions

**Current:** No way to retry failed preview extractions.

**Premium:**
```typescript
// In MediaViewer.svelte - "r" key to retry
async function handleRetryPreview() {
  if (!currentMedia) return;

  const previewPath = await window.electronAPI.media.extractPreview(
    currentMedia.path,
    currentMedia.hash
  );

  if (previewPath) {
    // Update local state and database
    currentMedia.previewPath = previewPath;
  }
}
```

### 4. Bulk Regeneration for Existing Imports

**Current:** `media:regenerateAllThumbnails` exists but only for thumbnails.

**Premium:** Add `media:regenerateAllPreviews` for RAW files imported before fix:
```typescript
ipcMain.handle('media:regenerateAllPreviews', async () => {
  const rawImages = await mediaRepo.getRawImagesWithoutPreviews();
  // ... batch extract previews
});
```

### 5. Visual Indicators in Grid

**Current:** Grid shows generic placeholder for RAW files.

**Premium:**
- Show RAW badge on thumbnails
- Show warning icon for failed previews
- Show spinner during on-demand extraction

---

## Implementation Guide (For Inexperienced Coder)

### Phase 1: Wire Services Into Import (Critical)

#### Step 1.1: Update media-import.ts Constructor

**File:** `packages/desktop/electron/main/ipc-handlers/media-import.ts`

**Find:** The line where `FileImportService` is instantiated (around line 80-100)

**What to do:** Pass the services to FileImportService:

```typescript
// BEFORE (current code)
const fileImportService = new FileImportService(
  db,
  mediaPathService,
  locationRepo,
  exifToolService,
  ffmpegService,
  // ...
);

// AFTER (add these two services)
const thumbnailService = new ThumbnailService(mediaPathService);
const previewExtractorService = new PreviewExtractorService(mediaPathService, exifToolService);

const fileImportService = new FileImportService(
  db,
  mediaPathService,
  locationRepo,
  exifToolService,
  ffmpegService,
  thumbnailService,        // NEW
  previewExtractorService, // NEW
  // ...
);
```

#### Step 1.2: Update FileImportService Constructor

**File:** `packages/desktop/electron/services/file-import-service.ts`

**Find:** Constructor (around line 150-160)

**What to do:** Add the new service parameters:

```typescript
// BEFORE
constructor(
  private readonly db: Kysely<Database>,
  private readonly mediaPathService: MediaPathService,
  private readonly locationRepo: SQLiteLocationRepository,
  private readonly exifToolService: ExifToolService,
  private readonly ffmpegService: FFmpegService,
  // ...
) {}

// AFTER
constructor(
  private readonly db: Kysely<Database>,
  private readonly mediaPathService: MediaPathService,
  private readonly locationRepo: SQLiteLocationRepository,
  private readonly exifToolService: ExifToolService,
  private readonly ffmpegService: FFmpegService,
  private readonly thumbnailService: ThumbnailService,        // NEW
  private readonly previewExtractorService: PreviewExtractorService, // NEW
  // ...
) {}
```

#### Step 1.3: Add Imports at Top of file-import-service.ts

**File:** `packages/desktop/electron/services/file-import-service.ts`

**Find:** Import section at top of file

**Add:**
```typescript
import { ThumbnailService } from './thumbnail-service';
import { PreviewExtractorService } from './preview-extractor-service';
```

#### Step 1.4: Call Services During Import

**File:** `packages/desktop/electron/services/file-import-service.ts`

**Find:** After metadata extraction (around line 373-410), before file copy

**Add this code block:**
```typescript
// === STEP 5b: Extract preview for RAW files ===
let previewPath: string | null = null;
if (type === 'image' && this.previewExtractorService.isRawFormat(file.filePath)) {
  console.log('[FileImport] Step 5b: Extracting RAW preview...');
  previewPath = await this.previewExtractorService.extractPreview(file.filePath, hash);
  if (previewPath) {
    console.log('[FileImport] Preview extracted:', previewPath);
  } else {
    console.log('[FileImport] No embedded preview found (will use original)');
  }
}

// === STEP 5c: Generate thumbnail ===
let thumbPath: string | null = null;
if (type === 'image') {
  console.log('[FileImport] Step 5c: Generating thumbnail...');
  // Use preview for RAW files, original for standard images
  const sourceForThumb = previewPath || file.filePath;
  thumbPath = await this.thumbnailService.generateThumbnail(sourceForThumb, hash);
  if (thumbPath) {
    console.log('[FileImport] Thumbnail generated:', thumbPath);
  }
}
```

#### Step 1.5: Update Database INSERT

**File:** `packages/desktop/electron/services/file-import-service.ts`

**Find:** The INSERT statement for images (around line 679-700)

**What to do:** Add thumb_path and preview_path to the values:

```typescript
// BEFORE
await trx.insertInto('imgs').values({
  imgsha: hash,
  imgnam: path.basename(archivePath),
  imgnamo: originalName,
  imgloc: archivePath,
  imgloco: file.filePath,
  locid: file.locid,
  subid: file.subid || null,
  auth_imp: file.auth_imp,
  imgadd: timestamp,
  meta_exiftool: metadata?.rawExif || null,
  meta_width: metadata?.width || null,
  meta_height: metadata?.height || null,
  meta_date_taken: metadata?.dateTaken || null,
  meta_camera_make: metadata?.cameraMake || null,
  meta_camera_model: metadata?.cameraModel || null,
  meta_gps_lat: metadata?.gps?.lat || null,
  meta_gps_lng: metadata?.gps?.lng || null,
}).execute();

// AFTER (add two new fields)
await trx.insertInto('imgs').values({
  imgsha: hash,
  imgnam: path.basename(archivePath),
  imgnamo: originalName,
  imgloc: archivePath,
  imgloco: file.filePath,
  locid: file.locid,
  subid: file.subid || null,
  auth_imp: file.auth_imp,
  imgadd: timestamp,
  meta_exiftool: metadata?.rawExif || null,
  meta_width: metadata?.width || null,
  meta_height: metadata?.height || null,
  meta_date_taken: metadata?.dateTaken || null,
  meta_camera_make: metadata?.cameraMake || null,
  meta_camera_model: metadata?.cameraModel || null,
  meta_gps_lat: metadata?.gps?.lat || null,
  meta_gps_lng: metadata?.gps?.lng || null,
  thumb_path: thumbPath,       // NEW
  preview_path: previewPath,   // NEW
}).execute();
```

### Phase 2: Add Video Poster Frames (Nice to Have)

Similar process for videos using `PosterFrameService`:

1. Add to constructor
2. Call after video metadata extraction
3. Store in `thumb_path` column of `vids` table

### Phase 3: On-Demand Fallback (Nice to Have)

Add retry button to MediaViewer for files imported before fix:

```svelte
{#if imageError && !currentMedia.previewPath}
  <button onclick={handleRetryPreview}>
    Try to Extract Preview
  </button>
{/if}
```

---

## Testing Checklist

After implementing Phase 1:

- [ ] Import a .nef (Nikon RAW) file
- [ ] Check console for "Step 5b: Extracting RAW preview..."
- [ ] Check console for "Preview extracted: /archive/.previews/..."
- [ ] Check console for "Thumbnail generated: /archive/.thumbnails/..."
- [ ] Verify preview file exists on disk
- [ ] Verify thumbnail file exists on disk
- [ ] Open MediaViewer - RAW file should display correctly
- [ ] Check database: `SELECT thumb_path, preview_path FROM imgs WHERE imgsha = '...'`

---

## Files to Modify (Summary)

| File | Changes | Lines Affected |
|------|---------|----------------|
| `electron/main/ipc-handlers/media-import.ts` | Add service instantiation | ~10 lines |
| `electron/services/file-import-service.ts` | Add constructor params, add extraction calls, update INSERT | ~40 lines |

**Total: ~50 lines of code changes**

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Preview extraction fails silently | Low | Low | Services return null, import continues |
| Slow imports for large RAW files | Medium | Medium | Preview extraction is <1s per file |
| ExifTool missing embedded preview | Low | Low | Falls back to original (same as current) |
| Thumbnail generation fails | Low | Low | Services return null, grid shows placeholder |

---

## Appendix: Service Locations

```
packages/desktop/electron/
├── services/
│   ├── preview-extractor-service.ts  # 125 lines - ExifTool preview extraction
│   ├── thumbnail-service.ts          # ~100 lines - Sharp thumbnail generation
│   ├── poster-frame-service.ts       # ~85 lines - FFmpeg video frames
│   ├── media-path-service.ts         # ~90 lines - Path utilities
│   ├── exiftool-service.ts           # ~127 lines - ExifTool wrapper
│   └── file-import-service.ts        # ~820 lines - NEEDS MODIFICATION
├── main/ipc-handlers/
│   ├── media-import.ts               # ~260 lines - NEEDS MODIFICATION
│   └── media-processing.ts           # ~203 lines - On-demand handlers (OK)
└── repositories/
    └── sqlite-media-repository.ts    # ~270 lines - Has update methods (OK)
```

---

## Changelog

| Date | Author | What | Why |
|------|--------|------|-----|
| 2025-11-23 | Claude | Created Kanye5.md | Deep audit of RAW preview system |
