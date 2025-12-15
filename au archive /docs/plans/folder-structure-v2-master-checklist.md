# Folder Structure v2 - Master Change Checklist

**Status:** Active Implementation
**Created:** 2025-12-09
**Last Updated:** 2025-12-09

---

## Executive Summary

This document contains the complete checklist of all changes required for the Folder Structure v2 migration. Changes are categorized by severity (Major/Medium/Minor) and tracked by completion status.

**Total Changes:** 127
- Major (Breaking): 23
- Medium (Significant): 42
- Minor (Documentation/Cleanup): 62

---

## MAJOR CHANGES (Breaking - Require Fresh Database)

### M1. Database Schema Changes

- [ ] **M1.1** Remove `loc12` column from `locs` table
- [ ] **M1.2** Remove `sub12` column from `slocs` table
- [ ] **M1.3** Remove `loc12` column from `locs` table reference in schema.sql
- [ ] **M1.4** Remove `sub12` column from `slocs` table reference in schema.sql
- [ ] **M1.5** Remove `idx_locs_loc12` index
- [ ] **M1.6** Update `locid` column to accept BLAKE3 16-char IDs (TEXT, no format change needed)
- [ ] **M1.7** Update `subid` column to accept BLAKE3 16-char IDs
- [ ] **M1.8** Update database.types.ts to remove loc12/sub12 types

### M2. ID Generation Changes

- [ ] **M2.1** Add `generateLocationId()` function to crypto-service.ts using BLAKE3
- [ ] **M2.2** Add `generateSubLocationId()` function to crypto-service.ts using BLAKE3
- [ ] **M2.3** Remove `LocationEntity.generateLoc12()` method from location.ts
- [ ] **M2.4** Update sqlite-location-repository.ts to use generateLocationId()
- [ ] **M2.5** Update sqlite-sublocation-repository.ts to use generateSubLocationId()
- [ ] **M2.6** Remove `loc12` from Zod schema in location.ts
- [ ] **M2.7** Remove `sub12` from Zod schema in location.ts

### M3. Folder Structure Changes (Core)

- [ ] **M3.1** Update `buildLocationPath()` in copier.ts: `STATE-TYPE/SLOCNAM-LOC12` → `STATE/LOCID`
- [ ] **M3.2** Update `buildFilePath()` in copier.ts: remove LOC12 from subfolder names
- [ ] **M3.3** Add `data/` directory layer for RFC 8493 compliance
- [ ] **M3.4** Add support for `web-img/`, `web-vid/`, `web-doc/` folders
- [ ] **M3.5** Add support for `sloc-[SUBID]/` sub-location folders
- [ ] **M3.6** Rename `_database/` to `database/` in database-archive-service.ts
- [ ] **M3.7** Rename `_websources/` to `websources/` for unlinked sources
- [ ] **M3.8** Remove `_archive/` nested structure, move BagIt to location root

---

## MEDIUM CHANGES (Significant - Require Code Updates)

### MD1. Core Domain Model Updates

- [ ] **MD1.1** Update LocationEntity interface to remove loc12
- [ ] **MD1.2** Update SubLocationEntity interface to remove sub12
- [ ] **MD1.3** Update LocationInput Zod schema
- [ ] **MD1.4** Update SubLocationInput Zod schema
- [ ] **MD1.5** Update all location-related type exports

### MD2. Import Pipeline Updates

- [ ] **MD2.1** Update copier.ts `getSubfolder()` method - remove LOC12 suffix
- [ ] **MD2.2** Update copier.ts `buildLocationPath()` - new path structure
- [ ] **MD2.3** Update copier.ts `buildFilePath()` - new path structure
- [ ] **MD2.4** Update types.ts `LocationInfo` interface - remove loc12
- [ ] **MD2.5** Update types.ts `SubLocationInfo` interface - remove sub12
- [ ] **MD2.6** Update scanner.ts excluded folders list
- [ ] **MD2.7** Update orchestrator.ts location info handling
- [ ] **MD2.8** Update finalizer.ts path generation
- [ ] **MD2.9** Update file-import-service.ts archive structure comments
- [ ] **MD2.10** Update phase-import-service.ts folder path spec

### MD3. BagIt Service Updates

- [ ] **MD3.1** Update BagLocation interface - remove loc12
- [ ] **MD3.2** Update BagSubLocation interface - remove sub12
- [ ] **MD3.3** Update getArchiveFolderPath() - move to location root
- [ ] **MD3.4** Update getLocationFolderPath() - new path structure
- [ ] **MD3.5** Update createArchive() - RFC 8493 structure
- [ ] **MD3.6** Update updateManifest() - new file paths
- [ ] **MD3.7** Update validateBag() - new structure
- [ ] **MD3.8** Remove sub-location _archive-{sub12} handling
- [ ] **MD3.9** Add sub-location data inclusion in parent BagIt

