# v0.1.0-alpha Final Verification & Release Readiness

## Philosophy

**NOTHING DEFERRED TO v0.1.1**

This is the final gate. Every issue found must be resolved before proceeding. If something cannot be fixed, it must be explicitly accepted with documented rationale — not punted to a future version.

The point of v0.1.0-alpha is a complete, working application — not a placeholder with a TODO list.

---

## Pre-Flight: Verify Previous Work

Before new audits, verify all previous phases actually completed properly.

```
You are performing final verification for Abandoned Archive v0.1.0-alpha.

READ FIRST — COMPLETE FILES, IN ORDER:
1. @CLAUDE.md
2. @techguide.md
3. @lilbits.md

YOUR TASK: Verify all previous stabilization and optimization work is complete and properly applied.

---

## PART 1: Verify Phase Outputs Exist

Check that all expected documentation was generated:

### Stabilization Outputs
| File | Exists? | Non-Empty? | Looks Complete? |
|------|---------|------------|-----------------|
| docs/stabilization/phase1-recon.md | | | |
| docs/stabilization/phase2-diff.md | | | |
| docs/stabilization/phase3-audit.md | | | |
| docs/stabilization/phase3-issues.md | | | |
| docs/stabilization/phase4-fix-plan.md | | | |
| docs/stabilization/phase5-implementation-log.md | | | |
| docs/stabilization/phase6-implementation-guide.md | | | |
| docs/stabilization/phase7-final-audit.md | | | |
| docs/stabilization/phase8-release-notes.md | | | |

### Optimization Outputs
| File | Exists? | Non-Empty? | Looks Complete? |
|------|---------|------------|-----------------|
| docs/optimization/phase1-bugs.md | | | |
| docs/optimization/phase2-performance.md | | | |
| docs/optimization/phase3-best-practices.md | | | |
| docs/optimization/phase4-gaps.md | | | |
| docs/optimization/phase5-fix-list.md | | | |
| docs/optimization/phase5-plan.md | | | |
| docs/optimization/phase6-critical-log.md | | | |
| docs/optimization/phase7-major-log.md | | | |
| docs/optimization/phase8-minor-log.md | | | |
| docs/optimization/phase8-polish.md | | | |
| docs/optimization/phase9-summary.md | | | |

If ANY file is missing or empty, STOP and report. Previous phases must be completed first.

---

## PART 2: Verify Fixes Were Actually Applied

Cross-reference fix logs with actual code:

### From Stabilization
Read `docs/stabilization/phase5-implementation-log.md` and verify each fix:

| Fix ID | Claimed Fixed | Actually Fixed in Code? | Verified |
|--------|---------------|-------------------------|----------|

### From Optimization
Read optimization implementation logs and verify:

| Fix ID | Claimed Fixed | Actually Fixed in Code? | Verified |
|--------|---------------|-------------------------|----------|

If ANY fix was logged as applied but code doesn't reflect it, flag as CRITICAL.

---

## PART 3: Verify No Regressions

After all fixes, did anything break?

```bash
# Run these and capture output
pnpm install
pnpm build
pnpm -r lint
pnpm -r test
```

| Check | Status | Errors |
|-------|--------|--------|
| pnpm install | | |
| pnpm build | | |
| pnpm -r lint | | |
| pnpm -r test | | |

If ANY fails, STOP. Fix before proceeding.

---

## PART 4: Verify Documentation Sync

After all code changes, docs may be stale:

### techguide.md Accuracy
| Section | Still Accurate? | Needs Update? |
|---------|-----------------|---------------|
| Environment Requirements | | |
| Repository Structure | | |
| Setup From Scratch | | |
| Build System | | |
| Database | | |
| IPC Architecture | | |
| Troubleshooting | | |

### lilbits.md Accuracy
For each script documented:
| Script | Still Exists? | Description Accurate? | Line Count Accurate? |
|--------|---------------|----------------------|----------------------|

### IMPLEMENTATION_GUIDE.md Accuracy
| Section | Still Accurate After Fixes? |
|---------|------------------------------|
| Data flows | |
| Key files | |
| Common tasks | |

Update any stale documentation NOW. Do not proceed with inaccurate docs.

---

## PART 5: Deferred Items Audit

Search all optimization docs for anything marked "defer", "v0.1.1", "later", "backlog", "won't fix":

```bash
grep -rni "defer\|v0.1.1\|v0.2\|later\|backlog\|won't fix\|wont fix" docs/
```

For EACH item found:

| Item | Where Found | Original Reason for Deferral | Can Fix Now? | Resolution |
|------|-------------|------------------------------|--------------|------------|

**RESOLUTION OPTIONS:**
- **Fix Now** — Implement the fix
- **Accept Risk** — Document explicit rationale why this is acceptable for v0.1.0-alpha
- **Not Actually Needed** — Remove from docs, was over-scoped

"Defer to v0.1.1" is NOT a valid resolution. Choose one of the above.

---

## PART 6: Outstanding Items Hunt

Search codebase for any remaining issues:

```bash
# Find any remaining TODOs
grep -rn "TODO\|FIXME\|HACK\|XXX\|TEMP" --include="*.ts" --include="*.svelte" --include="*.cjs"

