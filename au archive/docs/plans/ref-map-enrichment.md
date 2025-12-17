# Plan: GPS Enrichment for Matched Locations During Reference Map Import

**Status:** Draft - Awaiting Approval
**Created:** 2025-12-01

---

## Problem Statement

When importing a reference map (KMZ), duplicate detection finds matches like "Canal Cars" against existing catalogued locations. However, if the existing location **has no GPS coordinates** while the reference point **does have GPS**, we currently just skip the duplicate—losing the opportunity to enrich the existing record.

### Current Behavior
```
KMZ Point: "Canal Cars" @ [42.xxx, -75.xxx] (NY)
Existing Location: "Canal Cars" (no GPS, name-only match)
Result: Skip → Existing location STILL has no GPS ❌
```

---

## Approved Decisions

1. **Both options:** Individual "Apply GPS" per match AND batch "Apply all GPS" button
2. **Partial match boost:** When user inputs state in form, boost matching confidence for partial matches
3. **No map verification required:** Trust reference point, mark as unverified (`gps_verified_on_map: false`)
4. **Auto-fill state:** When user confirms a match, auto-fill state field in the import form from the reference point

---

## Proposed Solution

### New Category: "Enrichment Opportunities"

Add a third category to import preview between "New Points" and "Already Catalogued":

```
Import Reference Map: New York.kmz
Total points: 937

New points: 935
Enrichment Opportunities: 1    ← NEW
Already Catalogued: 1

───────────────────────────────────
Enrichment Opportunities (1)
These existing locations can be updated with GPS from the reference map

┌──────────────────────────────────────────────────────────┐
│ Canal Cars → Canal Cars                           100%  │
│ ⚠️ Existing location has no GPS                         │
│ Reference point: 42.5234, -75.9123 (NY)                 │
│                                                         │
│ [Apply GPS]  [Skip]                                     │
└──────────────────────────────────────────────────────────┘

[Apply All GPS] [Skip All]

Already Catalogued (0)
(Matches where existing location already has GPS - nothing to enrich)
```

---

## Implementation Steps

### Step 1: Update DuplicateMatch Interface
**File:** `packages/desktop/electron/services/ref-map-dedup-service.ts`

Add enrichment detection to the match interface:
```typescript
interface DuplicateMatch {
  // ... existing fields
  enrichmentType?: 'gps' | null;  // What can be enriched
  existingHasGps?: boolean;       // Does existing location have GPS?
  refPointState?: string;         // State from ref point (for auto-fill)
}
```

### Step 2: Check GPS Status During Matching
**File:** `packages/desktop/electron/services/ref-map-dedup-service.ts`

When matching against `locs` table, query GPS status:
```typescript
// In checkAgainstCatalogued() or similar
const existingLoc = await db.selectFrom('locs')
  .select(['locid', 'locnam', 'state', 'gps_lat', 'gps_lng'])
  .where('locid', '=', matchId)
  .executeTakeFirst();

const hasGps = existingLoc?.gps_lat != null && existingLoc?.gps_lng != null;

return {
  ...match,
  existingHasGps: hasGps,
  enrichmentType: hasGps ? null : 'gps',
  refPointState: refPoint.state  // For auto-fill
};
```

### Step 3: Update Preview Response
**File:** `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

Return separate counts:
```typescript
// In refMaps:previewImport handler
return {
  total: points.length,
  newPoints: newCount,
  enrichmentOpportunities: matches.filter(m => m.enrichmentType === 'gps').length,
  alreadyCatalogued: matches.filter(m => !m.enrichmentType).length,
  enrichmentMatches: matches.filter(m => m.enrichmentType === 'gps'),
  cataloguedMatches: matches.filter(m => !m.enrichmentType)
};
```

### Step 4: Add Enrichment IPC Handler
**File:** `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

New handler to apply GPS enrichment:
```typescript
ipcMain.handle('refMaps:applyEnrichment', async (_, input: {
  locationId: string;      // Existing location to enrich
  refPointId: string;      // Reference point providing GPS
  deleteRefPoint: boolean; // Whether to delete ref point after
}) => {
  const refPoint = await getRefPoint(input.refPointId);

  await db.updateTable('locs')
    .set({
      gps_lat: refPoint.lat,
      gps_lng: refPoint.lng,
      gps_source: 'ref_map_import',
      gps_verified_on_map: false,
      gps_accuracy_meters: null,
      gps_captured_at: new Date().toISOString()
    })
    .where('locid', '=', input.locationId)
    .execute();

  if (input.deleteRefPoint) {
    await deleteRefPoint(input.refPointId);
  }

  return { success: true, state: refPoint.state };
});
```

