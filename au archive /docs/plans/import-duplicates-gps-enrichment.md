# Import Duplicates GPS Enrichment Fix

## Problem Statement

When importing a reference map with a point like "Canal Cars":
- "Canal Cars" exists in the `locs` table WITHOUT GPS coordinates
- The ref map point "Canal Cars" HAS GPS coordinates (100% name match)
- **Expected**: Show in "Matches Found" so user can approve GPS enrichment
- **Actual**: Shown as "Already Catalogued" duplicate and skipped

## Root Cause Analysis

Looking at `ref-map-dedup-service.ts`, the logic flow is:

```
For each ref point, for each catalogued location:
├── IF location HAS GPS:
│   ├── GPS proximity match → existingHasGps: TRUE (duplicate)
│   └── Name+GPS match → existingHasGps: TRUE (duplicate)
├── ELSE IF location has NO GPS but HAS STATE:
│   └── Name+State match → existingHasGps: FALSE (enrichment) ✓
└── ELSE IF location has NO GPS AND NO STATE:
    └── Exact name (99%+) → existingHasGps: FALSE (enrichment) ✓
```

**The bug**: The `else if` chain means:
- If `locHasGps` is FALSE but `locStateNorm && pointStateNorm` is also FALSE (either side missing state)
- We only enter the `exact_name` branch if name is 99%+ match
- **72-98% matches fall through and are NOT added as enrichment opportunities!**

Also: There's likely a bug where `referenceMatches` (from ref_map_points table) are being treated as pure duplicates, not enrichment opportunities.

## Specific Bug Location

In `checkForDuplicates()` at line 752-806:
- `name_state` match requires BOTH states to be present
- `exact_name` match requires 99%+ similarity
- **70-98% name matches without state data are LOST - not categorized at all**

## Fix Required

### Option 1: Add fallback enrichment branch (Recommended)

After the `exact_name` check, add a fallback for high-similarity name matches (72%+) when location has no GPS:

```typescript
} else if (point.name) {
  // LOCATION HAS NO GPS AND NO STATE - exact name match only
  const normalizedPointName = normalizeName(point.name);
  const namesToCheck = [loc.locnam, loc.akanam].filter(Boolean) as string[];

  for (const locName of namesToCheck) {
    const nameSim = jaroWinklerSimilarity(normalizedPointName, normalizeName(locName));

    // Changed: Accept 72%+ matches for enrichment (not just 99%+)
    if (nameSim >= NAME_SIMILARITY_THRESHOLD) {
      result.cataloguedMatches.push({
        type: 'catalogued',
        matchType: 'name_only', // New match type
        newPoint: { name: point.name, lat: point.lat, lng: point.lng, state: point.state },
        existingId: loc.locid,
        existingName: loc.locnam,
        existingHasGps: false, // Enrichment opportunity
        nameSimilarity: Math.round(nameSim * 100),
        needsConfirmation: true,
      });
      isDuplicate = true;
      break;
    }
  }
}
```

### Option 2: Fix the state check condition

Change line 752 from:
```typescript
} else if (locStateNorm && pointStateNorm) {
```

To:
```typescript
} else if (!locHasGps) {  // Any location without GPS is enrichment candidate
```

Then merge the state and name-only branches.

## Implementation Checklist

1. [ ] Modify `ref-map-dedup-service.ts` - change `exact_name` threshold from 99% to 72%
2. [ ] Update match type to `name_only` for clarity
3. [ ] Ensure `existingHasGps: false` is set correctly
4. [ ] Test with "Canal Cars" scenario
5. [ ] Build and verify

## Files to Modify

- `packages/desktop/electron/services/ref-map-dedup-service.ts` (~line 791)
  - Change: `if (nameSim >= 0.99)` → `if (nameSim >= NAME_SIMILARITY_THRESHOLD)`
  - Change: `matchType: 'exact_name'` → `matchType: 'name_only'`

## Expected Behavior After Fix

1. User imports reference map with "Canal Cars" (has GPS)
2. "Canal Cars" exists in `locs` without GPS, with 100% name match
3. **Shows in "Matches Found"** with 100% similarity pill
4. User checks it and clicks Import
5. GPS coordinates are applied to the existing "Canal Cars" location

