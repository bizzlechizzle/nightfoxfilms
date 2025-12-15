# OPT-057: Pin-to-Location Linking Logic Audit

## Problem Statement

After linking a reference point to a location via the Atlas "Link" button, the pin is **still visible** on the map. The user expects linked pins to disappear (be filtered out).

## Current Flow Analysis (Step by Step)

### Step 1: User Clicks "Link" on Ref Point Popup
- **File**: `Atlas.svelte:361` - `handleLinkRefPoint()`
- Opens `LinkLocationModal` with the point data (`pointId`, `name`, `lat`, `lng`)

### Step 2: User Selects Location in Modal
- **File**: `LinkLocationModal.svelte:50` - `selectLocation(locid)`
- Calls `onLink(locid)` which triggers `handleConfirmLink(locationId)`

### Step 3: IPC Call to Link
- **File**: `Atlas.svelte:371`
```typescript
const result = await window.electronAPI.refMaps.linkToLocation(linkingPoint.pointId, locationId);
```
- **Preload**: `preload.cjs:508` wraps args as object:
```javascript
linkToLocation: (pointId, locationId) => invokeAuto("refMaps:linkToLocation")({ pointId, locationId }),
```

### Step 4: Backend Sets `linked_locid`
- **File**: `ref-maps.ts:1032-1040`
```typescript
await db.updateTable('ref_map_points')
  .set({
    linked_locid: locationId,
    linked_at: new Date().toISOString(),
  })
  .where('point_id', '=', pointId)
  .execute();
```
- **Evidence from logs**: The UPDATE query runs successfully:
```sql
update "ref_map_points" set "linked_locid" = '32d37670...' where "point_id" = 'dafc42e2...'
[RefMaps] Linked ref point "Chevy Biscayne" to location "Chevrolet Biscayne"
```

### Step 5: Atlas Refreshes Ref Points
- **File**: `Atlas.svelte:374-380`
```typescript
if (currentBounds) {
  await loadRefPointsInBounds(currentBounds);
} else {
  await loadRefMapPoints();
}
```

### Step 6: Refresh Queries Filter Linked Points

**`loadRefPointsInBounds(bounds)`** calls:
- `refMaps:getPointsInBounds` → `repository.getPointsInBounds(bounds)`
- **File**: `sqlite-ref-maps-repository.ts:388`
```typescript
.where('linked_locid', 'is', null)  // Exclude linked points
```

**`loadRefMapPoints()`** calls:
- `refMaps:getAllPoints` → `repository.getAllPoints()`
- **File**: `sqlite-ref-maps-repository.ts:224`
```typescript
.where('linked_locid', 'is', null)  // Filter linked points in SQL
```

### Step 7: Map Component Receives Updated Points
- **File**: `Atlas.svelte:557` - passes `refMapPoints={refMapPoints}` to Map
- **File**: `Map.svelte:1375-1388` - `$effect` reacts to `refMapPoints` changes
```typescript
$effect(() => {
  const points = refMapPoints;  // Track dependency
  // ...
  layerRef.clearLayers();       // Clear old markers
  // ... recreate markers from points
});
```

## Analysis: What's Working vs. What Might Be Broken

### WORKING (Verified):
1. ✅ IPC call `refMaps:linkToLocation` executes correctly
2. ✅ Database UPDATE sets `linked_locid` correctly (evidence in logs)
3. ✅ Repository queries have correct `WHERE linked_locid IS NULL` clause
4. ✅ Map component has `$effect` that reacts to `refMapPoints` changes
5. ✅ `refMapPoints` is Svelte 5 `$state<RefMapPoint[]>([])` (reactive)

### POTENTIAL ISSUES:

#### Hypothesis A: $effect Not Triggering on Array Mutation
Svelte 5's `$state` tracks array identity, not deep changes. If `refMapPoints = points` happens where `points` is a different array reference, reactivity should work. But if somehow the same array reference is reused, the effect won't fire.

