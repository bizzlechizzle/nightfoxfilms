# PLAN: BLAKE3 ID Validation Fix

**Status:** Draft - Awaiting Approval
**Date:** 2025-12-09
**Related:** ADR-046-folder-structure-v2.md

---

## Problem Statement

The user sees "Invalid uuid" validation errors on LocationDetail page:

```
Error invoking remote method 'location:findById': Error: Validation error: : Invalid uuid
Error invoking remote method 'bookmarks:findByLocation': Error: Validation error: : Invalid uuid
Error invoking remote method 'location:trackView': Error: Validation error: : Invalid uuid
```

## Root Cause Analysis

ADR-046 approved migrating from UUID to BLAKE3 16-character hex IDs for locations and sub-locations:

1. **`crypto-service.ts`** - Updated: `generateLocationId()` and `generateSubLocationId()` now return 16-char hex strings
2. **`sqlite-location-repository.ts`** - Updated: Uses `generateLocationId()` for new locations (line 66)
3. **`database.types.ts`** - Updated: Comments say "BLAKE3 16-char hash - ADR-046" (line 43)

**However, the IPC validation layer was NOT updated:**

All 80+ IPC handlers still use `z.string().uuid()` validation, which requires 36-character UUID format (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`). When a BLAKE3 ID (`a7f3b2c1e9d4f086`) is passed, Zod rejects it with "Invalid uuid".

## Scope of Impact

**Files with UUID validation that need updating:**

| File | Count | Purpose |
|------|-------|---------|
| `locations.ts` | 9 | Location CRUD, favorites, regions, views |
| `bookmarks.ts` | 6 | Bookmark CRUD by location |
| `notes.ts` | 5 | Notes CRUD by location |
| `media-processing.ts` | 8 | Media queries by location/sublocation |
| `media-import.ts` | 4 | Import targeting location/sublocation |
| `websources.ts` | 9 | Web sources by location |
| `projects.ts` | 9 | Project locations |
| `users.ts` | 9 | User CRUD (keep as UUID - unrelated) |
| `imports.ts` | 2 | Import records |
| `location-authors.ts` | 10 | Author tracking |
| `stats-settings.ts` | 1 | User stats |
| `import-intelligence.ts` | 1 | Import intelligence |
| `ipc-validation.ts` | 1 | Shared UuidSchema |

**Total:** ~74 locations using `z.string().uuid()` validation

## Decision Points

### 1. ID Format Strategy

**Option A: Update validation to accept BLAKE3 IDs**
- Change `z.string().uuid()` → custom schema accepting 16-char hex
- Pros: Clean, follows ADR-046 intent
- Cons: Breaking change for existing databases with UUID data

**Option B: Accept both UUID and BLAKE3 formats**
- Change `z.string().uuid()` → union schema accepting either format
- Pros: Backward compatible with existing data
- Cons: Two ID formats coexisting indefinitely

**Option C: Revert to UUID-only**
- Revert `crypto-service.ts` to use UUID
- Pros: Minimal code changes
- Cons: Abandons ADR-046 decision

**Recommendation:** Option B (accept both) with plan to deprecate UUID over time

### 2. Which entities keep UUID?

| Entity | Current | Proposed | Rationale |
|--------|---------|----------|-----------|
| Locations | BLAKE3 | BLAKE3 | Per ADR-046 |
| Sub-locations | BLAKE3 | BLAKE3 | Per ADR-046 |
| Users | UUID | UUID | Identity, not content |
| Bookmarks | UUID | UUID | Auto-generated, not content-addressed |
| Notes | UUID | UUID | Auto-generated, not content-addressed |
| Projects | UUID | UUID | Auto-generated, not content-addressed |
| Media (imgs/vids/docs) | BLAKE3 hash | Keep hash | Content-addressed, already works |

---

## Implementation Plan

### Phase 1: Create Shared ID Validation Schema

Create a unified ID schema in `ipc-validation.ts`:

```typescript
// BLAKE3 16-char hex format (ADR-046)
export const Blake3IdSchema = z.string().length(16).regex(/^[a-f0-9]+$/);

// Standard UUID format
export const UuidSchema = z.string().uuid();

// Location/Sub-location ID (accepts BLAKE3 or legacy UUID)
export const LocationIdSchema = z.union([Blake3IdSchema, UuidSchema]);

// General entity ID (UUID only - for users, bookmarks, notes, projects)
export const EntityIdSchema = UuidSchema;
```

### Phase 2: Update IPC Handlers

Replace validation in each handler category:

**Location-related (use `LocationIdSchema`):**
- `locations.ts` - locid validation
- `bookmarks.ts` - locid validation
- `notes.ts` - locid validation
- `media-processing.ts` - locid/subid validation
- `media-import.ts` - locid/subid validation
- `websources.ts` - locid/subid validation
- `location-authors.ts` - locid validation
- `imports.ts` - locid validation
- `import-intelligence.ts` - locid validation

**Keep UUID-only (use `EntityIdSchema`):**
- `users.ts` - user_id validation
- `projects.ts` - project_id validation
- `bookmarks.ts` - bookmark_id validation
- `notes.ts` - note_id validation
- `stats-settings.ts` - userId validation

### Phase 3: Update Zod Schemas in Core Package

Check if `@au-archive/core` has any UUID schemas that need updating for LocationInput or related types.

### Phase 4: Testing

1. Create new location (should get BLAKE3 ID)
2. Navigate to location detail page (should load)
3. Add bookmark to location (should work)
4. Track view (should work)
5. Existing locations with UUID IDs (if any) should still work

---

## Files to Modify

```
packages/desktop/electron/main/ipc-validation.ts        # Add Blake3IdSchema, LocationIdSchema
packages/desktop/electron/main/ipc-handlers/locations.ts
packages/desktop/electron/main/ipc-handlers/bookmarks.ts
packages/desktop/electron/main/ipc-handlers/notes.ts
packages/desktop/electron/main/ipc-handlers/media-processing.ts
packages/desktop/electron/main/ipc-handlers/media-import.ts
packages/desktop/electron/main/ipc-handlers/websources.ts
packages/desktop/electron/main/ipc-handlers/imports.ts
packages/desktop/electron/main/ipc-handlers/location-authors.ts
packages/desktop/electron/main/ipc-handlers/import-intelligence.ts
packages/desktop/electron/main/ipc-handlers/sublocations.ts (if exists)
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing data | Low | High | Union schema accepts both formats |
| Missing a handler | Medium | Medium | Grep audit before/after |
| Performance impact | Low | Low | Regex is fast |

---

## Estimated Changes

- **New code:** ~20 lines (schema definitions)
- **Modified lines:** ~100 lines (validation updates)
- **Test coverage:** Existing tests + manual verification
- **Breaking change:** No (backward compatible)

---

## Approval Checklist

- [ ] User approves Option B (accept both UUID and BLAKE3)
- [ ] User confirms which entities keep UUID-only
- [ ] User authorizes proceeding with implementation
