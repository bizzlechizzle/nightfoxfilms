# Reference Maps Phase 2: Auto-Matching Implementation Plan

## Goal
When a user creates a new location, automatically check imported reference map points for potential matches using Jaro-Winkler string similarity at 0.92 threshold. Display matches in a premium, non-intrusive UI that enhances the workflow without blocking it.

## Architecture Overview

```
User enters location name
        ↓
ImportModal.svelte (debounced input)
        ↓
IPC: refMaps:findMatches(name, state?)
        ↓
ref-map-matcher-service.ts
        ↓
jaro-winkler-service.ts (0.92 threshold)
        ↓
Returns matches with scores + GPS coordinates
        ↓
ImportModal shows subtle suggestion banner
        ↓
User can: Ignore / Apply GPS / View on map
```

## Files to Create

### 1. `electron/services/jaro-winkler-service.ts`
- Pure Jaro-Winkler algorithm implementation
- Configurable threshold (default 0.92)
- Case-insensitive matching
- Handles null/empty strings gracefully

### 2. `electron/services/ref-map-matcher-service.ts`
- Uses jaro-winkler-service for string comparison
- Queries ref_map_points table
- Filters by state if provided (optimization)
- Returns top N matches above threshold
- Includes GPS coordinates from matched points

## Files to Modify

### 3. `electron/main/ipc-handlers/ref-maps.ts`
- Add `refMaps:findMatches` handler
- Parameters: `{ name: string, state?: string, limit?: number }`
- Returns: `Array<{ pointId, name, score, lat, lng, mapName }>`

### 4. `electron/preload/preload.cjs`
- Add `findMatches` to refMaps API

### 5. `src/types/electron.d.ts`
- Add `RefMapMatch` interface
- Add `findMatches` method signature

### 6. `src/components/ImportModal.svelte`
- Add debounced name input watcher
- Call findMatches API when name changes
- Display match suggestions (non-blocking banner)
- "Apply GPS" button copies coordinates to form
- "Dismiss" hides suggestions

## UI Design (Premium UX)

```
┌─────────────────────────────────────────────────┐
│ New Location                                    │
├─────────────────────────────────────────────────┤
│ Location Name: [Abandoned Factory          ]    │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ 📍 Possible match found:                    │ │
│ │    "Abandoned Factory Mill" (98% match)     │ │
│ │    From: Industrial Sites Map               │ │
│ │    [Apply GPS]  [Dismiss]                   │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ Type: [                    ▼]                   │
│ ...                                             │
└─────────────────────────────────────────────────┘
```

## Jaro-Winkler Algorithm

The Jaro-Winkler similarity is computed as:
1. Jaro similarity = (m/|s1| + m/|s2| + (m-t)/m) / 3
   - m = matching characters
   - t = transpositions / 2
2. Winkler adjustment: jaro + (l * p * (1 - jaro))
   - l = common prefix length (max 4)
   - p = scaling factor (0.1)

Threshold 0.92 means:
- "Abandoned Factory" vs "Abandoned Factory Mill" = ~0.95 (MATCH)
- "Abandoned Factory" vs "Old Mill Building" = ~0.45 (NO MATCH)
- "Riverside Hospital" vs "Riverside Hosp" = ~0.96 (MATCH)

## Performance Considerations

1. **Debounce**: 300ms delay after typing stops
2. **State filter**: If state is selected, only check points in that state
3. **Limit results**: Return top 3 matches only
4. **Minimum length**: Don't search until name >= 3 characters
5. **Cache**: Consider caching ref points in memory on app start

## Premium UX Requirements

1. **Non-blocking**: Suggestions appear but don't prevent form submission
2. **Subtle animation**: Fade in/out for suggestion banner
3. **Clear actions**: "Apply GPS" is obvious, "Dismiss" is available
4. **No duplicates**: Don't suggest if GPS already entered manually
5. **Contextual**: Show which map the match came from

## Testing Checklist

- [ ] Jaro-Winkler returns correct scores for test cases
- [ ] Matches found with 0.92+ threshold
- [ ] No matches below threshold
- [ ] State filter reduces search space
- [ ] Debounce prevents excessive API calls
- [ ] Apply GPS copies coordinates to form
- [ ] Dismiss hides banner
- [ ] No suggestions when GPS already filled
- [ ] Works with 0 reference maps (graceful)
- [ ] Works with 10,000+ reference points (performance)