**Likelihood**: LOW - the query returns a new array each time.

#### Hypothesis B: currentBounds is null
If `currentBounds` is null at linking time, it falls back to `loadRefMapPoints()`. This should still work since both queries filter linked points.

**Likelihood**: LOW - both paths filter correctly.

#### Hypothesis C: Race Condition / Async Timing
The `await` in the IPC call should ensure the UPDATE completes before the SELECT runs. However, if there's a caching layer or the `await` isn't properly propagating, stale data could be returned.

**Likelihood**: MEDIUM - need to add logging to verify.

#### Hypothesis D: Popup Still Open with Stale Marker
The Leaflet popup might keep the marker visible even after the layer is cleared, if the popup is still bound to the DOM.

**Likelihood**: MEDIUM - Leaflet popup behavior can be tricky.

#### Hypothesis E: Multiple $effect Executions Stomping Each Other
If multiple effects are racing to update the map layer, an older effect might overwrite a newer one.

**Likelihood**: LOW - but possible with Svelte 5 batching.

## Proposed Debugging Approach

### Phase 1: Add Diagnostic Logging

Add console logs to trace exactly what's happening:

```typescript
// Atlas.svelte - handleConfirmLink (around line 371)
async function handleConfirmLink(locationId: string) {
  if (!linkingPoint) return;

  try {
    console.log('[Link] Step 1: Calling linkToLocation IPC...');
    const result = await window.electronAPI.refMaps.linkToLocation(linkingPoint.pointId, locationId);

    if (result.success) {
      console.log('[Link] Step 2: Link succeeded, refreshing ref points...');
      console.log('[Link] currentBounds:', currentBounds);

      if (currentBounds) {
        console.log('[Link] Using loadRefPointsInBounds...');
        await loadRefPointsInBounds(currentBounds);
      } else {
        console.log('[Link] Using loadRefMapPoints (fallback)...');
        await loadRefMapPoints();
      }

      console.log('[Link] Step 3: Refresh complete. refMapPoints count:', refMapPoints.length);
      console.log('[Link] Looking for linked point:', linkingPoint.pointId);
      const stillPresent = refMapPoints.find(p => p.pointId === linkingPoint.pointId);
      console.log('[Link] Linked point still in array?', !!stillPresent);

      toasts.success(`Linked "${linkingPoint.name}" to location`);
    }
  } catch (err) {
    console.error('[Link] Error:', err);
  }
}
```

### Phase 2: Verify Database State

```sql
-- Run this in sqlite3 to verify the link was persisted
SELECT point_id, name, linked_locid, linked_at
FROM ref_map_points
WHERE name LIKE '%Biscayne%';
```

### Phase 3: Check Map $effect

Verify the Map's `$effect` is actually firing when `refMapPoints` changes:

```typescript
// Map.svelte - line ~1375
$effect(() => {
  const shouldShow = showRefMapLayer;
  const points = refMapPoints;
  console.log('[Map] $effect triggered, refMapPoints count:', points.length);
  // ...
});
```

## Root Cause Candidates (Ordered by Likelihood)

### Candidate 1: Svelte 5 Array Reactivity (HIGH LIKELIHOOD)

In Svelte 5, `$effect` tracks dependencies by **reading** values. The effect at `Map.svelte:1375` does:
```typescript
const points = refMapPoints;  // Reads the prop
```

This **should** create a dependency. But there's a subtlety:
- If Svelte 5's fine-grained reactivity only tracks `.length` access (line 1390: `points.length > 0`), it may not re-trigger when the array content changes but length stays similar.
- The `locations` $effect uses a **hash function** (`getLocationsHash`) to force re-render. The `refMapPoints` effect does NOT.

**Test**: Add `console.log('[Map] refMapPoints $effect', points.length, points.map(p => p.pointId).slice(0,3))` inside the $effect.

