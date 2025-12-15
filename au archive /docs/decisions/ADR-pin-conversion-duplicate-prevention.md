# ADR: Pin-to-Location Conversion & Duplicate Prevention

**Status:** Approved
**Date:** 2025-11-30
**Scope:** Ensure every imported pin becomes a catalogued location; prevent duplicate archive entries

---

## Philosophy

**The map is an ingestion funnel, not a display layer.**

User journey:
1. Import pins (KML, GPX, ref maps, manual clicks)
2. Each pin must become a **real location** in the archive database
3. We do NOT want orphan pins sitting unconverted
4. We do NOT want the same physical site entered twice under different names

**Two safety nets:**
1. **Conversion pressure** — Every pin should become a location; don't let users dump pins and walk away
2. **Duplicate prevention** — On import/create, check if this location already exists (by GPS or name)

---

## Current State

| Component | What It Does | Gap |
|-----------|--------------|-----|
| `ref_map_points` table | Stores imported pins from KML/GPX | Pins sit here unconverted |
| `ref-map-dedup-service.ts` | 85% name + 500m check on KML import | Only runs at import time |
| `import-intelligence-service.ts` | 500m scan when importing media files | Doesn't check ref_map_points → locs |
| Visual clustering | Supercluster 60px grouping | Purely cosmetic, no logic |

**The gap:** No pressure to convert `ref_map_points` → `locs`. No check when creating a location: "Does this already exist?"

---

## User Requirements (Confirmed)

| Requirement | Details |
|-------------|---------|
| 150m = same site | GPS within 150m means same physical location |
| Match logic | GPS match OR name match (not type-based) |
| No blocking | Show match, let user decide |
| Map = locations only | Sub-locations not shown on map |
| GPS wins | Higher confidence GPS always takes priority |

---

## Two Safety Nets

### Safety Net 1: Duplicate Check on Location Create

**When:** User creates a new location (from pin conversion, map click, or manual entry)

**Check against:**
1. All existing `locs` (catalogued locations)
2. Compare by GPS (within 150m) OR by name (≥85% similarity)

**Name fields to check:**
- `locnam` (primary name)
- `akanam` (alias)
- `historicalName`

**Match found → Show panel:**
```
┌─────────────────────────────────────────────────┐
│ ⚠️  Possible duplicate found                    │
│                                                 │
│ You're creating: "Old River Mill"               │
│                                                 │
│ Existing match: "Riverside Mill" (127m away)   │
│   AKA: "Old River Mill"                        │
│   State: OH  |  Media: 24 files                │
│                                                 │
│ [ This is the same place ]  [ Different place ] │
└─────────────────────────────────────────────────┘
```

**"Same place"** → Abort creation, open existing location (optionally add new name as AKA)
**"Different place"** → Proceed with new location

### Safety Net 2: Pin Conversion Pressure

**Problem:** Users import KML with 500 pins, then never convert them to real locations.

**Solution:** Visual + workflow pressure to convert.

**Visual indicators:**
- Unconverted pins = different icon (hollow/dashed outline)
- Converted locations = solid pins
- Dashboard stat: "47 pins awaiting conversion"

**Conversion flow:**
When user clicks unconverted pin:
1. Run duplicate check against existing `locs`
2. If match found → "This might already be in your archive: [Name]"
3. If no match → "Convert to location?" → Opens location create form pre-filled with pin data

**Bulk conversion:**
- Select multiple pins → "Convert all to locations"
- Each runs duplicate check
- Duplicates flagged for review, non-duplicates auto-converted

---

## Duplicate Check Logic

```
On location create, check existing locs:

1. GPS CHECK: Any location within 150m?
   → Yes: MATCH (same physical site)

2. NAME CHECK: Jaro-Winkler similarity ≥50%?
   → Check against: locnam, akanam, historicalName
   → Yes: POSSIBLE MATCH (prompt user to decide)

3. EXCLUSION CHECK: Has user previously marked this pair as "different"?
   → Yes: Skip prompt, allow creation

4. If MATCH/POSSIBLE MATCH found:
   → Show inline duplicate panel
   → User decides: "Same place" or "Different place"
   → If "Different": remember decision (don't ask again)

5. If NO MATCH:
   → Proceed with creation
```

**Name normalization before comparison:**
- Lowercase
- Strip articles: "The", "A", "An"
- Expand abbreviations: "St." → "Saint", "Mt." → "Mount"

**"Different" memory storage:**
- Store in `location_exclusions` table or similar
- Columns: `name_a`, `name_b`, `decided_at`
- Check before prompting

---

## Map Display Logic

**Two types of markers:**

