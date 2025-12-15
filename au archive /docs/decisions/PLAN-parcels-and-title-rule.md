# DECISION: Parcels Layer Removal + Title Two-Word Rule

**Status:** Implemented
**Date:** 2025-11-29

## Issue 1: Parcels Layer Grayed Out

### Root Cause Analysis
The Regrid parcel boundaries layer at `Map.svelte:430-445` uses the URL:
```
https://tiles.regrid.com/api/v1/parcels/{z}/{x}/{y}.mvt
```

This URL **requires an API key** to function. Without authentication, the layer loads but tiles return 401/403 errors, causing the layer to appear grayed out or empty.

### Options

**Option A: Remove Parcels Layer**
- Remove the Parcels overlay entirely since it requires paid API access
- Simplest solution, no external dependencies
- Users lose parcel boundary visualization

**Option B: Add API Key Support**
- Add `regrid_api_key` to Settings
- Append `?token={apiKey}` to the tile URL
- Only show Parcels layer when API key is configured
- Requires user to obtain their own Regrid API key (free tier available)

**Option C: Alternative Free Parcel Source**
- Research alternative free parcel boundary services
- May have coverage limitations or different data quality

### Resolution
**Option A** - Removed the Parcels layer entirely. Regrid requires a paid API subscription with no free tier available. The feature was non-functional without authentication.

---

## Issue 2: Title Two-Word Rule

### Current Behavior
In `LocationDetail.svelte:199-236`, the `fitTitleToTwoLines()` function auto-sizes titles to fit within 2 lines using a binary search algorithm. This works for any title length but doesn't enforce a "2 words = 1 line" rule.

### Requested Behavior
**If a title has only 2 words, it should ALWAYS be displayed on 1 line** (never wrapped to 2 lines).

### Where This Applies
- `LocationDetail.svelte` - Hero title display (`heroDisplayName`)
- This affects Location names, Sub-Location names, and Host-Location names

### Implementation Approach
Add a word count check before the fit algorithm:
1. If `heroDisplayName.split(/\s+/).length <= 2`:
   - Force `white-space: nowrap` to prevent wrapping
   - Continue with size reduction until it fits horizontally
2. If more than 2 words:
   - Use existing 2-line max logic (allow wrapping)

### Resolution
Modified `fitTitleToTwoLines()` → `fitTitle()` in `LocationDetail.svelte`:
- Counts words in `heroDisplayName`
- If ≤2 words: applies `white-space: nowrap`, fits horizontally only (1 line)
- If 3+ words: allows wrapping, max 2 lines
- Binary search finds optimal font size for either constraint

---

## Files Changed

1. `packages/desktop/src/components/Map.svelte`
   - Removed vectorgrid import
   - Removed `parcelsLayer` creation
   - Removed Parcels from overlay layers

2. `packages/desktop/src/lib/constants.ts`
   - Removed `TILE_LAYERS.PARCELS` constant

3. `packages/desktop/src/pages/LocationDetail.svelte`
   - Renamed `fitTitleToTwoLines()` → `fitTitle()`
   - Added word count detection
   - 2-word titles forced to single line with `white-space: nowrap`
   - 3+ word titles allow up to 2 lines (existing behavior)
