# ADR-046: Folder Structure v2 Migration

**Status:** Approved
**Date:** 2025-12-09
**Decision Makers:** User (Bryant)

---

## Context

The current folder structure uses multiple ID formats and includes mutable data (location name, type) in folder paths:

```
locations/[STATE]-[TYPE]/[SLOCNAM]-[LOC12]/org-{img,vid,doc}-[LOC12]/
```

This creates issues:
1. Renaming a location requires moving folders
2. Changing location type requires moving folders
3. Two ID formats: UUID (36 chars) in database, LOC12 (12 chars) in folders
4. BagIt structure not RFC 8493 compliant
5. Underscore prefixes (`_archive`, `_database`) inconsistent

---

## Decision

Adopt a new folder structure that is:
1. **Rename-safe**: Only immutable IDs in paths
2. **Type-agnostic**: Type not in folder path
3. **Single ID format**: BLAKE3 16-char everywhere
4. **RFC 8493 compliant**: Proper BagIt structure
5. **No underscore prefixes**: Clean folder names

### New Structure

```
locations/[STATE]/[LOCID]/
├── bagit.txt
├── bag-info.txt
├── manifest-blake3.txt
├── tagmanifest-blake3.txt
├── README.txt
└── data/
    ├── org-img/
    ├── org-vid/
    ├── org-doc/
    ├── org-map/
    ├── web-img/
    ├── web-vid/
    ├── web-doc/
    └── sloc-[SUBID]/
```

### ID Generation

Replace UUID with BLAKE3 hash of random bytes:
- 16 lowercase hex characters
- Same algorithm used for media file hashes
- Single ID format across entire system

---

## Consequences

### Positive
- Simpler mental model (one ID format)
- Location names can change freely
- Location types can change freely
- RFC 8493 compliant archives
- Shorter, cleaner paths

### Negative
- Breaking change (requires fresh database)
- Must update CLAUDE.md (deviation from protected file rule)
- Significant code changes across multiple files

### Mitigation
- Fresh database is acceptable for pre-release software
- CLAUDE.md update is authorized by user
- Comprehensive checklist and implementation guide created

---

## CLAUDE.md Compliance Audit

| Rule | Compliance | Notes |
|------|------------|-------|
| Scope Discipline | ✅ | User-requested change |
| Archive-First | ✅ | Improves archive portability |
| Keep It Simple | ✅ | Removes redundant ID format |
| Hashing first | ✅ | BLAKE3 maintained |
| No AI in Docs | ✅ | No AI references |
| Schema change | ⚠️ | Fresh DB, no migration needed |
| Deviation from spec | ✅ | This ADR documents it |

### Authorized Deviations

1. **CLAUDE.md Modification**: User has authorized updating the "Archive folder structure" line in Critical Gotchas table to reflect new structure.

2. **Inline Schema Change**: The database uses inline schema in `database.ts` (existing pattern). We modify this for fresh database, not running migrations on existing data.

---

## Implementation

See:
- `/docs/plans/folder-structure-v2.md` - Full specification
- `/docs/plans/folder-structure-v2-master-checklist.md` - Change checklist
- `/docs/guides/folder-structure-v2-implementation-guide.md` - Developer guide

---

## Affected Files

### Critical (P0)
- `packages/desktop/electron/main/database.ts`
- `packages/desktop/electron/services/crypto-service.ts`
- `packages/desktop/electron/services/import/copier.ts`
- `packages/desktop/electron/services/bagit-service.ts`
- `packages/desktop/electron/repositories/sqlite-location-repository.ts`
- `packages/desktop/electron/repositories/sqlite-sublocation-repository.ts`
- `packages/core/src/domain/location.ts`

### Documentation (P3)
- `CLAUDE.md` - Archive folder structure line
- `docs/contracts/hashing.md`
- `docs/contracts/data-ownership.md`
- `docs/workflows/import.md`

---

## Approval

- [x] User approved plan
- [x] User approved CLAUDE.md modification
- [x] Fresh database acceptable
- [x] Implementation guide created
