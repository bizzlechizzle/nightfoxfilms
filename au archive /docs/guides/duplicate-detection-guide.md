# Duplicate Detection Implementation Guide

**For:** Developers implementing or extending the pin-to-location duplicate prevention system
**ADR:** ADR-pin-conversion-duplicate-prevention.md
**Migration:** 38

---

## Overview

This guide explains how to use the duplicate detection system added in Migration 38. The system prevents duplicate locations from being created in the archive by checking:

1. **GPS Proximity** - Is there an existing location within 150 meters?
2. **Name Similarity** - Does the name match (≥50% Jaro-Winkler similarity)?

---

## Quick Start: Using Duplicate Detection

### From the Renderer (Svelte)

```typescript
// Check for duplicates before creating a location
const result = await window.electronAPI.locations.checkDuplicateByNameAndGps({
  name: 'Old River Mill',
  lat: 42.5678,
  lng: -76.1234,
});

if (result.hasDuplicate) {
  // Show duplicate panel to user
  console.log('Match found:', result.match);
  console.log('Match type:', result.match.matchType); // 'gps' or 'name'
  console.log('Location:', result.match.locnam);

  if (result.match.matchType === 'gps') {
    console.log('Distance:', result.match.distanceMeters, 'meters away');
  } else {
    console.log('Name similarity:', result.match.nameSimilarity, '%');
    console.log('Matched field:', result.match.matchedField); // 'locnam', 'akanam', or 'historicalName'
  }
}
```

### Recording "Different Place" Decisions

When a user says two locations are different (not duplicates), save that decision:

```typescript
// User clicked "Different place" button
await window.electronAPI.locations.addExclusion(
  'Old River Mill',    // The new name they're creating
  'Riverside Mill'     // The existing location name
);

// Now create the location - it won't trigger duplicate warning for this pair again
```

---

## Understanding the Match Result

The `checkDuplicateByNameAndGps` function returns:

```typescript
interface DuplicateCheckResult {
  hasDuplicate: boolean;
  match?: {
    locationId: string;        // UUID of existing location
    locnam: string;            // Primary name
    akanam: string | null;     // Alias name (if any)
    historicalName: string | null; // Historical name (if any)
    state: string | null;      // State code
    matchType: 'gps' | 'name'; // How the match was found
    distanceMeters?: number;   // Only for GPS matches
    nameSimilarity?: number;   // Only for name matches (0-100)
    matchedField?: 'locnam' | 'akanam' | 'historicalName'; // Which field matched
    mediaCount: number;        // Number of media files attached
  };
}
```

---

## When to Check for Duplicates

Check for duplicates in these scenarios:

### 1. Location Create Form

```typescript
// When user enters a name (debounced)
async function onNameChange(name: string) {
  if (name.length < 3) return;

  const result = await window.electronAPI.locations.checkDuplicateByNameAndGps({
    name,
    lat: currentLat,  // May be null if not set yet
    lng: currentLng,
  });

  if (result.hasDuplicate) {
    showDuplicatePanel(result.match);
  }
}
```

### 2. Converting a Ref Map Point to Location

```typescript
// When clicking "Create Location" from a reference map pin
async function handleConvertToLocation(point: RefMapPoint) {
  const result = await window.electronAPI.locations.checkDuplicateByNameAndGps({
    name: point.name || 'Unnamed',
    lat: point.lat,
    lng: point.lng,
  });

  if (result.hasDuplicate) {
    // Show: "This might be [match.locnam]. Link to it?"
    showDuplicateChoice(point, result.match);
  } else {
    // Open create form pre-filled with point data
    openCreateForm(point);
  }
}
```

### 3. After GPS is Set/Changed

```typescript
// When map pin is placed or GPS coordinates entered
async function onGpsSet(lat: number, lng: number) {
  const result = await window.electronAPI.locations.checkDuplicateByNameAndGps({
    name: currentName,
    lat,
    lng,
  });

  if (result.hasDuplicate && result.match.matchType === 'gps') {
    // Priority alert: GPS match is strong evidence of duplicate
    showGpsMatchWarning(result.match);
  }
}
```

---

## Building the Duplicate Panel UI

### Inline Panel Design

