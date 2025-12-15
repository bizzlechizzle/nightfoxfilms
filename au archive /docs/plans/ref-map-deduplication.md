# Reference Map Import Deduplication - Comprehensive Plan

## Problem Statement

When importing reference map files (KML, KMZ, GPX, GeoJSON, CSV), different sources often contain overlapping data:
- Same location with minor name variations ("Old Mill", "Old Mill Factory", "The Old Mill")
- Coordinates within meters of each other from different GPS readings
- Points that already exist as catalogued locations in the `locs` table

**Current Behavior**: All points are imported blindly into `ref_map_points`, creating duplicates.

**Goal**: Intelligent deduplication during import that:
1. Detects points matching existing reference map points (Ref → Ref)
2. Detects points matching catalogued locations in database (Ref → Locs)
3. Presents user with clear preview before committing
4. Allows user to choose: skip duplicates or import anyway

---

## Detection Criteria

### Match Type A: Reference Point Duplicate
A new point matches an **existing `ref_map_points` entry** when:
- **Name similarity** >= 85% (Jaro-Winkler, case-insensitive)
- **GPS proximity** <= 500 meters (Haversine formula)
- Both conditions must be true

### Match Type B: Already Catalogued
A new point matches an **existing `locs` entry** when:
- **Name similarity** >= 85% (Jaro-Winkler against `locnam`)
- **GPS proximity** <= 500 meters (against `gps_lat`/`gps_lng`)
- Both conditions must be true
- Note: Only checks locations that have GPS coordinates

### Priority
- Type B (already catalogued) takes precedence over Type A
- If a point matches both, it's reported as "already catalogued"

---

## Haversine Distance Formula

```typescript
/**
 * Calculate distance between two GPS coordinates in meters
 * Uses Haversine formula for great-circle distance
 */
function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const toRad = (deg: number) => deg * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
```

---

## User Interface Flow

### Current Flow
```
[Select File] → [Parse] → [Insert All] → [Done: "245 points imported"]
```

### New Flow
```
[Select File] → [Parse] → [Dedup Check] → [Preview Modal] → [User Choice] → [Import] → [Done]
```

### Preview Modal Design
```
┌──────────────────────────────────────────────────────────────┐
│  Import Preview: ny-abandoned-sites.kml                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Total points in file:              245                │ │
│  │  ─────────────────────────────────────────────────     │ │
│  │  New discoveries:                   198   ✓ Will import │ │
│  │  Already in your locations:          32   ⚠ In database │ │
│  │  Duplicate reference points:         15   ⚠ Already ref │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ Already Catalogued (32) ──────────────────────────────┐ │
│  │ "Old Mill" matches "Old Mill Factory" (94%, 45m away)  │ │
│  │ "Factory Ruins" matches "Factory Ruins" (100%, 12m)    │ │
│  │ "Power Plant" matches "Power Station" (87%, 120m)      │ │
│  │ ... and 29 more                                        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ Duplicate References (15) ────────────────────────────┐ │
│  │ "Rail Yard" exists in "ohio-rails.kml" (92%, 23m)      │ │
│  │ "Train Depot" exists in "ohio-rails.kml" (88%, 8m)     │ │
│  │ ... and 13 more                                        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Import options:                                             │
│  (•) Skip all duplicates (import 198 new only)              │
│  ( ) Import everything (245 total, including duplicates)    │
│                                                              │
│  [Cancel]                                    [Import]        │
└──────────────────────────────────────────────────────────────┘
```

---

## Technical Architecture

### New Files

#### 1. `electron/services/geo-utils.ts`
Geographic utility functions.

```typescript
// ~30 lines
export function haversineDistance(lat1, lng1, lat2, lng2): number;
export function isWithinRadius(lat1, lng1, lat2, lng2, radiusMeters): boolean;
```

#### 2. `electron/services/ref-map-dedup-service.ts`
Core deduplication logic.

```typescript
// ~150 lines
interface DuplicateMatch {
  type: 'catalogued' | 'reference';
  newPoint: ParsedMapPoint;
  existingName: string;
  existingId: string;         // locid or point_id
  nameSimilarity: number;     // 0-1
  distanceMeters: number;
  mapName?: string;           // For reference matches
}

interface DedupeResult {
  newPoints: ParsedMapPoint[];           // Unique, will be imported
  cataloguedMatches: DuplicateMatch[];   // Matches existing locations
  referenceMatches: DuplicateMatch[];    // Matches existing ref points
  totalParsed: number;
}

interface DedupeOptions {
  nameThreshold?: number;      // Default: 0.85
  distanceThreshold?: number;  // Default: 500 meters
}

class RefMapDedupService {
  constructor(private db: Kysely<Database>) {}

  async checkForDuplicates(
    parsedPoints: ParsedMapPoint[],
    options?: DedupeOptions
  ): Promise<DedupeResult>;
}
```

### Modified Files

#### 3. `electron/main/ipc-handlers/ref-maps.ts`
Add preview endpoint, modify import handlers.

```typescript
// Add new handler
ipcMain.handle('refMaps:previewImport', async (_event, filePath: string) => {
  // 1. Parse file
  // 2. Run dedup check
  // 3. Return preview (don't import yet)
});

// Modify existing handler
ipcMain.handle('refMaps:import', async (_event, importedBy?, options?) => {
  // options.skipDuplicates: boolean (default true)
  // options.previewResult: DedupeResult (from preview step)
});
```

#### 4. `electron/preload/preload.cjs`
Add new IPC methods.

