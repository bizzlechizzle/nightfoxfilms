# DECISION: Import Progress Box Redesign

**Status:** Implemented
**Date:** 2025-11-29

## Current State

**File:** `packages/desktop/src/components/ImportProgress.svelte`

**Current Positioning:**
- `fixed bottom-4 right-4` (bottom-right corner)
- `w-80` (320px wide)
- `z-50` (z-index 50)
- Full box with padding, shadow, rounded corners

**Problem:**
The MediaViewer lightbox uses `z-50` for its main container. The import progress box at z-50 competes with the lightbox, and its position (bottom-right) blocks the lightbox action buttons which are at:
- `absolute bottom-6 right-6` (Show Info, Show in Finder, Hide buttons)
- `absolute bottom-6 left-1/2` (Counter: "1 / 24")

## Requested Changes

1. **Position:** Top center (instead of bottom-right)
2. **Shape:** Thin & wider (less vertical, more horizontal)
3. **Z-index:** Higher than MediaViewer to remain visible but not block lightbox content

## Implementation Plan

### Layout Redesign

**From (current):**
```
┌────────────────────────┐
│ ● Importing Files  2/10│
│ ████████░░░░░░░░░░░░░░ │
│ Location Name      45% │
│ Processing: IMG_001.jpg│
│ Continue using app     │
│                 Cancel │
└────────────────────────┘
```

**To (proposed):**
```
┌──────────────────────────────────────────────────────────────┐
│ ● Importing 2/10  │  ████████░░░░  45%  │  Location  │ Cancel │
└──────────────────────────────────────────────────────────────┘
```

### CSS Changes

| Property | Current | Proposed |
|----------|---------|----------|
| Position | `bottom-4 right-4` | `top-4 left-1/2 -translate-x-1/2` |
| Width | `w-80` (320px) | `w-auto max-w-2xl` (auto, max 672px) |
| Padding | `p-4` | `px-4 py-2` |
| Layout | Vertical stack | Horizontal flex row |
| Z-index | `z-50` | `z-[60]` (above MediaViewer) |

### Content Simplification

**Keep (inline):**
- Pulsing dot indicator
- "Importing X/Y" text
- Progress bar (shorter, inline)
- Percentage
- Location name (truncated)
- Cancel button

**Remove or hide:**
- "Processing: filename" (remove - too verbose for thin bar)
- "You can continue using the app" (remove - users know this)
- Elapsed time (keep if space allows, otherwise remove)

---

## Files to Modify

1. `packages/desktop/src/components/ImportProgress.svelte` - Complete redesign

---

## Decisions

1. **Time:** Show **time remaining** instead of elapsed (estimate based on progress rate)
2. **Cancel:** Keep text "Cancel" (premium feel)
3. **Location name:** Keep, truncated
