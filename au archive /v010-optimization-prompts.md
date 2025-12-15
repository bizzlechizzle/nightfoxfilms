# v0.1.0 Post-Stabilization Optimization

## Overview

Now that documentation is clean and accurate, this prompt sequence focuses on:
- Bug hunting and edge case handling
- Performance optimization (load times, rendering, database queries)
- Best practices alignment
- Gap filling from vibe-coded shortcuts
- UX polish for premium feel

Execute phases in order. Each phase builds on previous findings.

---

## PHASE 1: Bug Hunt

```
You are beginning post-stabilization optimization for Abandoned Archive v0.1.0.

READ FIRST — IN THIS ORDER:
1. @CLAUDE.md (complete file)
2. @techguide.md
3. @lilbits.md
4. @docs/stabilization/phase6-implementation-guide.md

YOUR TASK: Systematic bug hunting across the entire codebase.

## Bug Categories to Hunt

### 1.1 Error Handling Gaps
For every function that can fail:

| File | Function | Can Throw? | Caught? | User Feedback? | Logged? |
|------|----------|------------|---------|----------------|---------|

Flag any that:
- Throw but aren't caught
- Catch but swallow silently (no log, no UI feedback)
- Show technical errors to user instead of friendly messages
- Don't have try/catch around async operations

### 1.2 Edge Cases
Test these scenarios mentally (trace the code path):

| Scenario | Expected Behavior | Actual Code Path | Bug? |
|----------|-------------------|------------------|------|
| Import 0 files | | | |
| Import 1000+ files | | | |
| Import file with no EXIF | | | |
| Import file with corrupt EXIF | | | |
| Import duplicate file (same hash) | | | |
| Import while previous import running | | | |
| Delete location with 100+ media | | | |
| Search with no results | | | |
| Search with special characters | | | |
| Map with 0 locations | | | |
| Map with 1000+ locations | | | |
| GPS coordinates at 0,0 | | | |
| GPS coordinates at poles | | | |
| Very long location name (500+ chars) | | | |
| Unicode in all text fields | | | |
| Database locked (another process) | | | |
| Disk full during import | | | |
| File deleted after import started | | | |
| Network timeout (online features) | | | |
| App closed during operation | | | |

### 1.3 State Management Issues
Check for:

| Issue Type | Locations Found | Severity |
|------------|-----------------|----------|
| Stale state after mutation | | |
| Race conditions (concurrent updates) | | |
| Memory leaks (unsubscribed listeners) | | |
| Zombie processes (unclosed handles) | | |
| UI not updating after DB change | | |
| Optimistic updates without rollback | | |

### 1.4 Data Integrity Risks
Check for:

| Risk | Code Location | Mitigation Present? |
|------|---------------|---------------------|
| Partial write (crash mid-operation) | | |
| Hash mismatch not detected | | |
| Foreign key violation possible | | |
| Orphaned records possible | | |
| Transaction not used where needed | | |

## Deliverables

### 1.5 Bug Report
Create `docs/optimization/phase1-bugs.md`:

```markdown
# Bug Hunt Report — v0.1.0

## Summary
- Critical bugs: [count]
- Major bugs: [count]
- Minor bugs: [count]
- Edge cases unhandled: [count]

## Critical Bugs (data loss or crash risk)

### BUG-C001: [title]
- **File**: [path]
- **Line**: [number]
- **Trigger**: [how to reproduce]
- **Impact**: [what goes wrong]
- **Root Cause**: [why it happens]
- **Suggested Fix**: [code or approach]

## Major Bugs (broken functionality)
[Same format]

## Minor Bugs (annoyances)
[Same format]

## Unhandled Edge Cases
[Table from 1.2 filtered to bugs only]

## State Management Issues
[From 1.3]

## Data Integrity Risks
[From 1.4]
```

## CONSTRAINTS
- DO NOT fix anything yet — hunt only
- Trace code paths, don't just grep for patterns
- Consider the user's perspective for every scenario
- Flag uncertainty — "possible bug, needs testing"

## COMPLETION CRITERIA
- All categories audited
- Bugs categorized by severity
- Each bug has root cause identified
Report: "PHASE 1 COMPLETE — [X] critical, [Y] major, [Z] minor bugs found. Ready for Phase 2" and STOP.
```

