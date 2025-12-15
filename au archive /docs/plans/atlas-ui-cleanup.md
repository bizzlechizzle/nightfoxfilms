# Plan: Atlas Page UI Cleanup

## Goal
Clean up the Atlas page UI for a more premium, minimal feel with better map readability.

## Proposed Changes

| # | Change | File(s) |
|---|--------|---------|
| 1 | Remove attribution text ("Leaflet \| Tiles © Esri...") | Atlas.svelte, Map.svelte |
| 2 | Remove "Showing X of Y mappable locations" subtitle | Atlas.svelte |
| 3 | Remove "Set Default View" button and related state | Atlas.svelte |
| 4 | Remove "Heat On/Off" button and related state | Atlas.svelte |
| 5 | Move "Refs On/Off" to Filters as "Import Pins" checkbox | Atlas.svelte |
| 6 | Auto-fit map to show all location pins on load | Map.svelte |
| 7 | Switch to satellite-optimized labels overlay | constants.ts, Map.svelte |

## Detailed Changes

### 1. Atlas.svelte - Remove Attribution
Pass `hideAttribution={true}` to Map component.

### 2. Atlas.svelte - Remove Subtitle
Delete the paragraph showing "Showing X of Y mappable locations".

### 3. Atlas.svelte - Remove Set Default View
Delete:
- `savingDefaultView` state
- `defaultCenter` state
- `defaultZoom` state
- `saveDefaultView()` function
- Settings loading in onMount for atlas_default_*
- "Set Default View" button in header

### 4. Atlas.svelte - Remove Heat Button
Delete:
- `showHeatMap` state
- "Heat On/Off" button in header
- `showHeatMap={showHeatMap}` prop on Map

### 5. Atlas.svelte - Move Import Pins to Filters
- Remove "Refs On/Off" button from header
- Add checkbox inside filters panel:
```html
<div class="col-span-2 flex items-center gap-2 pt-2 border-t border-gray-200 mt-2">
  <input type="checkbox" id="import-pins" bind:checked={showRefMapLayer} class="w-4 h-4 accent-accent" />
  <label for="import-pins" class="text-sm text-gray-700">
    Import Pins {#if refMapPoints.length > 0}({refMapPoints.length}){/if}
  </label>
</div>
```

### 6. Map.svelte - Auto-fit Bounds
Add new prop `fitBounds?: boolean` and logic:
```typescript
if (fitBounds && locations.length > 0) {
  const validLocs = locations.filter(loc => loc.gps?.lat && loc.gps?.lng);
  if (validLocs.length > 0) {
    const bounds = L.latLngBounds(validLocs.map(loc => [loc.gps!.lat, loc.gps!.lng]));
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
  }
}
```

### 7. constants.ts + Map.svelte - Better Labels
Change LABELS URL from light_only_labels to Stamen Toner Labels:
```typescript
LABELS: 'https://stamen-tiles.a.ssl.fastly.net/toner-labels/{z}/{x}/{y}.png',
```
Update Map.svelte to remove `subdomains: 'abcd'` for labels (Stamen uses different CDN).

## Audit Against Requirements

| Requirement | Status | Notes |
|-------------|--------|-------|
| Remove attribution | ✓ | hideAttribution={true} |
| Remove subtitle | ✓ | Delete paragraph |
| Remove Set Default View | ✓ | Delete button + state + function |
| Remove Heat button | ✓ | Delete button + state |
| Move Refs to Filters as "Import Pins" | ✓ | Checkbox in filters panel |
| Auto-fit to show all pins | ✓ | fitBounds prop with padding |
| Better labels for satellite | ✓ | Stamen Toner Labels |

## Audit Against claude.md

| Rule | Compliance |
|------|------------|
| Scope Discipline | ✓ Only implementing requested changes |
| Keep It Simple | ✓ Minimal changes, no new abstractions |
| No AI in Docs | ✓ No AI mentions in UI |
| Prefer existing patterns | ✓ Using existing prop patterns |
| No new dependencies | ✓ Just URL change for tiles |

