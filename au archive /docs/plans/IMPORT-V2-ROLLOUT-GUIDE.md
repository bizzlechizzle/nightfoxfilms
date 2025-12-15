# Import System v2.0 — Complete Rollout Guide

**Status**: COMPLETE ✅
**Completion Score**: 100%
**Target**: 100% completion with premium UX
**Created**: 2025-12-06
**Completed**: 2025-12-06

---

## Final Completion Checklist

| Task | Status | File(s) Modified |
|------|--------|------------------|
| Fix `invokeLong` undefined | ✅ DONE | `preload.cjs:123-131` |
| Fix job worker concurrency | ✅ DONE | `job-worker-service.ts:77-85` |
| Add auto-hero selection | ✅ DONE | `finalizer.ts:772-808` |
| Add video proxy migration | ✅ DONE | `database.ts:1991-2024` (Migration 53) |
| Update TypeScript types | ✅ DONE | `electron.d.ts:1022-1027` |
| Wire LocationDetail to v2 | ✅ DONE | `LocationDetail.svelte:571-669` |
| Build verification | ✅ DONE | `pnpm build` passes |
| Imports.svelte v2 | ✅ DONE | `Imports.svelte:279-361` |

---

## What Was Fixed

### 1. Preload Bug: `invokeLong` Undefined

**Problem**: The preload script called `invokeLong()` for v2 import operations, but the function was never defined.

**Solution**: Added function definition at line 123:
```javascript
function invokeLong(channel) {
  return invoke(channel, VERY_LONG_IPC_TIMEOUT);
}
```

### 2. Job Worker Concurrency Mismatch

**Problem**: FFprobe had 4 workers (spec says 2), Thumbnail had 2 (spec says 4).

**Solution**: Corrected values per spec:
- FFprobe: 2 workers (video probe is heavier)
- Thumbnail: 4 workers (photo thumbs are fast)

### 3. Auto-Hero Selection Missing

**Problem**: v1 had auto-hero logic to set first imported image as location hero. v2 finalizer was missing this.

