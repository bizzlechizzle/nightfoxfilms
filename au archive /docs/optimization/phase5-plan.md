# Optimization Plan — v0.1.0

**Generated:** 2025-11-30
**Phase:** Post-Stabilization Optimization, Phase 5

---

## Scope

- **Critical issues:** MUST fix (8 selected for this release)
- **Major issues:** SHOULD fix (5 selected, highest impact)
- **Minor issues:** COULD fix (time permitting, 2 selected)

**Total Planned:** 15 fixes
**Estimated Time:** ~12 hours

---

## Phase 5A: Critical Fixes (Est: 8 hours)

### OPT-001: Add transactions to sublocation operations

- **Category**: Bug
- **File(s)**: `packages/desktop/electron/repositories/sqlite-sublocation-repository.ts`
- **Lines**: 95-163, 254-273
- **Current Code**:
```typescript
async create(input: CreateSubLocationInput): Promise<SubLocation> {
  await this.db.insertInto('slocs').values({...}).execute();
  if (input.is_primary) {
    await this.setPrimaryOnParent(input.locid, sub12);
  }
  await this.addToParentSublocs(input.locid, subid);
  // Multiple operations without transaction
}
```
- **Fixed Code**:
```typescript
async create(input: CreateSubLocationInput): Promise<SubLocation> {
  return await this.db.transaction().execute(async (trx) => {
    await trx.insertInto('slocs').values({...}).execute();
    if (input.is_primary) {
      await this.setPrimaryOnParentTrx(trx, input.locid, sub12);
    }
    await this.addToParentSublocsTrx(trx, input.locid, subid);
    return result;
  });
}
```
- **Testing**: Create sublocation, interrupt mid-operation, verify no orphans
- **Rollback**: Revert to non-transactional version

---

### OPT-005: Add transaction to reference map creation

- **Category**: Bug
- **File(s)**: `packages/desktop/electron/repositories/sqlite-ref-maps-repository.ts`
- **Lines**: 77-151
- **Current Code**:
```typescript
async create(input): Promise<RefMapWithPoints> {
  await this.db.insertInto('ref_maps').values({...}).execute();
  for (const point of input.points) {
    await this.db.insertInto('ref_map_points').values({...}).execute();
  }
}
```
- **Fixed Code**:
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
- **Testing**: Import ref map with many points, interrupt, verify rollback
- **Rollback**: Revert transaction wrapper

---

### OPT-006: Add try/catch to ensureDirectories()

- **Category**: Bug
- **File(s)**: `packages/desktop/electron/services/media-path-service.ts`
- **Lines**: 78-87
- **Current Code**:
```typescript
async ensureDirectories(): Promise<void> {
  for (const dir of [this.thumbnailsDir, this.previewsDir, this.postersDir]) {
    await fs.mkdir(dir, { recursive: true });
  }
}
```
- **Fixed Code**:
```typescript
async ensureDirectories(): Promise<void> {
  for (const dir of [this.thumbnailsDir, this.previewsDir, this.postersDir]) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create directory ${dir}: ${msg}`);
    }
  }
}
```
- **Testing**: Test with read-only directory
- **Rollback**: Remove try/catch

---

### OPT-007: Add try/catch to ExifTool close()

- **Category**: Bug
- **File(s)**: `packages/desktop/electron/services/exiftool-service.ts`
- **Lines**: 144-146
- **Current Code**:
```typescript
async close(): Promise<void> {
  await this.exiftool.end();
}
```
- **Fixed Code**:
```typescript
async close(): Promise<void> {
  try {
    await Promise.race([
      this.exiftool.end(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('ExifTool shutdown timeout')), 5000)
      )
    ]);
  } catch (error) {
    console.warn('[ExifTool] Shutdown error (ignored):', error);
  }
}
```
- **Testing**: Close app multiple times rapidly
- **Rollback**: Remove try/catch

---

### OPT-008: Add null check to LocationDetail

- **Category**: Bug
- **File(s)**: `packages/desktop/src/pages/LocationDetail.svelte`
- **Lines**: 980-982
- **Current Code**:
```svelte
<MediaViewer
  location={location}
  ...
/>
```
- **Fixed Code**:
```svelte
{#if location}
  <MediaViewer
    location={location}
    ...
  />
{/if}
```
- **Testing**: Navigate to LocationDetail with invalid ID
- **Rollback**: Remove guard

---

### OPT-016: Fix Atlas router subscription memory leak

- **Category**: Bug
- **File(s)**: `packages/desktop/src/pages/Atlas.svelte`
- **Lines**: 34-36
- **Current Code**:
```svelte
router.subscribe((route) => {
  // handle route
});
```
- **Fixed Code**:
```svelte
<script>
  import { onDestroy } from 'svelte';

  const unsubscribe = router.subscribe((route) => {
    // handle route
  });

  onDestroy(unsubscribe);
</script>
```
- **Testing**: Navigate to Atlas repeatedly, check memory in DevTools
- **Rollback**: Remove cleanup

---

### OPT-017: Fix Locations router subscription memory leak

- **Category**: Bug
- **File(s)**: `packages/desktop/src/pages/Locations.svelte`
- **Lines**: 32-70
- **Current Code**: Similar to Atlas
- **Fixed Code**: Same pattern - add onDestroy cleanup
- **Testing**: Navigate to Locations repeatedly
- **Rollback**: Remove cleanup

---

### OPT-034: Add IPC timeout wrapper

- **Category**: Gap
- **File(s)**: `packages/desktop/electron/preload/preload.cjs`
- **Current Code**:
```javascript
location: {
  findAll: (filters) => ipcRenderer.invoke('location:findAll', filters),
}
```
- **Fixed Code**:
```javascript
const DEFAULT_TIMEOUT = 30000; // 30 seconds

function withTimeout(promise, timeoutMs = DEFAULT_TIMEOUT) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('IPC timeout')), timeoutMs)
    )
  ]);
}

