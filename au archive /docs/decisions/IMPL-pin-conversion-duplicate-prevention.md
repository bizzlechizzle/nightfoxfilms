# Implementation Plan: Pin-to-Location Conversion & Duplicate Prevention

**ADR Reference:** ADR-pin-conversion-duplicate-prevention.md
**Date:** 2025-11-30
**Status:** Implementation Ready

---

## Audit Report

### CLAUDE.md Compliance ✓

| Rule | Status | Notes |
|------|--------|-------|
| Scope Discipline | ✓ | Only implementing approved ADR features |
| Archive-First | ✓ | Prevents duplicate entries, maintains data integrity |
| Offline-First | ✓ | All processing local, no network calls |
| Keep It Simple | ✓ | Reuses existing geo-utils, jaro-winkler services |
| No AI in Docs | ✓ | No AI mentions in implementation |
| Migration pattern | ✓ | Inline migration in database.ts (matches existing) |
| IPC naming | ✓ | `location:checkDuplicateByNameAndGps` format |
| Preload CommonJS | ✓ | Will use `require('electron')` pattern |

### ADR Alignment ✓

| Requirement | ADR | Implementation |
|-------------|-----|----------------|
| GPS threshold | 150m | ✓ 150m |
| Name threshold | ≥50% | ✓ 0.50 |
| Panel style | Inline | ✓ Inline expansion |
| Remember decisions | Yes | ✓ location_exclusions table |
| Post-conversion | Delete point | ✓ deletePoint() method |
| Name fields | locnam, akanam, historicalName | ✓ All three checked |

### Architecture Alignment ✓

| Component | Location | Pattern |
|-----------|----------|---------|
| Duplicate Service | electron/services/ | ✓ Service pattern |
| Exclusions Repo | electron/repositories/ | ✓ Repository pattern |
| IPC Handlers | electron/main/ipc-handlers/ | ✓ Handler pattern |
| Constants | src/lib/constants.ts | ✓ Centralized config |
| Migration | database.ts runMigrations() | ✓ Inline migration |

---

## Executive Summary

This implementation adds a safety net to prevent duplicate locations in the archive. When creating a location (from any source), the system checks:
1. **GPS proximity**: Is there an existing location within 150 meters?
2. **Name similarity**: Is there a name match ≥50% (Jaro-Winkler)?

If a match is found, the user sees an inline panel to decide: "Same place" or "Different place". The system remembers "different" decisions to avoid re-prompting.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         RENDERER                                 │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │ LocationCreate  │    │   Map.svelte    │                     │
│  │    Form.svelte  │    │  (pin click)    │                     │
│  └────────┬────────┘    └────────┬────────┘                     │
│           │                      │                               │
│           └──────────┬───────────┘                               │
│                      ▼                                           │
│           ┌──────────────────┐                                   │
│           │  Preload Bridge  │                                   │
│           │  location:*      │                                   │
│           └────────┬─────────┘                                   │
└────────────────────┼────────────────────────────────────────────┘
                     │ IPC
┌────────────────────┼────────────────────────────────────────────┐
│                    ▼           MAIN PROCESS                      │
│           ┌──────────────────┐                                   │
│           │  IPC Handlers    │                                   │
│           │  locations.ts    │                                   │
│           └────────┬─────────┘                                   │
│                    │                                             │
│    ┌───────────────┼───────────────┐                            │
│    ▼               ▼               ▼                            │
│ ┌────────┐  ┌─────────────┐  ┌──────────────┐                   │
│ │Location│  │  Duplicate  │  │  Exclusions  │                   │
│ │  Repo  │  │   Service   │  │    Repo      │                   │
│ └────────┘  └─────────────┘  └──────────────┘                   │
│                    │                                             │
│    ┌───────────────┼───────────────┐                            │
│    ▼               ▼               ▼                            │
│ ┌────────┐  ┌─────────────┐  ┌──────────────┐                   │
│ │geo-    │  │jaro-winkler │  │   SQLite     │                   │
│ │utils.ts│  │-service.ts  │  │  Database    │                   │
│ └────────┘  └─────────────┘  └──────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Duplicate Check Service

### File: `packages/desktop/electron/services/location-duplicate-service.ts`

