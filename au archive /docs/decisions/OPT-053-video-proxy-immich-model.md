# OPT-053: Video Proxy Immich Model

## Status
Implemented

## Date
2025-12-02

## Context

The previous video proxy system generated proxies **on-demand at view time**, causing users to wait 10-60 seconds the first time they viewed a video. This created a poor user experience with "Preparing preview... Optimizing video for smooth playback" spinners.

Immich (a popular self-hosted photo/video management app) solves this by generating proxies **at upload/import time** and storing them permanently alongside originals.

## Decision

Adopt the Immich model for video proxies:

1. **720p resolution for ALL orientations** (was 1080p landscape, 720p portrait)
2. **Generate proxy at import time** (not on-demand at view)
3. **Store proxy alongside original** as hidden file (`.{hash}.proxy.mp4`)
4. **Permanent proxies** (no 30-day purge, no `last_accessed` tracking)
5. **Hardware acceleration** (`-hwaccel auto` in FFmpeg)

## Architecture Changes

### Import Pipeline
```
BEFORE:
  Import → Hash → Copy → Metadata → Poster → Thumbs → Done
  View → Check proxy → MISS → FFmpeg (10-60s) → Play

AFTER:
  Import → Hash → Copy → Metadata → Poster → Thumbs → PROXY → Done
  View → Load proxy instantly → Play
```

### Storage
```
BEFORE (.cache/video-proxies/):
  archive/.cache/video-proxies/48090f0a9360b6b4_proxy.mp4

AFTER (alongside original):
  archive/locations/NY-FACTORY/mill-a1b2c3d4/org-vid-a1b2c3d4/
    ├── 48090f0a9360b6b4.mov          # Original
    └── .48090f0a9360b6b4.proxy.mp4   # Proxy (hidden)
```

## Files Changed

| File | Change |
|------|--------|
| `database.ts` | Migration 45: Add `proxy_version` column |
| `database.types.ts` | Update `VideoProxiesTable` interface |
| `video-proxy-service.ts` | 720p, hwaccel, new path strategy |
| `media-path-service.ts` | Add `getVideoProxyPath()` |
| `file-import-service.ts` | Add proxy generation (Step 7b) |
| `media-processing.ts` | Add `proxyExists`, deprecate purge handlers |
| `preload.cjs` & `index.ts` | Add `proxyExists`, update comments |
| `MediaViewer.svelte` | Fast proxy check, simplified playback |
| `Settings.svelte` | Remove "Purge Cache" button |
| `LocationDetail.svelte` | Remove proxy pre-generation |
| `proxy-cache-service.ts` | Mark functions deprecated |
| `electron.d.ts` | Add `proxyExists` type |

## Deprecations

These functions remain for backwards compatibility but are no-ops:
- `purgeOldProxies()` - Always returns `{ deleted: 0, freedBytes: 0, freedMB: 0 }`
- `clearAllProxies()` - Always returns `{ deleted: 0, freedBytes: 0, freedMB: 0 }`
- `touchLocationProxies()` - Always returns `0`

## Trade-offs

### Pros
- Instant video playback (no spinner for new imports)
- Portable archive (proxies move with originals)
- Simpler architecture (no cache management)
- Backup includes proxies automatically

### Cons
- Longer import time (10-60s per video)
- ~10% permanent storage overhead
- Old imports still need on-demand generation (fallback retained)

## Migration Path

Old imports without proxies use the fallback path:
1. Check if proxy exists (filesystem)
2. If not, check DB for old-style proxy in cache
3. If not, generate on-demand (like before)

No data migration required - proxies generate on next playback for old videos.

## BagIt Considerations

Proxies are **excluded** from BagIt manifests because:
- They are derived files (can regenerate from original)
- Hidden file prefix (`.`) signals "not primary content"
- Keeps manifests focused on archival originals

## Metrics

| Metric | Before | After |
|--------|--------|-------|
| First view latency | 10-60s | <0.5s |
| Import time per video | ~5s | +10-60s |
| Storage overhead | Temporary (purged) | ~10% permanent |
| Playback smoothness | Instant after first | Always instant |

## Related

- Migration 36: Original video_proxies table
- Migration 45: proxy_version column
- `docs/workflows/import.md`: Updated Step 10
