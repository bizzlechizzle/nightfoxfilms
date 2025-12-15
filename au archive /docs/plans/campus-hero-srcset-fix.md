# Campus Hero Save + Srcset Fix - Implementation Plan

## Audit Summary

### Error Message Analysis
```
Failed parsing 'srcset' attribute value since it has an unknown descriptor.
Dropped srcset candidate "<URL>"
```

This is a **browser warning** about malformed srcset, not an API error. However, it may cause visual issues and confuse users into thinking the save failed.

### Issue 1: Malformed srcset in LocationGallery

**File:** `LocationGallery.svelte:62-65`

```javascript
srcset={`
  media://${image.thumb_path_sm || image.thumb_path}?v=${cacheVersion} 1x
  ${image.thumb_path_lg ? `, media://${image.thumb_path_lg}?v=${cacheVersion} 2x` : ''}
`}
```

**Problem:** Template literal has:
1. Extra newlines and whitespace
2. Conditional comma inside the interpolation (when thumb_path_lg exists)

**Result:** Browser receives malformed srcset like:
```
"
  media://path?v=1 1x

"
```

### Issue 2: Campus Hero Save Flow (verify working)

**Flow when setting campus hero from sub-location page:**
1. User clicks "Campus Hero" → `startFocalEdit('campus')`
2. User adjusts pin → `saveFocalEdit()`
3. `onSetHostHeroImage(hash, fx, fy)` called
4. `setHeroImageWithFocal(hash, fx, fy)` executes
5. `locations.update(locationId, { hero_imgsha, hero_focal_x, hero_focal_y })`

**Verification:** The save logic is correct. The `locationId` in LocationDetail refers to the host location ID, and `setHeroImageWithFocal` updates the host location properly.

---

## Solution

### Fix 1: Clean up srcset formatting

**File:** `LocationGallery.svelte:62-65`

Replace multi-line template with single-line conditional:

```diff
- srcset={`
-   media://${image.thumb_path_sm || image.thumb_path}?v=${cacheVersion} 1x
-   ${image.thumb_path_lg ? `, media://${image.thumb_path_lg}?v=${cacheVersion} 2x` : ''}
- `}
+ srcset={image.thumb_path_lg
+   ? `media://${image.thumb_path_sm || image.thumb_path}?v=${cacheVersion} 1x, media://${image.thumb_path_lg}?v=${cacheVersion} 2x`
+   : `media://${image.thumb_path_sm || image.thumb_path}?v=${cacheVersion} 1x`}
```

This produces clean srcset values:
- With lg: `media://sm?v=1 1x, media://lg?v=1 2x`
- Without lg: `media://sm?v=1 1x`

### Fix 2: Add user feedback for campus hero save

To make it clearer that save succeeded, ensure the modal closes and page reloads after save. (Already implemented via `loadLocation()`)

---

## Files Changed

| File | Change |
|------|--------|
| `LocationGallery.svelte` | Fix srcset template formatting |

---

## Testing Checklist

- [ ] Set campus hero from sub-location page - saves correctly
- [ ] No srcset parsing errors in console
- [ ] Gallery images display correctly with proper resolution
- [ ] Hero badge appears on correct image after setting
- [ ] Focal point persists after reload
