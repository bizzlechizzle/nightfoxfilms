# OPT-081: Archive Purity Final Audit

**Status**: AUDIT COMPLETE - AWAITING APPROVAL
**Created**: 2025-12-07
**Principle**: WE ARE AN ARCHIVE APP - WE COPY DATA, WE ARE NOT A STORAGE MANAGEMENT APP

---

## Executive Summary

Full codebase audit completed for features that violate archive-first philosophy:
- **delete_originals**: FULLY REMOVED (no references found)
- **hardlink**: FULLY REMOVED (only comments documenting removal remain)
- **symlink**: SECURITY CODE - MUST KEEP (blocks path traversal attacks)

---

## Audit Results

### 1. Delete Originals Feature

**Status**: ✅ FULLY REMOVED

| Search Pattern | Files Found |
|---------------|-------------|
| `delete_originals` | 0 |
| `deleteOriginals` | 0 |

**Conclusion**: This feature was completely stripped in OPT-079. No remaining code.

---

### 2. Hardlink Feature

**Status**: ✅ FULLY REMOVED (Comments remain for documentation)

| File | Line | Type | Content |
|------|------|------|---------|
| `copier.test.ts` | 3 | Comment | "Tests for atomic copy, hardlink strategy..." |
| `copier.test.ts` | 200 | Comment | "hardlink removed per OPT-078" |
| `copier.ts` | 24-25 | Comment | "OPT-078: Simplified to reflink/copy only (hardlink removed)" |
| `copier.ts` | 174 | Comment | "no hardlinks" |
| `index.ts` | 7 | Comment | "OPT-078: hardlink removed" |
| `database.types.ts` | 599 | Comment | "hardlink removed per OPT-078" |
| `scanner.ts` | 562 | Comment | "OPT-078: Simplified - no hardlinks" |

**Recommendation**: Comments serve as documentation that feature was removed. They help future developers understand the architectural decision. KEEP comments but update test file line 3.

**Action Item** (MINOR):
- `copier.test.ts:3` - Update comment from "hardlink strategy" to remove misleading reference

---

### 3. Symlink Handling

**Status**: ⚠️ SECURITY CODE - MUST KEEP

| File | Lines | Purpose |
|------|-------|---------|
| `scanner.ts` | 221 | `symlinkBlocked` counter |
| `scanner.ts` | 225 | Comment: "Prevents path traversal attacks via symlinks" |
| `scanner.ts` | 232 | Uses `realpath()` to resolve symlinks safely |
| `scanner.ts` | 248 | Handles broken symlinks safely |
| `scanner.ts` | 255-285 | `isSymlinkOutsideRoot()` - BLOCKS external symlinks |
| `scanner.ts` | 388-391 | Skips external symlinks at root level |
| `scanner.ts` | 444-446 | Skips external symlinks during directory scan |

**Why This Code MUST Stay**:
1. **Security**: Prevents malicious symlinks from escaping the scan directory
2. **Path Traversal Prevention**: Blocks `../` attacks via symlink resolution
3. **Data Integrity**: Ensures we only import files from the intended source
4. **Error Handling**: Gracefully handles broken symlinks

**This is NOT about creating symlinks. It's about BLOCKING malicious symlinks during import.**

---

### 4. SQL LIMIT 1.0 Bug

**Status**: ⚠️ LIBRARY BEHAVIOR - NOT A CODE BUG

**Observation**: SQL output shows `limit 1.0` but code has `.limit(1)`

**Analysis**:
- Code at `job-queue.ts:202`: `.limit(1)` - integer literal
- TypeScript's `number` type doesn't distinguish int vs float
- Kysely or better-sqlite3 serializes as float

**Impact**: SQLite handles `1.0` the same as `1` - no functional bug

**Recommendation**: No action needed. This is cosmetic SQL output from the library.

---

## Implementation Plan

### Phase 1: Minor Comment Cleanup (OPTIONAL)

**File**: `copier.test.ts`
**Line**: 3
**Current**:
```typescript
 * Tests for atomic copy, hardlink strategy, and streaming callbacks
```
**Proposed**:
```typescript
 * Tests for atomic copy, copy strategy, and streaming callbacks
```

**Rationale**: Remove misleading "hardlink" reference in test file description

---

## What We Are NOT Removing

| Code | Location | Reason |
|------|----------|--------|
| Symlink blocking | `scanner.ts` | Security feature - prevents attacks |
| Reflink strategy | `copier.ts` | Acceptable CoW optimization |
| copy_strategy field | database | Tracks how file was copied |
| OPT-078 comments | various | Documents architectural decision |

---

## Verification Checklist

- [x] `delete_originals` - No references found
- [x] `hardlink` - Only documentation comments remain
- [x] `symlink` - Security code identified, must stay
- [x] `limit 1.0` - Library behavior, not a bug
- [x] Build passes

---

## Conclusion

**The archive purity cleanup is COMPLETE.**

The only remaining references to removed features are:
1. Comments documenting WHY they were removed (KEEP for future developers)
2. Security code that BLOCKS symlinks during import (KEEP for security)

**No action required** unless user wants to update the single test comment.

---

## Approval Request

Please confirm:
1. Keep symlink blocking code (security feature)
2. Keep documentation comments about removed features
3. Optional: Update `copier.test.ts` line 3 comment

Respond with approval to proceed or specify changes needed.

