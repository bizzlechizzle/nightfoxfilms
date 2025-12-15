# PLAN: Region Gap Fix - Ensure 4 Local + 4 Region Fields Always Populated

## Problem Statement

Per DECISION-018, the Location Box has two sections with 8 total fields:
- **Local Section (4 fields)**: County, Local Cultural Region, State Direction, State
- **Region Section (4 fields)**: Country Cultural Region, Census Region, Country, Continent

**Issue**: These fields can be `null` when source data is missing, causing visual gaps in the UI.

**Goal**: All 8 fields should ALWAYS be populated (no gaps).

---

## COMPLETE Gap Analysis (Deep Audit)

### Primary Gaps: Field Dependencies

| Field | Source | When Null |
|-------|--------|-----------|
| **LOCAL SECTION** | | |
| County | `address_county` from geocode/user | No geocode OR user didn't enter |
| Local Cultural Region | County + State lookup | No county OR county not in mapping |
| State Direction | GPS + State center calculation | No GPS OR no state |
| State | `address_state` | No address entered |
| **REGION SECTION** | | |
| Country Cultural Region | GPS point-in-polygon | No GPS coordinates |
| Census Region | State lookup | No state |
| Country | Default "United States" | Never (has default) ✓ |
| Continent | Default "North America" | Never (has default) ✓ |

### Additional Gaps Found (Deep Audit)

#### 1. DC (District of Columbia) - CRITICAL
- ✗ NOT in `STATE_CULTURAL_REGIONS` → empty dropdown
- ✗ NOT in `COUNTY_TO_CULTURAL_REGION` → no county lookup
- ✗ Has tiny threshold (0.05°) → always returns "Central DC"
- **Result**: DC users get completely empty Local section dropdown

#### 2. US Territories (PR, VI, GU, AS)
- ✗ NOT in `STATE_CULTURAL_REGIONS`
- ✗ NOT in `COUNTY_TO_CULTURAL_REGION`
- ✗ NOT in `STATE_ADJACENCY`
- **Only coverage**: Country Cultural Region polygons (Puerto Rico, US Virgin Islands, American Oceania)

#### 3. Border Location Dropdown Overflow
- Current: Shows ALL regions from current state + ALL adjacent states
- Example: NY user near PA border sees 13 NY regions + 13 PA regions = 26 options mixed alphabetically
- **No distance-based filtering** for local cultural regions (unlike country regions)

#### 4. Tiny States Always "Central"
- DC threshold: 0.05° (~3 miles)
- RI threshold: 0.1° (~7 miles)
- DE threshold: 0.1° (~7 miles)
- **Result**: `stateDirection` always returns "Central" for these states

#### 5. Verification Flag Orphans
- Database allows: `localCulturalRegionVerified = 1` with `culturalRegion = NULL`
- UI shows checkmark without region name
- **No validation** prevents this invalid state

#### 6. Offshore Coordinates
- GPS outside all 50 polygons → falls back to nearest within 100 miles
- Could show "Cascadia" for Pacific Ocean coordinates
- **No warning** that location is outside US boundaries

#### 7. No GPS Fallback for Country Region Dropdown
- Without GPS: dropdown shows all 50 regions with `distance: Infinity`
- Regions display unsorted (loses distance-based guidance)
- User has no way to know which region is relevant

#### 8. Census Division Hidden
- `census_division` stored in DB but NOT displayed in UI
- Mentioned in DECISION-018 as retained but removed from UI
- **Potential display gap** if user expects 9-division granularity

---

## NEW REQUIREMENT: Adjacent Cultural Region Filtering

### Current Behavior (Problem)
Local cultural region dropdown shows:
- All regions from current state
- All regions from ALL adjacent states (via `STATE_ADJACENCY`)
- No distance filtering
- Result: 20-30+ options for border states

### New Requirement
**Only show adjacent cultural regions within 25 miles, limit to 3 extra**

### Proposed Logic

```typescript
function getFilteredLocalCulturalRegions(
  state: string,
  lat: number | null,
  lng: number | null
): string[] {
  // 1. Always include all regions from current state
  const currentStateRegions = STATE_CULTURAL_REGIONS[state] || [];

  if (!lat || !lng) {
    // No GPS: only show current state regions
    return currentStateRegions;
  }

  // 2. Get adjacent state regions within 25 miles
  const adjacentStates = STATE_ADJACENCY[state] || [];
  const nearbyAdjacentRegions: { region: string; distance: number }[] = [];

  for (const adjState of adjacentStates) {
    const adjRegions = STATE_CULTURAL_REGIONS[adjState] || [];
    for (const region of adjRegions) {
      const regionCenter = CULTURAL_REGION_CENTERS[`${adjState}:${region}`];
      if (regionCenter) {
        const distance = haversineDistance(lat, lng, regionCenter.lat, regionCenter.lng);
        if (distance <= 25) {
          nearbyAdjacentRegions.push({ region: `${region} (${adjState})`, distance });
        }
      }
    }
  }

  // 3. Sort by distance, take top 3
  nearbyAdjacentRegions.sort((a, b) => a.distance - b.distance);
  const top3Adjacent = nearbyAdjacentRegions.slice(0, 3).map(r => r.region);

  // 4. Combine: current state regions + up to 3 nearby adjacent
  return [...currentStateRegions, ...top3Adjacent];
}
```

### Data Required
- New constant: `CULTURAL_REGION_CENTERS` - centroid lat/lng for each cultural region
- Haversine distance calculation (already exists for country regions)

---

## Complete Gap Solutions

### Local Section (4 fields)