---

## PHASE 2: Performance Profiling

```
Continue post-stabilization optimization. Phase 1 complete.

READ:
- @CLAUDE.md
- @techguide.md
- @docs/optimization/phase1-bugs.md

YOUR TASK: Identify performance bottlenecks and optimization opportunities.

## Performance Audit Areas

### 2.1 Startup Performance
Trace the startup sequence:

| Step | File | What Happens | Blocking? | Est. Time | Optimizable? |
|------|------|--------------|-----------|-----------|--------------|
| 1 | main.ts | Electron init | Yes | | |
| 2 | | | | | |

Flag:
- Synchronous operations that could be async
- Sequential operations that could be parallel
- Work done at startup that could be deferred
- Large imports that could be lazy-loaded

### 2.2 Database Performance
For every database query:

| Query Location | Operation | Table(s) | Has Index? | N+1 Risk? | Optimizable? |
|----------------|-----------|----------|------------|-----------|--------------|

Flag:
- Queries without indexes on WHERE/JOIN columns
- N+1 query patterns (loop with query inside)
- SELECT * when only some columns needed
- Missing LIMIT on potentially large result sets
- Transactions held too long

### 2.3 Rendering Performance
For every Svelte component:

| Component | Re-renders On | Heavy Computation? | Could Memoize? | List Virtualized? |
|-----------|---------------|--------------------| ---------------|-------------------|

Flag:
- Components re-rendering on unrelated state changes
- Expensive computations in reactive statements
- Large lists without virtualization
- Images without lazy loading
- Heavy components not code-split

### 2.4 IPC Performance
For every IPC channel:

| Channel | Payload Size | Frequency | Batching? | Caching? |
|---------|--------------|-----------|-----------|----------|

Flag:
- Large payloads sent frequently
- Multiple calls that could be batched
- Repeated identical requests (no caching)
- Synchronous IPC where async would work

### 2.5 File System Performance
For every file operation:

| Operation | File | Sync/Async? | Buffered? | Could Stream? |
|-----------|------|-------------|-----------|---------------|

Flag:
- Synchronous file operations on main thread
- Reading entire files into memory when streaming would work
- Repeated file access that could be cached
- Missing error handling on file ops

### 2.6 Memory Usage
Check for:

| Issue | Location | Severity |
|-------|----------|----------|
| Large objects held in memory | | |
| Event listeners not removed | | |
| Closures capturing large scopes | | |
| Caching without eviction | | |
| Buffers not released | | |

## Deliverables

### 2.7 Performance Report
Create `docs/optimization/phase2-performance.md`:

```markdown
# Performance Profiling Report — v0.1.0

## Startup Analysis
- Current estimated startup time: [X]ms
- Blocking operations: [count]
- Optimization potential: [X]ms reduction

### Startup Bottlenecks
| Priority | Location | Issue | Potential Gain |
|----------|----------|-------|----------------|

## Database Analysis
- Queries audited: [count]
- Missing indexes: [count]
- N+1 patterns: [count]

### Query Optimizations
| Priority | Query Location | Issue | Fix |
|----------|----------------|-------|-----|

## Rendering Analysis
- Components audited: [count]
- Unnecessary re-renders: [count]
- Unvirtualized lists: [count]

### Rendering Optimizations
| Priority | Component | Issue | Fix |
|----------|-----------|-------|-----|

## IPC Analysis
[Same format]

## File System Analysis
[Same format]

## Memory Analysis
[Same format]

## Quick Wins (< 30 min each)
[List of easy optimizations with high impact]

## Major Optimizations (> 2 hours each)
[List of significant refactors needed]
```

## CONSTRAINTS
- DO NOT fix anything yet — profile only
- Estimate impact (high/medium/low) for each issue
- Prioritize user-perceived performance (startup, UI responsiveness)
- Consider offline-first constraints (can't rely on CDN, etc.)

## COMPLETION CRITERIA
- All performance areas audited
- Issues prioritized by impact
- Quick wins identified
Report: "PHASE 2 COMPLETE — [X] quick wins, [Y] major optimizations identified. Ready for Phase 3" and STOP.
```

---

## PHASE 3: Best Practices Alignment

