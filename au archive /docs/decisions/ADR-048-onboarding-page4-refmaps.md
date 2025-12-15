# ADR-048: Onboarding Page 4 - Reference Maps Import

**Status:** Implemented
**Date:** 2025-12-09
**Depends On:** ADR-047 (3-page setup wizard)

---

## Context

User request to extend the onboarding wizard from 3 pages to 4 pages:
1. Add Page 4 for importing reference map files (KML, KMZ, GPX, GeoJSON, CSV)
2. Support **multiple file selection** (current implementation only allows single file)
3. Include Rule #4: **Share Responsibly**

Reference maps are the backbone of the archive workflow - they contain GPS coordinates and names of abandoned locations that users have collected from various sources.

---

## Current State Analysis

### Setup.svelte (285 lines)
- 3 pages with educational rules per ADR-047
- `totalSteps = 3`
- Pages: Name → Archive Location → Security PIN

### Reference Map Import (ref-maps.ts IPC handlers)
- `refMaps:import` - Single file dialog (`properties: ['openFile']`)
- `refMaps:importFromPath` - Import from specific path
- Supported formats: KML, KMZ, GPX, GeoJSON, JSON, CSV
- Dedup check + enrichment capabilities exist

### Gap: No Multi-File Support
Current dialog only allows single file selection. For onboarding, users typically want to import all their map files at once.

---

## Proposed Changes

### Page 4: Reference Maps (Optional)

**Purpose:** Allow users to import reference map files during setup. This is **optional** - users can skip and import later via Settings.

**Fields:**
- File list showing selected maps (name, point count preview)
- "Add Maps" button (opens multi-file dialog)
- "Skip" button (proceeds without importing)

**Rule Box:** Share Responsibly

**Behavior:**
- Files parsed on selection (preview point count)
- Import happens on "Continue" (or batch at end of wizard)
- Skippable - user can always import later

---

## Visual Design

```
┌─────────────────────────────────────┐
│                                     │
│        ABANDONED ARCHIVE            │
│                                     │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│                                     │
│  Reference Maps                     │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ No maps selected            │    │  ← Empty state
│  │ (or list of selected files) │    │
│  └─────────────────────────────┘    │
│                                     │
│  [Add Maps]                         │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ SHARE RESPONSIBLY           │    │  ← Rule #4
│  └─────────────────────────────┘    │
│                                     │
│  [Back]              [Skip] [Next]  │
│                                     │
└─────────────────────────────────────┘
```

---

## Implementation Plan

### 1. New IPC Handler: Multi-File Selection

**File:** `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

Add new handler `refMaps:selectMultipleFiles`:
```typescript
ipcMain.handle('refMaps:selectMultipleFiles', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Reference Maps',
    filters: [
      { name: 'Map Files', extensions: ['kml', 'kmz', 'gpx', 'geojson', 'json', 'csv'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile', 'multiSelections']  // ← Key change
  });

  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }

  return result.filePaths;
});
```

### 2. New IPC Handler: Batch Import

**File:** `packages/desktop/electron/main/ipc-handlers/ref-maps.ts`

Add `refMaps:importBatch` for importing multiple files at once:
```typescript
ipcMain.handle('refMaps:importBatch', async (_event, filePaths: string[], importedBy?: string) => {
  const results = [];
  for (const filePath of filePaths) {
    // Reuse existing importFromPath logic
    const result = await importSingleFile(filePath, importedBy);
    results.push({ filePath, ...result });
  }
  return {
    success: results.every(r => r.success),
    results,
    totalPoints: results.reduce((sum, r) => sum + (r.pointCount || 0), 0),
    successCount: results.filter(r => r.success).length,
    failedCount: results.filter(r => !r.success).length,
  };
});
```

### 3. Update Type Definitions

**File:** `packages/desktop/src/types/electron.d.ts`

Add to refMaps interface:
```typescript
selectMultipleFiles: () => Promise<string[]>;
importBatch: (filePaths: string[], importedBy?: string) => Promise<{
  success: boolean;
  results: Array<{
    filePath: string;
    success: boolean;
    error?: string;
    map?: RefMap;
    pointCount?: number;
  }>;
  totalPoints: number;
  successCount: number;
  failedCount: number;
}>;
```

### 4. Update Preload Bridge

**File:** `packages/desktop/electron/preload/preload.cjs`

Add bridge methods:
```javascript
selectMultipleFiles: () => ipcRenderer.invoke('refMaps:selectMultipleFiles'),
importBatch: (filePaths, importedBy) => ipcRenderer.invoke('refMaps:importBatch', filePaths, importedBy),
```

### 5. Update Setup.svelte

**File:** `packages/desktop/src/pages/Setup.svelte`

Changes:
- `totalSteps = 4` (was 3)
- Add state: `selectedMapFiles: string[] = []`
- Add state: `mapPreviews: Array<{path: string, name: string, pointCount: number}> = []`
- Add Page 4 template with file list and Add Maps button
- Update `canProceed()` - Page 4 always proceeds (optional)
- Update `completeSetup()` to import maps if any selected

---

## Educational Rule #4

**Title:** Share Responsibly

**Rationale:** Reference maps often contain locations from other explorers' research. Users should be mindful about sharing GPS coordinates publicly.

**Design:**
```html
<div class="bg-braun-100 border border-braun-300 rounded p-3 mt-4">
  <div class="text-xs font-semibold uppercase tracking-wider text-braun-500">
    Share Responsibly
  </div>
