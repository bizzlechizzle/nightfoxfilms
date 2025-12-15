# OPT-105: RAW File Preview Display Fix

**Status:** Implemented
**Date:** 2025-12-08

---

## Executive Summary

Sony ARW files were "invisible" in the gallery but could be set as hero images. Root cause: extracted RAW preview paths were not being stored in the database, causing MediaViewer to attempt loading the original RAW file (which browsers cannot render).

---

## Root Cause Analysis

### Problem

1. Sony ARW files have smaller embedded previews (~1616x1080) compared to Nikon NEF (full-resolution)
2. ThumbnailService skips generating 1920px thumbnails when source image short edge < 1920px (to avoid upscaling)
3. JobWorkerService was storing `thumbResult.preview` (which was `null` when skipped) instead of the extracted RAW preview path
4. Preview files existed on disk in `.previews/` directory but weren't referenced in database
5. MediaViewer fallback chain went directly to original file, which browsers can't render

### Data Analysis

```sql
-- Before fix
SELECT COUNT(*) as total, SUM(CASE WHEN preview_path IS NULL THEN 1 ELSE 0 END) as missing
FROM imgs WHERE LOWER(imgloc) LIKE '%.arw';
-- Result: 330 total, 282 missing preview_path

-- After fix
-- Result: 330 total, 0 missing preview_path
```

---

## Solution Implemented

### 1. JobWorkerService Fix (job-worker-service.ts)

Track extracted RAW preview path separately and store it in database:

```typescript
let extractedRawPreviewPath: string | null = null;

// During preview extraction
if (extractedPath) {
  extractedRawPreviewPath = extractedPath;
}

// During database update - prefer extracted preview over generated thumbnail
.set({
  preview_path: extractedRawPreviewPath || thumbResult.preview,
  preview_extracted: extractedRawPreviewPath ? 1 : 0,
})
```

### 2. MediaViewer Fallback Chain (MediaViewer.svelte)

Added `thumbPathLg` (800px thumbnail) to fallback chain:

```typescript
const imageSrc = $derived(() => {
  if (currentMedia.previewPath) {
    return `media://${currentMedia.previewPath}`;
  }
  // Fallback to 800px thumbnail for RAW files without extracted preview
  if (currentMedia.thumbPathLg) {
    return `media://${currentMedia.thumbPathLg}`;
  }
  return `media://${currentMedia.path}`;
});
```

### 3. LocationDetail Integration (LocationDetail.svelte)

Pass `thumbPathLg` to MediaViewer component in media list mapping.

### 4. Backfill IPC Handler (media-processing.ts)

Added `media:backfillRawPreviews` handler to fix existing records by scanning disk for preview files.

### 5. Database Backfill

Python script executed to update 282 ARW records with correct preview paths from `.previews/` directory.

---

## Files Modified

| File | Change |
|------|--------|
| `electron/services/job-worker-service.ts` | Store extracted RAW preview path in database |
| `src/components/MediaViewer.svelte` | Add thumbPathLg to Props and fallback chain |
| `src/pages/LocationDetail.svelte` | Pass thumbPathLg to MediaViewer |
| `electron/main/ipc-handlers/media-processing.ts` | Add backfill handler |
| `electron/preload/preload.cjs` | Expose backfillRawPreviews |
| `src/types/electron.d.ts` | TypeScript declaration |

---

## Results

| Format | Total | With Preview |
|--------|-------|--------------|
| ARW (Sony) | 330 | 330 |
| NEF (Nikon) | 292 | 292 |
| DNG (Adobe) | 30 | 30 |

All RAW files now display correctly in gallery and lightbox.

---

## Prevention

New imports will automatically store the extracted RAW preview path in the `preview_path` column. The fix distinguishes between:
- Extracted previews (from `.previews/` directory, marked with `preview_extracted = 1`)
- Generated thumbnails (from `.thumbnails/` directory, 1920px size when source allows)

---

## Related Research

### What Immich Does

| Aspect | Immich | AU Archive |
|--------|--------|------------|
| RAW processing | Sharp library (can be flat) | ExifTool embedded JPEG extraction |
| Embedded preview | "Prefer embedded preview" option | Always extracts largest embedded |
| LUT/tone mapping | None | None (uses camera-rendered preview) |

**Key insight:** Immich community reports "thumbnails have poor contrast" when processing RAW directly. The solution is embedded JPEG extraction, which we already do correctly.

### ExifTool Preview Fallback Chain

1. `PreviewImage` (most common, full-size)
2. `JpgFromRaw` (Canon CR2)
3. `ThumbnailImage` (fallback, smaller)

System picks **largest** preview available. Sony embeds ~1616x1080 previews, which is sufficient for web display.
