# Archive Box Cleanup Plan

## Overview
Clean up the Archive section in Settings.svelte to match the exact UI specification from the user request.

## Current State Analysis
- Archive accordion exists with basic structure
- Database section is mostly correct (pills inside, 4 buttons)
- Maps Repair buttons may have extra padding
- Storage bar exists but shows stats below bar (should be above)
- Dead `saveSettings()` function exists but no button calls it (good - settings auto-save)
- Dropdown arrows already use accent color

## Target Structure (Exact from User)

```
Archive (accordion)
├── Archive Location           [path]                edit (PIN protected)
├── Delete on Import          [On/Off pill]          edit (PIN + warning)
├── Startup PIN               [On/Off pill]          edit (PIN protected)
├── Database                  (NO pills outside, just label)
│   └── {healthy} {N backups}                       <- pills INSIDE accordion
│   └── [Backup] [User Backup] [Restore] [User Restore]
├── Maps Repair               (buttons NOT indented)
│   └── [Purge Cache] [Fix Addresses] [Fix Images] [Fix Videos]
├── Health
│   └── <HealthMonitoring component>
└── Storage
    └── [ Total Storage ]
    └── [ Available Storage ]
    └── [ Archive Used ]
    └── [========storage bar========]
```

## Changes Required

### 1. Remove Dead `saveSettings()` Function
- **Location**: Lines ~437-460 in script section
- **Action**: Remove unused function (no button calls it, settings already auto-save)

### 2. Verify Database Sub-Section (Already Correct)
- **Current**: Pills inside accordion, 4 buttons present
- **Target**: Confirmed matching requirements
- **Buttons order**: Backup, User Backup, Restore, User Restore (already correct)

### 3. Verify Maps Repair Buttons (Check Indentation)
- **Current**: Buttons inside `<div class="py-3">` after accordion opens
- **Target**: Buttons at same level as other accordion content
- **Action**: Verify padding is consistent with Database section

### 4. Restructure Storage Section
- **Current**: Storage bar at bottom with stats below the bar
- **Target**:
  - Three stats displayed ABOVE the bar: Total Storage, Available Storage, Archive Used
  - Clean storage bar below the stats
- **Layout**: Stack the 3 values, then show the bar

### 5. Dropdown Arrow Styling
- **Current**: `text-accent` class on SVG arrows (already correct)
- **Verify**: All accordion arrows use accent color

## Detailed Implementation

### Phase 1: Database Section Fix
```svelte
<!-- Database Sub-Accordion -->
<div>
  <button onclick=...>
    <span class="text-sm font-medium text-gray-700">Database</span>
    <svg class="w-4 h-4 text-accent ...">...</svg>
  </button>

  {#if databaseExpanded}
  <div class="py-3">
    <!-- Pills INSIDE accordion content -->
    <div class="flex items-center gap-2 mb-3">
      <span class="text-xs px-1.5 py-0.5 rounded {healthy pill}">healthy</span>
      <span class="text-xs px-1.5 py-0.5 rounded {backups pill}">{N} backups</span>
    </div>
    <!-- 4 buttons in order -->
    <div class="flex flex-wrap gap-2">
      <button>Backup</button>
      <button>User Backup</button>
      <button>Restore</button>
      <button>User Restore</button>
    </div>
  </div>
  {/if}
</div>
```

### Phase 2: Maps Repair Button Fix
- Remove extra indentation wrapper if any
- Buttons should be at same padding level as Database pills

### Phase 3: Storage Section Restructure
```svelte
<!-- Storage Section (at bottom of Archive accordion) -->
<div class="py-3 mt-2">
  <span class="text-sm font-medium text-gray-700 mb-2 block">Storage</span>
  {#if storageStats}
    <!-- Three stats above bar -->
    <div class="text-xs text-gray-600 mb-2 space-y-1">
      <div>Total Storage: {formatBytes(storageStats.totalBytes)}</div>
      <div>Available Storage: {formatBytes(storageStats.availableBytes)}</div>
      <div>Archive Used: {formatBytes(storageStats.archiveBytes)}</div>
    </div>
    <!-- Storage bar below -->
    <div class="h-4 bg-gray-200 rounded-full overflow-hidden flex">
      <div class="bg-accent" style="width: {archivePercent}%"></div>
      <div class="bg-gray-400" style="width: {otherUsedPercent}%"></div>
    </div>
  {:else if loadingStorage}
    <div class="h-4 bg-gray-200 rounded-full animate-pulse"></div>
    <p class="text-xs text-gray-400 mt-1">Loading storage info...</p>
  {:else}
    <p class="text-xs text-gray-400">Storage info unavailable</p>
  {/if}
</div>
```

## Verification Checklist

- [ ] Archive Location row: label, path (truncated), edit button → PIN modal
- [ ] Delete on Import row: label, On/Off pill, edit button → PIN + warning modal
- [ ] Startup PIN row: label, On/Off pill, edit button → PIN modal
- [ ] Database row: just label + chevron (no pills on header)
- [ ] Database expanded: pills inside, then 4 buttons (Backup, User Backup, Restore, User Restore)
- [ ] Maps Repair row: label + chevron
- [ ] Maps Repair expanded: 4 buttons at same padding as other content
- [ ] Health row: label + chevron
- [ ] Health expanded: HealthMonitoring component
- [ ] Storage section: 3 stat lines above, storage bar below
- [ ] All dropdown chevrons: accent color
- [ ] No "Save Settings" button (settings auto-save)
- [ ] Dead `saveSettings()` function removed

## Files Modified
- `packages/desktop/src/pages/Settings.svelte`

## Compliance Check

| Rule | Status |
|------|--------|
| Only implement what's requested | ✓ |
| No surprise features | ✓ |
| Keep it simple | ✓ |
| Settings auto-save (remove manual save) | ✓ |
| No AI references | ✓ |
| No TODOs in code | ✓ |

## Risk Assessment
- Low risk: UI-only changes to existing accordion structure
- No database/schema changes
- No new IPC channels needed
- Existing functionality preserved
