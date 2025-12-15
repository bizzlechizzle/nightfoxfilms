# Phase 3: Issue Tracker — v0.1.0

**Generated:** 2025-11-30

---

## Issue Registry

| ID | Severity | File | Line | Issue | Fix | Status |
|----|----------|------|------|-------|-----|--------|
| C-001 | Critical | electron/main/ipc-handlers/*.ts | Multiple | 116 console.log statements in production | Replace with logger service | Open |
| C-002 | Critical | src/**/*.svelte | Multiple | 12 console.log debug statements | Remove or wrap in DEV check | Open |
| M-001 | Major | database.ts, ref-maps.ts, research-browser.ts, health.ts | Multiple | Missing Zod validation | Add Zod schemas | Open |
| M-002 | Major | scripts/run-dedup.py, scripts/run-dedup.mjs | All | Duplicate implementations | Remove .mjs, keep Python | Open |
| M-003 | Major | location-duplicate-service.ts:69, jaro-winkler-service.ts:123 | 69, 123 | Duplicate normalizeName() | Export from jaro-winkler, import elsewhere | Open |
| M-004 | Major | CLAUDE.md | 16, 121 | techguide.md reference path | Verify path after Phase 2 restoration | Fixed |
| M-005 | Major | lilbits.md | N/A | 4 scripts missing documentation | Document all scripts | Fixed |
| M-006 | Major | media-processing.ts | Multiple | Kanye* debug markers without decision refs | Link to decisions or remove | Open |
| M-007 | Major | package.json | N/A | @aws-sdk/client-s3 usage unclear | Verify usage, remove if unused | Open |
| M-008 | Major | package.json | N/A | puppeteer-core usage unclear | Verify usage, remove if unused | Open |
| N-001 | Minor | Multiple IPC handlers | Multiple | console.error for error logging | Consider structured logger | Deferred |
| N-002 | Minor | Multiple components | Multiple | console.error for error logging | Consider structured logger | Deferred |
| N-013 | Minor | scripts/setup.sh | 1-514 | Exceeds 300 LOC guideline | Exempt - complex installer | Exempt |
| N-014 | Minor | schema.sql, database.ts | N/A | Comment drift between files | Sync comments | Deferred |
| N-015 | Minor | lilbits.md | N/A | Date typo 2024 vs 2025 | Correct date | Fixed |

---

## Issues by Status

### Open (6)
- C-001: Console.log in IPC handlers
- C-002: Console.log in Svelte components
- M-001: Missing Zod validation
- M-002: Duplicate dedup scripts
- M-003: Duplicate normalizeName()
- M-006: Debug markers without refs

### Needs Verification (2)
- M-007: AWS S3 SDK usage
- M-008: Puppeteer-core usage

### Fixed in Phase 2 (3)
- M-004: techguide.md path
- M-005: Missing script docs
- N-015: Date typo

### Deferred to v0.1.1 (3)
- N-001: Console.error in handlers (appropriate use)
- N-002: Console.error in components (appropriate use)
- N-014: Schema comment drift

### Exempt (1)
- N-013: setup.sh length (justified)

---

## Priority Matrix

| Priority | Issues | Action |
|----------|--------|--------|
| P0 (Blocking) | C-001, C-002 | Must fix before release |
| P1 (Should Fix) | M-001, M-006, M-007, M-008 | Fix if time permits |
| P2 (Nice to Have) | M-002, M-003 | Defer to v0.1.1 |
| P3 (Deferred) | N-* | Track for future |

---

## Resolution Tracking

### To Resolve Before v0.1.0

1. **C-001 + C-002**: Console.log removal
   - Option A: Remove all debug logs (quick)
   - Option B: Implement logger service (thorough)
   - **Recommendation**: Option A for v0.1.0, Option B for v0.1.1

2. **M-007 + M-008**: Dependency verification
   - Run: `grep -r "aws-sdk" packages/`
   - Run: `grep -r "puppeteer" packages/`
   - Remove unused packages

3. **M-006**: Debug markers
   - Search for Kanye* references
   - Either link to decisions or remove comments

---

End of Issue Tracker
