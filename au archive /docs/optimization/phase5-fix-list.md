# Master Fix List — v0.1.0 Optimization

**Generated:** 2025-11-30
**Phase:** Post-Stabilization Optimization, Phase 5

---

## Issue Inventory

| ID | Source | Category | Severity | Summary | Est. Hours |
|----|--------|----------|----------|---------|------------|
| OPT-001 | Phase 1 | Bug | Critical | Multi-step operations without transactions | 2.0 |
| OPT-002 | Phase 1 | Bug | Critical | JSON array lost update race condition | 1.5 |
| OPT-003 | Phase 1 | Bug | Critical | Hash collision check not atomic (TOCTOU) | 1.0 |
| OPT-004 | Phase 1 | Bug | Critical | Fire-and-forget async without error context | 1.5 |
| OPT-005 | Phase 1 | Bug | Critical | Reference map creation without transaction | 1.0 |
| OPT-006 | Phase 1 | Bug | Critical | Unhandled mkdir() errors in media-path-service | 0.5 |
| OPT-007 | Phase 1 | Bug | Critical | ExifTool close() without error handling | 0.5 |
| OPT-008 | Phase 1 | Bug | Critical | Missing null check causes runtime crash | 0.5 |
| OPT-009 | Phase 1 | Bug | Major | Silent JSON parsing error in import | 0.5 |
| OPT-010 | Phase 1 | Bug | Major | Duplicate check returns false on error | 0.5 |
| OPT-011 | Phase 1 | Bug | Major | Archive path copy failure not wrapped | 0.5 |
| OPT-012 | Phase 1 | Bug | Major | Metadata extraction silent failure | 1.0 |
| OPT-013 | Phase 1 | Bug | Major | Thumbnail generation silent failure | 1.0 |
| OPT-014 | Phase 1 | Bug | Major | Missing FK verification in 10+ handlers | 2.0 |
| OPT-015 | Phase 1 | Bug | Major | Missing file path validation in imports | 1.0 |
| OPT-016 | Phase 1 | Bug | Major | Memory leak - Atlas router subscription | 0.5 |
| OPT-017 | Phase 1 | Bug | Major | Memory leak - Locations router subscription | 0.5 |
| OPT-018 | Phase 1 | Bug | Major | Toast timer leak | 0.5 |
| OPT-019 | Phase 1 | Bug | Major | Race condition in import cancel | 1.0 |
| OPT-020 | Phase 1 | Bug | Major | Incorrect store API usage | 0.5 |
| OPT-021 | Phase 2 | Performance | Critical | Database migration validation bottleneck | 3.0 |
| OPT-022 | Phase 2 | Performance | High | Startup integrity check blocking | 1.0 |
| OPT-023 | Phase 2 | Performance | High | Defer non-critical servers to post-render | 1.5 |
| OPT-024 | Phase 2 | Performance | High | getCurrentUser() N+1 pattern | 1.5 |
| OPT-025 | Phase 2 | Performance | Medium | location:findAll unbounded payload | 2.0 |
| OPT-026 | Phase 2 | Performance | Medium | refMaps:getAllPoints re-deduplicates | 1.5 |
| OPT-027 | Phase 2 | Performance | Medium | Synchronous file reads in map-parser | 1.0 |
| OPT-028 | Phase 2 | Performance | Low | Redundant BackupScheduler.initialize() | 0.25 |
| OPT-029 | Phase 3 | Practice | Critical | 17 explicit `any` type annotations | 3.0 |
| OPT-030 | Phase 3 | Practice | Critical | 33 `as any` unsafe assertions | 4.0 |
| OPT-031 | Phase 3 | Practice | Medium | Duplicate getCurrentUser() implementations | 0.5 |
| OPT-032 | Phase 3 | Practice | Medium | Inline migrations (39) not in separate files | 4.0 |
| OPT-033 | Phase 3 | Practice | Low | Missing readonly modifiers | 1.0 |
| OPT-034 | Phase 4 | Gap | Critical | No IPC timeout mechanism | 2.0 |
| OPT-035 | Phase 4 | Gap | Major | No retry logic for transient failures | 2.0 |
| OPT-036 | Phase 4 | Gap | Major | No database operation logging | 1.5 |
| OPT-037 | Phase 4 | Gap | Major | No performance metrics | 2.0 |
| OPT-038 | Phase 4 | Gap | Minor | No search loading state | 0.5 |
| OPT-039 | Phase 4 | Gap | Minor | No delete progress indicator | 0.5 |

**Total Issues:** 39
**Total Estimated Hours:** 48.25

---

## Priority Breakdown

| Priority | Count | Hours |
|----------|-------|-------|
| Critical | 11 | 16.5 |
| Major/High | 18 | 21.5 |
| Minor/Low | 10 | 10.25 |

---

## Deferred to v0.1.1

The following are documented but deferred due to scope:

| Issue | Reason |
|-------|--------|
| OPT-032 (inline migrations) | Large refactor, not blocking |
| OPT-029/030 (type safety) | Extensive changes, not critical for release |
| OPT-035 (retry logic) | Nice-to-have, not stability critical |
| OPT-036/037 (logging/metrics) | Infrastructure improvement |
| Test coverage gaps | Extensive new code, deferred to next sprint |
