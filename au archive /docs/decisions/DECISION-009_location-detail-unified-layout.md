# DECISION-009: Location Detail Page - Unified Address/Map Layout

**Date**: 2025-11-24
**Status**: Accepted
**Related Issue**: docs/resolved-issues/2025-11-24_location-detail-unified-layout.md

## Context

The location detail page had a fragmented layout:
- Address displayed in one white box
- GPS/Map displayed in a separate white box below
- Map was completely hidden for state-only locations (tier 5)
- County was mixed into the address section

This created visual separation between related information and hid useful context (the map) in low-confidence scenarios.

## Decision

### 1. Unified Location Box

Merge address and GPS/map into a single unified component (`LocationMapSection`) with three visually distinct sections separated by borders:

```
┌─────────────────────────────────────┐
│ ┌─ Address ──────────────────────┐  │
│ │ Street Address                 │  │
│ │ City, State Zip                │  │
│ └────────────────────────────────┘  │
│ ┌─ GPS ──────────────────────────┐  │
│ │ lat, lng [confidence badge]    │  │
│ │ [Mini Map with overlay]        │  │
│ │ [Verify] [Edit on Atlas]       │  │
│ └────────────────────────────────┘  │
│ ┌─ Area ─────────────────────────┐  │
│ │ County: [clickable]            │  │
│ │ Region: [clickable]            │  │
│ └────────────────────────────────┘  │
└─────────────────────────────────────┘
```

### 2. Always Show Map

Map displays in ALL scenarios with appropriate overlay:

| Scenario | Map Center | Overlay |
|----------|------------|---------|
| Verified GPS | GPS coords | None |
| High-confidence GPS (tier 1) | GPS coords | None |
| Medium-confidence (tier 2-3) | GPS coords | "Approximate location" |
| Low-confidence (tier 4) | GPS coords | "Approximate - Based on county center" |
| State-only (tier 5) | GPS coords | "Approximate - Based on state center" |
| No GPS + has state | State capital | "Approximate - State center" |
| No GPS + no state | US center | "No location data" |

### 3. Move County + Region Below Map

Create "Area" section for geographic filtering:
- County (clickable filter)
- Region (clickable filter)

This keeps address clean (street, city, state, zip) while providing sublocation sorting context.

## Consequences

### Positive

- **Unified visual hierarchy** - Related info grouped together
- **Always-visible map** - Provides geographic context even when approximate
- **Clear confidence indication** - Users understand precision level via overlays
- **Better filter discovery** - County and Region clickable in dedicated section
- **US center fallback** - No "broken" empty state, always shows something useful

### Negative

- **More complex component** - LocationMapSection now ~300 lines
- **Overlay may mislead** - Users might think approximate location IS the location

### Neutral

- LocationAddress.svelte kept (without county) for potential reuse elsewhere
- Map.svelte updated to never return null (always provides fallback)

## Files Changed

| File | Change |
|------|--------|
| `src/components/location/LocationMapSection.svelte` | Unified component with 3 sections |
| `src/pages/LocationDetail.svelte` | Removed LocationAddress, uses unified component |
| `src/components/Map.svelte` | US center fallback instead of null |
| `src/components/location/LocationAddress.svelte` | Removed county (kept for reuse) |
