# Buildings Tagline - Implementation Plan

## Full Audit

### Current State

**LocationInfo.svelte:443-458** - Buildings section in info box:
```html
{#if hasSublocations}
  <div class="mb-4">
    <h3 class="section-title mb-1">Buildings</h3>
    <p class="text-base">
      {#each sublocations as subloc, i}
        <button onclick={navigate}>...</button>
      {/each}
    </p>
  </div>
{/if}
```

**LocationDetail.svelte:785-793** - Sub-location shows host tagline:
```html
{#if isViewingSubLocation}
  <button class="host-tagline ...">
    {location.locnam}  ← host location name
  </button>
{/if}
```

### User Request

- Remove buildings list from LocationInfo box on host location page
- Add buildings count below host location title (same style as sub-location's host tagline)

---

## Solution

### Visual Target

**Sub-location page (current):**
```
      SCHOOLHOUSE
        St. Agnes  ← tiny clickable link to host
```

**Host location page (target):**
```
      ST. AGNES
      2 Buildings  ← tiny clickable text
```

---

## Implementation

### Step 1: Remove Buildings section from LocationInfo (host view only)

**File:** `LocationInfo.svelte:443-458`

Remove the entire `{#if hasSublocations}...{/if}` block

### Step 2: Add buildings tagline to LocationDetail

**File:** `LocationDetail.svelte:785-793`

Add condition for host locations with buildings:

```html
{#if isViewingSubLocation}
  <!-- Host location tagline (sub-location view) -->
  <button class="host-tagline ..." onclick={navigate to host}>
    {location.locnam}
  </button>
{:else if isHostLocation && sublocations.length > 0}
  <!-- Buildings tagline (host location view) -->
  <button class="host-tagline ..." onclick={scroll to Buildings section}>
    {sublocations.length} {sublocations.length === 1 ? 'Building' : 'Buildings'}
  </button>
{/if}
```

---

## Files Changed

| File | Line | Change |
|------|------|--------|
| `LocationInfo.svelte` | 443-458 | Remove Buildings section entirely |
| `LocationDetail.svelte` | 785-793 | Add buildings tagline for host locations |

---

## Visual Before/After

### Host Location Page

**BEFORE:**
```
┌─────────────────────────────────────────┐
│          ST. AGNES                      │  ← title only
└─────────────────────────────────────────┘

┌─────────────────────────┐
│ Information             │
│                         │
│ Buildings               │  ← in info box
│ Schoolhouse / Rectory   │
│                         │
│ Status: Abandoned       │
└─────────────────────────┘
```

**AFTER:**
```
┌─────────────────────────────────────────┐
│          ST. AGNES                      │
│         2 Buildings                     │  ← tiny tagline
└─────────────────────────────────────────┘

┌─────────────────────────┐
│ Information             │
│                         │  ← no Buildings section
│ Status: Abandoned       │
└─────────────────────────┘
```

---

## Testing Checklist

- [ ] Host location: "X Buildings" appears below title (tiny clickable text)
- [ ] Host location: Buildings section removed from info box
- [ ] Host location: Clicking "X Buildings" scrolls to Buildings & Structures section
- [ ] Sub-location page: Still shows host location name as tagline
- [ ] Standard location: No tagline (not a host, not a sub-location)
- [ ] Host with 1 building: Shows "1 Building" (singular)
- [ ] Host with 0 buildings: No tagline shown
