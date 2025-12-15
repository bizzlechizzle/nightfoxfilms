# PLAN: Reference Map Enrichment Address/Region Normalization Gap

**Date**: 2024-12-01
**Status**: Audit Complete - Awaiting Approval
**Category**: Bug Fix / Data Integrity

---

## Issue Summary

When a location is matched from a reference map during import and the user approves GPS enrichment, the system correctly applies GPS coordinates but does **NOT** backfill:
1. Address fields (street, city, county, state, zipcode) via reverse geocoding
2. Region fields (census_region, census_division, state_direction, cultural_region, country_cultural_region)

This results in locations with GPS coordinates but empty Local/Region sections.

---

## Audit Findings

### Code Paths Analyzed

| Handler | Reverse Geocoding | Region Calculation | Status |
|---------|-------------------|-------------------|--------|
| `location:create` | N/A (uses input address) | ✅ calculateRegionFields | OK |
| `location:update` | N/A (uses input address) | ✅ Auto-recalc when GPS/address changes | OK |
| `refMaps:importWithOptions` | ✅ GeocodingService | ✅ calculateRegionFields | OK |
| `refMaps:applyEnrichment` | ❌ **MISSING** | ❌ **MISSING** | **GAP** |
| `refMaps:applyAllEnrichments` | ❌ **MISSING** | ❌ **MISSING** | **GAP** |
| `file-import-service` postImport | ✅ GeocodingService | ✅ recalculateRegionsForLocation | OK |

### Root Cause

The `refMaps:applyEnrichment` and `refMaps:applyAllEnrichments` handlers (ref-maps.ts lines 844-980) directly update the database with ONLY GPS fields:
- `gps_lat`, `gps_lng`, `gps_source`, `gps_verified_on_map`, `gps_accuracy`, `gps_captured_at`

They bypass:
1. **GeocodingService.reverseGeocode()** - would get address from GPS
2. **calculateRegionFields()** - would compute census/direction/cultural regions

### Why This Wasn't Caught

The `refMaps:importWithOptions` handler (used in the import preview flow) was fixed comprehensively in commits `bf096e8` through `9c445c7`. However, the individual enrichment handlers that are called when users manually approve matches were not updated to match.

---

## Affected Flows

1. **Atlas "Link" button** → Calls `refMaps:linkToLocation` (linking only, no GPS - OK)
2. **Import Preview "Apply GPS" for single match** → Calls `refMaps:applyEnrichment` → **BUG**
3. **Import Preview "Apply All" batch** → Calls `refMaps:applyAllEnrichments` → **BUG**

---

## Proposed Fix

### File: `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

#### Fix 1: `refMaps:applyEnrichment` (lines 844-904)

**Current behavior**: Only updates GPS fields
**Fixed behavior**:
1. Reverse geocode GPS to get address
2. Calculate region fields from state/county/GPS
3. Update location with GPS + address + region fields

#### Fix 2: `refMaps:applyAllEnrichments` (lines 910-980)

**Current behavior**: Only updates GPS fields in batch
**Fixed behavior**: Same as Fix 1, applied to each location in the batch

### Implementation Pattern

Copy the enrichment pattern from `refMaps:importWithOptions` (lines 529-618):

```typescript
// Step 1: Reverse geocode to get address
let addressData = {};
try {
  const geocodeResult = await geocodingService.reverseGeocode(refPoint.lat, refPoint.lng);
  if (geocodeResult?.address) {
    addressData = {
      street: geocodeResult.address.street || null,
      city: geocodeResult.address.city || null,
      county: geocodeResult.address.county || null,
      state: geocodeResult.address.stateCode || null,
      zipcode: geocodeResult.address.zipcode || null,
    };
  }
} catch (geoError) {
  console.warn(`[RefMaps] Reverse geocoding failed, continuing with GPS only`);
}

// Step 2: Calculate region fields
const regionFields = calculateRegionFields({
  state: addressData.state || AddressNormalizer.normalizeStateCode(refPoint.state),
  county: addressData.county,
  lat: refPoint.lat,
  lng: refPoint.lng,
});

// Step 3: Update with all fields
await db.updateTable('locs').set({
  // GPS fields
  gps_lat: refPoint.lat,
  gps_lng: refPoint.lng,
  gps_source: 'ref_map_import',
  gps_verified_on_map: 0,
  // Address fields (only if geocode succeeded)
  ...(addressData.street && { address_street: addressData.street }),
  ...(addressData.city && { address_city: addressData.city }),
  ...(addressData.county && { address_county: addressData.county }),
  ...(validState && { address_state: validState }),
  ...(addressData.zipcode && { address_zipcode: addressData.zipcode }),
  // Region fields
  ...(regionFields.censusRegion && { census_region: regionFields.censusRegion }),
  ...(regionFields.censusDivision && { census_division: regionFields.censusDivision }),
  ...(regionFields.stateDirection && { state_direction: regionFields.stateDirection }),
  ...(regionFields.culturalRegion && { cultural_region: regionFields.culturalRegion }),
  ...(regionFields.countryCulturalRegion && { country_cultural_region: regionFields.countryCulturalRegion }),
}).where('locid', '=', locationId).execute();
```

---

## Changes Required

| File | Lines | Change |
|------|-------|--------|
| `ref-maps.ts` | 844-904 | Add geocoding + region calc to `applyEnrichment` |
| `ref-maps.ts` | 910-980 | Add geocoding + region calc to `applyAllEnrichments` |

**Estimated LOC changed**: ~60 lines (mostly copy from existing pattern)

---

## Testing Plan

1. **Manual test**: Import a reference map, match a location without GPS, click "Apply GPS"
   - Verify: GPS fields populated ✓
   - Verify: Address fields populated (city, state, county from reverse geocode) ✓
   - Verify: Region fields populated (census, direction, cultural) ✓

2. **Batch test**: Use "Apply All" with multiple matches
   - Same verifications as above for all affected locations

3. **Edge case**: Reverse geocode fails (offline, API down)
   - GPS should still apply
   - Region fields should still populate from ref point state if available
   - Address fields may remain empty (graceful degradation)

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Geocoding service unavailable | Wrap in try/catch, continue with GPS-only + region calc |
| Invalid state code from ref point | Use AddressNormalizer.normalizeStateCode() |
| Batch performance (N geocode calls) | Already async, non-blocking; consider adding progress callback |

---

## Approval Checklist

- [ ] Plan reviewed and approved
- [ ] Implementation follows existing pattern in `refMaps:importWithOptions`
- [ ] Error handling matches existing geocoding error handling
- [ ] No new dependencies added
- [ ] Test plan executed

---

## References

- Recent commits: `bf096e8`, `1c3e29b`, `9c445c7`, `dffea9d`, `2a92160`
- DECISION-012: Region auto-population
- DECISION-018: Local/Region sections overhaul
- `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`
- `packages/desktop/electron/services/region-service.ts`
- `packages/desktop/electron/services/geocoding-service.ts`
