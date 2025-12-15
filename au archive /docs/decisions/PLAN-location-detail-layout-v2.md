# PLAN: Location Detail Layout Restructure v2

**Status:** DRAFT - Awaiting User Approval
**Date:** 2025-12-10
**Affects:** LocationDetail.svelte, LocationInfo.svelte

---

## Current State Analysis

### Current Layout (Top to Bottom)
1. **Index Card Header** (lines 956-1048) - Contains:
   - Left: Hero thumbnail (4:1 ratio, 288px wide)
   - Right: Title, status/stype, built/abandoned, buildings list (right-aligned)

2. **Verification Status Line** (lines 1050-1057) - Horizontal colored bar

3. **LocationMapSection** (lines 1062-1085) - Right-aligned map card with address

4. **LocationInfo** (lines 1087-1103) - Full-width info box with "Information" header

### What User Wants

1. **Move LocationInfo box back to previous position** (right-aligned with map)
2. **Move hero image INTO the LocationInfo box**
3. **Remove the "title box" (Index Card)** but keep all its text content
4. **Title text floats on background** - no containing card

---

## Braun Design Audit

### Current Issues
- The Index Card adds visual weight with its border and background
- Two separate boxes (Index Card + LocationInfo) create fragmentation
- Hero image separated from information creates disconnection

### Proposed Improvements (Braun Principles)
- **Principle 5 (Unobtrusive)**: Remove card container, let content speak directly
- **Principle 10 (Minimal)**: Consolidate hero + info into one box, remove redundant container
- **Principle 3 (Aesthetic)**: Clean background with floating title creates visual hierarchy

---

## Implementation Plan

### Step 1: Restructure LocationDetail.svelte Header

**Remove:** The entire Index Card div (lines 955-1048)

**Replace with:** Floating title section (no card wrapper)

```svelte
<!-- Title Section - No Card Container -->
<div class="mb-8 text-right">
  {#if isViewingSubLocation && currentSubLocation}
    <button ... class="text-sm text-braun-500 hover:text-braun-900">
      {location.locnam}
    </button>
    <h1 class="text-5xl font-bold text-braun-900">{currentSubLocation.subnam}</h1>
  {:else}
    <h1 class="text-5xl font-bold text-braun-900">{location.locnam}</h1>
  {/if}

  <!-- Status + Sub-Type -->
  <p class="text-base text-braun-700 mt-2">...</p>

  <!-- Built / Abandoned -->
  <p class="text-base text-braun-700">...</p>

  <!-- Buildings/Siblings list -->
  <p class="text-sm text-braun-500">...</p>
</div>
```

### Step 2: Move Hero Image into LocationInfo

**Modify LocationInfo.svelte:**

Add new props:
- `heroThumbPath: string | null`
- `heroFocalX: number`
- `heroFocalY: number`
- `onHeroClick: () => void`

Add hero image section at top of content:

```svelte
<!-- Hero Image (inside Information box) -->
{#if heroThumbPath}
  <button onclick={onHeroClick} class="w-full mb-4 rounded overflow-hidden">
    <img src={`media://${heroThumbPath}`} ... />
  </button>
{/if}
```

### Step 3: Adjust Layout in LocationDetail.svelte

**Current:**
```svelte
<div class="flex justify-end mb-8">
  <div class="w-full max-w-lg">
    <LocationMapSection ... />
  </div>
</div>

<LocationInfo ... />  <!-- Full width below -->
```

**New:**
```svelte
<!-- Side-by-side: Info (with hero) on LEFT, Map on RIGHT -->
<div class="flex gap-6 mb-8">
  <!-- Left: Information box with hero inside -->
  <div class="flex-1">
    <LocationInfo
      heroThumbPath={heroThumbPath}
      heroFocalX={...}
      heroFocalY={...}
      onHeroClick={handleHeroClick}
      ...
    />
  </div>

  <!-- Right: Map Section -->
  <div class="w-96">
    <LocationMapSection ... />
  </div>
</div>
```

### Step 4: Pass Hero Props to LocationInfo

In LocationDetail.svelte, update LocationInfo call:
```svelte
<LocationInfo
  {location}
  heroThumbPath={heroThumbPath}
  heroFocalX={currentSubLocation?.hero_focal_x ?? location?.hero_focal_x ?? 0.5}
  heroFocalY={currentSubLocation?.hero_focal_y ?? location?.hero_focal_y ?? 0.5}
  onHeroClick={handleHeroClick}
  ... existing props ...
/>
```

---

## Visual Result

**Before:**
```
+---------------------------+
| [Hero] | Title (right)    |  <-- Index Card
+---------------------------+
[==== Status Line ====]
              +-------------+
              | Map Section |
              +-------------+
+---------------------------+
| Information               |  <-- Full width
+---------------------------+
```

**After:**
```
                Title (right)  <-- No card, floats on bg
                Status · Type
                Est. 1920 · Closed 2005
                Building1 · Building2

[========= Status Line =========]

+---------------+     +---------------+
| [Hero Image]  |     | Map Section   |
| Information   |     | Address       |
| - AKA         |     | GPS coords    |
| - Status/Type |     | [map preview] |
| - Built/Aband |     |               |
+---------------+     +---------------+
     LEFT                  RIGHT
```

---

## Files to Modify

1. **LocationDetail.svelte** (~50 lines changed)
   - Remove Index Card container
   - Keep title/status/buildings text as floating content
   - Move LocationInfo inside right-aligned container with LocationMapSection
   - Pass hero props to LocationInfo

2. **LocationInfo.svelte** (~30 lines added)
   - Add hero image props
   - Add hero image display at top of content
   - Maintain existing information sections

---

## Verification Checklist

After implementation, verify:
- [ ] Title displays right-aligned without card container
- [ ] Status, built/abandoned, buildings list still visible
- [ ] Hero image appears inside Information box
- [ ] Clicking hero still opens MediaViewer
- [ ] Information box right-aligned with Map section
- [ ] All text uses Braun typography (no color changes)
- [ ] 8pt grid spacing maintained
- [ ] No anti-patterns introduced (shadows, gradients, etc.)

---

## Rollback Plan

If issues arise, revert changes to:
- LocationDetail.svelte
- LocationInfo.svelte

No database or IPC changes required.
