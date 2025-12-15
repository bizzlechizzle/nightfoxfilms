# OPT-107: Fix Mini-Map "Expand to Atlas" Navigation

**Status:** Proposed
**Author:** Claude
**Date:** 2025-12-08

---

## Problem Statement

When clicking "Expand to Atlas" on the mini-map in LocationDetail, the user expects to be taken to the Atlas page with the map centered and zoomed on their current location. Currently, clicking this button navigates to Atlas but:

1. The map does NOT center on the location's coordinates
2. The map does NOT zoom to the appropriate level
3. The location is NOT highlighted

The URL parameters ARE being passed correctly (verified in LocationMapSection.svelte:212-218), but Atlas.svelte is NOT reading and applying them to the Map component.

---

## Root Cause Analysis

### What Works (LocationMapSection.svelte)

The `openOnAtlas()` function correctly builds the URL with parameters:

```typescript
function openOnAtlas() {
  if (effectiveGpsLat && effectiveGpsLng) {
    router.navigate(`/atlas?lat=${effectiveGpsLat}&lng=${effectiveGpsLng}&zoom=${mapZoom}&locid=${location.locid}&layer=satellite-labels`);
  } else {
    router.navigate('/atlas');
  }
}
```

### What's Broken (Atlas.svelte)

1. **URL parameters ARE parsed** (lines 56-106):
   - `routeQuery` reads `lat`, `lng`, `zoom`, `locid`, `layer` from URL
   - `highlightLocid` is derived from `routeQuery.locid`
   - `urlLayer` validates and extracts the layer

2. **BUT parameters are NOT passed to Map component** (lines 578-593):
   ```svelte
   <Map
     locations={filteredLocations()}
     ...
     defaultLayer={urlLayer ?? 'satellite-labels'}
     fitBounds={true}  <!-- This overrides center/zoom! -->
     onBoundsChange={handleBoundsChange}
   />
   ```

   **Missing:**
   - `center` prop (should be `{lat: urlLat, lng: urlLng}`)
   - `zoom` prop (should be `urlZoom`)
   - Location highlighting via `highlightLocid`

3. **`fitBounds={true}` conflicts with explicit center/zoom**:
   - When `fitBounds` is true, the Map auto-fits all visible markers
   - This overrides any explicit `center`/`zoom` props
   - Need conditional: only `fitBounds` if no URL params provided

---

## Proposed Fix

### Step 1: Extract URL parameters in Atlas.svelte

Add derived values for lat, lng, and zoom from URL:

```typescript
// Parse numeric URL params for center/zoom
const urlLat = $derived(routeQuery.lat ? parseFloat(routeQuery.lat) : null);
const urlLng = $derived(routeQuery.lng ? parseFloat(routeQuery.lng) : null);
const urlZoom = $derived(routeQuery.zoom ? parseInt(routeQuery.zoom, 10) : null);

// Build center object if both lat/lng are valid
const urlCenter = $derived(
  urlLat !== null && urlLng !== null && !isNaN(urlLat) && !isNaN(urlLng)
    ? { lat: urlLat, lng: urlLng }
    : null
);

// Only fitBounds when NO explicit view is provided
const shouldFitBounds = $derived(!urlCenter);
```

### Step 2: Pass parameters to Map component

Update the Map component invocation:

```svelte
<Map
  locations={filteredLocations()}
  onLocationClick={handleLocationClick}
  onMapClick={handleMapClick}
  onMapRightClick={handleMapRightClick}
  popupMode="minimal"
  defaultLayer={urlLayer ?? 'satellite-labels'}
  center={urlCenter}
  zoom={urlZoom}
  highlightLocid={highlightLocid}
  refMapPoints={refMapPoints}
  showRefMapLayer={showRefMapLayer}
  onCreateFromRefPoint={handleCreateFromRefPoint}
  onLinkRefPoint={handleLinkRefPoint}
  onDeleteRefPoint={handleDeleteRefPoint}
  hideAttribution={true}
  fitBounds={shouldFitBounds}
  onBoundsChange={handleBoundsChange}
/>
```

### Step 3: Location highlighting (deferred)

The `highlightLocid` prop does NOT exist in Map.svelte. Adding it would require:
- New prop in interface
- Visual distinction logic in marker rendering (pulse animation, different color, larger size)
- Potential popup auto-open

**Recommendation:** Defer highlighting to a future ticket. The primary fix (centering + zooming) provides 90% of the value. The location will be visible at the center of the map at the correct zoom level.

---

## Files to Modify

1. **`packages/desktop/src/pages/Atlas.svelte`** (primary fix)
   - Add URL parameter parsing for lat/lng/zoom
   - Pass `center`, `zoom` to Map
   - Conditionally disable `fitBounds` when URL params exist

2. **`packages/desktop/src/components/Map.svelte`** (no changes needed)
   - Already supports `center` and `zoom` props (verified lines 311-313, 545-550)
   - Already has `hasExplicitView` logic to prevent auto-zoom override

---

## Testing Checklist

1. Navigate to a location with GPS coordinates
2. Click "Expand to Atlas" button on mini-map
3. **Verify:**
   - [ ] Atlas opens centered on the location's coordinates
   - [ ] Zoom level matches the mini-map zoom
   - [ ] Layer is satellite-labels (consistent with mini-map)
   - [ ] Location marker is visible and potentially highlighted
4. **Edge cases:**
   - [ ] Location without GPS → Atlas opens at default view
   - [ ] Sub-location GPS (building) → Uses building coordinates
   - [ ] Host location (campus) → Uses reduced zoom level

---

## Risk Assessment

- **Low risk**: Only modifying how URL parameters are consumed
- **No database changes**
- **No new dependencies**
- **Backwards compatible**: Default behavior unchanged when no URL params

---

## Decision

Restore the "Expand to Atlas" functionality by properly wiring URL parameters from navigation to the Map component. The fix is straightforward prop-passing that was likely lost during a refactor.
