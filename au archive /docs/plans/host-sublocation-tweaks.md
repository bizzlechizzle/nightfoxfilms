# Host/Sub-Location Tweaks - Revised Plan

## Database Investigation Results

Actual database state at `/packages/desktop/data/au-archive.db`:
- **1 location:** Willard Asylum for the Chronic Insane
- **1 sub-location:** Morgue (with hero_imgsha set)
- **413 images:** 2 marked as `is_live_photo=1`
- **2 videos:** Both marked as `hidden=1, hidden_reason='live_photo', is_live_photo=1`

---

## Issue 1: DNG Preview Quality ("Potato Drone Shot") [CRITICAL]

### Root Cause (Verified)
```
File: DJI_0219.DNG (Hasselblad L2D-20c / DJI Mavic 3 drone)
Actual resolution: 5376 x 3956
Extracted preview: 960 x 720 ← POTATO!
```

The `PreviewExtractorService` (line 19) explicitly states:
> "ExifTool only - Do not add LibRaw, dcraw, or WASM decoders"

DJI DNG files have tiny embedded previews (960x720). The service extracts the **largest embedded JPEG** but cannot process the actual RAW data.

### Solution Options

**Option A: dcraw_emu Integration (Recommended)**
- `dcraw_emu` is available at `/opt/homebrew/bin/dcraw_emu`
- Use for DNG/RAW files where extracted preview is < 50% of actual resolution
- Pipeline: `dcraw_emu -T -w input.dng` → PPM → sharp → JPEG
- Pros: Works offline, fast (~2-3s per image)
- Cons: Need to bundle dcraw_emu for distribution

**Option B: Quality Threshold Detection**
- Detect when extracted preview is "too small" (e.g., preview < 1920px when source > 3840px)
- Mark as "needs_full_render" flag in database
- Show warning to user with "Render Full Quality" button
- Render only on-demand, not during import

### Proposed Change
1. Add `libraw-service.ts` using `dcraw_emu` for RAW → JPEG conversion
2. Modify `PreviewExtractorService.extractPreview()`:
   - After ExifTool extraction, check if preview resolution is < 50% of source resolution
   - If yes and dcraw_emu available, render full-quality preview
   - If dcraw_emu not available, mark `preview_quality = 'low'` in database
3. Add `preview_quality` column to imgs table (values: 'full', 'embedded', 'low')
4. UI shows quality indicator when `preview_quality = 'low'`

### Files to Modify
- `packages/desktop/electron/services/preview-extractor-service.ts`
- `packages/desktop/electron/services/libraw-service.ts` (NEW)
- `migrations/NNNN_add_preview_quality.ts` (NEW)

**Complexity:** High

---

## Issue 2: Live Photo Detection - UI HAD TO PROMPT

### Investigation Result
Database shows Live Photo records are correct:
```sql
-- Videos (hidden as expected):
IMG_3014.mov → hidden=1, hidden_reason='live_photo', is_live_photo=1
IMG_3015.mov → hidden=1, hidden_reason='live_photo', is_live_photo=1

-- Matching images (marked as live photo):
IMG_3014.HEIC → is_live_photo=1
IMG_3015.HEIC → is_live_photo=1
```

### Problem
User says "UI had to prompt it" - meaning auto-detection on import isn't triggering.
Detection runs in `file-import-service.ts` Step 10 `detectAndHideLivePhotosAndSDR()`.

### Investigation Needed
- Check if Step 10 is being reached during import
- Check if files are imported in same batch (matching requires both image + video in same import)
- Check console logs during import to verify step execution

### Files to Check
- `packages/desktop/electron/services/file-import-service.ts` (Step 10)
- IPC handlers to ensure import chain completes

**Status:** Needs investigation

---

## Issue 3: GPS "Still Linked" [ROOT CAUSE FOUND]

### Root Cause (Verified)
**Sub-locations do NOT have GPS columns in the schema!**

```sql
-- locs table HAS GPS columns:
gps_lat, gps_lng, gps_accuracy, gps_source, gps_verified_on_map, gps_captured_at

-- slocs table DOES NOT have GPS columns:
CREATE TABLE slocs (subid, sub12, locid, subnam, ssubname, type, status, hero_imgsha, ...)
-- NO gps_lat, gps_lng, etc.
```

When user edits GPS on a sub-location view, it updates the **parent location's GPS** (via `locid`), not the sub-location's own GPS - because sub-locations have no GPS storage!