```javascript
refMaps: {
  // ... existing methods
  previewImport: (filePath) => ipcRenderer.invoke('refMaps:previewImport', filePath),
}
```

#### 5. `src/types/electron.d.ts`
Add TypeScript definitions.

```typescript
interface DuplicateMatch {
  type: 'catalogued' | 'reference';
  newPointName: string;
  existingName: string;
  existingId: string;
  nameSimilarity: number;
  distanceMeters: number;
  mapName?: string;
}

interface ImportPreview {
  success: boolean;
  error?: string;
  fileName: string;
  totalPoints: number;
  newPoints: number;
  cataloguedCount: number;
  referenceCount: number;
  cataloguedMatches: DuplicateMatch[];  // First 10 for display
  referenceMatches: DuplicateMatch[];   // First 10 for display
}

interface RefMapsAPI {
  // ... existing
  previewImport: (filePath: string) => Promise<ImportPreview>;
}
```

#### 6. `src/pages/Settings.svelte`
Add import preview modal UI component.

---

## Performance Optimization

### Bounding Box Pre-Filter
Before running expensive Jaro-Winkler on every pair, filter by approximate bounding box:
- 500m ≈ 0.0045° latitude
- 500m ≈ 0.0045° / cos(lat) longitude

```typescript
// First pass: SQL query with bounding box
const candidates = await db
  .selectFrom('ref_map_points')
  .selectAll()
  .where('lat', '>=', point.lat - 0.005)
  .where('lat', '<=', point.lat + 0.005)
  .where('lng', '>=', point.lng - 0.006)
  .where('lng', '<=', point.lng + 0.006)
  .execute();

// Second pass: Exact distance + name similarity on candidates only
```

### Complexity Analysis
- Without optimization: O(n × m) = 250 × 1500 = 375,000 comparisons
- With bounding box: O(n × k) where k ≈ 10-50 nearby points = 2,500-12,500 comparisons
- Jaro-Winkler is O(len1 × len2), typically fast for short names

---

## Claude.md Compliance Audit

| Rule | Compliance | Notes |
|------|------------|-------|
| Scope Discipline | ✓ | Only implements requested deduplication, no extras |
| Archive-First | ✓ | Prevents duplicate reference data, improves research quality |
| Offline-First | ✓ | All processing local, no network calls |
| Keep It Simple | ✓ | 2 new files (~180 lines total), minimal abstraction |
| One Script = One Function | ✓ | geo-utils.ts ~30 lines, dedup-service.ts ~150 lines |
| No AI in Docs | ✓ | No AI mentions in code or UI |
| Database via migrations | ✓ | No schema changes needed |
| Preload CommonJS | ✓ | Uses require() pattern in preload.cjs |
| IPC naming | ✓ | `refMaps:previewImport` follows `domain:action` format |

---

## Testing Checklist

### Unit Tests (ref-map-dedup-service.test.ts)
- [ ] Empty input returns empty results
- [ ] Single new point (no duplicates) passes through
- [ ] Exact name + location match detected
- [ ] Name variation with close GPS detected (85%+ similarity)
- [ ] Same name but far away NOT flagged (>500m)
- [ ] Similar name but far away NOT flagged
- [ ] Match against `locs` table (Type B) works
- [ ] Type B takes precedence over Type A

### Integration Tests
- [ ] Preview modal shows correct counts
- [ ] "Skip duplicates" imports only new points
- [ ] "Import anyway" imports all points
- [ ] Cancel aborts without changes

### Manual Tests
- [ ] Import same file twice → second shows all as duplicates
- [ ] Import overlapping files → shows partial duplicates
- [ ] Import file with locations already in database → shows as "catalogued"

---

## Implementation Order

1. **geo-utils.ts** - Pure utility, no dependencies
2. **ref-map-dedup-service.ts** - Core logic, depends on geo-utils
3. **ref-maps.ts IPC handlers** - Wire up service
4. **preload.cjs** - Expose to renderer
5. **electron.d.ts** - TypeScript types
6. **Settings.svelte** - UI preview modal

---

## Edge Cases

| Case | Behavior |
|------|----------|
| Exact duplicate (100% name, 0m distance) | Skip, mark as duplicate |
| Same name, different state/far away | Import as new (different location) |
| Similar name (85%+), close GPS (<500m) | Flag as potential duplicate |
| Different name, same GPS | Import as new (different name implies different thing) |
| Point with null/empty name | Import without name matching |
| Location without GPS | Cannot match by proximity, name-only if desired (future) |

---

## Out of Scope

- Retroactive deduplication of existing data (user has only 3 locations)
- Merging metadata from duplicates (picking best description)
- Cross-file deduplication within single import
- Configurable thresholds in UI (hardcoded 85% / 500m for now)
- Automatic clustering/grouping of similar points

---

## Files Summary

| File | Action | Lines | Purpose |
|------|--------|-------|---------|
| `electron/services/geo-utils.ts` | CREATE | ~30 | Haversine distance calculation |
| `electron/services/ref-map-dedup-service.ts` | CREATE | ~150 | Deduplication logic |
| `electron/main/ipc-handlers/ref-maps.ts` | MODIFY | +60 | Add preview handler |
| `electron/preload/preload.cjs` | MODIFY | +2 | Expose previewImport |
| `src/types/electron.d.ts` | MODIFY | +25 | TypeScript definitions |
| `src/pages/Settings.svelte` | MODIFY | +120 | Preview modal UI |

**Total new code**: ~390 lines
