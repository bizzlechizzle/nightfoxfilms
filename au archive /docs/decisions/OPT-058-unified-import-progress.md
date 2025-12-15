# OPT-058: Unified Import Progress Bar

**Status**: Approved
**Author**: Claude
**Date**: 2025-12-02
**Scope**: Import progress reporting across chunked file batches

---

## Problem Statement

The current import system shows a confusing looping 0-100% progress bar because:

1. **Client-side chunking** (`LocationDetail.svelte:664-666`, `Imports.svelte:279-280`) splits files into chunks of 50 for memory management (OPT-034b)
2. **Each chunk triggers a separate IPC call** to `media:import`
3. **Per-chunk progress events** from `file-import-service.ts` report `current/total` within that chunk only
4. **Confusing UX**: User sees bar go 0→100% repeatedly (e.g., 3 times for 150 files)

### Current Flow (Broken)

```
User drops 150 files
  └─> Frontend splits into 3 chunks: [0-49], [50-99], [100-149]

  Chunk 1: media:import([50 files])
    └─> Progress: 1/50, 2/50, ... 50/50 (100%)  ← Bar hits 100%!
    └─> IPC events update store with chunk-relative values
    └─> Post-chunk: importStore.updateProgress(50, 150) ← Corrects to 33%

  Chunk 2: media:import([50 files])
    └─> Progress: 1/50, 2/50, ... 50/50 (100%)  ← Bar shows 2%→100% again!
    └─> Post-chunk: importStore.updateProgress(100, 150) ← Corrects to 67%

  Chunk 3: ...same pattern...
```

**Root cause**: Two competing progress updates:
1. Real-time IPC events from backend (per-chunk values)
2. Post-chunk aggregate update from frontend (correct values)

---

## Options Analysis

### Option A: Offset-Based Progress (SELECTED)

Pass `chunkOffset` and `totalOverall` to backend so IPC events report global index.

**Pros**:
- Minimal change footprint
- Real-time per-file progress preserved
- Backward compatible (defaults work for old callers)

**Cons**:
- Changes IPC contract (adds optional params)

### Option B: Frontend-Only Fix

Ignore backend progress events entirely; only use post-chunk aggregates.

**Pros**:
- No backend changes

**Cons**:
- Progress jumps by 50 instead of 1 (less granular)
- Worse UX for large imports

### Option C: Move Chunking to Backend

Single IPC call with all files; backend chunks internally.

**Pros**:
- Cleaner frontend
- Single progress stream

**Cons**:
- Risk of IPC timeout for very large batches
- Major refactor of file-import-service.ts
- Memory concerns that OPT-034b was designed to prevent

**Decision**: Option A provides best UX with minimal risk.

---

## Implementation Plan

### Phase 1: Fix Type Definition Drift

**Problem**: `electron.d.ts` is missing fields that `media-import.ts` already accepts.

**File**: `packages/desktop/src/types/electron.d.ts`

Current (line 259-265):
```typescript
import: (input: {
  files: Array<{ filePath: string; originalName: string }>;
  locid: string;
  subid?: string | null;
  auth_imp: string | null;
  deleteOriginals: boolean;
}) => Promise<unknown>;
```

Updated:
```typescript
import: (input: {
  files: Array<{ filePath: string; originalName: string }>;
  locid: string;
  subid?: string | null;
  auth_imp: string | null;
  deleteOriginals?: boolean;
  // Migration 26: Contributor tracking
  is_contributed?: number;
  contribution_source?: string | null;
  // OPT-058: Unified progress across chunks
  chunkOffset?: number;
  totalOverall?: number;
}) => Promise<{
  total: number;
  imported: number;
  duplicates: number;
  skipped: number;
  sidecarOnly: number;
  errors: number;
  importId: string;
  results: Array<{
    success: boolean;
    hash: string;
    type: 'image' | 'video' | 'map' | 'document' | 'skipped' | 'sidecar';
    duplicate: boolean;
    error?: string;
  }>;
}>;
```

### Phase 2: Backend - Extend IPC Schema

**File**: `packages/desktop/electron/main/ipc-handlers/media-import.ts`

Add to `ImportInputSchema`:
```typescript
// OPT-058: Unified progress across chunks
chunkOffset: z.number().int().min(0).default(0),
totalOverall: z.number().int().min(1).optional(),
```

