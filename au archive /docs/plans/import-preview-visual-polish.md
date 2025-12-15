# Import Preview Modal Visual Polish

## Objective
Premium Archive Experience - clean, minimal visual overhaul

## Changes Required

### 1. Remove "Points of Interest"
- **Current**: `<p class="text-sm text-gray-500">Points of Interest</p>` under header
- **Action**: Delete this line

### 2. Remove header border/line
- **Current**: `<div class="p-4 border-b">` on header
- **Action**: Remove `border-b` class

### 3. Auto-check 90%+ matches on modal open
- **Current**: All unchecked by default
- **Action**: In `showImportPreview` assignment, auto-select enrichments with 90%+ similarity
- **Logic**: After `selectedEnrichments = new Map()`, iterate and pre-select 90%+

### 4. Remove state pills under New Locations
- **Current**: Shows `[12] NY [8] PA` etc.
- **Action**: Delete the entire `{#if importPreview.newPointsStateBreakdown.length > 0}` block

### 5. Remove footer border/line
- **Current**: `<div class="p-4 border-t bg-gray-50 rounded-b-lg ...>`
- **Action**: Remove `border-t` class

### 6. Clean single background
- **Current**: Footer has `bg-gray-50`, main box is white
- **Action**: Remove `bg-gray-50` from footer - entire modal is clean white

### 7. Cancel button - outlined accent style
- **Current**: `class="px-4 py-2 text-gray-600 hover:text-gray-800 transition"`
- **Action**: Change to `class="px-4 py-2 text-accent border border-accent rounded hover:bg-accent/10 transition"`

### 8. Decrease space under "Import Reference Map"
- **Current**: `<div class="p-4 border-b">` (16px padding)
- **Action**: Change to `pb-2` for bottom padding (8px) instead of full p-4

## Visual Before/After

### Before
```
┌─────────────────────────────────────────┐
│  Import Reference Map                    │
│  Points of Interest                      │ ← REMOVE
├─────────────────────────────────────────┤ ← REMOVE line
│                                          │
│  Locations Found          [check all]    │
│  [100%] Name — Name              [ ]     │ ← AUTO-CHECK 90%+
│                                          │
│  New Locations                           │
│  47 New Locations Found                  │
│  [12] NY  [8] PA  [6] OH                │ ← REMOVE
│                                          │
├─────────────────────────────────────────┤ ← REMOVE line
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ ← REMOVE gray bg
│                      Cancel    [Import]  │
└─────────────────────────────────────────┘
```

### After
```
┌─────────────────────────────────────────┐
│  Import Reference Map                    │
│                                          │ ← less space
│  Locations Found          [check all]    │
│  [100%] Name — Name              [✓]     │ ← 90%+ auto-checked
│                                          │
│  New Locations                           │
│  47 New Locations Found                  │
│                                          │
│  Duplicate Locations                     │
│  15 Location Exists                      │
│                                          │
│               [Cancel]    [Import]       │ ← outline Cancel
└─────────────────────────────────────────┘
```

## Files to Modify
- `packages/desktop/src/pages/Settings.svelte`
  - Modal template (~lines 2408-2525)
  - Preview assignment (~line 969-972) for auto-select logic

## Implementation Checklist
1. [ ] Remove "Points of Interest" subtitle
2. [ ] Remove `border-b` from header div
3. [ ] Add auto-select 90%+ logic when modal opens
4. [ ] Remove state breakdown pills
5. [ ] Remove `border-t` from footer div
6. [ ] Remove `bg-gray-50` from footer div
7. [ ] Update Cancel button to outlined accent style
8. [ ] Change header padding from `p-4` to `p-4 pb-2`
