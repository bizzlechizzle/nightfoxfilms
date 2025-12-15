# v0.1.0 Adversarial Audit

## Prerequisites

Before running this audit, execute these commands and save outputs:

```bash
cd ~/Documents/au\ archive

# Dependency health checks
pnpm audit > docs/optimization/dependency-audit.txt 2>&1
pnpm outdated > docs/optimization/dependency-outdated.txt 2>&1

# License check (if available, otherwise skip)
pnpm licenses list > docs/optimization/dependency-licenses.txt 2>&1 || echo "licenses command not available" > docs/optimization/dependency-licenses.txt

# Project stats for context
find . -name "*.ts" -o -name "*.svelte" | grep -v node_modules | wc -l > docs/optimization/file-count.txt
wc -l $(find . -name "*.ts" -o -name "*.svelte" | grep -v node_modules) | tail -1 >> docs/optimization/file-count.txt
```

---

## Adversarial Audit Prompt

```
You completed stabilization and optimization for Abandoned Archive v0.1.0.

READ FIRST — IN THIS ORDER:
1. @CLAUDE.md (complete file — contains protected file rules)
2. @techguide.md
3. @lilbits.md
4. @docs/optimization/phase9-summary.md
5. @docs/optimization/dependency-audit.txt (if exists)
6. @docs/optimization/dependency-outdated.txt (if exists)

YOUR TASK: Adversarial audit. Try to break the app. Think like a malicious user, a careless user, a power user, and an unlucky user.

This is the final audit before v0.1.0 release. Be thorough and ruthless.

---

## PART 1: Security Audit

### 1.1 SQL Injection Vectors
Search for ANY raw SQL that concatenates user input:

```bash
grep -rn "db\." --include="*.ts" | grep -v "prepare\|run\|get\|all"
grep -rn "\${" --include="*.ts" | grep -i "sql\|query\|select\|insert\|update\|delete"
```

For each query found:
| File | Line | Query | Uses Prepared Statement? | User Input Involved? | Vulnerable? |
|------|------|-------|--------------------------|----------------------|-------------|

### 1.2 Path Traversal
Search for file operations with user-controlled paths:

```bash
grep -rn "path\." --include="*.ts"
grep -rn "fs\." --include="*.ts"
grep -rn "readFile\|writeFile\|copyFile\|rename\|unlink" --include="*.ts"
```

For each file operation:
| File | Line | Operation | Path Source | Validated? | Can Escape Archive? |
|------|------|-----------|-------------|------------|---------------------|

### 1.3 IPC Validation
For EVERY IPC handler in main process:

| Channel | Handler File | Inputs | Validated? | What If Malformed? |
|---------|--------------|--------|------------|--------------------|

### 1.4 Electron Security Checklist
| Check | File | Status | Notes |
|-------|------|--------|-------|
| `contextIsolation: true` | main.ts | | |
| `nodeIntegration: false` | main.ts | | |
| `sandbox: true` OR justified exception | main.ts | | |
| No `remote` module | *.ts | | |
| No `eval()` or `new Function()` | *.ts | | |
| `shell.openExternal` validates URLs | *.ts | | |
| CSP headers configured | main.ts | | |
| No `webSecurity: false` | main.ts | | |

### 1.5 Dependency Vulnerabilities
From `pnpm audit` output:
| Package | Severity | Vulnerability | Fix Available? | Action |
|---------|----------|---------------|----------------|--------|

---

## PART 2: Data Integrity Audit

### 2.1 What's Logged to Database
| Event | Logged? | Table | Fields Captured | Missing Fields? |
|-------|---------|-------|-----------------|-----------------|
| Import started | | | | timestamp, source path, file count |
| Import completed | | | | success/fail, duration, errors |
| Import failed | | | | error message, partial state |
| Media added | | | | hash, original path, GPS source |
| Media deleted | | | | who, when, why |
| Location created | | | | created_at, created_by_version |
| Location edited | | | | previous values, changed_at |
| Location deleted | | | | cascade behavior, backup |
| GPS confidence changed | | | | old value, new value, source |
| App version | | | | version that created/modified record |
| Error occurred | | | | stack trace, context, user action |

### 2.2 Transaction Coverage
For each multi-step operation, is it wrapped in a transaction?

| Operation | Steps | Transaction? | Rollback on Failure? |
|-----------|-------|--------------|----------------------|
| Import batch | hash → copy → db insert → link | | |
| Delete location | unlink media → delete records → cleanup | | |
| Move archive | update paths → move files → verify | | |
| Merge locations | combine records → update refs → delete old | | |

### 2.3 Orphan Prevention
| Scenario | Orphan Risk | Mitigation Present? |
|----------|-------------|---------------------|
| Media deleted but file remains | Files on disk | |
| Location deleted but media remains | Media records | |
| Import interrupted | Partial files | |
| Hash mismatch on verify | Inconsistent state | |

---

## PART 3: Adversarial Scenarios

### 3.1 The Malicious User
Test each scenario — trace the code path:

| Attack | Code Path | Vulnerable? | Impact | Severity |
|--------|-----------|-------------|--------|----------|
| Renderer sends `{locationId: "'; DROP TABLE locations;--"}` | IPC → handler → db | | | |
| Filename: `../../etc/passwd` | Import → copy | | | |
| Filename: `<script>alert('xss')</script>.jpg` | Import → display | | | |
| 10MB JSON payload via IPC | IPC → handler | | | |
| Malformed GPS: `{lat: "not a number"}` | Import → GPS parse | | | |
| Unicode exploit in path: `location/\u0000/file.jpg` | File ops | | | |

### 3.2 The Careless User
| Scenario | Current Behavior | Acceptable? | User Recovery Path |
|----------|------------------|-------------|-------------------|
| Deletes `au-archive.db` manually | | | |
| Moves archive folder in Finder | | | |
| Imports 10,000 files at once | | | |
| Closes app during import | | | |
| Runs two app instances | | | |
| Imports same files twice | | | |
| Renames files in archive folder manually | | | |
| Changes file permissions on archive | | | |

### 3.3 The Power User
| Workflow | Exists? | How? | If Missing, Priority |
|----------|---------|------|----------------------|
| Batch edit multiple locations | | | |
| Export all data (portable format) | | | |
| Import from backup | | | |
| Merge duplicate locations | | | |
| Re-extract GPS from media | | | |
| Verify archive integrity | | | |
| Search across all fields | | | |
| Bulk delete media | | | |
| Relocate archive folder | | | |
| View import history | | | |

### 3.4 The Unlucky User
| Scenario | Current Behavior | Graceful? | User Sees | Fix Priority |
|----------|------------------|-----------|-----------|--------------|
| Disk full during import | | | | |
| Network drops (online features) | | | | |
| Database locked | | | | |
| File permission denied | | | | |
| Corrupt image file | | | | |
| Corrupt database | | | | |
| Out of memory (huge import) | | | | |
| External drive ejected | | | | |
| App killed by OS | | | | |

---

## PART 4: Cross-Platform Check

If app is intended for multiple platforms:

| Check | macOS | Windows | Linux |
|-------|-------|---------|-------|
| Path separators handled | | | |
| Case sensitivity (filenames) | | | |
| Native modules build | | | |
| File permissions model | | | |
| Default paths valid | | | |
| Special characters in paths | | | |
| Long path support (260+ chars) | | | |

---

## PART 5: Dependency Health

### 5.1 From `pnpm audit`
| Severity | Count | Action Required |
|----------|-------|-----------------|
| Critical | | |
| High | | |
| Moderate | | |
| Low | | |

### 5.2 From `pnpm outdated`
| Package | Current | Latest | Breaking Changes? | Update Priority |
|---------|---------|--------|-------------------|-----------------|

### 5.3 License Compliance
| Package | License | Compatible with Project? | Notes |
|---------|---------|--------------------------|-------|

Flag any: GPL (viral), AGPL, unknown, or commercial-only licenses.

---

## Deliverables

### D1: Adversarial Audit Report
Create `docs/optimization/adversarial-audit.md`:

```markdown
# Adversarial Audit Report — v0.1.0

