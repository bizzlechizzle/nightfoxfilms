# Plan: Lightbox Info Panel Left-Side Positioning

## Summary

Move the metadata info panel from right-side to left-side of the lightbox, vertically centered.

## Current State

**File**: `packages/desktop/src/components/MediaViewer.svelte`

**Current info panel positioning (line 602)**:
```svelte
<div class="absolute right-0 top-16 bottom-0 w-96 bg-white/95 text-foreground overflow-y-auto shadow-lg border-l border-gray-200">
```

**Current behavior**:
- Panel anchored to right edge (`right-0`)
- Full height from 64px down to bottom (`top-16 bottom-0`)
- Fixed 384px width (`w-96`)
- Left border for visual separation (`border-l`)

**Current layout context**:
- Parent container: `fixed inset-0 ... flex items-center justify-center`
- Close button: top-right (`absolute top-4 right-4`)
- Nav prev button: left side (`absolute left-4 top-1/2 -translate-y-1/2`)
- Nav next button: right side (`absolute right-4 top-1/2 -translate-y-1/2`)
- Counter: bottom-center
- Action buttons (Show Info, etc.): bottom-right (`absolute bottom-6 right-6`)

## Proposed Changes

### Change 1: Move info panel to left side, vertically centered

**File**: `packages/desktop/src/components/MediaViewer.svelte`
**Line**: 602

**From**:
```svelte
<div class="absolute right-0 top-16 bottom-0 w-96 bg-white/95 text-foreground overflow-y-auto shadow-lg border-l border-gray-200">
```

**To**:
```svelte
<div class="absolute left-0 top-1/2 -translate-y-1/2 w-96 max-h-[80vh] bg-white/95 text-foreground overflow-y-auto shadow-lg border-r border-gray-200 rounded-r-lg">
```

**Changes explained**:
| Property | Old | New | Reason |
|----------|-----|-----|--------|
| Horizontal | `right-0` | `left-0` | Move to left side |
| Vertical top | `top-16` | `top-1/2 -translate-y-1/2` | Center vertically |
| Vertical bottom | `bottom-0` | (removed) | No longer full height |
| Height | implicit full | `max-h-[80vh]` | Constrain to 80% viewport for centered look |
| Border | `border-l` | `border-r` | Border now on right edge |
| Corners | none | `rounded-r-lg` | Rounded right corners for polish |

### Change 2: Adjust left navigation arrow position

The left nav arrow currently sits at `left-4`. With the info panel on the left, we need to ensure the arrow doesn't overlap when panel is open.

**Option A (Recommended)**: Make nav arrow position conditional
- When panel closed: `left-4`
- When panel open: `left-[25rem]` (400px, past the 384px panel + 16px gap)

**Option B**: Keep arrow always to the right of potential panel
- Always use `left-[25rem]` — but this creates awkward spacing when panel is closed

**Recommendation**: Option A for best UX

**File**: `packages/desktop/src/components/MediaViewer.svelte`
**Lines**: ~474-482 (prev nav button)

**From**:
```svelte
<button
  onclick={goToPrevious}
  class="absolute left-4 top-1/2 -translate-y-1/2 text-foreground hover:text-gray-600 transition p-2"
```

**To**:
```svelte
<button
  onclick={goToPrevious}
  class="absolute top-1/2 -translate-y-1/2 text-foreground hover:text-gray-600 transition p-2 {showExif ? 'left-[25rem]' : 'left-4'}"
```

## Impact Analysis

| Area | Impact |
|------|--------|
| Close button (top-right) | ✅ No conflict |
| Right nav arrow | ✅ No conflict |
| Left nav arrow | ⚠️ Needs conditional positioning |
| Counter (bottom-center) | ✅ No conflict |
| Action buttons (bottom-right) | ✅ No conflict |
| Image/video display | ✅ Main content remains centered |

## Verification Steps

1. Open lightbox for an image
2. Click "Show Info" button
3. Verify panel appears on LEFT side, vertically centered
4. Verify panel has max-height constraint and scrolls for long metadata
5. Navigate to previous image (if available) — verify nav arrow doesn't overlap panel
6. Verify panel can be toggled with `i` keyboard shortcut
7. Test with video content as well
8. Test panel doesn't cut off at screen bottom on shorter viewports

## Files Modified

1. `packages/desktop/src/components/MediaViewer.svelte` — 2 edits (panel position, nav arrow conditional)

## Rollback

Revert to `right-0 top-16 bottom-0` positioning and `border-l`, remove conditional class from nav button.
