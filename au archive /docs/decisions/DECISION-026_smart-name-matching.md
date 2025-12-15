# DECISION-026: Smart Name Matching with Word-Overlap Boost

**Date**: 2024-12-01
**Status**: Implemented
**Category**: Duplicate Detection / Import Intelligence

## Context

During reference map imports, locations with variant names were not being matched as duplicates. For example:
- "Chevy Biscayne" vs "Chevrolet Biscayne" (86% similarity, below 92% threshold)
- "Smith Bros Factory" vs "Smith Brothers Factory"
- "GE Turbine Plant" vs "General Electric Turbine Plant"

These are clearly the same locations but the Jaro-Winkler similarity algorithm couldn't recognize them because:
1. The threshold was too high (92% in some places, 85% in others)
2. No alias expansion for common abbreviations (Chevy→Chevrolet, Bros→Brothers)
3. No recognition of shared exact words indicating likely match

## Decision

Implement a three-part solution:

### 1. Comprehensive Alias Dictionary (~280 expansions)

Expand abbreviations and brand names during normalization:

| Category | Examples |
|----------|----------|
| Educational | elem→elementary, hs→high school, univ→university |
| Medical/Care | hosp→hospital, san→sanatorium, tb hospital→tuberculosis sanatorium |
| Industrial | mfg→manufacturing, plt→plant, wks→works |
| Mining | colliery→coal mine, breaker→coal breaker |
| Power/Utilities | pwr→power, hydro→hydroelectric |
| Religious | ch→church, cem→cemetery |
| Commercial/Civic | htl→hotel, thtr→theater |
| Automotive | chevy→chevrolet, olds→oldsmobile, prr→pennsylvania railroad |
| Corporate | ge→general electric, rca→radio corporation america |
| Railroad | rr→railroad, prr→pennsylvania railroad |
| Compass | n→north, sw→southwest |
| Geographic | mt→mount, crk→creek, hts→heights |

### 2. Word-Overlap Boost Algorithm

When comparing two names, if they share exact words after normalization, lower the threshold:

```
"Chevy Biscayne" vs "Chevrolet Biscayne"

After normalization:
  "chevrolet biscayne" vs "chevrolet biscayne" → 100% match

With word-overlap boost:
  - Shared words: [chevrolet, biscayne]
  - Overlap ratio: 2/2 = 100%
  - Boost applied: threshold lowered from 85% to 75%
```

### 3. Unified Threshold

Centralize all similarity thresholds to use `DUPLICATE_CONFIG.NAME_SIMILARITY_THRESHOLD` (0.85):

| File | Before | After |
|------|--------|-------|
| ref-map-matcher-service.ts | 0.92 (hardcoded) | DUPLICATE_CONFIG (0.85) |
| ImportModal.svelte | 0.92 (hardcoded) | DUPLICATE_CONFIG (0.85) |
| ref-map-dedup-service.ts | 0.85 | 0.85 (unchanged) |
| jaro-winkler-service.ts | 0.92 (default) | DUPLICATE_CONFIG (0.85) |

## Implementation

### Files Modified

1. **`packages/desktop/electron/services/jaro-winkler-service.ts`**
   - Added `MULTI_WORD_ALIASES` array (~110 entries)
   - Added `SINGLE_WORD_ALIASES` object (~200 entries)
   - Enhanced `normalizeName()` to apply alias expansion
   - Added `calculateWordOverlap()` function
   - Added `getAdjustedThreshold()` function
   - Added `isSmartMatch()` function (recommended for duplicate detection)
   - Added `getMatchDetails()` function (debugging)

2. **`packages/desktop/electron/services/ref-map-matcher-service.ts`**
   - Import threshold from `DUPLICATE_CONFIG`
   - Use `normalizedSimilarity()` and `isSmartMatch()` for matching

3. **`packages/desktop/src/components/ImportModal.svelte`**
   - Import threshold from `DUPLICATE_CONFIG`

4. **`packages/desktop/electron/services/ref-map-dedup-service.ts`**
   - Use `normalizedSimilarity()` instead of raw Jaro-Winkler
   - Use `isSmartMatch()` for threshold checks

## Test Results

All test cases pass:

| Name 1 | Name 2 | Similarity | Result |
|--------|--------|------------|--------|
| Chevy Biscayne | Chevrolet Biscayne | 100% | MATCH |
| Smith Bros Factory | Smith Brothers Factory | 100% | MATCH |
| GE Turbine Plant | General Electric Turbine Plant | 100% | MATCH |
| State TB Hospital | State Tuberculosis Sanatorium | 100% | MATCH |
| Old Stone Mill | Stone Mill | 80.5% | MATCH (boosted) |
| Acme Mfg Co | Acme Manufacturing Company | 100% | MATCH |
| PRR Freight Depot | Pennsylvania Railroad Freight Depot | 100% | MATCH |
| St Mary's Hosp | Saint Mary's Hospital | 82.4% | MATCH (boosted) |
| N Main St School | North Main Street School | 96.7% | MATCH |
| County Poorhouse | County Poor House | 100% | MATCH |

## API Changes

### New Exports from `jaro-winkler-service.ts`

```typescript
// Recommended for duplicate detection
isSmartMatch(name1: string, name2: string, threshold?: number): boolean

// Get similarity score with normalization
normalizedSimilarity(name1: string, name2: string): number

// Calculate word overlap statistics
calculateWordOverlap(name1: string, name2: string): {
  exactMatches: string[];
  overlapRatio: number;
  totalUniqueWords: number;
  shouldBoost: boolean;
}

// Get adjusted threshold based on word overlap
getAdjustedThreshold(name1: string, name2: string, baseThreshold?: number): number

// Full match details for debugging
getMatchDetails(name1: string, name2: string, baseThreshold?: number): MatchDetails
```

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| False positives from lower threshold | Word-overlap boost requires exact word match, not just similar strings |
| Missing aliases | Dictionary can be expanded incrementally based on user feedback |
| Performance impact | Tokenization is O(n), only runs after initial similarity check |
| Alias conflicts | Longer patterns processed first; word boundaries enforced |

## Alternatives Considered

1. **Lower threshold globally to 0.80** - Rejected: Too many false positives
2. **Use Levenshtein distance instead** - Rejected: Jaro-Winkler better for names
3. **Machine learning approach** - Rejected: Overkill, requires training data

## References

- `packages/desktop/src/lib/constants.ts` - `DUPLICATE_CONFIG`
- `docs/decisions/ADR-pin-conversion-duplicate-prevention.md` - Original duplicate detection ADR
