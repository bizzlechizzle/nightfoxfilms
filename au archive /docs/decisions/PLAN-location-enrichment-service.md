# PLAN: Centralized Location Enrichment Service

**Date**: 2024-12-01
**Status**: IMPLEMENTED
**Category**: Architecture / Refactoring
**Priority**: High - Prevents recurring bugs

---

## Problem Statement

GPS enrichment logic is duplicated across 4+ handlers. Each time a new enrichment path is added, developers must remember to include:
1. Reverse geocoding (GPS → address)
2. Region calculation (state/county/GPS → census/direction/cultural regions)
3. Proper field updates

This has caused bugs twice now where handlers only update GPS fields without the full normalization pipeline.

---

## Goal

Create a **single source of truth** for location enrichment that:
1. Encapsulates the complete GPS → Address → Region pipeline
2. Is called by ALL handlers that enrich locations from external GPS sources
3. Prevents future bugs by making it impossible to "forget" steps
4. Is testable in isolation

---

## Current State (Fragile)

| Call Site | File | Geocoding | Regions | Notes |
|-----------|------|-----------|---------|-------|
| `refMaps:importWithOptions` | ref-maps.ts:529-618 | ✅ Inline | ✅ Inline | Fixed recently |
| `refMaps:applyEnrichment` | ref-maps.ts:844-904 | ❌ Missing | ❌ Missing | **BUG** |
| `refMaps:applyAllEnrichments` | ref-maps.ts:910-980 | ❌ Missing | ❌ Missing | **BUG** |
| `runPostImportEnrichment` | file-import-service.ts:815-876 | ✅ Inline | ✅ Separate method | Works |

**Problem**: 4 places with duplicated (or missing) logic.

---

## Target State (Robust)

```
┌─────────────────────────────────────────────────────────────┐
│                 LocationEnrichmentService                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ enrichFromGPS(locid, gps, source, options)          │    │
│  │   1. Reverse geocode GPS → address                  │    │
│  │   2. Calculate region fields                        │    │
│  │   3. Update location with all fields                │    │
│  │   4. Return enrichment result                       │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              ▲
          ┌───────────────────┼───────────────────┐
          │                   │                   │
   refMaps handlers    file-import-service    future handlers
```

**All enrichment flows call one service. Fix once, fixed everywhere.**

---

## New Service Design

### File Location
`packages/desktop/electron/services/location-enrichment-service.ts`

### Interface

```typescript
export interface EnrichmentInput {
  lat: number;
  lng: number;
  source: 'ref_map_import' | 'ref_map_point' | 'media_gps' | 'user_map_click';
  /** State hint from ref point (fallback if geocode fails) */
  stateHint?: string | null;
  /** Skip geocoding (e.g., if already have address) */
  skipGeocode?: boolean;
  /** Skip region calculation */
  skipRegions?: boolean;
}

export interface EnrichmentResult {
  success: boolean;
  /** What was updated */
  updated: {
    gps: boolean;
    address: boolean;
    regions: boolean;
  };
  /** Address data if geocoded */
  address?: {
    street: string | null;
    city: string | null;
    county: string | null;
    state: string | null;
    zipcode: string | null;
  };
  /** Region data if calculated */
  regions?: {
    censusRegion: string | null;
    censusDivision: string | null;
    stateDirection: string | null;
    culturalRegion: string | null;
    countryCulturalRegion: string | null;
  };
  /** Error message if failed */
  error?: string;
}

export class LocationEnrichmentService {
  constructor(
    private db: Kysely<Database>,
    private geocodingService: GeocodingService
  );

  /**
   * Enrich a location from GPS coordinates.
   * This is THE canonical way to add GPS + address + region data to a location.
   *
   * Pipeline:
   * 1. Reverse geocode GPS → address (unless skipGeocode)
   * 2. Calculate region fields from state/county/GPS (unless skipRegions)
   * 3. Update location with all fields atomically
   *
   * @param locid - Location UUID to enrich
   * @param input - GPS coordinates and options
   * @returns What was updated
   */
  async enrichFromGPS(locid: string, input: EnrichmentInput): Promise<EnrichmentResult>;
}
```

### Implementation Details

1. **Reverse Geocoding**
   - Call `geocodingService.reverseGeocode(lat, lng)`
   - Extract: street, city, county, stateCode, zipcode
   - On failure: log warning, continue with GPS-only + region calc from stateHint

2. **Region Calculation**
   - Call `calculateRegionFields({ state, county, lat, lng })`
   - Use geocoded state OR stateHint from ref point
   - On failure: log warning, continue with GPS-only

3. **Database Update**
   - Single atomic update with all fields
   - Use spread operator for optional fields (only set if value exists)
   - Validate state is 2 chars before including

4. **Return Value**
   - Report what was actually updated
   - Include data for logging/UI feedback

---

## Migration Plan

### Phase 1: Create Service (Non-Breaking)

