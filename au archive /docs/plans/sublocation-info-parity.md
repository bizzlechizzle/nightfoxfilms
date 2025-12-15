# Sub-Location Info Box Parity - Implementation Plan

## Full Audit

### Current State

**LocationDetail.svelte:785-804** - Tagline below title:
```html
{#if isViewingSubLocation}
  <!-- Host location tagline (sub-location view) -->
  <button onclick={navigate to host} class="host-tagline ...">
    {location.locnam}  ← host location name as tiny link
  </button>
{:else if isHostLocation && sublocations.length > 0}
  <!-- Buildings tagline (host location view) -->
  {#each sublocations as subloc}
    <button onclick={navigate to building}>{subloc.subnam}</button>
  {/each}
{/if}
```

**LocationInfo.svelte:429-441** - "Part of" section in info box:
```html
{#if hasParentLocation}
  <div class="mb-4">
    <h3 class="section-title mb-1">Part of</h3>
    <button onclick={navigate to host}>
      {parentLocation!.locnam}
    </button>
  </div>
{/if}
```

**LocationDetail.svelte:823** - onSave disabled for sub-locations:
```html
<LocationInfo
  ...
  onSave={isViewingSubLocation ? undefined : handleSave}
  ...
/>
```

### User Request

1. Remove "Part of" section from info box on sub-location page (redundant - host link is already below title)
2. Make info box editable on sub-location page (same as host location page)

---

## Solution

### Visual Target

**Host location page:**
```
      ST. AGNES
      Schoolhouse / Rectory  ← buildings as tagline

┌─────────────────────────┐
│ Information     [edit]  │  ← editable
│                         │
│ Status: Abandoned       │
│ Type: Church            │
└─────────────────────────┘
```

**Sub-location page (CURRENT):**
```
      SCHOOLHOUSE
        St. Agnes            ← host as tagline

┌─────────────────────────┐
│ Information             │  ← NOT editable
│                         │
│ Part of                 │  ← REDUNDANT (host in tagline)
│ St. Agnes               │
│                         │
│ Status: Abandoned       │
└─────────────────────────┘
```

**Sub-location page (TARGET):**
```
      SCHOOLHOUSE
        St. Agnes            ← host as tagline (kept)

┌─────────────────────────┐
│ Information     [edit]  │  ← editable (matches host)
│                         │
│ Status: Abandoned       │  ← no "Part of" section
│ Type: Church            │
└─────────────────────────┘
```

---

## Implementation

### Step 1: Remove "Part of" section from LocationInfo

**File:** `LocationInfo.svelte:429-441`

Delete the entire `{#if hasParentLocation}...{/if}` block

### Step 2: Enable editing on sub-location page

**File:** `LocationDetail.svelte:823`

Change:
```svelte
onSave={isViewingSubLocation ? undefined : handleSave}
```

To:
```svelte
onSave={handleSave}
```

### Step 3: Clean up unused props

**File:** `LocationInfo.svelte:50`

Remove `parentLocation` from Props interface (no longer used)

**File:** `LocationInfo.svelte:58`

Remove `parentLocation = null` from destructuring

**File:** `LocationDetail.svelte:827`

Remove the `parentLocation` prop from LocationInfo component

---

## Files Changed

| File | Line | Change |
|------|------|--------|
| `LocationInfo.svelte` | 429-441 | Remove "Part of" section |
| `LocationInfo.svelte` | 50, 58 | Remove unused parentLocation prop |
| `LocationDetail.svelte` | 823 | Enable onSave for sub-locations |
| `LocationDetail.svelte` | 827 | Remove parentLocation prop |

---

## Visual Before/After

### Sub-Location Info Box

**BEFORE:**
```
┌─────────────────────────┐
│ Information             │  ← no edit button
│                         │
│ Part of                 │
│ St. Agnes               │  ← redundant link
│                         │
│ Status: Abandoned       │
│ Type: Church            │
└─────────────────────────┘
```

**AFTER:**
```
┌─────────────────────────┐
│ Information     [edit]  │  ← edit button enabled
│                         │
│ Status: Abandoned       │  ← "Part of" removed
│ Type: Church            │
└─────────────────────────┘
```

---

## Testing Checklist

- [ ] Host location page: "edit" button visible, info box editable
- [ ] Host location page: Buildings shown as tagline below title
- [ ] Sub-location page: Host shown as tagline below title (existing)
- [ ] Sub-location page: "edit" button visible on info box (NEW)
- [ ] Sub-location page: "Part of" section no longer appears (REMOVED)
- [ ] Sub-location page: Editing info box saves to host location data
- [ ] Standard location (no sub-locations): Works as before
