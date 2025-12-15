# Host/Sub-Location System Improvements - Implementation Guide

## Overview

This document describes three key improvements to the AU Archive host/sub-location experience:

1. **DNG Preview Quality** - Fix low-quality drone shot previews
2. **Sub-Location GPS Separation** - Buildings have independent GPS from host location
3. **Live Photo Auto-Detection** - Automatic detection during import (not manual trigger)

---

## Issue 1: DNG Preview Quality (Potato Quality Drone Shots)

### Problem
DNG RAW files often have tiny embedded previews (960x720) while the actual image is much larger (5376x3956). ExifTool extracts the embedded preview, resulting in poor quality display.

### Solution
Created `LibRawService` that uses `dcraw_emu` to render full-quality previews when the embedded preview is insufficient.

### Files Changed

| File | Changes |
|------|---------|
| `electron/services/libraw-service.ts` | NEW - LibRaw/dcraw_emu wrapper service |
| `electron/services/preview-extractor-service.ts` | Modified - Quality detection and LibRaw fallback |
| `electron/main/database.ts` | Migration 30 - Added `preview_quality` column |
| `electron/main/database.types.ts` | Added `preview_quality` to `ImgsTable` |

### Key Code: LibRawService

```typescript
// libraw-service.ts - Key methods
export class LibRawService {
  // Render full-quality preview using dcraw_emu
  async renderPreview(sourcePath: string, outputPath: string, maxSize: number = 1920): Promise<boolean>

  // Check if embedded preview is too small (<50% of source resolution)
  needsFullRender(sourceWidth, sourceHeight, previewWidth, previewHeight, threshold = 0.5): boolean

  // Get quality level for database storage
  getQualityLevel(...): 'full' | 'embedded' | 'low'
}
```

### dcraw_emu Command Flags

**IMPORTANT**: dcraw_emu uses `-Z` (not `-O`) for output filename:

```bash
dcraw_emu -T -w -o 1 -q 3 -Z /path/to/output.tiff /path/to/input.DNG
```

| Flag | Purpose |
|------|---------|
| `-T` | Output TIFF instead of PPM |
| `-w` | Use camera white balance |
| `-o 1` | sRGB color space |
| `-q 3` | High quality interpolation (AHD) |
| `-Z filename` | Output to specific file |

### Key Code: PreviewExtractorService Changes

```typescript
// NEW method that returns quality info
async extractPreviewWithQuality(
  sourcePath: string,
  hash: string,
  sourceWidth: number | null,
  sourceHeight: number | null,
  force: boolean = false
): Promise<{ previewPath: string | null; qualityLevel: 'full' | 'embedded' | 'low' }>
```

### Fixing Existing Low-Quality DNG Previews

For DNG files that were imported BEFORE this fix, you need to re-render them:

1. Go to **Settings** page
2. Scroll to "Thumbnail Management" section
3. Click **"Fix DNG Quality"** button (orange)
4. Wait for LibRaw to render all DNG files

This calls `media:regenerateDngPreviews` which:
- Finds all DNG files where `preview_quality` is null, 'low', or 'embedded'
- Uses LibRaw/dcraw_emu to render full-quality previews
- Updates database with new preview path and quality='full'

### Quality Levels

- `full` - Rendered via LibRaw (dcraw_emu) at full resolution
- `embedded` - ExifTool extracted preview at adequate resolution (>=50% of source)
- `low` - ExifTool extracted preview below 50% of source resolution

### Database Migration 30

```sql
ALTER TABLE imgs ADD COLUMN preview_quality TEXT DEFAULT 'embedded';
```

---

## Issue 2: Sub-Location GPS Separation

### Problem
When editing GPS for a building (sub-location), it was incorrectly changing the host location's GPS. Per spec, each sub-location should have its own independent GPS coordinates.

### Root Cause
The `slocs` table had NO GPS columns - buildings were sharing GPS with their host location.

### Solution
Added GPS columns to `slocs` table and updated repository/UI to handle separate GPS.

### Files Changed

| File | Changes |
|------|---------|
| `electron/main/database.ts` | Migration 31 - Added GPS columns to `slocs` |
| `electron/main/database.types.ts` | Added GPS fields to `SlocsTable` |
| `electron/repositories/sqlite-sublocation-repository.ts` | Added GPS methods |
| `electron/main/ipc-handlers/sublocations.ts` | Added GPS IPC handlers |
| `electron/preload/preload.cjs` | Added GPS API methods |
| `src/pages/LocationDetail.svelte` | Pass sub-location GPS to map |
| `src/components/location/LocationMapSection.svelte` | Display sub-location GPS, show correct modal |
| `src/components/location/SubLocationGpsModal.svelte` | NEW - GPS-only modal for buildings |

### Database Migration 31

```sql
ALTER TABLE slocs ADD COLUMN gps_lat REAL;
ALTER TABLE slocs ADD COLUMN gps_lng REAL;
ALTER TABLE slocs ADD COLUMN gps_accuracy REAL;
ALTER TABLE slocs ADD COLUMN gps_source TEXT;
ALTER TABLE slocs ADD COLUMN gps_verified_on_map INTEGER DEFAULT 0;
ALTER TABLE slocs ADD COLUMN gps_captured_at TEXT;
```

