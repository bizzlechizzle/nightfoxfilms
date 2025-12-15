# OPT-086: Test Suite Modernization for Import v2

**Date:** 2025-12-07
**Status:** Implemented
**Follows:** OPT-085 (Thumbnail and Video Proxy Fixes)
**Impact:** All 402 unit tests now pass

---

## Overview

After fixing the thumbnail and video proxy bugs in OPT-085, the test suite required updates to:
1. Match the new BLAKE3 hashing (16-char vs 64-char hashes)
2. Properly mock native modules (better-sqlite3) that don't work in Vitest's Node context
3. Update test expectations for parallel processing behavior
4. Add missing method stubs (transaction API, getWorkerId)

---

## Changes Summary

### 1. Test Configuration (`vitest.config.ts`)

**Problem:** Integration tests require Electron's Node context with native modules compiled for Electron.

**Solution:** Exclude integration tests from default test run:

```typescript
exclude: [
  '**/node_modules/**',
  '**/dist/**',
  '**/dist-electron/**',
  // Integration tests require Electron context with native modules
  'electron/__tests__/integration/**',
],
```

**Why?** better-sqlite3 is compiled for Electron's Node version (v127), not the system Node (v133). Running integration tests requires `electron-rebuild` first.

---

### 2. Scanner Tests (`scanner.test.ts`)

**Problem:** Tests expected properties `blockedPaths` and `blockedSymlinks` that don't exist in `ScanResult`.

**Fix:** Updated test to use existing properties:

```typescript
// BEFORE (wrong - properties don't exist):
expect(result.blockedPaths).toBeGreaterThanOrEqual(0);
expect(result.blockedSymlinks).toBeGreaterThanOrEqual(0);

// AFTER (correct - check byType.skipped or file existence):
if (aae) {
  expect(aae.shouldSkip).toBe(true);
} else {
  expect(result.byType.skipped).toBeGreaterThanOrEqual(0);
}
```

**Why?** Scanner security logs to console but doesn't expose blocked counts in the return type.

---

### 3. Hasher Tests (`hasher.test.ts`)

**Problem:** Mocks missing the `.execute()` method in the Kysely chain.

**Fix:** Added complete mock chain:

```typescript
mockDb = {
  selectFrom: vi.fn().mockImplementation((table: string) => ({
    select: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        execute: vi.fn().mockImplementation(async () => []),  // Added
        executeTakeFirst: vi.fn().mockImplementation(async () => null),
      }),
    }),
    selectAll: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue([]),  // Added
        executeTakeFirst: vi.fn().mockResolvedValue(null),
      }),
    }),
  })),
};
```

**Why?** Hasher uses `execute()` to get arrays and `executeTakeFirst()` for single records.

---

### 4. Job Queue Tests (`job-queue.test.ts`)

**Problem:**
1. Logger service tries to access `app.getPath()` which requires Electron
2. Test calls `getWorkerId()` which didn't exist

**Fix 1:** Mock Electron app and Logger:

```typescript
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-app'),
    on: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('../../services/logger-service', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  })),
  getLogger: vi.fn().mockReturnValue({ /* same */ }),
}));
```

**Fix 2:** Added `getWorkerId()` method to JobQueue class:

```typescript
// Added to job-queue.ts
getWorkerId(): string {
  return this.workerId;
}
```

**Why?** The test validates worker ID configuration, which requires a public getter.

---

### 5. Finalizer Tests (`finalizer.test.ts`)

**Problem:**
1. Same Electron/Logger mocking needed
2. Missing `transaction()` mock for Kysely's transaction API

**Fix:** Added Electron/Logger mocks plus transaction mock:

```typescript
mockDb = {
  // ... other mocks ...

  // Mock Kysely transaction API
  transaction: vi.fn().mockReturnValue({
    execute: vi.fn().mockImplementation(async (callback) => {
      const trx = {
        insertInto: mockDb.insertInto,
        selectFrom: mockDb.selectFrom,
      };
      return await callback(trx);
    }),
  }),
};
```

**Why?** Finalizer uses `db.transaction().execute()` for atomic batch inserts.

---

### 6. Copier Tests (`copier.test.ts`)

**Problem:** Test assumed specific ordering of parallel file completion callbacks.

