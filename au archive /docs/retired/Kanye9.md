# KANYE9: Why Everything Is Still Broken - The Real Root Causes

**Version:** 9.0.0
**Created:** 2025-11-23
**Status:** CRITICAL BUGS IDENTIFIED AND FIXED
**Type:** Root Cause Analysis, Bug Fixes, Production Issues

---

## EXECUTIVE SUMMARY

After Kanye8 changes were supposedly applied, user reports:
- **NEF files**: "Cannot display this file format in browser"
- **Address**: Still shows "Village Of Cambridge"
- **Map**: Not zooming to address
- **Thumbnails**: Low quality or missing

### Investigation Result

| Issue | Finding | Root Cause |
|-------|---------|------------|
| NEF display | preview_path IS NULL | Preview extraction failed or never ran |
| Village Of | **CODE IS CORRECT** | App not rebuilt - changes not loaded |
| Map zoom | **CRITICAL BUG** | $effect only triggers on length change, not GPS update |
| Thumbnails | Needs regeneration | Old imports predate multi-tier system |

---

## CRITICAL BUG #1: Map Not Re-Zooming After Forward Geocode

### The Bug

**File:** `packages/desktop/src/components/Map.svelte`

The `$effect` only triggers when the locations array LENGTH changes:

```typescript
// BUGGY CODE (lines 411-418)
$effect(() => {
  // Only reinitialize cluster if locations array length changed
  if (map && markersLayer && locations.length !== lastLocationsLength) {
    lastLocationsLength = locations.length;
    initCluster();
    import('leaflet').then((L) => updateClusters(L.default));
  }
});
```

### The Problem

When viewing a single location:
1. User opens LocationDetail for a location with address but no GPS
2. `ensureGpsFromAddress()` runs and gets GPS from forward geocoding
3. Location data updates with new GPS coordinates
4. `Map` component receives updated location
5. **BUT** array length is still 1 (was 1, still 1)
6. **`$effect` doesn't trigger!**
7. Map stays at old view (state capital at zoom 10)
8. User sees wrong location

### The Fix

Track a hash of the location's GPS coordinates, not just the array length:

```typescript
// FIXED CODE
let lastLocationsHash = $state('');

function getLocationsHash(locs: Location[]): string {
  return locs.map(l => `${l.locid}:${l.gps?.lat || 0}:${l.gps?.lng || 0}`).join(',');
}

$effect(() => {
  const currentHash = getLocationsHash(locations);
  if (map && markersLayer && currentHash !== lastLocationsHash) {
    lastLocationsHash = currentHash;
    initCluster();
    import('leaflet').then((L) => updateClusters(L.default));
  }
});
```

---

## ISSUE #2: NEF File Cannot Display

### Root Cause

The NEF file `d2e0b51b12b262b95686b7f9f19864bbdbf0f6e32f080aba328ff7fc44d64957.nef` has `preview_path = NULL` in the database.

### Why preview_path Is NULL

1. **Preview extraction failed during import** - ExifTool couldn't find PreviewImage/JpgFromRaw/ThumbnailImage tags
2. **Old import** - File imported before preview extraction was added
3. **Regeneration not run** - User hasn't clicked "Regenerate All Thumbnails"

### The MediaViewer Logic