location: {
  findAll: (filters) => withTimeout(ipcRenderer.invoke('location:findAll', filters)),
}
```
- **Testing**: Test with slow operations
- **Rollback**: Remove timeout wrapper

---

## Phase 5B: Major Fixes (Est: 3.5 hours)

### OPT-004: Return warnings from fire-and-forget operations

- **Category**: Bug
- **File(s)**: `packages/desktop/electron/services/file-import-service.ts`
- **Lines**: 686-738
- **Approach**: Track warnings in ImportResult, don't use fire-and-forget
- **Testing**: Import file with geocoding disabled
- **Rollback**: Revert to fire-and-forget

---

### OPT-012: Track metadata extraction failures

- **Category**: Bug
- **File(s)**: `packages/desktop/electron/services/file-import-service.ts`
- **Lines**: 497-575
- **Approach**: Add `warnings` array to ImportResult
- **Testing**: Import corrupt file
- **Rollback**: Remove warnings array

---

### OPT-018: Fix toast timer leak

- **Category**: Bug
- **File(s)**: `packages/desktop/src/stores/toast-store.ts`
- **Lines**: 27-29
- **Current Code**:
```typescript
setTimeout(() => {
  this.dismiss(id);
}, timeout);
```
- **Fixed Code**:
```typescript
const timers = new Map<string, NodeJS.Timeout>();

show(message, options) {
  const id = generateId();
  const timer = setTimeout(() => {
    this.dismiss(id);
  }, timeout);
  timers.set(id, timer);
}

dismiss(id) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  // ... rest of dismiss logic
}
```
- **Testing**: Show/dismiss many toasts rapidly
- **Rollback**: Remove timer tracking

---

### OPT-027: Convert map-parser to async I/O

- **Category**: Performance
- **File(s)**: `packages/desktop/electron/services/map-parser-service.ts`
- **Lines**: 591-616
- **Current Code**:
```typescript
const content = fs.readFileSync(filePath, 'utf8');
```
- **Fixed Code**:
```typescript
const content = await fs.promises.readFile(filePath, 'utf8');
```
- **Testing**: Import large GeoJSON file
- **Rollback**: Revert to sync

---

### OPT-031: Consolidate getCurrentUser()

- **Category**: Practice
- **File(s)**:
  - `packages/desktop/electron/main/ipc-handlers/locations.ts`
  - `packages/desktop/electron/main/ipc-handlers/media-import.ts`
- **Approach**: Extract to shared service, cache result
- **Testing**: Create location, verify user tracked
- **Rollback**: Keep duplicates

---

## Phase 5C: Minor Fixes (Est: 0.5 hours)

### OPT-020: Fix incorrect store API usage

- **Category**: Bug
- **File(s)**: `packages/desktop/src/stores/thumbnail-cache-store.ts`
- **Line**: 27
- **Current Code**:
```typescript
get({ subscribe })
```
- **Fixed Code**:
```typescript
import { get } from 'svelte/store';
get(thumbnailCacheStore)
```
- **Testing**: Verify cache busting works
- **Rollback**: Revert

---

### OPT-028: Remove redundant BackupScheduler.initialize()

- **Category**: Performance
- **File(s)**: `packages/desktop/electron/main/index.ts`
- **Line**: 261
- **Current Code**: Duplicate call to initialize()
- **Fixed Code**: Remove the duplicate call
- **Testing**: App starts normally, backups still work
- **Rollback**: Restore call

---

## Dependencies

```
OPT-001 (transactions) → no dependencies
OPT-005 (ref map transactions) → no dependencies
OPT-006 (mkdir errors) → no dependencies
OPT-007 (exiftool close) → no dependencies
OPT-008 (null check) → no dependencies
OPT-016 (Atlas cleanup) → no dependencies
OPT-017 (Locations cleanup) → no dependencies
OPT-034 (IPC timeout) → no dependencies

OPT-004 (warnings) → depends on OPT-012 (same file)
OPT-012 (metadata warnings) → no dependencies
OPT-018 (toast timer) → no dependencies
OPT-027 (async map) → no dependencies
OPT-031 (consolidate user) → no dependencies

OPT-020 (store API) → no dependencies
OPT-028 (backup scheduler) → no dependencies
```

**Order of implementation:**
1. Phase 5A fixes (independent, can be parallelized)
2. OPT-012 then OPT-004 (dependency)
3. Rest of Phase 5B (independent)
4. Phase 5C fixes (independent)

---

## Risk Assessment

| Fix ID | Risk | Mitigation |
|--------|------|------------|
| OPT-001 | Transaction changes could affect timing | Test with concurrent operations |
| OPT-005 | Same as above | Test with large ref map imports |
| OPT-034 | Timeout could interrupt legitimate long operations | Use 30s default, allow override |
| OPT-004 | Change to ImportResult interface | Update all consumers |
| OPT-031 | Shared service could introduce coupling | Keep interface simple |

---

## Verification Checklist

After all fixes:

- [ ] `pnpm build` succeeds
- [ ] `pnpm -r lint` passes
- [ ] `pnpm -r test` passes
- [ ] App launches without console errors
- [ ] Import works end-to-end
- [ ] Map loads correctly
- [ ] No memory growth on repeated navigation
- [ ] Sublocations create/delete correctly

---

**PHASE 5 COMPLETE** — Plan ready: 8 critical, 5 major, 2 minor fixes. Est. 12 hours total. Ready for Phase 6.