---

## Bug #2: GPS Not Applied After Approval (CRITICAL)

### Problem Statement

After implementing the above fix, matches correctly appeared in "Matches Found" and users could approve them. However, **GPS coordinates were NOT being applied** to the locations after import.

### Root Cause Analysis

Traced the data flow:

1. **Settings.svelte** `confirmImport()` builds enrichments array:
   ```typescript
   const enrichments = Array.from(selectedEnrichments.entries()).map(([existingLocId, pointIndex]) => ({
     existingLocId,
     pointIndex,
   }));
   ```

2. **Settings.svelte** auto-select code (line 975) stored WRONG value:
   ```typescript
   // BUG: Stored boolean `true` instead of number `pointIndex`
   selectedEnrichments.set(opp.existingId, true);  // WRONG!
   ```

3. **ref-maps.ts** IPC handler tried to access point by index:
   ```typescript
   const point = parseResult.points[enrichment.pointIndex];  // points[true] = undefined!
   if (!point) continue;  // Always skipped!
   ```

### Bug Location

**File**: `packages/desktop/src/pages/Settings.svelte`
**Line**: 975 (in `previewRefMap()` function)

```typescript
// BUG: This stored `true` (boolean) instead of the actual point index
selectedEnrichments.set(opp.existingId, true);
```

The `selectedEnrichments` Map is typed as `Map<string, number>` where:
- Key = `existingLocId` (location to enrich)
- Value = `pointIndex` (index into parseResult.points array for GPS coordinates)

Storing `true` instead of `pointIndex` caused JavaScript to evaluate `points[true]` which returns `undefined`.

### Fix Applied

**Settings.svelte** (line 975):
```typescript
// BEFORE (broken):
selectedEnrichments.set(opp.existingId, true);

// AFTER (fixed):
if (opp.pointIndex !== undefined) {
  selectedEnrichments.set(opp.existingId, opp.pointIndex);
}
```

**ref-maps.ts** (defensive validation added):
```typescript
// Added type check before using pointIndex
if (typeof enrichment.pointIndex !== 'number') {
  console.warn(`[RefMaps] Skipping enrichment: invalid pointIndex (${typeof enrichment.pointIndex})`);
  continue;
}
```

### Implementation Checklist (Bug #2)

1. [x] Fix auto-select to store `pointIndex` not `true`
2. [x] Add `pointIndex !== undefined` guard
3. [x] Add defensive type check in IPC handler
4. [x] Add console logging for debugging
5. [ ] Test with "Canal Cars" scenario

---

## Complete Data Flow Diagram

```
User selects KMZ file
        │
        ▼
┌─────────────────────────────────────┐
│  previewRefMap() in Settings.svelte │
│  1. Parses KMZ → points array       │
│  2. Calls checkForDuplicates()      │
│  3. Builds enrichmentOpportunities  │
│  4. Sets pointIndex for each match  │
│  5. Auto-selects 90%+ matches       │
│     └── MUST store pointIndex!      │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  User clicks "Import" button        │
│  confirmImport() builds enrichments │
│  array from selectedEnrichments Map │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  IPC: refMaps:importWithOptions     │
│  1. Re-parses KMZ file              │
│  2. Gets point by pointIndex        │
│  3. Updates locs table with GPS     │
│     - gps_lat, gps_lng              │
│     - gps_source = 'ref_map_import' │
└─────────────────────────────────────┘
        │
        ▼
    Location now has GPS coordinates!
```

---

## Implementation Guide for New Developers

This section provides an in-depth explanation of the GPS enrichment feature for developers new to the codebase.

### What is GPS Enrichment?

GPS enrichment is when we have an existing location in our database **without** GPS coordinates, and we find a reference map point (from a KMZ/GeoJSON file) that matches by name and **has** GPS coordinates. We "enrich" the existing location by copying the GPS data from the reference map.

### Architecture Overview

The feature spans three layers:

| Layer | File | Purpose |
|-------|------|---------|
| Renderer (UI) | `Settings.svelte` | Modal UI, user interactions, enrichment selection |
| IPC Bridge | `preload/preload.cjs` | Exposes `refMaps` API to renderer |
| Main Process | `ref-maps.ts` | Handles file parsing, dedup, database updates |
| Service | `ref-map-dedup-service.ts` | Detects duplicates vs enrichment opportunities |