Create `LocationEnrichmentService` without changing any existing code.

**Files created:**
- `packages/desktop/electron/services/location-enrichment-service.ts`

### Phase 2: Migrate Handlers (One at a Time)

Each migration is a small, testable change.

#### 2a. Migrate `refMaps:applyEnrichment`
- **Before**: Direct GPS-only update (broken)
- **After**: `enrichmentService.enrichFromGPS(locationId, { lat, lng, source: 'ref_map_import' })`
- **Lines**: ref-maps.ts:844-904

#### 2b. Migrate `refMaps:applyAllEnrichments`
- **Before**: Direct GPS-only update in loop (broken)
- **After**: Loop calls `enrichmentService.enrichFromGPS()` for each
- **Lines**: ref-maps.ts:910-980

#### 2c. Migrate `refMaps:importWithOptions`
- **Before**: Inline geocoding + region calc (works but duplicated)
- **After**: `enrichmentService.enrichFromGPS()`
- **Lines**: ref-maps.ts:529-618

#### 2d. Migrate `file-import-service.runPostImportEnrichment`
- **Before**: Inline geocoding + separate `recalculateRegionsForLocation()`
- **After**: `enrichmentService.enrichFromGPS()`
- **Lines**: file-import-service.ts:815-876
- **Note**: May need to pass service instance to FileImportService constructor

### Phase 3: Cleanup

- Remove now-unused `recalculateRegionsForLocation()` method from file-import-service.ts
- Remove inline geocoding/region code from ref-maps.ts

---

## Dependency Analysis

### Service Dependencies

```
LocationEnrichmentService
  ├── Kysely<Database>        (injected)
  ├── GeocodingService        (injected)
  ├── calculateRegionFields   (import from region-service.ts)
  └── AddressNormalizer       (import for state validation)
```

### Handler Changes

```
ref-maps.ts
  └── Add: locationEnrichmentService instance

file-import-service.ts
  └── Add: LocationEnrichmentService to constructor
```

---

## Error Handling Strategy

| Error | Behavior |
|-------|----------|
| Geocoding fails | Log warning, continue with GPS + region calc from stateHint |
| Region calc fails | Log warning, continue with GPS + address only |
| Database update fails | Throw error (caller handles) |
| Invalid coordinates | Return error result immediately |

**Principle**: Graceful degradation. GPS should always apply even if downstream steps fail.

---

## Testing Strategy

### Unit Tests (location-enrichment-service.test.ts)

1. **Happy path**: GPS + geocode + regions all succeed
2. **Geocode failure**: GPS + regions from stateHint
3. **Region calc failure**: GPS + address only
4. **Skip options**: skipGeocode, skipRegions work correctly
5. **Invalid state**: 3-char state is filtered out
6. **Invalid GPS**: Returns error result

### Integration Tests

1. Apply enrichment from Atlas UI → verify all fields populated
2. Batch enrichment → verify all locations enriched
3. Import with enrichments → verify all fields populated

---

## CLAUDE.md Compliance Check

| Rule | Compliance |
|------|------------|
| Scope Discipline | ✅ Only implementing what's needed to fix the bug |
| Prefer Open Source | ✅ No new dependencies |
| Offline-First | ✅ Region calc works offline; geocoding fails gracefully |
| One Script = One Function | ✅ Single service, single responsibility |
| Keep It Simple | ✅ Minimal abstraction, clear pipeline |
| No AI in Docs | ✅ No AI mentions |
| Archive-First | ✅ Ensures data integrity for research |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Regression in existing flows | Medium | High | Migrate one handler at a time, test each |
| Geocoding service initialization | Low | Medium | Service already exists, just passing reference |
| Performance (N geocode calls) | Low | Low | Already async, non-blocking |

---

## Estimated Effort

| Task | Time |
|------|------|
| Create LocationEnrichmentService | 30 min |
| Migrate 4 handlers | 45 min |
| Testing | 30 min |
| Documentation | 30 min |
| **Total** | ~2.5 hours |

---

## Files to Create/Modify

| File | Action | Lines Changed |
|------|--------|---------------|
| `electron/services/location-enrichment-service.ts` | **CREATE** | ~120 lines |
| `electron/main/ipc-handlers/ref-maps.ts` | MODIFY | ~80 lines |
| `electron/services/file-import-service.ts` | MODIFY | ~40 lines |
| `docs/decisions/IMPL-location-enrichment-service.md` | **CREATE** | Implementation guide |

---

## Approval Checklist

- [ ] Plan reviewed against CLAUDE.md
- [ ] Architecture is simple and focused
- [ ] Migration is incremental (can stop mid-way if needed)
- [ ] Error handling is graceful
- [ ] Testing strategy is clear
- [ ] No new dependencies

---

## Next Steps

1. Approve this plan
2. Create LocationEnrichmentService
3. Migrate handlers one at a time
4. Write implementation guide
5. Test all flows
