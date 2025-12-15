# Issue: Location Detail Page - Unified Address/Map Layout

**Status**: Resolved
**Opened**: 2025-11-24
**Resolved**: 2025-11-24
**Priority**: P2 (Medium)
**Impact**: UX - Location detail page layout fragmented, map hidden for state-only locations
**ADR**: DECISION-009_location-detail-unified-layout.md

## Issue Description

On individual location pages:
1. Address was visually "orphaned" from the location box containing mini map and GPS
2. Map was completely hidden for state-only locations (tier 5) even though we have coordinates
3. County was displayed in address section but should be below map for sublocation sorting

## Root Cause

BUG-V4 FIX was too aggressive - hid map entirely for tier 5 instead of showing approximate map with overlay. Address and GPS/Map sections were separate components creating visual fragmentation.

## Solution Implemented

**Unified Location Box with Three Visually Distinct Sections:**

### Section 1: Address
- Street, City, State, Zip (no county)
- Copy button preserved
- All parts clickable for filtering

### Section 2: GPS + Map
- GPS coordinates with confidence badge
- Map ALWAYS visible with confidence overlay:
  - "Approximate - State center" for tier 5
  - "Approximate - Based on county center" for tier 4
  - "Approximate location" for tier 2-3
  - "No location data" when no GPS and no state
- Verify button and "Edit on Atlas" link

### Section 3: Area
- County (clickable filter)
- Region (clickable filter, if available)

## Files Modified

| File | Change |
|------|--------|
| `src/components/location/LocationMapSection.svelte` | Added address + area sections, always show map with overlays |
| `src/pages/LocationDetail.svelte` | Removed LocationAddress, pass onNavigateFilter to unified component |
| `src/components/Map.svelte` | Returns US center instead of null for "no GPS, no state" case |
| `src/components/location/LocationAddress.svelte` | Removed county display (kept for potential reuse) |

## Map Display Logic

```typescript
// Always show map, determine center + zoom + overlay:
if (location.gps?.lat && location.gps?.lng) {
  center = gps coordinates
  overlay = tier >= 4 ? 'Approximate' : null
} else if (location.address?.state) {
  center = STATE_CENTROIDS[state]
  overlay = 'Approximate - State center'
} else {
  center = US_CENTER (39.8283, -98.5795)
  overlay = 'No location data'
}
```

## Verification

- [x] Issue reproduced before fix
- [x] Fix implemented
- [x] Build passes
- [x] Verified GPS (green badge, no overlay)
- [x] Geocoded tier 4-5 (blue badge, "Approximate" overlay)
- [x] No GPS + state (state center, "Approximate" overlay)
- [x] No GPS + no state (US center, "No location data" overlay)

## Notes

- User decisions: US center map fallback, County + Region in Area, Visual dividers between sections
- LocationAddress.svelte kept for potential reuse elsewhere (without county)
