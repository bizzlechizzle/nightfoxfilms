# MAP-AUDIT-001: Comprehensive Map Logic Audit

**Date**: 2025-12-02
**Status**: Planning
**Priority**: HIGH

---

## Executive Summary

Three critical issues identified in the map/reference pin system:

1. **Linking Broken**: Enrichment applies GPS but doesn't mark pin as linked
2. **Stale Pin Rendering**: Old pins persist on map due to state management bug
3. **Performance Beachball**: O(N) operations on ref_map_points during load

---

## Issue 1: Linking Says Success But Doesn't Actually Link

### Symptoms
- User links reference pin to location
- UI shows "success" message
- Pin disappears (deleted from view)
- Location has GPS but pin reappears later as "catalogued match"
- Data lost if user relied on the "link"

### Root Cause Analysis

**Location**: `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

In `importWithOptions` handler (~lines 370-390), the enrichment loop:

```typescript
for (const enrichment of options.enrichments) {
  const point = parseResult.points[enrichment.pointIndex];
  const enrichResult = await enrichmentService.enrichFromGPS(enrichment.existingLocId, {
    lat: point.lat,
    lng: point.lng,
    source: 'ref_map_import',
    stateHint: point.state,
  });

  if (enrichResult.success) {
    enrichedCount++;
    // BUG: NO LINKING HERE - ref point not marked as linked!
    // It gets imported as a regular ref point with linked_locid = NULL
  }
}
```

The `enrichmentService.enrichFromGPS()` only updates the **location** table (gps_lat, gps_lng, address, regions). It does NOT update the **ref_map_points** table with `linked_locid`.

**Result**:
- Location gets GPS ✓
- Pin remains in database with `linked_locid = NULL` ✗
- Pin shows up again in "catalogued matches" later
- If user then deletes the pin thinking it's linked... data provenance is lost

### What's Good
- The `applyEnrichment` handler (single enrichment) DOES link correctly
- Database schema has proper `linked_locid` and `linked_at` columns
- Index exists for filtering linked points

### What's Bad
- `importWithOptions` enrichment path missing link step
- No transaction wrapping enrichment + link operations
- Silent success when link fails (no error to UI)

### Fix Required
In `importWithOptions`, after successful enrichment:
1. Track which points were used for enrichment
2. After creating the ref_map record, link those points to their locations
3. OR: Filter enriched points from `pointsToImport` entirely (don't create unlinked duplicates)

---

## Issue 2: Old Pins Showing Next to New Pins

### Symptoms
- Toggle "Reference Pins" checkbox on Atlas
- Pan/zoom around the map
- Old pins from previous viewport remain visible
- Duplicate pins at same location (one location pin + one ref pin that should be hidden)

### Root Cause Analysis

**Location**:
- `packages/desktop/src/pages/Atlas.svelte` (state management)
- `packages/desktop/src/components/Map.svelte` (rendering logic)

#### Problem 1: Two Incompatible Data Sources

**On mount** (Atlas.svelte ~line 402):
```typescript
loadRefMapPoints() {
  refMapPoints = await window.electronAPI.refMaps.getAllPoints();
  // Returns ALL unlinked points globally (no bounds filter)
}
```

**On pan/zoom** (Atlas.svelte ~line 219-220):
```typescript
loadRefPointsInBounds(bounds) {
  // Uses getPointsInBounds() - returns viewport-filtered points
  // BUT: This doesn't update refMapPoints state!
}
```

#### Problem 2: Rendering Uses Stale State

**Map.svelte** (~lines 1374-1444):
```typescript
$effect(() => {
  const shouldShow = showRefMapLayer;
  const points = refMapPoints;  // Uses GLOBAL state, not viewport data

  if (shouldShow && points.length > 0) {
    layerRef.clearLayers();  // Only clears when shouldShow toggles

    points.forEach((point) => {
      const marker = L.marker([point.lat, point.lng], { icon: refIcon });
      layerRef.addLayer(marker);
    });
  }
});
```

**Result**:
- Initial load: 500 ref points loaded globally
- Pan to NYC: Viewport query returns 20 points, but `refMapPoints` still has 500
- Pan to Boston: Viewport query returns 15 points, but `refMapPoints` still has 500
- ALL 500 pins rendered on screen, not just viewport-relevant ones

#### Problem 3: Layer Not Cleared on Bounds Change

The `layerRef.clearLayers()` only executes when `showRefMapLayer` changes, NOT when bounds change.

### What's Good
- Viewport-based queries exist (`getPointsInBounds`)
- Index on `linked_locid` for filtering
- Database correctly filters `linked_locid IS NULL`

### What's Bad
- Two data sources (global vs viewport) not synchronized
- Effect dependency is on `refMapPoints` which never updates from viewport queries
- No layer clearing during pan/zoom
- Location pins re-render on bounds change, ref pins don't

### Fix Required
Choose ONE approach:

**Option A**: Update `refMapPoints` state from viewport queries
```typescript
async loadRefPointsInBounds(bounds) {
  refMapPoints = await window.electronAPI.refMaps.getPointsInBounds(bounds);
}
```

**Option B**: Use viewport data directly for rendering
```typescript
let viewportRefPoints = $state([]);  // Separate from global refMapPoints

// Update on bounds change
async loadRefPointsInBounds(bounds) {
  viewportRefPoints = await getPointsInBounds(bounds);
}

