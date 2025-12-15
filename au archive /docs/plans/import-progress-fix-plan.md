# Import Progress 0% Bug Fix Plan

## Problem Statement

Imports appear to complete successfully (logs show "Step 7 complete" for database insert) but the UI progress bar is stuck at 0%. Records ARE being inserted into the database, but the progress display doesn't update.

## Root Cause Analysis

After auditing the import flow, the issue is a **timing mismatch**:

### How Progress Currently Works

1. User drops files → IPC handler calls `fileImportService.importFiles()`
2. Service processes each file through Steps 1-9
3. Progress callback `onProgress(i + 1, files.length, filename)` fires ONLY AFTER all 9 steps complete per file
4. Steps 8a (GPS auto-populate) and 8b (geocoding) run AFTER Step 7 (database insert)

### The Problem

- **Step 7** logs "complete" when database insert finishes
- **Steps 8a-8b** run AFTER Step 7 but BEFORE progress callback
- Step 8b (reverse geocoding) can take 2-5+ seconds per file
- Progress callback at line 285 only fires when ALL steps for a file complete
- If geocoding stalls or is slow, UI shows 0% even though DB inserts succeeded

### Visual Timeline

```
File 1: [Step 1-6: 200ms] [Step 7 DB: 1ms] [Step 8a GPS: 50ms] [Step 8b Geocode: 3000ms] → Progress fires
        ↑ Logs show "Step 7 complete"                                                      ↑ UI updates here

Time gap: 3+ seconds where UI shows 0% but DB has data
```

## Evidence from Logs

```
[FileImport] Step 7: Inserting database record...
insert into "imgs" (...) values (...)
[FileImport] Step 7 complete in 1 ms
[FileImport] Step 8a: Auto-populating location GPS from media EXIF...
```

The logs cut off at Step 8a, suggesting either:
1. Step 8a/8b is hanging
2. Step 8b geocoding is very slow
3. Progress never fires because post-DB steps don't complete

## Proposed Solutions

### Option A: Move Post-Processing Out of Critical Path (Recommended)

Move Steps 8a and 8b to run AFTER the progress callback fires. These are "best-effort" enrichments, not critical for import success.

**Changes:**
1. In `file-import-service.ts`, reorder so progress fires after Step 7
2. Run GPS auto-population and geocoding as fire-and-forget background tasks
3. Progress bar reflects actual file import completion (hash + copy + DB record)

**Pros:** Immediate fix, accurate progress, no blocking on slow geocoding
**Cons:** GPS/address enrichment may complete after import "finishes" (minor UX issue)

### Option B: Add Intermediate Progress Events

Create sub-step progress events so UI shows granular progress.

**Changes:**
1. Add new IPC event `media:import:step` with step name
2. UI shows current step: "Processing file 1/5: Geocoding..."
3. Progress bar advances per-step, not just per-file

**Pros:** Most informative UX
**Cons:** More complex, requires UI changes, more IPC chatter

### Option C: Add Timeout to Geocoding

Add aggressive timeout to Step 8b so it fails fast if geocoding is slow.

**Changes:**
1. Add 2-second timeout to geocoding call
2. Log warning but don't block import
3. Queue failed geocoding for later retry

**Pros:** Fixes immediate blocking issue
**Cons:** Doesn't solve root timing issue, geocoding may never complete

## Recommended Approach: Option A

The cleanest fix is Option A because:
1. Progress should reflect what the user cares about: "Is my file imported?"
2. GPS enrichment is a bonus, not a requirement
3. Simpler implementation with less risk
4. Aligns with "progress fires after work completes" pattern

## Implementation Steps

### Step 1: Audit Current Step 8a/8b Code
Read the exact implementation of auto-populate GPS and geocoding to understand dependencies.

### Step 2: Verify No Blocking Dependency
Confirm that progress can safely fire before GPS enrichment without breaking data integrity.

### Step 3: Refactor Import Service
Move the `onProgress()` callback to fire after Step 7 (database insert), before Steps 8a-8b.

### Step 4: Make Steps 8a-8b Non-Blocking
Convert to fire-and-forget with proper error handling (log failures, don't crash).

### Step 5: Test Import Flow
1. Import files with slow/no network → Progress should advance immediately after DB insert
2. Verify GPS auto-population still works (may complete slightly after progress shows 100%)
3. Verify geocoding errors don't crash import

### Step 6: Update Logs
Add log entry when progress fires vs when post-processing completes for debugging.

## Files to Modify

1. `packages/desktop/electron/services/file-import-service.ts`
   - Move `onProgress()` call to fire after Step 7
   - Convert Steps 8a-8b to non-blocking

## Out of Scope

- UI changes (progress bar component works correctly)
- IPC handler changes (passes callbacks correctly)
- Database schema changes (none needed)

## Risks

- **Low**: GPS enrichment timing slightly different (cosmetic)
- **Mitigated**: Error handling for async GPS tasks already exists

## Verification Checklist

- [ ] Import 5+ HEIC files with GPS EXIF → Progress advances per file
- [ ] Import files with no GPS → Progress advances per file
- [ ] Import with no network → Progress advances (geocoding silently skipped)
- [ ] Database records created with correct metadata
- [ ] No console errors during import
