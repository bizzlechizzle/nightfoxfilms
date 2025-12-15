# DECISION: Import Intelligence - Smart Location Matching

**Status:** Implemented
**Date:** 2025-11-29

## Problem Statement

When creating a new location (e.g., "AES Westover" from phone EXIF), the system doesn't warn the user that a nearby location already exists (e.g., "Johnson City Power Plant" ~200ft away). This leads to:

1. **Duplicate entries** for the same physical location with different names
2. **Missed opportunity** to add an AKA name to existing location instead
3. **Data fragmentation** - media split across duplicate locations

## Current Infrastructure

### Already Available

| Component | Location | Purpose |
|-----------|----------|---------|
| `haversineDistance()` | `electron/services/geo-utils.ts` | Calculate GPS distance in meters |
| `getBoundingBox()` | `electron/services/geo-utils.ts` | Pre-filter candidates by lat/lng range |
| `jaroWinklerSimilarity()` | `electron/services/jaro-winkler-service.ts` | Fuzzy name matching (0-1 score) |
| `RefMapDedupService` | `electron/services/ref-map-dedup-service.ts` | Reference map dedup (uses above tools) |
| `location:findNearby` | `electron/main/ipc-handlers/locations.ts` | Find locations within radius |
| `location:checkDuplicates` | `electron/main/ipc-handlers/locations.ts` | Address-based duplicate check |

### Detection Criteria

**Trigger proximity alert when:**
- Distance ≤ **200 meters** (~660 feet, ~1/8 mile)
- Regardless of name similarity (user decides if same location)

**Additional context to show:**
- Name similarity score (Jaro-Winkler)
- Exact distance in feet/meters
- Existing location's type, address, media count

---

## Proposed Solution

### 1. New IPC Handler: `location:findNearbyForAlert`

```typescript
// Returns locations within 200m for duplicate alert
ipcMain.handle('location:findNearbyForAlert', async (_event, lat: number, lng: number) => {
  const ALERT_RADIUS_METERS = 200; // ~1/8 mile
  const nearby = await locationRepo.findNearby(lat, lng, ALERT_RADIUS_METERS / 1000);
  return nearby.map(loc => ({
    ...loc,
    distanceFeet: Math.round(loc.distance * 3.281), // Convert meters to feet
  }));
});
```

### 2. UI: Nearby Location Alert Component

When user is creating a location AND GPS is provided (from map click or EXIF):

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠️ NEARBY LOCATION FOUND                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  "Johnson City Power Plant" is 450 feet away                    │
│   Type: Power Plant  •  Status: Abandoned  •  12 photos         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Is this the same location?                               │   │
│  │                                                          │   │
│  │  [Add as AKA Name]     [View Location]    [Different]   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3. User Actions

| Action | Behavior |
|--------|----------|
| **Add as AKA Name** | Append new name to existing location's `akanam` field, navigate to that location |
| **View Location** | Open existing location in new tab/modal for comparison |
| **Different Location** | Dismiss alert, proceed with creating new location |

### 4. Integration Points

**A. Atlas.svelte - Right-click "Add Location"**
- After `handleAddLocation()` calls `openImportModal()` with GPS
- ImportModal checks for nearby locations before showing form

**B. ImportForm.svelte - Create Location**
- When GPS is provided (from map or pre-filled)
- Check nearby before `handleCreateLocation()`
- Show alert modal if matches found

**C. ImportModal.svelte**
- Receives GPS from Atlas right-click
- Runs nearby check on mount if GPS provided

---

## Implementation Steps

### Phase 1: Backend
1. Add `location:findNearbyForAlert` IPC handler (200m radius, includes media count)
2. Add `location:addAkaName` IPC handler (appends to existing akanam)

### Phase 2: UI Component
3. Create `NearbyLocationAlert.svelte` component
4. Display nearby location details with action buttons

### Phase 3: Integration
5. Integrate alert into `ImportModal.svelte`
6. Integrate alert into `ImportForm.svelte`
7. Add "Add as AKA" action handler

### Phase 4: Polish
8. Show name similarity score if names are somewhat similar
9. Add "Don't ask again for this location" option (per-session)

---

## Files to Modify/Create

| File | Action |
|------|--------|
| `electron/main/ipc-handlers/locations.ts` | Add `findNearbyForAlert`, `addAkaName` handlers |
| `electron/repositories/sqlite-location-repository.ts` | Add `addAkaName()` method |
| `src/components/NearbyLocationAlert.svelte` | **NEW** - Alert component |
| `src/components/ImportModal.svelte` | Integrate nearby check |
| `src/components/ImportForm.svelte` | Integrate nearby check |
| `electron/preload/index.ts` | Expose new IPC methods |
| `src/types/electron.d.ts` | Add TypeScript types |

---

## Constants

```typescript
// lib/constants.ts
export const NEARBY_ALERT_CONFIG = {
  RADIUS_METERS: 200,        // ~660 feet, ~1/8 mile
  RADIUS_FEET: 660,
  SHOW_SIMILARITY: true,     // Show name similarity score
} as const;
```

---

## Implementation Summary

### Files Created
- `electron/services/import-intelligence-service.ts` - Core matching engine
- `electron/main/ipc-handlers/import-intelligence.ts` - IPC handlers
- `src/components/ImportIntelligence.svelte` - Smart match UI component

### Files Modified
- `electron/main/ipc-handlers/index.ts` - Register handlers
- `electron/preload/index.ts` - Expose APIs
- `src/types/electron.d.ts` - TypeScript types
- `src/components/ImportModal.svelte` - Integrated intelligence panel

### Configuration
- Scan radius: 500 meters (~1/3 mile)
- Confidence thresholds: 80% (exact), 60% (likely), 40% (possible)
- Sources checked: locations, sub-locations, reference map points
- Max matches shown: 5

### Flow
1. User right-clicks on map → "Add Location"
2. Modal opens with GPS prefilled
3. Intelligence panel scans archive automatically
4. If matches found: shows match cards with "Import Here" / "View" / "Add as AKA"
5. If no matches: shows "No existing locations nearby" with "Create New Location"
6. User can dismiss intelligence to show create form