**Purpose:** Core service for checking if a new location matches an existing one.

**Dependencies:**
- `geo-utils.ts` — haversineDistance, getBoundingBox
- `jaro-winkler-service.ts` — jaroWinklerSimilarity
- Database access via Kysely

**Interface:**

```typescript
// Input for duplicate check
interface DuplicateCheckInput {
  name: string;
  lat?: number | null;
  lng?: number | null;
}

// Result of duplicate check
interface DuplicateCheckResult {
  hasDuplicate: boolean;
  match?: DuplicateMatch;
}

interface DuplicateMatch {
  locationId: string;
  locnam: string;
  akanam: string | null;
  historicalName: string | null;
  state: string | null;
  matchType: 'gps' | 'name';
  distanceMeters?: number;
  nameSimilarity?: number;
  matchedField?: 'locnam' | 'akanam' | 'historicalName';
  mediaCount: number;
}
```

**Algorithm:**

```typescript
async function checkForDuplicate(
  input: DuplicateCheckInput,
  excludedPairs?: ExcludedPair[]
): Promise<DuplicateCheckResult> {

  // 1. GPS CHECK (if coordinates provided)
  if (input.lat != null && input.lng != null) {
    const bbox = getBoundingBox(input.lat, input.lng, GPS_RADIUS);
    const nearbyLocations = await queryLocationsInBoundingBox(bbox);

    for (const loc of nearbyLocations) {
      const distance = haversineDistance(input.lat, input.lng, loc.gps_lat, loc.gps_lng);
      if (distance <= GPS_RADIUS) {
        // Check if this pair was previously marked "different"
        if (isExcluded(input.name, loc.locnam, excludedPairs)) continue;

        return {
          hasDuplicate: true,
          match: {
            locationId: loc.locid,
            locnam: loc.locnam,
            akanam: loc.akanam,
            historicalName: loc.historical_name,
            state: loc.state,
            matchType: 'gps',
            distanceMeters: Math.round(distance),
            mediaCount: await getMediaCount(loc.locid),
          }
        };
      }
    }
  }

  // 2. NAME CHECK (always runs)
  const normalizedInput = normalizeName(input.name);
  const allLocations = await queryAllLocationsWithNames();

  for (const loc of allLocations) {
    // Check against locnam, akanam, historicalName
    const namesToCheck = [
      { field: 'locnam', value: loc.locnam },
      { field: 'akanam', value: loc.akanam },
      { field: 'historicalName', value: loc.historical_name },
    ].filter(n => n.value);

    for (const { field, value } of namesToCheck) {
      const similarity = jaroWinklerSimilarity(normalizedInput, normalizeName(value));

      if (similarity >= NAME_THRESHOLD) {
        // Check if this pair was previously marked "different"
        if (isExcluded(input.name, value, excludedPairs)) continue;

        return {
          hasDuplicate: true,
          match: {
            locationId: loc.locid,
            locnam: loc.locnam,
            akanam: loc.akanam,
            historicalName: loc.historical_name,
            state: loc.state,
            matchType: 'name',
            nameSimilarity: Math.round(similarity * 100),
            matchedField: field,
            mediaCount: await getMediaCount(loc.locid),
          }
        };
      }
    }
  }

  // 3. NO MATCH
  return { hasDuplicate: false };
}
```

**Name Normalization:**

```typescript
function normalizeName(name: string): string {
  let normalized = name.toLowerCase().trim();

  // Strip leading articles
  normalized = normalized.replace(/^(the|a|an)\s+/i, '');

  // Expand common abbreviations
  const abbreviations: Record<string, string> = {
    'st.': 'saint',
    'st ': 'saint ',
    'mt.': 'mount',
    'mt ': 'mount ',
    'hosp.': 'hospital',
    'hosp ': 'hospital ',
    'mfg.': 'manufacturing',
    'mfg ': 'manufacturing ',
    'co.': 'company',
    'co ': 'company ',
  };

  for (const [abbr, full] of Object.entries(abbreviations)) {
    normalized = normalized.replace(new RegExp(abbr, 'gi'), full);
  }

  return normalized;
}
```

---

## Phase 2: Location Exclusions Table

### File: `packages/desktop/electron/main/database.ts`

**Add Migration 38:**

