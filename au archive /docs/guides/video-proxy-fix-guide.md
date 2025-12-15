# Video Proxy System - All Videos Must Be Proxied

## Overview

This guide documents the Video Proxy System that generates optimized H.264 proxy videos for smooth in-app playback with instant scrubbing and correct rotation.

## Critical Fixes Applied

### 1. HTTP Range Request Support (Enables Scrubbing)
**File:** `electron/main/index.ts` (media:// protocol handler)

The `media://` protocol now supports HTTP Range Requests (RFC 7233). Without this, videos:
- Load the ENTIRE file into memory before playing (445MB for a single video!)
- Cannot be scrubbed because the browser can't request specific byte ranges

**How it works:**
- When a video player scrubs to a new position, it sends `Range: bytes=12345-67890`
- The protocol handler reads ONLY those bytes from disk and returns status `206 Partial Content`
- The `Accept-Ranges: bytes` header tells the browser that seeking is supported

### 2. PreloadService Skips Videos
**File:** `electron/services/preload-service.ts`

The preload service was trying to cache ALL media into a 100MB LRU cache, including videos.
A 445MB video would always fail with "Item too large to cache".

**Fix:** Added `type` to MediaItem interface and skip videos:
```typescript
if (item.type === 'video') {
  continue;  // Videos are streamed, not cached
}
```

## The Problem

Without proxies, videos (especially drone footage):
- Load slowly (100-300MB originals vs 3-10MB proxies)
- Cannot be scrubbed smoothly (no `-movflags +faststart`)
- May display rotated incorrectly (raw HEVC vs baked rotation)
- Block the UI while loading

## Architecture

### Components

1. **`video-proxy-service.ts`** - FFmpeg transcoding
2. **`proxy-cache-service.ts`** - Cache management and queries
3. **`media-processing.ts`** - IPC handlers
4. **`preload.cjs`** - Electron bridge (CRITICAL: CommonJS only!)
5. **`MediaViewer.svelte`** - UI with proxy support

### Data Flow

```
LocationDetail.onMount()
        ↓
generateProxiesForLocation(locid)
        ↓
getVideosNeedingProxies() → SQL query: WHERE locid = ? AND no proxy
        ↓
For each video → generateProxy()
        ↓
FFmpeg transcodes to H.264 with -movflags +faststart
        ↓
video_proxies table updated
        ↓
MediaViewer loads proxy via media:// protocol
```

## Key Files

### 1. `electron/services/video-proxy-service.ts`

Handles FFmpeg transcoding:

```typescript
// FFmpeg command structure
ffmpeg -i <source> \
  -vf scale=... \           // 1080p landscape or 720p portrait
  -c:v libx264 \            // H.264 output codec
  -preset fast \            // Balance speed/quality
  -crf 23 \                 // Quality (lower = better, 18-28 typical)
  -c:a aac \                // AAC audio
  -movflags +faststart \    // CRITICAL: Enables instant scrubbing
  -y <output>
```

Key function: `generateProxy(db, archivePath, vidsha, sourcePath, metadata)`

Error logging pattern:
```typescript
console.error(`[VideoProxy] ❌ FFmpeg FAILED for ${vidsha.slice(0, 12)}`);
console.error(`[VideoProxy]   Input: ${sourcePath}`);
console.error(`[VideoProxy]   Exit code: ${code}`);
console.error(`[VideoProxy]   Error output:\n${stderr.slice(-1000)}`);
```

### 2. `electron/services/proxy-cache-service.ts`

Cache management functions:

- `getCacheStats()` - Total count, size, oldest/newest access
- `purgeOldProxies(daysOld)` - Auto-cleanup after 30 days
- `clearAllProxies()` - Manual purge from Settings
- `touchLocationProxies(locid)` - Update last_accessed to prevent purge
- `getVideosNeedingProxies(locid)` - Find videos without proxies

### 3. `electron/preload/preload.cjs`

**CRITICAL**: This file MUST be CommonJS (`.cjs`). It is NOT processed by Vite.

Required methods for video proxies:
```javascript
// Video Proxy System (Migration 36)
generateProxy: (vidsha, sourcePath, metadata) =>
  ipcRenderer.invoke("media:generateProxy", vidsha, sourcePath, metadata),
getProxyPath: (vidsha) =>
  ipcRenderer.invoke("media:getProxyPath", vidsha),
getProxyCacheStats: () =>
  ipcRenderer.invoke("media:getProxyCacheStats"),
purgeOldProxies: (daysOld) =>
  ipcRenderer.invoke("media:purgeOldProxies", daysOld),
clearAllProxies: () =>
  ipcRenderer.invoke("media:clearAllProxies"),
touchLocationProxies: (locid) =>
  ipcRenderer.invoke("media:touchLocationProxies", locid),
generateProxiesForLocation: (locid) =>
  ipcRenderer.invoke("media:generateProxiesForLocation", locid),
onProxyProgress: (callback) => {
  const listener = (_event, progress) => callback(progress);
  ipcRenderer.on("media:proxyProgress", listener);
  return () => ipcRenderer.removeListener("media:proxyProgress", listener);
},
```

### 4. `src/components/MediaViewer.svelte`

Video player with proxy support:

State variables:
```typescript
let proxyPath = $state<string | null>(null);
let generatingProxy = $state(false);
let proxyError = $state<string | null>(null);
let playOriginal = $state(false); // Fallback when proxy fails
```

Video loading flow:
```typescript
$effect(() => {
  const _index = currentIndex; // Force dependency
  const media = currentMedia;
  if (media?.type === 'video') {
    playOriginal = false;
    loadVideoProxy(media);
  }
});
```

Template structure:
```svelte
{#if playOriginal}
  <!-- Original video (slower) -->
  <video src={`media://${currentMedia.path}`} controls />
{:else if generatingProxy}
  <!-- Loading spinner -->
{:else if proxyError}
  <!-- Error with Retry + Play Original buttons -->
{:else if proxyPath}
  <!-- Proxy video (fast!) -->
  <video src={`media://${proxyPath}`} controls autoplay />
{:else}
  <!-- Initial loading state -->
{/if}
```

**IMPORTANT**: Use `media://` protocol, NOT `file://`!

Electron blocks `file://` URLs in the renderer for security. The `media://` protocol is registered in `electron/main/index.ts`.

## Database Schema

Migration 36 creates:

```sql
CREATE TABLE video_proxies (
  vidsha TEXT PRIMARY KEY,           -- SHA256 of original video
  proxy_path TEXT NOT NULL,          -- Absolute path to proxy file
  generated_at TEXT NOT NULL,        -- ISO8601 timestamp
  last_accessed TEXT NOT NULL,       -- For 30-day purge
  file_size_bytes INTEGER NOT NULL,  -- For cache stats
  original_width INTEGER,
  original_height INTEGER,
  proxy_width INTEGER,
  proxy_height INTEGER
);
```

## Debugging

### Check if videos are being queried

Look for this log:
```
[VideoProxy] Generating proxies for X videos in location UUID...
[VideoProxy]   Queued: abc123456789 - filename.mp4 (1920x1080)
```

### Check if FFmpeg is failing

Look for:
```
[VideoProxy] ❌ FFmpeg FAILED for abc123456789
[VideoProxy]   Input: /path/to/video.mov
[VideoProxy]   Exit code: 1
[VideoProxy]   Error output: ...
```

### Common FFmpeg errors

1. **H.265/HEVC input**: FFmpeg should handle this, but some builds don't have libx265 decoder
2. **Invalid dimensions**: Must be even numbers for H.264
3. **File not found**: Check `vidloc` path is valid
4. **Codec not found**: FFmpeg may need additional codec libraries

### Check the proxy cache

In DevTools:
```javascript
await window.electronAPI.media.getProxyCacheStats()
// Returns: { totalCount, totalSizeMB, oldestAccess, newestAccess }
```

## Fallback Behavior

If proxy generation fails, the "Play Original" button lets users watch the original video:

```svelte
<button onclick={() => playOriginal = true}>
  Play Original
</button>
```

This uses:
```svelte
<video src={`media://${currentMedia.path}`} controls />
```

The original plays but may be slow and lack smooth scrubbing.

## Testing Checklist

1. [ ] Navigate to a location with videos
2. [ ] Check console for `[VideoProxy] Generating proxies for X videos...`
3. [ ] Verify each video shows `✓ Proxy generated` or `✗ Proxy failed`
4. [ ] Click on a video in MediaViewer
5. [ ] Verify proxy plays (fast load, smooth scrubbing)
6. [ ] If proxy fails, click "Play Original" and verify it works
7. [ ] Test with DJI drone footage (MOV, HEVC)
8. [ ] Test with phone footage (MP4, H.264)
9. [ ] Check Settings > Video Proxies shows cache stats

## CLAUDE.md Compliance

| Rule | Status | Notes |
|------|--------|-------|
| Scope Discipline | ✅ | Only fixing proxy system as requested |
| Keep It Simple | ✅ | Debug logging + fallback UI |
| Offline-First | ✅ | All FFmpeg processing is local |
| Binary Dependencies Welcome | ✅ | FFmpeg is required |
| Preload MUST be CommonJS | ✅ | Using `.cjs` extension |

## Files Changed

1. **`electron/main/index.ts`** - Added HTTP Range Request support for video streaming/scrubbing
2. **`electron/services/preload-service.ts`** - Skip videos in preload cache (too large for memory)
3. **`electron/services/video-proxy-service.ts`** - Added detailed error logging
4. **`electron/main/ipc-handlers/media-processing.ts`** - Added per-video logging
5. **`src/components/MediaViewer.svelte`** - Added playOriginal fallback, use media:// protocol
6. **`electron/preload/preload.cjs`** - Added video proxy bridge methods
7. **`docs/plans/video-proxy-all-videos-fix.md`** - Fix documentation
