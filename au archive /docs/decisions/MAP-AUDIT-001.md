# MAP-AUDIT-001: Comprehensive Map Logic Audit

**Date**: 2025-12-02
**Status**: Planning - Awaiting User Approval
**Priority**: CRITICAL

---

## Executive Summary

Three critical issues identified in the map/reference pin system. **Issue 2 is a SYMPTOM of Issue 1.**

| Issue | Severity | Root Cause | Data Loss Risk |
|-------|----------|------------|----------------|
| #1 Linking Broken in `importWithOptions` | **CRITICAL** | Missing link step after enrichment | YES - provenance lost |
| #2 Old Pins Next to New Pins | HIGH | Symptom of #1 + stale global data | Confusing UX |
| #3 Reference Map Beachball | HIGH | `getAllPoints()` loads ALL on mount | Frozen UI |

---

## VERIFIED Issue 1: Linking Says Success But Doesn't Actually Link

### User Report
> "I linked a location from reference pins to a location, it said it linked but didn't, and deleted the old pin and now we're up shits creek"

### Root Cause Analysis

**BUG LOCATION**: `packages/desktop/electron/main/ipc-handlers/ref-maps.ts:556-590`

```typescript
// Migration 42: Apply enrichments to existing locations
if (options.enrichments && options.enrichments.length > 0) {
  for (const enrichment of options.enrichments) {
    const point = parseResult.points[enrichment.pointIndex];

    // This ONLY updates the LOCATION table (GPS, address, regions)
    const enrichResult = await enrichmentService.enrichFromGPS(enrichment.existingLocId, {
      lat: point.lat,
      lng: point.lng,
      source: 'ref_map_import',
      stateHint: point.state,
    });

    if (enrichResult.success) {
      enrichedCount++;
      // BUG: NO LINKING HERE!
      // The ref_map_point is NOT marked as linked
      // linked_locid remains NULL
    }
  }
}

// Later, the point is imported with linked_locid = NULL
const refMap = await repository.create({
  mapName, filePath, fileType, importedBy,
  points: pointsToImport  // <-- enriched points still in here, unlinked
});
```

### Impact Chain

1. User imports ref map with enrichment selections
2. GPS is applied to locations correctly ✓
3. Ref points are created in database with `linked_locid = NULL` ✗
4. UI shows "X locations enriched" (success message)
5. Later: "Find Catalogued Points" shows these same points as matches again
6. User thinks: "I already did this, why are they showing?"
7. User might delete the ref point thinking it's a duplicate
8. **Provenance is lost** - no record of which ref point enriched which location

### Contrast with Working Handlers

These handlers DO link correctly:

| Handler | Links Correctly? | Code Location |
|---------|-----------------|---------------|
| `refMaps:applyEnrichment` (single) | ✅ YES | ref-maps.ts:852-859 |
| `refMaps:applyAllEnrichments` (batch) | ✅ YES | ref-maps.ts:933-941 |
| `refMaps:linkToLocation` (manual) | ✅ YES | ref-maps.ts:1017-1025 |
| `refMaps:importWithOptions` | ❌ **NO** | ref-maps.ts:556-590 |

### What's Good
- Single enrichment path (`applyEnrichment`) works correctly
- Batch enrichment path (`applyAllEnrichments`) works correctly
- Manual linking (`linkToLocation`) works correctly
- Database schema has proper columns (`linked_locid`, `linked_at`)
- Index exists for filtering linked points

### What's Bad
- `importWithOptions` enrichment path MISSING the link step
- Points are imported unlinked, causing:
  - Duplicate ref points appearing on map
  - Points showing as "catalogued matches" repeatedly
  - Lost provenance trail

### Fix Required

In `importWithOptions` (ref-maps.ts), after successful enrichment, either:

**Option A**: Don't import enriched points at all (filter from `pointsToImport`)
```typescript
// Track enriched point indices
const enrichedIndices = new Set<number>();

for (const enrichment of options.enrichments) {
  // ... existing enrichment code ...
  if (enrichResult.success) {
    enrichedCount++;
    enrichedIndices.add(enrichment.pointIndex);  // Track it
  }
}

// Filter out enriched points from import
pointsToImport = parseResult.points.filter((_, i) => !enrichedIndices.has(i));
```

