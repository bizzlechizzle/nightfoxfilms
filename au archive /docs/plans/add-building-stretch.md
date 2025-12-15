# Add Building Full-Width Stretch - Implementation Plan

## Full Audit

### Current Structure (SubLocationGrid.svelte:57-115)

```html
<div class="grid grid-cols-2 gap-4">
  {#each sublocations as subloc}
    <button class="building-card">...</button>
  {/each}

  <!-- Add card (same grid, 1 column) -->
  {#if onAddSubLocation}
    <button class="add-card" style="aspect-ratio: 1.618;">
      Add Building
    </button>
  {/if}
</div>
```

### Current Behavior

| Building Count | Grid Layout |
|----------------|-------------|
| 1 (odd) | `[Building] [Add]` ← fills row nicely |
| 2 (even) | `[Building] [Building]` `[Add] [empty]` ← looks awkward |
| 3 (odd) | `[B1] [B2]` `[B3] [Add]` ← fills row nicely |
| 4 (even) | `[B1] [B2]` `[B3] [B4]` `[Add] [empty]` ← looks awkward |

### User Request

When building count is EVEN, "Add Building" box should stretch full width.

---

## Solution

Add conditional `col-span-2` class when building count is even:

```javascript
// Derived: Should Add Building span full width?
const addCardFullWidth = $derived(sublocations.length % 2 === 0);
```

```html
<button
  class="add-card ... {addCardFullWidth ? 'col-span-2' : ''}"
>
```

### Target Behavior

| Building Count | Grid Layout |
|----------------|-------------|
| 1 (odd) | `[Building] [Add]` ← same |
| 2 (even) | `[Building] [Building]` `[====Add Building====]` ← full width |
| 3 (odd) | `[B1] [B2]` `[B3] [Add]` ← same |
| 4 (even) | `[B1] [B2]` `[B3] [B4]` `[====Add Building====]` ← full width |

---

## Implementation

### Step 1: Add derived value for conditional span

**File:** `SubLocationGrid.svelte` (after line 32)

```javascript
// Derived: Add Building should span full width when even number of buildings
const addCardFullWidth = $derived(sublocations.length % 2 === 0);
```

### Step 2: Add conditional class to Add Building button

**File:** `SubLocationGrid.svelte:104-106`

```diff
  <button
    onclick={onAddSubLocation}
-   class="add-card rounded-lg border-2 border-dashed border-gray-200 hover:border-accent hover:bg-accent/5 transition flex flex-col items-center justify-center gap-2"
+   class="add-card rounded-lg border-2 border-dashed border-gray-200 hover:border-accent hover:bg-accent/5 transition flex flex-col items-center justify-center gap-2 {addCardFullWidth ? 'col-span-2' : ''}"
    style="aspect-ratio: 1.618;"
  >
```

---

## Files Changed

| File | Line | Change |
|------|------|--------|
| `SubLocationGrid.svelte` | ~32 | Add `addCardFullWidth` derived |
| `SubLocationGrid.svelte` | 106 | Add conditional `col-span-2` class |

---

## Visual Before/After

### 2 Buildings (EVEN)
```
BEFORE:                      AFTER:
┌─────────┐ ┌─────────┐     ┌─────────┐ ┌─────────┐
│Building1│ │Building2│     │Building1│ │Building2│
└─────────┘ └─────────┘     └─────────┘ └─────────┘
┌─────────┐                 ┌─────────────────────┐
│   Add   │ (empty)         │    Add Building     │
└─────────┘                 └─────────────────────┘
```

### 3 Buildings (ODD - no change)
```
┌─────────┐ ┌─────────┐
│Building1│ │Building2│
└─────────┘ └─────────┘
┌─────────┐ ┌─────────┐
│Building3│ │   Add   │
└─────────┘ └─────────┘
```

---

## Testing Checklist

- [ ] 0 buildings: Empty state shows correctly
- [ ] 1 building (odd): Add card fills second column
- [ ] 2 buildings (even): Add card spans full width
- [ ] 3 buildings (odd): Add card fills second column
- [ ] 4 buildings (even): Add card spans full width
