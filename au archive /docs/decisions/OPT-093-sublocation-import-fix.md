# OPT-093: Sub-Location Import v2 Pipeline Fix

**Status:** Proposed
**Date:** 2025-12-07
**Author:** Claude (Audit)

---

## Executive Summary

**CRITICAL BUG**: Import v2 pipeline completely ignores `subid` parameter. All media imported to sub-locations is incorrectly linked to the host location instead.

The UI correctly sends `subid`, but the pipeline drops it at multiple points before finalizing to database.

---

## Root Cause Analysis

### The Bug Chain

```
UI (sends subid) → IPC Handler (validates but drops) → Orchestrator → Copier → Finalizer (hardcodes null)
```

| Layer | File | Line(s) | Status |
|-------|------|---------|--------|
| **UI** | `LocationDetail.svelte` | 629 | ✅ Correctly sends `subid: subId \|\| null` |
| **IPC Handler** | `import-v2.ts` | 106 | ✅ Validates `subid` in schema |
| **IPC Handler** | `import-v2.ts` | 165-172 | ❌ **BUG**: `subid` NOT passed to orchestrator |
| **Interface** | `copier.ts` | 86-92 | ❌ **BUG**: `LocationInfo` missing `subid` field |
| **Interface** | `finalizer.ts` | 74-80 | ❌ **BUG**: `LocationInfo` missing `subid` field |
| **Finalizer** | `finalizer.ts` | 274, 316, 360, 389, 456, 532, 610, 673 | ❌ **BUG**: `subid: null` hardcoded in all 8 insert locations |

### Why It Matters

When a user imports media to a sub-location:
1. User navigates to sub-location view (e.g., "Jackson Sanatorium / Main Building")
2. User drops files to import
3. UI correctly identifies `subId` from URL params
4. UI sends `subid` in import request
5. Handler validates `subid` exists (passes Zod validation)
6. Handler passes `location` object WITHOUT `subid` to orchestrator
7. Finalizer inserts all records with `subid: null`
8. **Result**: Media appears in host location, NOT sub-location

### Evidence from Database

Any media imported via Import v2 to a sub-location will have:
- `locid` = correct (host location ID)
- `subid` = NULL (should be sub-location ID)

This explains why "Jackson Sanatorium" sub-locations appear empty while the host shows all media.

---

## Proposed Fix

### Step 1: Add `subid` to `LocationInfo` interface (copier.ts)

**File:** `packages/desktop/electron/services/import/copier.ts`
**Lines:** 86-92

```typescript
// BEFORE
export interface LocationInfo {
  locid: string;
  loc12: string;
  address_state: string | null;
  type: string | null;
  slocnam: string | null;
}

// AFTER
export interface LocationInfo {
  locid: string;
  loc12: string;
  address_state: string | null;
  type: string | null;
  slocnam: string | null;
  subid: string | null;  // Sub-location ID for media assignment
}
```

### Step 2: Add `subid` to `LocationInfo` interface (finalizer.ts)

**File:** `packages/desktop/electron/services/import/finalizer.ts`
**Lines:** 74-80

Same change as Step 1 (duplicate interface definition).

### Step 3: Pass `subid` from IPC handler to orchestrator

**File:** `packages/desktop/electron/main/ipc-handlers/import-v2.ts`
**Lines:** 165-172

```typescript
// BEFORE
const result = await orchestrator.import(validated.paths, {
  location: {
    locid: validated.locid,
    loc12: validated.loc12,
    address_state: validated.address_state,
    type: validated.type,
    slocnam: validated.slocnam,
  },
  // ...
});

// AFTER
const result = await orchestrator.import(validated.paths, {
  location: {
    locid: validated.locid,
    loc12: validated.loc12,
    address_state: validated.address_state,
    type: validated.type,
    slocnam: validated.slocnam,
    subid: validated.subid ?? null,  // Pass sub-location ID
  },
  // ...
});
```

### Step 4: Update all finalizer inserts to use `location.subid`

**File:** `packages/desktop/electron/services/import/finalizer.ts`

Replace all 8 occurrences of `subid: null` with `subid: location.subid`:

| Line | Insert Type | Change |
|------|-------------|--------|
| 274 | imgs (insertMediaRecord) | `subid: location.subid` |
| 316 | vids (insertMediaRecord) | `subid: location.subid` |
| 360 | docs (insertMediaRecord) | `subid: location.subid` |
| 389 | maps (insertMediaRecord) | `subid: location.subid` |
| 456 | imgs (batchInsertImages) | `subid: location.subid` |
| 532 | vids (batchInsertVideos) | `subid: location.subid` |
| 610 | docs (batchInsertDocs) | `subid: location.subid` |
| 673 | maps (batchInsertMaps) | `subid: location.subid` |

### Step 5: Also fix resume handler

**File:** `packages/desktop/electron/main/ipc-handlers/import-v2.ts`
**Lines:** 331-338

The resume handler queries `locs` table but doesn't include `subid`. This needs to be fixed if resume should work for sub-location imports.

Note: The `locs` table has `slocnam` but the session should store the `subid` it was targeting. This may require storing `subid` in the `import_sessions` table.

---

## Data Migration

After the fix is deployed, previously imported media to sub-locations will still have `subid = NULL`.

### Option A: Manual reassignment (recommended)
- Existing `media:moveToSubLocation` IPC handler works
- User can manually select media and move to correct sub-location
- No risk of incorrect automatic assignment

### Option B: Automated migration (higher risk)
- Query imports by `locid` where location has sub-locations
- Attempt to match by import timestamp or folder structure
- Risk: May incorrectly assign media

**Recommendation:** Option A (manual) for now. Provide clear UI guidance for users to reassign media.

---

## Testing Plan

1. **Unit test**: Verify `subid` flows through entire pipeline
2. **Integration test**: Import to sub-location, verify `imgs.subid` is set correctly
3. **UI test**: Navigate to sub-location, import file, verify it appears there (not on host)
4. **Resume test**: Start import to sub-location, interrupt, resume, verify `subid` preserved

---

## Files Changed

| File | Changes |
|------|---------|
| `packages/desktop/electron/services/import/copier.ts` | Add `subid` to `LocationInfo` |
| `packages/desktop/electron/services/import/finalizer.ts` | Add `subid` to interface + update 8 insert locations |
| `packages/desktop/electron/main/ipc-handlers/import-v2.ts` | Pass `subid` to orchestrator + fix resume |

---

## Why Old Import (v1) Works

The old import system at `media:import` correctly handles `subid`:

**File:** `packages/desktop/electron/main/ipc-handlers/media-import.ts`
**Line 381:**
```typescript
const filesForImport = validatedInput.files.map((f) => ({
  // ...
  subid: validatedInput.subid || null,  // ✅ CORRECTLY PASSES subid
}));
```

**File:** `packages/desktop/electron/services/file-import-service.ts`
**Lines 1439, 1480, 1525, 1567:**
```typescript
subid: file.subid || null,  // ✅ Uses the passed subid
```

The v2 pipeline was built from scratch and this plumbing was missed.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking existing imports | Low | Only adds optional field, backward compatible |
| Data corruption | None | Fix only affects new imports |
| Resume breaks | Medium | Need to verify resume handles subid properly |

---

## Approval Checklist

- [ ] User approves fix approach
- [ ] User confirms manual data migration is acceptable
- [ ] User confirms resume handler scope (full fix vs. partial)
