# Reference Map Import: State-Based Matching Plan

## Problem Statement

"Canal Cars" exists in the database with `state = "NY"` but NO GPS coordinates.
"Canal Cars" is imported from KMZ with GPS coordinates.

**Current behavior:** No match found (query excludes locations without GPS)
**Expected behavior:** Prompt user "Canal Cars (NY) - is this the same place?"

---

## Requirements

### R1: Fix Matching Logic
Match imported points against catalogued locations that have state but no GPS.

### R2: Prompt User for Confirmation
When a state+name match is found, prompt user to confirm before marking as duplicate.

### R3: Hide Mini Map When No GPS
Locations without GPS coordinates should not display a mini map.

---

## Root Cause Analysis

### Bug 1: Query Excludes Locations Without GPS

```typescript
// Line 606-611 - THE QUERY ITSELF filters out locations without GPS!
const locations = await this.db
  .selectFrom('locs')
  .select(['locid', 'locnam', 'gps_lat', 'gps_lng', 'akanam'])
  .where('gps_lat', 'is not', null)    // ← BUG: Excludes Canal Cars!
  .where('gps_lng', 'is not', null)    // ← BUG: Excludes Canal Cars!
  .execute();
```

### Bug 2: Query Doesn't Select State Field

```typescript
.select(['locid', 'locnam', 'gps_lat', 'gps_lng', 'akanam'])
// Missing: 'state' - can't compare states!
```

### Bug 3: No User Confirmation Flow

Current flow auto-marks as duplicate. No user prompt for state-based matches.

### Bug 4: Mini Map Shown for NULL GPS

UI shows mini map component even when location has no coordinates.

---

## Proposed Solution

### Step 1: Fix the Query

**Before:**
```typescript
const locations = await this.db
  .selectFrom('locs')
  .select(['locid', 'locnam', 'gps_lat', 'gps_lng', 'akanam'])
  .where('gps_lat', 'is not', null)
  .where('gps_lng', 'is not', null)
  .execute();
```

**After:**
```typescript
const locations = await this.db
  .selectFrom('locs')
  .select(['locid', 'locnam', 'gps_lat', 'gps_lng', 'akanam', 'state'])
  // Remove WHERE clauses - get ALL locations
  .execute();
```

### Step 2: Add Match Type to Results

Differentiate between GPS matches and state-based matches:

```typescript
interface DuplicateMatch {
  // ... existing fields ...
  matchType: 'gps' | 'name_gps' | 'name_state' | 'exact_name';
  // gps = within 150m
  // name_gps = similar name within 500m
  // name_state = same state + similar name (NEW)
  // exact_name = 99%+ name match, no location data
}
```

### Step 3: Update Loop Logic

```typescript
for (const loc of locations) {
  const locHasGps = loc.gps_lat != null && loc.gps_lng != null;

  if (locHasGps) {
    // EXISTING: GPS-based matching
    const distance = haversineDistance(point.lat, point.lng, loc.gps_lat, loc.gps_lng);

    if (distance <= GPS_RADIUS_METERS) {
      // GPS match - high confidence, auto-flag
      result.cataloguedMatches.push({
        ...matchData,
        matchType: 'gps',
        distanceMeters: Math.round(distance),
      });
    } else if (distance <= NAME_MATCH_RADIUS_METERS && nameSim >= NAME_SIMILARITY_THRESHOLD) {
      // Name + GPS match
      result.cataloguedMatches.push({
        ...matchData,
        matchType: 'name_gps',
        distanceMeters: Math.round(distance),
      });
    }
  } else if (loc.state && point.state) {
    // NEW: State-based matching
    const sameState = normalizeState(point.state) === normalizeState(loc.state);
    if (sameState) {
      const nameSim = jaroWinklerSimilarity(normalizeName(point.name), normalizeName(loc.locnam));
      if (nameSim >= NAME_SIMILARITY_THRESHOLD) {
        result.cataloguedMatches.push({
          ...matchData,
          matchType: 'name_state',  // Requires user confirmation
          nameSimilarity: Math.round(nameSim * 100),
        });
      }
    }
  } else {
    // FALLBACK: No GPS, no state - exact name match only
    const nameSim = jaroWinklerSimilarity(normalizeName(point.name), normalizeName(loc.locnam));
    if (nameSim >= 0.99) {
      result.cataloguedMatches.push({
        ...matchData,
        matchType: 'exact_name',  // Requires user confirmation
        nameSimilarity: Math.round(nameSim * 100),
      });
    }
  }
}
```