### MD4. Repository Updates

- [ ] **MD4.1** Update sqlite-location-repository.ts - remove loc12 generation
- [ ] **MD4.2** Update sqlite-location-repository.ts - remove loc12 from SELECT
- [ ] **MD4.3** Update sqlite-location-repository.ts - remove loc12 from INSERT
- [ ] **MD4.4** Update sqlite-sublocation-repository.ts - remove sub12 generation
- [ ] **MD4.5** Update sqlite-sublocation-repository.ts - remove sub12 from SELECT
- [ ] **MD4.6** Update sqlite-sublocation-repository.ts - remove sub12 from INSERT
- [ ] **MD4.7** Update sqlite-sublocation-repository.ts - update folder deletion paths
- [ ] **MD4.8** Update media folder cleanup in delete operations

### MD5. IPC Handler Updates

- [ ] **MD5.1** Update import-v2.ts validation schema - remove loc12
- [ ] **MD5.2** Update import-v2.ts location info mapping
- [ ] **MD5.3** Update bagit.ts location info mapping
- [ ] **MD5.4** Update locations.ts response mapping
- [ ] **MD5.5** Update media-import.ts location info mapping
- [ ] **MD5.6** Update storage.ts path references

### MD6. Service Updates

- [ ] **MD6.1** Update websource-orchestrator-service.ts - new path structure
- [ ] **MD6.2** Update websource-orchestrator-service.ts - remove loc12 references
- [ ] **MD6.3** Update job-worker-service.ts - update _archive references
- [ ] **MD6.4** Update database-archive-service.ts - rename folder constant
- [ ] **MD6.5** Update bagit-integrity-service.ts - new structure
- [ ] **MD6.6** Update media-path-service.ts - if any loc12 references
- [ ] **MD6.7** Create readme-service.ts - new service for README.txt generation

### MD7. Test Updates

- [ ] **MD7.1** Update copier.test.ts - new folder structure assertions
- [ ] **MD7.2** Update copier.test.ts - remove loc12/sub12 from test data
- [ ] **MD7.3** Update test-database.ts helper - new ID generation
- [ ] **MD7.4** Update location-repository.integration.test.ts
- [ ] **MD7.5** Add new tests for BLAKE3 ID generation
- [ ] **MD7.6** Add new tests for folder structure validation
- [ ] **MD7.7** Add new tests for BagIt RFC 8493 compliance

---

## MINOR CHANGES (Documentation/Cleanup)

### MN1. Documentation Updates

- [ ] **MN1.1** Update CLAUDE.md - Archive folder structure section
- [ ] **MN1.2** Update CLAUDE.md - Critical Gotchas table
- [ ] **MN1.3** Update docs/contracts/hashing.md - folder references
- [ ] **MN1.4** Update docs/contracts/data-ownership.md - BagIt references
- [ ] **MN1.5** Update docs/workflows/import.md - folder organization
- [ ] **MN1.6** Update packages/core/CLAUDE.md
- [ ] **MN1.7** Update packages/desktop/CLAUDE.md
- [ ] **MN1.8** Update docs/ARCHITECTURE.md - if folder references exist
- [ ] **MN1.9** Update docs/DATA_FLOW.md - if folder references exist
- [ ] **MN1.10** Update lilbits.md - if folder references exist

### MN2. Comment Updates

- [ ] **MN2.1** Update copier.ts - all path format comments
- [ ] **MN2.2** Update file-import-service.ts - archive structure comment
- [ ] **MN2.3** Update phase-import-service.ts - folder path comment
- [ ] **MN2.4** Update bagit-service.ts - file storage comment
- [ ] **MN2.5** Update websource-orchestrator-service.ts - path comments
- [ ] **MN2.6** Update sqlite-sublocation-repository.ts - folder comments
- [ ] **MN2.7** Update job-worker-service.ts - archive folder comments

### MN3. Type Cleanup

- [ ] **MN3.1** Remove loc12 from all interface definitions
- [ ] **MN3.2** Remove sub12 from all interface definitions
- [ ] **MN3.3** Update all type imports that reference loc12/sub12
- [ ] **MN3.4** Update preload bridge types if affected
- [ ] **MN3.5** Update electron.d.ts if affected

### MN4. Scanner Exclusion Updates

- [ ] **MN4.1** Update scanner.ts - change `_database` to `database` in exclusions
- [ ] **MN4.2** Update scanner.ts - add any new folder exclusions
- [ ] **MN4.3** Update resetdb.py - folder references

### MN5. Plan Document Updates

