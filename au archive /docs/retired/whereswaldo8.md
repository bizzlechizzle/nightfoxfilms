# Where's Waldo 8: Import Hang + UI/UX Overhaul

Date: 2025-11-22
Status: IN PROGRESS

---

## Executive Summary

The import reaches the backend successfully (file paths extracted via `file.path` fallback) but hangs during ExifTool metadata extraction. Additionally, the user has requested significant UI/UX improvements.

---

## Part 1: Import Debugging

### What's Working

1. **file.path fallback WORKS** - Despite webUtils being unavailable
2. **File paths extracted** - 15 NEF files correctly identified
3. **IPC communication works** - `media:import` reaches main process
4. **Transaction starts** - Database begins transaction
5. **SHA256 calculated** - Hash computed for deduplication check
6. **Duplicate check works** - Query runs successfully

### Where It Hangs

After the duplicate check, the import calls:
```typescript
metadata = await this.exifToolService.extractMetadata(file.filePath);
```

**No output after this** - ExifTool is either:
1. Hanging indefinitely
2. Taking very long for 25MB NEF files
3. Encountering an error that's swallowed

### Logging Added

Added logging to trace the exact hang point:

**exiftool-service.ts:**
```typescript
console.log('[ExifTool] Starting metadata extraction for:', filePath);
console.log('[ExifTool] Calling exiftool.read()...');
// await exiftool.read(filePath)
console.log('[ExifTool] Extraction completed in', Date.now() - startTime, 'ms');
```

**file-import-service.ts:**
```typescript
console.log('[FileImport] Step 5: Extracting metadata for', file.originalName, 'type:', type);
console.log('[FileImport] Calling ExifTool for image...');
// await exifToolService.extractMetadata()
console.log('[FileImport] ExifTool completed in', Date.now() - exifStart, 'ms');
```

### Recommended Fixes

1. **Add timeout to ExifTool** - Prevent infinite hangs
2. **Make metadata extraction optional** - Import should complete even if metadata fails
3. **Process outside transaction** - Extract metadata before starting DB transaction
4. **Add progress for each step** - SHA, ExifTool, Copy, Insert

---

## Part 2: UI/UX Changes Requested

### Dashboard Page

| Change | Description |
|--------|-------------|
| Remove subtitle | Remove "Overview of your abandoned location archive" |
| Stats box | Add stats box at bottom with Total Locations, etc. |
| Move "New Location" | Move to top right, across from "Dashboard" title |
| Rename button | Change "+ New Location" to "Add Location" |
| Remove buttons | Remove extra top buttons (Open Atlas, View All, Import Media) |
| Move Random | Move "Random Location" button to Special Filters section |

### Location Detail Page

| Change | Description |
|--------|-------------|
| Add star/pin | Add star icon next to location name for pinning |
| Level edit button | Make Edit button level with location name |
| Move GPS source | Move "Source: manual_entry" below the map, not above |
| Expand map | Add expand feature to open full Atlas view |

### Atlas Page

| Change | Description |
|--------|-------------|
| Default zoom | Start at highest zoom level for locations |

### Address Handling

| Change | Description |
|--------|-------------|
| Normalize addresses | Consider libpostal or similar for address normalization |
| City/State only | Show city center on map when only city/state available |
| Full address | Pull full street address/GPS when possible |

---

## Part 3: Implementation Plan

### Phase 1: Fix Import (Critical)

1. Add timeout wrapper to ExifTool (30 second max)
2. Make metadata extraction failure non-fatal
3. Move heavy operations outside transaction
4. Add per-step progress reporting

### Phase 2: Dashboard UI

1. Remove subtitle text
2. Create stats box component
3. Reorganize button layout
4. Move Random to Special Filters

### Phase 3: Location Detail UI

1. Add star/pin toggle next to name
2. Restructure header layout
3. Move GPS source indicator
4. Add "Open in Atlas" button/feature

### Phase 4: Atlas Improvements

1. Calculate optimal zoom for location clusters
2. Add smooth transition from location page

### Phase 5: Address Normalization

1. Research libpostal integration
2. Implement city center fallback for partial addresses
3. Add geocoding enhancement

---

## Files to Modify

| File | Changes |
|------|---------|
| `electron/services/exiftool-service.ts` | Add timeout, better error handling |
| `electron/services/file-import-service.ts` | Restructure transaction, add logging |
| `src/pages/Dashboard.svelte` | UI reorganization |
| `src/pages/LocationDetail.svelte` | Header layout, star, map expand |
| `src/pages/Atlas.svelte` | Default zoom logic |
| `src/stores/import-store.ts` | Per-step progress tracking |

---

## Debugging Session Log

```
[media:import] Starting import with input: { 15 files... }
[media:import] Validated input, files count: 15
select "value" from "settings" where "key" = 'archive_folder'
[media:import] Archive path: /Users/bryant/Documents/temp archvive
begin
select "imgsha" from "imgs" where "imgsha" = '56e99b23...'
--- HANGS HERE (ExifTool) ---
```

Expected next logs (with new debugging):
```
[FileImport] Step 5: Extracting metadata for _DSC8841.NEF type: image
[FileImport] Calling ExifTool for image...
[ExifTool] Starting metadata extraction for: /path/to/_DSC8841.NEF
[ExifTool] Calling exiftool.read()...
--- If successful:
[ExifTool] Extraction completed in XXXX ms
[FileImport] ExifTool completed in XXXX ms
--- If hanging/error, no further output
```

---

## webUtils Investigation Summary

**Electron module keys in preload:**
- nativeImage
- shell
- clipboard
- contextBridge
- crashReporter
- ipcRenderer
- webFrame

**Missing:** webUtils (should be present with sandbox: false)

**Workaround:** file.path fallback works, and "Select Files" button uses native dialog

---

## Previous Bugs Reference

| Waldo | Issue | Status |
|-------|-------|--------|
| 1 | Preload ESM/CJS mismatch | Fixed |
| 2 | Vite bundler adds ESM wrapper | Fixed |
| 3 | Custom copy plugin for preload | Fixed |
| 4 | webUtils undefined, file.path fallback | Partial (fallback works) |
| 5 | RAW formats missing from extension lists | Fixed |
| 6 | Import UX - blocking, no progress | Fixed |
| 7 | Select Files button, $isImporting fix | Fixed |
| **8** | **ExifTool hang, UI overhaul** | **In Progress** |

---

End of Report
