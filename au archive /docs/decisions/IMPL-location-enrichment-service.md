# Implementation Guide: LocationEnrichmentService

**Date**: 2024-12-01
**Author**: Claude (Code Assistant)
**For**: Developers new to the AU Archive codebase

---

## What Problem Does This Solve?

When you add GPS coordinates to a location from an external source (like a reference map or photo EXIF), you need to also:
1. **Reverse geocode** - Convert GPS → address (street, city, county, state, zipcode)
2. **Calculate regions** - Derive census region, state direction, cultural region from state/GPS

Previously, this logic was duplicated across 4+ handlers. When developers added new handlers, they often forgot to include all the steps. This caused bugs where locations had GPS but empty address/region fields.

**The LocationEnrichmentService solves this by providing a single method that does everything.**

---

## The Golden Rule

> **If you're applying GPS from an external source to a location, use `LocationEnrichmentService.enrichFromGPS()`.**

This ensures GPS, address, and region fields are always updated together.

---

## How It Works

```
┌──────────────────────────────────────────────────────────────┐
│                   enrichFromGPS(locid, input)                 │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ Step 1: Validate GPS coordinates                        ││
│  │         - Check lat is between -90 and 90               ││
│  │         - Check lng is between -180 and 180             ││
│  └──────────────────────────────────────────────────────────┘│
│                            ↓                                  │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ Step 2: Reverse Geocode (unless skipGeocode=true)       ││
│  │         - Call geocodingService.reverseGeocode(lat,lng) ││
│  │         - Extract: street, city, county, stateCode, zip ││
│  │         - On failure: log warning, continue with GPS    ││
│  └──────────────────────────────────────────────────────────┘│
│                            ↓                                  │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ Step 3: Calculate Region Fields (unless skipRegions)    ││
│  │         - Use geocoded state OR stateHint fallback      ││
│  │         - Call calculateRegionFields(state, county, gps)││
│  │         - Get: censusRegion, censusDivision,            ││
│  │                stateDirection, culturalRegion           ││
│  └──────────────────────────────────────────────────────────┘│
│                            ↓                                  │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ Step 4: Update Database                                 ││
│  │         - Single atomic UPDATE with all fields          ││
│  │         - GPS fields always set                         ││
│  │         - Address fields only if geocode succeeded      ││
│  │         - Region fields only if calculation succeeded   ││
│  └──────────────────────────────────────────────────────────┘│
│                            ↓                                  │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ Step 5: Return Result                                   ││
│  │         - success: true/false                           ││
│  │         - updated: { gps, address, regions }            ││
│  │         - address: the geocoded address data            ││
│  │         - regions: the calculated region data           ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## Basic Usage

### Example 1: Apply GPS from a Reference Map Point

```typescript
import { LocationEnrichmentService } from '../../services/location-enrichment-service';
import { GeocodingService } from '../../services/geocoding-service';

// Create service instances
const geocodingService = new GeocodingService(db);
const enrichmentService = new LocationEnrichmentService(db, geocodingService);

// Apply GPS to a location
const result = await enrichmentService.enrichFromGPS(locationId, {
  lat: 42.6526,
  lng: -73.7562,
  source: 'ref_map_import',       // Track where GPS came from
  stateHint: 'NY',                // Fallback if geocode fails
});

if (result.success) {
  console.log('GPS applied:', result.updated.gps);
  console.log('Address populated:', result.updated.address);
  console.log('Regions calculated:', result.updated.regions);
} else {
  console.error('Enrichment failed:', result.error);
}
```

### Example 2: Apply GPS from Media EXIF (Skip Geocoding if Address Exists)

```typescript
const hasAddress = location.address_street || location.address_city;

const result = await enrichmentService.enrichFromGPS(locationId, {
  lat: mediaGps.lat,
  lng: mediaGps.lng,
  source: 'media_gps',
  skipGeocode: hasAddress,  // Don't overwrite existing address
});
```

### Example 3: Batch Enrichment

```typescript
const enrichments = [
  { locid: 'uuid-1', input: { lat: 42.1, lng: -73.2, source: 'ref_map_import' } },
  { locid: 'uuid-2', input: { lat: 42.3, lng: -73.4, source: 'ref_map_import' } },
];

const batchResult = await enrichmentService.enrichBatch(enrichments);

