# Settings UI Tweaks Plan

## Overview
Clean up Settings page UI by removing unnecessary elements and improving the edit flow with consistent PIN protection.

## User Requirements Analysis

| # | Requirement | Current State | Action |
|---|-------------|---------------|--------|
| 1 | Maps: Remove description text | Has "Import map files to display..." paragraph | Delete the `<p>` element |
| 2 | Maps: "Import Map" button right justified | Button is left-aligned in flex container | Change to `justify-end` |
| 3 | Users: Remove bar above "add user" | Has `border-t border-gray-200 pt-4 mt-4` | Remove border classes |
| 4 | Health: Remove (deprecated) | Full Health sub-accordion exists | Delete entire Health accordion |
| 5 | Startup PIN: Remove On/Off pill | Shows On/Off pill next to label | Remove the pill span |
| 6 | Delete on Import: Remove On/Off pill | Shows On/Off pill next to label | Remove the pill span |
| 7 | Archive Location: Remove disk path display | Shows path below label | Remove the path `<p>` element |
| 8 | Require PIN for all edit actions | Already using `requestPinForAction()` | Verify all edit buttons use it |

## Detailed Changes

### 1. Maps Section (lines ~1950-2027)

**Before:**
```svelte
<div class="py-3">
  <p class="text-xs text-gray-500 mb-3">
    Import map files to display as reference points on the Atlas...
  </p>
  ...
  <div class="flex flex-wrap gap-2">
    <button>Import Map</button>
```

**After:**
```svelte
<div class="py-3">
  ...
  <div class="flex justify-end gap-2">
    <button>Import Map</button>
```

- Remove the description paragraph
- Change button container from `flex flex-wrap gap-2` to `flex justify-end gap-2`

### 2. Users Section (line ~1707)

**Before:**
```svelte
<div class="flex items-center justify-end border-t border-gray-200 pt-4 mt-4">
```

**After:**
```svelte
<div class="flex items-center justify-end pt-4 mt-4">
```

- Remove `border-t border-gray-200` classes

### 3. Health Section (lines ~2083-2105)

**Action:** Delete entire Health sub-accordion block including:
- The `healthExpanded` state variable usage in template
- The Health accordion button and content
- Keep the `healthExpanded` state declaration (unused state doesn't hurt)
- Remove `HealthMonitoring` import if no longer used

### 4. Startup PIN Row (lines ~1843-1857)

**Before:**
```svelte
<div class="flex items-center gap-2">
  <span class="text-sm font-medium text-gray-700">Startup PIN Required</span>
  <span class="text-xs px-1.5 py-0.5 rounded {requireLogin ? 'bg-green-100...' : '...'}">
    {requireLogin ? 'On' : 'Off'}
  </span>
</div>
```

**After:**
```svelte
<span class="text-sm font-medium text-gray-700">Startup PIN Required</span>
```

- Remove the wrapper div with `flex items-center gap-2`
- Remove the On/Off pill span
- Keep just the label

### 5. Delete on Import Row (lines ~1827-1841)

**Before:**
```svelte
<div class="flex items-center gap-2">
  <span class="text-sm font-medium text-gray-700">Delete Original Files on Import</span>
  <span class="text-xs px-1.5 py-0.5 rounded {deleteOriginals ? 'bg-red-100...' : '...'}">
    {deleteOriginals ? 'On' : 'Off'}
  </span>
</div>
```

**After:**
```svelte
<span class="text-sm font-medium text-gray-700">Delete Original Files on Import</span>
```

- Remove the wrapper div with `flex items-center gap-2`
- Remove the On/Off pill span
- Keep just the label

### 6. Archive Location Row (lines ~1811-1825)

**Before:**
```svelte
<div class="flex-1">
  <span class="text-sm font-medium text-gray-700">Archive Location</span>
  {#if archivePath}
    <p class="text-xs text-gray-500 truncate max-w-[280px]" title={archivePath}>{archivePath}</p>
  {/if}
</div>
```

**After:**
```svelte
<span class="text-sm font-medium text-gray-700">Archive Location</span>
```

- Remove the wrapper div
- Remove the path display `<p>` element
- Keep just the label

### 7. PIN Protection Verification

Current `requestPinForAction()` already handles:
- `'archive'` → Archive Location edit
- `'deleteOnImport'` → Delete on Import edit
- `'startupPin'` → Startup PIN edit

All three edit buttons already call `requestPinForAction()` - **no changes needed**.

## Final Structure

```
Archive (accordion)
├── Archive Location                    edit
├── Delete Original Files on Import     edit
├── Startup PIN Required                edit
├── Database                            ▼
│   └── {healthy} {N backups}
│   └── [Backup] [User Backup] [Restore] [User Restore]
├── Maps                                ▼
│   └── [map list if any]
│   └──                    [Import Map] (right-aligned)
├── Repair                              ▼
│   └── [Purge Cache] [Fix Addresses] [Fix Images] [Fix Videos]
└── Storage
    └── Stats + bar
```

Note: Health section is REMOVED entirely.

## Compliance Check

| CLAUDE.MD Rule | Status |
|----------------|--------|
| Scope Discipline - only implement what's requested | ✅ |
| Keep It Simple - minimal changes | ✅ |
| No AI references | ✅ |
| No surprise features | ✅ |
| No TODOs in code | ✅ |

## Files Modified
- `packages/desktop/src/pages/Settings.svelte`

## Risk Assessment
- Low risk: UI-only template changes
- No database changes
- No IPC changes
- Existing PIN protection logic unchanged
