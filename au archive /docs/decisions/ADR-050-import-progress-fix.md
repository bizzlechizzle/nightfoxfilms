# ADR-050: Fix Import Progress File Count Display

**Status:** Proposed
**Date:** 2025-12-10

---

## Context

The import progress bar shows `0/total` throughout the import process. The file count stays at zero until the very end when it jumps to the final count. This gives users no feedback during long operations like scanning, hashing, and copying.

## Root Cause Analysis

Three issues combine to cause this bug:

### 1. Orchestrator Only Updates `filesProcessed` at Finalization

In `orchestrator.ts:503`, `filesProcessed` is only set at Step 5 (Finalize):
```typescript
progress.filesProcessed = finalizationResult.totalFinalized;
```

Steps 1-4 (Scan, Hash, Copy, Validate) never update this field, leaving it at 0.

### 2. No Renderer Listener for `import:v2:progress` Events

The main process emits `import:v2:progress` events via `sendToRenderer()`, but:
- `App.svelte` only listens to legacy `media:import:progress`
- No preload bridge method exists for `onImportV2Progress()`
- The import store's `updateProgress()` method is never called

### 3. Missing Preload Bridge Method

The preload (`index.ts`) exposes `onImportProgress` for legacy imports but has no equivalent for the v2 import pipeline.

## Decision

Implement incremental progress tracking by:

1. **Update orchestrator to emit `filesProcessed` during each step** - Track completed files incrementally, not just at finalization

2. **Add preload bridge method for v2 progress events** - Expose `onImportV2Progress()` in the preload

3. **Add renderer listener for v2 progress** - Subscribe to `import:v2:progress` in App.svelte and update the import store

## Implementation Plan

### Step 1: Update Orchestrator Progress Tracking

**File:** `packages/desktop/electron/services/import/orchestrator.ts`

Track `filesProcessed` incrementally:
- After hash step completes for each file, increment count
- Emit progress after each file, not just after step completion

Current flow emits progress per-step. Change to emit per-file within steps.

### Step 2: Add Preload Bridge Method

**File:** `packages/desktop/electron/preload/index.ts`

Add under the import namespace:
```javascript
onImportV2Progress: (callback) => {
  ipcRenderer.on('import:v2:progress', (_, progress) => callback(progress));
  return () => ipcRenderer.removeAllListeners('import:v2:progress');
}
```

### Step 3: Add TypeScript Type Definition

**File:** `packages/desktop/src/types/electron.d.ts`

Add type for the new callback method in the import namespace.

### Step 4: Update Renderer to Listen for V2 Progress

**File:** `packages/desktop/src/App.svelte`

In `onMount()`, add listener:
```typescript
const unsubscribeV2 = window.electron.import.onImportV2Progress((progress) => {
  importStore.updateProgress(progress.filesProcessed, progress.totalFiles);
});
```

Clean up in `onDestroy()`.

### Step 5: Map Progress Fields to Store

**File:** `packages/desktop/src/stores/import-store.ts`

Ensure `updateProgress(current, total)` correctly maps to:
- `processedFiles` = current
- `totalFiles` = total

## Files Changed

| File | Change |
|------|--------|
| `electron/services/import/orchestrator.ts` | Track filesProcessed incrementally |
| `electron/preload/index.ts` | Add `onImportV2Progress()` method |
| `src/types/electron.d.ts` | Add type definition |
| `src/App.svelte` | Add v2 progress listener |
| `src/stores/import-store.ts` | Verify updateProgress mapping (may be correct already) |

## Testing

1. Import a batch of 10+ files
2. Verify progress bar shows `1/10`, `2/10`, etc. incrementally
3. Verify progress updates during each step (scan, hash, copy)
4. Verify cleanup of listeners on component destroy

## Alternatives Considered

### A. Reuse legacy `media:import:progress` channel
- **Rejected:** Would require refactoring the orchestrator to use legacy event format, mixing concerns

### B. Only update progress per-step, not per-file
- **Rejected:** Would still show `0/N` during long scanning/hashing steps, poor UX

## Consequences

- Users see real-time file count progress during imports
- Slightly more IPC traffic (per-file vs per-step events)
- Cleaner separation between legacy and v2 import pipelines

---

## Approval

- [x] User approved plan
- [x] Implementation complete
- [ ] Testing verified
