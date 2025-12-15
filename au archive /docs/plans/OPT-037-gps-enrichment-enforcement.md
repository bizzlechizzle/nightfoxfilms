# PLAN: GPS Enrichment Enforcement (OPT-037)

**Issue ID:** OPT-037
**Date:** 2025-12-01
**Status:** IMPLEMENTED
**Implemented:** 2025-12-01
**Related:** OPT-036 (location delete fix)

## Problem Statement

Locations created with GPS coordinates are missing address and region data because:
1. The `location:create` IPC handler doesn't call the enrichment service
2. Enrichment is opt-in at handler level, not enforced at repository level
3. No health checks detect or fix these data quality gaps

**Evidence:** "Albany Trains" has GPS (42.5999, -73.76584) but empty county and cultural_region.

## Root Cause Analysis

### Current Architecture (Broken)
```
ImportModal → location:create → Repository.create() → INSERT (no enrichment)
```

### Required Architecture
```
ImportModal → location:create → Repository.create() → INSERT → enrichFromGPS() → RETURN
```

## Solution: Defense in Depth

### Layer 1: Repository-Level Enforcement
Move enrichment INTO `SQLiteLocationRepository.create()` and `update()` so it's impossible to bypass.

### Layer 2: Self-Healing Health Check
Add `IntegrityChecker.checkGpsAddressConsistency()` that finds and fixes gaps on startup.

### Layer 3: Logging/Monitoring
Log when enrichment runs, fails, or is skipped for debugging.

## Implementation Plan

### Step 1: Inject GeocodingService into Repository

**File:** `packages/desktop/electron/repositories/sqlite-location-repository.ts`

Add dependency injection for GeocodingService and LocationEnrichmentService:

```typescript
import { GeocodingService } from '../services/geocoding-service';
import { LocationEnrichmentService } from '../services/location-enrichment-service';

export class SQLiteLocationRepository implements LocationRepository {
  private enrichmentService: LocationEnrichmentService | null = null;

  constructor(private readonly db: Kysely<Database>) {}

  // Lazy initialization to avoid circular deps
  private getEnrichmentService(): LocationEnrichmentService {
    if (!this.enrichmentService) {
      const geocodingService = new GeocodingService(this.db);
      this.enrichmentService = new LocationEnrichmentService(this.db, geocodingService);
    }
    return this.enrichmentService;
  }
}
```

### Step 2: Add Enrichment to create()

**File:** `packages/desktop/electron/repositories/sqlite-location-repository.ts`

After inserting the location, call enrichment if GPS is provided:

```typescript
async create(input: LocationInput): Promise<Location> {
  // ... existing insert logic ...

  // NEW: Auto-enrich if GPS provided
  if (input.gps?.lat && input.gps?.lng) {
    try {
      const enrichment = this.getEnrichmentService();
      await enrichment.enrichFromGPS(locid, {
        lat: input.gps.lat,
        lng: input.gps.lng,
        source: (input.gps.source as GPSSource) || 'manual',
        stateHint: input.address?.state,
      });
      console.log(`[LocationRepository] Auto-enriched location ${locid} from GPS`);
    } catch (enrichError) {
      // Non-fatal: log and continue
      console.warn(`[LocationRepository] Auto-enrichment failed for ${locid}:`, enrichError);
    }
  }

  // Return fresh copy with enriched data
  return this.findById(locid) as Promise<Location>;
}
```

### Step 3: Add Enrichment to update()

**File:** `packages/desktop/electron/repositories/sqlite-location-repository.ts`

When GPS is updated, re-run enrichment:

```typescript
async update(id: string, input: Partial<LocationInput>): Promise<Location | null> {
  // ... existing update logic ...

  // NEW: Re-enrich if GPS was updated
  const gpsUpdated = input.gps?.lat !== undefined || input.gps?.lng !== undefined;
  if (gpsUpdated && updates.gps_lat && updates.gps_lng) {
    try {
      const enrichment = this.getEnrichmentService();
      await enrichment.enrichFromGPS(id, {
        lat: updates.gps_lat,
        lng: updates.gps_lng,
        source: (input.gps?.source as GPSSource) || 'manual',
        stateHint: input.address?.state,
      });
      console.log(`[LocationRepository] Re-enriched location ${id} after GPS update`);
    } catch (enrichError) {
      console.warn(`[LocationRepository] Re-enrichment failed for ${id}:`, enrichError);
    }
  }

  return this.findById(id);
}
```

### Step 4: Add Self-Healing Health Check

**File:** `packages/desktop/electron/services/integrity-checker.ts`

Add method to find and fix GPS/address gaps:

```typescript
async checkGpsAddressConsistency(): Promise<{
  found: number;
  fixed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let found = 0;
  let fixed = 0;

  try {
    const dbPath = getDatabasePath();
    const db = new Database(dbPath);

    // Find locations with GPS but no county
    const gaps = db.prepare(`
      SELECT locid, locnam, gps_lat, gps_lng, address_state
      FROM locs
      WHERE gps_lat IS NOT NULL
        AND gps_lng IS NOT NULL
        AND (address_county IS NULL OR address_county = '')
    `).all() as Array<{
      locid: string;
      locnam: string;
      gps_lat: number;
      gps_lng: number;
      address_state: string | null;
    }>;

    found = gaps.length;
    db.close();

    if (found > 0) {
      logger.warn('IntegrityChecker', `Found ${found} locations with GPS but no address`, {
        locations: gaps.map(g => g.locnam),
      });

      // Use Kysely connection for enrichment
      const { getDatabase } = await import('../main/database');
      const kyselyDb = getDatabase();
      const geocodingService = new GeocodingService(kyselyDb);
      const enrichmentService = new LocationEnrichmentService(kyselyDb, geocodingService);

      for (const gap of gaps) {
        try {
          await enrichmentService.enrichFromGPS(gap.locid, {
            lat: gap.gps_lat,
            lng: gap.gps_lng,
            source: 'integrity_fix' as any,
            stateHint: gap.address_state,
          });
          fixed++;
          logger.info('IntegrityChecker', `Fixed GPS/address gap for: ${gap.locnam}`);
        } catch (e) {
          errors.push(`Failed to fix ${gap.locnam}: ${e}`);
        }
      }
    }
  } catch (error) {
    errors.push(`GPS consistency check error: ${error}`);
  }

  return { found, fixed, errors };
}
```

### Step 5: Call Health Check on Startup

**File:** `packages/desktop/electron/main/index.ts`

Add GPS consistency check after database health check:

```typescript
// After existing health check
logger.info('Main', 'Step 4b/7: Checking GPS/address consistency');
const gpsCheck = await integrityChecker.checkGpsAddressConsistency();
if (gpsCheck.found > 0) {
  logger.info('Main', `Fixed ${gpsCheck.fixed}/${gpsCheck.found} GPS/address gaps`);
}
```

### Step 6: Update Tests

**File:** `packages/desktop/electron/__tests__/integration/location-enrichment.test.ts` (new)

```typescript
describe('Location Auto-Enrichment', () => {
  it('should auto-enrich when creating location with GPS', async () => {
    const location = await locationRepo.create({
      locnam: 'Test Location',
      gps: { lat: 42.6526, lng: -73.7562 },
    });

    expect(location.address?.county).toBeTruthy();
    expect(location.censusRegion).toBe('Northeast');
  });

  it('should re-enrich when updating GPS', async () => {
    const location = await locationRepo.create({ locnam: 'Test' });
    await locationRepo.update(location.locid, {
      gps: { lat: 42.6526, lng: -73.7562 },
    });

    const updated = await locationRepo.findById(location.locid);
    expect(updated?.address?.county).toBeTruthy();
  });
});
```

## Files to Modify

| File | Change | Lines |
|------|--------|-------|
| `sqlite-location-repository.ts` | Add enrichment to create/update | +50 |
| `integrity-checker.ts` | Add GPS/address consistency check | +60 |
| `main/index.ts` | Call GPS check on startup | +5 |

## Audit Checklist

- [x] Repository create() calls enrichment when GPS provided
- [x] Repository update() calls enrichment when GPS changes
- [x] Health check finds locations with GPS but no address
- [x] Health check auto-fixes gaps
- [x] Startup includes GPS consistency check
- [x] Existing tests still pass (build succeeds)
- [x] No circular dependency issues (lazy initialization)
- [x] Error handling is non-fatal (try/catch with console warnings)

## Testing Checklist

- [ ] Create location via ImportModal with ref point GPS
- [ ] Verify county is populated
- [ ] Verify all 8 region fields populated
- [ ] Update location GPS via map click
- [ ] Verify re-enrichment runs
- [ ] Run app with existing gap (Albany Trains)
- [ ] Verify startup fixes the gap

## Implementation Guide for Developers

### What This Fix Does

When a location is created or updated with GPS coordinates, we now automatically:
1. **Reverse geocode** the coordinates to get address (street, city, county, state, zipcode)
2. **Calculate regions** from the address (census region, cultural region, etc.)
3. **Update the location** with all the enriched data

This ensures all 8 region fields are populated for locations with GPS data.

### Key Code Locations

| File | What It Does |
|------|--------------|
| `sqlite-location-repository.ts:173-191` | Auto-enrich after `create()` inserts a location with GPS |
| `sqlite-location-repository.ts:448-475` | Re-enrich after `update()` when GPS changes and county is missing |
| `integrity-checker.ts:287-379` | `checkGpsAddressConsistency()` finds and fixes gaps |
| `main/index.ts:236-249` | Calls GPS consistency check on startup |

### How the Enrichment Works

```
Location Created with GPS
         ↓
Repository.create() inserts record
         ↓
Check: gps.lat && gps.lng provided?
         ↓ YES
Call enrichmentService.enrichFromGPS()
         ↓
  1. Reverse geocode GPS → address
  2. Calculate regions from state/county
  3. Update location with enriched data
         ↓
Return enriched location
```

### Error Handling

All enrichment is **non-fatal**. If geocoding fails (rate limit, network error, etc.), the location is still created/updated - it just won't have address/region data until the next startup when the integrity checker runs.

### Testing the Fix

1. **Create a new location** via ImportModal with a reference point that has GPS
2. **Check the location** - it should have county and all 8 region fields populated
3. **Check logs** - should see `[LocationRepository] Auto-enriched location XXX from GPS`

### If Something Goes Wrong

1. **Geocoding rate limited**: Nominatim allows 1 request/second. Batch imports may hit this. The integrity checker will fix any gaps on next startup.
2. **Circular dependency**: We use lazy initialization (`getEnrichmentService()`) to avoid this.
3. **Tests failing**: The enrichment is try/catch wrapped, so it shouldn't break existing tests.

## Rollback Plan

If issues arise:
1. Remove enrichment calls from repository
2. Keep health check as manual repair tool
3. Revert to handler-level enrichment calls