### Key Data Structures

#### 1. `selectedEnrichments` Map (Renderer)

```typescript
// Map<locationId, pointIndex>
// Key: ID of existing location to enrich
// Value: Index into parsed points array (where GPS coords live)
let selectedEnrichments = $state(new Map<string, number>());
```

**Critical**: The value must be a `number` (the array index), NOT a boolean.

#### 2. `enrichmentOpportunities` Array (IPC Response)

```typescript
interface DuplicateMatchPreview {
  existingId: string;         // Location to enrich
  existingName: string;       // For display
  existingHasGps: boolean;    // FALSE for enrichment opportunities
  newPointName: string;       // From reference map
  newPointLat: number;        // GPS latitude
  newPointLng: number;        // GPS longitude
  nameSimilarity: number;     // 0-100 match score
  pointIndex: number;         // CRITICAL: Index into points array
}
```

#### 3. `enrichments` Array (Sent to Main Process)

```typescript
interface Enrichment {
  existingLocId: string;  // Which location to update
  pointIndex: number;     // Index to find GPS coords in parsed points
}
```

### The Bug We Fixed

#### Original Code (Broken)
```typescript
// Settings.svelte line 975
for (const opp of preview.enrichmentOpportunities || []) {
  if (opp.nameSimilarity >= 90) {
    selectedEnrichments.set(opp.existingId, true);  // WRONG!
  }
}
```

This stored `true` (a boolean) as the value. When `confirmImport()` ran:

```typescript
const enrichments = Array.from(selectedEnrichments.entries()).map(([existingLocId, pointIndex]) => ({
  existingLocId,
  pointIndex,  // This was `true`, not a number!
}));
```

And in the IPC handler:
```typescript
const point = parseResult.points[enrichment.pointIndex];
// parseResult.points[true] returns undefined!
if (!point) continue;  // Always skipped!
```

#### Fixed Code
```typescript
// Settings.svelte line 975
for (const opp of preview.enrichmentOpportunities || []) {
  if (opp.nameSimilarity >= 90 && opp.pointIndex !== undefined) {
    selectedEnrichments.set(opp.existingId, opp.pointIndex);  // CORRECT!
  }
}
```

### How to Debug Similar Issues

1. **Console.log the data** - Add logging to trace data through the pipeline
2. **Check types** - JavaScript allows storing any type in a Map; TypeScript won't catch runtime type mismatches
3. **Follow the data flow** - Trace from UI → IPC → Main Process
4. **Add defensive checks** - Validate types before using values

### Testing the Fix

1. Have a location in your database WITHOUT GPS coordinates (e.g., "Canal Cars")
2. Import a reference map (KMZ/GeoJSON) that contains "Canal Cars" WITH GPS coordinates
3. The import preview should show "Canal Cars" in "Matches Found" section
4. Check the checkbox (or let 90%+ auto-check)
5. Click Import
6. Verify the location now has GPS coordinates in the database

Expected log output:
```
[RefMaps] Processing 1 enrichments...
[RefMaps] Applied enrichment: Canal Cars → location abc-123-def
```

### File Reference

| File | Key Lines | Purpose |
|------|-----------|---------|
| `Settings.svelte` | 970-978 | Auto-select 90%+ matches on modal open |
| `Settings.svelte` | 995-1037 | `confirmImport()` builds and sends enrichments |
| `Settings.svelte` | 1042-1067 | `toggleEnrichment()` for manual selection |
| `ref-maps.ts` | 395-421 | Builds `enrichmentOpportunities` with `pointIndex` |
| `ref-maps.ts` | 521-544 | Applies GPS enrichment to locations |
| `ref-map-dedup-service.ts` | 752-806 | Detects enrichment opportunities |

### Common Pitfalls

1. **Storing booleans instead of values in Maps** - Always check what type the Map expects
2. **Forgetting `pointIndex !== undefined` check** - Index 0 is valid but falsy in JS
3. **Not re-parsing the file** - The IPC handler re-parses the KMZ file; `pointIndex` must be stable
4. **Missing defensive validation** - Always validate types before using values from the renderer
