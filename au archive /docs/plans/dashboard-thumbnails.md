# Dashboard Thumbnail Fix Plan

## Issue

Dashboard thumbnails fail to load with error:
```
Not allowed to load local resource: file:///Users/bryant/...
```

## Root Cause

**Dashboard uses wrong protocol.**

The app has a custom `media://` protocol registered in Electron to safely serve local files. The Dashboard incorrectly uses `file://` URLs which are blocked by Electron's content security policy.

## Evidence

### Working components use `media://`:
```svelte
<!-- LocationGallery.svelte:61 -->
src={`media://${image.thumb_path_sm || image.thumb_path}?v=${cacheVersion}`}

<!-- SubLocationGrid.svelte:70 -->
src="media://{subloc.hero_thumb_path}"

<!-- LocationHero.svelte uses media:// via heroUrl computed property -->
```

### Dashboard incorrectly uses `file://`:
```svelte
<!-- Dashboard.svelte (current, broken) -->
<img src="file://{location.heroThumbPath}" ...>
```

## Protocol Registration

Located in `electron/main/index.ts:21-24, 273-280`:
```typescript
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { ... } }
]);

protocol.handle('media', async (request) => {
  // Converts media://path/to/file.jpg to actual file access
});
```

## Fix

Change Dashboard thumbnail URLs from `file://` to `media://`:

```diff
- <img src="file://{location.heroThumbPath}" ...>
+ <img src="media://{location.heroThumbPath}" ...>
```

## Files to Change

| File | Lines | Change |
|------|-------|--------|
| `Dashboard.svelte` | ~202, ~259 | Change `file://` to `media://` for Projects and Recent Locations thumbnails |

## Notes

- The `heroThumbPath` returned from the API is already an absolute path
- The `media://` protocol handler decodes and serves the file
- No backend changes needed - just fix the URL protocol in the Svelte template
