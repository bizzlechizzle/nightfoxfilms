# Bug Hunt Report — v0.1.0

**Generated:** 2025-11-30
**Phase:** Post-Stabilization Optimization, Phase 1

---

## Summary

| Category | Count |
|----------|-------|
| Critical bugs | 8 |
| Major bugs | 12 |
| Minor bugs | 15 |
| Edge cases unhandled | 14 |
| **Total Issues** | **49** |

---

## Critical Bugs (Data Loss or Crash Risk)

### BUG-C001: Multi-Step Operations Without Transaction Boundaries

- **File**: `packages/desktop/electron/repositories/sqlite-sublocation-repository.ts`
- **Lines**: 95-163, 254-273
- **Trigger**: Create sub-location or set primary while concurrent operation runs
- **Impact**: Orphaned records, inconsistent parent state, lost sub-location references
- **Root Cause**: `create()` performs INSERT + multiple UPDATEs as separate statements without transaction wrapper

**Suggested Fix**:
```typescript
async create(input: CreateSubLocationInput): Promise<SubLocation> {
  return await this.db.transaction().execute(async (trx) => {
    await trx.insertInto('slocs').values({...}).execute();
    if (input.is_primary) {
      await this.setPrimaryOnParent(trx, input.locid, sub12);
    }
    await this.addToParentSublocs(trx, input.locid, subid);
    return result;
  });
}
```

---

### BUG-C002: JSON Array Lost Update Race Condition

- **File**: `packages/desktop/electron/repositories/sqlite-sublocation-repository.ts`
- **Lines**: 506-539
- **Trigger**: Two concurrent sub-location operations on same parent
- **Impact**: Sub-locations silently lost from `locs.sublocs` JSON array
- **Root Cause**: Read-mutate-write pattern without lock. Thread A and B read same state, both write, one overwrites the other.

**Suggested Fix**: Use SQL array operations or transaction with row locking:
```sql
UPDATE locs SET sublocs = json_insert(sublocs, '$[#]', ?)
WHERE locid = ? AND NOT json_inarray(sublocs, ?)
```

---

### BUG-C003: Hash Collision Check Not Atomic (TOCTOU)

- **File**: `packages/desktop/electron/repositories/sqlite-media-repository.ts`
- **Lines**: 111-118, 150-157, 189-196
- **Trigger**: Two imports with same SHA256 running concurrently
- **Impact**: Violates hashing contract; duplicate entries or constraint violations
- **Root Cause**: `imageExists()` check and `createImage()` insert are separate operations

**Suggested Fix**: Use `INSERT ... ON CONFLICT DO NOTHING` or wrap in transaction with serializable isolation.

---

### BUG-C004: Fire-and-Forget Async Without Error Context

- **File**: `packages/desktop/electron/services/file-import-service.ts`
- **Lines**: 686-703, 711-738
- **Trigger**: GPS auto-population or reverse geocoding fails after import returns
- **Impact**: Location stays in partial state; user never knows GPS update failed; inconsistent state
- **Root Cause**: `.then()/.catch()` chains run after function returns; no error propagation to caller

**Suggested Fix**: Emit progress event or return warning in ImportResult:
```typescript
return {
  success: true,
  warnings: ['GPS auto-population failed: [reason]'],
  // ...
};
```

---

### BUG-C005: Reference Map Creation Without Transaction

- **File**: `packages/desktop/electron/repositories/sqlite-ref-maps-repository.ts`
- **Lines**: 77-151
- **Trigger**: Import reference map with 100+ points, failure at point #47
- **Impact**: Partial import visible; map record exists but only 46 of 100 points
- **Root Cause**: INSERT map + N separate INSERT points without transaction wrapper

**Suggested Fix**:
```typescript
async create(input): Promise<RefMapWithPoints> {
  return await this.db.transaction().execute(async (trx) => {
    await trx.insertInto('ref_maps').values({...}).execute();
    for (const point of input.points) {
      await trx.insertInto('ref_map_points').values({...}).execute();
    }
    return result;
  });
}
```

---

### BUG-C006: Unhandled mkdir() Errors in Media Path Service

