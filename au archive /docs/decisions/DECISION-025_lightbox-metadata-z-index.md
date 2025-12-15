# DECISION-025: Lightbox Metadata Panel Z-Index Fix

**Date**: 2024-12-01
**Status**: Implemented
**Category**: UI Bug Fix

## Problem

Users cannot click the close button (X) in the MediaViewer lightbox when the metadata panel is open.

## Analysis

### Component Structure

File: `packages/desktop/src/components/MediaViewer.svelte`

The lightbox contains several absolutely positioned elements inside a flex container:

| Element | Position | Z-Index | DOM Order |
|---------|----------|---------|-----------|
| Close button (X) | `absolute top-4 right-4` | `z-10` | 1st |
| Navigation buttons | `absolute` | none | 2nd-3rd |
| Main content area | `flex-1` | none | 4th |
| Metadata panel | `absolute left-0 top-1/2` | **none** | 5th |
| Bottom-right buttons | `absolute bottom-6 right-6` | `z-10` | 6th |

### Root Cause

The metadata panel at line 636 uses CSS transform (`-translate-y-1/2`) which creates a new stacking context. Combined with `overflow-y-auto`, the panel's stacking order becomes unpredictable.

Per CSS stacking rules, when transforms create new stacking contexts, elements appearing later in DOM order can paint over earlier elements even when z-index suggests otherwise. The metadata panel (DOM position 5) was painting over the close button (DOM position 1) despite the button having `z-10`.

## Solution

Add explicit `z-[5]` to the metadata panel, establishing clear stacking hierarchy:

- Metadata panel: `z-[5]`
- Close button: `z-10` (unchanged)
- Bottom-right buttons: `z-10` (unchanged)

This guarantees the close button is always above the metadata panel regardless of transform stacking contexts.

## Change

**File**: `packages/desktop/src/components/MediaViewer.svelte`
**Line**: 636

```diff
- <div class="absolute left-0 top-1/2 -translate-y-1/2 w-96 max-h-[80vh] bg-white/95 text-foreground overflow-y-auto shadow-lg border-r border-gray-200 rounded-r-lg">
+ <div class="absolute left-0 top-1/2 -translate-y-1/2 w-96 max-h-[80vh] bg-white/95 text-foreground overflow-y-auto shadow-lg border-r border-gray-200 rounded-r-lg z-[5]">
```

## Alternatives Considered

1. **Move close button later in DOM** - Would work but is less explicit and fragile to future changes
2. **Remove transform from metadata panel** - Would break vertical centering

## Testing

Manual verification: Open lightbox, toggle metadata panel, confirm close button is clickable.
