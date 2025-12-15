# Reference Map Import Deduplication - Implementation Guide

This guide explains the reference map import deduplication feature, its architecture, and how to maintain or extend it.

## Overview

When importing reference map files (KML, GPX, GeoJSON, CSV), the system now checks for duplicate points before importing. This prevents:

1. **Type A duplicates**: Points that already exist in other imported reference maps
2. **Type B duplicates**: Points that match locations already catalogued in the `locs` table

## Architecture

### Files Changed/Added

```
packages/desktop/
├── electron/
│   ├── main/ipc-handlers/
│   │   └── ref-maps.ts          # Added selectFile, previewImport, importWithOptions handlers
│   └── services/
│       ├── geo-utils.ts         # NEW: Haversine distance calculation
│       ├── ref-map-dedup-service.ts  # NEW: Deduplication logic
│       └── jaro-winkler-service.ts   # Existing: String similarity
├── preload/
│   └── preload.cjs              # Added new IPC methods
└── src/
    ├── pages/
    │   └── Settings.svelte      # Added import preview modal
    └── types/
        └── electron.d.ts        # Added TypeScript types
```

### Data Flow

```
1. User clicks "Import Map File"
       ↓
2. File dialog opens (refMaps:selectFile)
       ↓
3. Preview request (refMaps:previewImport)
       ↓
4. RefMapDedupService.checkForDuplicates()
   - Query locs table within bounding box
   - Query ref_map_points table within bounding box
   - Compare name similarity (Jaro-Winkler)
   - Compare GPS distance (Haversine)
       ↓
5. Modal shows preview with:
   - Total points in file
   - New points (no matches)
   - Catalogued matches (already in locs)
   - Reference matches (already in ref_map_points)
       ↓
6. User chooses "Skip duplicates" or "Import all"
       ↓
7. Import executes (refMaps:importWithOptions)
```

## Key Components

### 1. Haversine Distance (`geo-utils.ts`)

The Haversine formula calculates great-circle distance between two GPS coordinates.

```typescript
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const toRad = (deg: number): number => deg * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Returns meters
}
```

**Why Haversine?** GPS coordinates are on a sphere, not a flat plane. Simple Euclidean distance would be inaccurate, especially over long distances. Haversine accounts for Earth's curvature.

### 2. Bounding Box Pre-filtering

Before comparing every point, we use a bounding box to filter candidates:

```typescript
export function getBoundingBox(lat: number, lng: number, radiusMeters: number) {
  // 1 degree latitude ≈ 111,320 meters
  const latDelta = radiusMeters / 111320;

  // Longitude varies by latitude
  const lngDelta = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}
```

**Why bounding box?** Database queries with `BETWEEN` on indexed lat/lng columns are fast. Haversine on every row would be slow. The bounding box is a square that contains the circle of interest.

### 3. Jaro-Winkler Similarity

String comparison for location names. Returns 0.0 to 1.0 (1.0 = exact match).

The existing `jaro-winkler-service.ts` handles this. Key features:
- Weights prefix matches (common in location names like "Old Mill" and "Old Mill Site")
- Handles transpositions better than Levenshtein
- Returns normalized score

### 4. Deduplication Service (`ref-map-dedup-service.ts`)

```typescript
interface DuplicateMatch {
  type: 'catalogued' | 'reference';
  newPoint: ParsedMapPoint;
  existingName: string;
  existingId: string;
  nameSimilarity: number;    // 0-1
  distanceMeters: number;
  mapName?: string;          // For reference matches
}

interface DedupeResult {
  newPoints: ParsedMapPoint[];      // Import these
  cataloguedMatches: DuplicateMatch[];
  referenceMatches: DuplicateMatch[];
  totalParsed: number;
}
```

The service checks each incoming point:
1. Get bounding box for 500m radius
2. Query `locs` table for nearby catalogued locations
3. Query `ref_map_points` for nearby reference points
4. Compare name similarity (threshold: 85%)
5. If both distance AND name match, flag as duplicate

### 5. Detection Thresholds

| Threshold | Value | Rationale |
|-----------|-------|-----------|
| Name similarity | 85% | Catches "Unnamed Mill" vs "The Unnamed Mill" |
| GPS distance | 500m | Accounts for GPS inaccuracy + location size |

These are configurable in `ref-map-dedup-service.ts`:
```typescript
const DEFAULT_NAME_THRESHOLD = 0.85;
const DEFAULT_DISTANCE_THRESHOLD = 500; // meters
```

## IPC Handlers

### `refMaps:selectFile`

Opens file dialog, returns path or null.

