# Settings Archive Box Overhaul Plan

## Objective

Major cleanup and restructuring of the Settings page Archive section with new Database/Backup functionality.

---

## Current State Analysis

### Current Archive Section Structure (lines 1652-1851)
```
Archive (accordion)
├── Archive Location [path] [edit] - has PIN protection
├── Delete on Import [On/Off] [edit] - has PIN protection
├── Startup PIN [On/Off] [edit] - NO PIN protection currently
├── Maps (sub-accordion)
│   ├── [list of ref maps with delete buttons]
│   └── [import map button]
└── Maintenance (sub-accordion)
    ├── Database: [Backup] [Restore] - indented inside maintenance
    └── Repair: [Purge Cache] [Fix Addresses] [Fix Images] [Fix Videos]
```

### Issues Identified
1. Archive Location shows value, not label - confusing
2. Delete on Import shows "On/Off", not descriptive text
3. Startup PIN has no PIN protection when editing
4. Database buttons are indented under Maintenance - should be top-level
5. "Save Settings" button at bottom - settings should auto-save
6. Maps Repair section has buttons indented
7. Dropdown arrows are gray (`text-gray-400`) not accent color
8. No Database section with health/backup pills as requested
9. HealthMonitoring is separate component below Archive - should integrate

---

## Target State (Per User Request)

```
Archive (accordion) - dropdown arrow should be accent color
├── Archive Location         [edit] - PIN required, shows path on click
├── Delete on Import         [edit] - PIN required + warning about file deletion
├── Startup PIN              [edit] - PIN required
├── Storage                  [visual bar] - disk space visualization
├── Database (sub-accordion) - NOT indented
│   ├── {healthy} {N backups} - pills at top
│   └── [Backup] [User Backup] [Restore] [User Restore] - 4 buttons
├── Maps Repair (sub-accordion) - buttons NOT indented
│   └── [Purge Cache] [Fix Addresses] [Fix Images] [Fix Videos]
└── Health (sub-accordion)
    └── [existing health monitoring content]
```

**REMOVE:** "Save Settings" button - auto-save instead

---

## Storage Bar Design

Visual representation of archive drive space:

```
Storage
┌──────────────────────────────────────────────────────────┐
│████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
└──────────────────────────────────────────────────────────┘
  Total: 500 GB  |  Available: 320 GB  |  Archive: 45 GB
```

