# Issue: GPS Mismatch False Warnings for State-Only Locations

**Status**: ✅ Resolved
**Opened**: 2025-11-24
**Resolved**: 2025-11-24
**Priority**: P2 (Medium)
**Impact**: UX - False GPS mismatch warnings (~200km) for state-only locations
**ADR**: DECISION-008_gps-mismatch-confidence.md

## Issue Description

GPS Mismatch warnings showing ~200km differences when importing iPhone images to locations created with state-only address. Warning reads: "GPS coordinates differ by 199.90km major"

## Expected Behavior

- State-only locations should not trigger GPS mismatch warnings
- First imported image with valid EXIF GPS should set the location's GPS
- Future imports should compare against that baseline (not state center)

## Actual Behavior

- Location created with state only (no precise GPS)
- State geocoding sets location GPS to state center (e.g., Albany for NY)
- Imported iPhone images have accurate EXIF GPS from actual location
- System compares precise image GPS to imprecise state-center GPS
- Result: False "199.90km major mismatch" warnings

## Root Cause

The GPS mismatch threshold (10km) was applied uniformly regardless of GPS confidence level. State-geocoded locations (tier 5) have ±100km expected accuracy, making the 10km threshold inappropriate.

## Solution Implemented

**A + D Hybrid Approach:**

### Part 1: GPS Confidence Checking

Added two helper methods to `GPSValidator`:

1. **`shouldCheckMismatch(location)`** - Returns false for:
   - `gps_geocode_tier === 5` (state-only geocoding)
   - `gps_source === null` (no GPS set)
   - `gps_source === 'geocoded_address'` AND `gps_verified_on_map === false`

2. **`shouldAdoptMediaGPS(location)`** - Returns true for same conditions

### Part 2: Auto-Adopt First Image GPS

When importing images to a low-confidence GPS location:
- First image with valid EXIF GPS updates the location's GPS
- Source set to `'photo_exif'`
- `gps_geocode_tier` cleared (no longer state-only)
- Future imports compare against this adopted GPS

### Part 3: Keep Strict Threshold for Precise Locations

If location has map-verified or user-entered GPS, continue normal mismatch detection with 10km threshold.

## Files Modified

| File | Change |
|------|--------|
| `electron/services/gps-validator.ts` | Added `shouldCheckMismatch()` and `shouldAdoptMediaGPS()` helpers |
| `electron/services/file-import-service.ts` | Skip mismatch for low-confidence, auto-adopt GPS |
| `electron/services/phase-import-service.ts` | Same logic for phase-based import |

## Verification

- [x] Issue reproduced before fix
- [x] Fix implemented
- [x] Build passes
- [ ] Manual test confirms fix

## Notes

- Uses existing `gps_geocode_tier` field from Kanye9 cascade geocoding
- iPhone EXIF GPS is accurate and should be trusted
- Non-blocking GPS update (fire-and-forget) to prevent import deadlock