console.log(`${batchResult.succeeded}/${batchResult.total} enriched successfully`);
```

---

## GPS Sources

Always specify where the GPS came from using the `source` field:

| Source | When to Use |
|--------|-------------|
| `ref_map_import` | GPS from batch reference map import |
| `ref_map_point` | GPS from individual reference map point match |
| `media_gps` | GPS from photo/video EXIF metadata |
| `user_map_click` | User clicked on map to set GPS (highest confidence) |
| `manual` | User manually typed coordinates |

This helps track GPS provenance and affects the `gps_verified_on_map` flag.

---

## Options

### `stateHint`

Fallback state code if geocoding fails. Useful when the reference data includes state.

```typescript
enrichFromGPS(locid, {
  lat, lng,
  source: 'ref_map_import',
  stateHint: 'NY',  // Used for region calculation if geocode fails
});
```

### `skipGeocode`

Skip reverse geocoding entirely. Use when:
- Location already has address data
- You're offline and don't want geocoding errors

```typescript
enrichFromGPS(locid, {
  lat, lng,
  source: 'media_gps',
  skipGeocode: true,  // Just update GPS + regions
});
```

### `skipRegions`

Skip region field calculation. Rarely needed.

```typescript
enrichFromGPS(locid, {
  lat, lng,
  source: 'manual',
  skipRegions: true,  // Just update GPS + address
});
```

---

## Return Value

```typescript
interface EnrichmentResult {
  success: boolean;           // Did the operation succeed?
  updated: {
    gps: boolean;             // Was GPS updated? (always true if success)
    address: boolean;         // Was address populated from geocoding?
    regions: boolean;         // Were region fields calculated?
  };
  address?: {                 // Present if geocoding succeeded
    street: string | null;
    city: string | null;
    county: string | null;
    state: string | null;     // 2-letter code (e.g., "NY")
    zipcode: string | null;
  };
  regions?: {                 // Present if region calc succeeded
    censusRegion: string | null;
    censusDivision: string | null;
    stateDirection: string | null;
    culturalRegion: string | null;
    countryCulturalRegion: string | null;
  };
  error?: string;             // Present if success=false
}
```

---

## Error Handling

The service uses **graceful degradation**:

| Error | Behavior |
|-------|----------|
| Invalid coordinates | Returns `success: false` with error message |
| Geocoding fails | Logs warning, continues with GPS + regions from stateHint |
| Region calc fails | Logs warning, continues with GPS + address |
| Database fails | Returns `success: false` with error message |

**GPS should always apply** even if downstream steps fail.

---

## Common Patterns

### Pattern 1: Enrichment in IPC Handler

```typescript
// In packages/desktop/electron/main/ipc-handlers/my-handler.ts

import { GeocodingService } from '../../services/geocoding-service';
import { LocationEnrichmentService } from '../../services/location-enrichment-service';

export function registerMyHandlers(db: Kysely<Database>): void {
  // Create services once at registration time
  const geocodingService = new GeocodingService(db);
  const enrichmentService = new LocationEnrichmentService(db, geocodingService);

  ipcMain.handle('myDomain:applyGps', async (_event, input) => {
    const { locationId, lat, lng } = input;

    const result = await enrichmentService.enrichFromGPS(locationId, {
      lat,
      lng,
      source: 'my_source',
    });

    return {
      success: result.success,
      error: result.error,
    };
  });
}
```

### Pattern 2: Conditional Enrichment

```typescript
// Only enrich if location doesn't already have GPS
if (!location.gps_lat || !location.gps_lng) {
  await enrichmentService.enrichFromGPS(locationId, {
    lat: newGps.lat,
    lng: newGps.lng,
    source: 'media_gps',
    skipGeocode: Boolean(location.address_city),  // Skip if already has address
  });
}
```

### Pattern 3: After Enrichment, Update Local Cache

```typescript
const result = await enrichmentService.enrichFromGPS(locationId, { lat, lng, source });

if (result.success) {
  // Update local object so subsequent operations see the new data
  location.gps = { lat, lng };
  if (result.address) {
    location.address_city = result.address.city;
    location.address_state = result.address.state;
  }
}
```

---

## What NOT to Do

### Don't update GPS fields directly

```typescript
// BAD - Only updates GPS, misses address and regions!
await db.updateTable('locs').set({
  gps_lat: lat,
  gps_lng: lng,
  gps_source: 'ref_map_import',
}).where('locid', '=', locid).execute();
```

```typescript
// GOOD - Uses enrichment service
await enrichmentService.enrichFromGPS(locid, {
  lat, lng,
  source: 'ref_map_import',
});
```

### Don't duplicate the enrichment logic

```typescript
// BAD - Duplicating logic that's already in the service
const geocodeResult = await geocodingService.reverseGeocode(lat, lng);
const regionFields = calculateRegionFields({ state, lat, lng });
await db.updateTable('locs').set({
  gps_lat: lat,
  gps_lng: lng,
  address_city: geocodeResult?.address?.city,
  census_region: regionFields.censusRegion,
  // ... etc
}).execute();
```

```typescript
// GOOD - Let the service handle it
await enrichmentService.enrichFromGPS(locid, { lat, lng, source });
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `electron/services/location-enrichment-service.ts` | The service implementation |
| `electron/services/geocoding-service.ts` | Reverse geocoding (GPS → address) |
| `electron/services/region-service.ts` | Region calculation (state → census/direction) |
| `electron/main/ipc-handlers/ref-maps.ts` | Example usage in ref map handlers |
| `electron/services/file-import-service.ts` | Example usage in media import |

---

## Testing Checklist

When you add a new feature that applies GPS to locations, test:

1. [ ] GPS fields are populated (gps_lat, gps_lng, gps_source)
2. [ ] Address fields are populated (if online and geocoding works)
3. [ ] Region fields are populated (census_region, state_direction, etc.)
4. [ ] Works offline (GPS + regions populate, address may be empty)
5. [ ] Error handling (invalid GPS returns error, doesn't crash)

---

## Summary

1. **Use `LocationEnrichmentService.enrichFromGPS()`** for all GPS enrichment
2. **Never update GPS fields directly** - you'll miss address/regions
3. **Specify the GPS source** for provenance tracking
4. **Use stateHint** when you have state data from the source
5. **Use skipGeocode** when location already has address data

This ensures consistent data quality across all features that touch GPS.