```typescript
// Migration 38: Create location_exclusions table for "different place" decisions
const locationExclusionsExists = sqlite.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='location_exclusions'"
).get();

if (!locationExclusionsExists) {
  console.log('Running migration 38: Creating location_exclusions table');

  sqlite.exec(`
    -- Stores user decisions that two names refer to different places
    -- Prevents re-prompting for the same pair
    CREATE TABLE location_exclusions (
      exclusion_id TEXT PRIMARY KEY,
      name_a TEXT NOT NULL,
      name_b TEXT NOT NULL,
      decided_at TEXT NOT NULL,
      decided_by TEXT
    );

    -- Index for efficient lookup (both directions)
    CREATE INDEX idx_location_exclusions_names ON location_exclusions(name_a, name_b);
  `);

  console.log('Migration 38 completed: location_exclusions table created');
}
```

### File: `packages/desktop/electron/main/database.types.ts`

**Add TypeScript types:**

```typescript
export interface LocationExclusion {
  exclusion_id: string;
  name_a: string;
  name_b: string;
  decided_at: string;
  decided_by: string | null;
}
```

### File: `packages/desktop/electron/repositories/sqlite-location-exclusions-repository.ts`

**New repository:**

```typescript
import { v4 as uuidv4 } from 'uuid';
import type { Kysely } from 'kysely';
import type { Database } from '../main/database';

export class SQLiteLocationExclusionsRepository {
  constructor(private db: Kysely<Database>) {}

  async addExclusion(nameA: string, nameB: string, decidedBy?: string): Promise<void> {
    // Normalize order for consistent lookup
    const [first, second] = [nameA.toLowerCase(), nameB.toLowerCase()].sort();

    await this.db.insertInto('location_exclusions').values({
      exclusion_id: uuidv4(),
      name_a: first,
      name_b: second,
      decided_at: new Date().toISOString(),
      decided_by: decidedBy || null,
    }).execute();
  }

  async isExcluded(nameA: string, nameB: string): Promise<boolean> {
    const [first, second] = [nameA.toLowerCase(), nameB.toLowerCase()].sort();

    const result = await this.db
      .selectFrom('location_exclusions')
      .select('exclusion_id')
      .where('name_a', '=', first)
      .where('name_b', '=', second)
      .executeTakeFirst();

    return !!result;
  }

  async getAllExclusions(): Promise<Array<{ nameA: string; nameB: string }>> {
    const results = await this.db
      .selectFrom('location_exclusions')
      .select(['name_a', 'name_b'])
      .execute();

    return results.map(r => ({ nameA: r.name_a, nameB: r.name_b }));
  }
}
```

---

## Phase 3: IPC Handler Updates

### File: `packages/desktop/electron/main/ipc-handlers/locations.ts`

**Add new handlers:**

```typescript
import { LocationDuplicateService } from '../../services/location-duplicate-service';
import { SQLiteLocationExclusionsRepository } from '../../repositories/sqlite-location-exclusions-repository';

// In registerLocationHandlers():
const duplicateService = new LocationDuplicateService(db);
const exclusionsRepo = new SQLiteLocationExclusionsRepository(db);

/**
 * Check for duplicate locations before creation
 * Returns match info if duplicate found, null otherwise
 */
ipcMain.handle('location:checkDuplicateByNameAndGps', async (_event, input: unknown) => {
  try {
    const InputSchema = z.object({
      name: z.string().min(1),
      lat: z.number().nullable().optional(),
      lng: z.number().nullable().optional(),
    });

    const validatedInput = InputSchema.parse(input);

    // Get all exclusions for filtering
    const exclusions = await exclusionsRepo.getAllExclusions();

    return await duplicateService.checkForDuplicate(validatedInput, exclusions);
  } catch (error) {
    console.error('Error checking for duplicates:', error);
    if (error instanceof z.ZodError) {
      throw new Error(`Validation error: ${error.errors.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
});

/**
 * Record that two names refer to different places
 * Prevents future duplicate prompts for this pair
 */