#### 1. County
| Scenario | Solution |
|----------|----------|
| No geocode | Reverse-geocode from GPS if available |
| No GPS, no address | Show "—" (em-dash) in gray |
| **DC/Territories** | Show "District of Columbia" / territory name |

#### 2. Local Cultural Region
| Scenario | Solution |
|----------|----------|
| No county match | Use state-level default region |
| **DC** | Add DC cultural regions: "Capitol Hill", "Northwest DC", "Northeast DC", "Southwest DC", "Southeast DC" |
| **Territories** | Add PR regions: "San Juan Metro", "Ponce", "Mayagüez", etc. |
| Border dropdown overflow | **Implement 25-mile / 3-max filtering** |

#### 3. State Direction
| Scenario | Solution |
|----------|----------|
| No GPS | Default to "Central {State}" |
| **Tiny states (DC, RI, DE)** | Increase threshold OR show just state name |
| No state | Derive from GPS reverse-geocode |

#### 4. State (Full Name)
| Scenario | Solution |
|----------|----------|
| No address_state | Derive from GPS |
| No GPS, no address | Show "—" in gray |

### Region Section (4 fields)

#### 5. Country Cultural Region
| Scenario | Solution |
|----------|----------|
| No GPS | Use state-based default (map state → most common region) |
| Offshore coordinates | Show warning OR "Outside US Regions" |
| **Dropdown no-GPS fallback** | Group by census region, show state defaults first |

#### 6. Census Region
| Scenario | Solution |
|----------|----------|
| No state | Derive from GPS reverse-geocode |
| **DC** | Northeast (already mapped) |
| **Territories** | Add: PR → "Caribbean", VI → "Caribbean", GU → "Pacific" |

#### 7. Country ✓ (Already defaulted)
- Default: "United States"

#### 8. Continent ✓ (Already defaulted)
- Default: "North America"

---

## Implementation Phases

### Phase 1: Test Script (250 locations)
- 50 states × 5 scenarios each
- Generate report of all gaps found
- Baseline for validation

### Phase 2: Data Additions
1. Add DC cultural regions to `STATE_CULTURAL_REGIONS`
2. Add DC county mapping to `COUNTY_TO_CULTURAL_REGION`
3. Add territory cultural regions (PR, VI, GU)
4. Add `CULTURAL_REGION_CENTERS` for distance calculations
5. Add `STATE_TO_DEFAULT_COUNTRY_REGION` mapping

### Phase 3: Service Layer
1. Update `calculateRegionFields()` with fallback chain
2. Implement `getFilteredLocalCulturalRegions()` with 25-mile/3-max logic
3. Add validation to prevent orphan verification flags
4. Add offshore coordinate detection

### Phase 4: UI Updates
1. Update `LocationEditModal.svelte` dropdown filtering
2. Add gray styling for derived/default values
3. Add "(nearby)" suffix for adjacent state regions
4. Add warning for offshore coordinates

### Phase 5: Backfill & Validation
1. Backfill existing locations with new defaults
2. Run test script to verify 0 gaps
3. Manual QA on edge cases

---

## Files to Modify

| File | Changes |
|------|---------|
| `census-regions.ts` | Add DC regions, territory regions, CULTURAL_REGION_CENTERS |
| `region-service.ts` | Fallback chain, filtered dropdown logic |
| `LocationEditModal.svelte` | 25-mile/3-max dropdown filtering |
| `LocationMapSection.svelte` | Gray styling for defaults |
| `sqlite-location-repository.ts` | Validation for orphan flags |
| `country-cultural-regions.ts` | State-to-region default mapping |

---

## Updated Questions for User Approval

1. **DC Cultural Regions**: Suggested list:
   - Capitol Hill, Downtown DC, Northwest DC, Northeast DC, Southwest DC, Southeast DC, Georgetown, Anacostia
   - Approve this list or provide alternatives?

2. **Tiny state direction**: For DC/RI/DE, should we:
   - A) Always show "Central {State}"
   - B) Show just state name without direction
   - C) Increase threshold to get actual directions

3. **Adjacent region display**: Show "(NY)" suffix for adjacent state regions in dropdown?
   - Example: "Hudson Valley (NY)" when viewing from NJ

4. **Offshore handling**:
   - A) Show nearest region with "(estimated)" suffix
   - B) Show "Outside US Regions"
   - C) Block saving until valid coordinates

5. **25-mile limit**: Is 25 miles the right threshold, or adjust?

---

## Audit Checklist

### vs CLAUDE.md
- [x] Scope Discipline: Only region gaps + adjacency filtering
- [x] Archive-First: Metadata accuracy improvement
- [x] Offline-First: All new data embedded in TypeScript constants
- [x] Keep It Simple: Focused changes, no new abstractions

### vs DECISION-018
- [x] Maintains 4 Local + 4 Region structure
- [x] Preserves verification checkboxes (with orphan fix)
- [x] County-based lookup maintained (extended to DC/territories)
- [x] GPS-based lookup maintained (with offshore handling)

### vs Goal
- [x] Addresses "no gaps" requirement (all 8 gaps + edge cases)
- [x] Addresses adjacency filtering (25 miles, 3 max)
- [x] Plans test for 50 states × 5 scenarios

---

## Status

**AWAITING USER APPROVAL**

Additional gaps identified:
1. DC empty dropdown
2. Territory coverage gaps
3. Border dropdown overflow (addressed by 25-mile/3-max)
4. Tiny state direction issues
5. Verification flag orphans
6. Offshore coordinates
7. No-GPS dropdown fallback
8. Census division hidden (intentional per DECISION-018)

Please review and approve or request changes before implementation begins.