- **File**: `packages/desktop/electron/services/media-path-service.ts`
- **Lines**: 78-87, 93-96
- **Trigger**: Permission denied, disk full, or parent deleted during `ensureDirectories()`
- **Impact**: App crash during initialization; no recovery
- **Root Cause**: No try/catch around `fs.mkdir()` calls

**Suggested Fix**:
```typescript
async ensureDirectories(): Promise<void> {
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create directory ${dir}: ${error.message}`);
    }
  }
}
```

---

### BUG-C007: ExifTool close() Without Error Handling

- **File**: `packages/desktop/electron/services/exiftool-service.ts`
- **Lines**: 144-146
- **Trigger**: App shutdown with ExifTool process already closed or hanging
- **Impact**: App shutdown hangs or throws; process may be left running
- **Root Cause**: No try/catch around `exiftool.end()`

**Suggested Fix**:
```typescript
async close(): Promise<void> {
  try {
    await Promise.race([
      this.exiftool.end(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);
  } catch (error) {
    console.warn('[ExifTool] Shutdown error (ignored):', error);
  }
}
```

---

### BUG-C008: Missing Null Check Causes Runtime Crash

- **File**: `packages/desktop/src/pages/LocationDetail.svelte`
- **Lines**: 980-982
- **Trigger**: Open LocationDetail when `location` is null/undefined
- **Impact**: Runtime crash; blank page with console error
- **Root Cause**: `location` may be null but accessed without check in MediaViewer props

**Suggested Fix**:
```svelte
{#if location}
  <MediaViewer {location} ... />
{/if}
```

---

## Major Bugs (Broken Functionality)

### BUG-M001: Silent JSON Parsing Error

- **File**: `packages/desktop/electron/services/file-import-service.ts`
- **Lines**: 412-424
- **Trigger**: Import image with malformed EXIF JSON
- **Impact**: Motion Photo detection silently skipped; no logging
- **Root Cause**: `JSON.parse()` error caught with comment "Ignore parse errors"

**Suggested Fix**: Add warning log and metric tracking.

---

### BUG-M002: Duplicate Check Returns False on Error

- **File**: `packages/desktop/electron/services/file-import-service.ts`
- **Lines**: 779-814
- **Trigger**: Database locked or invalid transaction during duplicate check
- **Impact**: Caller assumes file is unique when check actually failed
- **Root Cause**: No try/catch; default `return false` on invalid type

**Suggested Fix**: Add try/catch; throw on error rather than return false.

---

### BUG-M003: Archive Path Copy Failure Not Wrapped

- **File**: `packages/desktop/electron/services/file-import-service.ts`
- **Line**: 873
- **Trigger**: Permission denied or disk full during `fs.copyFile()`
- **Impact**: Confusing error message; corrupted file may be left behind
- **Root Cause**: No try/catch around `fs.copyFile()`

**Suggested Fix**: Wrap with descriptive error; clean up partial files.

---

### BUG-M004: Metadata Extraction Silent Failure

- **File**: `packages/desktop/electron/services/file-import-service.ts`
- **Lines**: 497-575
- **Trigger**: ExifTool crash on corrupted file
- **Impact**: GPS data lost; no user notification; import appears successful
- **Root Cause**: Error caught and logged but not returned to caller

**Suggested Fix**: Return warning in ImportResult.

---

### BUG-M005: Thumbnail Generation Silent Failure

- **File**: `packages/desktop/electron/services/file-import-service.ts`
- **Lines**: 588-652
- **Trigger**: Corrupt RAW file or missing sharp binary
- **Impact**: Import succeeds but no thumbnails; user sees broken images
- **Root Cause**: Error caught but not propagated to ImportResult

---

### BUG-M006: Missing Foreign Key Verification in 10+ Handlers

- **Files**: Various IPC handlers
- **Handlers**: `sublocation:create`, `notes:create`, `projects:addLocation`, `bookmarks:create`, `media:import`, `location-authors:add`, `imports:create`
- **Trigger**: Create child record with non-existent parent ID
- **Impact**: Orphaned records; foreign key violation on strict mode
- **Root Cause**: No FK existence check before insert

---

### BUG-M007: Missing File Path Validation in Import Handlers

- **File**: `packages/desktop/electron/main/ipc-handlers/media-import.ts`
- **Lines**: 199-292, 294-387
- **Trigger**: Crafted file path outside archive boundary
- **Impact**: Could access files outside archive directory
- **Root Cause**: `filePath` validated as string but not against archive path

---

### BUG-M008: Memory Leak - Unsubscribed Router in Atlas

- **File**: `packages/desktop/src/pages/Atlas.svelte`
- **Lines**: 34-36
- **Trigger**: Navigate to Atlas page multiple times
- **Impact**: Router listeners accumulate; memory grows; eventual slowdown
- **Root Cause**: `router.subscribe()` return value discarded; no cleanup

**Suggested Fix**: Wrap in `$effect` with cleanup return.

---

### BUG-M009: Memory Leak - Unsubscribed Router in Locations

- **File**: `packages/desktop/src/pages/Locations.svelte`
- **Lines**: 32-70
- **Trigger**: Navigate to Locations page multiple times
- **Impact**: Same as BUG-M008
- **Root Cause**: No onDestroy cleanup; only onMount return

---

### BUG-M010: Toast Timer Leak

- **File**: `packages/desktop/src/stores/toast-store.ts`
- **Lines**: 27-29
- **Trigger**: Show and dismiss many toasts rapidly
- **Impact**: Orphaned setTimeout callbacks accumulate
- **Root Cause**: No timer cancellation mechanism on early dismiss

---

### BUG-M011: Race Condition in Import Cancel

- **File**: `packages/desktop/src/stores/import-store.ts`
- **Lines**: 83-106
- **Trigger**: Two concurrent cancel operations
- **Impact**: Wrong job cancelled; state desync
- **Root Cause**: `update()` extracts `importId`, async gap, then IPC call

---

### BUG-M012: Incorrect Store API Usage

- **File**: `packages/desktop/src/stores/thumbnail-cache-store.ts`
- **Line**: 27
- **Trigger**: Call `getVersion()` in non-reactive context
- **Impact**: Cache busting may fail silently
- **Root Cause**: `get({ subscribe })` instead of `get(store)`

---

## Minor Bugs (Annoyances)

### BUG-N001: Crypto Service Error Lacks File Context

- **File**: `packages/desktop/electron/services/crypto-service.ts`
- **Lines**: 26-28
- **Impact**: Raw OS error without file path; hard to debug

---

### BUG-N002: Path Functions No Input Validation

- **File**: `packages/desktop/electron/services/media-path-service.ts`
- **Lines**: 42-71
- **Impact**: Empty hash creates invalid bucket path

---

### BUG-N003: ExifTool extractBinaryTag Silent Null

- **File**: `packages/desktop/electron/services/exiftool-service.ts`
- **Lines**: 107-116
- **Impact**: Cannot distinguish "tag doesn't exist" from "ExifTool crashed"

---

### BUG-N004: Import Record randomUUID Import Location

- **File**: `packages/desktop/electron/services/file-import-service.ts`
- **Lines**: 1080, 1160
- **Impact**: Convention violation; import at end of file

---

### BUG-N005: File Deletion Failure Silent

- **File**: `packages/desktop/electron/services/file-import-service.ts`
- **Lines**: 743-749
- **Impact**: Original files accumulate if deletion fails

---

### BUG-N006: Region Recalculation Not Tied to Import Result

- **File**: `packages/desktop/electron/services/file-import-service.ts`
- **Lines**: 1105-1156
- **Impact**: Failed region calculation not reported to user

---

### BUG-N007: Component Missing Key in Each Loop

- **File**: `packages/desktop/src/pages/LocationDetail.svelte`
- **Lines**: 870-876
- **Impact**: Potential re-render issues; list item state bugs

---

### BUG-N008: GPS toFixed() on Null Value

- **File**: `packages/desktop/src/components/LocationMapSection.svelte`
- **Line**: 283
- **Impact**: Could crash on null GPS values

---

### BUG-N009: Import Progress Timeout Not Cleared

- **File**: `packages/desktop/src/pages/LocationDetail.svelte`
- **Line**: 696
- **Impact**: Timer may fire after component unmount

---

### BUG-N010: Map Double Event Listener Risk

- **File**: `packages/desktop/src/components/Map.svelte`
- **Lines**: 515, 912-915
- **Impact**: Event listener leak on repeated mount/unmount

---

### BUG-N011-N015: Various Missing Loading States

- **Files**: MediaViewer.svelte, ImportProgress.svelte, Imports.svelte
- **Impact**: Async operations show no loading indicator

---

## Unhandled Edge Cases

| Scenario | Expected Behavior | Actual Code Path | Bug? |
|----------|-------------------|------------------|------|
| Import 0 files | Show "no files selected" | Returns empty array silently | Minor |
| Import 1000+ files | Progress feedback, chunked | Processes sequentially, may timeout | Major |
| Import file with no EXIF | Import succeeds, no metadata | Works correctly | No |
| Import file with corrupt EXIF | Import succeeds, warning shown | Silent failure, no warning | Yes (BUG-M004) |
| Import duplicate file (same hash) | Skip or prompt user | Check may fail under load | Yes (BUG-C003) |
| Import while previous import running | Queue or reject | May cause race condition | Possible |
| Delete location with 100+ media | CASCADE delete, show progress | No progress indicator | Minor |
| Search with no results | Show empty state | Shows empty state | No |
| Search with special characters | Escape and search | Untested, possible SQL injection | Needs Testing |
| Map with 0 locations | Show empty map with message | Shows empty map, no message | Minor |
| Map with 1000+ locations | Cluster markers, maintain FPS | Clustering works, untested at scale | Needs Testing |
| GPS coordinates at 0,0 (Null Island) | Warn user, allow with confirmation | Accepts without warning | Minor |
| GPS coordinates at poles | Validate range, allow | No range validation | Minor |
| Very long location name (500+ chars) | Truncate or reject | Truncates in DB, no validation | Minor |
| Unicode in all text fields | Accept and display correctly | Generally works | No |
| Database locked (another process) | Retry or error message | Generic error message | Minor |
| Disk full during import | Friendly error, cleanup | Raw OS error | Minor |
| File deleted after import started | Skip with error | Throws uncaught exception | Major |
| Network timeout (online features) | Retry or graceful degradation | Untested timeout handling | Needs Testing |

---

## State Management Issues

| Issue Type | Locations Found | Severity |
|------------|-----------------|----------|
| Stale state after mutation | fire-and-forget GPS updates | Major |
| Race conditions (concurrent updates) | JSON array mutations, cancel import | Critical |
| Memory leaks (unsubscribed listeners) | Atlas, Locations router subscriptions | Major |
| Zombie processes (unclosed handles) | ExifTool timeout without kill | Medium |
| UI not updating after DB change | fire-and-forget operations | Major |
| Optimistic updates without rollback | None found | - |

---

## Data Integrity Risks

| Risk | Code Location | Mitigation Present? |
|------|---------------|---------------------|
| Partial write (crash mid-operation) | sublocation create, ref map create | No |
| Hash mismatch not detected | crypto-service stream errors | Partial |
| Foreign key violation possible | 10+ IPC handlers | No |
| Orphaned records possible | sublocation delete, location delete | Partial |
| Transaction not used where needed | Most multi-step repository operations | No |

---

## Recommendations

### Immediate (Before Release)

1. Add transactions to multi-step repository operations
2. Fix memory leaks in Atlas/Locations router subscriptions
3. Add try/catch to `ensureDirectories()` and `close()` methods
4. Add null checks in LocationDetail.svelte and LocationMapSection.svelte

### Next Sprint

1. Add warnings array to ImportResult for silent failures
2. Implement FK verification in IPC handlers
3. Add file path validation in import handlers
4. Fix toast timer and import cancel race conditions

### Backlog

1. Replace JSON array storage for sublocs with proper table
2. Add comprehensive error type differentiation in ExifTool service
3. Add input validation to all remaining IPC handlers
4. Implement retry logic for transient failures

---

**END OF BUG HUNT REPORT**
