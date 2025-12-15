# OPT-035: Simplify Import Progress UI

**Status:** APPROVED
**Date:** 2025-12-01
**Type:** UI Polish / UX Simplification

---

## Problem Statement

The current import UI exposes internal implementation details that confuse end users:

1. **"Import started (711 files in 15 chunks)"** — Users don't need to know about chunking
2. **Progress showing chunk info** — "Chunk 3/15: importing 50 files..." is technical noise
3. **File counts like "50/711"** — Jump in increments of 50, which is jarring

The chunking is a memory optimization (OPT-034b) that should remain invisible to users.

---

## Current Implementation

### Affected Files

| File | Line(s) | Current Behavior |
|------|---------|------------------|
| `LocationDetail.svelte` | 669 | `Import started (${filePaths.length} files in ${chunks.length} chunks)` |
| `Imports.svelte` | 92 | `Importing ${progress.current} of ${progress.total} files...` |
| `Imports.svelte` | 295-297 | `Chunk ${chunkIdx + 1}/${chunks.length}: importing ${chunk.length} files...` |
| `ImportProgress.svelte` | 30 | `Importing {$importProgress.current}/{$importProgress.total}` |
| `ImportProgress.svelte` | 44 | `{$importProgress.percent}%` (duplicate if we add % to line 30) |
| `SidebarImportProgress.svelte` | 16-17 | `{$importProgress.current}/{$importProgress.total}` |
| `SidebarImportProgress.svelte` | 32 | `{$importProgress.percent}%` (already exists) |

### Technical Context

- Files are processed in chunks of 50 (`IMPORT_CHUNK_SIZE = 50`)
- Chunking prevents memory issues and IPC timeouts (OPT-034b)
- Progress updates come at chunk boundaries, not per-file
- The `importStore.updateProgress()` is called after each chunk completes

---

## Proposed Changes

### 1. Simplify "Import started" message

**LocationDetail.svelte:669**
- Before: `Import started (${filePaths.length} files in ${chunks.length} chunks)`
- After: `Import started`

### 2. Simplify Imports.svelte progress messages

**Imports.svelte:92**
- Before: `Importing ${progress.current} of ${progress.total} files...`
- After: `Importing...`

**Imports.svelte:295-297**
- Before: Conditional chunk message
- After: `Importing...` (no chunk info)

### 3. Simplify floating progress bar (avoid duplicate %)

**ImportProgress.svelte:30**
- Before: `Importing {$importProgress.current}/{$importProgress.total}`
- After: `Importing...`
- Note: Percentage already displayed at line 44, no duplication needed

### 4. Simplify sidebar progress (avoid duplicate %)

**SidebarImportProgress.svelte:16-17**
- Before: `{$importProgress.current}/{$importProgress.total}`
- After: `{$importProgress.percent}%`
- Also: Remove duplicate percentage display at line 32

---

## Visual Comparison

### Before (Current UI)

**Floating bar:**
```
[●] Importing 50/711  [=====     ] 7%  2m 30s left  Location Name  [Cancel]
```

**Sidebar:**
```
[●] Importing...                50/711
[===============              ]
7%                           [Cancel]
```

### After (Proposed UI)

**Floating bar:**
```
[●] Importing...  [=====     ] 7%  2m 30s left  Location Name  [Cancel]
```

**Sidebar:**
```
[●] Importing...                   7%
[===============              ]
                             [Cancel]
```

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/desktop/src/pages/LocationDetail.svelte` | Line 669: Remove file/chunk counts |
| `packages/desktop/src/pages/Imports.svelte` | Line 92: Remove file counts |
| `packages/desktop/src/pages/Imports.svelte` | Lines 295-297: Remove chunk info |
| `packages/desktop/src/components/ImportProgress.svelte` | Line 30: Just "Importing..." |
| `packages/desktop/src/components/SidebarImportProgress.svelte` | Lines 16-17: Show percentage instead |
| `packages/desktop/src/components/SidebarImportProgress.svelte` | Lines 30-32: Remove duplicate percentage |

---

## Risk Assessment

- **Low risk** — Purely cosmetic UI changes
- **No behavior changes** — Chunking logic, progress tracking, and import pipeline remain unchanged
- **Reversible** — Easy to restore if user feedback indicates otherwise

---

## Acceptance Criteria

- [x] "Import started" message shows no file/chunk counts
- [x] Floating progress bar shows "Importing..." with single percentage
- [x] Sidebar progress shows single percentage (no duplicates)
- [x] No chunk info exposed to user
- [x] Cancel button still functions correctly
- [x] Time remaining estimate still displays
