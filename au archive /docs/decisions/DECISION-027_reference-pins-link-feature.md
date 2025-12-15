# DECISION-027: Reference Pins Link Feature

**Date**: 2024-12-01
**Status**: Implemented
**Area**: Atlas / Reference Map Points

## Summary

Renamed "Import Pins" to "Reference Pins" in the Atlas UI and added a "Link" button to reference point popups that allows manually associating a reference point with an existing location.

## Changes

### 1. UI Rename: Import Pins → Reference Pins

The checkbox in Atlas filters that toggles visibility of reference map points was renamed from "Import Pins" to "Reference Pins" for clarity. These are pins imported from KML/GPX/GeoJSON files used as reference data.

**File**: `packages/desktop/src/pages/Atlas.svelte`

### 2. Reference Point Popup Button Layout

Updated the popup that appears when clicking a reference pin on the map:

**Before**: `{+ Create Location} {Trash}`

**After**: `{+ Create} {Link} {Trash}`

- **+ Create**: Creates a new location from this reference point (existing functionality)
- **Link**: Opens a modal to search and link to an existing location (new)
- **Trash**: Deletes the reference point (existing functionality)

**File**: `packages/desktop/src/components/Map.svelte`

### 3. LinkLocationModal Component

New modal component for searching and selecting an existing location to link:

- Text search input with 300ms debounce
- Filters locations by name, type, city, or state
- Shows up to 20 results with name, type, and location info
- Click to select and confirm link
- Escape key or Cancel button to close

**File**: `packages/desktop/src/components/LinkLocationModal.svelte`

### 4. IPC Handler: refMaps:linkToLocation

New IPC handler that links a reference point to an existing location by setting `linked_locid` and `linked_at` columns. Linked points are automatically filtered out of the Reference Pins layer (existing filter logic).

**File**: `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

## Database

No schema changes required. Uses existing columns from Migration 42:
- `ref_map_points.linked_locid` - FK to locs.locid
- `ref_map_points.linked_at` - Timestamp of linking

## Rationale

Users importing reference maps (KML files from historical sources) often have existing locations in their archive that correspond to reference points. Previously, the only options were:
1. Create a new location (potentially creating duplicates)
2. Delete the reference point (losing the association)

The Link feature allows preserving the relationship between reference data and existing locations without creating duplicates or losing provenance.

## Files Modified

- `packages/desktop/src/pages/Atlas.svelte` - Rename, modal state, handlers
- `packages/desktop/src/components/Map.svelte` - Link button in popup, event delegation
- `packages/desktop/src/components/LinkLocationModal.svelte` - New component
- `packages/desktop/electron/main/ipc-handlers/ref-maps.ts` - New IPC handler
- `packages/desktop/electron/preload/preload.cjs` - Expose linkToLocation function
