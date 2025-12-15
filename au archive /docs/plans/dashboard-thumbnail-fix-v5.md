# Dashboard Thumbnail Fix - Version 5 (ULTRATHINK)

## Executive Summary

Dashboard thumbnails are not loading despite:
- Database containing correct `hero_imgsha` values
- Thumbnail files existing on disk
- `media://` protocol handler being correctly configured
- `encodeURI()` being applied to paths

## Root Cause Analysis (DEEP AUDIT)

### What Works
LocationHero.svelte (line 81) successfully displays thumbnails with:
```svelte
src={`media://${heroSrc}?v=${cacheVersion}`}
```
- NO `encodeURI()` used
- HAS cache buster `?v=${cacheVersion}`

### What Doesn't Work
Dashboard.svelte (lines 221, 282):
```svelte
src="media://{encodeURI(location.heroThumbPath)}"
```
- HAS `encodeURI()` (DIFFERENT)
- NO cache buster (DIFFERENT)

### Data Verification (All Correct)
| Item | Status |
|------|--------|
| Willard has `project=1` | Verified |
| Willard has `hero_imgsha=e7ad8825...` | Verified |
| imgs table has `thumb_path_sm` for that sha | Verified |
| File exists at that path (50KB) | Verified |
| Path contains space: `au archive ` | Verified |
| Protocol handler decodes correctly | Verified via Node test |

### The Actual Issue

**FINDING**: Other components like LocationHero.svelte DO NOT use `encodeURI()` and work perfectly with space-containing paths.

The original root cause analysis was PARTIALLY INCORRECT:
- The space in the path is NOT the problem per se
- Electron's URL parsing handles spaces in `media://` URLs automatically
- The `encodeURI()` fix may be unnecessary or even causing issues

**PRIMARY FIX NEEDED**: Match the working pattern from LocationHero.svelte:
1. Remove `encodeURI()` - unnecessary and potentially causing double-encoding
2. Add cache buster `?v=${cacheVersion}` - ensures fresh loads after thumbnail regeneration
3. Import the `thumbnailCache` store

## Implementation Plan

### Step 1: Add thumbnailCache import to Dashboard.svelte
```diff
+ import { thumbnailCache } from '../stores/thumbnail-cache-store';
```

### Step 2: Add cacheVersion derived variable
```diff
+ const cacheVersion = $derived($thumbnailCache);
```

### Step 3: Fix Projects section thumbnail (line 221)
```diff
- <img src="media://{encodeURI(location.heroThumbPath)}" alt="" class="w-full h-full object-cover" />
+ <img src={`media://${location.heroThumbPath}?v=${cacheVersion}`} alt="" class="w-full h-full object-cover" />
```

### Step 4: Fix Recent Locations section thumbnail (line 282)
```diff
- <img src="media://{encodeURI(location.heroThumbPath)}" alt="" class="w-full h-full object-cover" />
+ <img src={`media://${location.heroThumbPath}?v=${cacheVersion}`} alt="" class="w-full h-full object-cover" />
```

## Why This Fix Works

1. **Pattern Consistency**: Uses exact same URL construction as LocationHero.svelte which works
2. **Cache Busting**: The `?v=${cacheVersion}` prevents stale cached responses
3. **Removes Double-Encoding Risk**: By not using `encodeURI()`, we avoid potential double-encoding
4. **Electron Handles Spaces**: The media:// protocol handler's `new URL()` + `decodeURIComponent()` handles spaces correctly

## Files to Change

| File | Changes |
|------|---------|
| `Dashboard.svelte` | Add import, add cacheVersion, fix 2 img tags |

## Testing Checklist

- [ ] Dashboard loads without errors
- [ ] Projects section shows Willard with thumbnail
- [ ] Recent Locations section shows Willard with thumbnail
- [ ] Thumbnails load from correct path
- [ ] No console errors related to media:// protocol
- [ ] Compare with LocationDetail page to verify consistency

## Risk Assessment

- **Low Risk**: Changes follow established working pattern
- **Rollback**: Simple revert if issues occur
- **Side Effects**: None expected - only affects Dashboard thumbnail display