**Option B**: Import but link them immediately after map creation
```typescript
// After repository.create(), link enriched points
for (const enrichment of successfulEnrichments) {
  const insertedPoint = await findPointByCoords(refMap.mapId, point.lat, point.lng);
  if (insertedPoint) {
    await db.updateTable('ref_map_points')
      .set({ linked_locid: enrichment.existingLocId, linked_at: new Date().toISOString() })
      .where('point_id', '=', insertedPoint.pointId)
      .execute();
  }
}
```

**Recommended**: Option A is cleaner - don't import points that were used for enrichment.

---

## VERIFIED Issue 2: Old Pins Showing Next to New Pins

### User Report
> "Check current map vs reference map there are still the old pins right next to the new pins"

### Root Cause Analysis

**This is primarily a SYMPTOM of Issue 1**, but has its own contributing factors:

1. **Issue 1 Symptom**: Linked ref points aren't actually linked, so they still appear
2. **Stale Global Load**: On mount, ALL ref points are loaded globally

**Code Flow**:

```
Mount (Atlas.svelte:402):
  loadRefMapPoints()
    → getAllPoints()
    → Returns ALL unlinked points globally
    → refMapPoints = all_points

User toggles "Reference Pins" ON:
  → Effect triggers (Map.svelte:1374)
  → Renders from refMapPoints (GLOBAL set)

User pans/zooms:
  → loadRefPointsInBounds(bounds)
  → refMapPoints = viewport_points (FILTERED)
  → Effect re-renders (viewport set)
```

**Key Issue**: The initial `loadRefMapPoints()` call on mount loads ALL points without bounds filtering. This works for small datasets but:
- Causes beachball on large datasets
- Shows points outside viewport until first pan

**BUT**: The filtering works correctly for `linked_locid IS NULL`:
- IPC handler filters in JS: `points.filter(p => !p.linkedLocid)`
- `getPointsInBounds()` filters in SQL: `.where('linked_locid', 'is', null)`

So if linking worked correctly (Issue 1 fixed), linked points WOULD be hidden.

### What's Good
- Viewport-based loading exists (`getPointsInBounds`)
- SQL filtering for linked points exists
- State updates correctly after pan/zoom

### What's Bad
- On mount, loads ALL points globally (slow + wasteful)
- Effect dependencies are correct but initial data is stale
- If Issue 1 isn't fixed, linked points appear as duplicates

### Fix Required

1. **Fix Issue 1 first** - this will hide most "duplicate" pins
2. **Then optimize**: Remove global `loadRefMapPoints()` call on mount
3. **On checkbox toggle**: Trigger viewport load if not already loaded

```typescript
// Atlas.svelte - don't load all points on mount
onMount(() => {
  // REMOVE: loadRefMapPoints();  // Don't load all globally
  // Viewport-based loading happens in handleBoundsChange
});

// When checkbox toggled ON, ensure we have data
$effect(() => {
  if (showRefMapLayer && refMapPoints.length === 0 && currentBounds) {
    loadRefPointsInBounds(currentBounds);
  }
});
```

---

## VERIFIED Issue 3: Reference Map Beachball Loading

### User Report
> "Reference map has the same beachball load issue that we are having on other parts of the app"

### Root Cause Analysis

**Location**: `Atlas.svelte:402` + `ref-maps.ts:294-318`

On mount, Atlas calls `loadRefMapPoints()` which:
1. Calls `getAllPoints()` IPC handler
2. Handler fetches ALL rows from `ref_map_points` (no LIMIT)
3. Filters in JavaScript (not SQL): `points.filter(p => !p.linkedLocid)`
4. Maps each point to response format
5. Returns potentially 10,000+ points

**Repository Method** (`sqlite-ref-maps-repository.ts:218-225`):
```typescript
async getAllPoints(): Promise<RefMapPoint[]> {
  const rows = await this.db
    .selectFrom('ref_map_points')
    .selectAll()  // No WHERE, no LIMIT
    .execute();
  return rows.map(rowToRefMapPoint);
}
```

**Contrast with `getPointsInBounds`** (lines 373-404):
```typescript
async getPointsInBounds(bounds, limit = 1000): Promise<RefMapPoint[]> {
  let query = this.db
    .selectFrom('ref_map_points')
    .selectAll()
    .where('lat', '<=', bounds.north)
    .where('lat', '>=', bounds.south)
    .where('linked_locid', 'is', null)  // SQL filter!
    .limit(limit);  // Has limit!
  // ...
}
```

### What's Good
- `getPointsInBounds` already has SQL filtering and LIMIT
- OPT-037 implemented viewport-based loading for locations
- OPT-046 removed O(N×M) catalogued calculation from Atlas

