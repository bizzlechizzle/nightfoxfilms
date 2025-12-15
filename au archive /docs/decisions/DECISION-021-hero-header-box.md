# DECISION-021: Hero Header Box on Location Detail

**Date:** 2025-12-06
**Status:** Implemented

## Context

The location detail page needed a prominent hero image display to give users an immediate visual reference for each location.

## Decision

Created a new "Hero Header Box" that combines the location title and hero image into a single card component at the top of the location detail page, above the two-column Information/Location grid.

## Layout

```
┌──────────────────────────────────────────────────┐
│  Location Title                                  │
│  [breadcrumb / building links]                   │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │         Hero Image (full width, 2:1)       │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐
│   Information       │  │   Location          │
└─────────────────────┘  └─────────────────────┘
```

## Specifications

- **Container:** White card with Braun border (`bg-white rounded border border-braun-300`)
- **Title:** 4xl bold, with breadcrumb for sub-locations or building links for host locations
- **Hero Image:** Full width within card padding, 2:1 aspect ratio (matches mini map)
- **Click behavior:** Opens MediaViewer at the hero image
- **Hover:** Dark overlay with "View" text
- **No hero:** Placeholder with camera icon and "No hero image" text

## Sub-location Support

- When viewing a sub-location, displays the building's hero image (not the host location's)
- Title shows sub-location name with host location as breadcrumb link

## Files Modified

- `packages/desktop/src/pages/LocationDetail.svelte` — Hero header box implementation

## Rationale

- Provides immediate visual context for each location
- Full-width hero maximizes visual impact
- 2:1 ratio maintains consistency with mini map component
- Card container groups related header elements (title + hero)