### User Expectation (Per Spec)
Each sub-location should have its **own GPS coordinates**, separate from the host location.
- Host location = campus-level GPS (e.g., main entrance)
- Sub-location = building-specific GPS (e.g., Morgue building)

### Solution Required
1. **Migration:** Add GPS columns to `slocs` table
2. **Repository:** Add GPS methods to sublocation repository
3. **UI:** When editing GPS on sub-location view, update `slocs.gps_*` not `locs.gps_*`
4. **Map:** Show separate pins for host and each sub-location with GPS

### Migration SQL
```sql
ALTER TABLE slocs ADD COLUMN gps_lat REAL;
ALTER TABLE slocs ADD COLUMN gps_lng REAL;
ALTER TABLE slocs ADD COLUMN gps_accuracy REAL;
ALTER TABLE slocs ADD COLUMN gps_source TEXT;
ALTER TABLE slocs ADD COLUMN gps_verified_on_map INTEGER DEFAULT 0;
ALTER TABLE slocs ADD COLUMN gps_captured_at TEXT;
```

**Complexity:** Medium-High (schema change + UI changes)

---

## Issue 4: Buildings & Structures Thumbnail Query [COMPLETED]

Already fixed in `sqlite-sublocation-repository.ts:findWithHeroImages()`:
- Now uses COALESCE across all thumbnail columns
- LEFT JOIN instead of N+1 queries

**Status:** Implemented, needs verification.

---

## Issue 5-8: Previous Implementations [NEEDS VERIFICATION]

These were implemented before database investigation:

| Issue | Description | Status |
|-------|-------------|--------|
| 5 | GPS funneling from sub-locations | Already works (verified) |
| 6 | Hero button jump fix | Implemented (fixed height + preview) |
| 7 | Set Campus Hero from sub-location | Implemented (side-by-side buttons) |
| 8 | Host map zoom out | Implemented (extraZoomOut prop) |

**Action:** Test all implementations in running app before closing.

---

## Revised Implementation Plan

### Phase 1: DNG Preview Quality (Issue 1) [APPROVED]
1. Create `libraw-service.ts` with dcraw_emu integration
2. Modify `PreviewExtractorService.extractPreview()` to detect low-quality previews
3. Add migration for `preview_quality` column
4. Test with DJI DNG file (b8eeec73...)

### Phase 2: Sub-Location GPS Schema (Issue 3) [APPROVED]
1. Create migration to add GPS columns to `slocs` table
2. Update `sqlite-sublocation-repository.ts` with GPS methods
3. Modify UI to update sub-location GPS (not parent) when viewing sub-location
4. Update map to show pins for both host and sub-locations

### Phase 3: Live Photo Investigation (Issue 2)
1. Add logging to Step 10 to verify it's being reached
2. Test fresh import with HEIC + MOV pair
3. Verify matching logic with original filenames

### Phase 4: Verification
1. Test all Issue 5-8 implementations in app
2. Verify sub-location thumbnails showing in grid

---

## Migrations Required

### Migration 1: Preview Quality
```sql
ALTER TABLE imgs ADD COLUMN preview_quality TEXT DEFAULT 'embedded';
-- Values: 'full' (dcraw rendered), 'embedded' (ExifTool extracted), 'low' (< 50% resolution)
```

### Migration 2: Sub-Location GPS
```sql
ALTER TABLE slocs ADD COLUMN gps_lat REAL;
ALTER TABLE slocs ADD COLUMN gps_lng REAL;
ALTER TABLE slocs ADD COLUMN gps_accuracy REAL;
ALTER TABLE slocs ADD COLUMN gps_source TEXT;
ALTER TABLE slocs ADD COLUMN gps_verified_on_map INTEGER DEFAULT 0;
ALTER TABLE slocs ADD COLUMN gps_captured_at TEXT;
```

---

## dcraw_emu Usage (for reference)

```bash
# Convert DNG to PPM (preserves full resolution)
/opt/homebrew/bin/dcraw_emu -T -w -o 1 -q 3 DJI_0219.DNG
# Output: DJI_0219.tiff (5376x3956)

# Then use sharp to convert to JPEG preview
```

Flags:
- `-T`: Output TIFF instead of PPM
- `-w`: Use camera white balance
- `-o 1`: sRGB color space
- `-q 3`: High quality interpolation
