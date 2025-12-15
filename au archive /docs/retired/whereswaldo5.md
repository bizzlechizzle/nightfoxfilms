# Where's Waldo 5: RAW Image Format Support Missing

Date: 2025-11-22
Status: RESOLVED

---

## Executive Summary

File import drag-drop was working perfectly - the preload script successfully extracted 15 file paths. The bug was in the `media:expandPaths` handler which filters files by extension. **RAW image formats (NEF, CR2, DNG, etc.) were not in the supported extensions list**, causing all dropped files to be filtered out.

---

## The Problem

### Symptom
User drops 15 `.NEF` (Nikon RAW) files onto the import area. Console shows:
```
[Preload] Total paths extracted: 15
[LocationDetail] Got dropped paths from preload: (15) [...]
```

But import fails with "No supported media files found"

### User's Console Logs (Annotated)

```
[Preload] Drop event captured          <-- WORKING
[Preload] Processing 15 dropped files  <-- WORKING
[Preload] Got path via file.path (fallback): .../_DSC8841.NEF  <-- WORKING
... (15 paths extracted) ...
[Preload] Total paths extracted: 15    <-- WORKING
[Preload] getDroppedFilePaths called, returning 15 paths  <-- WORKING
[LocationDetail] Got dropped paths from preload: (15) [...] <-- WORKING
```

What happens next (invisibly):
1. `expandPaths` is called with 15 `.NEF` paths
2. Each path is checked: `ext = '.nef'`
3. `.nef` is NOT in `supportedExts`
4. ALL 15 files filtered out
5. Returns empty array
6. UI shows "No supported media files found"

---

## Root Cause Analysis

### Bug Location 1: `ipc-handlers.ts:416-420`

```typescript
// media:expandPaths handler
const supportedExts = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp',  // <-- NO RAW FORMATS
  'mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm',
  'pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'
]);
```

Missing RAW formats:
- `nef` (Nikon)
- `cr2`, `cr3` (Canon)
- `arw` (Sony)
- `dng` (Adobe DNG universal)
- `orf` (Olympus)
- `raf` (Fuji)
- `rw2` (Panasonic)
- `pef` (Pentax)
- `srw` (Samsung)

### Bug Location 2: `file-import-service.ts:52`

```typescript
private readonly IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'];
// <-- ALSO MISSING RAW FORMATS
```

This would cause a secondary failure even if files passed the first filter.

---

## Why This Wasn't Caught Before

1. Previous whereswaldo reports focused on the **preload script** and **webUtils** issues
2. Those were real bugs that were fixed
3. Once drag-drop started extracting paths, testing stopped
4. Nobody tested with RAW files (probably used .jpg for testing)
5. The extension lists were never audited for completeness

---

## The Fix (IMPLEMENTED)

### Files Changed

1. **`electron/main/ipc-handlers.ts`**
   - `media:expandPaths` handler - now accepts ALL files with extensions
   - `media:selectFiles` dialog filters - comprehensive extension list
   - System files filtered out (Thumbs.db, desktop.ini, etc.)

2. **`electron/services/file-import-service.ts`**
   - `IMAGE_EXTENSIONS` - comprehensive ExifTool-supported formats
   - `VIDEO_EXTENSIONS` - comprehensive FFprobe-supported formats
   - `MAP_EXTENSIONS` - GeoTIFF, KML, GeoJSON, Shapefile, etc.
   - `DOCUMENT_EXTENSIONS` - comprehensive document formats
   - **NEW LOGIC**: image -> video -> map -> **document (default)**
   - Removed 'unknown' type - no more file rejections
   - Added `maps` table support for map file imports

### Implementation Philosophy

**"If ExifTool supports it, we support it. If FFprobe supports it, we support it."**

The extension lists were updated to include ALL formats supported by the underlying tools:
- ExifTool for images (including 40+ RAW formats)
- FFprobe/FFmpeg for videos (including 50+ container formats)

### Comprehensive Format Lists Added

**Images (ExifTool supported):**
- Standard: jpg, jpeg, jpe, jfif, png, gif, bmp, tiff, tif, webp
- JPEG 2000: jp2, jpx, j2k, j2c
- Modern: jxl (JPEG XL), heic, heif, hif, avif
- Professional: psd, psb, ai, eps, epsf, exr, hdr, dpx
- RAW (ALL manufacturers): nef, nrw, cr2, cr3, crw, ciff, arw, arq, srf, sr2, dng, orf, ori, raf, rw2, raw, rwl, pef, ptx, srw, x3f, 3fr, fff, dcr, k25, kdc, mef, mos, mrw, erf, iiq, rwz, gpr
- And many more...

**Videos (FFprobe supported):**
- Common: mp4, m4v, mov, qt, avi, mkv, webm, wmv, flv
- Broadcast: ts, mts, m2ts, mxf, gxf
- Legacy: mpg, mpeg, vob, 3gp, rm, rmvb, dv
- Specialty: ogv, ogg, bik, smk, dpg
- And many more...

**Maps (NEW):**
- GeoTIFF, GPX, KML/KMZ, Shapefiles, GeoJSON, OSM, MBTiles

**Documents:**
- Office: doc, docx, xls, xlsx, ppt, pptx (including macro variants)
- Open formats: odt, ods, odp, odg
- E-books: pdf, epub, mobi, azw, azw3, djvu
- Data: csv, tsv, txt, log
- **EVERYTHING ELSE**: Any file not matching image/video/map is cataloged as a document

---

## Verification Steps

After fix:

1. Rebuild: `pnpm run build` or restart `pnpm run dev`
2. Navigate to a location
3. Drag 15 .NEF files onto the import area
4. Check console for:
   ```
   [Preload] Total paths extracted: 15
   [media:import] Starting import with input: ...
   [media:import] Validated input, files count: 15
   ```
5. Should see "Imported 15 files" success message
6. Files should appear in the location's image gallery

---

## Previous Bugs vs This Bug

| Bug | Where | What |
|-----|-------|------|
| Waldo 1 | preload/index.ts | ESM import in CJS file |
| Waldo 2 | vite.config.ts | Vite bundler adding ESM wrapper |
| Waldo 3 | vite.config.ts | Used custom copy plugin |
| Waldo 4 | preload/preload.cjs | webUtils undefined, added file.path fallback |
| **Waldo 5** | **ipc-handlers.ts + file-import-service.ts** | **RAW formats missing from extension lists** |

---

## Lessons Learned

1. **Test with real data** - Using only .jpg files for testing missed this bug
2. **Complete the flow** - Debug ended when paths were extracted, not when import succeeded
3. **Extension lists need maintenance** - As camera manufacturers release new formats, lists need updates
4. **Two-layer validation = two places to fix** - The expandPaths AND import service both filter by extension

---

## Sources

- [Electron webUtils Documentation](https://www.electronjs.org/docs/latest/api/web-utils)
- [Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)

---

End of Report