// Render from viewport data
$effect(() => {
  if (showRefMapLayer && viewportRefPoints.length > 0) {
    layerRef.clearLayers();
    viewportRefPoints.forEach(...)
  }
});
```

**Option C**: Remove `getAllPoints()` entirely
- Only use viewport-based loading
- Load initial viewport on mount, update on pan/zoom

---

## Issue 3: Reference Map Beachball Loading

### Symptoms
- Settings page or Atlas freezes during load
- Spinning beachball for several seconds
- Similar to issues fixed in OPT-044/045/046/047/048

### Root Cause Analysis

**Locations**:
- `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`
- `packages/desktop/electron/repositories/sqlite-ref-maps-repository.ts`

#### Problem 1: getAllPoints() Loads Everything

**ref-maps.ts** (~line 301):
```typescript
ipcMain.handle('refMaps:getAllPoints', async () => {
  const points = await repository.getAllPoints();  // Gets ALL rows
  const unlinkedPoints = points.filter(p => !p.linkedLocid);  // Filters in JS
  return unlinkedPoints.map(...);  // Maps each point
});
```

**Issues**:
- No pagination
- Filtering happens in JavaScript, not SQL
- If 10,000+ ref_map_points exist, this is slow

#### Problem 2: O(N×M) in Catalogued Count

OPT-048 deferred the catalogued count to on-demand, but the underlying operation is still O(N×M):
- N = number of ref_map_points
- M = number of locations
- Each point checked against all locations for name similarity

#### Problem 3: No Caching

Each `getAllPoints()` call hits the database fresh:
- No in-memory cache
- No ETag/staleness check
- Repeated calls = repeated full table scans

### What's Good
- OPT-048 deferred the heavy count operation
- Viewport queries use bounds-based filtering (OPT-037)
- Indexes exist on lat/lng for spatial queries

### What's Bad
- `getAllPoints()` has no limit/pagination
- JS-side filtering instead of SQL WHERE clause
- No caching layer
- No chunked/streamed loading

### Fix Required

**Immediate Fix**: Filter in SQL, not JS
```sql
SELECT * FROM ref_map_points
WHERE linked_locid IS NULL
LIMIT 1000
```

**Better Fix**: Remove `getAllPoints()` entirely
- Only use `getPointsInBounds()`
- Load initial viewport on mount
- Never load all points globally

**Best Fix**: Implement virtualized rendering
- Only render pins in current viewport
- Stream points as user pans
- Use Supercluster for ref points too

---

## Summary Table

| Issue | Severity | Root Cause | Fix Complexity |
|-------|----------|------------|----------------|
| #1 Linking broken | CRITICAL | Missing link step in importWithOptions | Medium |
| #2 Stale pins | HIGH | State not updated from viewport queries | Medium |
| #3 Beachball | HIGH | O(N) getAllPoints with no pagination | Medium |

---

## Implementation Plan

### Phase 1: Fix Critical Linking Bug (Issue #1)

**Files to modify**:
- `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

**Changes**:
1. In `importWithOptions`, track enriched point indices
2. After creating map record, link enriched points to their locations
3. Add transaction wrapper for atomicity
4. Return detailed enrichment results (which succeeded, which failed)

**Validation**:
- Import map with enrichments
- Verify `linked_locid` is set for enriched points
- Verify linked points don't appear in "catalogued matches"

### Phase 2: Fix Stale Pin Rendering (Issue #2)

**Files to modify**:
- `packages/desktop/src/pages/Atlas.svelte`
- `packages/desktop/src/components/Map.svelte`

**Changes**:
1. Remove `getAllPoints()` call on mount
2. Use only `getPointsInBounds()` for ref pin data
3. Update `refMapPoints` state from viewport queries
4. Clear and re-render ref layer on bounds change

**Validation**:
- Toggle ref pins, pan around
- Verify only viewport-relevant pins shown
- Verify pins update correctly during pan/zoom

### Phase 3: Fix Performance (Issue #3)

**Files to modify**:
- `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`
- `packages/desktop/electron/repositories/sqlite-ref-maps-repository.ts`

**Changes**:
1. Remove/deprecate `getAllPoints()` handler
2. Add LIMIT to any remaining queries
3. Filter `linked_locid IS NULL` in SQL, not JS
4. Add pagination to `getPointsInBounds()` if needed

**Validation**:
- Import 10,000+ ref points
- Toggle ref pins layer
- No beachball/freeze

---

## Decision Record

This audit recommends:

1. **Do** fix the linking bug immediately - it causes data loss
2. **Do** unify ref pin data sources to viewport-only
3. **Do** remove `getAllPoints()` in favor of viewport queries
4. **Don't** add complex caching - viewport queries are fast enough
5. **Don't** use Supercluster for ref pins yet - simple markers suffice for <10k points

---

## Appendix: Code References

### Linking Flow (Current - Broken)
- `packages/desktop/electron/main/ipc-handlers/ref-maps.ts:370-390`

### Rendering Flow (Current - Stale)
- `packages/desktop/src/pages/Atlas.svelte:402` (getAllPoints call)
- `packages/desktop/src/pages/Atlas.svelte:219-220` (viewport call - unused)
- `packages/desktop/src/components/Map.svelte:1374-1444` (render effect)

### Performance Bottleneck
- `packages/desktop/electron/main/ipc-handlers/ref-maps.ts:294-318` (getAllPoints handler)
- `packages/desktop/electron/repositories/sqlite-ref-maps-repository.ts:218-225` (repository method)