### Step 5: Update Import Preview UI
**File:** `packages/desktop/src/components/refmaps/RefMapImportPreview.svelte` (or similar)

Add enrichment section with:
- Individual "Apply GPS" / "Skip" buttons per match
- Batch "Apply All GPS" / "Skip All" buttons
- Show ref point coordinates and state
- Visual indicator (warning icon) for missing GPS

### Step 6: Auto-fill State on Confirmation
**File:** `packages/desktop/src/components/ImportModal.svelte` (or location form)

When enrichment is applied:
```typescript
async function handleApplyEnrichment(match: EnrichmentMatch) {
  const result = await window.electron.refMaps.applyEnrichment({
    locationId: match.existingId,
    refPointId: match.refPointId,
    deleteRefPoint: true
  });

  if (result.success && result.state) {
    // Auto-fill state in form for context
    formState.state = result.state;
  }
}
```

### Step 7: Partial Match Boost with State Input
**File:** `packages/desktop/electron/services/ref-map-dedup-service.ts`

When user has entered a state, boost matching:
```typescript
function calculateMatchScore(refPoint: RefPoint, existingLoc: Location, userInputState?: string): number {
  let score = baseNameSimilarity;

  // Boost if states match
  if (userInputState && refPoint.state === userInputState) {
    score += 0.1;  // Boost partial matches when state confirmed
  }

  return score;
}
```

---

## GPS Source Enum Update

Add new value to GPS source tracking:
```typescript
type GpsSource =
  | 'map_confirmed'    // User verified on satellite
  | 'photo_exif'       // From photo metadata
  | 'reverse_geocode'  // From address lookup
  | 'manual'           // User typed coordinates
  | 'ref_map_import'   // NEW: From reference map enrichment
  | 'ref_map_point';   // Existing: Created from ref point
```

---

## Data Flow

```
1. User imports KMZ file
2. Parser extracts points with GPS + names
3. Duplicate detection runs against:
   a. Other ref_map_points (existing behavior)
   b. Catalogued locations (locs table)
4. For each locs match:
   - Query existing location's GPS status
   - If NO GPS → mark as "enrichment opportunity"
   - If HAS GPS → mark as "already catalogued"
5. Preview shows three sections:
   - New points (import normally)
   - Enrichment opportunities (with Apply/Skip buttons)
   - Already catalogued (skip by default)
6. User actions:
   - "Apply GPS" → Updates existing location, deletes ref point
   - "Apply All GPS" → Batch update all enrichments
   - "Skip" → Leaves as-is, keeps ref point for later
7. State auto-filled in form when enrichment applied
```

---

## Edge Cases

| Case | Handling |
|------|----------|
| Existing has GPS, ref point has GPS | Already catalogued (skip) |
| Existing has no GPS, ref point has GPS | **Enrichment opportunity** |
| Multiple ref points match same location | Show all, user picks best |
| User declines individual enrichment | Keep ref point, mark as skipped |
| Ref point has no state | No auto-fill, still apply GPS |
| Name match but different states | Lower confidence, show with warning |

---

## Files to Modify

| File | Changes |
|------|---------|
| `ref-map-dedup-service.ts` | Add enrichment detection, GPS status check |
| `ref-maps.ts` (IPC) | Add `refMaps:applyEnrichment` handler, update preview response |
| `RefMapImportPreview.svelte` | Add enrichment section UI |
| `ImportModal.svelte` | Auto-fill state on enrichment |
| `preload.cjs` | Expose new IPC channel |
| `electron.d.ts` | Add types for new handler |

---

## Success Criteria

- [ ] Import preview shows "Enrichment Opportunities" section
- [ ] Individual "Apply GPS" button updates existing location
- [ ] "Apply All GPS" button batch updates all enrichments
- [ ] State auto-fills in form after enrichment applied
- [ ] GPS source set to `ref_map_import`
- [ ] Ref point deleted after successful enrichment
- [ ] Already-catalogued locations (with GPS) still skip correctly

---

## Out of Scope (Future)

- Address enrichment (existing has no address, ref has address)
- Type enrichment (existing has no type, ref has type in description)
- Merge UI for conflicting data (both have GPS but different)
