# Plan: Stack Information Boxes Vertically

## Current State

**File:** `packages/desktop/src/pages/LocationDetail.svelte` (lines 1026-1064)

The current layout structure:

```
┌─────────────────────────────────────────────────────────────────┐
│ INDEX CARD HEADER (unchanged - do not touch)                    │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ┌──────────────┐  ┌────────────────────────────────────────┐│ │
│ │ │ HERO IMAGE   │  │ LOCATION INFO (right-justified)        ││ │
│ │ │ (4:1 ratio)  │  │ - Title                                ││ │
│ │ │ w-72 fixed   │  │ - Status + Sub-Type                    ││ │
│ │ │              │  │ - Built / Abandoned                    ││ │
│ │ │              │  │ - Buildings list                       ││ │
│ │ └──────────────┘  └────────────────────────────────────────┘│ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

┌───────────────────────────────┐  ┌───────────────────────────────┐
│ LOCATION INFO BOX             │  │ LOCATION MAP SECTION          │
│ (left column)                 │  │ (right column)                │
└───────────────────────────────┘  └───────────────────────────────┘
```

Currently the two information boxes are in a 2-column grid:
```html
<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
  <LocationInfo ... />
  <div class="location-map-section">
    <LocationMapSection ... />
  </div>
</div>
```

## User Request

> "I want the location bar to be horizontal under the location box."
> "Do not touch the location box"

Clarified interpretation:
- **Location box** = The Index Card Header (hero + title) - DO NOT TOUCH
- **Location bar** = The two information boxes (LocationInfo + LocationMapSection)
- Stack them vertically (full width) instead of side-by-side
- Leave negative space to the left (they should not span full width)

## Proposed New Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ INDEX CARD HEADER (unchanged)                                   │
└─────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────────────────┐
  (negative space)  │ LocationMapSection (right-aligned, narrow)  │
                    └─────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ LocationInfo (full width)                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Step 1: Remove Grid, Stack Vertically with Different Widths

**Current (lines 1026-1064):**
```html
<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
  <LocationInfo ... />
  <div class="location-map-section">
    <LocationMapSection ... />
  </div>
</div>
```

**New:**
```html
<!-- LocationMapSection: right-aligned, constrained width -->
<div class="flex justify-end mb-6">
  <div class="w-full max-w-lg">
    <LocationMapSection ... />
  </div>
</div>

<!-- LocationInfo: full width -->
<LocationInfo ... />
```

This will:
- LocationMapSection pushed right with `flex justify-end`, constrained to `max-w-lg` (~32rem)
- Negative space on the left of LocationMapSection
- LocationInfo below at full width
- Remove the wrapper div around LocationMapSection

### Files to Modify

| File | Changes |
|------|---------|
| `packages/desktop/src/pages/LocationDetail.svelte` | Lines 1026-1064 - restructure grid to stacked layout with LocationMapSection on top (right-aligned), LocationInfo below (full-width) |

## Scope Boundaries

- Modify lines 1026-1064 (the grid container and its children order)
- DO NOT modify:
  - Index Card Header (lines 930-1021)
  - LocationInfo component internals
  - LocationMapSection component internals
  - Any other sections

## Verification

After implementation:
1. View a regular location - LocationMapSection right-aligned with negative space, LocationInfo full-width below
2. View a host location - same behavior
3. View a sub-location - same behavior
4. Verify negative space exists to the left of LocationMapSection only
