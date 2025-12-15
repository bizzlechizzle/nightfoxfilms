# OPT-085: Import v2 Thumbnail and Video Proxy Fixes

**Date:** 2025-12-07
**Status:** Implemented
**Impact:** Critical - Thumbnails were not generating, video proxies had wrong aspect ratio

---

## Problem Summary

After a full audit of the Import v2 pipeline, three critical bugs were discovered:

### Bug 1: Thumbnail Generation Using Wrong Method
- **Location:** `job-worker-service.ts:handleThumbnailJob()`
- **Issue:** Called deprecated `generateThumbnail()` which creates a single 256px cropped square
- **Impact:** Dashboard and gallery showed no thumbnails or wrong-sized thumbnails

### Bug 2: Video Files Passed Directly to Sharp
- **Location:** `job-worker-service.ts:handleThumbnailJob()`
- **Issue:** Video files were passed to Sharp, which cannot process video formats
- **Impact:** Video thumbnails completely failed (Sharp throws errors on video files)

### Bug 3: Video Proxy Missing Rotation Metadata
- **Location:** `job-worker-service.ts:handleVideoProxyJob()`
- **Issue:** Rotation metadata not passed to `generateProxy()`
- **Impact:** Portrait videos created as landscape proxies (wrong aspect ratio)

---

## Root Cause Analysis

### Thumbnail Generation
The `ThumbnailService` has two methods:
1. `generateThumbnail()` - **DEPRECATED**: Creates single 256px square thumbnail (legacy)
2. `generateAllSizes()` - **CORRECT**: Creates 400px, 800px, 1920px JPEG thumbnails

The job handler was calling the deprecated method.

### Video Poster Frames
Sharp (the image processing library) only processes image formats. For videos:
1. FFmpeg must first extract a poster frame (JPEG)
2. Then Sharp can resize that frame into thumbnails

This step was completely missing.

### Video Rotation
Mobile devices record portrait video as landscape pixels + rotation metadata:
- iPhone records 1920x1080 pixels with 90° rotation
- FFprobe extracts this rotation correctly
- But the rotation wasn't being passed to the proxy generator
- Result: 720p proxy was 1280x720 instead of 720x1280 for portrait

---

## Fix Implementation

### Fix 1: Use `generateAllSizes()` for Proper Thumbnails
```typescript
// BEFORE (wrong):
const thumbPath = await thumbnailService.generateThumbnail(
  payload.archivePath,
  payload.hash
);

// AFTER (correct):
const thumbResult = await thumbnailService.generateAllSizes(
  payload.archivePath,
  payload.hash
);
```

### Fix 2: Extract Video Poster Frame Before Thumbnails
```typescript
if (payload.mediaType === 'video') {
  const ffmpegService = new FFmpegService();
  posterPath = mediaPathService.getPosterPath(payload.hash);

  // Ensure poster bucket directory exists
  await mediaPathService.ensureBucketDir(
    mediaPathService.getPosterDir(),
    payload.hash
  );

  // Extract frame at 1 second (or 0 for very short videos)
  await ffmpegService.extractFrame(payload.archivePath, posterPath, 1, 1920);
  sourceForThumbnail = posterPath;
}
```

### Fix 3: Pass Rotation to Video Proxy
```typescript
// BEFORE (wrong - missing rotation):
const result = await generateProxy(
  this.db,
  archiveSetting?.value || '',
  payload.hash,
  payload.archivePath,
  { width: metadata.width ?? 1920, height: metadata.height ?? 1080 }
);

// AFTER (correct - includes rotation):
const result = await generateProxy(
  this.db,
  archiveSetting?.value || '',
  payload.hash,
  payload.archivePath,
  {
    width: metadata.width ?? 1920,
    height: metadata.height ?? 1080,
    rotation: metadata.rotation,  // Critical for portrait videos
  }
);
```

---

## Files Changed

| File | Changes |
|------|---------|
| `electron/services/job-worker-service.ts` | Fixed `handleThumbnailJob()` and `handleVideoProxyJob()` |

---

## Thumbnail Sizes (Reference)

| Size | Purpose | Quality |
|------|---------|---------|
| 400px | Grid view (1x displays) | 85% JPEG |
| 800px | Grid view (2x HiDPI) | 85% JPEG |
| 1920px | Lightbox/detail view | 90% JPEG |

---

## Video Proxy Specifications

| Setting | Value |
|---------|-------|
| Max dimension | 720px (either width or height) |
| Codec | H.264 (libx264) |
| Preset | fast |
| CRF | 23 |
| Audio | AAC |
| Container | MP4 with faststart |

---

## Verification Steps

1. Import an image → Verify 3 thumbnails created in `.thumbnails/{bucket}/`
2. Import a video → Verify poster frame in `.posters/{bucket}/`
3. Import a video → Verify 3 thumbnails created from poster
4. Import a portrait video → Verify proxy is portrait orientation
5. Check database for populated `thumb_path_sm`, `thumb_path_lg`, `preview_path`

---

## Impact on Existing Data

- **Existing thumbnails**: Not affected (only new imports)
- **Regeneration needed**: Yes, for any files imported between v2 launch and this fix
- **Regeneration method**: Delete thumbnails and re-run import, or use future "Regenerate Thumbnails" feature

---

## Related Documentation

- **Thumbnail Contract**: Uses BLAKE3 16-char hex hash for bucket paths
- **Video Proxy Contract**: OPT-053, OPT-077 for rotation handling
- **CLAUDE.md**: Archive app with premium user experience goal

---

## Testing Checklist

- [ ] TypeScript build succeeds
- [ ] Unit tests pass
- [ ] Image thumbnail generation works (400, 800, 1920)
- [ ] Video poster frame extraction works
- [ ] Video thumbnail generation works (from poster)
- [ ] Portrait video proxy has correct aspect ratio
- [ ] Landscape video proxy has correct aspect ratio
- [ ] Database records updated with correct paths
