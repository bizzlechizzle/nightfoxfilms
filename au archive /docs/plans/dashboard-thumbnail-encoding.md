# Dashboard Thumbnail URL Encoding Plan

## Issue

Thumbnails sometimes fail to load on Dashboard.

## Root Cause Analysis

### Data State (verified correct)
```
Willard:
- hero_imgsha: e7ad8825...
- thumb_path_sm: /Users/bryant/Documents/au archive /archive/.thumbnails/e7/...
- File EXISTS on disk ✓
- project=1, last_viewed_at=set

Mary McClellan:
- hero_imgsha: 91e6cb52...
- thumb_path_sm: /Users/bryant/Documents/au archive /archive/.thumbnails/91/...
- File EXISTS on disk ✓
- project=0, last_viewed_at=NULL (won't show in Recent Locations)
```

### The Problem: Path Contains Space

The path `/Users/bryant/Documents/au archive /archive/...` contains a **space** character.

When used in an `<img src="media://...">` tag:
- Raw: `media:///Users/bryant/Documents/au archive /archive/...`
- The space breaks URL parsing
- Browser may truncate at the space or fail to parse

### Protocol Handler Expectation

`electron/main/index.ts:279`:
```javascript
let filePath = decodeURIComponent(url.pathname);
```

The handler **expects URL-encoded paths** and decodes them. If we pass unencoded paths with spaces, parsing fails.

### How Working Components Handle This

Looking at `LocationGallery.svelte`:
```svelte
src={`media://${image.thumb_path_sm}?v=${cacheVersion}`}
```

These also pass raw paths - but they work because the paths stored in DB for those images may not have spaces, OR the browser's URL constructor handles it gracefully in some cases but not others.

## Fix Options

### Option A: Encode paths in the Svelte template (Quick Fix)
```svelte
<img src="media://{encodeURI(location.heroThumbPath)}" ...>
```

### Option B: Encode paths in the API response (Better)
Have `findProjects()` and `findRecentlyViewed()` return URL-safe encoded paths.

### Option C: Fix globally in protocol handler (Best)
Make the protocol handler more robust to handle both encoded and unencoded paths.

## Recommended: Option A (Quick Fix)

Simplest change, minimal risk, matches where the issue manifests.

```diff
- <img src="media://{location.heroThumbPath}" ...>
+ <img src="media://{encodeURI(location.heroThumbPath)}" ...>
```

Apply to:
- Projects section thumbnail
- Recent Locations section thumbnail

## Files to Change

| File | Change |
|------|--------|
| `Dashboard.svelte` | Add `encodeURI()` around thumbnail paths |
