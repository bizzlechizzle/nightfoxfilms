# DECISION-008: GPS Mismatch Confidence-Aware Checking

**Date**: 2025-11-24
**Status**: Accepted
**Related Issue**: docs/resolved-issues/2025-11-24_gps-mismatch-state-only.md

## Context

The import system compares media EXIF GPS coordinates against location GPS to detect potential mismatches (files imported to wrong location). A 10km threshold triggers warnings.

However, locations can be created with varying GPS confidence levels:
1. **User map click** - High confidence (exact click location)
2. **Photo EXIF** - High confidence (device GPS)
3. **Full address geocode** - Medium confidence (~100m accuracy)
4. **State-only geocode** - Low confidence (state center, ~100km accuracy)

The 10km threshold is appropriate for (1-3) but causes false positives for (4).

### Problem Scenario

1. User creates location with only state (required field)
2. Kanye9 cascade geocoding sets GPS to state center (Albany for NY)
3. User imports iPhone photos with accurate EXIF GPS from actual location
4. System reports "GPS differs by 199.90km major" - false alarm

## Decision

### 1. Confidence-Aware Mismatch Checking

Skip GPS mismatch warnings for low-confidence location GPS:

```typescript
static shouldCheckMismatch(location: LocationGPSInfo): boolean {
  // Skip if no GPS, no source, state-only tier, or unverified geocode
  if (location.gps_geocode_tier === 5) return false;
  if (!location.gps_source) return false;
  if (location.gps_source === 'geocoded_address' && !location.gps_verified_on_map) return false;
  return true;
}
```

### 2. Auto-Adopt Media GPS

When importing to a low-confidence location, adopt GPS from first media with valid EXIF:

```typescript
if (GPSValidator.shouldAdoptMediaGPS(location)) {
  await updateLocationGPS(locid, {
    lat: mediaGPS.lat,
    lng: mediaGPS.lng,
    source: 'photo_exif',
    gps_geocode_tier: null  // Clear state-only tier
  });
}
```

### 3. Preserve Strict Checking for Precise Locations

If location has:
- `gps_source === 'user_map_click'`
- `gps_source === 'photo_exif'`
- `gps_verified_on_map === true`

Continue using 10km threshold for mismatch detection.

## Consequences

### Positive

- **No false alarms** for state-only locations
- **Auto-improvement** - First import sets precise GPS
- **Backward compatible** - Existing precise locations unchanged
- **Leverages existing data** - Uses `gps_geocode_tier` from Kanye9

### Negative

- **Slightly delayed mismatch detection** - First import to state-only location won't warn even if genuinely wrong (but will for subsequent files)
- **Additional DB update** - GPS adoption writes to locs table during import

### Neutral

- Uses existing database fields (no migration needed)
- Non-blocking GPS update (fire-and-forget pattern)
- Pattern consistent with existing GPS confidence hierarchy

## GPS Confidence Hierarchy (Reference)

| Tier | Source | Expected Accuracy | Mismatch Check |
|------|--------|-------------------|----------------|
| 1 | User map click | ~10m | Yes |
| 2 | Photo EXIF | ~10m | Yes |
| 3 | Full address geocode (verified) | ~100m | Yes |
| 4 | Partial address geocode (unverified) | ~1km | No |
| 5 | State-only geocode | ~100km | No |

## Files Changed

| File | Change |
|------|--------|
| `electron/services/gps-validator.ts` | Added `shouldCheckMismatch()`, `shouldAdoptMediaGPS()` |
| `electron/services/file-import-service.ts` | Integrated confidence checking |
| `electron/services/phase-import-service.ts` | Same integration |
