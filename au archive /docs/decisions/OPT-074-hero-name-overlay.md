# OPT-074: Location Name Overlay on Hero Image

**Status:** IMPLEMENTED
**Date:** 2025-12-06
**Scope:** LocationDetail.svelte hero image component

---

## Request

Add the location name inside the hero image, positioned at **bottom-right**, using color **#F4F4F2** (Braun surface/card color).

---

## Current State

**File:** `packages/desktop/src/pages/LocationDetail.svelte` (lines 863-898)

Current hero image structure:
- 2:1 aspect ratio, full-width within card
- Hover overlay: 20% black with centered "View" text that fades in
- No permanent text overlay
- Title displayed **above** the image in a separate `<h1>` element

---

## Proposed Change

Add a permanent location name overlay at **bottom-right** of the hero image:

```svelte
<!-- Inside the hero image button, after the img element -->
<!-- Location name overlay - bottom right -->
<div class="absolute bottom-0 right-0 p-4 pointer-events-none">
  <span class="text-lg font-semibold" style="color: #F4F4F2;">
    {isViewingSubLocation && currentSubLocation ? currentSubLocation.subnam : location.locnam}
  </span>
</div>
```

---

## Braun Design Verification

### Compliance Check

| Principle | Status | Notes |
|-----------|--------|-------|
| **Color (#F4F4F2)** | ✅ PASS | This is the Braun surface/card color - appropriate for text on dark imagery |
| **Typography** | ✅ PASS | Using `text-lg` (18px) with `font-semibold` (600 weight) - fits 17px-24px tier |
| **Spacing (8pt grid)** | ✅ PASS | `p-4` = 16px padding, grid-aligned |
| **Geometry** | ✅ PASS | No curved elements, rectangular positioning |
| **Text Shadow** | ⚠️ NEEDS CONSIDERATION | No text-shadow per Braun rules, but legibility on varied backgrounds is a concern |

### Anti-Pattern Check

| Anti-Pattern | Status |
|--------------|--------|
| Gradient overlays | ❌ NOT USING |
| Text shadows | ❌ NOT USING |
| Decorative elements | ❌ NOT USING |
| Non-grid spacing | ❌ NOT USING |

### Legibility Concern

**Issue:** `#F4F4F2` (warm white) may have poor contrast on light portions of hero images.

**Braun-compliant solutions (choose one):**

1. **Option A - Subtle dark scrim (RECOMMENDED)**
   - Add a permanent subtle dark overlay at bottom-right corner only
   - Use `rgba(28,28,26,0.4)` - matches existing SubLocationGrid pattern
   - Maintains legibility without gradient (which is forbidden)

2. **Option B - No scrim, rely on image contrast**
   - Accept that some images may have poor legibility
   - User can change hero image if text is unreadable

3. **Option C - Darker text color**
   - Use `#1C1C1A` (Braun primary text) instead of `#F4F4F2`
   - Better on light images, worse on dark images

---

## Recommended Implementation (Option A)

```svelte
<!-- Location name overlay - bottom right with subtle scrim -->
<div
  class="absolute bottom-0 right-0 pointer-events-none"
  style="background: linear-gradient(to top left, rgba(28,28,26,0.5) 0%, transparent 70%);"
>
  <span
    class="block p-4 text-lg font-semibold"
    style="color: #F4F4F2;"
  >
    {isViewingSubLocation && currentSubLocation ? currentSubLocation.subnam : location.locnam}
  </span>
</div>
```

**Wait - gradient is forbidden per Braun rules.**

### Revised Recommendation (Solid Scrim)

```svelte
<!-- Location name overlay - bottom right with solid scrim -->
<div
  class="absolute bottom-0 right-0 p-4 pointer-events-none"
  style="background: rgba(28,28,26,0.4);"
>
  <span
    class="text-lg font-semibold"
    style="color: #F4F4F2;"
  >
    {isViewingSubLocation && currentSubLocation ? currentSubLocation.subnam : location.locnam}
  </span>
</div>
```

This uses a solid semi-transparent background (no gradient) matching Braun principles.

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/desktop/src/pages/LocationDetail.svelte` | Add name overlay inside hero image button (lines ~877) |

---

## Questions for User

1. **Scrim preference:** Should we use a subtle dark background behind the text for legibility, or rely on image contrast alone?

2. **Text styling:** The request specified `#F4F4F2` - should we also consider:
   - Font weight: `font-semibold` (600) or `font-medium` (500)?
   - Font size: `text-lg` (18px) or `text-base` (15px)?
   - Uppercase with letter-spacing (like SubLocationGrid)?

3. **Sub-location behavior:** When viewing a sub-location, show sub-location name or host location name?

---

## User Decisions

- [x] **Scrim:** Yes, use solid dark scrim for legibility
- [x] **Font styling:** Match existing title (`text-4xl font-bold` = 36px, 700 weight)
- [x] **Sub-location behavior:** Show sub-location name when viewing sub-location

---

## Final Implementation

```svelte
<!-- Location name overlay - bottom right with solid scrim -->
<div
  class="absolute bottom-0 right-0 p-4 pointer-events-none"
  style="background: rgba(28,28,26,0.4);"
>
  <span
    class="text-4xl font-bold"
    style="color: #F4F4F2;"
  >
    {isViewingSubLocation && currentSubLocation ? currentSubLocation.subnam : location.locnam}
  </span>
</div>
```

---

## Final Implementation (OPT-074)

Changes made to `packages/desktop/src/pages/LocationDetail.svelte`:

1. **Location name moved inside hero image** — Bottom-right position with `#FAFAF8` color
2. **Removed redundant title** — No longer displayed above the image
3. **Removed box/border** — Clean edge-to-edge hero with `rounded` (4px) corners only
4. **Aspect ratio changed** — From 2:1 to 4:1 (ultra-wide cinematic)
5. **Sub-location breadcrumb relocated** — Moved to top-left of hero image
6. **Building tagline relocated** — Moved to top-left of hero image (for host locations)

### Braun Design Verification

| Check | Status |
|-------|--------|
| Color (`#FAFAF8`) | ✅ Braun canvas/warm white |
| Border radius | ✅ `rounded` (4px) per spec |
| Typography | ✅ `text-4xl font-bold` (36px/700) |
| Spacing | ✅ `p-4` (16px) - 8pt grid aligned |
| No gradients | ✅ Compliant |
| No text shadows | ✅ Compliant |

## Status: IMPLEMENTED

---

## Update: Focal Point Editor Restored (OPT-074b)

**Date:** 2025-12-06

The focal point editor was incorrectly removed in ADR-071. This update restores the ability to center/crop hero images.

### Changes Made

1. **Migration 52**: Added `hero_focal_x` and `hero_focal_y` columns back to `locs` and `slocs` tables
2. **database.types.ts**: Added focal point fields to LocsTable and SlocsTable interfaces
3. **sqlite-location-repository.ts**: Updated to read/write focal point values
4. **sqlite-sublocation-repository.ts**: Updated to read/write focal point values for sub-locations
5. **MediaViewer.svelte**: Restored full focal point editor with:
   - Draggable pin for setting image center point
   - Preview showing cropped result at 4:1 aspect ratio
   - Host-Location option for setting campus hero from sub-location view
6. **LocationDetail.svelte**:
   - Pass focal points to MediaViewer
   - Apply focal point to hero image display via `object-position` CSS
   - Updated handlers to save focal point with hero image

### Focal Point System

- Values are 0-1 representing percentage position
- Default is 0.5, 0.5 (center)
- Applied via CSS `object-position: X% Y%` on hero images
- Stored per-location and per-sub-location

---

## Update: Bug Fixes (OPT-074c)

**Date:** 2025-12-06

### Issues Fixed

1. **TypeError: Cannot read properties of undefined (reading 'update')**
   - **Cause:** Used `window.electronAPI.location.update` (singular) instead of `window.electronAPI.locations.update` (plural)
   - **Fix:** Corrected API calls in LocationDetail.svelte lines 1008 and 1013

2. **Weird gradient/transparent overlay in focal point editor**
   - **Cause:** MediaViewer.svelte had a white overlay div (`bg-white/60`) in the focal point preview
   - **Fix:** Removed the unnecessary overlay div (line 1294)

### Files Modified

| File | Change |
|------|--------|
| `LocationDetail.svelte` | Fixed `locations.update` API calls (was `location.update`) |
| `MediaViewer.svelte` | Removed white overlay from focal point editor preview |