# Find any debug code
grep -rn "console\.log\|console\.debug\|debugger" --include="*.ts" --include="*.svelte"

# Find any commented-out code blocks (3+ consecutive commented lines)
# Manual review needed

# Find any hardcoded dev values
grep -rn "localhost\|127\.0\.0\.1\|:3000\|:5173" --include="*.ts" --include="*.svelte"
```

| Finding | File | Line | Type | Resolution |
|---------|------|------|------|------------|

Every finding must be resolved:
- TODO → Implement or remove with comment explaining why not needed
- console.log → Remove or convert to proper logger
- Commented code → Remove
- Hardcoded dev values → Make configurable or remove

---

## Deliverables

### D1: Verification Report
Create `docs/final/verification-report.md`:

```markdown
# Final Verification Report — v0.1.0-alpha

## Date: [date]

## Previous Work Verification
- Stabilization outputs: [X]/9 complete
- Optimization outputs: [X]/11 complete
- Fixes verified in code: [X]/[Y]

## Regression Check
- Build: PASS/FAIL
- Lint: PASS/FAIL
- Tests: PASS/FAIL

## Documentation Sync
- techguide.md: CURRENT/UPDATED
- lilbits.md: CURRENT/UPDATED
- IMPLEMENTATION_GUIDE.md: CURRENT/UPDATED

## Deferred Items Resolution
- Items found: [count]
- Fixed now: [count]
- Risk accepted: [count]
- Removed as unneeded: [count]
- Still deferred: 0 (MUST BE ZERO)

## Outstanding Items
- TODOs remaining: [count] (MUST BE ZERO)
- Debug code remaining: [count] (MUST BE ZERO)
- Commented code blocks: [count] (MUST BE ZERO)

## Verification Status
[ ] PASSED — Ready for release readiness check
[ ] FAILED — Issues listed below must be resolved
```

### D2: Resolution Log
Create `docs/final/resolution-log.md`:

```markdown
# Resolution Log — v0.1.0-alpha

## Deferred Items Resolved

| Item | Original Location | Resolution | Details |
|------|-------------------|------------|---------|

## Outstanding Items Resolved

| Item | File:Line | Resolution | Details |
|------|-----------|------------|---------|

## Accepted Risks

| Risk | Rationale | Mitigations | Acceptable For Alpha? |
|------|-----------|-------------|----------------------|
```

---

## CONSTRAINTS

- **ZERO deferred items** — Everything resolved or explicitly accepted
- **ZERO TODOs** — All implemented or removed with reason
- **ZERO debug code** — All removed
- **Documentation must be current** — Updated after all fixes
- **Build/lint/test must pass** — No exceptions
- **Protected files** — Do not modify CLAUDE.md, techguide.md, lilbits.md structure (content updates OK)

## COMPLETION CRITERIA

- All previous phase outputs verified
- All claimed fixes verified in code
- No regressions (build/lint/test pass)
- Documentation synced to current code
- Zero items deferred to v0.1.1
- Zero TODOs/debug code remaining

Report: "VERIFICATION [PASSED/FAILED] — [X] items resolved, [Y] risks accepted, [Z] blockers remaining" 

If PASSED, proceed to Release Readiness.
If FAILED, fix all blockers and re-run verification.
```

---

## Release Readiness (Run After Verification Passes)