```
Continue post-stabilization optimization. Phases 1-2 complete.

READ:
- @CLAUDE.md
- @techguide.md
- @docs/optimization/phase1-bugs.md
- @docs/optimization/phase2-performance.md

YOUR TASK: Align codebase with TypeScript, Svelte, Electron, and SQLite best practices.

## Best Practices Audit

### 3.1 TypeScript Best Practices

| Practice | Followed? | Violations | Severity |
|----------|-----------|------------|----------|
| No `any` types | | | |
| No type assertions without validation | | | |
| Strict null checks utilized | | | |
| Discriminated unions for state | | | |
| Proper error types (not just Error) | | | |
| Interfaces for contracts, types for data | | | |
| No implicit any in callbacks | | | |
| Proper generic constraints | | | |
| Readonly where mutation not needed | | | |
| Proper enum usage (const enum for perf) | | | |

### 3.2 Svelte Best Practices

| Practice | Followed? | Violations | Severity |
|----------|-----------|------------|----------|
| Reactive statements for derived state | | | |
| Stores for shared state | | | |
| Component composition over inheritance | | | |
| Props have default values | | | |
| Events properly typed | | | |
| Lifecycle cleanup (onDestroy) | | | |
| Keyed each blocks for lists | | | |
| Slots for flexible composition | | | |
| Actions for DOM manipulation | | | |
| No direct DOM manipulation in components | | | |

### 3.3 Electron Best Practices

| Practice | Followed? | Violations | Severity |
|----------|-----------|------------|----------|
| Context isolation enabled | | | |
| No node integration in renderer | | | |
| IPC for all main/renderer communication | | | |
| Validate IPC inputs in main process | | | |
| No remote module | | | |
| Proper window management | | | |
| App single instance lock | | | |
| Proper quit handling | | | |
| No shell.openExternal with untrusted URLs | | | |
| CSP headers configured | | | |

### 3.4 SQLite Best Practices

| Practice | Followed? | Violations | Severity |
|----------|-----------|------------|----------|
| Prepared statements (no string concat) | | | |
| Transactions for multi-statement ops | | | |
| Foreign keys enabled | | | |
| Proper indexes on query columns | | | |
| WAL mode for concurrency | | | |
| Proper connection lifecycle | | | |
| No SQL in renderer process | | | |
| Migrations versioned and sequential | | | |
| Backup strategy documented | | | |
| VACUUM scheduled | | | |

### 3.5 General Best Practices

| Practice | Followed? | Violations | Severity |
|----------|-----------|------------|----------|
| Single responsibility (files < 300 LOC) | | | |
| DRY (no copy-paste code) | | | |
| Consistent error handling pattern | | | |
| Logging at appropriate levels | | | |
| Configuration externalized | | | |
| Secrets not in code | | | |
| Dead code removed | | | |
| Comments explain why, not what | | | |
| Consistent naming conventions | | | |
| Proper async/await (no floating promises) | | | |

## Deliverables

### 3.6 Best Practices Report
Create `docs/optimization/phase3-best-practices.md`:

```markdown
# Best Practices Alignment Report — v0.1.0

## Summary
| Category | Practices | Following | Violations |
|----------|-----------|-----------|------------|
| TypeScript | 10 | | |
| Svelte | 10 | | |
| Electron | 10 | | |
| SQLite | 10 | | |
| General | 10 | | |
| **Total** | 50 | | |

## Alignment Score: [X]/50 ([Y]%)

## Critical Violations (security/data risk)
[List with file, line, violation, fix]

## Major Violations (maintainability risk)
[List with file, line, violation, fix]

## Minor Violations (style/convention)
[List with file, line, violation, fix]

## Patterns to Establish
[Common fixes that should become project patterns]

## Refactoring Candidates
[Files that need significant restructuring]
```

## CONSTRAINTS
- DO NOT fix anything yet — audit only
- Focus on violations that affect reliability and maintainability
- Note patterns, not just individual violations
- Consider project-specific context (CLAUDE.md rules)

## COMPLETION CRITERIA
- All 50 practices audited
- Violations documented with location and severity
- Alignment score calculated
Report: "PHASE 3 COMPLETE — Alignment score: [X]/50. [Y] critical, [Z] major violations. Ready for Phase 4" and STOP.
```

---

## PHASE 4: Gap Analysis

