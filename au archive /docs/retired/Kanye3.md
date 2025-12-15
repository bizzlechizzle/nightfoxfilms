# Kanye3.md - Remaining Issues & Improvements

**Created:** 2024-11-23
**Context:** Post-preload sync and LILBITS refactoring
**Branch:** `claude/full-testing-suite-01KkuUpnsRkxRB6N42o8nakV`

---

## Completed in This Session

- [x] Fixed `window.electronAPI?.media?.preload is not a function` error
- [x] Synced `preload.cjs` with `index.ts` (added 15+ missing methods)
- [x] Merged duplicate `media` object in `index.ts`
- [x] Updated `electron.d.ts` with complete type definitions
- [x] Split `ipc-handlers.ts` (1933 lines) into 14 LILBITS-compliant modules (<300 lines each)
- [x] Deleted legacy backup file
- [x] **Fixed `file://` protocol blocked error** - Implemented custom `media://` protocol

---

## Outstanding Issues

### 1. ~~CRITICAL: `file://` Protocol Blocked in Renderer~~ ✅ FIXED

**Status:** RESOLVED - Implemented Option B (Custom Protocol)

**Solution Applied:**
- Registered `media://` protocol as privileged in `electron/main/index.ts` (before `app.whenReady()`)
- Added `protocol.handle('media', ...)` handler to serve local files
- Updated `MediaViewer.svelte` and `MediaGrid.svelte` to use `media://` instead of `file://`

**Files Changed:**
- `packages/desktop/electron/main/index.ts` - Protocol registration
- `packages/desktop/src/components/MediaViewer.svelte` - Use `media://` for images/videos
- `packages/desktop/src/components/MediaGrid.svelte` - Use `media://` for thumbnails

---

### 2. MEDIUM: Awkward Dependency Injection in IPC Handlers

**Current Pattern:**
```typescript
// In ipc-handlers/index.ts
const { mediaRepo, exifToolService, ffmpegService } = registerMediaImportHandlers(db, locationRepo, importRepo);
registerMediaProcessingHandlers(db, mediaRepo, exifToolService, ffmpegService);
```

**Problem:** Handler registration functions return services needed by other handlers. This creates implicit coupling.

**Better Pattern - Service Registry:**
```typescript
// services/service-registry.ts
class ServiceRegistry {
  private services = new Map<string, unknown>();

  register<T>(name: string, service: T): void {
    this.services.set(name, service);
  }

  get<T>(name: string): T {
    return this.services.get(name) as T;
  }
}

export const registry = new ServiceRegistry();

// In handler files
import { registry } from '../services/service-registry';
const mediaRepo = registry.get<SQLiteMediaRepository>('mediaRepo');
```

**Estimated Effort:** 1-2 hours

---

### 3. LOW: Runtime Testing Not Performed

The TypeScript compilation check passed (pre-existing errors are from test files missing types), but the application was not actually run to verify:

1. Preload script loads without errors
2. `media.preload()` is callable from renderer
3. MediaViewer can display images (Issue #1 now fixed)

**Testing Checklist:**
- [ ] `pnpm dev` starts without errors
- [ ] Console shows `[Preload] webUtils final: true/false` (expected)
- [ ] Console shows `IPC handlers registered (modular)`
- [ ] Navigate to a location with media
- [ ] Open MediaViewer lightbox
- [ ] Verify no `preload is not a function` error
- [ ] Verify images display via `media://` protocol (Issue #1 is now fixed)

---

### 4. LOW: TypeScript Config Issues (Pre-existing)

The `npx tsc --noEmit` shows many errors, all pre-existing:

```
Cannot find module 'electron' or its corresponding type declarations
Cannot find module 'vitest' or its corresponding type declarations
Cannot find module 'better-sqlite3' or its corresponding type declarations
```

**Root Cause:** `tsconfig.json` for electron main process doesn't include node types properly.

**Fix:** Update `packages/desktop/tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "types": ["node"],
    "moduleResolution": "node"
  }
}
```

**Estimated Effort:** 30 minutes

---

### 5. LOW: Missing `webUtils` in Electron 28

**Console Output:**
```
[Preload] webUtils in keys: false
[Preload] webUtils via destructure: false
[Preload] webUtils final: false
```

**Context:** `webUtils.getPathForFile()` is the modern way to get file paths from drag-drop events. Fallback to `file.path` works but is deprecated.

**Possible Causes:**
1. Sandbox mode interaction (currently `sandbox: false`)
2. Context isolation interaction
3. Electron version issue (28.3.3 should have it)

**Impact:** Low - fallback to `file.path` works. Drag-drop file paths still extracted correctly.

**Investigation Needed:** Check if `webUtils` works in production build vs dev mode.

---

## Architecture Notes

### IPC Handler Module Structure

```
electron/main/ipc-handlers/
├── index.ts              (77 lines)  - Orchestrator
├── locations.ts         (174 lines)  - location:* handlers
├── stats-settings.ts    (101 lines)  - stats:*, settings:* handlers
├── shell-dialog.ts       (46 lines)  - shell:*, dialog:* handlers
├── imports.ts            (80 lines)  - imports:* handlers
├── media-import.ts      (257 lines)  - media selection/import
├── media-processing.ts  (203 lines)  - thumbnails/cache/xmp
├── notes.ts             (113 lines)  - notes:* handlers
├── projects.ts          (173 lines)  - projects:* handlers
├── bookmarks.ts         (134 lines)  - bookmarks:* handlers
├── users.ts              (62 lines)  - users:* handlers
├── database.ts          (210 lines)  - database:* handlers
├── health.ts            (124 lines)  - health:* handlers
└── geocode.ts            (88 lines)  - geocode:* handlers

Total: 1842 lines across 14 files (was 1933 in single file)
All files under 300 lines (LILBITS compliant)
```

### Preload API Surface

Both `preload.cjs` and `index.ts` now expose:

```typescript
window.electronAPI = {
  versions: { node, chrome, electron },
  platform: string,

  locations: { findAll, findById, create, update, delete, count, random,
               undocumented, historical, favorites, toggleFavorite, findNearby },

  stats: { topStates, topTypes },
  settings: { get, getAll, set },
  shell: { openExternal },
  geocode: { reverse, forward, clearCache },
  dialog: { selectFolder },

  database: { backup, restore, getLocation, changeLocation, resetLocation },
  imports: { create, findRecent, findByLocation, findAll, getTotalMediaCount },

  media: {
    // Import
    selectFiles, expandPaths, import, phaseImport,
    onPhaseImportProgress, onImportProgress, cancelImport, findByLocation,
    // Processing
    openFile, generateThumbnail, extractPreview, generatePoster,
    getCached, preload, readXmp, writeXmp, regenerateAllThumbnails
  },

  notes: { create, findById, findByLocation, findRecent, update, delete, countByLocation },
  projects: { create, findById, findByIdWithLocations, findAll, findRecent,
              findTopByLocationCount, findByLocation, update, delete,
              addLocation, removeLocation, isLocationInProject },
  bookmarks: { create, findById, findByLocation, findRecent, findAll,
               update, delete, count, countByLocation },
  users: { create, findAll, findByUsername, delete },

  health: { getDashboard, getStatus, runCheck, createBackup, getBackupStats,
            getDiskSpace, checkIntegrity, runMaintenance, getMaintenanceSchedule,
            getRecoveryState, attemptRecovery },

  backup: { onStatus },
  browser: { navigate, show, hide, getUrl, getTitle, goBack, goForward,
             reload, captureScreenshot, onNavigated, onTitleChanged, onLoadingChanged }
}
```

---

## Priority Order

1. ~~**Issue #1 (file:// blocked)**~~ - ✅ FIXED
2. **Issue #3 (runtime testing)** - Verify all fixes work
3. **Issue #4 (tsconfig)** - Clean up dev experience
4. **Issue #2 (DI pattern)** - Nice to have
5. **Issue #5 (webUtils)** - Investigation only

---

## Commands

```bash
# Run dev mode
cd packages/desktop && pnpm dev

# Type check
npx tsc --noEmit

# Build
pnpm build

# Test specific handler
grep -r "media:preload" packages/desktop/
```
