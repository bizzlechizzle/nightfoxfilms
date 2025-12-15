# Issue Tracking: DECISION-016

**Status**: READY FOR APP TEST
**Opened**: 2025-11-25
**Priority**: P0 - Critical

---

## CRITICAL BUG FIX: EXIF GPS Auto-Population

### Root Cause
The database UPDATE query was failing silently because it tried to set a field that doesn't exist: `gps_updated_at`

### Fix Applied
**File**: `packages/desktop/electron/services/file-import-service.ts:572-580`

Removed `gps_updated_at` from the UPDATE query. Only these valid fields remain:
- `gps_lat` ✓
- `gps_lng` ✓
- `gps_source` ✓

### Verification
- [x] Bug identified (gps_updated_at field doesn't exist in schema)
- [x] Fix applied to file-import-service.ts
- [x] Build verified (success at 3:25 AM)
- [x] Test images verified to have GPS data:
  - IMG_5961.JPG: 43° 1' 30.38" N, 73° 23' 23.09" W
  - IMG_5963.JPG: 43° 1' 25.32" N, 73° 23' 33.14" W
  - IMG_5964.JPG: 43° 1' 25.53" N, 73° 23' 33.31" W
- [ ] **USER TEST**: Run app, create location, import image, verify GPS populates

### Test Steps
1. Run `pnpm dev`
2. Create new location (state only - e.g., "Test GPS Location" in NY)
3. Navigate to Imports page
4. Select the new location
5. Import `test images/Mary McClellan Hospital/IMG_5961.JPG`
6. Check console for: `[FileImport] Location GPS auto-populated from media EXIF`
7. Navigate to location page - GPS should now display
8. Reload page - GPS should persist (database update worked)

---

## Location Page UI Completion (from earlier today)

### Completed Tasks

#### ImportModal.svelte
- [x] Changed "Access Status" label to "Status"
- [x] Added 4 documentation checkbox state variables
- [x] Replaced Documentation dropdown with 4 checkboxes (Interior, Exterior, Drone, Web-History)
- [x] Updated handleSubmit to include doc flags
- [x] Updated resetForm to reset doc checkboxes
- [x] Updated getSubTypeSuggestions() to filter by selected Type
- [x] Removed unused DOCUMENTATION_OPTIONS import

#### LocationInfo.svelte
- [x] Replaced ✓/✗ symbols with colored dots (green=verified, red=incomplete)

#### LocationMapSection.svelte
- [x] Added verification derived states (isAddressVerified, isGpsVerified, isAreaVerified)
- [x] Added colored dot to "Location" header
- [x] Added colored dot to "Mailing Address" section header
- [x] Added colored dot to "GPS" section header
- [x] Added colored dot to "Area" section header
- [x] Removed legacy "Regions" block
- [x] Removed location.regions from hasAreaData check

---

## Previously Completed (DECISION-015)

- [x] Fix Atlas isMappable() - KISS (only show locations with GPS)
- [x] Remove edit button from LocationHeader
- [x] Fix county display order in LocationMapSection
- [x] Add Sub-Type field to ImportModal
- [x] EXIF GPS auto-population in file-import-service.ts (BUG FIXED)

---

## Deferred (Optional)

- [ ] Layer dropdown on mini map (Map.svelte)
- [ ] Allow limited zoom on limitedInteraction mini maps

---

## Reference

Previous decisions:
- DECISION-016: UI completion + EXIF GPS bug fix
- DECISION-015: Sub-Type field, EXIF GPS auto-population
- DECISION-014: GPS contract fix, verification checkmarks removal
- DECISION-013: Location Page Redesign Phase 2
- DECISION-012: Region auto-population
- DECISION-011: Location box redesign
