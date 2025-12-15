# OPT-096: Sub-Location Thumbnail Consistency

## Problem Statement

On **host location pages**, the SubLocationGrid component displays sub-location cards with:
- **Golden ratio (1.618:1)** aspect ratio
- **Cinematic centered uppercase text** with 10cqw font size
- **Dark overlay (25%)** for text legibility

On **sub-location detail pages**, the hero banner uses:
- **4:1 aspect ratio** (ultrawide cinematic)
- **Bottom-right positioned text** at 36px bold
- **No permanent overlay** (only hover overlay)

The user wants the sub-location thumbnails on host pages to **match** the sub-location page style.

---

## Current State Analysis

### SubLocationGrid.svelte (Host Page - Lines 60-97)
```svelte
<!-- Current: Golden ratio cards with centered uppercase text -->
<div class="card-container aspect-[1.618] bg-braun-100 relative overflow-hidden">
  <!-- Permanent dark overlay (25%) -->
  <div class="absolute inset-0 pointer-events-none bg-braun-900/25"></div>
  <!-- Centered uppercase title -->
  <div class="absolute inset-0 flex items-center justify-center">
    <h3 class="cinematic-title w-3/4 font-bold text-white text-center uppercase tracking-[0.2em]">
      {subloc.subnam}
    </h3>
  </div>
</div>
```
- Aspect ratio: **1.618:1** (golden ratio)
- Text: **Centered, uppercase, 10cqw, tracking-[0.2em]**
- Overlay: **25% permanent dark**

### LocationDetail.svelte Hero (Sub-Location Page - Lines 879-931)
```svelte
<!-- Target: 4:1 ultrawide with bottom-right text -->
<button style="aspect-ratio: 4 / 1;">
  <img style="object-position: {focalX * 100}% {focalY * 100}%;" />
  <!-- Hover-only overlay -->
  <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition"></div>
  <!-- Bottom-right text -->
  <div class="absolute bottom-0 right-0 p-4 pointer-events-none">
    <span class="text-4xl font-bold" style="color: #FAFAF8;">
      {currentSubLocation.subnam}
    </span>
  </div>
</button>
```
- Aspect ratio: **4:1** (ultrawide)
- Text: **Bottom-right, 36px bold, normal case**
- Overlay: **Hover-only (0% to 20%)**

---

## Braun Design Verification

### Current SubLocationGrid Issues

| Check | Current | Braun Standard | Issue |
|-------|---------|----------------|-------|
| Text Position | Centered | Per component purpose | None (stylistic choice) |
| Letter Spacing | 0.2em | 0.1em for labels | **Excessive** |
| Overlay | 25% permanent | Only for function | **Decorative** |
| Aspect Ratio | 1.618:1 | Grid-aligned | OK (mathematically proportioned) |
| Text Transform | UPPERCASE | OK for labels | OK |

### Anti-Pattern Check
- [x] **Decorative overlay** - The 25% permanent overlay is decorative, not functional
- [x] **Text shadow alternative** - Using overlay instead of shadow (good)
- [ ] No gradients
- [ ] No colored accents

### Recommendation
The **4:1 aspect ratio** with **bottom-right text** and **hover-only overlay** is more aligned with Braun principles:
1. **Unobtrusive** - Content (image) speaks without permanent overlay
2. **Honest** - Text position matches sub-location page (consistency)
3. **Minimal** - Fewer decorative elements

---

## Proposed Changes

### File: `packages/desktop/src/components/location/SubLocationGrid.svelte`

#### Change 1: Aspect Ratio
```diff
- <div class="card-container aspect-[1.618] bg-braun-100 relative overflow-hidden">
+ <div class="card-container bg-braun-100 relative overflow-hidden" style="aspect-ratio: 4 / 1;">
```

#### Change 2: Remove Permanent Overlay, Add Hover-Only
```diff
- <!-- Permanent dark overlay for text legibility -->
- <div class="absolute inset-0 pointer-events-none bg-braun-900/25"></div>
-
- <!-- Subtle hover overlay -->
- <div class="hover-overlay absolute inset-0 opacity-0 transition-opacity duration-300 pointer-events-none bg-braun-900/15"></div>
+ <!-- Hover-only overlay -->
+ <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition pointer-events-none"></div>
```

#### Change 3: Text Position (Centered to Bottom-Right)
```diff
- <!-- Cinematic centered title -->
- <div class="absolute inset-0 flex items-center justify-center">
-   <h3 class="cinematic-title w-3/4 font-bold text-white text-center uppercase tracking-[0.2em]">
-     {subloc.subnam}
-   </h3>
- </div>
+ <!-- Bottom-right text (matches sub-location page) -->
+ <div class="absolute bottom-0 right-0 p-4 pointer-events-none">
+   <span class="text-2xl font-bold" style="color: #FAFAF8;">
+     {subloc.subnam}
+   </span>
+ </div>
```

Note: Using `text-2xl` (24px) instead of `text-4xl` (36px) since cards are smaller than full-width hero.

#### Change 4: Add group class to button
```diff
- <button
-   onclick={() => navigateToSubLocation(subloc.subid)}
-   class="building-card rounded overflow-hidden text-left"
- >
+ <button
+   onclick={() => navigateToSubLocation(subloc.subid)}
+   class="building-card rounded overflow-hidden text-left group"
+ >
```

#### Change 5: Update Add Card Aspect Ratio
```diff
- style="aspect-ratio: {addCardFullWidth ? '3.3' : '1.618'};"
+ style="aspect-ratio: 4 / 1;"
```
(Full-width add card also uses 4:1 for consistency)

#### Change 6: Remove unused CSS
```diff
- /* Container for scaling text */
- .card-container {
-   container-type: inline-size;
- }
-
- /* Cinematic title - scales with container width */
- /* Braun: No text-shadow, use overlay for legibility */
- .cinematic-title {
-   font-size: 10cqw;
-   line-height: 1.2;
- }
```

---

## Visual Comparison

### Before (Host Page SubLocationGrid)
```
┌─────────────────────────────┐
│     [Image 1.618:1]         │
│   ┌───────────────────┐     │
│   │  BUILDING NAME    │     │  ← Centered, uppercase, 25% overlay
│   └───────────────────┘     │
└─────────────────────────────┘
```

### After (Matches Sub-Location Page)
```
┌─────────────────────────────────────────────────────┐
│                 [Image 4:1]                         │
│                                                     │
│                                    Building Name    │  ← Bottom-right, normal case
└─────────────────────────────────────────────────────┘
```

---

## Impact Assessment

| Aspect | Impact |
|--------|--------|
| Files Changed | 1 (SubLocationGrid.svelte) |
| Lines Changed | ~25 lines |
| Breaking Changes | None (visual only) |
| Accessibility | Maintained (text contrast OK) |
| Performance | Unchanged |

---

## Approval Checklist

- [ ] Aspect ratio change from 1.618:1 to 4:1 approved
- [ ] Text position change from center to bottom-right approved
- [ ] Overlay change from permanent 25% to hover-only approved
- [ ] Text case change from UPPERCASE to normal case approved
- [ ] Font size change from 10cqw to 24px approved

---

## Implementation Order

1. Add `group` class to button for hover state
2. Change aspect ratio from `1.618:1` to `4:1`
3. Replace overlay divs (permanent → hover-only)
4. Change text position and styling
5. Update Add Card aspect ratio
6. Remove unused CSS
7. Test visual appearance