ipcMain.handle('location:addExclusion', async (_event, nameA: unknown, nameB: unknown) => {
  try {
    const validatedNameA = z.string().min(1).parse(nameA);
    const validatedNameB = z.string().min(1).parse(nameB);

    const currentUser = await getCurrentUser(db);
    await exclusionsRepo.addExclusion(validatedNameA, validatedNameB, currentUser?.username);

    return { success: true };
  } catch (error) {
    console.error('Error adding exclusion:', error);
    throw error;
  }
});
```

### File: `packages/desktop/electron/preload/index.ts`

**Add preload bridge:**

```typescript
// Add to contextBridge.exposeInMainWorld('api', { ... }):

checkDuplicateByNameAndGps: (input: { name: string; lat?: number | null; lng?: number | null }) =>
  ipcRenderer.invoke('location:checkDuplicateByNameAndGps', input),

addLocationExclusion: (nameA: string, nameB: string) =>
  ipcRenderer.invoke('location:addExclusion', nameA, nameB),
```

---

## Phase 4: Jaro-Winkler Name Normalization

### File: `packages/desktop/electron/services/jaro-winkler-service.ts`

**Add normalization export:**

```typescript
/**
 * Normalize a name for comparison
 * - Lowercase
 * - Strip leading articles (The, A, An)
 * - Expand common abbreviations
 */
