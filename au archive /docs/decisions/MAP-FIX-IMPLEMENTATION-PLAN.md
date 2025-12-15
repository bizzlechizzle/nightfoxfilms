# MAP-FIX Implementation Plan

**Decision ID**: MAP-FIX-001
**Date**: 2025-12-02
**Status**: Implementation In Progress

## Overview

This document details the exact code changes required to fix three map-related issues identified in MAP-AUDIT-001.

---

## Phase 1: Fix Linking Bug in `importWithOptions`

### Problem Statement
When importing a reference map with enrichment selections, the `importWithOptions` handler applies GPS to locations but fails to mark the ref_map_points as linked. This causes:
- Duplicate pins appearing on map
- Lost provenance trail
- Confusion when "Find Catalogued Points" shows already-enriched points

### Solution Design
**Approach**: Filter enriched points from `pointsToImport` before creating the map record. Enriched points should NOT be imported as new ref_map_points because their data has already been transferred to the location.

### Exact Code Changes

**File**: `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

**Location**: Lines 525-640 (importWithOptions handler)

**Change 1**: Track enriched point indices during enrichment loop

```typescript
// Before the enrichment loop (around line 527)
let enrichedCount = 0;
const enrichedPointIndices = new Set<number>(); // NEW: Track which points were used for enrichment
```

**Change 2**: Record successfully enriched point indices

```typescript
// Inside the enrichment loop, after enrichResult.success check (around line 578-589)
if (enrichResult.success) {
  enrichedCount++;
  enrichedPointIndices.add(enrichment.pointIndex); // NEW: Mark this point as enriched
  console.log(`[RefMaps] Enriched location ${enrichment.existingLocId}...`);
}
```

**Change 3**: Filter enriched points from import

```typescript
// After enrichment loop, before "if (pointsToImport.length === 0)" check (around line 591)
// NEW: Filter out enriched points - they should NOT be imported as ref_map_points
// Their GPS data is now on the location, importing them would create duplicates
if (enrichedPointIndices.size > 0) {
  const beforeCount = pointsToImport.length;
  pointsToImport = pointsToImport.filter((_, index) => {
    // Find the original index in parseResult.points
    const originalIndex = parseResult.points.indexOf(pointsToImport[index]);
    // Actually, we need to track differently since pointsToImport may already be filtered
    return true; // Placeholder - see actual implementation
  });
  // Better approach: filter from parseResult.points indices
}
```

**Actual Implementation** (cleaner approach):

```typescript
// Replace the filtering logic with index-based filtering on parseResult.points
// pointsToImport starts as parseResult.points (or filtered by dedup)
// We need to filter out points whose ORIGINAL index is in enrichedPointIndices

// After dedup filtering (if options.skipDuplicates)
// pointsToImport = dedupResult.newPoints; // This is already filtered

// For enrichment tracking, we need to map from parseResult indices
// The enrichment.pointIndex refers to parseResult.points[enrichment.pointIndex]
// So we filter parseResult.points directly:

// NEW CODE BLOCK after enrichment loop:
if (enrichedPointIndices.size > 0) {
  // Filter out points that were used for enrichment
  // enrichedPointIndices contains indices into parseResult.points
  const enrichedCoords = new Set<string>();
  for (const idx of enrichedPointIndices) {
    const p = parseResult.points[idx];
    if (p) enrichedCoords.add(`${p.lat},${p.lng}`);
  }

  // Filter pointsToImport to exclude enriched coordinates
  const beforeCount = pointsToImport.length;
  pointsToImport = pointsToImport.filter(p => !enrichedCoords.has(`${p.lat},${p.lng}`));

  if (beforeCount !== pointsToImport.length) {
    console.log(`[RefMaps] Filtered ${beforeCount - pointsToImport.length} enriched points from import (already applied to locations)`);
  }
}
```

### Validation Criteria
1. Import map with 5 enrichment checkboxes selected
2. Verify 5 locations have GPS updated
3. Verify ref_map_points table does NOT contain points for those 5 coordinates
4. Verify "Find Catalogued Points" does NOT show those 5 as matches
5. Verify Atlas shows location pins (gold) without duplicate ref pins (blue)

---

## Phase 2: Remove Global Ref Point Load on Mount

### Problem Statement
On Atlas mount, `loadRefMapPoints()` fetches ALL unlinked ref points globally. This is wasteful and causes slow initial load for large datasets.

### Solution Design
**Approach**:
1. Remove `loadRefMapPoints()` call on mount
2. When ref layer checkbox is toggled ON, load from current bounds if available
3. Keep existing bounds-based loading in `handleBoundsChange`

### Exact Code Changes

**File**: `packages/desktop/src/pages/Atlas.svelte`

**Change 1**: Remove global load on mount (line 402)

```typescript
// BEFORE (line 390-411):
onMount(() => {
  atlasLoadStartTime = performance.now();
  // ...

  // Load ref map points (small dataset, OK to load all)  <-- REMOVE THIS COMMENT
  loadRefMapPoints();  // <-- REMOVE THIS LINE

  // ...
});