```
Continue post-stabilization optimization. Phases 1-3 complete.

READ:
- @CLAUDE.md
- @techguide.md
- @docs/stabilization/phase6-implementation-guide.md
- @docs/optimization/phase1-bugs.md
- @docs/optimization/phase2-performance.md
- @docs/optimization/phase3-best-practices.md

YOUR TASK: Identify gaps from vibe-coding — missing pieces that a production app needs.

## Gap Categories

### 4.1 Error Recovery Gaps
What happens when things go wrong?

| Scenario | Recovery Mechanism? | User Can Retry? | State Consistent? |
|----------|---------------------|-----------------|-------------------|
| Import fails mid-batch | | | |
| Database write fails | | | |
| File copy fails | | | |
| Hash verification fails | | | |
| IPC timeout | | | |
| Renderer crash | | | |

### 4.2 Logging Gaps
Is everything observable?

| Event Type | Logged? | Log Level | Includes Context? |
|------------|---------|-----------|-------------------|
| App start/stop | | | |
| User actions | | | |
| Database operations | | | |
| File operations | | | |
| Errors | | | |
| Performance metrics | | | |

### 4.3 Validation Gaps
Is input validated?

| Input Point | Validated? | Sanitized? | Error Message Clear? |
|-------------|------------|------------|----------------------|
| IPC from renderer | | | |
| User form input | | | |
| File paths | | | |
| GPS coordinates | | | |
| Database query params | | | |
| Import file types | | | |

### 4.4 User Feedback Gaps
Does user know what's happening?

| Operation | Loading State? | Progress? | Success Feedback? | Error Feedback? |
|-----------|----------------|-----------|-------------------|-----------------|
| Import | | | | |
| Search | | | | |
| Save | | | | |
| Delete | | | | |
| Export | | | | |
| Map load | | | | |

### 4.5 Defensive Coding Gaps
Is code defensive?

| Pattern | Present? | Locations Missing |
|---------|----------|-------------------|
| Null checks before access | | |
| Array bounds checks | | |
| Type guards for unions | | |
| Default cases in switches | | |
| Timeout on async operations | | |
| Retry logic for transient failures | | |
| Circuit breaker for repeated failures | | |
| Graceful degradation | | |

### 4.6 Testing Gaps
What's not tested?

| Area | Unit Tests? | Integration Tests? | E2E Tests? |
|------|-------------|--------------------| -----------|
| GPS parsing | | | |
| Hashing | | | |
| Import flow | | | |
| Database operations | | | |
| IPC handlers | | | |
| Preload bridge | | | |
| UI components | | | |
| Error handling | | | |

## Deliverables

### 4.7 Gap Analysis Report
Create `docs/optimization/phase4-gaps.md`:

```markdown
# Gap Analysis Report — v0.1.0

## Summary
| Category | Gaps Found | Critical | Major | Minor |
|----------|------------|----------|-------|-------|
| Error Recovery | | | | |
| Logging | | | | |
| Validation | | | | |
| User Feedback | | | | |
| Defensive Coding | | | | |
| Testing | | | | |
| **Total** | | | | |

## Vibe-Code Debt Score: [X]/100
(Higher = more debt to pay off)

## Critical Gaps (must fix for stability)
[List with location, impact, fix approach]

## Major Gaps (should fix for quality)
[List with location, impact, fix approach]

## Minor Gaps (nice to have)
[List with location, impact, fix approach]

## Recommended Priority Order
1. [Gap] — because [reason]
2. [Gap] — because [reason]
...

## Estimated Effort
| Gap Category | Est. Hours | Complexity |
|--------------|------------|------------|
| Error Recovery | | |
| Logging | | |
| Validation | | |
| User Feedback | | |
| Defensive Coding | | |
| Testing | | |
```

## CONSTRAINTS
- DO NOT fix anything yet — analyze only
- Be honest about gaps — vibe-coding leaves many
- Prioritize by user impact, not technical elegance
- Consider offline-first and data ownership constraints

## COMPLETION CRITERIA
- All gap categories analyzed
- Gaps prioritized by severity and impact
- Effort estimates provided
Report: "PHASE 4 COMPLETE — Vibe-code debt score: [X]/100. [Y] critical, [Z] major gaps. Ready for Phase 5" and STOP.
```