### Key Types: SubLocation GPS Interface

```typescript
interface SubLocation {
  // ... existing fields ...
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  gps_source: string | null;  // 'user_map_click', 'photo_exif', 'manual_entry'
  gps_verified_on_map: boolean;
  gps_captured_at: string | null;
}
```

### New Repository Methods

```typescript
// sqlite-sublocation-repository.ts
async updateGps(subid: string, gps: SubLocationGpsInput): Promise<SubLocation | null>
async clearGps(subid: string): Promise<SubLocation | null>
async verifyGpsOnMap(subid: string): Promise<SubLocation | null>
async findWithGpsByLocationId(locid: string): Promise<SubLocation[]>
```

### New IPC Handlers

```typescript
ipcMain.handle('sublocation:updateGps', ...)
ipcMain.handle('sublocation:clearGps', ...)
ipcMain.handle('sublocation:verifyGps', ...)
ipcMain.handle('sublocation:findWithGps', ...)
```

### UI Flow

1. `LocationDetail.svelte` checks if viewing sub-location (`isViewingSubLocation`)
2. If yes, passes `subLocation` prop and `onSubLocationGpsSave` callback to `LocationMapSection`
3. `LocationMapSection` uses `effectiveGpsLat/Lng` derived values (sub-location GPS when available)
4. When user clicks "edit":
   - **If viewing sub-location**: Opens `SubLocationGpsModal` (GPS-only)
   - **If viewing host location**: Opens `LocationEditModal` (full edit with address/GPS/region)
5. GPS saves go to the correct entity (sub-location or host location)

### Key Fix: SubLocationGpsModal

The critical bug was that `LocationEditModal` was ALWAYS editing the host location. When viewing a sub-location and clicking "edit", it would open `LocationEditModal` which modified the host's GPS.

The fix introduces `SubLocationGpsModal` - a simplified GPS-only modal for sub-locations that:
- Only shows GPS coordinates and map (no address/region - those belong to host)
- Calls `onSubLocationGpsSave` which saves to the sub-location's GPS columns
- Keeps host location GPS unchanged

---

## Issue 3: Live Photo Auto-Detection

### Problem
Live Photo detection was only triggered when UI prompted it - not automatically during import.

### Solution
Added `detectLivePhotosForLocation()` call after successful import in both `media:import` and `media:phaseImport` handlers.

### Files Changed

| File | Changes |
|------|---------|
| `electron/main/ipc-handlers/media-import.ts` | Added auto-detection after import |

### Detection Logic

The detection function matches:
1. **Live Photos**: `IMG_xxxx.HEIC` + `IMG_xxxx.MOV` pairs (video hidden)
2. **SDR Duplicates**: `filename_sdr.jpg` paired with `filename.jpg` (SDR hidden)
3. **Android Motion Photos**: EXIF flags (MotionPhoto=1, MicroVideo)

### Key Code

```typescript
// Called after import completes with result.imported > 0
async function detectLivePhotosForLocation(
  db: Kysely<Database>,
  mediaRepo: SQLiteMediaRepository,
  locid: string
): Promise<{ livePhotosHidden: number; sdrHidden: number }>

// In media:import handler:
if (result.imported > 0) {
  try {
    const livePhotoResult = await detectLivePhotosForLocation(db, mediaRepo, validatedInput.locid);
    console.log(`[media:import] Auto-detected Live Photos: ${livePhotoResult.livePhotosHidden} hidden`);
  } catch (e) { /* non-fatal */ }
}
```

---

## Testing Checklist

### DNG Preview Quality
- [ ] Import a DNG file with small embedded preview (<50% of source)
- [ ] Verify preview is rendered via LibRaw (check logs for `[LibRaw]` messages)
- [ ] Check `preview_quality` column in database is set to 'full'

### Sub-Location GPS
- [ ] Create a host location with GPS
- [ ] Add a building to the host location
- [ ] Navigate to the building's detail page
- [ ] Set GPS for the building via map click
- [ ] Verify host location GPS is unchanged
- [ ] Verify building shows its own GPS coordinates

### Live Photo Auto-Detection
- [ ] Import paired HEIC+MOV files (iPhone Live Photos)
- [ ] Check logs for `[detectLivePhotos]` messages
- [ ] Verify video is hidden with reason 'live_photo'
- [ ] Verify image is_live_photo flag is set

---

## Architecture Notes

### Binary Dependencies
Per `CLAUDE.md`, binary dependencies are welcome. `dcraw_emu` is used at `/opt/homebrew/bin/dcraw_emu` for LibRaw processing.

### Migration Pattern
Migrations are inline in `database.ts` using `sqlite.exec()`. Each migration increments `user_version`.

### GPS Source Values
- `user_map_click` - User clicked on map
- `photo_exif` - Extracted from photo EXIF
- `manual_entry` - Typed coordinates
- `geocoded_address` - Forward geocoding result

### Svelte 5 Patterns
- Use `$derived` for computed values
- Use `$state` for reactive state
- Use `$props` for component props
