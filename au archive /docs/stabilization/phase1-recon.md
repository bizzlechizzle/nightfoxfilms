# Phase 1: Codebase Reconnaissance Report

**Generated:** 2025-11-30
**Version:** 0.1.0 Stabilization
**Status:** Complete

---

## 1.1 File Inventory Summary

### Statistics
- **Total Source Files:** ~150 primary source files
- **TypeScript/JavaScript:** ~85 files
- **Svelte Components:** ~30 files
- **SQL/Database:** 1 schema file + 39 migrations (inline)
- **Shell Scripts:** 6 scripts
- **Python Utilities:** 2 scripts
- **Documentation:** ~50 markdown files

### Key Directories

| Directory | Files | LOC (est.) | Purpose |
|-----------|-------|-----------|---------|
| `packages/core/src` | 7 | ~500 | Domain models, repository contracts |
| `packages/desktop/electron/main` | 6 | ~2,500 | Electron lifecycle, database, IPC registry |
| `packages/desktop/electron/ipc-handlers` | 19 | ~4,500 | IPC channel implementations |
| `packages/desktop/electron/services` | 40 | ~12,000 | Business logic services |
| `packages/desktop/electron/repositories` | 12 | ~4,000 | SQLite data access |
| `packages/desktop/src/components` | 32 | ~8,000 | Svelte UI components |
| `packages/desktop/src/pages` | 13 | ~3,500 | Page-level views |
| `packages/desktop/src/stores` | 5 | ~400 | State management |
| `packages/desktop/src/lib` | 7 | ~5,500 | Constants, helpers, region data |
| `scripts/` | 6 | ~1,400 | Setup and utility scripts |
| `docs/` | ~50 | ~5,000 | Contracts, workflows, decisions |

---

## 1.2 Script Inventory

| Script | Lines | Runtime | Inputs | Outputs | Side Effects | In lilbits.md? |
|--------|-------|---------|--------|---------|--------------|----------------|
| `scripts/setup.sh` | 514 | bash | CLI args | stdout | Installs deps, downloads browser | ✅ Yes |
| `scripts/check-deps.sh` | 131 | bash | none | stdout (colored) | none | ❌ No |
| `scripts/test-region-gaps.ts` | 258 | ts-node | none | stdout | none | ✅ Yes |
| `scripts/run-dedup.py` | 235 | python3 | none | db changes | Modifies ref_map_points | ✅ Yes |
| `scripts/run-dedup.mjs` | 245 | node | none | db changes | Modifies ref_map_points | ❌ No |
| `scripts/run-dedup.sql` | 45 | sqlite3 | none | stdout | Read-only analysis | ❌ No |
| `resetdb.py` | 233 | python3 | CLI args | file deletion | Removes db/config files | ❌ No |

**Issues Found:**
- 4 scripts not documented in lilbits.md
- Duplicate implementations: run-dedup.py and run-dedup.mjs do the same thing

---

## 1.3 IPC Channel Map

**Total Channels:** 238 unique handlers

### By Category

| Category | Count | Handler File(s) |
|----------|-------|-----------------|
| Location Operations | 24 | locations.ts |
| Media Operations | 32 | media-import.ts, media-processing.ts |
| Sub-locations | 13 | sublocations.ts |
| Geocoding & Address | 6 | geocode.ts, stats-settings.ts |
| Settings & Config | 3 | stats-settings.ts |
| Users & Auth | 11 | users.ts |
| Projects | 12 | projects.ts |
| Notes | 7 | notes.ts |
| Bookmarks | 8 | bookmarks.ts |
| Database Ops | 5 | database.ts |
| Health & Monitoring | 11 | health.ts |
| Research Browser | 15 | research-browser.ts |
| Reference Maps | 18 | ref-maps.ts |
| Import Intelligence | 3 | import-intelligence.ts |
| Stats & Analytics | 7 | stats-settings.ts |
| Shell/Dialog | 2 | shell-dialog.ts |
| Location Authors | 8 | location-authors.ts |
| Imports | 5 | imports.ts |

### Validation Coverage

| Status | Count | Percentage |
|--------|-------|------------|
| Validated (Zod) | 163 | 68% |
| Unvalidated | 75 | 32% |

### Event Channels (Main → Renderer)

| Channel | Purpose |
|---------|---------|
| `media:import:progress` | Import progress updates |
| `media:phaseImport:progress` | Phase import progress |
| `media:proxyProgress` | Video proxy generation progress |
| `backup:status` | Backup operation status |
| `browser:navigated` | Research browser URL change |
| `browser:titleChanged` | Research browser title change |
| `browser:loadingChanged` | Research browser loading state |

---

## 1.4 Database Schema Snapshot

### Core Tables (from schema.sql)

| Table | Purpose | Primary Key | Foreign Keys |
|-------|---------|-------------|--------------|
| `locs` | Locations | locid (UUID) | none |
| `slocs` | Sub-locations | subid (UUID) | locid → locs |
| `imgs` | Images | imgsha (SHA256) | locid → locs, subid → slocs |
| `vids` | Videos | vidsha (SHA256) | locid → locs, subid → slocs |
| `docs` | Documents | docsha (SHA256) | locid → locs, subid → slocs |
| `maps` | Historical maps | mapsha (SHA256) | locid → locs, subid → slocs |
| `urls` | Location URLs | urlid (UUID) | locid → locs |
| `settings` | Key-value config | key (TEXT) | none |

### Migration-Added Tables (39 migrations)

