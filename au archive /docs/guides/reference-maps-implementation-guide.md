# Reference Maps Implementation Guide

A comprehensive guide for understanding and extending the Reference Maps feature in the Abandoned Archive application.

## Overview

Reference Maps allow users to import geographic data files (KML, KMZ, GPX, GeoJSON, CSV) containing named locations with GPS coordinates. The system then auto-matches these reference points against user-entered location names during import, suggesting GPS coordinates from verified sources.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         RENDERER (Svelte)                           │
│  ┌──────────────────┐  ┌────────────────────┐  ┌─────────────────┐ │
│  │  Settings.svelte │  │  ImportModal.svelte │  │   Atlas.svelte  │ │
│  │   (Import UI)    │  │  (Match Suggestions)│  │  (Map Display)  │ │
│  └────────┬─────────┘  └─────────┬──────────┘  └────────┬────────┘ │
└───────────┼──────────────────────┼──────────────────────┼──────────┘
            │                      │                      │
            ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         PRELOAD (preload.cjs)                       │
│  window.electronAPI.refMaps.{import, findAll, findMatches, ...}    │
└─────────────────────────────────────────────────────────────────────┘
            │                      │                      │
            ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      IPC HANDLERS (ref-maps.ts)                     │
│  ipcMain.handle('refMaps:import', 'refMaps:findMatches', ...)      │
└─────────────────────────────────────────────────────────────────────┘
            │                      │
            ▼                      ▼
┌────────────────────────┐  ┌────────────────────────────────────────┐
│  map-parser-service.ts │  │  ref-map-matcher-service.ts            │
│  (File Parsing)        │  │  (Similarity Matching)                 │
└────────────────────────┘  └────────────────────────────────────────┘
            │                      │
            ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│               sqlite-ref-maps-repository.ts                         │
│  (Database Operations: CRUD for ref_maps and ref_map_points)       │
└─────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      SQLite Database                                │
│  Tables: ref_maps, ref_map_points                                  │
└─────────────────────────────────────────────────────────────────────┘
```

## Database Schema

Located in `migrations/037-add-ref-maps.ts`:

```sql
-- Reference maps metadata
CREATE TABLE ref_maps (
  map_id TEXT PRIMARY KEY,
  map_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  point_count INTEGER DEFAULT 0,
  imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
  imported_by TEXT
);

-- Individual points from reference maps
CREATE TABLE ref_map_points (
  point_id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES ref_maps(map_id) ON DELETE CASCADE,
  name TEXT,
  description TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  state TEXT,
  category TEXT,
  raw_metadata TEXT
);

-- Indexes for efficient querying
CREATE INDEX idx_ref_map_points_map_id ON ref_map_points(map_id);
CREATE INDEX idx_ref_map_points_state ON ref_map_points(state);
CREATE INDEX idx_ref_map_points_name ON ref_map_points(name);
```

## Key Files

### 1. Map Parser Service
**File:** `electron/services/map-parser-service.ts`

Parses various geographic file formats and extracts points:

```typescript
interface ParsedPoint {
  name: string | null;
  description: string | null;
  lat: number;
  lng: number;
  state: string | null;
  category: string | null;
  rawMetadata: Record<string, unknown>;
}

interface ParseResult {
  success: boolean;
  points: ParsedPoint[];
  fileType: string;
  error?: string;
}

// Usage
const result = await parseMapFile('/path/to/file.kml');
if (result.success) {
  console.log(`Parsed ${result.points.length} points`);
}
```

**Supported formats:**
- KML (Google Earth)
- KMZ (compressed KML)
- GPX (GPS Exchange Format)
- GeoJSON
- CSV (with lat/lng columns)

### 2. Jaro-Winkler Service
**File:** `electron/services/jaro-winkler-service.ts`

Implements fuzzy string matching for location names:

```typescript
// Calculate similarity between two strings (0.0 to 1.0)
const score = jaroWinklerSimilarity('Old Mill', 'Old Textile Mill');
// Returns ~0.92

// Check if strings match above threshold
const isMatch = isMatch('Old Mill', 'Old Textile Mill', 0.92);
// Returns true

// Find best matches from a list
const matches = findBestMatches('Old Mill', ['Old Textile Mill', 'New Factory'], 0.8, 3);
// Returns [{ index: 0, value: 'Old Textile Mill', score: 0.92 }]
```

**Algorithm details:**
- Jaro-Winkler is optimized for short strings (names)
- Gives bonus weight to matching prefixes
- Case-insensitive comparison
- Scaling factor: 0.1 (standard)
- Default threshold: 0.92 (92% similarity required)

### 3. Reference Map Matcher Service
**File:** `electron/services/ref-map-matcher-service.ts`

Queries the database and applies similarity matching:

```typescript
interface RefMapMatch {
  pointId: string;
  mapId: string;
  name: string;
  description: string | null;
  lat: number;
  lng: number;
  state: string | null;
  category: string | null;
  mapName: string;
  score: number;
}