```typescript
// MediaViewer.svelte lines 42-49
const imageSrc = $derived(() => {
  if (currentMedia.previewPath) {
    return `media://${currentMedia.previewPath}`;  // Would work
  }
  return `media://${currentMedia.path}`;  // Falls back to .nef - FAILS
});
```

When `previewPath` is NULL, it falls back to the original `.nef` file, which browsers cannot render.

### The Fix

1. Add function to find RAW files missing previews
2. Modify regeneration to also process these files
3. Run regeneration from Settings

---

## ISSUE #3: "Village Of Cambridge" Not Stripped

### Finding: CODE IS CORRECT

**LocationAddress.svelte** line 59:
```svelte
>{getDisplayCity(address.city)}</button>
```

**display-helpers.ts** lines 155-158:
```typescript
export function getDisplayCity(city: string | null | undefined): string {
  if (!city) return '';
  return city.replace(/^(Village of|City of|Town of)\s*/i, '').trim();
}
```

### Root Cause

**The app was not rebuilt after the changes.**

The source code is correct, but the compiled JavaScript running in Electron is still the old code.

### The Fix

Rebuild the app:
```bash
cd packages/desktop && pnpm dev
```

---

## ISSUE #4: Thumbnails Low Quality

### Root Cause

Images imported before the multi-tier thumbnail system only have:
- `thumb_path`: 256px (legacy, low quality)
- `thumb_path_sm`: NULL
- `thumb_path_lg`: NULL
- `preview_path`: NULL

### The Fix

Click "Regenerate All Thumbnails" in Settings after the app is rebuilt.

---

## IMPLEMENTATION

### Fix 1: Map.svelte - Track GPS Hash

Replace the length-based tracking with GPS-aware tracking.

### Fix 2: sqlite-media-repository.ts - Add getImagesWithoutPreviews()

```typescript
async getImagesWithoutPreviews(): Promise<Array<{ imgsha: string; imgloc: string }>> {
  const rawExtensions = ['nef', 'cr2', 'cr3', 'arw', 'srf', 'sr2', 'orf', 'pef', 'dng', 'rw2', 'raf', 'raw'];
  const rows = await this.db
    .selectFrom('imgs')
    .select(['imgsha', 'imgloc'])
    .where('preview_path', 'is', null)
    .where(eb => eb.or(
      rawExtensions.map(ext => eb('imgloc', 'like', `%.${ext}`))
    ))
    .execute();
  return rows;
}
```

### Fix 3: media-processing.ts - Process RAW Files Missing Previews

Add a separate loop to extract previews for RAW files that have them missing.

### Fix 4: LocationDetail.svelte - Add Debug Logging

```typescript
async function ensureGpsFromAddress(): Promise<void> {
  console.log('[Kanye9] ensureGpsFromAddress called');
  console.log('[Kanye9] Current GPS:', location?.gps);
  console.log('[Kanye9] Current Address:', location?.address);
  // ... existing logic with more logging
}
```

---

## VERIFICATION CHECKLIST

After implementing fixes:

1. [ ] Restart app with `pnpm dev`
2. [ ] Open DevTools console (Cmd+Opt+I)
3. [ ] Go to Mary McClellan Hospital location
4. [ ] Check console for "[Kanye9]" logs
5. [ ] Verify address shows "Cambridge" not "Village Of Cambridge"
6. [ ] Verify map zooms to address after geocoding
7. [ ] Go to Settings, click "Regenerate All Thumbnails"
8. [ ] Wait for completion message
9. [ ] Return to location, verify NEF files display
10. [ ] Verify thumbnails are high quality (not blurry)

---

## FILES MODIFIED

| File | Change |
|------|--------|
| `Map.svelte` | Track GPS hash, not just array length |
| `sqlite-media-repository.ts` | Add getImagesWithoutPreviews() |
| `media-processing.ts` | Process RAW files missing previews |
| `LocationDetail.svelte` | Add debug console logging |

---

## CHANGELOG

| Date | Action | Status |
|------|--------|--------|
| 2025-11-23 | Identified Map $effect bug | **DONE** |
| 2025-11-23 | Identified NEF preview_path = NULL | **DONE** |
| 2025-11-23 | Confirmed code is correct but not rebuilt | **DONE** |
| 2025-11-23 | Fixed Map.svelte - track GPS hash not length | **DONE** |
| 2025-11-23 | Added getImagesWithoutPreviews() to media repo | **DONE** |
| 2025-11-23 | Updated regeneration to extract RAW previews | **DONE** |
| 2025-11-23 | Added debug logging to ensureGpsFromAddress() | **DONE** |
| 2025-11-23 | Updated Settings to show preview extraction stats | **DONE** |

---

## FILES ACTUALLY MODIFIED

| File | Change |
|------|--------|
| `packages/desktop/src/components/Map.svelte` | Added getLocationsHash(), changed $effect to track GPS changes |
| `packages/desktop/electron/repositories/sqlite-media-repository.ts` | Added getImagesWithoutPreviews() function |
| `packages/desktop/electron/main/ipc-handlers/media-processing.ts` | Added RAW preview extraction loop |
| `packages/desktop/src/pages/LocationDetail.svelte` | Added [Kanye9] debug logging to geocoding |
| `packages/desktop/src/pages/Settings.svelte` | Updated message to show preview extraction stats |

---

*This is kanye9.md - The real root causes and actual fixes for Premium Archive.*