---

## PHASE 5: Optimization Plan

```
Continue post-stabilization optimization. Phases 1-4 complete.

READ:
- @CLAUDE.md
- @docs/optimization/phase1-bugs.md
- @docs/optimization/phase2-performance.md
- @docs/optimization/phase3-best-practices.md
- @docs/optimization/phase4-gaps.md

YOUR TASK: Create a prioritized optimization plan that addresses all findings.

## Planning Principles

1. **User impact first** — Fix what users will notice
2. **Data integrity second** — Protect the archive
3. **Stability third** — Prevent crashes
4. **Performance fourth** — Speed comes after correctness
5. **Code quality fifth** — Maintainability for future

## Deliverables

### 5.1 Master Fix List
Create `docs/optimization/phase5-fix-list.md`:

Consolidate all issues from Phases 1-4:

```markdown
# Master Fix List — v0.1.0 Optimization

## Issue Inventory

| ID | Source | Category | Severity | Summary | Est. Hours |
|----|--------|----------|----------|---------|------------|
| OPT-001 | Phase 1 | Bug | Critical | ... | |
| OPT-002 | Phase 2 | Performance | Major | ... | |
| OPT-003 | Phase 3 | Best Practice | Minor | ... | |
| OPT-004 | Phase 4 | Gap | Critical | ... | |
...

Total Issues: [count]
Total Estimated Hours: [count]
```

### 5.2 Optimization Plan
Create `docs/optimization/phase5-plan.md`:

```markdown
# Optimization Plan — v0.1.0

## Scope
- Critical issues: MUST fix
- Major issues: SHOULD fix
- Minor issues: COULD fix (time permitting)

## Phase 5A: Critical Fixes (Est: [X] hours)

### OPT-001: [title]
- **Category**: [Bug/Performance/Practice/Gap]
- **File(s)**: [paths]
- **Current Code**:
```[language]
[code]
```
- **Fixed Code**:
```[language]
[code]
```
- **Testing**: [how to verify]
- **Rollback**: [how to undo]

[Repeat for all critical issues]

## Phase 5B: Major Fixes (Est: [X] hours)
[Same format]

## Phase 5C: Minor Fixes (Est: [X] hours)
[Same format]

## Dependencies
[Which fixes depend on others — order matters]

## Risk Assessment
| Fix ID | Risk | Mitigation |
|--------|------|------------|
```

### 5.3 Ultrathink Validation

<ultrathink>
Review the entire optimization plan:

1. CLAUDE.md Compliance
   - Does any fix violate project rules?
   - Are we staying scope-disciplined (fixes only, no features)?
   - Does every fix serve the archive mission?

2. Priority Validation
   - Are critical issues truly critical?
   - Is priority order correct?
   - Any dependencies missed?

3. Risk Assessment
   - Any high-risk changes that need extra caution?
   - Are rollback plans realistic?
   - Could any fix introduce new bugs?

4. Completeness
   - Any issues from Phases 1-4 not addressed?
   - Any obvious gaps in the plan?

5. Effort Reality Check
   - Are time estimates realistic?
   - Is total scope achievable?
   - Should anything be deferred to v0.1.1?

Flag concerns and adjust plan if needed.
</ultrathink>

## CONSTRAINTS
- Plan must be executable in discrete chunks
- Each fix must be independently testable
- No fix should require more than 4 hours
- If a fix is too large, break it into smaller fixes

## COMPLETION CRITERIA
- All issues from Phases 1-4 in master list
- Plan organized into critical/major/minor phases
- Dependencies identified
- Ultrathink validation passed
Report: "PHASE 5 COMPLETE — Plan ready: [X] critical, [Y] major, [Z] minor fixes. Est. [N] hours total. Ready for Phase 6" and STOP.
```

---

## PHASE 6: Implementation (Critical)

```
Continue post-stabilization optimization. Phases 1-5 complete.

READ:
- @CLAUDE.md
- @docs/optimization/phase5-plan.md (Phase 5A section only)

YOUR TASK: Implement all CRITICAL fixes from Phase 5A.

## Implementation Protocol

For each fix:
1. Read the fix details completely
2. Verify current code matches documentation
3. Implement the fix exactly as specified
4. Run `pnpm -r lint` — must pass
5. Run `pnpm -r test` — must pass (or no tests exist)
6. Test the fix manually if possible
7. Log in implementation tracker

## Deliverables

### 6.1 Implementation Log
Create `docs/optimization/phase6-critical-log.md`:

```markdown
# Critical Fixes Implementation Log

