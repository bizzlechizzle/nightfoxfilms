# GPS Enrichment Full Fix - Implementation Guide

## Executive Summary

**Root Cause**: The enrichment code uses `geocodeResult.address.state` (full name like "New York") instead of `geocodeResult.address.stateCode` (2-letter code like "NY").

**Database Constraint**: `address_state` has CHECK constraint requiring exactly 2 characters.

**Impact**: Any GPS enrichment with reverse geocoding fails with "CHECK constraint failed: length(address_state) = 2"

---

## Goal Statement

When a user approves a GPS enrichment match from a reference map import:
1. Apply GPS coordinates to the existing location ✓
2. Reverse geocode to get full address (street, city, county, state, zip)
3. Calculate all 8 region fields (census region, division, direction, cultural regions)
4. Premium experience: No prompts, no errors, just works

---

## Technical Analysis

### Data Flow

```
Reference Map (KMZ/GeoJSON)
        │
        ▼
┌─────────────────────────────────────┐
│  ref-map-dedup-service.ts           │
│  Finds matches where:               │
│  - Existing location has NO GPS     │
│  - Ref point has GPS + matching name│
│  → Returns enrichmentOpportunities  │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  Settings.svelte (Import Modal)     │
│  - Shows matches in "Matches Found" │
│  - Auto-checks 90%+ similarity      │
│  - User clicks "Import"             │
│  → Sends enrichments array          │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  ref-maps.ts (IPC Handler)          │
│  refMaps:importWithOptions          │
│  - Loops through enrichments        │
│  - Reverse geocodes each point      │  ← BUG IS HERE
│  - Calculates regions               │
│  - Updates locs table               │
└─────────────────────────────────────┘
```

### The Bug (Line 556)

```typescript
// CURRENT CODE (BROKEN)
const normalizedState = AddressNormalizer.normalizeStateCode(geocodeResult.address.state);
//                                                           ^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                                           This is "New York" not "NY"!
```

### GeocodingResult Structure

```typescript
interface GeocodingResult {
  address: {
    state: string;      // "New York" - full name for display
    stateCode: string;  // "NY" - already normalized 2-letter code
    // ... other fields
  }
}
```

### The Fix

```typescript
// FIXED CODE
// Use stateCode directly - it's already normalized by geocoding service
const normalizedState = geocodeResult.address.stateCode || null;
```

---

## Implementation Checklist

### 1. Fix State Field Usage
- [ ] Change `geocodeResult.address.state` → `geocodeResult.address.stateCode`
- [ ] Remove redundant `AddressNormalizer.normalizeStateCode()` call for geocoded state
- [ ] Keep normalization for `point.state` fallback (KMZ state field may not be normalized)

### 2. Fix Other Address Fields
- [ ] Use pre-normalized fields from geocoding service where available
- [ ] Only call normalizers for raw/external data (point.state from KMZ)

### 3. Add Defensive Validation
- [ ] Validate state is exactly 2 chars before including in update
- [ ] Log when state normalization fails (helps debug non-US locations)

### 4. Clean Up Logging
- [ ] Log actual values being set for debugging
- [ ] Remove redundant normalization calls

---

## Code Changes

### File: `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

#### Change 1: Fix State Extraction (Line ~552-565)

**Before:**
```typescript
try {
  const geocodeResult = await geocodingService.reverseGeocode(point.lat, point.lng);
  if (geocodeResult?.address) {
    // Normalize state to 2-letter code (constraint requires length = 2)
    const normalizedState = AddressNormalizer.normalizeStateCode(geocodeResult.address.state);
    addressData = {
      street: geocodeResult.address.street || null,
      city: geocodeResult.address.city || null,
      county: AddressNormalizer.normalizeCounty(geocodeResult.address.county) || null,
      state: normalizedState,
      zipcode: AddressNormalizer.normalizeZipcode(geocodeResult.address.zipcode) || null,
    };
    console.log(`[RefMaps] Reverse geocoded ${point.name}: ${geocodeResult.displayName} (state: ${normalizedState})`);
  }
} catch (geoError) {
  console.warn(`[RefMaps] Reverse geocoding failed for ${point.name}, continuing with GPS only:`, geoError);
}
```

**After:**
```typescript
try {
  const geocodeResult = await geocodingService.reverseGeocode(point.lat, point.lng);
  if (geocodeResult?.address) {
    // Geocoding service already normalizes: stateCode is 2-letter, county/zipcode are cleaned
    // Only need to convert undefined → null for our object shape
    addressData = {
      street: geocodeResult.address.street || null,
      city: geocodeResult.address.city || null,
      county: geocodeResult.address.county || null,  // Already normalized by geocoding service
      state: geocodeResult.address.stateCode || null, // Use stateCode (2-letter), NOT state (full name)
      zipcode: geocodeResult.address.zipcode || null, // Already normalized by geocoding service
    };
    console.log(`[RefMaps] Reverse geocoded ${point.name}: ${geocodeResult.displayName} → ${addressData.city}, ${addressData.state}`);
  }
} catch (geoError) {
  console.warn(`[RefMaps] Reverse geocoding failed for ${point.name}, continuing with GPS only:`, geoError);
}
```

#### Change 2: Fix State for Region Calculation (Line ~570-578)