```svelte
{#if duplicateMatch}
  <div class="bg-warning-50 border-l-4 border-warning-500 p-4 my-4 rounded-r">
    <div class="flex gap-3">
      <!-- Warning icon -->
      <span class="text-xl">⚠️</span>

      <div class="flex-1">
        <!-- Header -->
        <p class="font-semibold text-warning-800">Possible duplicate found</p>

        <!-- What user is creating -->
        <p class="text-sm text-gray-600 mt-1">
          You're creating: <strong>{newName}</strong>
        </p>

        <!-- Match details box -->
        <div class="mt-3 p-3 bg-white rounded border">
          <p class="font-medium">{duplicateMatch.locnam}</p>

          {#if duplicateMatch.akanam}
            <p class="text-sm text-gray-500">AKA: {duplicateMatch.akanam}</p>
          {/if}

          <p class="text-sm text-gray-500 mt-1">
            {#if duplicateMatch.matchType === 'gps'}
              📍 {duplicateMatch.distanceMeters}m away
            {:else}
              📝 {duplicateMatch.nameSimilarity}% name match
              ({duplicateMatch.matchedField})
            {/if}
            {#if duplicateMatch.state}
              • {duplicateMatch.state}
            {/if}
            • {duplicateMatch.mediaCount} media files
          </p>
        </div>

        <!-- Action buttons -->
        <div class="flex gap-2 mt-4">
          <button
            class="btn btn-sm variant-filled-primary"
            on:click={() => handleSamePlace(duplicateMatch)}
          >
            This is the same place
          </button>
          <button
            class="btn btn-sm variant-ghost"
            on:click={() => handleDifferentPlace(duplicateMatch)}
          >
            Different place
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
```

### Button Handlers

```typescript
// User confirms it's the same place
async function handleSamePlace(match: DuplicateMatch) {
  // Option 1: Navigate to existing location
  goto(`/location/${match.locationId}`);

  // Option 2: Offer to add the new name as an AKA
  // const addAka = confirm(`Add "${newName}" as an alias for ${match.locnam}?`);
  // if (addAka) {
  //   await window.electronAPI.locations.update(match.locationId, {
  //     akanam: newName
  //   });
  // }
}

// User says it's a different place
async function handleDifferentPlace(match: DuplicateMatch) {
  // Record the exclusion so we don't ask again
  await window.electronAPI.locations.addExclusion(newName, match.locnam);

  // Clear the duplicate panel
  duplicateMatch = null;

  // Allow proceeding with creation
  canProceed = true;
}
```

---

## Backend Architecture

### File Locations

| File | Purpose |
|------|---------|
| `electron/services/location-duplicate-service.ts` | Core detection logic |
| `electron/repositories/sqlite-location-exclusions-repository.ts` | Exclusions storage |
| `electron/main/ipc-handlers/locations.ts` | IPC handlers |
| `electron/services/jaro-winkler-service.ts` | Name similarity + normalization |
| `electron/services/geo-utils.ts` | GPS distance calculation |

### Service Methods

```typescript
// LocationDuplicateService
class LocationDuplicateService {
  // Main check function
  async checkForDuplicate(
    input: { name: string; lat?: number; lng?: number },
    exclusions: ExclusionPair[]
  ): Promise<DuplicateCheckResult>;
}

// SQLiteLocationExclusionsRepository
class SQLiteLocationExclusionsRepository {
  // Add an exclusion
  async addExclusion(nameA: string, nameB: string, decidedBy?: string): Promise<void>;

  // Check if excluded
  async isExcluded(nameA: string, nameB: string): Promise<boolean>;

  // Get all (for passing to duplicate service)
  async getAllExclusions(): Promise<ExclusionPair[]>;

  // Count
  async count(): Promise<number>;
}
```

---

## Name Normalization

Names are normalized before comparison to handle common variations:

```typescript
import { normalizeName } from '../services/jaro-winkler-service';

normalizeName('The Old Mill');        // 'old mill'
normalizeName('St. Mary Hospital');   // 'saint mary hospital'
normalizeName('Mt. Pleasant');        // 'mount pleasant'
normalizeName('ABC Manufacturing Co.'); // 'abc manufacturing company'
```

### Handled Transformations

- **Articles removed:** "The", "A", "An"
- **Abbreviations expanded:**
  - St. → Saint
  - Mt. → Mount
  - Hosp. → Hospital
  - Mfg. → Manufacturing
  - Co. → Company
  - Corp. → Corporation
  - Inc. → Incorporated
  - Ave. → Avenue
  - Blvd. → Boulevard
  - Rd. → Road

---

## Testing the System

### Unit Test Examples