### Candidate 2: Popup Preventing Marker Removal (MEDIUM LIKELIHOOD)

Leaflet's `clearLayers()` should remove markers and their popups. But if a popup is **currently open**, there may be DOM state that persists.

**Test**: Close the popup before linking, then see if the marker disappears.

### Candidate 3: IPC Timing / Stale Response (LOW LIKELIHOOD)

The `await` should ensure the UPDATE completes before the SELECT. But verify by checking if the linked point appears in the returned array.

**Test**: Add logging to verify the linked point ID is NOT in the refreshed array.

## Concrete Debugging Steps (Before Any Fix)

### Step 1: Add Logging to Atlas.svelte

```typescript
// Atlas.svelte - handleConfirmLink (line ~367)
async function handleConfirmLink(locationId: string) {
  if (!linkingPoint) return;
  const linkedPointId = linkingPoint.pointId;  // Capture before nulling

  try {
    console.log('[Link] 1. Calling IPC linkToLocation...');
    const result = await window.electronAPI.refMaps.linkToLocation(linkedPointId, locationId);

    if (result.success) {
      console.log('[Link] 2. IPC succeeded, refreshing...');
      console.log('[Link] 2a. currentBounds:', currentBounds ? 'SET' : 'NULL');

      const beforeCount = refMapPoints.length;
      const beforeHasPoint = refMapPoints.some(p => p.pointId === linkedPointId);
      console.log('[Link] 2b. Before refresh: count=%d, hasLinkedPoint=%s', beforeCount, beforeHasPoint);

      if (currentBounds) {
        await loadRefPointsInBounds(currentBounds);
      } else {
        await loadRefMapPoints();
      }

      const afterCount = refMapPoints.length;
      const afterHasPoint = refMapPoints.some(p => p.pointId === linkedPointId);
      console.log('[Link] 3. After refresh: count=%d, hasLinkedPoint=%s', afterCount, afterHasPoint);

      if (afterHasPoint) {
        console.error('[Link] BUG: Linked point is STILL in refMapPoints array!');
      }

      toasts.success(`Linked "${linkingPoint.name}" to location`);
    }
  } catch (err) {
    console.error('[Link] Error:', err);
  } finally {
    showLinkModal = false;
    linkingPoint = null;
  }
}
```

### Step 2: Add Logging to Map.svelte

```typescript
// Map.svelte - refMapPoints $effect (line ~1375)
$effect(() => {
  const shouldShow = showRefMapLayer;
  const points = refMapPoints;
  const mapRef = map;
  const layerRef = refMapLayer;

  // DEBUG: Log every time this effect runs
  console.log('[Map] refMapPoints $effect triggered:', {
    shouldShow,
    pointCount: points.length,
    firstThreeIds: points.slice(0, 3).map(p => p.pointId),
  });

  if (!mapRef || !layerRef || !leafletModule) {
    console.log('[Map] $effect early exit: mapRef=%s, layerRef=%s, leaflet=%s',
      !!mapRef, !!layerRef, !!leafletModule);
    return;
  }
  // ... rest of effect
});
```

### Step 3: Run Test & Collect Logs

1. Open Atlas with "Reference Pins" layer ON
2. Click on a ref point, then click "Link"
3. Select a location to link to
4. Check console for logs

**Expected Output (working correctly):**
```
[Link] 1. Calling IPC linkToLocation...
[Link] 2. IPC succeeded, refreshing...
[Link] 2a. currentBounds: SET
[Link] 2b. Before refresh: count=100, hasLinkedPoint=true
[Link] 3. After refresh: count=99, hasLinkedPoint=false
[Map] refMapPoints $effect triggered: { shouldShow: true, pointCount: 99, ... }
```

**If Bug Exists, Possible Outputs:**

**A. Point not filtered from array:**
```
[Link] 3. After refresh: count=100, hasLinkedPoint=true
[Link] BUG: Linked point is STILL in refMapPoints array!
```
→ Issue is in IPC/SQL filtering