```typescript
ipcMain.handle('refMaps:selectFile', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Import Reference Map',
    filters: [
      { name: 'Map Files', extensions: ['kml', 'kmz', 'gpx', 'geojson', 'json', 'csv'] }
    ],
    properties: ['openFile']
  });
  return result.canceled ? null : result.filePaths[0];
});
```

### `refMaps:previewImport`

Parses file and runs deduplication check without importing.

```typescript
ipcMain.handle('refMaps:previewImport', async (_event, filePath: string) => {
  // 1. Parse file
  const parseResult = await parseMapFile(filePath);

  // 2. Run deduplication check
  const dedupResult = await dedupService.checkForDuplicates(parseResult.points);

  // 3. Return preview data
  return {
    success: true,
    fileName: path.basename(filePath),
    totalPoints: dedupResult.totalParsed,
    newPoints: dedupResult.newPoints.length,
    cataloguedCount: dedupResult.cataloguedMatches.length,
    referenceCount: dedupResult.referenceMatches.length,
    cataloguedMatches: dedupResult.cataloguedMatches.slice(0, 10),
    referenceMatches: dedupResult.referenceMatches.slice(0, 10),
  };
});
```

### `refMaps:importWithOptions`

Imports with optional duplicate skipping.

```typescript
ipcMain.handle('refMaps:importWithOptions', async (
  _event,
  filePath: string,
  options: { skipDuplicates: boolean; importedBy?: string }
) => {
  const parseResult = await parseMapFile(filePath);
  let pointsToImport = parseResult.points;

  if (options.skipDuplicates) {
    const dedupResult = await dedupService.checkForDuplicates(parseResult.points);
    pointsToImport = dedupResult.newPoints;
  }

  // Import only filtered points
  const refMap = await repository.create({
    mapName: path.basename(filePath, path.extname(filePath)),
    filePath,
    fileType: parseResult.fileType,
    importedBy: options.importedBy,
    points: pointsToImport
  });

  return {
    success: true,
    map: refMap,
    pointCount: pointsToImport.length,
    skippedCount: parseResult.points.length - pointsToImport.length
  };
});
```

## UI Components

### Import Preview Modal (Settings.svelte)

The modal shows:
1. **Summary stats**: Total/new/duplicate counts
2. **Match details**: First 10 of each type with similarity scores
3. **Skip checkbox**: Default checked when duplicates found
4. **Action buttons**: Cancel or Import

Key state variables:
```typescript
let showImportPreview = $state(false);
let importPreview = $state<ImportPreview | null>(null);
let skipDuplicates = $state(true);
```

## Testing Checklist

### Unit Tests (if adding)
- [ ] Haversine distance: Known coordinates return expected distance
- [ ] Bounding box: Contains all points within radius
- [ ] Jaro-Winkler: "Unnamed Mill" vs "The Unnamed Mill" > 0.85
- [ ] Empty point list returns empty dedup result

### Manual Testing
1. Import a map file with NO duplicates - all points should import
2. Import the same file again - all should be flagged as reference duplicates
3. Create a location matching a ref point name/GPS - should flag as catalogued
4. Test with skip=true and skip=false

## Extending the Feature

### Adjusting Thresholds

Edit `ref-map-dedup-service.ts`:
```typescript
const DEFAULT_NAME_THRESHOLD = 0.80; // More lenient
const DEFAULT_DISTANCE_THRESHOLD = 1000; // 1km
```

### Adding New Match Types

To add a third category (e.g., "archived locations"):
1. Add new array to `DedupeResult`
2. Add new `find*Match` method in service
3. Update IPC handler to return new category
4. Update UI modal to display new section

### Performance Considerations

- Bounding box queries are indexed-friendly
- For very large imports (10k+ points), consider batching
- The 500m radius typically returns few candidates per point

## Common Issues

### "All points were duplicates"

This means every point in the file matched existing data. Options:
1. Uncheck "Skip duplicates" to force import
2. Check if the map was already imported
3. Verify the detection thresholds aren't too aggressive

### Slow preview on large files

The preview parses the entire file and checks each point. For files with thousands of points:
- Consider adding a progress indicator
- Batch the deduplication checks
- Add caching for bounding box queries

### Type errors in preload

Remember: preload must be CommonJS. If you see "import is not defined":
- Use `require()` not `import`
- Ensure `.cjs` extension
- Check `vite.config.ts` copy plugin

## Summary

The deduplication feature prevents accidental duplicate imports by:
1. Parsing the file without importing
2. Checking each point against existing data
3. Showing a preview with match details
4. Letting the user choose to skip or include duplicates

This maintains data quality while giving users full control over their imports.