| Type | Icon | Meaning |
|------|------|---------|
| **Unconverted pin** | Hollow/dashed circle | From ref_map_points, not yet a location |
| **Catalogued location** | Solid pin | Real entry in locs table |

**No combined pins for locations.** If two locations exist within 150m, they render as two separate solid pins. The duplicate check happens at creation time—once something is a location, it's trusted.

**Unconverted pins** are the visual pressure: "You have work to do."

---

## Implementation Plan

### Phase 1: Duplicate Check Service

**New file:** `electron/services/location-duplicate-service.ts`

```typescript
interface DuplicateCheckResult {
  hasDuplicate: boolean;
  match?: {
    locationId: string;
    locnam: string;
    akanam?: string;
    matchType: 'gps' | 'name';
    distanceMeters?: number;
    nameSimilarity?: number;
  };
}

function checkForDuplicate(
  name: string,
  lat?: number,
  lng?: number
): DuplicateCheckResult
```

**Logic:**
1. If GPS provided, query locs within 150m (use existing geo-utils bounding box + haversine)
2. Query all locs, compare name against locnam/akanam/historicalName with Jaro-Winkler
3. Return first match found (GPS takes priority)

### Phase 2: Hook into Location Create Flow

**Modified:** Location create IPC handler / form submission

1. Before inserting new location, call `checkForDuplicate()`
2. If duplicate found, return match info to renderer
3. Renderer shows duplicate panel
4. User confirms → either abort or proceed

### Phase 3: Pin Visual Differentiation

**Modified:** `Map.svelte`

1. When loading points for Supercluster, tag each with `source: 'location' | 'refmap'`
2. Render different icons based on source
3. Unconverted pins get hollow/dashed style

### Phase 4: Conversion Flow Enhancement

**Modified:** Pin click handler in Map.svelte

1. If clicking unconverted pin (ref_map_point):
   - Run duplicate check against name + GPS
   - If match: "This might be [Existing Location]. Link to it?"
   - If no match: "Convert to location?" → pre-fill form
2. On successful conversion:
   - Delete the ref_map_point record (original KML/GPX file preserved in ref_maps table)

### Phase 5: Dashboard Conversion Stat

**Modified:** Dashboard page

- Add stat card: "X pins awaiting conversion"
- Links to filtered map view showing only unconverted pins

---

## Files Changed

**New:**
- `electron/services/location-duplicate-service.ts`
- `migrations/XXXX_location_exclusions.ts` — table for "different" decisions

**Modified:**
- `electron/main/ipc-handlers/location.ts` — add duplicate check before create
- `electron/services/jaro-winkler-service.ts` — add name normalization (articles, abbreviations)
- `src/components/Map.svelte` — differentiate pin icons by source
- `src/components/location/LocationCreateForm.svelte` (or equivalent) — show inline duplicate panel
- `src/pages/Dashboard.svelte` — add unconverted pin count
- `src/lib/constants.ts` — `DUPLICATE_GPS_RADIUS: 150`, `DUPLICATE_NAME_THRESHOLD: 0.50`
- `electron/repositories/` — add ref_map_point deletion after conversion

---

## What I'd Consider Adding (Future)

1. **"Link pin to existing location"** — Instead of converting pin to new location, just associate it with existing location as alternate GPS point or reference source.

2. **Bulk duplicate scan** — Settings/Tools page: "Scan archive for potential duplicates" → shows all location pairs within 150m or with similar names.

3. **Merge workflow** — If user discovers two locations are actually the same after the fact, provide a merge tool. GPS with higher confidence wins, names consolidate.

4. **Import-time duplicate check** — When importing KML/GPX, run duplicate check against locs (not just ref_map_points). Current `ref-map-dedup-service` only checks pin-vs-pin.

---

## Decisions (Confirmed)

| Question | Decision |
|----------|----------|
| Duplicate panel UX | **Inline** — expand within form, not modal |
| Remember "different" decisions | **Yes** — don't re-prompt for same pair |
| Name similarity threshold | **Prompt user if ≥50%** — let them decide edge cases |
| After pin conversion | **Delete ref_map_point** — original KML/GPX files are preserved |

---

## Summary

| Event | Check | Action |
|-------|-------|--------|
| Create location (any source) | GPS ≤150m OR name ≥85% | Show duplicate panel |
| Click unconverted pin | Same checks | "Link to existing?" or "Convert?" |
| Import KML/GPX | Existing check (pin-vs-pin) | Flag duplicates at import |
| View map | None | Show hollow pins for unconverted, solid for locations |
| View dashboard | None | Show "X pins awaiting conversion" |

**Guiding principle:** Every pin should become a location. Catch duplicates before they enter the archive, not after.
