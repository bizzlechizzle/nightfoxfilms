# OPT-077: Video Proxy Aspect Ratio Fix

## Status
Implemented

## Date
2025-12-06

---

## Problem Statement

Video proxies are not preserving the true aspect ratio of the original videos. Portrait videos (recorded on phones) are being generated as distorted proxies.

---

## Root Cause Analysis

### The Issue Chain

1. **FFprobe reports raw encoded dimensions, not displayed dimensions**
   - Mobile devices record portrait video as landscape pixels + rotation metadata
   - Example: A 1080x1920 (portrait) video is stored as 1920x1080 pixels with `rotation: 90` or `displaymatrix` side data

2. **FFmpegService.extractMetadata() returns raw dimensions**
   - `ffprobe -show_streams` returns the encoded `width` and `height`
   - It does NOT automatically apply rotation metadata
   - File: `packages/desktop/electron/services/ffmpeg-service.ts:124-128`

3. **Video proxy service calculates size from raw dimensions**
   - `calculateProxySize()` in `video-proxy-service.ts:39-61` receives raw (unrotated) dimensions
   - For a 1920x1080 video (stored landscape), it calculates 720x405 proxy
   - But the video is actually 9:16 portrait, so it should be 405x720

4. **FFmpeg autorotate bakes rotation, but scale filter uses wrong dimensions**
   - The comment "FFmpeg autorotate bakes rotation into pixels" at line 6 is true
   - FFmpeg DOES apply rotation automatically when encoding
   - BUT the scale filter (`scale=720:405`) was calculated from raw dimensions
   - Result: A 1080x1920 portrait video → proxy is 720x405 (distorted/stretched)

### Example Walkthrough

```
Original: iPhone portrait video (9:16)
  - Stored as: 1920x1080 pixels + rotation=90
  - Displayed as: 1080x1920

Current Code:
  1. FFprobe returns: width=1920, height=1080
  2. calculateProxySize(1920, 1080) → 720x405 (16:9)
  3. FFmpeg command: -vf scale=720:405
  4. FFmpeg autorotate: rotates 90°, then scales to 720x405
  5. Result: Distorted video (wrong aspect ratio)

Correct Behavior:
  1. FFprobe returns: width=1920, height=1080, rotation=90
  2. Swap dimensions: 1080x1920 (apply rotation to dimensions)
  3. calculateProxySize(1080, 1920) → 405x720 (9:16)
  4. FFmpeg command: -vf scale=405:720
  5. FFmpeg autorotate: rotates 90°, scales to 405x720
  6. Result: Correct 9:16 portrait proxy
```

---

## Solution

### Step 1: Enhance FFmpegService to return rotation metadata

Modify `ffprobe` call to extract rotation from:
- `stream.tags.rotate` (older format)
- `stream.side_data_list[].rotation` (newer format)
- `stream.side_data_list[].displaymatrix` (parse rotation from matrix)

Add to `VideoMetadata` interface:
```typescript
rotation: number | null;  // 0, 90, 180, 270
```

### Step 2: Create rotation-aware dimension helper

Add a function to calculate "oriented dimensions":
```typescript
function getOrientedDimensions(width: number, height: number, rotation: number | null): { width: number; height: number } {
  // 90° or 270° rotation swaps width/height
  if (rotation === 90 || rotation === 270 || rotation === -90 || rotation === -270) {
    return { width: height, height: width };
  }
  return { width, height };
}
```

### Step 3: Apply oriented dimensions in video proxy service

Before calling `calculateProxySize()`, apply rotation:
```typescript
const oriented = getOrientedDimensions(metadata.width, metadata.height, metadata.rotation);
const { width: targetWidth, height: targetHeight } = calculateProxySize(oriented.width, oriented.height);
```

### Step 4: Use `-vf scale=...:...,format=yuv420p` instead of hardcoded dimensions

Alternative approach: Let FFmpeg calculate dimensions automatically:
```
-vf "scale='min(720,iw)':'min(720,ih)':force_original_aspect_ratio=decrease"
```

This respects autorotate and preserves aspect ratio without manual dimension swapping.

---

## Files to Modify

| File | Change |
|------|--------|
| `ffmpeg-service.ts` | Add rotation extraction from ffprobe output |
| `video-proxy-service.ts` | Apply rotation before calculating proxy size |
| (optional) `file-import-service.ts` | Pass rotation in `_videoProxyData` |

---

## Implementation Details

### A. FFmpegService Changes

```typescript
// In extractMetadata(), add rotation parsing:
const rotation = this.parseRotation(videoStream);

// New method:
private parseRotation(videoStream: any): number | null {
  // Check tags (older videos)
  if (videoStream?.tags?.rotate) {
    return parseInt(videoStream.tags.rotate, 10);
  }

  // Check side_data_list (newer videos)
  const sideData = videoStream?.side_data_list;
  if (Array.isArray(sideData)) {
    for (const sd of sideData) {
      if (sd.rotation !== undefined) {
        return sd.rotation;
      }
      if (sd.displaymatrix) {
        // Parse displaymatrix for rotation (FFmpeg-specific format)
        // The string contains "rotation of X.XX degrees"
        const match = sd.displaymatrix.match(/rotation of ([-\d.]+)/);
        if (match) {
          return Math.round(parseFloat(match[1]));
        }
      }
    }
  }
  return null;
}
```

### B. VideoProxyService Changes

```typescript
// Add to interface
interface VideoMetadata {
  width: number;
  height: number;
  rotation?: number | null;  // NEW
}

// New helper function
function getOrientedDimensions(width: number, height: number, rotation: number | null | undefined): { width: number; height: number } {
  const rot = Math.abs(rotation ?? 0) % 360;
  if (rot === 90 || rot === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

// In generateProxy():
const oriented = getOrientedDimensions(metadata.width, metadata.height, metadata.rotation);
const { width: targetWidth, height: targetHeight } = calculateProxySize(oriented.width, oriented.height);
```

### C. File Import Service Changes

Update `_videoProxyData` to include rotation:
```typescript
_videoProxyData?: {
  vidhash: string;
  archivePath: string;
  width: number;
  height: number;
  rotation?: number | null;  // NEW
};
```

---

## Testing Plan

1. **Import test videos with various rotations**
   - 0° landscape (standard)
   - 90° portrait (most common phone orientation)
   - 180° upside-down
   - 270° portrait (other orientation)

2. **Verify proxy dimensions match displayed dimensions**
   - Portrait input → Portrait proxy
   - Landscape input → Landscape proxy

3. **Check existing proxies**
   - Existing proxies may need regeneration
   - Settings page can offer "Regenerate all video proxies" button

---

## Risks

1. **Existing proxies will have wrong aspect ratio**
   - Mitigation: Add "Regenerate video proxies" to Settings
   - Or: Increment `PROXY_VERSION` to force regeneration on next view

2. **displaymatrix parsing is platform-specific**
   - Mitigation: Test on various video sources (iPhone, Android, DSLR, drone)

---

## Estimated Changes

- ~30 lines in `ffmpeg-service.ts` (rotation parsing)
- ~15 lines in `video-proxy-service.ts` (oriented dimensions)
- ~5 lines in `file-import-service.ts` (pass rotation)
- Total: ~50 lines of code

---

## References

- [FFprobe showing landscape for portrait video](https://video.stackexchange.com/questions/36545/ffmpeg-showing-landscape-resolution-for-portrait-video)
- [FFmpeg rotation metadata](https://superuser.com/questions/660505/find-out-rotation-metadata-from-video-in-ffmpeg)
- OPT-053: Video Proxy Immich Model (original implementation)
