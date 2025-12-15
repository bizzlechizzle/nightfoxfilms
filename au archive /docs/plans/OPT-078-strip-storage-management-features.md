# OPT-078: Strip Storage Management Features

**Status:** Complete
**Priority:** High
**Type:** Simplification / Dead Code Removal

---

## Problem Statement

AU Archive is an **archive application** — we **copy data**, we are **not a storage management app**.

Three features violate this principle:
1. **Delete original files after import** — Destructive behavior inappropriate for an archive app
2. **Hardlink strategy** — Storage optimization that creates data dependencies on source files
3. **Symlink references** — Creates file references instead of true copies

An archive app should always produce independent, self-contained copies that survive regardless of what happens to source files.

---

## Files to Modify

### 1. UI Components (Remove delete-originals checkbox)

| File | Changes |
|------|---------|
| `packages/desktop/src/components/ImportForm.svelte:11,18,33,40,396-405` | Remove `deleteOriginals` prop, checkbox, and handler |
| `packages/desktop/src/pages/Imports.svelte:47,77,236,306,410,417` | Remove `deleteOriginals` state, loading, and prop passing |
| `packages/desktop/src/pages/Settings.svelte:15,249,1217-1246,2101-2110,2836-2877` | Remove `deleteOriginals` state, toggle function, PIN action, UI row, and warning modal |
| `packages/desktop/src/pages/Setup.svelte:23,108,284-289` | Remove `deleteOriginals` state, settings save, and checkbox |
| `packages/desktop/src/pages/LocationDetail.svelte:615` | Remove `deleteOriginals: false` from import call |

### 2. Type Definitions

| File | Changes |
|------|---------|
| `packages/desktop/src/types/electron.d.ts:264,303-304` | Remove `deleteOriginals` and `useHardlinks` from type definitions |

### 3. Preload Bridge

| File | Changes |
|------|---------|
| `packages/desktop/electron/preload/index.ts:359,368-369` | Remove `deleteOriginals` and `useHardlinks` from exposed types |

### 4. IPC Handlers

| File | Changes |
|------|---------|
| `packages/desktop/electron/main/ipc-handlers/media-import.ts:315,365,443-444,480` | Remove `deleteOriginals` and `useHardlinks` from Zod schemas and handler calls |
| `packages/desktop/electron/main/ipc-validation.ts:65` | Remove `'delete_on_import'` from valid settings keys |

### 5. Import Services (Core Logic)

| File | Changes |
|------|---------|
| `packages/desktop/electron/services/file-import-service.ts:279,292,352,764,1060-1070` | Remove `deleteOriginals` parameter and file deletion logic |
| `packages/desktop/electron/services/phase-import-service.ts:41-42,174-175,218,437,515-529,854` | Remove `deleteOriginals` and `useHardlinks` options and deletion logic |
| `packages/desktop/electron/services/import-manifest.ts:80-81,157-158,182-183` | Remove `delete_originals` and `use_hardlinks` from manifest schema |

### 6. Import v2 Copier (Hardlink/Reflink Strategy)

| File | Changes |
|------|---------|
| `packages/desktop/electron/services/import/copier.ts:2-14,24,172-202,233-234,260-265,272-276` | **MAJOR**: Simplify to copy-only strategy, remove hardlink/reflink detection and attempts |

### 7. Scanner (Keep symlink security checks)

| File | Changes |
|------|---------|
| `packages/desktop/electron/services/import/scanner.ts:221,225-283,388-390,405-406,443-445,448,568,571` | **KEEP** symlink blocking (security), remove hardlink speed estimation |

### 8. Database Types

| File | Changes |
|------|---------|
| `packages/desktop/electron/main/database.types.ts:599` | Remove `copy_strategy` type definition |

### 9. Config Service

| File | Changes |
|------|---------|
| `packages/desktop/electron/services/config-service.ts:12,40-41` | Remove `backupAfterImport` if it's only for delete-originals flow |

---

## Root-Level Files to Delete

These are development/monitoring utilities that reference hardlink functionality and are not part of the shipping app:

| File | Purpose | Action |
|------|---------|--------|
| `file-ops-monitor.js` (530 lines) | Hardlink vs copy testing utility | **DELETE** |
| `import-tracer.js` (540 lines) | Import tracing with hardlink verification | **DELETE** |

---

## Documentation Updates

| File | Action |
|------|--------|
| `docs/workflows/import.md` | Remove references to delete originals |
| `docs/workflows/export.md:37,48` | Remove hardlink references in backup/restore |
| `docs/contracts/hashing.md` | No changes (hash contract is separate) |
| `MONITORING-INTEGRATION-GUIDE.md` | Remove hardlink examples and verification sections |
| `AU-ARCHIVE-MONITORING-STRATEGY.md` | Remove hardlink strategy metrics |
| `AU-ARCHIVE-AUDIT-PROMPT.md` | Remove hardlink pipeline references |
| `AU-ARCHIVE-IMPLEMENTATION-CHECKLIST.md:127,147` | Remove hardlink implementation items |
| `FULL-AUDIT-COMMAND.md:104-111,332` | Remove hardlink audit questions |

---

## What to KEEP

### Symlink Security (Scanner)
The scanner's symlink detection is a **security feature**, not a storage feature:
- `isSymlinkOutsideRoot()` — Prevents path traversal attacks
- `symlinkBlocked` counter — Security logging
- These STAY because they protect against malicious symlinks in import paths

### Reflink (COPYFILE_FICLONE)
Consider keeping reflink as it's:
- Transparent to the app (fs.copyFile flag)
- Creates independent copies (copy-on-write)
- No behavioral difference from user perspective
- **Decision: KEEP** — It's just an efficient copy, not a storage management feature

---

## Implementation Order

1. **Phase 1: UI Cleanup** — Remove all deleteOriginals UI and state
2. **Phase 2: Type/IPC Cleanup** — Remove from types, preload, IPC handlers
3. **Phase 3: Service Cleanup** — Remove from import services
4. **Phase 4: Copier Simplification** — Remove hardlink strategy, keep copy + reflink
5. **Phase 5: Utility Deletion** — Delete root-level monitoring scripts
6. **Phase 6: Doc Updates** — Clean up references in documentation

---

## Testing Plan

After each phase:
1. `pnpm build` — Verify no TypeScript errors
2. `pnpm dev` — Verify app launches
3. Test import flow — Files should always be copied (never linked)
4. Check Settings page — No "delete on import" option
5. Check Import page — No "delete originals" checkbox

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking import flow | Keep reflink as copy optimization |
| TypeScript errors from removed types | Remove in correct dependency order |
| Settings migration | `delete_on_import` key can remain in DB, just unused |

---

## Summary

**Remove:**
- All `deleteOriginals` / `delete_on_import` functionality
- Hardlink strategy and detection
- Hardlink monitoring utilities

**Keep:**
- Symlink security blocking in scanner
- Reflink (copy-on-write) as transparent copy optimization
- All copy functionality

**Result:** Archive app that always creates independent copies, period.
