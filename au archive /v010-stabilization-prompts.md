# v0.1.0 Stabilization Prompt Sequence

## Overview

This prompt sequence takes a vibe-coded v0.1.0 from "works on my machine" to "documented, audited, and release-ready." Execute phases in order. Do not skip phases. Do not prompt user until Phase 8 completion report.

---

## PHASE 1: Codebase Reconnaissance

```
You are beginning a comprehensive stabilization of Abandoned Archive v0.1.0.

READ FIRST — IN THIS ORDER:
1. @CLAUDE.md (the complete file)
2. @techguide.md (current state, may be incomplete)
3. @lilbits.md (current state, may be incomplete)

YOUR TASK: Generate a complete codebase map without modifying any files.

## Deliverables

### 1.1 File Inventory
Create a table of EVERY file in the project:

| Path | Type | Lines | Purpose (1 sentence) | Dependencies |
|------|------|-------|----------------------|--------------|

Include: .ts, .svelte, .cjs, .sql, .sh, .py, .mjs, .json (config only), .md (docs only)
Exclude: node_modules, dist, .git, generated files

### 1.2 Script Inventory
For every file in `scripts/`:

| Script | Lines | Shebang/Runtime | Inputs | Outputs | Side Effects | Documented in lilbits.md? |
|--------|-------|-----------------|--------|---------|--------------|---------------------------|

### 1.3 IPC Channel Map
List every IPC channel in use:

| Channel | Direction | Handler Location | Renderer Caller | Validated? |
|---------|-----------|------------------|-----------------|------------|

### 1.4 Database Schema Snapshot
From `migrations/` only (do NOT read schema from anywhere else):

| Table | Columns | Foreign Keys | Indexes | Purpose |
|-------|---------|--------------|---------|---------|

### 1.5 Dependency Audit
From package.json files:

| Package | Version | License | Why Needed | Offline-Safe? |
|---------|---------|---------|------------|---------------|

Flag any: unknown licenses, Google services, network-required deps

### 1.6 Gap Detection
List anything that seems:
- Incomplete (stub functions, TODO comments, empty handlers)
- Orphaned (files not imported anywhere)
- Duplicated (same logic in multiple places)
- Undocumented (complex logic with no comments)

## CONSTRAINTS
- DO NOT modify any files
- DO NOT run any commands that change state
- You MAY run read-only commands: cat, find, grep, wc, tree
- Output as markdown to `docs/stabilization/phase1-recon.md`

## COMPLETION CRITERIA
Phase 1 is complete when all 6 deliverables are generated and saved.
Report: "PHASE 1 COMPLETE — Ready for Phase 2" and STOP.
```

---

## PHASE 2: Documentation Reconstruction

```
Continue v0.1.0 stabilization. You completed Phase 1 (codebase recon).

READ:
- @CLAUDE.md
- @docs/stabilization/phase1-recon.md (your Phase 1 output)

YOUR TASK: Reconstruct techguide.md and lilbits.md to accurately reflect the codebase.

## CRITICAL CONSTRAINTS
- DO NOT invent features that don't exist
- DO NOT document aspirational functionality
- Document ONLY what the code actually does today
- These files are protected per CLAUDE.md — you are reconstructing them under explicit human authorization for v0.1.0 stabilization

## Deliverables

### 2.1 techguide.md (Complete Rewrite)

Structure:
```markdown
# Tech Guide — Abandoned Archive v0.1.0

## Environment Requirements
[Exact versions, OS requirements, native deps]

## Repository Structure
[Directory tree with purpose of each folder]

## Setup From Scratch
[Step-by-step, copy-paste commands, expected output at each step]

## Build System
[Vite config explanation, what gets bundled vs copied, output locations]

## Database
[Location, connection setup, PRAGMA requirements, migration running]

## IPC Architecture
[Channel naming, handler registration, preload bridge details]

## Native Modules
[Which ones, why, rebuild commands, platform gotchas]

## Development Workflow
[Start dev, make changes, test, lint, commit]

## Troubleshooting
[Every known issue with solution — pull from Phase 1 gap detection]

## Platform-Specific Notes
[macOS, Windows, Linux differences]
```

### 2.2 lilbits.md (Complete Rewrite)

Structure:
```markdown
# Script Registry — Abandoned Archive v0.1.0