## Summary
- Fixes planned: [count]
- Fixes applied: [count]
- Fixes modified: [count]
- Fixes skipped: [count]

## Fix Log

### OPT-001: [title]
- **Status**: ✅ Applied / ⚠️ Modified / ❌ Skipped
- **Actual Change**: [if different from plan]
- **Files Modified**: [list]
- **Lint**: Pass/Fail
- **Test**: Pass/Fail/None
- **Manual Test**: [what you tested, result]
- **Notes**: [any issues]

[Repeat for all critical fixes]
```

### 6.2 Post-Implementation Verification
After all critical fixes:

```bash
pnpm build          # Must succeed
pnpm -r lint        # Must pass
pnpm -r test        # Must pass
pnpm dev            # App must launch
```

| Check | Status |
|-------|--------|
| Build succeeds | |
| Lint passes | |
| Tests pass | |
| App launches | |
| No console errors | |

## CONSTRAINTS
- Implement fixes EXACTLY as planned unless impossible
- If modification needed, document why
- DO NOT fix additional issues — log them for later
- DO NOT add features
- Stop if any critical fix introduces new bugs

## COMPLETION CRITERIA
- All critical fixes applied or documented as skipped
- Build passes
- App launches without error
Report: "PHASE 6 COMPLETE — [X]/[Y] critical fixes applied. Build: [status]. Ready for Phase 7" and STOP.
```

---

## PHASE 7: Implementation (Major)

```
Continue post-stabilization optimization. Phases 1-6 complete.

READ:
- @CLAUDE.md
- @docs/optimization/phase5-plan.md (Phase 5B section)
- @docs/optimization/phase6-critical-log.md

YOUR TASK: Implement all MAJOR fixes from Phase 5B.

[Same protocol as Phase 6]

## Deliverables

### 7.1 Implementation Log
Create `docs/optimization/phase7-major-log.md`:
[Same format as Phase 6]

## COMPLETION CRITERIA
- All major fixes applied or documented
- Build passes
- App launches without error
Report: "PHASE 7 COMPLETE — [X]/[Y] major fixes applied. Build: [status]. Ready for Phase 8" and STOP.
```

---

## PHASE 8: Implementation (Minor) + Polish

```
Continue post-stabilization optimization. Phases 1-7 complete.

READ:
- @CLAUDE.md
- @docs/optimization/phase5-plan.md (Phase 5C section)
- @docs/optimization/phase6-critical-log.md
- @docs/optimization/phase7-major-log.md

YOUR TASK: Implement MINOR fixes and final polish.

## Minor Fixes
[Same protocol as Phases 6-7]

## Polish Checklist

### UX Polish
| Item | Status | Notes |
|------|--------|-------|
| All buttons have hover states | | |
| Loading states are smooth (no flicker) | | |
| Error messages are user-friendly | | |
| Empty states have helpful messaging | | |
| Transitions are smooth | | |
| No layout shifts on load | | |
| Keyboard navigation works | | |
| Focus states are visible | | |

### Code Polish
| Item | Status | Notes |
|------|--------|-------|
| No commented-out code | | |
| No debug logs remaining | | |
| All TODO comments addressed or ticketed | | |
| Imports organized | | |
| Consistent formatting | | |

## Deliverables

### 8.1 Implementation Log
Create `docs/optimization/phase8-minor-log.md`:
[Same format]

### 8.2 Polish Report
Create `docs/optimization/phase8-polish.md`:

```markdown
# Polish Report — v0.1.0

## UX Polish
- Items checked: [count]
- Items passing: [count]
- Items fixed: [count]
- Items deferred: [count]

## Code Polish
- Items checked: [count]
- Items passing: [count]
- Items fixed: [count]

## Remaining Rough Edges
[List anything not fixed, with justification]
```

## COMPLETION CRITERIA
- Minor fixes applied
- Polish checklist complete
- No debug code remaining
Report: "PHASE 8 COMPLETE — [X] minor fixes, [Y] polish items addressed. Ready for Phase 9" and STOP.
```