interface MatchOptions {
  threshold?: number;      // Default: 0.92
  limit?: number;          // Default: 3
  state?: string | null;   // Filter by state
  minQueryLength?: number; // Default: 3
}

// Usage
const matcher = new RefMapMatcherService(db);
const matches = await matcher.findMatches('Old Mill', {
  threshold: 0.92,
  limit: 3,
  state: 'NY',
});
```

### 4. IPC Handlers
**File:** `electron/main/ipc-handlers/ref-maps.ts`

Exposes reference map operations to the renderer:

```typescript
// Import a map file (opens file dialog)
ipcMain.handle('refMaps:import', async (_event, importedBy?: string))

// Import from a specific path (for drag-drop)
ipcMain.handle('refMaps:importFromPath', async (_event, filePath: string, importedBy?: string))

// Get all maps (metadata only)
ipcMain.handle('refMaps:findAll', async ())

// Get a specific map with all points
ipcMain.handle('refMaps:findById', async (_event, mapId: string))

// Get all points from all maps
ipcMain.handle('refMaps:getAllPoints', async ())

// Update map name
ipcMain.handle('refMaps:update', async (_event, mapId: string, updates: { mapName?: string }))

// Delete a map and its points
ipcMain.handle('refMaps:delete', async (_event, mapId: string))

// Get statistics
ipcMain.handle('refMaps:getStats', async ())

// Get supported file extensions
ipcMain.handle('refMaps:getSupportedExtensions', ())

// Find matching points for a location name (Phase 2)
ipcMain.handle('refMaps:findMatches', async (_event, query: string, options?))
```

### 5. Preload Bridge
**File:** `electron/preload/preload.cjs`

Exposes IPC handlers to the renderer securely:

```javascript
refMaps: {
  import: (importedBy) => ipcRenderer.invoke("refMaps:import", importedBy),
  importFromPath: (filePath, importedBy) => ipcRenderer.invoke("refMaps:importFromPath", filePath, importedBy),
  findAll: () => ipcRenderer.invoke("refMaps:findAll"),
  findById: (mapId) => ipcRenderer.invoke("refMaps:findById", mapId),
  getAllPoints: () => ipcRenderer.invoke("refMaps:getAllPoints"),
  update: (mapId, updates) => ipcRenderer.invoke("refMaps:update", mapId, updates),
  delete: (mapId) => ipcRenderer.invoke("refMaps:delete", mapId),
  getStats: () => ipcRenderer.invoke("refMaps:getStats"),
  getSupportedExtensions: () => ipcRenderer.invoke("refMaps:getSupportedExtensions"),
  findMatches: (query, options) => ipcRenderer.invoke("refMaps:findMatches", query, options),
}
```

### 6. TypeScript Types
**File:** `src/types/electron.d.ts`

Defines the API types for TypeScript:

```typescript
interface RefMapMatch {
  pointId: string;
  mapId: string;
  name: string;
  description: string | null;
  lat: number;
  lng: number;
  state: string | null;
  category: string | null;
  mapName: string;
  score: number;
}

interface ElectronAPI {
  refMaps: {
    import: (importedBy?: string) => Promise<{ success: boolean; ... }>;
    findMatches: (query: string, options?: {
      threshold?: number;
      limit?: number;
      state?: string | null;
    }) => Promise<RefMapMatch[]>;
    // ... other methods
  };
}
```

## UI Integration

### Settings Page (Import)
**File:** `src/pages/Settings.svelte`

Users import reference maps from the Settings page:

```svelte
<button onclick={handleImportRefMap}>
  Import Reference Map
</button>

<script>
async function handleImportRefMap() {
  const result = await window.electronAPI.refMaps.import(currentUser);
  if (result.success) {
    toasts.success(`Imported ${result.pointCount} points`);
  }
}
</script>
```

### ImportModal (Auto-Matching)
**File:** `src/components/ImportModal.svelte`

Real-time matching as users type location names:

```svelte
<script>
  let refMapMatches = $state<RefMapMatch[]>([]);
  let matchesLoading = $state(false);
  let matchesDismissed = $state(false);

  // Debounced search (300ms delay)
  $effect(() => {
    const hasGps = $importModal.prefilledData?.gps_lat;
    if (hasGps || matchesDismissed || name.length < 3) {
      refMapMatches = [];
      return;
    }

    setTimeout(async () => {
      const matches = await window.electronAPI.refMaps.findMatches(name.trim(), {
        threshold: 0.92,
        limit: 3,
        state: selectedState || null,
      });
      refMapMatches = matches;
    }, 300);
  });

  function applyMatchGps(match: RefMapMatch) {
    importModal.update(current => ({
      ...current,
      prefilledData: {
        ...current.prefilledData,
        gps_lat: match.lat,
        gps_lng: match.lng,
      },
    }));
    refMapMatches = [];
    toasts.success(`GPS applied from "${match.name}"`);
  }
</script>