## Audit Date: [date]

## Summary
| Category | Issues Found | Critical | High | Medium | Low |
|----------|--------------|----------|------|--------|-----|
| Security | | | | | |
| Data Integrity | | | | | |
| User Scenarios | | | | | |
| Cross-Platform | | | | | |
| Dependencies | | | | | |
| **Total** | | | | | |

## Release Recommendation
[ ] ✅ Clear to release — no critical/high issues
[ ] ⚠️ Release with known issues — document in release notes
[ ] ❌ Do not release — critical issues must be fixed

## Critical Issues (Block Release)
[List each with full details]

## High Issues (Fix Before Release If Possible)
[List each with full details]

## Medium Issues (Fix in v0.1.1)
[List each]

## Low Issues (Backlog)
[List each]

## Security Findings
[Dedicated section for any security issues]

## Missing Audit Logging
[What should be logged but isn't]

## Missing User Workflows
[Power user features that don't exist]

## Dependency Actions Required
[What needs updating/replacing]
```

### D2: Fix Priority Matrix
Create `docs/optimization/adversarial-fixes.md`:

```markdown
# Adversarial Audit — Fix Priority

## Must Fix Before v0.1.0 Release
| ID | Issue | Est. Hours | Complexity |
|----|-------|------------|------------|

## Should Fix Before v0.1.0 Release
| ID | Issue | Est. Hours | Complexity |
|----|-------|------------|------------|

## Defer to v0.1.1
| ID | Issue | Reason for Deferral |
|----|-------|---------------------|

## Won't Fix (Accepted Risk)
| ID | Issue | Risk Acceptance Rationale |
|----|-------|---------------------------|
```

---

## CONSTRAINTS

- **DO NOT fix anything** — document only
- **DO NOT modify CLAUDE.md, techguide.md, or lilbits.md** — protected files
- **Be adversarial** — assume everything will break
- **Be specific** — file names, line numbers, exact reproduction steps
- **Think like a user** — not a developer
- **No false positives** — verify before flagging

## COMPLETION CRITERIA

- All 5 parts completed with tables filled
- Every scenario traced through actual code (not guessed)
- Deliverables D1 and D2 created
- Clear release recommendation given

Report: "ADVERSARIAL AUDIT COMPLETE — [X] critical, [Y] high, [Z] medium issues. Release recommendation: [CLEAR/CAUTION/BLOCK]" and STOP.

DO NOT prompt user until audit is complete.
```

---

## Post-Audit: If Issues Found

If the adversarial audit finds critical or high issues, use this follow-up prompt:

```
READ:
- @CLAUDE.md
- @docs/optimization/adversarial-audit.md
- @docs/optimization/adversarial-fixes.md

YOUR TASK: Fix all issues marked "Must Fix Before v0.1.0 Release"

## Fix Protocol
1. Read the issue completely
2. Locate the vulnerable code
3. Implement the fix with minimal changes
4. Verify the fix (trace code path again)
5. Run lint and tests
6. Log in fix tracker

## Deliverables

Create `docs/optimization/adversarial-fixes-log.md`:

| ID | Issue | Fix Applied | Files Changed | Verified? |
|----|-------|-------------|---------------|-----------|

After all fixes:
```bash
pnpm build
pnpm -r lint
pnpm -r test
```

Commit:
```bash
git add -A
git commit -m "security: fix adversarial audit findings

- [list critical fixes]
- [list high fixes]

See docs/optimization/adversarial-audit.md for full report."
git push origin main
```

Report: "ADVERSARIAL FIXES COMPLETE — [X] issues fixed. Build: [status]. Ready for release decision."
```
