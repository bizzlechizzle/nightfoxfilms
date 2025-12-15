# Issue Tracking: Auto-Population of Regions (DECISION-012)

**Status**: In Progress
**Opened**: 2025-11-24
**Priority**: P1 (High)
**Impact**: Auto-populate Census regions/divisions, state direction, and cultural regions from GPS/county data

---

## Previous: DECISION-011 (COMPLETED)

Location Box UI redesign completed:
- Verification labels (Verified/Unverified) with green/red styling
- Edit modal with map for GPS marker dragging
- Mini map with golden ratio, satellite-labels default, limited interaction
- Expand to Atlas navigation with seamless transition
- Cultural region field added (user-selectable, dropdown only)
- Copy buttons with "Copied!" feedback

---

## DECISION-012: Auto-Population of Regions

### Overview

Implement automatic region assignment for locations based on GPS coordinates, displaying Census regions/divisions, within-state directional position, and auto-suggested cultural regions from county lookup.

---

## Issues

| # | Issue | Description | Priority |
|---|-------|-------------|----------|
| 1 | Auto-populate Census Region | Lookup from state (4 regions: Northeast, Midwest, South, West) | P1 |
| 2 | Auto-populate Census Division | Lookup from state (9 divisions) | P1 |
| 3 | Auto-populate State Direction | Calculate from GPS vs state center (e.g., "Eastern NY") | P1 |
| 4 | Auto-suggest Cultural Region | County-based lookup (predefined dropdown only, no custom) | P1 |
| 5 | Display all fields in Area section | Show Region, Division, Direction, Cultural Region, County | P1 |
| 6 | Add county-to-cultural-region mappings | All 50 states defined (~280 cultural regions) | P2 |
| 7 | User can change cultural region | Dropdown of predefined options only (NO custom entry) | P2 |
| 8 | Filter dropdowns on Locations page | Census Region, Census Division, Cultural Region filters | P2 |
| 9 | Dashboard statistics | Locations by Region/Division breakdown | P3 |
| 10 | Backfill existing locations | Calculate regions for existing locations | P2 |
| 11 | Export includes region fields | All region fields in JSON/CSV exports | P3 |
| 12 | Offline-first compliance | All calculations use embedded TypeScript constants | P1 |

---

## Implementation Plan

### Phase 1: Documentation
- [x] Update issuetracking.md with DECISION-012 content
- [ ] Create docs/decisions/DECISION-012.md (ADR)

### Phase 2: Data Layer
- [ ] Create `packages/desktop/src/lib/census-regions.ts`:
  - Census regions/divisions lookup
  - State centers with thresholds
  - County-to-cultural-region mappings (all 50 states)
- [ ] Add Migration 16: census_region, census_division, state_direction columns
- [ ] Update database.types.ts with new fields
- [ ] Update packages/core/src/domain/location.ts with new fields

### Phase 3: Service Layer
- [ ] Create `packages/desktop/electron/services/region-service.ts`:
  - getCensusRegion(state)
  - getCensusDivision(state)
  - getStateDirection(lat, lng, state)
  - getCulturalRegionFromCounty(state, county)
  - calculateAllRegions(location)
- [ ] Update sqlite-location-repository.ts to include new fields
- [ ] Update location IPC handlers to auto-populate regions on create/update

### Phase 4: UI - Area Section
- [ ] Update LocationMapSection.svelte:
  - Show Census Region, Division, State Direction
  - Show Cultural Region (with clickable filter)
  - All fields are clickable to filter other locations
- [ ] Update LocationEditModal.svelte:
  - Remove "Other (custom)" option for cultural region
  - Auto-suggest cultural region from county when GPS changes

### Phase 5: UI - Filters & Discovery
- [ ] Update Locations.svelte:
  - Add Census Region dropdown filter
  - Add Census Division dropdown filter
  - Add Cultural Region text filter
- [ ] Update location filter logic in stores