export function normalizeName(name: string): string {
  if (!name) return '';

  let normalized = name.toLowerCase().trim();

  // Strip leading articles
  normalized = normalized.replace(/^(the|a|an)\s+/i, '');

  // Expand abbreviations (order matters - longer patterns first)
  const abbreviations: [RegExp, string][] = [
    [/\bst\.\s*/gi, 'saint '],
    [/\bmt\.\s*/gi, 'mount '],
    [/\bhosp\.\s*/gi, 'hospital '],
    [/\bmfg\.\s*/gi, 'manufacturing '],
    [/\bco\.\s*/gi, 'company '],
    [/\bcorp\.\s*/gi, 'corporation '],
    [/\binc\.\s*/gi, 'incorporated '],
    [/\bave\.\s*/gi, 'avenue '],
    [/\bblvd\.\s*/gi, 'boulevard '],
    [/\brd\.\s*/gi, 'road '],
  ];

  for (const [pattern, replacement] of abbreviations) {
    normalized = normalized.replace(pattern, replacement);
  }

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Compare two names with normalization
 */
export function normalizedSimilarity(name1: string, name2: string): number {
  return jaroWinklerSimilarity(normalizeName(name1), normalizeName(name2));
}
```

---

## Phase 5: Constants Update

### File: `packages/desktop/src/lib/constants.ts`

**Add duplicate detection constants:**

```typescript
// Duplicate Detection Configuration
export const DUPLICATE_CONFIG = {
  GPS_RADIUS_METERS: 150,        // Same site threshold
  NAME_SIMILARITY_THRESHOLD: 0.50, // 50% - prompt user to decide
  NEARBY_RADIUS_METERS: 400,     // ~0.25 miles - show "nearby" hint
} as const;
```

---

## Phase 6: Ref Map Point Deletion

### File: `packages/desktop/electron/repositories/sqlite-ref-maps-repository.ts`

**Add deletion method (if not exists):**

```typescript
/**
 * Delete a single ref_map_point after conversion to location
 * Original map file (ref_maps) is preserved
 */
async deletePoint(pointId: string): Promise<void> {
  await this.db
    .deleteFrom('ref_map_points')
    .where('point_id', '=', pointId)
    .execute();

  console.log(`[RefMaps] Deleted ref_map_point: ${pointId}`);
}
```

### File: `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

**Add IPC handler:**

```typescript
ipcMain.handle('refmap:deletePoint', async (_event, pointId: unknown) => {
  try {
    const validatedId = z.string().uuid().parse(pointId);
    await refMapsRepo.deletePoint(validatedId);
    return { success: true };
  } catch (error) {
    console.error('Error deleting ref map point:', error);
    throw error;
  }
});
```

---

## Phase 7: UI Components (Overview)

### Inline Duplicate Panel

When duplicate detected, show inline expansion in the location form:

```svelte
{#if duplicateMatch}
  <div class="duplicate-panel border-l-4 border-warning bg-warning/10 p-4 rounded">
    <div class="flex items-start gap-3">
      <span class="text-warning text-xl">⚠️</span>
      <div class="flex-1">
        <p class="font-semibold">Possible duplicate found</p>
        <p class="text-sm text-muted mt-1">
          You're creating: <strong>{newName}</strong>
        </p>
        <div class="mt-3 p-3 bg-surface rounded">
          <p class="font-medium">{duplicateMatch.locnam}</p>
          {#if duplicateMatch.akanam}
            <p class="text-sm text-muted">AKA: {duplicateMatch.akanam}</p>
          {/if}
          <p class="text-sm text-muted">
            {#if duplicateMatch.matchType === 'gps'}
              📍 {duplicateMatch.distanceMeters}m away
            {:else}
              📝 {duplicateMatch.nameSimilarity}% name match ({duplicateMatch.matchedField})
            {/if}
            {#if duplicateMatch.state} • {duplicateMatch.state}{/if}
            • {duplicateMatch.mediaCount} media files
          </p>
        </div>
        <div class="flex gap-2 mt-4">
          <button class="btn btn-sm variant-filled-primary" on:click={handleSamePlace}>
            This is the same place
          </button>
          <button class="btn btn-sm variant-ghost" on:click={handleDifferentPlace}>
            Different place
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
```

### Map Pin Differentiation

In Map.svelte, differentiate ref_map_points from locations:

```typescript
// When creating marker icon
function getMarkerIcon(source: 'location' | 'refmap'): L.DivIcon {
  const isConverted = source === 'location';

  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div class="marker-pin ${isConverted ? 'converted' : 'unconverted'}">
        <svg viewBox="0 0 24 24" width="24" height="24">
          ${isConverted
            ? '<circle cx="12" cy="12" r="8" fill="#b9975c" stroke="#fff" stroke-width="2"/>'
            : '<circle cx="12" cy="12" r="8" fill="none" stroke="#b9975c" stroke-width="2" stroke-dasharray="4,2"/>'
          }
        </svg>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}
```

---

## File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `electron/services/location-duplicate-service.ts` | **NEW** | Core duplicate detection logic |
| `electron/repositories/sqlite-location-exclusions-repository.ts` | **NEW** | Exclusions CRUD |
| `electron/main/database.ts` | MODIFY | Add migration 38 for exclusions table |
| `electron/main/database.types.ts` | MODIFY | Add LocationExclusion type |
| `electron/main/ipc-handlers/locations.ts` | MODIFY | Add checkDuplicateByNameAndGps, addExclusion handlers |
| `electron/main/ipc-handlers/ref-maps.ts` | MODIFY | Add deletePoint handler |
| `electron/preload/index.ts` | MODIFY | Add preload bridge methods |
| `electron/services/jaro-winkler-service.ts` | MODIFY | Add normalizeName, normalizedSimilarity |
| `electron/repositories/sqlite-ref-maps-repository.ts` | MODIFY | Add deletePoint method |
| `src/lib/constants.ts` | MODIFY | Add DUPLICATE_CONFIG |
| `src/components/Map.svelte` | MODIFY | Differentiate pin icons |
| `src/components/location/` | MODIFY | Add inline duplicate panel |

---

## Testing Checklist

### Unit Tests

- [ ] `normalizeName()` strips articles correctly
- [ ] `normalizeName()` expands abbreviations
- [ ] `jaroWinklerSimilarity()` with normalized names
- [ ] `haversineDistance()` at 150m boundary
- [ ] `getBoundingBox()` coverage

### Integration Tests

- [ ] Duplicate check finds GPS match within 150m
- [ ] Duplicate check finds name match ≥50%
- [ ] Exclusions prevent re-prompting
- [ ] Ref point deletion after conversion
- [ ] IPC round-trip for all new handlers

### Manual Tests

- [ ] Create location near existing → see duplicate panel
- [ ] Click "Different place" → exclusion saved, can create
- [ ] Click "Same place" → redirected to existing location
- [ ] Convert ref_map_point → point deleted, location created
- [ ] Map shows hollow pins for unconverted, solid for locations

---

## Rollback Plan

If issues arise:
1. Migration 38 can be dropped: `DROP TABLE location_exclusions;`
2. New service/repository files can be deleted
3. IPC handlers can be removed from locations.ts
4. Constants can be removed from constants.ts
5. No existing data is modified by this implementation
