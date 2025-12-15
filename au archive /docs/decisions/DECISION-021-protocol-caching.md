# DECISION-021: Media Protocol Must Disable Caching

## Status
Accepted

## Date
2025-11-27

## Context
Thumbnails appeared sideways in the UI even after regeneration with correct EXIF rotation. Investigation confirmed files on disk were correctly oriented:
- HEIC thumbnails: 400x533 (portrait) - correct
- ARW thumbnails: 599x400 (landscape) - correct

Yet the browser displayed old, incorrectly-rotated versions.

## Problem

The `media://` protocol handler in `electron/main/index.ts` used `net.fetch('file://')` which Electron caches internally.

```javascript
// BEFORE (broken):
protocol.handle('media', async (request) => {
  const url = new URL(request.url);
  let filePath = decodeURIComponent(url.pathname);  // Query string stripped!
  return net.fetch(`file://${filePath}`);  // Same URL every time = cached
});
```

Cache-busting via query parameters (`media://path/thumb.jpg?v=timestamp`) was ineffective because:
1. `URL.pathname` does not include query strings
2. The underlying `file://` URL passed to `net.fetch` was always identical
3. Electron's net module cached the response based on the file:// URL

## Decision

Add explicit no-cache headers to all `media://` protocol responses:

```javascript
// AFTER (fixed):
const response = await net.fetch(`file://${filePath}`);
return new Response(response.body, {
  status: response.status,
  statusText: response.statusText,
  headers: {
    ...Object.fromEntries(response.headers.entries()),
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  },
});
```

## Consequences

### Positive
- Thumbnails always reflect current file state on disk
- Regenerating thumbnails immediately shows correct results
- No need to rebuild 100k+ images when fixing rotation issues

### Negative
- Slightly higher disk I/O (no browser caching of media files)
- Each page load re-reads thumbnail files from disk

### Acceptable Trade-off
Local SSD file access is fast (~1ms per file). Correctness is more important than marginal performance gains from caching. Users would rather see correct images than fast-but-wrong images.

## Implementation

See `electron/main/index.ts` protocol handler around line 275.

## Testing Guidance

When modifying the `media://` protocol handler:
1. Never remove the no-cache headers
2. Test thumbnail regeneration flow: Settings > Fix All Rotations
3. Verify new thumbnails appear immediately without app restart
4. Check that query string cache-bust (`?v=`) is still being appended by components

## Related Files

- `electron/main/index.ts` - Protocol handler
- `src/stores/thumbnail-cache-store.ts` - Cache version store
- `src/components/location/LocationGallery.svelte` - Uses cache-bust params
- `src/components/MediaViewer.svelte` - Uses cache-bust params
