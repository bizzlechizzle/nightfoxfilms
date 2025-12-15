# Video Proxy Fix - All Videos Must Be Proxied

## Problem Statement

Drone videos are not being proxied. The current implementation only generates proxies for videos with `locid = ?` filter, but:

1. Videos may have `subid` set (sub-location videos)
2. When viewing host location with sub-locations, only `!subid` videos are displayed
3. When viewing sub-location, only matching `subid` videos are displayed
4. Proxy generation happens at host-level (`locid`), but sub-location videos might be missed in viewing context

## Root Cause Analysis

### Current Flow
1. `LocationDetail.onMount()` calls `generateProxiesForLocation(locationId)`
2. `getVideosNeedingProxies()` queries: `WHERE locid = ? AND video_proxies.vidsha IS NULL`
3. All videos with that `locid` should get proxied (including sub-location videos)

### Potential Issues
1. **Sub-location navigation**: When navigating to a sub-location (`/location/X/sub/Y`), the proxy generation still uses `locationId` (host), so sub-location videos SHOULD be included
2. **FFmpeg failures**: Some video codecs (DJI H.265/HEVC) might fail silently
3. **Missing metadata**: Videos without `meta_width/meta_height` default to 1920x1080, which should work

## Solution

### Part 1: Add Debug Logging
Add console logging to trace proxy generation for each video to identify which ones fail.

### Part 2: Handle H.265/HEVC Videos
DJI drones often use H.265. The current FFmpeg command uses `libx264` for output but should handle H.265 input fine. Add explicit error reporting.

### Part 3: Ensure Sub-Location Proxy Generation
When viewing a sub-location, also trigger proxy generation for that sub-location's videos explicitly.

### Part 4: Add Fallback to Original Video
If proxy generation fails, allow playing the original (slower but works).

## Implementation

### File: electron/services/video-proxy-service.ts

Add detailed error logging:
```typescript
ffmpeg.on('close', async (code) => {
  if (code === 0) {
    // success
  } else {
    console.error(`[VideoProxy] FFmpeg failed for ${vidsha}:`);
    console.error(`[VideoProxy] Input: ${sourcePath}`);
    console.error(`[VideoProxy] Dimensions: ${metadata.width}x${metadata.height}`);
    console.error(`[VideoProxy] Exit code: ${code}`);
    console.error(`[VideoProxy] stderr: ${stderr.slice(-1000)}`);
  }
});
```

### File: electron/main/ipc-handlers/media-processing.ts

Log each video processed:
```typescript
for (const video of videos) {
  console.log(`[VideoProxy] Processing: ${video.vidsha.slice(0, 8)} - ${video.vidloc}`);
  // ...
}
```

### File: src/components/MediaViewer.svelte

Add fallback to original video when proxy fails:
```svelte
{:else if proxyError}
  <!-- Show error but also offer to play original -->
  <button onclick={() => playOriginal = true}>Play Original (Slower)</button>
{/if}

{#if playOriginal}
  <video src={`media://${currentMedia.path}`} controls />
{/if}
```

### File: src/pages/LocationDetail.svelte

When viewing sub-location, also generate proxies for sub-location videos:
```typescript
// For sub-locations, the videos are already in the location's batch
// No change needed - videos have locid set regardless of subid
```

## Testing Checklist

1. [ ] Check FFmpeg can process DJI MOV/MP4 files
2. [ ] Verify all videos in location are queried (with debug log)
3. [ ] Confirm proxy generation for each video (success/fail log)
4. [ ] Test sub-location video proxy generation
5. [ ] Verify fallback to original works

## CLAUDE.md Compliance

| Rule | Status | Notes |
|------|--------|-------|
| Scope Discipline | ✅ | Fixing proxy for all videos |
| Keep It Simple | ✅ | Add logging + fallback |
| Offline-First | ✅ | All local FFmpeg |