### Phase 6: Dashboard & Export
- [ ] Update Dashboard.svelte with "Locations by Region" statistics
- [ ] Update export logic to include all region fields

### Phase 7: Backfill & Testing
- [ ] Create backfill script for existing locations
- [ ] Build and test all scenarios
- [ ] User review before closing ticket

---

## Audit Against claude.md

| Rule | Status | Notes |
|------|--------|-------|
| Database via migrations only | ✓ | Using Migration 16 for new columns |
| Scope Discipline | ✓ | Only implementing requested region features |
| Archive-First | ✓ | Region data supports research discovery |
| Prefer Open Source | ✓ | All data embedded, no external APIs |
| Offline-First | ✓ | All calculations local, no network calls |
| Keep It Simple | ✓ | County-based lookup is simpler than GPS boundaries |
| One Script = One Function | ✓ | region-service.ts focused on region calculation |
| No AI in Docs | ✓ | N/A |
| Design Deltas | ✓ | Creating DECISION-012.md |

---

## Files to Modify/Create

| File | Action | Changes |
|------|--------|---------|
| `issuetracking.md` | UPDATE | DECISION-012 content (replace DECISION-011) |
| `docs/decisions/DECISION-012.md` | CREATE | ADR for region auto-population |
| `packages/desktop/src/lib/census-regions.ts` | CREATE | Census regions/divisions, state centers, county-to-cultural-region mappings |
| `packages/desktop/electron/services/region-service.ts` | CREATE | Service to calculate all region fields from GPS/state |
| `packages/desktop/electron/main/database.ts` | UPDATE | Migration 16: census_region, census_division, state_direction |
| `packages/desktop/electron/main/database.types.ts` | UPDATE | Add new region fields |
| `packages/core/src/domain/location.ts` | UPDATE | Add new region fields to Zod schema |
| `packages/desktop/electron/repositories/sqlite-location-repository.ts` | UPDATE | Include new fields in CRUD |
| `packages/desktop/src/components/location/LocationMapSection.svelte` | UPDATE | Display all region fields in Area section |
| `packages/desktop/src/components/location/LocationEditModal.svelte` | UPDATE | Remove custom option, auto-suggest from county |
| `packages/desktop/src/pages/Locations.svelte` | UPDATE | Add region filter dropdowns |
| `packages/desktop/src/pages/Dashboard.svelte` | UPDATE | Add region statistics section |
| `packages/desktop/src/lib/cultural-regions.ts` | UPDATE | Remove unused DIRECTIONAL_REGIONS, update comments |

---

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

All fields are clickable filters to browse other locations in the same region/division/etc.

---

## Cultural Region Model

### Approach: County-Based Mapping

Instead of drawing custom boundaries or using GPS distance from center points, map each **county** to its cultural region. This is:
- **More accurate** than center-point distance
- **Factual/verifiable** - county boundaries are official
- **Simple to implement** - just a lookup table
- **Offline-friendly** - no external API needed

### How It Works

```
GPS coordinates
    ↓
Reverse geocode (existing)
    ↓
Get county (e.g., "Washington")
    ↓
Lookup cultural region (e.g., "Capital Region")
    ↓
Auto-populate field
```

### Coverage

- **50 states** with cultural regions defined (DC is N/A)
- **~280 cultural regions** total across all states
- All mapped by county/parish/borough

---

## Testing Scenarios

- [ ] Creating location in NY → Census Region: Northeast, Division: Middle Atlantic
- [ ] GPS in eastern NY → State Direction: Eastern NY
- [ ] GPS near Capital Region → Cultural Region auto-suggests: Capital Region
- [ ] GPS verified → All region fields auto-populate
- [ ] State changed → Census region/division update
- [ ] User can override cultural region suggestion
- [ ] All region fields are clickable filters
- [ ] Works offline (all data embedded, no API calls)
- [ ] Backfill script populates existing locations
- [ ] Filters work on Locations list page
- [ ] Export includes all region fields

---

**When resolved**: Create docs/decisions/DECISION-012.md and mark complete.
