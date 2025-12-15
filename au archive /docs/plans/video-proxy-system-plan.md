# Video Proxy System - Implementation Plan

## Executive Summary

Replace direct video playback with a proxy-based system that generates optimized H.264 previews for smooth, instant playback with proper rotation handling.

## Problem Statement

Current video playback in Electron suffers from:
1. **No scrubbing** - `media://` protocol lacks range request support
2. **Slow loading** - 4K files are 100-300MB each
3. **Wrong rotation** - displaymatrix handling inconsistent in Chromium
4. **Poor UX** - Clunky, not premium quality

## Solution: Video Proxy System

Generate optimized H.264 proxy videos on import:
- **1080p for landscape** (max, never upscale)
- **720p width for portrait** (max, never upscale)
- **Rotation baked in** (FFmpeg autorotate)
- **Fast-start enabled** (instant scrubbing)
- **Cached with 30-day purge** for dormant locations

## Architecture

```
                          ┌─────────────────────┐
                          │   Video Import      │
                          └─────────┬───────────┘
                                    │
                                    ▼
                          ┌─────────────────────┐
                          │  Queue for Proxy    │
                          │    Generation       │
                          └─────────┬───────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
          ┌─────────────────┐             ┌─────────────────┐
          │ VideoProxyService│             │ ProxyCacheService│
          │  (FFmpeg)       │             │  (Management)   │
          └─────────┬───────┘             └─────────┬───────┘
                    │                               │
                    ▼                               ▼
          ┌─────────────────────────────────────────────────┐
          │              .cache/video-proxies/              │
          │         [hash]_proxy.mp4 (3-10MB each)         │
          └─────────────────────────────────────────────────┘
                                    │
                                    ▼
          ┌─────────────────────────────────────────────────┐
          │              MediaViewer.svelte                 │
          │    Plays proxy → instant load, smooth scrub    │
          └─────────────────────────────────────────────────┘
```

## Database Schema

### New Table: video_proxies

```sql
CREATE TABLE video_proxies (
  vidsha TEXT PRIMARY KEY,
  proxy_path TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  last_accessed TEXT NOT NULL,
  file_size_bytes INTEGER,
  original_width INTEGER,
  original_height INTEGER,
  proxy_width INTEGER,
  proxy_height INTEGER,
  FOREIGN KEY (vidsha) REFERENCES vids(vidsha) ON DELETE CASCADE
);
```

## Files to Create

### 1. electron/services/video-proxy-service.ts

**Purpose:** Generate proxy videos using FFmpeg

**Key Functions:**
- `generateProxy(videoPath, hash, metadata)` - Create proxy file
- `getProxyPath(hash)` - Get cache path for hash
- `calculateTargetSize(width, height)` - Determine proxy dimensions

**FFmpeg Settings:**
- Codec: H.264 (libx264)
- Audio: AAC
- Quality: CRF 23 (good balance)
- Preset: fast
- Flags: `-movflags +faststart` (enables scrubbing)

### 2. electron/services/proxy-cache-service.ts

**Purpose:** Manage proxy cache lifecycle

**Key Functions:**
- `ensureCacheDir()` - Create cache directory
- `updateLastAccessed(vidsha)` - Touch timestamp
- `purgeOldProxies(daysOld)` - Delete stale proxies
- `getCacheStats()` - Size, count, oldest
- `clearAllProxies()` - Manual purge

## Files to Modify

### 3. electron/main/database.ts

Add Migration 37: video_proxies table

### 4. electron/main/ipc-handlers/media-processing.ts

Add handlers:
- `media:generateProxy` - Generate single proxy
- `media:generateProxiesForLocation` - Batch generation
- `media:getProxyStatus` - Check if proxy exists
- `media:purgeOldProxies` - Trigger purge
- `media:getCacheStats` - Get cache info

### 5. electron/services/file-import-service.ts

After video import:
- Queue proxy generation (background)
- Don't block import completion

### 6. electron/preload/index.ts & preload.cjs

Add proxy methods to bridge

### 7. src/types/electron.d.ts

Add TypeScript types for proxy methods

### 8. src/components/MediaViewer.svelte

- Check for proxy_path first
- If proxy exists: play proxy
- If no proxy: show "Preparing preview..." + trigger generation
- Listen for generation complete event

### 9. src/pages/LocationDetail.svelte

On mount:
- Get videos for location
- Check which need proxies
- Generate first one immediately
- Queue rest in background
- Update last_accessed for all

### 10. src/pages/Settings.svelte

Add "Video Proxies" section:
- Cache stats (size, count)
- "Generate All Missing" button
- "Clear Cache" button
- Auto-purge toggle (30 days)

