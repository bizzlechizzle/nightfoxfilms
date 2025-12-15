# OPT-079: Archive Purity Cleanup

**Status**: COMPLETE
**Created**: 2025-12-06
**Completed**: 2025-12-06
**Principle**: WE ARE AN ARCHIVE APP - WE COPY DATA, WE ARE NOT A STORAGE MANAGEMENT APP

---

## Problem Statement

The codebase contains vestiges of storage management features that violate our archive-first philosophy:

1. **Delete originals after import** - Storage management feature, not archival
2. **Symlink support** - Reference to external data, not owned copies
3. **Hardlink support** - Shared storage, violates independent copy guarantee

An archive application must:
- Always create independent copies of data
- Never delete source data (user's responsibility)
- Never create references that can break (symlinks to external locations)
- Never share storage blocks (hardlinks can cause data loss if one copy is modified)

---

## Audit Findings

### 1. Delete Originals Feature

| Location | Line(s) | Issue |
|----------|---------|-------|
| `phase-import-service.ts` | 826 | `data.options.delete_originals` parameter passed to executePhase4 |
| `import-manifest.ts` | 59 | `original_deleted?: boolean` field in ManifestFileEntry |
| `import-manifest.ts` | 304 | `original_deleted` in updateFile params |
| `import-manifest.ts` | 312 | Assignment of `original_deleted` |

**Impact**: Low - appears to be dead code not actually used, but exists in type definitions

### 2. Symlink Handling (KEEP - Security Feature)

| Location | Line(s) | Purpose |
|----------|---------|---------|
| `scanner.ts` | 221-283 | `isSymlinkOutsideRoot()` - SECURITY: blocks path traversal via symlinks |
| `scanner.ts` | 388-448 | Symlink detection during scan - prevents importing broken/external links |
| `scanner.test.ts` | 158-209 | Tests for symlink security blocking |

**Recommendation**: KEEP symlink blocking code - it's a **security feature** that prevents:
- Path traversal attacks via malicious symlinks
- Importing broken symlinks that would fail
- Following symlinks to external directories (data outside archive)

This is NOT about creating symlinks, it's about blocking malicious/problematic input.

### 3. Hardlink/Reflink Strategy

| Location | Line(s) | Issue |
|----------|---------|-------|
| `copier.ts` | 11-12 | Comment says hardlink removed, but... |
| `copier.ts` | 24-26 | `CopyStrategy = 'reflink' | 'copy'` - hardlink already removed! |
| `copier.ts` | 173-182 | `detectStrategy()` always returns 'reflink' |
| `copier.test.ts` | 200-201 | Test still mentions 'hardlink' in expected strategies |
| `database.types.ts` | 599 | Comment says `'hardlink' | 'reflink' | 'copy'` |
| `index.ts` | 7 | Comment mentions "hardlink/reflink/copy" |
| `scanner.ts` | 562 | Comment "OPT-078: Simplified - always estimate as copy speed (no hardlinks)" |

**Current State**: Hardlink was ALREADY removed in OPT-078! But dead code/comments remain.

### 4. Reflink (Copy-on-Write) - KEEP

**Reflink is ACCEPTABLE** because:
- It creates an independent copy (not a reference like symlink)
- Changes to one copy don't affect the other (unlike hardlink)
- It's just a space optimization by the filesystem
- If the source is deleted, our copy remains intact
- `COPYFILE_FICLONE` flag in Node.js: "Use CoW if available, regular copy otherwise"

---

## Cleanup Plan

### Phase 1: Remove Delete Originals Code

**Files to modify:**

1. **`import-manifest.ts`**
   - Line 59: Remove `original_deleted?: boolean;` from ManifestFileEntry
   - Line 304: Remove `original_deleted?: boolean;` from updateFile params
   - Line 312: Remove `if (updates.original_deleted !== undefined)...`

2. **`phase-import-service.ts`**
   - Line 826: Remove `data.options.delete_originals` parameter from executePhase4 call
   - Check executePhase4 signature and remove the parameter if it accepts it

### Phase 2: Clean Up Dead Hardlink References

**Files to modify:**

1. **`copier.test.ts`**
   - Line 200-201: Remove 'hardlink' from expected strategies array
   - Change to `expect(['reflink', 'copy']).toContain(result.strategy);`

2. **`database.types.ts`**
   - Line 599: Update comment from `'hardlink' | 'reflink' | 'copy'` to `'reflink' | 'copy'`

3. **`index.ts`**
   - Line 7: Update comment from "hardlink/reflink/copy" to "reflink/copy"

### Phase 3: Verify No New Dead Code

After changes, verify:
- `pnpm build` passes
- No TypeScript errors
- No runtime errors in import flow

---

## What We Are NOT Removing

1. **Symlink blocking in scanner.ts** - Security feature, prevents attacks
2. **Reflink in copier.ts** - Acceptable optimization, creates independent copies
3. **copy_strategy field in database** - Tracks how file was copied (reflink vs copy)

---

## Files Changed Summary (Proposed)

| File | Change Type | Lines Affected |
|------|-------------|----------------|
| `import-manifest.ts` | Remove dead code | ~3 lines |
| `phase-import-service.ts` | Remove parameter | ~1-2 lines |
| `copier.test.ts` | Fix test expectation | ~2 lines |
| `database.types.ts` | Fix comment | ~1 line |
| `services/import/index.ts` | Fix comment | ~1 line |

**Total: ~8-10 lines of cleanup**

---

## Clone Error Investigation

The error "An object could not be cloned" is an IPC serialization error, not related to the features above. This happens when:
- Passing non-serializable objects (functions, Kysely instances, AbortControllers) over IPC
- Usually in the result object returned from `import:v2:start`

This is a **separate issue** that needs its own investigation after this cleanup.

---

## Execution Summary

### IPC Clone Error Fix

Fixed "An object could not be cloned" error by converting `Date` objects to ISO strings:

| File | Change |
|------|--------|
| `orchestrator.ts:76-77` | `startedAt: string`, `completedAt?: string` |
| `orchestrator.ts:917-918` | Convert dates with `.toISOString()` |
| `orchestrator.ts:931,956` | ResumableSessions also fixed |
| `electron.d.ts:1086` | Updated ResumableSession type |
| `job-queue.ts:45-47` | `Job.createdAt`, `startedAt`, `completedAt` → `string` |
| `job-queue.ts:436` | `getDeadLetterQueue.failedAt` → `string` |
| `job-queue.ts:533-535` | `mapRowToJob` keeps strings (no Date conversion) |
| `job-queue.ts:458` | Dead letter return keeps string (no Date conversion) |

### Phase 1: Delete Originals Removed

| File | Change |
|------|--------|
| `import-manifest.ts:59` | Removed `original_deleted?: boolean` field |
| `import-manifest.ts:303,310` | Removed from updateFileDump params |
| `phase-import-service.ts:826` | Removed `delete_originals` parameter |

### Phase 2: Hardlink Dead Code Cleaned

| File | Change |
|------|--------|
| `copier.test.ts:200-201` | Removed 'hardlink' from test expectations |
| `database.types.ts:599` | Updated comment |
| `services/import/index.ts:7` | Updated comment |

### Build Verification

```
✓ built in 2.73s
```

---

## References

- OPT-078: Original hardlink removal (already done)
- CLAUDE.md: Archive-first philosophy
- docs/contracts/data-ownership.md: "All assets stay on disk"