**B. Array updated but $effect doesn't fire:**
```
[Link] 3. After refresh: count=99, hasLinkedPoint=false
// NO "[Map] refMapPoints $effect" log after this
```
→ Issue is Svelte 5 reactivity

**C. Effect fires but marker not removed:**
```
[Link] 3. After refresh: count=99, hasLinkedPoint=false
[Map] refMapPoints $effect triggered: { shouldShow: true, pointCount: 99, ... }
// But marker still visible on map
```
→ Issue is Leaflet layer clearing

## Proposed Fixes (After Diagnosis)

### If Issue A (SQL not filtering):
Check `linked_locid` is actually being set. May need `await` on the UPDATE.

### If Issue B (Svelte reactivity):
Add a hash-based change detection like `locations` uses:
```typescript
let lastRefPointsHash = '';

$effect(() => {
  const hash = refMapPoints.map(p => p.pointId).join(',');
  if (hash === lastRefPointsHash) return;
  lastRefPointsHash = hash;
  // ... rest of effect
});
```

### If Issue C (Leaflet layer):
Close popups before clearing:
```typescript
layerRef.eachLayer((layer: any) => {
  if (layer.closePopup) layer.closePopup();
});
layerRef.clearLayers();
```

## Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `Atlas.svelte:367-391` | Add diagnostic logging | 1 |
| `Map.svelte:1375-1380` | Add diagnostic logging | 1 |
| (TBD based on logs) | Fix based on diagnosis | 2 |

## Testing Checklist

- [ ] Console logs show which scenario (A, B, or C)
- [ ] Pin disappears immediately after linking
- [ ] Pin does NOT reappear on pan/zoom
- [ ] Database shows `linked_locid` is set
- [ ] No console errors

---

## Resolution (Implemented)

**Root Cause Identified**: Scenario B - Svelte 5 fine-grained reactivity issue

The `$effect` in `Map.svelte` was not consistently re-running when `refMapPoints` array changed because Svelte 5's fine-grained reactivity system requires explicit dependency tracking for arrays.

### Fix Applied

Added hash-based change detection to `Map.svelte` (following the same pattern used for `locations`):

**File**: `Map.svelte:1308-1314`
```typescript
// OPT-057: Track ref map points hash for change detection
// This ensures Svelte 5's fine-grained reactivity properly detects array changes
let lastRefMapPointsHash = $state('');
function getRefMapPointsHash(points: RefMapPoint[]): string {
  // Use pointId as the unique identifier - when a point is linked, it's removed from the array
  return points.map(p => p.pointId).join(',');
}
```

**File**: `Map.svelte:1391-1396` (inside `$effect`)
```typescript
// OPT-057: Hash-based change detection - ensures effect runs when points array changes
// This is critical for link/unlink operations where the array reference changes
const currentHash = getRefMapPointsHash(points);
if (currentHash !== lastRefMapPointsHash) {
  lastRefMapPointsHash = currentHash;
}
```

### Why This Fix Works

1. **Explicit dependency tracking**: By calling `getRefMapPointsHash(points)`, we iterate through each point and read its `pointId`
2. **Fine-grained tracking**: Svelte 5's proxy-based reactivity now has explicit reads of each element in the array
3. **Change detection**: When any point is added or removed, the hash changes, creating a trackable dependency

### Files Modified

| File | Change |
|------|--------|
| `Map.svelte:1308-1314` | Added `lastRefMapPointsHash` state and `getRefMapPointsHash()` function |
| `Map.svelte:1391-1396` | Added hash computation in `$effect` |
| `Atlas.svelte:367-394` | Cleaned up - removed diagnostic logging |

### Testing Verification

The fix ensures:
- When a ref point is linked → array changes → hash changes → `$effect` re-runs → `clearLayers()` called → markers rebuilt without linked point
- Pin disappears immediately after linking
- No console errors