## FFmpeg Proxy Command

```bash
# Landscape video (width > height)
ffmpeg -i input.mov \
  -vf "scale=-2:min(1080,ih)" \
  -c:v libx264 \
  -preset fast \
  -crf 23 \
  -c:a aac \
  -movflags +faststart \
  output_proxy.mp4

# Portrait video (height > width)
ffmpeg -i input.mov \
  -vf "scale=min(720,iw):-2" \
  -c:v libx264 \
  -preset fast \
  -crf 23 \
  -c:a aac \
  -movflags +faststart \
  output_proxy.mp4
```

Note: FFmpeg's autorotate filter is ON by default, so rotation is automatically baked into the proxy pixels.

## Cache Directory Structure

```
[archive_folder]/
  .cache/
    video-proxies/
      48090f0a9360b6b4258f40d2c00d453f_proxy.mp4
      71f48bf8db8e83e32edb6089d2ff9f65_proxy.mp4
      d684d42574d9d84e6dc8f67b7fbc6155_proxy.mp4
```

## Purge Logic

```typescript
async function purgeOldProxies(daysOld: number = 30): Promise<PurgeResult> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  // Find stale proxies
  const stale = await db
    .selectFrom('video_proxies')
    .selectAll()
    .where('last_accessed', '<', cutoff.toISOString())
    .execute();

  let deleted = 0;
  let freedBytes = 0;

  for (const proxy of stale) {
    try {
      await fs.unlink(proxy.proxy_path);
      freedBytes += proxy.file_size_bytes || 0;
      deleted++;
    } catch {}

    await db
      .deleteFrom('video_proxies')
      .where('vidsha', '=', proxy.vidsha)
      .execute();
  }

  return { deleted, freedBytes };
}
```

## Smart Pre-generation Flow

```typescript
// LocationDetail.svelte - onMount
async function preGenerateProxies() {
  const videos = await window.electronAPI.media.findByLocation(locid);

  // Find videos without proxies
  const needsProxy = videos.videos.filter(v => !v.proxy_path);

  if (needsProxy.length === 0) return;

  // Generate first one immediately (user likely to click)
  const first = needsProxy[0];
  await window.electronAPI.media.generateProxy(first.vidsha);

  // Queue rest in background
  if (needsProxy.length > 1) {
    window.electronAPI.media.generateProxiesForLocation(locid);
  }
}
```

## IPC Event Flow

```
Renderer                    Main Process
   │                             │
   │ ─── generateProxy(hash) ──► │
   │                             │ ─► VideoProxyService.generate()
   │                             │ ─► FFmpeg spawns
   │                             │ ─► Proxy saved to .cache/
   │                             │ ─► DB record created
   │ ◄── { success, proxyPath } ─│
   │                             │
   │ ─ generateProxiesForLocation ►│
   │                             │ ─► Queue all videos
   │ ◄── { queued: 5 } ─────────│
   │                             │
   │     (background processing) │
   │                             │ ─► Progress events
   │ ◄── proxy:progress ────────│
   │ ◄── proxy:complete ────────│
```

## Expected Performance

| Metric | Before (4K direct) | After (Proxy) |
|--------|-------------------|---------------|
| Load time | 3-5 seconds | <0.5 seconds |
| Scrubbing | Broken | Smooth |
| Memory | 500MB+ | <50MB |
| Rotation | Wrong | Correct |

## CLAUDE.md Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| Binary Dependencies Welcome | ✅ | FFmpeg already in stack |
| Archive-First | ✅ | Improves media workflow |
| Keep It Simple | ✅ | Standard industry approach |
| Offline-First | ✅ | All local processing |
| IPC Channel Naming | ✅ | `media:generateProxy` format |
| Database Migrations | ✅ | New migration file |

## Implementation Order

1. Database migration (video_proxies table)
2. VideoProxyService (FFmpeg wrapper)
3. ProxyCacheService (cache management)
4. IPC handlers
5. Preload bridge
6. MediaViewer update
7. LocationDetail pre-generation
8. Settings UI
9. Import pipeline integration
10. Testing

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| FFmpeg not installed | Already bundled with app |
| Disk space | 30-day auto-purge + manual clear |
| Generation fails | Fallback to original (slower) |
| User clicks before proxy ready | Show loading state |

## Success Criteria

- [ ] Videos load in <1 second
- [ ] Scrubbing works smoothly
- [ ] Rotation is correct
- [ ] Cache auto-purges after 30 days
- [ ] No regression in existing functionality
- [ ] Settings shows cache stats