- [ ] **MN5.1** Mark folder-structure-v2.md as implemented
- [ ] **MN5.2** Archive related plan documents
- [ ] **MN5.3** Update implementation status in decisions

### MN6. UI/Form Updates (If Displaying loc12/sub12)

- [ ] **MN6.1** Check LocationFormFields.svelte for loc12 display
- [ ] **MN6.2** Check LocationEditForm.svelte for loc12 display
- [ ] **MN6.3** Check ImportForm.svelte for loc12 display
- [ ] **MN6.4** Check SubLocationGrid.svelte for sub12 display
- [ ] **MN6.5** Check LocationDetail.svelte for loc12/sub12 display
- [ ] **MN6.6** Remove any debug/dev displays of loc12/sub12

### MN7. Error Message Updates

- [ ] **MN7.1** Update error messages referencing loc12
- [ ] **MN7.2** Update error messages referencing folder structure
- [ ] **MN7.3** Update log messages with path references

### MN8. Verification Tasks

- [ ] **MN8.1** Verify all loc12 references removed (grep verification)
- [ ] **MN8.2** Verify all sub12 references removed (grep verification)
- [ ] **MN8.3** Verify all _archive references updated
- [ ] **MN8.4** Verify all _database references updated
- [ ] **MN8.5** Verify all _websources references updated
- [ ] **MN8.6** Verify all org-[type]-LOC12 patterns updated
- [ ] **MN8.7** Verify STATE-TYPE path patterns updated
- [ ] **MN8.8** Verify UUID generation for locations replaced

---

## FILES REQUIRING CHANGES

### Critical Path Files (Must Change)

| File | Changes | Priority |
|------|---------|----------|
| `packages/desktop/electron/services/import/copier.ts` | M3.1, M3.2, MD2.1-3 | P0 |
| `packages/desktop/electron/services/bagit-service.ts` | M3.8, MD3.1-9 | P0 |
| `packages/desktop/electron/repositories/sqlite-location-repository.ts` | M2.4, MD4.1-3 | P0 |
| `packages/desktop/electron/repositories/sqlite-sublocation-repository.ts` | M2.5, MD4.4-8 | P0 |
| `packages/desktop/electron/main/database.ts` | M1.1-8 | P0 |
| `packages/core/src/domain/location.ts` | M2.3, M2.6-7, MD1.1-5 | P0 |
| `packages/desktop/electron/services/crypto-service.ts` | M2.1-2 | P0 |

### High Priority Files

| File | Changes | Priority |
|------|---------|----------|
| `packages/desktop/electron/services/import/types.ts` | MD2.4-5 | P1 |
| `packages/desktop/electron/services/websource-orchestrator-service.ts` | MD6.1-2 | P1 |
| `packages/desktop/electron/services/database-archive-service.ts` | M3.6, MD6.4 | P1 |
| `packages/desktop/electron/main/ipc-handlers/import-v2.ts` | MD5.1-2 | P1 |
| `packages/desktop/electron/main/ipc-handlers/bagit.ts` | MD5.3 | P1 |
| `packages/desktop/electron/main/ipc-handlers/locations.ts` | MD5.4 | P1 |
| `packages/desktop/electron/main/ipc-handlers/media-import.ts` | MD5.5 | P1 |

### Medium Priority Files

| File | Changes | Priority |
|------|---------|----------|
| `packages/desktop/electron/services/import/scanner.ts` | MD2.6, MN4.1-2 | P2 |
| `packages/desktop/electron/services/import/orchestrator.ts` | MD2.7 | P2 |
| `packages/desktop/electron/services/import/finalizer.ts` | MD2.8 | P2 |
| `packages/desktop/electron/services/file-import-service.ts` | MD2.9 | P2 |
| `packages/desktop/electron/services/phase-import-service.ts` | MD2.10 | P2 |
| `packages/desktop/electron/services/job-worker-service.ts` | MD6.3 | P2 |
| `packages/desktop/electron/main/database.types.ts` | M1.8 | P2 |
| `packages/desktop/electron/main/schema.sql` | M1.3-5 | P2 |

### Test Files

| File | Changes | Priority |
|------|---------|----------|
| `packages/desktop/electron/__tests__/unit/copier.test.ts` | MD7.1-2 | P2 |
| `packages/desktop/electron/__tests__/integration/helpers/test-database.ts` | MD7.3 | P2 |
| `packages/desktop/electron/__tests__/integration/location-repository.integration.test.ts` | MD7.4 | P2 |

### Documentation Files

| File | Changes | Priority |
|------|---------|----------|
| `CLAUDE.md` | MN1.1-2 | P3 |
| `docs/contracts/hashing.md` | MN1.3 | P3 |
| `docs/contracts/data-ownership.md` | MN1.4 | P3 |
| `docs/workflows/import.md` | MN1.5 | P3 |
| `packages/core/CLAUDE.md` | MN1.6 | P3 |
| `packages/desktop/CLAUDE.md` | MN1.7 | P3 |