### Phase 3: Backend - Adjust Progress Callback

**File**: `packages/desktop/electron/main/ipc-handlers/media-import.ts`

Update progress callback (line ~363):
```typescript
(current, total, filename) => {
  try {
    if (_event.sender && !_event.sender.isDestroyed()) {
      // OPT-058: Adjust for chunk offset to report global progress
      const adjustedCurrent = validatedInput.chunkOffset + current;
      const adjustedTotal = validatedInput.totalOverall || total;
      _event.sender.send('media:import:progress', {
        current: adjustedCurrent,
        total: adjustedTotal,
        filename,
        importId
      });
    }
  } catch (e) { console.warn('[media:import] Failed to send progress:', e); }
}
```

### Phase 4: Frontend - Pass Chunk Metadata

**Files**:
- `packages/desktop/src/pages/LocationDetail.svelte`
- `packages/desktop/src/pages/Imports.svelte`

Update IPC call in chunk loop:
```typescript
const result = await window.electronAPI.media.import({
  files: filesForImport,
  locid: location.locid,
  subid: subId || null,
  auth_imp: author,
  deleteOriginals: false,
  is_contributed: contributed,
  contribution_source: source || null,
  // OPT-058: Unified progress across chunks
  chunkOffset: chunkIdx * IMPORT_CHUNK_SIZE,
  totalOverall: filePaths.length,
});
```

### Phase 5: Frontend - Remove Redundant Progress Update

**Files**: Same as Phase 4

Remove or comment out post-chunk `importStore.updateProgress()` call since real-time IPC events now report correct global values.

---

## Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| Old frontend calling new backend | `chunkOffset` defaults to 0, `totalOverall` falls back to chunk size - works as before |
| New frontend calling old backend | Extra params ignored by old schema - works as before |

**Risk**: None. All changes are additive with safe defaults.

---

## Files Modified

| File | Change |
|------|--------|
| `packages/desktop/src/types/electron.d.ts` | Sync import types with actual schema + add new params |
| `packages/desktop/electron/main/ipc-handlers/media-import.ts` | Add `chunkOffset`, `totalOverall`; adjust progress callback |
| `packages/desktop/src/pages/LocationDetail.svelte` | Pass chunk metadata to IPC |
| `packages/desktop/src/pages/Imports.svelte` | Pass chunk metadata to IPC |

---

## Testing Checklist

### Manual Tests
- [ ] Import 10 files (single chunk) - progress 0→100% smooth, no jumps
- [ ] Import 75 files (2 chunks) - progress 0→67%→100% without reset to 0%
- [ ] Import 150 files (3 chunks) - progress 0→33%→67%→100% without reset
- [ ] Cancel mid-import - progress stops at current value
- [ ] Error on file 25 of 75 - progress continues, error count shown

### Verification
- [ ] Console logs show `current: 51, total: 150` (not `current: 1, total: 50`) for chunk 2
- [ ] No TypeScript errors in IDE
- [ ] `pnpm -r lint` passes
- [ ] App builds successfully

---

## Issue 2: Autofill.enable DevTools Errors

### Analysis

The errors in the log:
```
[15952:1202/171838.602741:ERROR:CONSOLE(1)] "Request Autofill.enable failed..."
```

These are from Chromium DevTools protocol internals, not AU Archive code.

### Impact: NONE

- Do not affect import functionality
- Cosmetic console noise
- Come from Chromium, not our code

### Decision: No Action Required

Suppressing these would require patching Electron/Chromium - out of scope.

---

## Issue 3: Video Proxy Aspect Ratio (720x406)

### Analysis

Source: 1280x720 (AR = 1.7778)
Output: 720x406 (AR = 1.7734)
Error: **0.25%** - imperceptible to human eye

Alternative 720x404 has AR = 1.7822, also 0.25% error in opposite direction.

### Decision: No Fix Needed

The current implementation is mathematically equivalent. H.264 requires even dimensions, and any rounding introduces ~0.25% error. This is standard behavior.

---

## Completion Criteria

- [ ] All phases implemented
- [ ] All tests pass
- [ ] Code audited against CLAUDE.md
- [ ] Committed to GitHub with proper message
- [ ] No user prompts during implementation