// AFTER:
onMount(() => {
  atlasLoadStartTime = performance.now();
  // ...

  // REF POINTS: Loaded on-demand when checkbox toggled, not on mount
  // This prevents loading 10k+ points before user even wants them

  // ...
});
```

**Change 2**: Add effect to load ref points when checkbox toggled

```typescript
// NEW: Add after line 437 (after the health check effect)

// Load reference points when checkbox is toggled ON
// Only loads if we have bounds and don't already have data
$effect(() => {
  if (showRefMapLayer && refMapPoints.length === 0 && currentBounds) {
    loadRefPointsInBounds(currentBounds);
  }
});
```

### Validation Criteria
1. App loads without beachball (no ref points loaded on mount)
2. Toggle "Reference Pins" checkbox ON
3. Verify ref points load for current viewport only
4. Pan/zoom → verify points update correctly
5. Toggle OFF then ON → verify points still load correctly

---

## Phase 3: Optimize `getAllPoints` with SQL Filter + LIMIT

### Problem Statement
`getAllPoints()` fetches ALL rows without LIMIT, then filters linked points in JavaScript. This is inefficient for large datasets.

### Solution Design
**Approach**:
1. Add `WHERE linked_locid IS NULL` to SQL query (filter at database level)
2. Add reasonable LIMIT (5000 points max)
3. Remove JS filtering in IPC handler (now done in SQL)

### Exact Code Changes

**File**: `packages/desktop/electron/repositories/sqlite-ref-maps-repository.ts`

**Change 1**: Update `getAllPoints` method (lines 218-225)

```typescript
// BEFORE:
async getAllPoints(): Promise<RefMapPoint[]> {
  const rows = await this.db
    .selectFrom('ref_map_points')
    .selectAll()
    .execute();

  return rows.map(rowToRefMapPoint);
}

// AFTER:
/**
 * Get all unlinked reference points (for Atlas layer)
 * OPT-049: Filters and limits at SQL level for performance
 * @param limit Maximum points to return (default 5000)
 */
async getAllPoints(limit: number = 5000): Promise<RefMapPoint[]> {
  const rows = await this.db
    .selectFrom('ref_map_points')
    .selectAll()
    .where('linked_locid', 'is', null)  // Filter linked points in SQL
    .limit(limit)
    .execute();

  return rows.map(rowToRefMapPoint);
}
```

**File**: `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

**Change 2**: Update IPC handler to remove JS filter (lines 294-318)

```typescript
// BEFORE:
ipcMain.handle('refMaps:getAllPoints', async () => {
  try {
    const points = await repository.getAllPoints();

    // OPT-046: Only filter out linked points (database query, fast)
    const unlinkedPoints = points.filter(p => !p.linkedLocid);

    return unlinkedPoints.map(p => ({
      // ...mapping
    }));
  } catch (error) {
    // ...
  }
});

// AFTER:
/**
 * Get all points from all maps (for Atlas layer)
 * OPT-046: Removed O(N×M) findCataloguedRefPoints call
 * OPT-049: Filtering now done in SQL, not JS
 */
ipcMain.handle('refMaps:getAllPoints', async () => {
  try {
    // OPT-049: Repository now handles linked filtering in SQL
    const points = await repository.getAllPoints();

    return points.map(p => ({
      pointId: p.pointId,
      mapId: p.mapId,
      name: p.name,
      description: p.description,
      lat: p.lat,
      lng: p.lng,
      state: p.state,
      category: p.category,
      rawMetadata: p.rawMetadata
    }));
  } catch (error) {
    console.error('Error getting all reference map points:', error);
    return [];
  }
});
```

### Validation Criteria
1. `getAllPoints()` returns only unlinked points
2. Query completes in <100ms for 10k+ point dataset
3. No JS filtering overhead
4. Results identical to before (minus linked points)

---

## Testing Plan

### Manual Testing Checklist

- [ ] **Phase 1 Test**: Import map with enrichments, verify no duplicate pins
- [ ] **Phase 1 Test**: "Find Catalogued Points" shows 0 for newly enriched locations
- [ ] **Phase 2 Test**: Atlas loads instantly (no ref point fetch on mount)
- [ ] **Phase 2 Test**: Toggle ref layer ON → points load for viewport
- [ ] **Phase 3 Test**: Large dataset (5000+ points) loads without freeze
- [ ] **Integration**: Full workflow - import → enrich → verify → map displays correctly

### Automated Tests (Future)

None required for this fix - manual validation sufficient.

---

## Rollback Plan

If issues are discovered:
1. Revert to previous commit
2. Re-deploy
3. Investigate root cause before re-attempting

---

## References

- MAP-AUDIT-001: Original audit document
- OPT-046: Previous optimization that removed O(N×M) calculation
- OPT-037: Viewport-based spatial queries implementation