---

## IMPLEMENTATION PHASES

### Phase 1: Database & Schema (P0)
Duration: ~2 hours
Files: 4
- database.ts schema changes
- database.types.ts updates
- schema.sql reference updates
- Domain model updates

### Phase 2: ID Generation (P0)
Duration: ~1 hour
Files: 3
- crypto-service.ts new functions
- location.ts remove generateLoc12
- Integration with repositories

### Phase 3: Core Services (P0-P1)
Duration: ~4 hours
Files: 8
- copier.ts complete rewrite of path logic
- bagit-service.ts complete restructure
- websource-orchestrator-service.ts updates
- database-archive-service.ts updates

### Phase 4: Repositories (P0-P1)
Duration: ~2 hours
Files: 2
- sqlite-location-repository.ts
- sqlite-sublocation-repository.ts

### Phase 5: IPC Handlers (P1)
Duration: ~2 hours
Files: 5
- All IPC handlers removing loc12/sub12

### Phase 6: Import Pipeline (P2)
Duration: ~2 hours
Files: 5
- types.ts, scanner.ts, orchestrator.ts, finalizer.ts
- file-import-service.ts, phase-import-service.ts

### Phase 7: Tests (P2)
Duration: ~2 hours
Files: 4
- Update existing tests
- Add new tests for BLAKE3 and folder structure

### Phase 8: Documentation (P3)
Duration: ~1 hour
Files: 10+
- CLAUDE.md and all doc updates

### Phase 9: Verification & Cleanup (P3)
Duration: ~1 hour
- Grep verification for removed patterns
- Final cleanup

---

## VERIFICATION COMMANDS

```bash
# Verify loc12 removed
grep -r "loc12" packages/ --include="*.ts" --include="*.svelte" | grep -v node_modules | grep -v ".d.ts"

# Verify sub12 removed
grep -r "sub12" packages/ --include="*.ts" --include="*.svelte" | grep -v node_modules | grep -v ".d.ts"

# Verify _archive updated
grep -r "_archive" packages/ --include="*.ts" | grep -v node_modules

# Verify _database updated
grep -r "_database" packages/ --include="*.ts" | grep -v node_modules

# Verify _websources updated
grep -r "_websources" packages/ --include="*.ts" | grep -v node_modules

# Verify org-[type]-LOC12 patterns updated
grep -r "org-img-\|org-vid-\|org-doc-\|org-map-" packages/ --include="*.ts" | grep -v node_modules

# Verify STATE-TYPE patterns updated
grep -r "STATE.*TYPE\|state.*type" packages/ --include="*.ts" | grep -v node_modules | grep -v ".test."

# Verify randomUUID for locations replaced
grep -r "randomUUID" packages/desktop/electron/repositories/sqlite-location-repository.ts
grep -r "randomUUID" packages/desktop/electron/repositories/sqlite-sublocation-repository.ts
```

---

## COMPLETION TRACKING

| Phase | Items | Completed | Percentage |
|-------|-------|-----------|------------|
| Phase 1: Database | 8 | 0 | 0% |
| Phase 2: ID Generation | 7 | 0 | 0% |
| Phase 3: Core Services | 17 | 0 | 0% |
| Phase 4: Repositories | 8 | 0 | 0% |
| Phase 5: IPC Handlers | 6 | 0 | 0% |
| Phase 6: Import Pipeline | 10 | 0 | 0% |
| Phase 7: Tests | 7 | 0 | 0% |
| Phase 8: Documentation | 10 | 0 | 0% |
| Phase 9: Verification | 8 | 0 | 0% |
| **TOTAL** | **127** | **0** | **0%** |

---

## ROLLBACK PLAN

If issues arise during implementation:

1. **Database**: Fresh database required anyway - no rollback needed
2. **Code**: Git branch `feature/folder-structure-v2` - can revert
3. **Archive Files**: Run `resetdb.py --wipe-media` for clean start
4. **Documentation**: Restore from git

---

## SUCCESS CRITERIA

1. All 127 checklist items completed
2. All verification commands return zero results
3. Full test suite passes
4. New location creation uses BLAKE3 16-char IDs
5. Folder structure matches RFC 8493 BagIt spec
6. README.txt generated for each location
7. No underscore-prefixed folders created
8. Documentation fully updated
9. Git commit pushed to GitHub

---

## SIGN-OFF

- [ ] Code Complete
- [ ] Tests Pass
- [ ] Documentation Updated
- [ ] Verification Commands Pass
- [ ] Git Pushed
- [ ] Ready for Production