```
Verification passed. Now performing release readiness for v0.1.0-alpha.

READ:
- @CLAUDE.md
- @techguide.md
- @docs/final/verification-report.md

YOUR TASK: Final release readiness checklist for v0.1.0-alpha.

Note: We are NOT building distributables yet. This verifies the codebase is ready for alpha tagging.

---

## PART 1: Version Consistency

```bash
# Check all version numbers
grep -r '"version"' */package.json package.json
```

| Location | Version | Correct (0.1.0-alpha)? |
|----------|---------|------------------------|
| /package.json | | |
| /packages/core/package.json | | |
| /packages/desktop/package.json | | |

All must be `0.1.0-alpha` or `0.1.0`. Fix any mismatches.

---

## PART 2: User-Facing Documentation

| Document | Exists? | Accurate? | Action Needed |
|----------|---------|-----------|---------------|
| README.md | | | |
| LICENSE | | | |
| CHANGELOG.md | | | |

### README.md Must Have:
- [ ] Project name and one-line description
- [ ] What it does (features)
- [ ] Screenshot or demo (if available)
- [ ] Installation instructions
- [ ] Basic usage
- [ ] Development setup
- [ ] License reference
- [ ] No broken links
- [ ] No placeholder text

### CHANGELOG.md Must Have:
- [ ] v0.1.0-alpha entry
- [ ] Date
- [ ] Summary of what's included
- [ ] Known limitations (if any)

### LICENSE Must:
- [ ] Exist
- [ ] Be correct license type
- [ ] Have correct year and copyright holder

---

## PART 3: First-Run Experience

Test with completely fresh state:

```bash
# Simulate fresh install
rm -rf ./data/au-archive.db
rm -rf [archive-folder-if-exists]
pnpm dev
```

| Check | Status | Notes |
|-------|--------|-------|
| App launches without errors | | |
| No console errors on startup | | |
| Empty state is user-friendly (not broken) | | |
| Clear path to "what do I do first" | | |
| Can select/create archive folder | | |
| Can import first file | | |
| Import completes successfully | | |
| Imported file visible in UI | | |
| Can create first location | | |
| Location saves successfully | | |
| Can link media to location | | |

If ANY fails, this is a BLOCKER. Fix before release.

---

## PART 4: Critical Workflows

Test each core workflow end-to-end:

### Import Workflow
| Step | Works? | Notes |
|------|--------|-------|
| Drag file to import zone | | |
| Progress indication shown | | |
| Hash computed | | |
| File copied to archive | | |
| EXIF extracted | | |
| GPS extracted (if present) | | |
| Thumbnail generated | | |
| Record created in database | | |
| UI updates to show new media | | |
| Import multiple files | | |
| Import with no GPS | | |
| Import duplicate (same hash) | | |

### Location Workflow
| Step | Works? | Notes |
|------|--------|-------|
| Create new location | | |
| Edit location details | | |
| Set GPS coordinates | | |
| Link media to location | | |
| View location on map | | |
| Delete location | | |
| Cascade behavior correct | | |

### Search/Browse Workflow
| Step | Works? | Notes |
|------|--------|-------|
| Browse all locations | | |
| Search by name | | |
| Filter by type | | |
| Filter by state | | |
| View location detail | | |
| Navigate between locations | | |

### Map Workflow
| Step | Works? | Notes |
|------|--------|-------|
| Map loads | | |
| Locations displayed as pins | | |
| Clustering works (if many pins) | | |
| Click pin shows info | | |
| Navigate to location from map | | |
| Offline map works (if Offline Beast) | | |

---

## PART 5: Error Handling UX

Intentionally trigger errors and verify user experience:

| Error Scenario | How to Trigger | User Sees | Acceptable? |
|----------------|----------------|-----------|-------------|
| Import invalid file type | Import .exe or .txt | | |
| Import corrupt image | Import truncated file | | |
| Database locked | Open two instances | | |
| Disk full | Fill disk, try import | | |
| Invalid GPS input | Enter "abc" in lat/lng | | |
| Required field empty | Submit form with empty name | | |
| Delete confirmation | Delete location with media | | |

User should NEVER see:
- Stack traces
- Technical error codes
- Blank screens
- Unresponsive UI
- "undefined" or "null" in UI

---

## PART 6: Accessibility Basics

| Check | Status | Notes |
|-------|--------|-------|
| All interactive elements keyboard accessible | | |
| Focus states visible | | |
| Tab order logical | | |
| Buttons have accessible names | | |
| Images have alt text (or decorative) | | |
| Color not only indicator (icons/text too) | | |
| Text readable (contrast) | | |
| No keyboard traps | | |

---

## PART 7: Configuration & Environment

| Check | Status | Notes |
|-------|--------|-------|
| No hardcoded absolute paths | | |
| No hardcoded credentials | | |
| Default config values sensible | | |
| Config overridable without code changes | | |
| Dev vs prod mode handled correctly | | |
| Database path configurable | | |
| Archive path configurable | | |

---

## PART 8: Cleanup Verification

Final check for any remaining debris:

```bash
# Verify no debug code
grep -rn "console\.log" --include="*.ts" --include="*.svelte" | grep -v node_modules | grep -v "logger\|Logger"

