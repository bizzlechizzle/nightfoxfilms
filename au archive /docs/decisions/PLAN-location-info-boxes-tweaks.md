# PLAN: Location & Information Box Tweaks

**Status:** DRAFT - Awaiting User Approval
**Date:** 2025-12-10
**Affects:** LocationDetail.svelte, LocationInfo.svelte, LocationMapSection.svelte

---

## Requested Changes

1. **Edit buttons right-justified** - Move "edit" links to the right side of each box
2. **Update widths** - Information box 55%, Location box 45%

---

## Current State

### Widths
- Information box: `w-3/5` (60%)
- Location box: `w-2/5` (40%)

### Edit Button Positions
- **LocationInfo.svelte** (line 679-689): Edit button at bottom-left
  ```svelte
  <div class="px-8 pb-6">
    <button onclick={openEditModal} class="text-sm text-braun-500 ...">
      edit
    </button>
  </div>
  ```

- **LocationMapSection.svelte** (line 446-455): Edit button at bottom-left
  ```svelte
  <div class="px-8 pb-6">
    <button onclick={handleEditClick} class="text-sm text-braun-500 ...">
      edit
    </button>
  </div>
  ```

---

## Implementation Plan

### Step 1: Update Widths in LocationDetail.svelte

**File:** `packages/desktop/src/pages/LocationDetail.svelte`

Change:
```svelte
<div class="w-3/5 flex flex-col">  <!-- Information -->
...
<div class="w-2/5 flex flex-col">  <!-- Location -->
```

To:
```svelte
<div class="w-[55%] flex flex-col">  <!-- Information -->
...
<div class="w-[45%] flex flex-col">  <!-- Location -->
```

### Step 2: Right-Justify Edit Button in LocationInfo.svelte

**File:** `packages/desktop/src/components/location/LocationInfo.svelte`

Change:
```svelte
<div class="px-8 pb-6">
  <button onclick={openEditModal} ...>
    edit
  </button>
</div>
```

To:
```svelte
<div class="px-8 pb-6 text-right">
  <button onclick={openEditModal} ...>
    edit
  </button>
</div>
```

### Step 3: Right-Justify Edit Button in LocationMapSection.svelte

**File:** `packages/desktop/src/components/location/LocationMapSection.svelte`

Change:
```svelte
<div class="px-8 pb-6">
  <button onclick={handleEditClick} ...>
    edit
  </button>
</div>
```

To:
```svelte
<div class="px-8 pb-6 text-right">
  <button onclick={handleEditClick} ...>
    edit
  </button>
</div>
```

---

## Visual Result

**Before:**
```
+-------------------+  +--------------+
| Information (60%) |  | Location(40%)|
| ...               |  | ...          |
| edit              |  | edit         |
+-------------------+  +--------------+
  ^LEFT                   ^LEFT
```

**After:**
```
+------------------+  +---------------+
| Information(55%) |  | Location(45%) |
| ...              |  | ...           |
|             edit |  |          edit |
+------------------+  +---------------+
          ^RIGHT              ^RIGHT
```

---

## Files to Modify

| File | Changes |
|------|---------|
| LocationDetail.svelte | Change `w-3/5` → `w-[55%]`, `w-2/5` → `w-[45%]` |
| LocationInfo.svelte | Add `text-right` to edit button container |
| LocationMapSection.svelte | Add `text-right` to edit button container |

---

## Verification Checklist

After implementation, verify on:
- [ ] Regular location page
- [ ] Host location page (with sub-locations)
- [ ] Sub-location page

Check:
- [ ] Edit buttons appear right-justified in both boxes
- [ ] Information box is 55% width
- [ ] Location box is 45% width
- [ ] Boxes still stretch to equal height
- [ ] Edit modals still open correctly

---

## Rollback Plan

Revert changes to:
- LocationDetail.svelte
- LocationInfo.svelte
- LocationMapSection.svelte

No database or IPC changes required.