## Files to Modify

1. `packages/desktop/src/lib/constants.ts` - Change LABELS URL
2. `packages/desktop/src/components/Map.svelte` - Add fitBounds prop, remove labels subdomains
3. `packages/desktop/src/pages/Atlas.svelte` - Remove buttons/state, add checkbox, pass props

## UI Before → After

**Header Before:**
```
Atlas                     [Set Default View] [Heat Off] [Refs Off] [Show Filters]
Showing 5 of 5 mappable locations
```

**Header After:**
```
Atlas                                                              [Show Filters]
```

**Filters Panel After:**
```
┌─────────────────────────────────────────────────────────────────┐
│ State              │ Type                                       │
│ [All States ▼]     │ [All Types ▼]                             │
├─────────────────────────────────────────────────────────────────┤
│ [✓] Import Pins (47)                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

# Implementation Guide for Junior Developer

## Overview
We're cleaning up the Atlas page to be simpler and more premium. The main tasks are:
1. Remove clutter from the header
2. Move one toggle into the filters
3. Make the map auto-zoom to fit all pins
4. Improve label readability on satellite view

## Step-by-Step Implementation

### Step 1: Update constants.ts (5 minutes)
**File:** `packages/desktop/src/lib/constants.ts`

Find line 27:
```typescript
LABELS: 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
```

Change to:
```typescript
LABELS: 'https://stamen-tiles.a.ssl.fastly.net/toner-labels/{z}/{x}/{y}.png',
```

**Why:** The old labels were designed for light backgrounds. Stamen Toner has high-contrast black/white labels that work on satellite imagery.

### Step 2: Update Map.svelte - Labels (5 minutes)
**File:** `packages/desktop/src/components/Map.svelte`

Find the Labels overlay (around line 425):
```typescript
'Labels': L.tileLayer(TILE_LAYERS.LABELS, {
  attribution: hideAttribution ? '' : '&copy; CartoDB',
  maxZoom: MAP_CONFIG.MAX_ZOOM,
  subdomains: 'abcd',  // DELETE THIS LINE
}),
```

Remove `subdomains: 'abcd'` - Stamen doesn't use subdomains.

Change attribution to:
```typescript
attribution: hideAttribution ? '' : '&copy; Stamen Design',
```

### Step 3: Update Map.svelte - Add fitBounds prop (10 minutes)
**File:** `packages/desktop/src/components/Map.svelte`

**3a.** Find Props interface (around line 170) and add:
```typescript
// Auto-fit map to show all locations on load
fitBounds?: boolean;
```

**3b.** Find props destructuring (around line 200) and add:
```typescript
fitBounds = false,
```

**3c.** Find where markers are initialized (look for `initCluster()` call, around line 545). After `initCluster(); updateClusters(L);` add:
```typescript
// Auto-fit to show all location pins
if (fitBounds && locations.length > 0) {
  const validLocs = locations.filter(loc => {
    const coords = getLocationCoordinates(loc);
    return coords && !coords.isApproximate;
  });
  if (validLocs.length > 0) {
    const bounds = L.latLngBounds(
      validLocs.map(loc => {
        const coords = getLocationCoordinates(loc)!;
        return [coords.lat, coords.lng] as [number, number];
      })
    );
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }
}
```

**Why:** This makes the map automatically zoom/pan to show all pins with some padding.

### Step 4: Update Atlas.svelte - Clean up state (10 minutes)
**File:** `packages/desktop/src/pages/Atlas.svelte`

**4a.** Delete these state variables (around lines 26-35):
```typescript
// DELETE: let showHeatMap = $state(false);
// DELETE: let savingDefaultView = $state(false);
// DELETE: let defaultCenter = $state<{ lat: number; lng: number } | null>(null);
// DELETE: let defaultZoom = $state<number | null>(null);
```

**4b.** Delete the `saveDefaultView` function (around lines 238-260).

**4c.** In onMount, delete the settings loading for atlas_default_* (search for "atlas_default").

### Step 5: Update Atlas.svelte - Clean up header (15 minutes)
**File:** `packages/desktop/src/pages/Atlas.svelte`

Find the header section (around line 280). Change from:
```html
<div class="flex items-center justify-between ...">
  <div>
    <h1 class="text-xl font-semibold text-foreground">Atlas</h1>
    <p class="text-xs text-gray-500">
      {#if !loading}
        Showing {filteredLocations().length} of {locations.length} mappable locations
      {/if}
    </p>
  </div>
  <div class="flex items-center gap-2">
    <!-- DELETE: Set Default View button -->
    <!-- DELETE: Heat On/Off button -->
    <!-- DELETE: Refs On/Off button -->
    <button ... Show Filters ...>
  </div>
</div>
```

To:
```html
<div class="flex items-center justify-between bg-white border-b border-gray-200 px-6 py-4">
  <h1 class="text-xl font-semibold text-foreground">Atlas</h1>
  <button
    onclick={() => showFilters = !showFilters}
    class="px-4 py-2 bg-gray-100 text-foreground rounded hover:bg-gray-200 transition text-sm"
  >
    {showFilters ? 'Hide' : 'Show'} Filters
  </button>
</div>
```

### Step 6: Update Atlas.svelte - Add Import Pins to Filters (10 minutes)
**File:** `packages/desktop/src/pages/Atlas.svelte`

Find the filters section (around line 325). After the grid with State/Type dropdowns, add:
```html
{#if showFilters}
  <div class="bg-gray-50 border-b border-gray-200 px-6 py-4">
    <div class="grid grid-cols-2 gap-4">
      <!-- existing State dropdown -->
      <!-- existing Type dropdown -->
    </div>
    <!-- ADD THIS: -->
    <div class="flex items-center gap-2 pt-3 mt-3 border-t border-gray-200">
      <input
        type="checkbox"
        id="import-pins"
        bind:checked={showRefMapLayer}
        class="w-4 h-4 accent-accent rounded"
      />
      <label for="import-pins" class="text-sm text-gray-700 cursor-pointer">
        Import Pins
        {#if refMapPoints.length > 0}
          <span class="text-gray-400">({refMapPoints.length})</span>
        {/if}
      </label>
    </div>
  </div>
{/if}
```

### Step 7: Update Atlas.svelte - Update Map props (5 minutes)
**File:** `packages/desktop/src/pages/Atlas.svelte`

Find the Map component (around line 363). Update props:
```html
<Map
  locations={filteredLocations()}
  onLocationClick={handleLocationClick}
  onMapClick={handleMapClick}
  onMapRightClick={handleMapRightClick}
  popupMode="minimal"
  defaultLayer="satellite-labels"
  refMapPoints={refMapPoints}
  showRefMapLayer={showRefMapLayer}
  onCreateFromRefPoint={handleCreateFromRefPoint}
  onDeleteRefPoint={handleDeleteRefPoint}
  hideAttribution={true}
  fitBounds={true}
/>
```

Remove:
- `showHeatMap={showHeatMap}`
- `zoom={urlZoom ?? undefined}`
- `center={urlCenter ?? undefined}`

**Note:** We're removing zoom/center URL params since we auto-fit now.

## Testing Checklist
- [ ] Atlas loads and auto-zooms to fit all pins
- [ ] No attribution text visible
- [ ] No subtitle visible
- [ ] Only "Show Filters" button in header
- [ ] Import Pins checkbox appears in filters panel
- [ ] Checking Import Pins shows reference points on map
- [ ] Labels are readable on satellite view (high contrast)
- [ ] Map layer switcher still works

## Common Issues
1. **Labels not showing:** Check you removed `subdomains: 'abcd'` from labels config
2. **Map not fitting:** Check fitBounds prop is passed and locations have GPS data
3. **TypeScript errors:** Make sure fitBounds is in Props interface and destructured