{#if refMapMatches.length > 0}
  <div class="bg-purple-50 border border-purple-200 rounded-lg p-3">
    {#each refMapMatches as match}
      <div class="flex items-center justify-between">
        <span>{match.name} ({Math.round(match.score * 100)}%)</span>
        <button onclick={() => applyMatchGps(match)}>Apply GPS</button>
      </div>
    {/each}
  </div>
{/if}
```

### Atlas (Map Display)
**File:** `src/pages/Atlas.svelte`

Reference points displayed as a toggle-able layer:

```svelte
<script>
  let showRefMapPoints = $state(false);
  let refMapPoints = $state([]);

  async function loadRefMapPoints() {
    refMapPoints = await window.electronAPI.refMaps.getAllPoints();
  }
</script>

<label>
  <input type="checkbox" bind:checked={showRefMapPoints} />
  Show Reference Points
</label>
```

## Extending the Feature

### Adding a New File Format

1. Update `map-parser-service.ts`:

```typescript
// Add to SUPPORTED_EXTENSIONS
const SUPPORTED_EXTENSIONS = ['.kml', '.kmz', '.gpx', '.geojson', '.json', '.csv', '.newformat'];

// Add parser function
async function parseNewFormat(filePath: string): Promise<ParseResult> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const points: ParsedPoint[] = [];
  // Parse the content...
  return { success: true, points, fileType: 'newformat' };
}

// Add to parseMapFile switch
case '.newformat':
  return parseNewFormat(filePath);
```

2. Update file dialog filters in `ref-maps.ts`:

```typescript
filters: [
  { name: 'Map Files', extensions: ['kml', 'kmz', 'gpx', 'geojson', 'json', 'csv', 'newformat'] },
]
```

### Adjusting Match Threshold

The default threshold of 0.92 can be adjusted:

```typescript
// More lenient matching (80%)
const matches = await matcher.findMatches(query, { threshold: 0.80 });

// Stricter matching (95%)
const matches = await matcher.findMatches(query, { threshold: 0.95 });
```

### Adding State Detection

The CSV parser includes basic state detection from addresses:

```typescript
function extractStateFromAddress(address: string): string | null {
  // Look for 2-letter state codes
  const stateMatch = address.match(/\b([A-Z]{2})\b/);
  if (stateMatch && US_STATES.includes(stateMatch[1])) {
    return stateMatch[1];
  }
  return null;
}
```

## Testing

### Manual Testing Checklist

1. **Import Testing:**
   - [ ] Import KML file with named points
   - [ ] Import GPX file with waypoints
   - [ ] Import CSV with lat/lng columns
   - [ ] Verify point counts match expected
   - [ ] Delete imported map and verify cascade

2. **Matching Testing:**
   - [ ] Type location name, verify suggestions appear
   - [ ] Verify 300ms debounce works
   - [ ] Apply GPS from suggestion
   - [ ] Dismiss suggestions
   - [ ] Verify state filter works

3. **Atlas Display:**
   - [ ] Toggle reference points layer
   - [ ] Verify purple markers appear
   - [ ] Click marker for popup info

### Unit Test Examples

```typescript
// jaro-winkler-service.test.ts
describe('jaroWinklerSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaroWinklerSimilarity('test', 'test')).toBe(1.0);
  });

  it('handles case insensitivity', () => {
    expect(jaroWinklerSimilarity('Test', 'test')).toBe(1.0);
  });

  it('returns high score for similar strings', () => {
    const score = jaroWinklerSimilarity('Old Mill', 'Old Textile Mill');
    expect(score).toBeGreaterThan(0.85);
  });
});
```

## Performance Considerations

1. **Debouncing:** 300ms delay prevents excessive queries during typing
2. **State filtering:** Reduces dataset when state is known
3. **Limit results:** Default limit of 3 prevents UI overflow
4. **Minimum query length:** 3 characters prevents empty/broad searches
5. **Index usage:** Database indexes on `state` and `name` columns

## Troubleshooting

### Common Issues

1. **"findMatches is not a function"**
   - Verify preload.cjs includes the findMatches method
   - Check electron.d.ts has the type definition
   - Restart the dev server

2. **No matches appearing**
   - Verify reference maps are imported (check Settings)
   - Lower the threshold for testing
   - Check browser console for errors

3. **Import fails silently**
   - Check file format is supported
   - Verify file has valid GPS coordinates
   - Look at main process console for errors

### Debug Logging

```typescript
// Add to ref-map-matcher-service.ts
console.log('[RefMapMatcher] Query:', query);
console.log('[RefMapMatcher] Points found:', points.length);
console.log('[RefMapMatcher] Matches above threshold:', matches.length);
```

## Design Decisions

1. **Purple theme:** Consistent with reference map markers on Atlas
2. **Non-blocking UI:** Suggestions appear inline, don't interrupt workflow
3. **Auto-dismiss on GPS apply:** Clean UX, one-click action
4. **92% threshold:** Balances precision and recall for location names
5. **Jaro-Winkler over Levenshtein:** Better for short strings with transpositions
