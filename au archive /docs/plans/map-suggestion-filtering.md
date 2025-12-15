# Map Suggestion Filtering Plan

**Feature**: Clean up reference map suggestions to remove low-quality/non-descriptive entries
**Status**: DRAFT - Awaiting Approval
**Created**: 2025-12-14

---

## Problem Statement

Reference map suggestions (from imported KML/GPX files) contain many non-descriptive 1-3 word entries that dilute real results:

**Actual data from your maps shows:**
- "House" appears **88 times**
- "House - CNY" appears **31 times**
- "Industry" appears **27 times**
- "Industrial - CNY" appears **14 times**
- "House - Fingerlakes" appears **14 times**
- Dozens more generic patterns

These are Google Maps/Street View pins without real documentation. They should not appear as suggestions.

---

## Data Analysis (From Your KMZ/KML Files)

### Pattern Categories Found

| Category | Count | Examples |
|----------|-------|----------|
| **Single generic word** | 88+ | "House", "Industry", "Church", "Cars", "Mill", "Motel", "Quarry" |
| **Generic + Region** | 70+ | "House - CNY", "Industrial - Buffalo", "Church - Fingerlakes", "Farm - CNY" |
| **Generic + Question** | 12+ | "House?", "School?", "Farm?", "Power Plant?", "Mill?" |
| **Point + Number** | 30+ | "Point 155", "Point 11", "Point 260", "Point 9" |
| **School + Number** | 3+ | "School 75", "School 70", "School 58" |
| **Coordinate strings** | 5+ | "43.259692, -79.052930", "4RR6+2R", "22CR+9G" |
| **Off-topic** | 10+ | "Off Road Trails", "Off-Road Trails", "Untitled layer", "Random Shite" |

### Region/City Words (Combined with Generic = Filtered)

**Abbreviations**: CNY, WNY, NNY, ENY, PA, NY, IN

**Cities/Regions**: Buffalo, Syracuse, Rochester, Binghamton, Albany, Fingerlakes, Pittsburgh, Sayre, Elmira, Waterloo, Lockport, Cortland, Maine, Ohio

---

## Filter Rules (1-3 Word Names Only)

### EXCLUDE if name matches ANY of these:

| Rule | Pattern | Examples Filtered |
|------|---------|-------------------|
| **Single generic word** | 1 word in GENERIC_NAMES | "House", "Church", "Industry", "Cars", "Mill" |
| **Generic + region** | `[generic] + [region]` in any order | "House - CNY", "Industrial - Buffalo", "Buffalo Church", "Syracuse School" |
| **Generic with question** | ends with `?` and ≤3 words | "House?", "School?", "Power Plant?" |
| **Point + number** | `Point \d+`, `Site \d+`, etc. | "Point 155", "Site 12", "Marker 5" |
| **Coordinate string** | lat/lng or plus code | "43.259, -79.05", "4RR6+2R" |
| **Off-topic trails** | contains "trail" | "Off Road Trails", "Off-Road Trails" |
| **Plural generic** | "Houses", "Cars", "Schools", "Churches" | "Houses", "Cars" |

### KEEP (even with generic words):

| Pattern | Examples | Why Keep |
|---------|----------|----------|
| **Named + type** | "Wurtz Funeral Home", "Vista Heights Inn" | Has proper name |
| **Specific place** | "Baxters Diner", "Grossingers Resort" | Documented location |
| **Historic name** | "Old Stone Church", "First National Bank" | Meaningful context |
| **4+ words** | "JN Adams Memorial Hospital", "Willard Asylum for the Chronic Insane" | Descriptive enough |

---

## Implementation

### New Function: `shouldExcludeFromSuggestions(name: string)`