### Step 4: UI - User Confirmation for State Matches

In Settings.svelte, differentiate display by match type:

```svelte
{#each importPreview.cataloguedMatches as match}
  <div class="...">
    {#if match.matchType === 'gps'}
      <!-- High confidence - GPS proximity -->
      <span class="text-green-600">GPS Match</span>
      {match.newPointName} matches {match.existingName} ({match.distanceMeters}m)

    {:else if match.matchType === 'name_state'}
      <!-- Needs confirmation - same state, similar name -->
      <span class="text-amber-600">Possible Match</span>
      {match.newPointName} matches {match.existingName}
      ({match.nameSimilarity}%, same state: {match.state})
      <button>Confirm Match</button>
      <button>Different Place</button>

    {:else if match.matchType === 'exact_name'}
      <!-- Needs confirmation - exact name, no location data -->
      <span class="text-amber-600">Name Match</span>
      {match.newPointName} matches {match.existingName} (exact name)
      <button>Confirm Match</button>
      <button>Different Place</button>
    {/if}
  </div>
{/each}
```

### Step 5: Hide Mini Map When No GPS

In location detail/card components:

```svelte
{#if location.gps_lat != null && location.gps_lng != null}
  <MiniMap lat={location.gps_lat} lng={location.gps_lng} />
{:else}
  <!-- No map - location has no GPS -->
  <div class="text-gray-400 text-sm">
    No GPS coordinates - {location.state || 'Unknown location'}
  </div>
{/if}
```

---

## Match Type Confidence Levels

| Match Type | Confidence | User Action | Auto-Skip? |
|------------|------------|-------------|------------|
| `gps` | High | None needed | Yes |
| `name_gps` | Medium-High | None needed | Yes |
| `name_state` | Medium | Confirm/Reject | No - prompt |
| `exact_name` | Low-Medium | Confirm/Reject | No - prompt |

---

## UI Flow for State-Based Matches

```
┌─────────────────────────────────────────────────────────┐
│ Import Reference Map                                     │
│                                                          │
│ Abandoned Places.kmz                                     │
│ Total points: 1463                                       │
│ New points: 850                                          │
│ Already catalogued: 608                                  │
│ Needs review: 5                                          │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Needs Review (same state, similar name)             │ │
│ │                                                     │ │
│ │ Canal Cars (imported) ↔ Canal Cars (NY, no GPS)    │ │
│ │ [Same Place] [Different Place]                      │ │
│ │                                                     │ │
│ │ Old Mill (imported) ↔ Old Mill Inn (NY, no GPS)    │ │
│ │ [Same Place] [Different Place]                      │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ [Skip duplicates] [Import all] [Review & Import]         │
└─────────────────────────────────────────────────────────┘
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `ref-map-dedup-service.ts` | Fix query, add state matching, add matchType |
| `Settings.svelte` | Add user confirmation UI for state matches |
| `LocationCard.svelte` | Hide mini map when no GPS |
| `LocationDetail.svelte` | Hide mini map when no GPS |
| `LocationMapSection.svelte` | Conditional rendering for null GPS |

---

## Verification Checklist

| Test Case | Expected |
|-----------|----------|
| "Canal Cars" (state: NY, no GPS) vs "Canal Cars" (GPS in NY) | MATCH - prompt user |
| "Canal Cars" (state: NY, no GPS) vs "Canal Cars" (GPS in PA) | NO MATCH - different state |
| User confirms match | Mark as duplicate, skip import |
| User rejects match | Import as new point |
| Location with no GPS | Mini map hidden |
| Location with GPS | Mini map shown |

---

## Plan Status: IMPLEMENTED

Requirements covered:
- [x] R1: Fix matching logic for state-only locations
- [x] R2: Prompt user for state+name matches
- [x] R3: Hide mini map when no GPS

**Implementation completed: 2025-11-30**

Commit: `3a10a09` - feat(refmap): implement state-based matching for locations without GPS