**Original test:**
```typescript
// Expected first callback to get index 0
expect(onFileComplete).toHaveBeenNthCalledWith(
  1,
  expect.objectContaining({ archivePath: expect.any(String) }),
  0,  // First file = index 0
  3
);
```

**Fix:** Removed ordering assumption:
```typescript
// Parallel processing means files complete in any order
onFileComplete.mock.calls.forEach((call) => {
  expect(call[0]).toMatchObject({ archivePath: expect.any(String) });
  expect(call[1]).toBeGreaterThanOrEqual(0);
  expect(call[1]).toBeLessThan(3);
  expect(call[2]).toBe(3);
});
```

**Why?** With 24 parallel workers, file completion order is non-deterministic.

---

### 7. Crypto Service Tests (`crypto-service.test.ts`)

**Problem:** Tests expected 64-char SHA256 hashes, but code now uses 16-char BLAKE3.

**Fix:** Updated expectations:
```typescript
// BEFORE (SHA256):
expect(hash1).toHaveLength(64);
expect(hash1).toMatch(/^[a-f0-9]{64}$/);

// AFTER (BLAKE3):
expect(hash1).toHaveLength(HASH_LENGTH);  // 16
expect(hash1).toMatch(/^[a-f0-9]{16}$/);
```

**Why?** BLAKE3 migration (ADR-045) uses truncated 64-bit output for better performance.

---

## Test Files Modified

| File | Issue | Fix |
|------|-------|-----|
| `vitest.config.ts` | Integration tests fail | Exclude from default run |
| `scanner.test.ts` | Non-existent properties | Use byType.skipped |
| `hasher.test.ts` | Missing .execute() | Complete mock chain |
| `job-queue.test.ts` | Electron/Logger deps | Mock + add getWorkerId() |
| `finalizer.test.ts` | Electron/Logger/transaction | Mock all three |
| `copier.test.ts` | Ordering assumption | Don't assume order |
| `crypto-service.test.ts` | Hash length | Use HASH_LENGTH constant |

---

## Source Files Modified

| File | Change |
|------|--------|
| `job-queue.ts` | Added `getWorkerId()` method |

---

## Running Tests

```bash
# Unit tests only (default, fast)
pnpm test

# With coverage
pnpm test:coverage

# Integration tests (requires electron-rebuild first)
pnpm --filter desktop rebuild
pnpm test:integration
```

---

## Common Test Mocking Patterns

### Pattern 1: Mock Electron App
```typescript
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-app'),
    on: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
  },
}));
```

### Pattern 2: Mock Logger Service
```typescript
vi.mock('../../services/logger-service', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  })),
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  }),
}));
```

### Pattern 3: Mock Kysely Database
```typescript
const mockDb = {
  selectFrom: vi.fn().mockImplementation((table) => ({
    select: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue([]),
        executeTakeFirst: vi.fn().mockResolvedValue(null),
      }),
    }),
    selectAll: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue([]),
        executeTakeFirst: vi.fn().mockResolvedValue(null),
      }),
    }),
  })),
  insertInto: vi.fn().mockImplementation((table) => ({
    values: vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({}),
      onConflict: vi.fn().mockReturnValue({
        doNothing: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue({}),
        }),
      }),
    }),
  })),
  updateTable: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({ numUpdatedRows: BigInt(1) }),
      }),
    }),
  }),
  transaction: vi.fn().mockReturnValue({
    execute: vi.fn().mockImplementation(async (cb) => cb(mockDb)),
  }),
};
```

---

## Troubleshooting

### "NODE_MODULE_VERSION mismatch"
Native modules compiled for different Node version. Run:
```bash
pnpm --filter desktop rebuild
```

### "Cannot read properties of undefined (reading 'getPath')"
Missing Electron mock. Add the Electron app mock at the top of your test file.

### "execute is not a function"
Incomplete Kysely mock. Ensure your mock includes the full chain ending in `.execute()`.

### "this.db.transaction is not a function"
Missing transaction mock. Add the transaction mock to your mockDb object.

---

## Test Results

```
Test Files  13 passed (13)
     Tests  402 passed (402)
  Duration  514ms
```

All tests pass on clean build.