</div>
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/desktop/electron/main/ipc-handlers/ref-maps.ts` | Add `selectMultipleFiles` and `importBatch` handlers |
| `packages/desktop/electron/preload/preload.cjs` | Add bridge methods |
| `packages/desktop/src/types/electron.d.ts` | Add type definitions |
| `packages/desktop/src/pages/Setup.svelte` | Add Page 4, update step count |
| `packages/desktop/src/pages/Settings.svelte` | Update `importRefMap()` to use multi-select |

---

## Settings.svelte Update

**Current behavior (Settings.svelte:959):**
```typescript
const result = await window.electronAPI.refMaps.selectFile();
// Single file only
```

**New behavior:**
- Replace `selectFile()` with `selectMultipleFiles()`
- Same button, same flow - just allows selecting 1 or many files
- If 1 file selected → existing preview/dedup modal
- If multiple files selected → batch import with auto-skip duplicates, show summary

**One button handles both cases.** User picks files, we handle appropriately.

---

## Braun Compliance Checklist

- [x] No decorative images (file list uses text only)
- [x] Typography follows scale
- [x] Colors from `braun-*` palette only
- [x] Max 4px border-radius
- [x] 8pt grid spacing
- [x] No shadows
- [x] Geometric shapes only
- [x] Rule box uses standard card pattern

---

## UX Considerations

1. **Optional Step:** Page 4 can be skipped - users can import maps anytime via Settings
2. **Multi-Select:** Dialog allows selecting multiple files at once
3. **Preview:** Show file name + point count before import
4. **Progress:** Simple processing indicator during import
5. **Error Handling:** Show failed files with reason, allow retry

---

## Testing Plan

1. Test multi-file selection with various formats (KML, KMZ, GPX, GeoJSON, CSV)
2. Test skip functionality (no maps selected)
3. Test mixed success/failure (some files valid, some invalid)
4. Test cancellation during file selection
5. Verify maps appear in Atlas after setup complete

---

## Decision

Implemented 2025-12-09.

**Summary:**
- Added Page 4 to onboarding for optional reference map import
- Changed `selectFile` to multi-select (returns `string[]`)
- Added `importBatch` IPC handler for multiple files
- Settings uses same button - 1 file shows preview modal, multiple files batch imports
- Includes Rule #4: "Share Responsibly"

**Files Changed:**
- `electron/main/ipc-handlers/ref-maps.ts` - Multi-select dialog + batch import handler
- `electron/preload/preload.cjs` - Bridge method for importBatch
- `src/types/electron.d.ts` - Updated selectFile return type, added importBatch
- `src/pages/Setup.svelte` - Page 4 with file list and Add Maps button
- `src/pages/Settings.svelte` - Multi-file support in importRefMap()