**Before:**
```typescript
// Step 2: Calculate region fields from state/GPS
// Use normalized state, falling back to point.state (also normalized)
const stateForRegion = addressData.state || AddressNormalizer.normalizeStateCode(point.state) || null;
const regionFields = calculateRegionFields({
  state: stateForRegion,
  county: addressData.county || null,
  lat: point.lat,
  lng: point.lng,
});
```

**After:**
```typescript
// Step 2: Calculate region fields from state/GPS
// Use geocoded state first, then try to normalize point.state from KMZ (might be full name)
const stateForRegion = addressData.state || AddressNormalizer.normalizeStateCode(point.state) || null;
const regionFields = calculateRegionFields({
  state: stateForRegion,
  county: addressData.county || null,
  lat: point.lat,
  lng: point.lng,
});
```
(This part stays the same - point.state from KMZ may need normalization)

#### Change 3: Add State Validation Before Update (Line ~580-601)

**Before:**
```typescript
// Step 3: Update the location with GPS, address, and region data
const updateFields: Record<string, unknown> = {
  // GPS fields
  gps_lat: point.lat,
  gps_lng: point.lng,
  gps_source: 'ref_map_import',
  gps_verified_on_map: 0,
  gps_accuracy: null,
  gps_captured_at: new Date().toISOString(),
  // Address fields (only if we got geocode data)
  ...(addressData.street && { address_street: addressData.street }),
  ...(addressData.city && { address_city: addressData.city }),
  ...(addressData.county && { address_county: addressData.county }),
  ...(addressData.state && { address_state: addressData.state }),
  ...(addressData.zipcode && { address_zipcode: addressData.zipcode }),
  // Region fields (8 regions)
  ...(regionFields.censusRegion && { census_region: regionFields.censusRegion }),
  ...(regionFields.censusDivision && { census_division: regionFields.censusDivision }),
  ...(regionFields.stateDirection && { state_direction: regionFields.stateDirection }),
  ...(regionFields.culturalRegion && { cultural_region: regionFields.culturalRegion }),
  ...(regionFields.countryCulturalRegion && { country_cultural_region: regionFields.countryCulturalRegion }),
};
```

**After:**
```typescript
// Step 3: Update the location with GPS, address, and region data
// Validate state is exactly 2 chars before including (database CHECK constraint)
const validState = addressData.state && addressData.state.length === 2 ? addressData.state : null;
if (addressData.state && addressData.state.length !== 2) {
  console.warn(`[RefMaps] Invalid state "${addressData.state}" for ${point.name}, skipping state field`);
}

const updateFields: Record<string, unknown> = {
  // GPS fields (always set)
  gps_lat: point.lat,
  gps_lng: point.lng,
  gps_source: 'ref_map_import',
  gps_verified_on_map: 0,
  gps_accuracy: null,
  gps_captured_at: new Date().toISOString(),
  // Address fields (only if we got valid geocode data)
  ...(addressData.street && { address_street: addressData.street }),
  ...(addressData.city && { address_city: addressData.city }),
  ...(addressData.county && { address_county: addressData.county }),
  ...(validState && { address_state: validState }),
  ...(addressData.zipcode && { address_zipcode: addressData.zipcode }),
  // Region fields (calculated from state/GPS)
  ...(regionFields.censusRegion && { census_region: regionFields.censusRegion }),
  ...(regionFields.censusDivision && { census_division: regionFields.censusDivision }),
  ...(regionFields.stateDirection && { state_direction: regionFields.stateDirection }),
  ...(regionFields.culturalRegion && { cultural_region: regionFields.culturalRegion }),
  ...(regionFields.countryCulturalRegion && { country_cultural_region: regionFields.countryCulturalRegion }),
};
```

---

## Testing Checklist

1. [ ] Import reference map with location that has NO GPS in database
2. [ ] Match should appear in "Matches Found" section
3. [ ] 90%+ matches should be auto-checked
4. [ ] Click "Import" button
5. [ ] No constraint errors
6. [ ] Location should have:
   - [ ] GPS coordinates (gps_lat, gps_lng)
   - [ ] Address fields (street, city, county, state as 2-letter code, zipcode)
   - [ ] Region fields (census_region, census_division, state_direction, cultural_region, country_cultural_region)
7. [ ] Console should log success with geocoded address

---

## Audit Checklist

### vs Goal
- [x] GPS applied: Yes
- [x] Address populated: Yes (with proper stateCode)
- [x] Regions calculated: Yes
- [x] No user prompts: Yes (auto-checks 90%+, validates silently)

### vs claude.md
- [x] No AI mentions in code/UI: Verified
- [x] Offline-first: Falls back gracefully if geocoding fails
- [x] Keep it simple: Single focused fix
- [x] Archive-first: Serves metadata enrichment workflow

### vs Premium UX
- [x] No error dialogs: Validates silently, logs warnings
- [x] Auto-selects matches: 90%+ pre-checked
- [x] Shows success message: "X locations enriched with GPS"
- [x] One-click experience: User just clicks Import

---

## Summary

| Issue | Root Cause | Fix |
|-------|------------|-----|
| CHECK constraint fail | Used `address.state` (full name) instead of `address.stateCode` (2-letter) | Use `stateCode` directly |
| Redundant normalization | Called normalizer on already-normalized geocode output | Remove redundant calls |
| Missing validation | No length check before database update | Add explicit length === 2 check |
