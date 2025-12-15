# OPT-048: Defer Reference Maps Catalogued Count to On-Demand

## Problem

Settings page still froze (beachball) despite OPT-047 fix because `loadRefMaps()` called `findCataloguedPoints()` on every page load.

**Root cause**: `ref-map-dedup-service.ts:511-646` runs O(N×M) algorithm:
- Loops through all ref_map_points × all locations
- Each iteration: Haversine distance calculation + Jaro-Winkler string similarity
- 500 points × 1000 locations = 500,000+ iterations blocking main thread

## Solution

Move catalogued count calculation from page load to user-initiated action.

### Changes

**File**: `packages/desktop/src/pages/Settings.svelte`

1. Changed `cataloguedCount` from `$state(0)` to `$state<number | null>(null)`
2. Added `loadingCatalogued` state for loading indicator
3. Removed `findCataloguedPoints()` call from `loadRefMaps()`
4. Added new `loadCataloguedCount()` function for on-demand calculation
5. Updated UI: Show "Check Duplicates" button when count is null

### User Experience

- Settings page loads instantly (no beachball)
- User sees "Check Duplicates" button in Reference Maps section
- Clicking button calculates duplicates (shows "Checking..." during calculation)
- Once calculated, shows "Purge X Catalogued" button as before

## Commit

```
955931b perf(settings): fix beachball by deferring O(N×M) catalogued count to on-demand (OPT-048)
```

## Pattern Recognition

This is the third O(N×M) blocking operation found in the codebase:

| Fix | Location | Operation |
|-----|----------|-----------|
| OPT-043/044/045/046 | Atlas map loading | Location × RefPoint matching |
| OPT-047 | storage:getStats | Filesystem traversal (O(N)) |
| OPT-048 | Settings refMaps | RefPoint × Location matching |

**Watch for**: Any code that loads "all X" and "all Y" then loops through both.