### Bar Segments (left to right)
1. **Archive Used** (Gold accent #B9975C) - space used by archive folder
2. **Other Used** (Gray #7A7A7A) - other files on drive
3. **Available** (Light gray #E5E5E5) - free space

### Labels Below Bar
- **Total**: Total drive capacity
- **Available**: Free space remaining
- **Archive**: Size of archive folder

### Implementation
```svelte
<div class="py-2 border-b border-gray-100">
  <span class="text-sm font-medium text-gray-700 mb-2 block">Storage</span>
  <div class="h-4 bg-gray-200 rounded-full overflow-hidden flex">
    <div class="bg-accent" style="width: {archivePercent}%"></div>
    <div class="bg-gray-400" style="width: {otherUsedPercent}%"></div>
    <!-- remaining is available (gray-200 background) -->
  </div>
  <div class="flex justify-between text-xs text-gray-500 mt-1">
    <span>Total: {formatBytes(totalBytes)}</span>
    <span>Available: {formatBytes(availableBytes)}</span>
    <span>Archive: {formatBytes(archiveBytes)}</span>
  </div>
</div>
```

### Backend Required
New IPC channel: `storage:getStats`
Returns:
```typescript
{
  totalBytes: number;
  availableBytes: number;
  archiveBytes: number;  // Size of archive folder
  drivePath: string;     // e.g., "/" or "C:\"
}
```

---

## Implementation Steps

### Step 1: Fix Accordion Arrow Colors
**File:** `Settings.svelte`

Change all sub-accordion arrows from `text-gray-400` to `text-accent`:
- Line 1714: Maps sub-accordion arrow
- Line 1774: Maintenance sub-accordion arrow
- Line 1411: Users accordion arrow (already `text-accent`)
- Line 1660: Archive accordion arrow (already `text-accent`)

### Step 2: Restructure Archive Row Labels
**File:** `Settings.svelte` (lines 1670-1704)

Current:
```
Archive Location: [/path/to/archive] [edit]
Delete on Import: [On/Off] [edit]
Startup PIN: [On/Off] [edit]
```

New format:
```
Archive Location                [edit] ← shows path in tooltip/after click
Delete Original Files on Import [edit] ← toggle yes/no, PIN + warning
Startup PIN required            [edit] ← toggle yes/no, PIN protection
```

### Step 3: Add PIN Protection to Startup PIN Toggle
**File:** `Settings.svelte`

- Add `'startupPin'` to `pinAction` type
- Add PIN verification before toggling `requireLogin`
- Current line 1696-1704 toggles without PIN

### Step 4: Add Delete Warning Modal
**File:** `Settings.svelte`

When user confirms PIN for "Delete on Import":
- Show warning: "This permanently deletes original files after import. There is no way to recover them from this software."
- Require explicit confirmation before toggling

### Step 5: Add Storage Bar Visualization
**File:** `Settings.svelte` + new IPC

Add after Startup PIN row:
- New state: `storageStats`
- Load on mount via `storage:getStats` IPC
- Visual bar showing:
  - Archive used (Gold accent)
  - Other used (Gray)
  - Available (Light gray background)
- Labels: Total | Available | Archive

**Backend:** `packages/desktop/electron/main/ipc-handlers/storage-handlers.ts`
- Use Node.js `fs.statfs` or `check-disk-space` package
- Calculate archive folder size recursively

### Step 6: Promote Database to Sub-Accordion (Not Under Maintenance)
**File:** `Settings.svelte`

Move Database section OUT of Maintenance and make it a peer sub-accordion:
- Create new `databaseExpanded` state variable
- New sub-accordion with:
  - Header: "Database" with pills
  - Pills: `{healthy}` (green if DB + backups good) and `{N backups}` (count)
  - 4 buttons in a row:
    1. `Backup` - backs up database immediately (existing `backupDatabase()`)
    2. `User Backup` - opens file explorer for user to save (new)
    3. `Restore` - choose from internal backups (new)
    4. `User Restore` - opens file explorer for user to select (existing `restoreDatabase()`)

### Step 6: Update Backup Logic
**File:** `Settings.svelte` + backend

Backup retention policy (new requirement):
- 1 for each year
- 1 for each month of current year
- 1 for each week of current month
- 1 from start of today
- 1 from last app close

Track in `settings` table or `backups` table:
- `app_open_count` - nerd stat for first-time detection
- Show green if first time OR we have required backups

### Step 7: Rename "Maintenance" to "Maps Repair" and Flatten Buttons
**File:** `Settings.svelte`

Current structure under Maintenance:
```
Maintenance (accordion)
  Database: [buttons]  ← MOVE OUT
  Repair:
    [Purge Cache] [Fix Addresses] [Fix Images] [Fix Videos]
```

New structure:
```
Maps Repair (accordion)
  [Purge Cache] [Fix Addresses] [Fix Images] [Fix Videos]  ← NOT indented
```

### Step 8: Move HealthMonitoring Under Archive as Sub-Accordion
**File:** `Settings.svelte`

- Create `healthExpanded` state variable
- Move `<HealthMonitoring />` content inside Archive accordion
- Remove standalone `<HealthMonitoring />` component call (line 1853)

### Step 9: Remove "Save Settings" Button
**File:** `Settings.svelte`

- Remove lines 1855-1861 (Save Settings button)
- Ensure all settings auto-save on change:
  - Archive path: already saves in `selectArchiveFolder()` → need to call `saveSettings()`
  - Delete on Import: toggle in `executePinAction()` → add save
  - Startup PIN: `toggleRequireLogin()` already saves

### Step 10: Implement Auto-Save
**File:** `Settings.svelte`

Create auto-save helper that fires on any setting change:
```typescript
async function saveSetting(key: string, value: string) {
  await window.electronAPI.settings.set(key, value);
}
```

Call this whenever a setting changes, remove batch `saveSettings()`.

---

## New/Modified State Variables

```typescript
// Existing - keep
let archiveExpanded = $state(false);
let mapsExpanded = $state(false);
let maintenanceExpanded = $state(false);  // RENAME to mapsRepairExpanded

// New
let databaseExpanded = $state(false);
let healthExpanded = $state(false);

// Modified PIN actions
let pinAction = $state<'archive' | 'deleteOnImport' | 'startupPin' | null>(null);

// New - delete warning
let showDeleteWarning = $state(false);
```

---

## UI Mockup

```
┌─────────────────────────────────────────────────────────────┐
│ Settings                                           v0.1.0  │
├─────────────────────────────────────────────────────────────┤
│ ▼ Users (collapsed by default)                              │
├─────────────────────────────────────────────────────────────┤
│ ▼ Archive                                                   │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Archive Location                              edit  │   │
│   ├─────────────────────────────────────────────────────┤   │
│   │ Delete Original Files on Import               edit  │   │
│   ├─────────────────────────────────────────────────────┤   │
│   │ Startup PIN required                          edit  │   │
│   ├─────────────────────────────────────────────────────┤   │
│   │ Storage                                             │   │
│   │ ┌─────────────────────────────────────────────────┐ │   │
│   │ │███████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ │   │
│   │ └─────────────────────────────────────────────────┘ │   │
│   │   Total: 500 GB  |  Available: 320 GB  |  Archive: 45 GB│
│   ├─────────────────────────────────────────────────────┤   │
│   │ ▼ Database                    {healthy} {3 backups} │   │
│   │   [Backup] [User Backup] [Restore] [User Restore]   │   │
│   ├─────────────────────────────────────────────────────┤   │
│   │ ▼ Maps Repair                                       │   │
│   │   [Purge Cache] [Fix Addresses] [Fix Images] [Fix]  │   │
│   ├─────────────────────────────────────────────────────┤   │
│   │ ▼ Health                                            │   │
│   │   [Health monitoring content...]                    │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

NO "Save Settings" button - auto-saves
```

### Storage Bar Color Legend
- **Gold (████)** = Archive folder size (#B9975C)
- **Gray (░░░░)** = Other used space on drive (#7A7A7A)
- **Empty (    )** = Available free space (#E5E5E5 background)

---

## Backend Changes Required

### 1. Storage IPC (NEW)
**File:** `packages/desktop/electron/main/ipc-handlers/storage-handlers.ts`

```typescript
ipcMain.handle('storage:getStats', async () => {
  const archivePath = await getArchivePath();
  const diskInfo = await checkDiskSpace(archivePath);
  const archiveSize = await getFolderSize(archivePath);

  return {
    totalBytes: diskInfo.size,
    availableBytes: diskInfo.free,
    archiveBytes: archiveSize,
    drivePath: diskInfo.diskPath
  };
});
```

Use `check-disk-space` npm package (already handles cross-platform).
Use recursive folder size calculation for archive.

### 2. Database IPC (NEW)
- `database:listBackups` - list internal backups with dates
- `database:restoreFromInternal` - restore from internal backup by ID
- `database:exportBackup` - export to user-selected location (file dialog)
- `database:getBackupStats` - get backup count and health status

### 3. Settings Table Updates
- Add `app_open_count` for tracking opens (nerd stat)

### 4. Backup Retention Logic
Implement in health-monitor.ts or new backup-service.ts:
- Keep 1 per year
- Keep 1 per month (current year)
- Keep 1 per week (current month)
- Keep 1 from today start
- Keep 1 from last close

---

## Files to Modify

### Frontend
1. `packages/desktop/src/pages/Settings.svelte` - Major restructure (~250 lines)
2. `packages/desktop/src/components/HealthMonitoring.svelte` - May inline or keep

### Backend (New Files)
3. `packages/desktop/electron/main/ipc-handlers/storage-handlers.ts` - NEW (~50 lines)
4. `packages/desktop/electron/services/storage-service.ts` - NEW (~80 lines)

### Backend (Modified)
5. `packages/desktop/electron/main/ipc-handlers/database-handlers.ts` - New backup IPC (~100 lines)
6. `packages/desktop/electron/services/health-monitor.ts` - Backup retention logic
7. `packages/desktop/electron/preload/preload.cjs` - Add storage API exposure

---

## Compliance Check

| Rule | Status |
|------|--------|
| Scope Discipline | PASS - restructuring existing Settings UI per request |
| Archive-First | PASS - improves data management UX |
| Keep It Simple | PASS - consolidating scattered features |
| No AI in Docs | PASS - no user-facing AI mentions |
| Auto-save | PASS - removing manual save button |
| PIN protection | PASS - adding to all sensitive settings |

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Backup logic complexity | Start simple, enhance retention later |
| PIN modal reuse | Already have modal, extend pinAction type |
| Breaking existing functionality | Keep existing IPC, add new ones |
| HealthMonitoring integration | Can inline or keep component |

---

## Estimated Scope

- **Settings.svelte**: ~200 line changes (restructure + new sections)
- **New modals**: ~50 lines (delete warning)
- **Backend**: ~100 lines (new backup IPC if needed)
- **Total**: ~350 line changes

---

## Questions for User

1. **Internal backup list UI**: Should "Restore" show a dropdown or open a modal with backup list?
2. **Backup retention**: Is the retention policy (year/month/week/day/close) exact or approximate?
3. **Health section**: Keep as separate component or inline into Settings?
4. **First-time detection**: Use `app_open_count` or just check if backups exist?
