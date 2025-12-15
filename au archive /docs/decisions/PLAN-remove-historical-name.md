# PLAN: Remove Historical Name Feature

**Status:** IMPLEMENTED
**Author:** Claude
**Date:** 2025-12-10
**Scope:** Complete removal of historicalName field from locations and sub-locations

---

## Overview

Remove the "Historical Name" feature from the entire application. This includes database columns, TypeScript types, UI components, repositories, services, and documentation.

**Note:** This plan does NOT remove `akanam` (Also Known As) - only `historicalName`.

---

## Impact Summary

| Category | Files Affected | Complexity |
|----------|----------------|------------|
| Database migrations | 1 new migration | Low |
| Domain models | 1 file | Low |
| Repositories | 2 files | Medium |
| IPC handlers | 1 file | Low |
| Type definitions | 2 files | Low |
| Svelte components | 3 files | Medium |
| Services | 2 files | Medium |
| Documentation | 6 files | Low |
| **Total** | **~18 files** | **Medium** |

---

## Detailed Changes

### 1. Database Migration (New Migration 66)

**File:** `packages/desktop/electron/main/database.ts`

Add migration to drop columns (SQLite requires table recreation or column becomes unused):

```sql
-- Migration 66: Remove historical_name columns (soft removal - columns remain but unused)
-- Note: SQLite doesn't support DROP COLUMN in older versions, so we mark as deprecated
-- The columns will be ignored by the application
```

**Approach:** Leave columns in place but stop reading/writing them. This avoids complex table recreation and maintains backward compatibility with existing databases.

---

### 2. Domain Models

**File:** `packages/core/src/domain/location.ts`

Remove from LocationInputSchema and LocationSchema:
- `historicalName: z.string().optional()`
- `historicalNameVerified: z.boolean().default(false)`

---

### 3. Type Definitions

**File:** `packages/desktop/src/types/electron.d.ts`
- Remove `historicalName: string | null` from location interfaces
- Remove `'historicalName'` from `matchedField` union type

**File:** `packages/desktop/electron/preload/index.ts`
- Remove `historicalName` from type definitions

---

### 4. Repositories

**File:** `packages/desktop/electron/repositories/sqlite-location-repository.ts`
- Remove `historical_name` and `historical_name_verified` from INSERT
- Remove from UPDATE statements
- Remove from SELECT mapping

**File:** `packages/desktop/electron/repositories/sqlite-sublocation-repository.ts`
- Remove `historicalName` from interface
- Remove from create/update/read operations

---

### 5. IPC Handlers

**File:** `packages/desktop/electron/main/ipc-handlers/sublocations.ts`
- Remove `historicalName` from validation schema

---

### 6. Svelte Components

**File:** `packages/desktop/src/components/location/LocationInfo.svelte`
- Remove `historicalName` from interface Props
- Remove `hasHistoricalName` derived value
- Remove historical name display section
- Remove historical name from edit form
- Remove historical name dropdown (populated from AKA names)

**File:** `packages/desktop/src/components/DuplicateWarningPanel.svelte`
- Remove `historicalName` from props
- Remove `'historicalName'` case from matchedField switch
- Remove historical name display in duplicate warning

**File:** `packages/desktop/src/components/ImportModal.svelte`
- Remove `historicalName` from props passed to DuplicateWarningPanel

---

### 7. Services

**File:** `packages/desktop/electron/services/location-duplicate-service.ts`
- Remove `historicalName` from DuplicateLocation interface
- Remove `historical_name` from query fields
- Remove historical name matching logic from duplicate detection

**File:** `packages/desktop/electron/services/bookmark-api-server.ts`
- Remove `subloc.historicalName` from search filtering

---

### 8. Pages

**File:** `packages/desktop/src/pages/LocationDetail.svelte`
- Remove `historicalName` from SubLocation interface

---

### 9. Test Files

**File:** `packages/core/src/domain/location.test.ts`
- Remove `historicalNameVerified: false` from test fixtures

---

### 10. Documentation (Cleanup)

Files to update:
- `docs/plans/sublocation-edit-form.md` - Remove historicalName references
- `docs/decisions/ADR-pin-conversion-duplicate-prevention.md` - Update duplicate detection spec
- `docs/decisions/IMPL-pin-conversion-duplicate-prevention.md` - Update implementation
- `docs/guides/duplicate-detection-guide.md` - Update API documentation
- `pages/page_location.md` - Remove historicalName field reference
- `pages/import_form.md` - Remove historicalName field reference

---

## What Remains Unchanged

- **akanam (Also Known As)** - This field remains fully functional
- **aka_names in ref_map_points** - Used for dedup, unrelated to location historicalName
- **akaNames in media tables** - Used for media dedup, unrelated

---

## Migration Strategy

### Phase 1: Stop Writing
- Remove historicalName from all write operations
- New locations/sub-locations won't have historical names

### Phase 2: Stop Reading
- Remove from SELECT queries and type mappings
- Existing data ignored (column remains but unused)

### Phase 3: UI Removal
- Remove display and edit UI elements
- Remove from duplicate detection display

### Phase 4: Cleanup
- Update documentation
- Remove test references

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Data loss | Columns remain in database, just unused |
| Breaking changes | Gradual removal, types updated first |
| Duplicate detection gaps | Remove historicalName check, locnam + akanam sufficient |

---

## Rollback Plan

If issues arise:
1. Columns still exist in database
2. Git revert to restore code
3. No data migration needed

---

## Questions for User

None - scope is clear. Awaiting approval to proceed.

---

## Approval

- [ ] User approves plan
- [ ] Ready for implementation