# Verify no test files in production
find . -name "*.test.ts" -o -name "*.spec.ts" | grep -v node_modules

# Verify no .env files committed
git ls-files | grep -i "\.env"

# Verify no large binary files accidentally committed
git ls-files | xargs ls -la 2>/dev/null | awk '$5 > 1000000 {print}'

# Verify .gitignore covers essentials
cat .gitignore
```

| Check | Status |
|-------|--------|
| No console.log (except logger) | |
| Test files not bundled | |
| No .env committed | |
| No large binaries in git | |
| .gitignore covers: node_modules, dist, *.db, .env | |

---

## PART 9: Git Status

```bash
git status
git log --oneline -5
```

| Check | Status |
|-------|--------|
| Working directory clean | |
| On correct branch (main) | |
| All changes committed | |
| Commit messages meaningful | |
| No merge conflicts | |

---

## Deliverables

### D1: Release Readiness Report
Create `docs/final/release-readiness.md`:

```markdown
# Release Readiness Report — v0.1.0-alpha

## Date: [date]

## Summary
| Category | Checks | Passed | Failed | Blockers |
|----------|--------|--------|--------|----------|
| Version Consistency | | | | |
| User Docs | | | | |
| First-Run Experience | | | | |
| Critical Workflows | | | | |
| Error Handling UX | | | | |
| Accessibility | | | | |
| Configuration | | | | |
| Cleanup | | | | |
| Git Status | | | | |
| **TOTAL** | | | | |

## Blockers (Must Fix)
[List each with details]

## Warnings (Should Fix)
[List each with details]

## Known Limitations (Documented)
[List anything intentionally not included in alpha]

## Release Decision
[ ] ✅ READY — Proceed to tag v0.1.0-alpha
[ ] ❌ NOT READY — Fix blockers first
```

### D2: Alpha Release Notes Draft
Create `docs/final/RELEASE_NOTES_v0.1.0-alpha.md`:

```markdown
# Abandoned Archive v0.1.0-alpha

**Release Date:** [date]
**Platform:** macOS (Windows not yet supported)

## What's Included

### Core Features
- [list features]

### What Works
- [list]

### Known Limitations
- Windows not supported
- [other limitations]

### Requirements
- macOS [version]
- Node [version] (for dev)

## Installation

[Instructions]

## Feedback

[How to report issues]
```

---

## CONSTRAINTS

- **No blockers allowed** — All must be fixed
- **No "fix later"** — This is the final gate
- **Test with fresh state** — Not your dev database
- **User perspective** — Would YOU ship this to a user?

## COMPLETION CRITERIA

- All checks passed or blockers fixed
- All documentation exists and accurate
- All workflows tested and working
- Git clean and ready to tag
- Release notes drafted

Report: "RELEASE READINESS: [READY/NOT READY] — [X] checks passed, [Y] blockers, [Z] warnings"

If READY:
```bash
git add -A
git commit -m "chore: final prep for v0.1.0-alpha"
git tag -a v0.1.0-alpha -m "v0.1.0-alpha — Initial alpha release"
git push origin main
git push origin v0.1.0-alpha
```

Report: "v0.1.0-alpha TAGGED AND PUSHED — Ready for distribution build"
```

---

## Complete Sequence Summary

| Order | Prompt | Purpose | Deferral Allowed? |
|-------|--------|---------|-------------------|
| 1 | Stabilization (8 phases) | Documentation accuracy | ❌ |
| 2 | Optimization (9 phases) | Code quality | ❌ |
| 3 | Adversarial Audit | Security, edge cases | ❌ |
| 4 | **Final Verification** (this file, Part 1) | Verify all work done | ❌ |
| 5 | **Release Readiness** (this file, Part 2) | Final gate | ❌ |
| 6 | **Tag v0.1.0-alpha** | Git release | — |
| 7 | Build Distributables | Create .dmg/.app | — |

## What This Adds Beyond Previous Prompts

| Addition | Why |
|----------|-----|
| Verify previous work actually done | Phases can be skipped or incomplete |
| Verify fixes actually in code | Fix logs can lie |
| Force resolution of ALL deferrals | No v0.1.1 dumping ground |
| Hunt remaining TODOs/debug code | Easy to miss |
| Documentation sync check | Docs go stale after fixes |
| First-run experience test | Devs never test empty state |
| Error handling UX audit | Users see errors, devs don't |
| Accessibility basics | Legal and ethical requirement |
| Critical workflow testing | Integration often breaks |
| Git cleanliness | Prevents release accidents |
| Alpha release notes draft | Communicates what's included |
