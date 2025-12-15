# Reference Point to Location Feature Plan

## Overview
Enable users to create a new location directly from a reference map point popup on the Atlas. The popup will include a "Create Location" button that opens the ImportModal with pre-filled data from the reference point.

## User Flow
1. User views Atlas with Reference Map layer enabled ("Refs On")
2. User clicks a purple reference point marker
3. Popup shows point name, description, category
4. **NEW**: Popup includes "Create Location" button
5. Clicking button opens ImportModal with:
   - Name: Pre-filled from reference point name
   - State: Pre-filled from reference point state (if available)
   - GPS: Pre-filled with lat/lng from reference point
6. User only needs to select Type (required) to continue
7. User clicks "Create" → Location saved with verified GPS

## Technical Changes

### 1. Map.svelte - Add button to reference point popup
**File:** `packages/desktop/src/components/Map.svelte`
**Lines:** ~791-803 (popup template)

Current popup:
```html
<div class="ref-map-popup">
  <strong>{name}</strong>
  {desc}
  {category}
</div>
```

New popup:
```html
<div class="ref-map-popup">
  <strong>{name}</strong>
  {desc}
  {category}
  <button class="create-from-ref-btn"
    data-name="{name}"
    data-lat="{lat}"
    data-lng="{lng}"
    data-state="{state}">
    + Create Location
  </button>
</div>
```

### 2. Map.svelte - Add event delegation for button clicks
**Location:** Near the viewDetailsClickHandler pattern (~line 600-650)

Add event delegation to catch "create-from-ref-btn" clicks and emit an event/callback with the reference point data.

### 3. Map.svelte - Add new prop for callback
**Location:** Props interface (~line 193-220)

```typescript
onCreateFromRefPoint?: (data: { name: string; lat: number; lng: number; state: string | null }) => void;
```

### 4. Atlas.svelte - Handle callback and open ImportModal
**File:** `packages/desktop/src/pages/Atlas.svelte`
**Location:** After loadRefMapPoints function (~line 205)

```typescript
function handleCreateFromRefPoint(data: { name: string; lat: number; lng: number; state: string | null }) {
  openImportModal({
    prefilledData: {
      gps_lat: data.lat,
      gps_lng: data.lng,
      state: data.state,
    }
  });
  // Note: Name needs to be set separately since ImportModal binds name internally
}
```

### 5. Atlas.svelte - Pass callback to Map component
**Location:** Map component usage (~line 342)

```svelte
<Map
  ...
  onCreateFromRefPoint={handleCreateFromRefPoint}
/>
```

### 6. ImportModal Store - Extend prefilled data
**File:** `packages/desktop/src/stores/import-modal-store.ts`

Ensure the prefilledData interface supports:
- `gps_lat: number`
- `gps_lng: number`
- `state: string`
- `name: string` (NEW - add if not present)

### 7. ImportModal.svelte - Handle prefilled name
**File:** `packages/desktop/src/components/ImportModal.svelte`
**Location:** Effect for prefilledData (~line 185-194)

Add handling for prefilled name:
```typescript
if ($importModal.prefilledData?.name) {
  name = $importModal.prefilledData.name;
}
```

## Files to Modify
1. `packages/desktop/src/components/Map.svelte` - Popup button + event handler + new prop
2. `packages/desktop/src/pages/Atlas.svelte` - Callback handler
3. `packages/desktop/src/stores/import-modal-store.ts` - Extend interface (if needed)
4. `packages/desktop/src/components/ImportModal.svelte` - Handle prefilled name

## CSS Additions
Add to Map.svelte `<style>`:
```css
:global(.create-from-ref-btn) {
  margin-top: 8px;
  padding: 4px 8px;
  background: #9333ea;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  width: 100%;
}
:global(.create-from-ref-btn:hover) {
  background: #7e22ce;
}
```

## Validation Requirements
- Name: Pre-filled but editable (from ref point)
- State: Pre-filled if available in ref point data (many may be null)
- Type: REQUIRED - user must select
- GPS: Auto-filled, shown as "GPS coordinates pre-filled" indicator

## GPS Source
When creating location from ref point:
- `gps_source`: 'reference_map' or 'map_confirmed' (since it's from verified source)
- `gps_verified_on_map`: true
- `gps_lat` / `gps_lng`: from reference point

## Edge Cases
1. **No state in ref point**: State field empty, user can type
2. **No name in ref point**: Name field shows "Unnamed Point", user should rename
3. **Duplicate name**: Normal duplicate handling applies

## Testing Checklist
- [ ] Purple marker popup shows "Create Location" button
- [ ] Clicking button opens ImportModal
- [ ] Name is pre-filled from reference point
- [ ] State is pre-filled (if available)
- [ ] GPS indicator shows coordinates
- [ ] Type is required before creating
- [ ] Location created with correct GPS data
- [ ] GPS shows as verified on map

## Scope
- In scope: Button, popup, ImportModal integration, GPS prefill
- Out of scope: Batch creation, reference point deletion after use, linking ref point to location