### What's Bad
- `getAllPoints()` has no LIMIT
- Filtering happens in JS, not SQL
- Called on mount before user even wants ref layer

### Fix Required

**Immediate**: Add LIMIT and SQL filter to `getAllPoints()`
```typescript
async getAllPoints(limit: number = 5000): Promise<RefMapPoint[]> {
  const rows = await this.db
    .selectFrom('ref_map_points')
    .selectAll()
    .where('linked_locid', 'is', null)  // Filter in SQL
    .limit(limit)
    .execute();
  return rows.map(rowToRefMapPoint);
}
```

**Better**: Remove `getAllPoints()` usage entirely
- Only use `getPointsInBounds()` for Atlas
- Don't load ref points on mount
- Load on demand when checkbox toggled + bounds available

---

## Implementation Plan

### Phase 1: Fix Critical Linking Bug (Issue #1) - MUST DO FIRST

**Files to modify**:
- `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

**Changes**:
1. In `importWithOptions`, track enriched point indices
2. Filter enriched points from `pointsToImport` before import
3. Log enrichment success with point coords for debugging

**Validation**:
- Import map with enrichment checkboxes selected
- Verify enriched points are NOT imported as ref_map_points
- Verify location has GPS from enrichment
- Verify "Find Catalogued Points" doesn't show enriched locations

### Phase 2: Remove Global Ref Point Load (Issue #3)

**Files to modify**:
- `packages/desktop/src/pages/Atlas.svelte`

**Changes**:
1. Remove `loadRefMapPoints()` call on mount (line 402)
2. When checkbox toggled ON, load from current bounds if available
3. Keep the existing bounds-based loading in `handleBoundsChange`

**Validation**:
- App loads without beachball
- Toggle ref pins checkbox → loads points in current viewport
- Pan/zoom → updates points correctly

### Phase 3: Optimize getAllPoints (Optional, for Safety)

**Files to modify**:
- `packages/desktop/electron/repositories/sqlite-ref-maps-repository.ts`
- `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

**Changes**:
1. Add `linked_locid IS NULL` filter in SQL (not JS)
2. Add reasonable LIMIT (5000)
3. Remove JS filter in handler (now done in SQL)

**Validation**:
- getAllPoints returns only unlinked points
- Performance improved for large datasets

---

## Decision Summary

| Recommendation | Rationale |
|----------------|-----------|
| **Fix #1 immediately** | Data integrity issue, causes user confusion |
| **Fix #2 after #1** | Most symptoms will resolve once linking works |
| **Fix #3 for performance** | Prevents beachball, improves UX |
| **Don't add complex caching** | Viewport queries are fast enough |
| **Don't use Supercluster for ref pins** | Simple markers work fine for <10k points |

---

## Code References

### Issue 1 - Missing Link Step
- `packages/desktop/electron/main/ipc-handlers/ref-maps.ts:556-590` (bug location)
- `packages/desktop/electron/main/ipc-handlers/ref-maps.ts:852-859` (working single enrichment)
- `packages/desktop/electron/main/ipc-handlers/ref-maps.ts:933-941` (working batch enrichment)

### Issue 2 - Stale Rendering
- `packages/desktop/src/pages/Atlas.svelte:47` (refMapPoints state)
- `packages/desktop/src/pages/Atlas.svelte:402` (loadRefMapPoints on mount)
- `packages/desktop/src/components/Map.svelte:1374-1444` (ref pin rendering effect)

### Issue 3 - Performance
- `packages/desktop/electron/repositories/sqlite-ref-maps-repository.ts:218-225` (getAllPoints - no limit)
- `packages/desktop/electron/repositories/sqlite-ref-maps-repository.ts:373-404` (getPointsInBounds - has limit)
- `packages/desktop/electron/main/ipc-handlers/ref-maps.ts:294-318` (getAllPoints handler - JS filter)

---

## Appendix: Why "Link" Button Works But Import Doesn't

The user clicked "Link" on a ref point popup, saw "success", but the pin kept appearing.

**Possible Causes**:

1. **Race condition**: `loadRefMapPoints()` was called before the link was committed
2. **Wrong handler called**: If using import workflow instead of manual link
3. **Silent SQL failure**: `UPDATE ... WHERE point_id = ?` returns success even if 0 rows affected

The `linkToLocation` handler at `ref-maps.ts:984-1037` DOES work correctly. If the user is experiencing issues, they may have been using the import-with-enrichment flow (which is broken per Issue 1) rather than the manual link flow.

---

**Status**: Ready for user approval before implementation.