---

## PHASE 9: Final Verification + Commit

```
Continue post-stabilization optimization. Phases 1-8 complete.

READ:
- @CLAUDE.md
- All docs/optimization/*.md files

YOUR TASK: Final verification and commit all changes.

## Final Verification

### 9.1 Regression Check
Re-run Phase 1 bug hunt on modified files only. Any new bugs introduced?

### 9.2 Performance Check
Compare to Phase 2 baseline:

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Startup time (est.) | | | |
| Memory baseline | | | |
| Largest query time | | | |

### 9.3 Documentation Update
Update these files to reflect changes:

- [ ] techguide.md — any new troubleshooting?
- [ ] lilbits.md — any new scripts?
- [ ] IMPLEMENTATION_GUIDE.md — any flow changes?

### 9.4 Final Build Verification

```bash
rm -rf node_modules dist
pnpm install
pnpm build
pnpm -r lint
pnpm -r test
pnpm dev
```

All must pass.

## Deliverables

### 9.5 Optimization Summary
Create `docs/optimization/phase9-summary.md`:

```markdown
# v0.1.0 Optimization Summary

## Work Completed

### Bugs Fixed
- Critical: [count]
- Major: [count]
- Minor: [count]

### Performance Improvements
[List with before/after if measurable]

### Best Practices Aligned
- Before: [X]/50
- After: [Y]/50

### Gaps Filled
[List of gap categories addressed]

## Optimization Score

| Category | Before | After | Change |
|----------|--------|-------|--------|
| Bug count | | | |
| Performance issues | | | |
| Best practice violations | | | |
| Gap count | | | |
| **Overall Health** | /100 | /100 | |

## Files Modified
[List all files changed during optimization]

## Deferred to v0.1.1
[Issues not addressed, with justification]

## Recommendations
[Priorities for next release]
```

### 9.6 Git Commit

```bash
git add -A
git commit -m "perf(v0.1.0): post-stabilization optimization

Bugs fixed:
- [X] critical
- [Y] major
- [Z] minor

Performance:
- [improvements]

Best practices:
- Alignment improved from [X]/50 to [Y]/50

Gaps filled:
- [list]

See docs/optimization/ for full audit trail."

git push origin main
```

## COMPLETION CRITERIA
- Regression check passed
- Performance improved or maintained
- Documentation updated
- All tests pass
- Committed and pushed

Report to user: 
"v0.1.0 POST-STABILIZATION OPTIMIZATION COMPLETE

Summary:
- Bugs fixed: [X] critical, [Y] major, [Z] minor
- Performance: [summary]
- Best practices: [X]/50 → [Y]/50
- Gaps filled: [count]
- Overall health: [X]/100 → [Y]/100

See docs/optimization/phase9-summary.md for full report.

Committed: [hash]
Pushed to: origin/main"
```

---

## Usage Instructions

1. Complete the v0.1.0 Stabilization prompts first (required foundation)
2. Start a new Claude Code session
3. Paste Phase 1 prompt
4. Wait for "PHASE 1 COMPLETE" 
5. Continue through all 9 phases
6. Only interrupt if Claude Code reports a blocker

## Estimated Time

| Phase | Est. Time | Cumulative |
|-------|-----------|------------|
| 1. Bug Hunt | 30-45 min | 45 min |
| 2. Performance | 30-45 min | 1.5 hr |
| 3. Best Practices | 30-45 min | 2.25 hr |
| 4. Gap Analysis | 30-45 min | 3 hr |
| 5. Plan Creation | 30-45 min | 3.75 hr |
| 6. Critical Fixes | 1-2 hr | 5.75 hr |
| 7. Major Fixes | 1-2 hr | 7.75 hr |
| 8. Minor + Polish | 1-2 hr | 9.75 hr |
| 9. Verification | 30 min | 10.25 hr |

Total: ~10-12 hours (can span multiple sessions)

## Key Differences from Stabilization

| Stabilization | Optimization |
|---------------|--------------|
| Documentation focus | Code quality focus |
| Ensure docs match code | Fix issues in code |
| Broad audit | Deep analysis |
| 2-4 hours | 10-12 hours |
| Required for release | Required for quality |