```typescript
// Generic words that alone are not useful
const GENERIC_WORDS = new Set([
  'house', 'houses', 'church', 'churches', 'school', 'schools',
  'factory', 'industrial', 'industry', 'building', 'farm', 'farms',
  'barn', 'mill', 'warehouse', 'store', 'shop', 'hotel', 'motel',
  'hospital', 'office', 'station', 'tower', 'plant', 'center',
  'site', 'place', 'location', 'point', 'cars', 'trains', 'trucks',
  'quarry', 'cabin', 'greenhouse', 'theater', 'trails'
]);

// Region/city names that when combined with generic = placeholder
const REGION_WORDS = new Set([
  // Abbreviations
  'cny', 'wny', 'nny', 'eny', 'pa', 'ny', 'in',
  // Cities/regions from your map data
  'fingerlakes', 'buffalo', 'syracuse', 'rochester', 'binghamton',
  'pittsburgh', 'albany', 'sayre', 'elmira', 'waterloo', 'lockport',
  'cortland', 'maine', 'ohio'
]);

function shouldExcludeFromSuggestions(name: string): boolean {
  if (!name) return true;

  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  const words = tokenize(trimmed); // splits on whitespace/punctuation

  // Only filter 1-3 word names
  if (words.length > 3) return false;

  // Single generic word: "House", "Church"
  if (words.length === 1 && GENERIC_WORDS.has(lower)) return true;

  // Generic with question mark: "House?", "School?"
  if (trimmed.endsWith('?') && words.length <= 2) {
    const base = words[0];
    if (GENERIC_WORDS.has(base)) return true;
  }

  // Generic + region in ANY order: "House - CNY", "Buffalo Church", "Syracuse School"
  if (words.length >= 2 && words.length <= 3) {
    const hasGeneric = words.some(w => GENERIC_WORDS.has(w));
    const hasRegion = words.some(w => REGION_WORDS.has(w));
    if (hasGeneric && hasRegion) return true;
  }

  // Point/Location/Site/Marker + number: "Point 155" (but NOT "School 75" - real names!)
  if (/^(point|location|site|marker)\s*\d+$/i.test(trimmed)) return true;

  // Coordinate patterns: "43.259, -79.05" or plus codes "4RR6+2R"
  if (/^-?\d+\.\d+,?\s*-?\d+\.\d+$/.test(trimmed)) return true;
  if (/^[A-Z0-9]{4,}\+[A-Z0-9]+$/i.test(trimmed)) return true;

  // Off-topic trails
  if (/trail/i.test(trimmed)) return true;

  // Plural generics alone: "Houses", "Cars"
  if (words.length === 1 && GENERIC_WORDS.has(lower.replace(/s$/, ''))) return true;

  return false;
}
```

### Integration Point

**File**: `packages/desktop/electron/services/ref-map-matcher-service.ts`

```typescript
for (const point of points) {
  if (!point.name) continue;

  // Skip non-descriptive names from suggestions
  if (shouldExcludeFromSuggestions(point.name)) continue;

  // ... existing scoring logic
}
```

---

## What Gets Filtered (From Your Actual Data)

| Name | Word Count | Action | Rule |
|------|------------|--------|------|
| "House" | 1 | ❌ EXCLUDE | Single generic |
| "Industry" | 1 | ❌ EXCLUDE | Single generic |
| "Church" | 1 | ❌ EXCLUDE | Single generic |
| "Cars" | 1 | ❌ EXCLUDE | Single generic |
| "Houses" | 1 | ❌ EXCLUDE | Plural generic |
| "House - CNY" | 2 | ❌ EXCLUDE | Generic + region |
| "Industrial - Buffalo" | 2 | ❌ EXCLUDE | Generic + region |
| "Buffalo Church" | 2 | ❌ EXCLUDE | Generic + region |
| "Syracuse School" | 2 | ❌ EXCLUDE | Generic + region |
| "Church - Fingerlakes" | 2 | ❌ EXCLUDE | Generic + region |
| "Farm - CNY" | 2 | ❌ EXCLUDE | Generic + region |
| "House?" | 1 | ❌ EXCLUDE | Generic + question |
| "School?" | 1 | ❌ EXCLUDE | Generic + question |
| "Power Plant?" | 2 | ❌ EXCLUDE | Generic + question |
| "Point 155" | 2 | ❌ EXCLUDE | Point + number |
| **"School 75"** | 2 | ✅ KEEP | Real school name |
| "43.259692, -79.052930" | 2 | ❌ EXCLUDE | Coordinate |
| "4RR6+2R" | 1 | ❌ EXCLUDE | Plus code |
| "Off Road Trails" | 3 | ❌ EXCLUDE | Contains "trail" |
| **"Wurtz Funeral Home"** | 3 | ✅ KEEP | Has proper name |
| **"Vista Heights Inn"** | 3 | ✅ KEEP | Has proper name |
| **"Grossingers Resort"** | 2 | ✅ KEEP | Has proper name (not generic + region) |
| **"St. Marys"** | 2 | ✅ KEEP | Named location |
| **"Baxters Diner"** | 2 | ✅ KEEP | Has proper name |

---

## Estimated Impact

Based on your data:
- ~200+ entries filtered (non-descriptive)
- ~800+ entries kept (real names)
- **~20% reduction** in noise suggestions

---

## Files Modified

1. `packages/desktop/electron/services/token-set-service.ts` - Add filter function + constants
2. `packages/desktop/electron/services/ref-map-matcher-service.ts` - Apply filter in `findMatches()`

---

## Approval Checklist

- [ ] Filter rules look correct based on your data
- [ ] "Buffalo Church" correctly EXCLUDED (generic + region)
- [ ] Ready to implement