| Table | Migration | Purpose |
|-------|-----------|---------|
| `imports` | 2 | Import job tracking |
| `notes` | 3 | Location notes |
| `projects` | 4 | Project organization |
| `project_locations` | 4 | Project-location junction |
| `bookmarks` | 5 | URL bookmarks |
| `users` | 7 | User accounts |
| `location_authors` | 25 | Multi-author attribution |
| `location_views` | 34 | View tracking per user |
| `video_proxies` | 36 | Video proxy cache |
| `ref_maps` | 37 | Reference map imports |
| `ref_map_points` | 37 | Points from ref maps |
| `location_exclusions` | 38 | Duplicate exclusion decisions |

### Key Indexes

- `idx_locs_state` - Filter by state
- `idx_locs_type` - Filter by location type
- `idx_locs_gps` - Spatial queries (lat/lng)
- `idx_locs_favorite` - Favorite locations
- `idx_locs_verified` - Verified locations
- `idx_imgs_locid`, `idx_vids_locid`, `idx_docs_locid` - Media by location

### Notable Schema Features

1. **SHA256 as PK for media** - Ensures deduplication
2. **39 inline migrations** - All in database.ts, not separate files
3. **WAL mode enabled** - Better concurrency
4. **Foreign keys enforced** - Via PRAGMA on connection
5. **Soft constraints** - CHECK on address_state length

---

## 1.5 Dependency Audit

### Production Dependencies (Desktop)

| Package | Version | License | Purpose | Offline-Safe? |
|---------|---------|---------|---------|---------------|
| better-sqlite3 | ^11.0.0 | MIT | SQLite database | ✅ Yes |
| kysely | ^0.27.2 | MIT | Type-safe SQL | ✅ Yes |
| sharp | ^0.33.1 | Apache-2.0 | Image processing | ✅ Yes |
| exiftool-vendored | ^33.2.0 | MIT | Metadata extraction | ✅ Yes |
| fluent-ffmpeg | ^2.1.2 | MIT | Video processing | ✅ Yes |
| leaflet | ^1.9.4 | BSD-2-Clause | Maps | ⚠️ Partial* |
| supercluster | ^8.0.1 | ISC | Map clustering | ✅ Yes |
| node-postal | ^1.3.0 | MIT | Address parsing | ✅ Yes |
| zod | ^3.22.4 | MIT | Validation | ✅ Yes |
| ws | ^8.18.3 | MIT | WebSockets | ✅ Yes |
| @aws-sdk/client-s3 | ^3.940.0 | Apache-2.0 | S3 uploads | ⚠️ Network** |
| puppeteer-core | ^24.31.0 | Apache-2.0 | Browser automation | ⚠️ Verify*** |

**Notes:**
- *Leaflet requires tile URLs (online) or MBTiles (offline)
- **S3 SDK needs verification - may be unused
- ***Puppeteer-core usage needs verification

### Native Modules (require rebuild)

| Module | Managed By |
|--------|-----------|
| electron | postinstall |
| better-sqlite3 | electron-rebuild |
| sharp | electron-rebuild |
| node-postal | system libpostal |

### Flags

| Issue | Package | Risk |
|-------|---------|------|
| Network-required | @aws-sdk/client-s3 | Needs offline fallback or removal |
| Usage unknown | puppeteer-core | Verify if used; remove if not |

---

## 1.6 Gap Detection

### Critical Issues (5)

| ID | Category | File | Issue |
|----|----------|------|-------|
| G-001 | Duplicate code | `scripts/run-dedup.mjs` + `.py` | Two implementations of identical logic |
| G-002 | Duplicate function | `location-duplicate-service.ts:69` | `normalizeName()` duplicated from jaro-winkler-service |
| G-003 | Console.log | `media-processing.ts` (44 instances) | Production code uses console.log |
| G-004 | Console.log | repositories/*.ts (8 instances) | Repository layer uses console.log |
| G-005 | Debug markers | `media-processing.ts` | Kanye* markers without decision doc references |

### Documentation Gaps

| File | Issue |
|------|-------|
| `scripts/check-deps.sh` | Not in lilbits.md |
| `scripts/run-dedup.mjs` | Not in lilbits.md |
| `scripts/run-dedup.sql` | Not in lilbits.md |
| `resetdb.py` | Not in lilbits.md |
| `techguide.md` | In docs/retired/, still referenced in CLAUDE.md |

### Code Quality Observations

| Check | Status |
|-------|--------|
| TODO/FIXME comments | ✅ None found |
| Unimplemented stubs | ✅ None found |
| Error handling | ✅ All handlers have try-catch |
| AI references in UI | ✅ None found |
| Offline-first compliance | ⚠️ S3 + puppeteer need verification |

### Dependencies to Verify

1. **@aws-sdk/client-s3** - Search codebase for usage
2. **puppeteer-core** - Search codebase for usage
3. **leaflet tile providers** - Verify dual-edition detection is wired

---

## Summary

### Strengths
- Clean architecture with clear separation of concerns
- Comprehensive IPC validation (68% Zod coverage)
- 39 migrations with proper schema evolution
- No TODO/FIXME debt
- Good error handling patterns

### Issues to Address (Phase 3+)
1. Consolidate duplicate deduplication scripts
2. Replace console.log with logger service
3. Document missing scripts in lilbits.md
4. Verify/remove unused network dependencies
5. Fix techguide.md reference in CLAUDE.md

### Metrics

| Metric | Value |
|--------|-------|
| Source files | ~150 |
| IPC channels | 238 |
| Database tables | 20 |
| Migrations | 39 |
| Scripts | 7 |
| Console.log instances | 52+ |
| Undocumented scripts | 4 |

---

**PHASE 1 COMPLETE — Ready for Phase 2**