> Every script under 300 LOC, documented here. If it's not here, it shouldn't exist.

## Scripts

### [script-name.ext]
- **Path**: `scripts/[script-name.ext]`
- **Lines**: [count]
- **Runtime**: [bash/node/python/ts-node]
- **Purpose**: [1-2 sentences]
- **Usage**: `[exact command to run]`
- **Inputs**: [args, env vars, files read]
- **Outputs**: [files written, stdout, side effects]
- **Dependencies**: [external tools required]
- **Last Verified**: [today's date]

[Repeat for every script]

## Scripts Exceeding 300 LOC
[List any that violate the rule, with note about whether to split or exempt]
```

### 2.3 Documentation Diff Report
Create `docs/stabilization/phase2-diff.md`:
- What was in old techguide.md vs new
- What was in old lilbits.md vs new
- What was missing entirely
- What was documented but didn't exist in code

## COMPLETION CRITERIA
- techguide.md accurately reflects codebase
- lilbits.md has entry for every script
- Diff report generated
Report: "PHASE 2 COMPLETE — Ready for Phase 3" and STOP.
```

---

## PHASE 3: Deep Code Audit

```
Continue v0.1.0 stabilization. Phases 1-2 complete.

READ:
- @CLAUDE.md
- @techguide.md (freshly reconstructed)
- @lilbits.md (freshly reconstructed)
- @docs/stabilization/phase1-recon.md

YOUR TASK: Audit every code file against CLAUDE.md rules and best practices.

## Audit Checklist Per File

For each .ts, .svelte, .cjs file:

| Check | Pass/Fail | Notes |
|-------|-----------|-------|
| Follows naming convention (CLAUDE.md) | | |
| No TODO/FIXME comments | | |
| No unexplained generated code | | |
| No hardcoded paths (uses config) | | |
| Error handling present | | |
| Errors logged (not swallowed) | | |
| Database operations use transactions where needed | | |
| IPC handlers validate input | | |
| No console.log in production code (use logger) | | |
| Imports are used (no dead imports) | | |
| Exports are consumed (no dead exports) | | |
| Complex logic has comments | | |
| Follows offline-first principle | | |
| No network calls without fallback | | |

## Deliverables

### 3.1 Audit Report
Create `docs/stabilization/phase3-audit.md`:

```markdown
# Code Audit Report — v0.1.0

## Summary
- Files audited: [count]
- Issues found: [count]
- Critical: [count]
- Major: [count]  
- Minor: [count]

## Critical Issues (blocks release)
[List with file, line, issue, suggested fix]

## Major Issues (should fix before release)
[List with file, line, issue, suggested fix]

## Minor Issues (fix if time permits)
[List with file, line, issue, suggested fix]

## Files Passing All Checks
[List]
```

### 3.2 Issue Tracker
Create `docs/stabilization/phase3-issues.md`:

| ID | Severity | File | Line | Issue | Fix | Status |
|----|----------|------|------|-------|-----|--------|
| A001 | Critical | ... | ... | ... | ... | Open |

## CONSTRAINTS
- DO NOT fix anything yet — audit only
- Flag issues, don't resolve them
- Be thorough — check every file

## COMPLETION CRITERIA
- Every code file audited
- Issues categorized by severity
- Issue tracker populated
Report: "PHASE 3 COMPLETE — [X] critical, [Y] major, [Z] minor issues found. Ready for Phase 4" and STOP.
```

---

## PHASE 4: Fix Plan Creation

```
Continue v0.1.0 stabilization. Phases 1-3 complete.

READ:
- @CLAUDE.md
- @docs/stabilization/phase3-audit.md
- @docs/stabilization/phase3-issues.md

YOUR TASK: Create a detailed fix plan that addresses all critical and major issues.

## Deliverables

### 4.1 Fix Plan
Create `docs/stabilization/phase4-fix-plan.md`:

```markdown
# Fix Plan — v0.1.0 Stabilization

## Principles
- Premium UX: No user prompts, no rough edges
- Offline-first: Everything works without network
- Data integrity: All operations logged to database
- No scope creep: Fix issues, don't add features

## Fix Order
[Ordered by dependency — what must be fixed first]

## Fix Details

### FIX-001: [Issue title]
- **Issue ID**: A001
- **File**: [path]
- **Current Code**:
```[language]
[exact code that needs changing]
```
- **Fixed Code**:
```[language]
[exact replacement code]
```
- **Rationale**: [why this fix]
- **Testing**: [how to verify fix worked]
- **Risk**: [what could break]

[Repeat for all critical and major issues]

## Deferred to v0.1.1
[Minor issues not being fixed, with justification]
```

### 4.2 Risk Assessment
| Fix ID | Risk Level | Rollback Plan |
|--------|------------|---------------|
| FIX-001 | Low/Med/High | [how to undo if broken] |

### 4.3 Ultrathink Validation
Before finalizing, validate the fix plan:

<ultrathink>
Review the entire fix plan against:
1. CLAUDE.md rules — does any fix violate a rule?
2. Scope discipline — are we only fixing, not adding?
3. Dependencies — is fix order correct?
4. Risk — are high-risk fixes justified?
5. Premium UX — will fixes improve or degrade UX?
6. Data integrity — do fixes maintain logging/hashing contracts?
7. Offline-first — do fixes work without network?

Flag any concerns before proceeding.
</ultrathink>

## COMPLETION CRITERIA
- Fix plan covers all critical and major issues
- Fix order accounts for dependencies
- Risk assessment complete
- Ultrathink validation passed
Report: "PHASE 4 COMPLETE — [X] fixes planned. Ready for Phase 5" and STOP.
```

---

## PHASE 5: Implementation

```
Continue v0.1.0 stabilization. Phases 1-4 complete.

READ:
- @CLAUDE.md
- @docs/stabilization/phase4-fix-plan.md

YOUR TASK: Implement all fixes from the fix plan, in order.

## Implementation Protocol

For each fix:
1. Read the fix details completely
2. Locate the file
3. Verify current code matches what's documented
4. Apply the fix exactly as specified
5. Run `pnpm -r lint` after each fix
6. Run `pnpm -r test` after each fix (if tests exist)
7. Log the fix in implementation log

## Deliverables

### 5.1 Implementation Log
Create `docs/stabilization/phase5-implementation.md`:

```markdown
# Implementation Log — v0.1.0 Stabilization

## Fixes Applied

### FIX-001: [title]
- **Status**: ✅ Applied / ⚠️ Modified / ❌ Skipped
- **Actual Change**: [what was actually changed, if different from plan]
- **Lint**: Pass/Fail
- **Test**: Pass/Fail/No Tests
- **Notes**: [any issues encountered]

[Repeat for all fixes]

## Summary
- Fixes applied: [count]
- Fixes modified: [count]  
- Fixes skipped: [count]
- Lint status: [pass/fail]
- Test status: [pass/fail/no tests]
```

### 5.2 Post-Fix Verification
After all fixes applied:
1. Run full build: `pnpm build`
2. Run full lint: `pnpm -r lint`
3. Run full test: `pnpm -r test`
4. Start app: `pnpm dev` — verify it launches
5. Test critical paths manually (if possible in headless mode)

## CONSTRAINTS
- Apply fixes EXACTLY as specified unless impossible
- If a fix can't be applied as written, document why and propose alternative
- DO NOT fix additional issues discovered — log them for Phase 7
- DO NOT add features

## COMPLETION CRITERIA
- All planned fixes applied or documented as skipped
- Build passes
- Lint passes (or known exceptions documented)
- App launches
Report: "PHASE 5 COMPLETE — [X] fixes applied, [Y] skipped. Build: [status]. Ready for Phase 6" and STOP.
```

---

## PHASE 6: Implementation Guide

```
Continue v0.1.0 stabilization. Phases 1-5 complete.

READ:
- @CLAUDE.md
- @techguide.md
- @lilbits.md
- @docs/stabilization/phase5-implementation.md

YOUR TASK: Write a comprehensive implementation guide that a less experienced developer could follow to understand and maintain this codebase.

## Deliverables

### 6.1 Implementation Guide
Create `docs/IMPLEMENTATION_GUIDE.md`:

```markdown
# Implementation Guide — Abandoned Archive v0.1.0

> This guide explains how the codebase works for developers new to the project.

## Prerequisites
[What you need to know before reading this: TypeScript, Svelte, Electron, SQLite]

## Architecture Overview
[Diagram or description of how pieces fit together]

## Core Concepts

### Locations
[What is a location, how it's stored, how it's created/updated]

### Media
[What is media, the hashing contract, import flow]

### GPS
[Confidence ladder, how coordinates are stored, map integration]

### Archive Structure
[Folder layout, why it's organized this way]

## Data Flow

### Import Flow
[Step by step: file dropped → hash → copy → database → UI update]

### Edit Flow
[Step by step: user edits → validation → database → UI update]

### Export Flow
[Step by step: user exports → packaging → verification]

## Key Files Explained

### Preload Bridge
[Why it's CommonJS, what it exposes, how to add new IPC]

### Database Service
[Connection management, transactions, migrations]

### Hash Service
[Algorithm, when hashing happens, integrity verification]

[Continue for all major components]

## Common Tasks

### Adding a New IPC Channel
[Step by step with code examples]

### Adding a New Database Table
[Step by step: migration, types, repository, handlers]

### Adding a New UI Component
[Step by step: Svelte component, wiring to data]

## Debugging

### How to Debug Main Process
[Instructions]

### How to Debug Renderer
[Instructions]

### How to Debug Preload
[Instructions]

### Common Errors and Solutions
[Table of errors → fixes]

## Testing

### Running Tests
[Commands]

### Writing New Tests
[Patterns, examples]

### What to Test
[Priorities from CLAUDE.md: GPS parsing, hashing, preload bridge]

## Deployment

### Building for Release
[Commands, outputs, verification]

### Platform-Specific Builds
[macOS, Windows, Linux]
```

## CONSTRAINTS
- Write for a developer with 1-2 years experience
- Use concrete examples, not abstract descriptions
- Include actual code snippets from the codebase
- Cross-reference CLAUDE.md, techguide.md, lilbits.md where appropriate

## COMPLETION CRITERIA
- Guide covers all major systems
- A new developer could understand the codebase from this guide
- No placeholder sections
Report: "PHASE 6 COMPLETE — Implementation guide ready. Ready for Phase 7" and STOP.
```

---

## PHASE 7: Final Audit

```
Continue v0.1.0 stabilization. Phases 1-6 complete.

READ:
- @CLAUDE.md
- @techguide.md (updated)
- @lilbits.md (updated)
- @docs/IMPLEMENTATION_GUIDE.md
- @docs/stabilization/phase5-implementation.md

YOUR TASK: Final audit of code against documentation. Verify everything matches.

## Audit Checklist

### 7.1 Docs vs Code Verification

| Document | Section | Matches Code? | Discrepancy |
|----------|---------|---------------|-------------|
| CLAUDE.md | Commands | | |
| CLAUDE.md | Architecture | | |
| CLAUDE.md | File naming | | |
| CLAUDE.md | IPC naming | | |
| techguide.md | Setup steps | | |
| techguide.md | Build system | | |
| techguide.md | Database | | |
| lilbits.md | Each script | | |
| IMPLEMENTATION_GUIDE.md | Data flows | | |
| IMPLEMENTATION_GUIDE.md | Key files | | |

### 7.2 Regression Check
Re-run Phase 3 audit checklist on all modified files. Any new issues?

### 7.3 UX Audit
Start the app and verify:

| Check | Status | Notes |
|-------|--------|-------|
| App launches without error | | |
| No console errors on startup | | |
| All navigation works | | |
| Import flow completes | | |
| No loading spinners that never resolve | | |
| No broken images/icons | | |
| Offline mode works (disable network) | | |

### 7.4 Data Integrity Check
| Check | Status | Notes |
|-------|--------|-------|
| Database creates successfully | | |
| Migrations run in order | | |
| Foreign keys enforced | | |
| Hashing produces consistent results | | |
| Import creates correct folder structure | | |

## Deliverables

### 7.5 Final Audit Report
Create `docs/stabilization/phase7-final-audit.md`:

```markdown
# Final Audit Report — v0.1.0

## Documentation Accuracy
- Matches: [count]
- Discrepancies: [count] (list below)

## Code Quality
- Files passing all checks: [count]
- New issues found: [count] (list below)

## UX Status
- Checks passing: [count]
- Checks failing: [count] (list below)

## Data Integrity
- Checks passing: [count]
- Checks failing: [count] (list below)

## Outstanding Issues
[Anything not fixed, with severity and justification for deferring]

## Release Readiness
[ ] Documentation complete and accurate
[ ] Critical issues resolved
[ ] Major issues resolved  
[ ] App launches and core flows work
[ ] Offline mode functional
[ ] Data integrity verified
```

## COMPLETION CRITERIA
- All verifications complete
- Discrepancies either fixed or documented
- Release readiness checklist filled
Report: "PHASE 7 COMPLETE — Release readiness: [X]/6 criteria met. Ready for Phase 8" and STOP.
```

---

## PHASE 8: Release Preparation

```
Continue v0.1.0 stabilization. Phases 1-7 complete.

READ:
- @CLAUDE.md
- @docs/stabilization/phase7-final-audit.md

YOUR TASK: Prepare final release and upload to GitHub.

## Pre-Release Checklist

### 8.1 Version Verification
- [ ] package.json version is 0.1.0
- [ ] All package.json files in monorepo have consistent version
- [ ] CHANGELOG.md exists with v0.1.0 entry

### 8.2 Documentation Final Check
- [ ] README.md is up to date
- [ ] CLAUDE.md unchanged (protected)
- [ ] techguide.md complete
- [ ] lilbits.md complete
- [ ] IMPLEMENTATION_GUIDE.md complete
- [ ] No TODO comments in documentation

### 8.3 Code Final Check  
- [ ] No TODO/FIXME comments
- [ ] No console.log statements (except logger)
- [ ] No commented-out code blocks
- [ ] Lint passes: `pnpm -r lint`
- [ ] Build passes: `pnpm build`
- [ ] Tests pass: `pnpm -r test`

### 8.4 Git Preparation
- [ ] All changes committed
- [ ] Commit messages follow convention
- [ ] Branch is clean (no uncommitted changes)
- [ ] No sensitive data in repo (API keys, passwords)

### 8.5 GitHub Upload
Execute:
```bash
git add -A
git commit -m "chore: v0.1.0 stabilization complete

- Documentation reconstructed (techguide.md, lilbits.md)
- [X] critical issues fixed
- [Y] major issues fixed
- Implementation guide added
- Final audit passed

See docs/stabilization/ for full audit trail."

git push origin main
git tag -a v0.1.0 -m "v0.1.0 — Initial stable release"
git push origin v0.1.0
```

## Deliverables

### 8.6 Completion Report
Create `docs/stabilization/phase8-completion.md`:

```markdown
# v0.1.0 Stabilization Complete

## Summary
- **Start**: [timestamp]
- **End**: [timestamp]
- **Phases completed**: 8/8

## Metrics
- Files audited: [count]
- Issues found: [count]
- Issues fixed: [count]
- Issues deferred: [count]
- Documentation files updated: [count]
- Lines of documentation written: [count]

## Completion Score

| Category | Score | Max | Notes |
|----------|-------|-----|-------|
| Documentation accuracy | | 20 | |
| Code quality | | 20 | |
| Test coverage | | 15 | |
| UX polish | | 15 | |
| Data integrity | | 15 | |
| Offline capability | | 10 | |
| Build reliability | | 5 | |
| **TOTAL** | | 100 | |

## Final Score: [X]/100

## Release Status
- [ ] Git tag created: v0.1.0
- [ ] Pushed to GitHub
- [ ] Release notes written

## Known Limitations
[What's not perfect, documented for v0.1.1]

## Recommendations for v0.1.1
[Priority improvements based on audit findings]
```

## COMPLETION CRITERIA
- All checklists complete
- Git tag created and pushed
- Completion report generated with score
Report to user: "v0.1.0 STABILIZATION COMPLETE — Score: [X]/100. See docs/stabilization/phase8-completion.md for full report."
```

---

## Usage Instructions

1. Start a new Claude Code session
2. Paste Phase 1 prompt
3. Wait for "PHASE 1 COMPLETE" message
4. Paste Phase 2 prompt
5. Continue through all 8 phases
6. Only interrupt if Claude Code reports a blocker

## Important Notes

- Each phase builds on previous phases — do not skip
- Claude Code will not prompt you until Phase 8 completion
- All artifacts saved to `docs/stabilization/` for audit trail
- If any phase fails, address the failure before continuing
- Estimated time: 2-4 hours depending on codebase size