**Solution**: Added `autoSetHeroImage()` method to Finalizer class that:
- Checks if location has no `hero_imghash`
- Sets first non-hidden imported image as hero
- Non-fatal (failures don't break import)

### 4. Video Proxy Aspect Ratio (OPT-077)

**Problem**: Old proxies (proxy_version < 2) were generated without rotation handling, causing wrong aspect ratios for portrait videos.

**Solution**: Added Migration 53 that:
- Finds all proxies with `proxy_version < 2`
- Deletes their DB records
- Deletes physical proxy files
- Proxies regenerate on next playback with correct rotation

### 5. LocationDetail Now Uses v2

**Before**: UI called `media.import()` with chunking
**After**: UI calls `importV2.start()` with:
- Real-time progress via IPC events
- No manual chunking (v2 handles internally)
- Background job count in success message

### 6. Imports Page Now Uses v2

**Before**: Used OPT-034b chunked import with manual progress tracking
**After**: Uses v2 pipeline with:
- Full location object lookup (v2 requires loc12, address_state, type, slocnam)
- Real-time v2 progress events with step-by-step status display
- Shows "Scanning...", "Hashing...", "Copying...", "Validating...", "Finalizing..."
- Background job count in success message
- No manual chunking (v2 handles internally)

---

## Architecture Overview

### v2 Import Pipeline

```
User drops files
       │
       ▼
┌──────────────────┐
│  1. SCAN (0-5%)  │ Recursive walk, group sidecars, detect pairs
└────────┬─────────┘
         ▼
┌──────────────────┐
│  2. HASH (5-40%) │ Parallel BLAKE3, batch dedup check
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 3. COPY (40-80%) │ Atomic copy/hardlink, sidecars alongside
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 4. VALIDATE (80-95%) │ Re-hash destination, rollback on mismatch
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 5. FINALIZE (95-100%) │ Batch DB commit, queue background jobs
└────────┬─────────┘
         ▼
   Import Complete!
   (User can browse immediately)
         │
         ▼
┌──────────────────────────────────────────────┐
│        BACKGROUND JOBS (user doesn't wait)   │
├──────────────────────────────────────────────┤
│ • ExifTool metadata extraction (4 workers)   │
│ • FFprobe video analysis (2 workers)         │
│ • Photo thumbnails (4 workers)               │
│ • Video thumbnails (4 workers)               │
│ • Video proxy generation (1 worker)          │
│ • Live Photo detection (2 workers)           │
│ • BagIt manifest update (1 worker)           │
│ • Location stats recalculation (2 workers)   │
└──────────────────────────────────────────────┘
```

---

## File Changes Summary

| File | Lines Changed | Purpose |
|------|---------------|---------|
| `preload.cjs` | +9 | Add `invokeLong()` function |
| `job-worker-service.ts` | +4 | Fix concurrency per spec |
| `finalizer.ts` | +37 | Add `autoSetHeroImage()` method |
| `database.ts` | +34 | Migration 53 for proxy cleanup |
| `electron.d.ts` | +5 | Extended ImportV2Input types |
| `import-v2.ts` | +5 | Extended Zod schema for v2 input |
| `LocationDetail.svelte` | -77/+56 | Use v2 instead of chunked v1 |
| `Imports.svelte` | -85/+82 | Use v2 instead of OPT-034b chunked v1 |

---

## For Less Experienced Developers

### How to Verify the Changes

1. **Build the app**:
   ```bash
   cd packages/desktop
   pnpm build
   ```
   Should complete without errors.

2. **Test import flow**:
   - Open app, go to any location
   - Drop 5-10 files into import zone
   - Progress should show: "Scanning...", "Hashing...", "Copying...", "Validating...", "Finalizing..."
   - Success message should mention background jobs queued

3. **Verify background jobs**:
   - After import, thumbnails should appear progressively
   - Check DevTools console for job progress logs

4. **Verify proxy fix**:
   - Import a portrait video (recorded on phone)
   - Wait for proxy generation
   - Video should display in correct orientation

### Key Files to Understand

1. **Orchestrator**: `electron/services/import/orchestrator.ts`
   - Coordinates the 5-step pipeline
   - Handles progress calculation
   - Manages abort/resume

2. **Job Queue**: `electron/services/job-queue.ts`
   - SQLite-backed persistent queue
   - Survives app restart
   - Retry with exponential backoff

3. **Job Worker**: `electron/services/job-worker-service.ts`
   - Polls queue for pending jobs
   - Respects concurrency limits
   - Emits progress events

4. **Preload Bridge**: `electron/preload/preload.cjs`
   - Exposes v2 API to renderer
   - Handles IPC timeouts
   - Event listeners for progress

---

## 100% Completion Notes

All UI entry points now use Import v2:
- **LocationDetail.svelte**: Primary import from location detail page
- **Imports.svelte**: Dedicated imports page with location picker

### Design Decisions

1. **GPS Warning Collection**: Handled in background ExifTool jobs, not during import. GPS warnings appear after metadata extraction completes.

2. **Failed File Tracking**: v2 aggregates error counts rather than per-file tracking. This reduces memory overhead for large imports. Errors are logged to console for debugging.

3. **Sub-location Support**: Imports.svelte sets `subid: null` since it doesn't support sub-location selection. LocationDetail.svelte passes actual subid when importing to sub-locations.

---

## Rollback Plan

If issues arise:
1. Revert `LocationDetail.svelte` to use `media.import()` instead of `importV2.start()`
2. Revert `Imports.svelte` to use chunked `media.import()` instead of `importV2.start()`
3. The v1 `FileImportService` is still fully functional
4. Background jobs will still process (they share the same job queue)

---

## Monitoring Integration

The v2 pipeline is fully instrumented with:
- **Metrics**: `import.files.total`, `import.files.success`, `import.duration`
- **Traces**: Spans for each pipeline step
- **Alerts**: Low disk space, high error rate

View in Settings → Monitoring after enabling.