```typescript
import { normalizeName, jaroWinklerSimilarity } from '../services/jaro-winkler-service';
import { haversineDistance } from '../services/geo-utils';

describe('Duplicate Detection', () => {
  describe('Name Normalization', () => {
    it('strips leading articles', () => {
      expect(normalizeName('The Old Mill')).toBe('old mill');
      expect(normalizeName('A Factory')).toBe('factory');
    });

    it('expands abbreviations', () => {
      expect(normalizeName('St. Mary')).toBe('saint mary');
      expect(normalizeName('Mt. Pleasant')).toBe('mount pleasant');
    });
  });

  describe('Name Similarity', () => {
    it('matches similar names', () => {
      const score = jaroWinklerSimilarity('Old River Mill', 'Old Rivers Mill');
      expect(score).toBeGreaterThan(0.9);
    });

    it('catches 50% threshold', () => {
      const score = jaroWinklerSimilarity('Power Plant', 'Plant');
      expect(score).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('GPS Distance', () => {
    it('detects locations within 150m', () => {
      // Two points ~100m apart
      const distance = haversineDistance(42.5, -76.5, 42.5009, -76.5);
      expect(distance).toBeLessThan(150);
    });
  });
});
```

### Manual Testing Checklist

- [ ] Create location with GPS near existing → see GPS match
- [ ] Create location with similar name → see name match
- [ ] Click "Different place" → exclusion saved
- [ ] Retry same pair → no prompt shown
- [ ] Convert ref map point → duplicate check runs
- [ ] Check with no GPS → only name check runs

---

## Constants Configuration

Located in `src/lib/constants.ts`:

```typescript
export const DUPLICATE_CONFIG = {
  GPS_RADIUS_METERS: 150,           // Same site threshold
  NAME_SIMILARITY_THRESHOLD: 0.50,  // 50% Jaro-Winkler
  NEARBY_RADIUS_METERS: 400,        // For "nearby" hints
} as const;
```

To adjust thresholds, modify these values. The service reads from hardcoded values currently, so also update:

- `location-duplicate-service.ts` lines 16-17

---

## Database Schema

### location_exclusions Table

```sql
CREATE TABLE location_exclusions (
  exclusion_id TEXT PRIMARY KEY,  -- UUID
  name_a TEXT NOT NULL,           -- First name (lowercase, sorted)
  name_b TEXT NOT NULL,           -- Second name (lowercase, sorted)
  decided_at TEXT NOT NULL,       -- ISO timestamp
  decided_by TEXT                 -- Username who made decision
);

CREATE INDEX idx_location_exclusions_names ON location_exclusions(name_a, name_b);
```

Names are stored lowercase and alphabetically sorted for consistent lookup in both directions.

---

## Troubleshooting

### Duplicate Not Detected

1. Check if names are too dissimilar (< 50% match)
2. Check if GPS is too far apart (> 150m)
3. Check if exclusion exists in `location_exclusions` table

### False Positives

1. Lower the threshold in constants
2. Add more abbreviation expansions to `normalizeName()`
3. User can click "Different place" to permanently exclude

### Performance

The name check queries all locations. For large archives (10,000+), consider:

1. Adding a name index to the locs table
2. Pre-filtering by state before name comparison
3. Caching normalized names

---

## UI Integration (Complete)

### DuplicateWarningPanel Component

The `DuplicateWarningPanel.svelte` component is the inline warning panel shown when a duplicate is detected:

```svelte
<DuplicateWarningPanel
  proposedName={name.trim()}
  match={duplicateMatch}
  onSamePlace={handleDuplicateSamePlace}
  onDifferentPlace={handleDuplicateDifferentPlace}
  processing={duplicateProcessing}
/>
```

**Location:** `packages/desktop/src/components/DuplicateWarningPanel.svelte`

### Integration Points

1. **ImportModal.svelte** - Main location creation modal
   - Debounced duplicate check on name change (300ms)
   - Shows DuplicateWarningPanel when match found
   - Handles "Same place" → navigates to existing location
   - Handles "Different place" → adds exclusion, clears panel

2. **Atlas.svelte** → **Map.svelte** - Reference point conversion
   - Passes `refPointId` when clicking "Create Location" on ref point
   - Ref point is deleted after successful location creation

3. **import-modal-store.ts** - Stores prefilled data including refPointId

### Ref Point Deletion Flow

When a user converts a reference map point to a location:

```
1. User clicks "Create Location" on ref point popup
2. Map.svelte passes { pointId, name, lat, lng, state } to callback
3. Atlas.svelte opens ImportModal with refPointId in prefilledData
4. ImportModal tracks creatingFromRefPointId
5. On successful location creation, ref point is deleted
6. Original KML/GPX/GeoJSON file is preserved (only point removed)
```

---

## Migration 39: Reference Map Points Deduplication

Migration 39 adds GPS-based deduplication for ref_map_points, handling duplicate pins that exist at the same location (within ~10m precision).

### Schema Changes

```sql
-- New column for alternate names
ALTER TABLE ref_map_points ADD COLUMN aka_names TEXT;

-- Index for faster GPS grouping
CREATE INDEX idx_ref_map_points_gps_rounded
  ON ref_map_points(ROUND(lat, 4), ROUND(lng, 4));
```

### How It Works

1. **GPS Rounding**: Coordinates are rounded to 4 decimal places (~10m precision)
2. **Grouping**: Points at the same rounded GPS are grouped as duplicates
3. **Name Scoring**: Each name is scored based on quality:
   - Longer, more descriptive names score higher
   - Coordinate-style names (e.g., "44.299,-75.959") are penalized
   - Generic names ("house", "building") are penalized
   - Descriptive suffixes ("factory", "hospital", "school") get bonuses
4. **Merging**: The best name becomes primary, others go into `aka_names` (pipe-separated)

### Running Deduplication

#### From the App (IPC)

```typescript
// Preview what would be deduplicated
const preview = await window.electronAPI.refMaps.previewDedup();
console.log('Groups to merge:', preview.stats.duplicateGroups);
console.log('Points to remove:', preview.stats.pointsRemoved);

// Run deduplication
const result = await window.electronAPI.refMaps.deduplicate();
console.log('Removed:', result.stats.pointsRemoved);
console.log('Points with AKA:', result.stats.pointsWithAka);
```

#### From Command Line

```bash
# Uses Python (no native module compilation needed)
python3 scripts/run-dedup.py
```

### Import-Time Deduplication

When importing maps with `skipDuplicates: true`, the system now:
1. Checks new points against existing ref_map_points
2. **Merges names** into existing points' aka_names if duplicate
3. Only inserts truly new points

```typescript
const result = await window.electronAPI.refMaps.importWithOptions(
  '/path/to/map.kml',
  { skipDuplicates: true, importedBy: 'user123' }
);

console.log('Imported:', result.pointCount);
console.log('Merged (names added to existing):', result.mergedCount);
console.log('Skipped (catalogued locations):', result.skippedCount);
```

### Service API

```typescript
// RefMapDedupService methods
class RefMapDedupService {
  // GPS-based dedup within ref_map_points
  findDuplicateGroups(): Promise<DuplicateGroup[]>;
  deduplicate(): Promise<DedupStats>;
  preview(): Promise<{ stats: DedupStats; groups: [...] }>;

  // Import-time helpers
  findExistingPoint(lat, lng, precision?): Promise<ExistingPoint | null>;
  addOrMergePoint(...): Promise<{ pointId: string; merged: boolean }>;

  // Cross-table matching (vs locs)
  findCataloguedRefPoints(): Promise<CataloguedMatch[]>;
  checkForDuplicates(points): Promise<DedupeResult>;
  deleteRefPoints(pointIds): Promise<number>;
}
```

### Name Scoring Algorithm

```typescript
function scoreName(name: string | null): number {
  if (!name) return 0;
  let score = name.length;

  // Penalize coordinate-style names
  if (/^-?\d+\.\d+,-?\d+\.\d+$/.test(name)) score = 1;

  // Penalize short names
  if (name.length < 5) score -= 10;

  // Penalize generic names
  if (/^(house|building|place|location|point|site)$/i.test(name)) score -= 20;

  // Bonus for proper nouns
  score += (name.match(/[A-Z][a-z]+/g) || []).length * 5;

  // Bonus for descriptive suffixes
  ['factory', 'hospital', 'school', 'church', 'mill', 'farm', 'poorhouse']
    .forEach(suffix => { if (name.toLowerCase().includes(suffix)) score += 10; });

  return score;
}
```

---

## Future Enhancements

See ADR for planned features:

1. ~~**Bulk duplicate scan** - Scan existing archive for potential duplicates~~ (Done: Migration 39)
2. **Merge workflow** - Combine two locations into one
3. ~~**Import-time check** - Check during KML/GPX import, not just creation~~ (Done: Migration 39)
4. **Link pin to existing** - Associate ref_map_point with existing location instead of converting
