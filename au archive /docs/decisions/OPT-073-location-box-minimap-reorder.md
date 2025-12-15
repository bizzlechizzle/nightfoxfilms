# OPT-073: Location Box Mini-Map Moved to Bottom

**Date:** 2025-12-06
**Status:** Implemented
**Component:** LocationMapSection.svelte

---

## Change

Moved the mini-map from position 3 to position 5 (last) in the Location Box on location detail pages.

## Previous Layout

```
Header (Location + edit)
GPS
Address
Mini-Map  <-- was here
Local
Region
```

## New Layout

```
Header (Location + edit)
GPS
Address
Local
Region
Mini-Map  <-- now here
```

## Rationale

User requested the mini-map appear at the bottom of the Location Box. This places text-based information (GPS, Address, Local, Region) together at the top for quick scanning, with the visual map element anchoring the bottom of the box.

## Implementation

- `packages/desktop/src/components/location/LocationMapSection.svelte`
  - Removed mini-map section from between Address and Local (lines 344-388)
  - Added mini-map section after Region as SECTION 5 (lines 432-476)
  - Moved `pb-6` padding class from Region section to Mini-Map section
  - Updated section comment numbers (3=Local, 4=Region, 5=Mini-Map)

## Affected Views

- Location detail pages (regular locations)
- Host location pages (campuses)
- Sub-location pages (buildings)

All use the same `LocationMapSection.svelte` component.

## Files Changed

- `packages/desktop/src/components/location/LocationMapSection.svelte`
