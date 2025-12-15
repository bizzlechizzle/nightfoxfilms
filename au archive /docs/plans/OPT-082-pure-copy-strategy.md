# OPT-082: Pure Copy Strategy - We Just Copy Like a Boss

**Status**: COMPLETE
**Created**: 2025-12-06
**Principle**: WE ARE AN ARCHIVE APP - WE COPY DATA. PERIOD.

---

## Executive Summary

Simplify the copy strategy to pure `fs.copyFile()`. Remove all complexity around:
- ~~rsync~~ (never existed, confirmed)
- ~~hardlink~~ (removed in OPT-078, dead code cleaned in OPT-079)
- ~~reflink/CoW~~ (REMOVING - unnecessary complexity)
- **symlink blocking** (KEEP - this is SECURITY code, not a copy strategy)

**The Goal**: One copy strategy. `fs.copyFile()`. Done.

---

## Current State Analysis

### What Exists Now

| Component | Location | Status |
|-----------|----------|--------|
| `CopyStrategy` type | `copier.ts:26` | `'reflink' \| 'copy'` |
| `detectStrategy()` | `copier.ts:176-183` | Always returns `'reflink'` |
| `tryCopyWithReflink()` | `copier.ts:255-258` | Uses `COPYFILE_FICLONE` flag |
| `tryCopy()` | `copier.ts:263-265` | Plain `fs.copyFile()` |
| Retry fallback | `copier.ts:240-244` | If reflink fails, retry with copy |
| `copy_strategy` field | `database.types.ts:599` | Stores strategy in DB |
| Test expectations | `copier.test.ts:200-201` | Checks for reflink or copy |

### What We're Keeping (SECURITY)

| Component | Location | Purpose |
|-----------|----------|---------|
| `isSymlinkOutsideRoot()` | `scanner.ts:260-285` | Blocks path traversal attacks |
| `validatePathWithinRoot()` | `scanner.ts:219-253` | Prevents `../` escapes |
| `symlinkBlocked` counter | `scanner.ts:221` | Security logging |
| Symlink checks in scan | `scanner.ts:388-391, 443-446` | Input sanitization |

**This is NOT about creating symlinks. This BLOCKS malicious symlinks during import.**

---

## Implementation Plan

### Phase 1: Simplify CopyStrategy Type

**File**: `packages/desktop/electron/services/import/copier.ts`

**Before**:
```typescript
export type CopyStrategy = 'reflink' | 'copy';
```

**After**:
```typescript
export type CopyStrategy = 'copy';
```

### Phase 2: Remove detectStrategy()

**File**: `copier.ts`

**Before** (lines 176-183):
```typescript
async detectStrategy(_files: HashedFile[], location: LocationInfo): Promise<CopyStrategy> {
  const destPath = this.buildLocationPath(location);
  await fs.mkdir(destPath, { recursive: true });
  return 'reflink';
}
```

**After**:
```typescript
async detectStrategy(_files: HashedFile[], location: LocationInfo): Promise<CopyStrategy> {
  const destPath = this.buildLocationPath(location);
  await fs.mkdir(destPath, { recursive: true });
  return 'copy';
}
```

### Phase 3: Simplify copyFile Method

**File**: `copier.ts`

**Before** (lines 212-244):
```typescript
if (strategy === 'reflink') {
  await this.tryCopyWithReflink(file.originalPath, tempPath);
} else {
  await this.tryCopy(file.originalPath, tempPath);
}
// ... retry logic if reflink fails
```

**After**:
```typescript
await this.tryCopy(file.originalPath, tempPath);
```

### Phase 4: Remove tryCopyWithReflink Method

**File**: `copier.ts`

**DELETE** lines 250-258:
```typescript
private async tryCopyWithReflink(source: string, dest: string): Promise<void> {
  await fs.copyFile(source, dest, constants.COPYFILE_FICLONE);
}
```

### Phase 5: Update Comments

**File**: `copier.ts` - Update header comment:
```typescript
/**
 * Copier - Atomic file copy (Step 3)
 *
 * OPT-082: Simplified to pure copy strategy
 * - fs.copyFile() for all copies
 * - Atomic temp-file-then-rename
 * - Archive path builder
 * - Progress reporting (40-80%)
 */
```

**File**: `index.ts` line 7 - Update comment:
```typescript
// 3. Copier - Atomic file copy (OPT-082: pure copy only)
```

### Phase 6: Update Database Comment

**File**: `database.types.ts` line 599:
```typescript
copy_strategy: string | null; // 'copy' only (OPT-082: reflink removed)
```

### Phase 7: Update Test

**File**: `copier.test.ts`

**Line 3**: Update comment
```typescript
* Tests for atomic copy and streaming callbacks
```

**Lines 200-201**: Update expectation
```typescript
// Strategy is always 'copy' (OPT-082: pure copy only)
expect(result.strategy).toBe('copy');
```

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `copier.ts` | Remove reflink, simplify to pure copy |
| `copier.test.ts` | Update test expectations and comments |
| `database.types.ts` | Update comment |
| `index.ts` | Update comment |

**Total: ~30 lines removed, ~10 lines modified**

---

## What We Are NOT Touching

| Component | Reason |
|-----------|--------|
| `isSymlinkOutsideRoot()` | Security - blocks attacks |
| `validatePathWithinRoot()` | Security - blocks `../` |
| Symlink detection in scanner | Security - input sanitization |
| PathValidator tests | Security tests must stay |

---

## Why Remove Reflink?

1. **Complexity without benefit**: Adds try/catch/retry logic for marginal disk savings
2. **Unpredictable behavior**: Works on APFS/Btrfs, fails silently elsewhere
3. **Archive principle**: We want independent copies, not filesystem tricks
4. **Debugging nightmare**: "It works on my Mac" issues
5. **One code path = fewer bugs**

---

## Verification Steps

1. `pnpm build` - must pass
2. `pnpm -r test` - all tests pass
3. Manual import test - files copy correctly
4. Check archive folder - files exist as independent copies

---

## Approval Request

Please confirm:
1. Remove reflink/CoW complexity
2. Keep symlink BLOCKING (security feature)
3. Pure `fs.copyFile()` for all operations

Respond with approval to proceed.
