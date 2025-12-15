# DECISION-018: Location Box Local/Region Sections Overhaul

## Status
Implemented

## Context
The location detail page needed a redesign of the geographic hierarchy section below the mini-map. The previous "Area" section was replaced with two distinct sections: "Local" (state/county level) and "Region" (national/continental level).

## Decision
Implement a two-section layout under the mini-map with the following 8 fields:

### Local Section (4 fields)
1. **County** - From address (existing)
2. **Local Cultural Region** - State-level cultural region (e.g., Hudson Valley, Capital Region) with verify checkbox
3. **State Directional** - Calculated from GPS position relative to state center (e.g., "Eastern NY")
4. **State** - From address (existing)

### Region Section (4 fields)
1. **Country Cultural Region** - National-level cultural region (e.g., NYC Metro, Cascadia) with verify checkbox
2. **Census** - 4-region Census model (Northeast, Midwest, South, West)
3. **Country** - Default "United States", stored in DB for future international support
4. **Continent** - Default "North America", stored in DB for future international support

## Implementation Details

### Database Changes (Migration 18)
- `country_cultural_region` - TEXT field for national-level cultural region
- `country_cultural_region_verified` - INTEGER (0/1) verification flag
- `local_cultural_region_verified` - INTEGER (0/1) verification flag
- `country` - TEXT with default 'United States'
- `continent` - TEXT with default 'North America'

### Country Cultural Region Data
- 50 national-level cultural regions with:
  - Point-in-polygon lookup from GeoJSON boundaries
  - GPS coordinates for proximity filtering
  - Category grouping (Northeast, Southeast, Midwest, Southwest, West)

### Proximity Filtering
- Local Cultural Regions: Filtered by current state + adjacent states
- Country Cultural Regions: Filtered to regions within ~100 miles of GPS location
- Prevents showing irrelevant options (e.g., Alaska regions when working near NY/PA border)

### UI Changes
- LocationMapSection.svelte: Two labeled sections with verification indicators (✓)
- LocationEditModal.svelte: Proximity-filtered dropdowns with verify checkboxes
- GPS-based suggestions with "Detected from GPS" prompts

## Files Changed
- `packages/desktop/src/lib/country-cultural-regions.ts` - NEW (50 regions with polygons)
- `packages/desktop/src/lib/census-regions.ts` - Added STATE_ADJACENCY map
- `packages/desktop/electron/main/database.ts` - Migration 18
- `packages/desktop/electron/main/database.types.ts` - New column types
- `packages/core/src/domain/location.ts` - New schema fields
- `packages/desktop/electron/services/region-service.ts` - Country cultural region lookup
- `packages/desktop/electron/repositories/sqlite-location-repository.ts` - Field mapping
- `packages/desktop/src/components/location/LocationMapSection.svelte` - UI overhaul
- `packages/desktop/src/components/location/LocationEditModal.svelte` - Edit modal with proximity dropdowns
- `packages/desktop/src/pages/LocationDetail.svelte` - Updated save handler
- `packages/desktop/electron/main/ipc-handlers/locations.ts` - updateRegionData handler
- `packages/desktop/electron/preload/index.ts` - updateRegionData IPC function

## Rationale
- **Offline-first**: All data embedded in TypeScript (no external API calls)
- **User control**: Editable regions with verification checkboxes
- **Better UX**: Proximity filtering reduces dropdown noise
- **Future-proof**: Country/continent fields support future international expansion
- **Clean separation**: Local (state-level) vs Region (national-level) hierarchy

## Dependencies
- Builds on DECISION-011 (edit modal)
- Builds on DECISION-012 (census regions)
- Census Division field retained in DB but removed from UI per user preference

## Note
Code comments reference "DECISION-017" for this feature as it was originally planned under that ID. The documentation is filed under DECISION-018 due to naming conflict with DECISION-017_premium-spacing-standardization.md.

## Date
2024-11-25
