# DECISION-012: Auto-Population of Regions

**Status**: In Progress
**Date**: 2025-11-24
**Impact**: High - Automatic region assignment for all locations

---

## Context

Following DECISION-011 (Location Box redesign), we need to auto-populate geographic regions to support location discovery and trip planning. The goal is to show where a location fits within the US geography (Census region/division, position within state, and cultural region) without manual data entry.

## Decision

Implement automatic region assignment with:

1. **Census Region**: Lookup from state (4 regions: Northeast, Midwest, South, West)
2. **Census Division**: Lookup from state (9 divisions per US Census Bureau)
3. **State Direction**: Calculate from GPS vs state geographic center (e.g., "Eastern NY")
4. **Cultural Region**: Auto-suggest from county-based lookup (user can override)

## Approach: County-Based Cultural Region Mapping

Instead of GPS distance from center points or custom polygon boundaries, map each **county** to its cultural region:

- **More accurate** than center-point distance
- **Factual/verifiable** - county boundaries are official
- **Simple to implement** - just a lookup table
- **Offline-friendly** - no external API needed

### Data Flow

```
GPS coordinates
    ↓
Reverse geocode (existing Nominatim call)
    ↓
Get county (e.g., "Washington")
    ↓
Lookup cultural region (e.g., "Capital Region")
    ↓
Auto-populate field (user can override from dropdown)
```

## Coverage

- **50 states** with cultural regions defined (DC is N/A - single district)
- **~280 cultural regions** total across all states
- All mapped by county/parish/borough
- Complete county-to-cultural-region mappings for every state

## UI Display (Area Section)

```
┌─────────────────────────────────────────────────┐
│ Area ✓                                          │
│ Region: Northeast    Division: Middle Atlantic  │
│ Direction: Eastern NY                           │
│ Cultural Region: Capital Region                 │
│ County: Washington                              │
└─────────────────────────────────────────────────┘
```

All fields are clickable to filter other locations in the same region/division/etc.

## Key Changes

### Added
- `census-regions.ts` - Census regions/divisions, state centers, county-to-cultural-region mappings
- `region-service.ts` - Calculate all region fields from GPS/state/county
- Migration 16: census_region, census_division, state_direction columns
- Filter dropdowns on Locations page
- Statistics on Dashboard page

### Modified
- LocationMapSection.svelte - Display all region fields in Area section
- LocationEditModal.svelte - Remove "Other (custom)" option, auto-suggest from county
- sqlite-location-repository.ts - Include new fields in CRUD
- location.ts (core) - Add new fields to Zod schema

## Database Changes

Migration 16 adds:
```sql
ALTER TABLE locs ADD COLUMN census_region TEXT;
ALTER TABLE locs ADD COLUMN census_division TEXT;
ALTER TABLE locs ADD COLUMN state_direction TEXT;
```

Note: `cultural_region` already exists from Migration 15.

## Rationale

- **County-based vs GPS distance**: County boundaries are official/verifiable; GPS distance to region centers would be arbitrary
- **No custom cultural regions**: Prevents inconsistent data; predefined options ensure discoverability
- **Offline-first**: All data embedded in TypeScript constants, no API calls needed
- **Auto-trigger on GPS verify**: Ensures region fields stay in sync with GPS changes

## Offline-First Compliance

All region determination uses embedded data:
- Census region/division: State lookup (embedded constant)
- State direction: GPS calculation against embedded state centers
- Cultural region: County lookup against embedded mappings

No network calls required.

## Consequences

- Cultural region changes from free-text "Other" to predefined dropdown only
- Existing locations with custom cultural regions will need manual selection
- Filter UI adds complexity but improves discoverability

## References

- DECISION-011: Location Box redesign (prerequisite)
- issuetracking.md: Full implementation plan
- US Census Bureau: Region/division classifications
- claude.md: Offline-first compliance

---

## Implementation Checklist

- [ ] Create census-regions.ts with all data
- [ ] Migration 16: new columns
- [ ] Update database.types.ts
- [ ] Update location.ts (core)
- [ ] Create region-service.ts
- [ ] Update sqlite-location-repository.ts
- [ ] Update LocationMapSection.svelte
- [ ] Update LocationEditModal.svelte
- [ ] Update Locations.svelte with filters
- [ ] Update Dashboard.svelte with statistics
- [ ] Build & test
