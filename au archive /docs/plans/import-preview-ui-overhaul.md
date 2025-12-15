# Import Preview Modal UI Overhaul

## Objective
Simplify the import preview modal to a clean, minimal interface following KISS principles.

## Current State (Problems)
The current modal has:
- Summary stats grid (6 different metrics)
- GPS Enrichment Opportunities section with explanatory text, batch buttons, coordinate display
- Duplicate Details section with multiple subsections (Needs Review, Already Catalogued, Reference Matches)
- Various icons, badges, and colored backgrounds
- Skip duplicates checkbox with explanation
- Complex button text logic

**Total: ~320 lines of template code, visually cluttered**

## Proposed New Design

```
┌─────────────────────────────────────────────────────────┐
│  Import Reference Map                                    │
│  Points of Interest                                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Locations Found                           [check all]   │
│  ─────────────────────────────────────────────────────  │
│  [100%] Name A → Name B                          [ ✓ ]   │
│  [ 92%] Name C → Name D                          [ ✓ ]   │
│  [ 85%] Name E → Name F                          [   ]   │
│                                                          │
│                                          [approve]       │
│                                                          │
│  New Locations                                           │
│  ─────────────────────────────────────────────────────  │
│  47 New Locations Found                                  │
│  [12] NY  [8] PA  [6] OH  [5] MA  [4] NJ  [3] CT        │
│                                                          │
│  Duplicate Locations                                     │
│  ─────────────────────────────────────────────────────  │
│  15 Location Exists                                      │
│  8 New Duplicates Found                                  │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                              [Cancel]  [Import]          │
└─────────────────────────────────────────────────────────┘
```

## Color Pill Thresholds
| Percentage | Color | Tailwind Class |
|------------|-------|----------------|
| 100% | Gold (accent) | `bg-accent text-white` |
| 90-99% | Green | `bg-green-500 text-white` |
| 72-89% | Yellow | `bg-yellow-500 text-white` |
| 0-71% | Red | `bg-red-500 text-white` |

## Sections (Conditional Display)

### 1. Locations Found (only if enrichmentOpportunities.length > 0)
- Header: "Locations Found" + right-aligned "[check all]" button
- Each row: `[percentage pill] [name → name] [checkbox]`
- No extra text, coordinates, states, or explanations
- Bottom: Right-aligned "[approve]" button

### 2. New Locations (only if newPoints > 0)
- Header: "New Locations"
- Single line: "{count} New Locations Found"
- State breakdown as green pills: `[count] state`
- Group by state from parsed points

### 3. Duplicate Locations (only if cataloguedCount + referenceCount > 0)
- Header: "Duplicate Locations"
- Single line: "{count} Duplicates Found"
- No itemized list, no breakdown

## Removals
- Summary stats grid
- All icons and SVGs
- All explanatory paragraphs
- Match type badges (GPS, Name+GPS, State Match, etc.)
- Coordinate display
- Map name references
- Distance in meters
- Skip duplicates checkbox (always skip duplicates)
- Complex button text logic

## Footer
- Cancel button (gray)
- Import button (accent) - simple text, no conditional logic

## Implementation Notes

### Data Requirements
Need to compute state breakdown for new points. Backend already returns `newPoint.state` but need to aggregate.

### Behavior Changes
1. "Locations Found" = enrichment opportunities (existing locations without GPS)
2. Remove skipDuplicates toggle - always true
3. "check all" selects all enrichments
4. "approve" is visual confirmation (enrichments already selected)

### Files to Modify
- `packages/desktop/src/pages/Settings.svelte` - Import preview modal template (~lines 2394-2710)

### Lines of Code
- Current: ~320 lines of modal template
- Target: ~80-100 lines

## Clarifications (User Confirmed)

1. **"Approve" button**: Approves all checked locations as matches (applies GPS enrichments)

2. **State pills**: Top 5 states by point count (no "top 5" label per KISS)

3. **Duplicate section layout**:
   ```
   Duplicate Locations
   [X] Location Exists
   [Y] New Duplicates Found
   ```

4. **Empty state**: Close modal and log - no special UI needed
