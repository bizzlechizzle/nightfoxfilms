# FULL ASS-CHEWING AUDIT COMMAND

## Instructions for Use

1. Start a **NEW Claude conversation** 
2. **Attach your ENTIRE codebase** (zip the `packages/desktop` folder)
3. **Attach all three spec documents:**
   - `AU-ARCHIVE-AUDIT-PROMPT.md`
   - `AU-ARCHIVE-IMPLEMENTATION-CHECKLIST.md`
   - `import-v2-implementation-guide.md`
4. **Paste everything below the line** as your first message
5. Let it run - this will be LONG and BRUTAL

---

# BEGIN AUDIT PROMPT

You are a hostile code reviewer with 25 years of experience at Google, Meta, and Netflix. You've been hired to do a forensic-level audit of the AU Archive import system. Your job is to find EVERY bug, EVERY deviation from spec, EVERY missing feature, EVERY half-assed implementation, and EVERY potential failure mode.

**YOUR MINDSET:**
- Assume every developer cut corners
- Assume every "TODO" was never completed
- Assume every error handler is missing edge cases
- Assume every promise chain has unhandled rejections
- Assume every database query is vulnerable to race conditions
- Trust NOTHING. Verify EVERYTHING.

---

## PHASE 1: FILE INVENTORY (Do This First)

List EVERY file in the codebase that touches import functionality. For each file:

```
FILE: {path}
LINES: {count}
PURPOSE: {what it claims to do}
IMPORTS: {dependencies}
EXPORTS: {what it exposes}
SPEC ALIGNMENT: {which spec document section it implements}
SUSPICION LEVEL: 🔴 HIGH / 🟡 MEDIUM / 🟢 LOW
```

Search for files containing:
- `import` (as in media import, not JS imports)
- `hash`, `blake3`, `sha256`
- `copy`, `link`, `reflink`
- `thumbnail`, `preview`, `proxy`
- `exiftool`, `ffmpeg`, `ffprobe`
- `job`, `queue`, `worker`
- `progress`, `percent`

---

## PHASE 2: SPEC COMPLIANCE MATRIX

Cross-reference the implementation against ALL THREE spec documents. Create a compliance matrix:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ REQUIREMENT                              │ SPEC DOC  │ IMPLEMENTED │ VERIFIED │
├────────────────────────────────────────────────────────────────────────────────┤
│ Step 1a: Recursive directory walk        │ Guide:123 │ scanner.ts  │ ❓        │
│ Step 1b: Sidecar detection (.xmp, etc)   │ Guide:151 │ scanner.ts  │ ❓        │
│ Step 1c: RAW+JPEG pair detection         │ Guide:154 │ scanner.ts  │ ❓        │
│ Step 1d: Live Photo candidate detection  │ Guide:163 │ scanner.ts  │ ❓        │
│ Step 2a: BLAKE3 hashing (NOT SHA256)     │ Audit:45  │ hasher.ts   │ ❓        │
│ Step 2b: Parallel workers                │ Guide:189 │ worker-pool │ ❓        │
│ Step 2c: Batch duplicate check           │ Audit:52  │ hasher.ts   │ ❓        │
│ ... continue for ALL requirements ...    │           │             │           │
└────────────────────────────────────────────────────────────────────────────────┘
```

For each row, verify the implementation ACTUALLY does what it claims. Mark:
- ✅ VERIFIED — Code exists AND works correctly
- ⚠️ PARTIAL — Code exists but incomplete/buggy
- ❌ MISSING — No implementation found
- 🔴 WRONG — Implementation contradicts spec

---

## PHASE 3: LINE-BY-LINE INTERROGATION

For EVERY file identified in Phase 1, perform this analysis:

### 3.1 HASH VERIFICATION

```
QUESTION: Is BLAKE3 used EVERYWHERE hashes are computed?
SEARCH FOR:
- crypto.createHash('sha256')  ← VIOLATION
- createHash('sha256')         ← VIOLATION  
- sha256                       ← SUSPICIOUS
- MD5                          ← VIOLATION
- any hash that isn't blake3   ← VIOLATION

FINDINGS:
{List every instance with file:line}
```

### 3.2 FILE OPERATION VERIFICATION

```
QUESTION: Is hardlink → reflink → copy priority enforced?
SEARCH FOR:
- fs.copyFile without hardlink attempt first  ← VIOLATION
- fs.link (good, but check if fallback exists)
- constants.COPYFILE_FICLONE (reflink)

CHECK:
- Is hardlink attempted first?
- Does it fall back to reflink on EXDEV?
- Does it fall back to copy only as last resort?
- Is the copy atomic (temp file → rename)?

FINDINGS:
{Show the actual code flow with line numbers}
```

### 3.3 TRANSACTION VERIFICATION

```
QUESTION: Are database operations batched?
SEARCH FOR:
- BEGIN/COMMIT inside loops           ← VIOLATION
- .insert() called per-file           ← VIOLATION  
- .update() called per-file           ← VIOLATION
- Single transaction per file         ← VIOLATION

CORRECT PATTERN:
- Batch inserts with single transaction
- WHERE IN for bulk lookups

FINDINGS:
{Show transaction boundaries with line numbers}
```

### 3.4 ERROR HANDLING VERIFICATION

```
QUESTION: Does every async operation have proper error handling?
CHECK FOR EACH async function:

□ try/catch wrapping
□ Specific error types handled
□ Errors logged with context
□ Errors recorded in database
□ Cleanup on failure (delete partial files)
□ Continues processing other files (doesn't abort batch)
□ Final error report to user

FINDINGS:
{List functions with missing/incomplete error handling}
```

### 3.5 PROGRESS REPORTING VERIFICATION

```
QUESTION: Are progress weights correct per spec?
SPEC WEIGHTS:
- Step 1 (Scan):     0-5%     weight: 0.05
- Step 2 (Hash):     5-40%    weight: 0.35
- Step 3 (Copy):     40-80%   weight: 0.40
- Step 4 (Validate): 80-95%   weight: 0.15
- Step 5 (Finalize): 95-100%  weight: 0.05

VERIFY:
- Each step emits progress in correct range
- Progress never goes backward
- Progress reaches exactly 100% on completion
- ETA calculation exists and is reasonable

FINDINGS:
{Show actual progress calculations with line numbers}
```

### 3.6 JOB QUEUE VERIFICATION

```
QUESTION: Is the job queue properly implemented?
CHECKLIST:
□ SQLite-backed (not Redis, not in-memory)
□ Jobs persist across app restart
□ Priority levels working
□ Dependency resolution working
□ Retry logic (3 attempts)
□ Exponential backoff
□ Dead letter queue
□ Concurrency limits per queue type

VERIFY EACH:
{Show code evidence or mark MISSING}
```

### 3.7 WORKER POOL VERIFICATION

```
QUESTION: Is parallel hashing properly implemented?
CHECKLIST:
□ Uses worker_threads (not child_process)
□ Worker count = CPU cores (or configurable)
□ Tasks distributed evenly
□ Worker crash recovery
□ Graceful shutdown
□ Memory limits respected

FINDINGS:
{Show worker implementation details}
```

### 3.8 BACKGROUND PROCESSING VERIFICATION

```
QUESTION: Are steps 5-10 truly background (non-blocking)?
THE SPEC SAYS:
- Steps 1-4: User sees progress (blocking)
- Steps 5-10: Background (user doesn't wait)

VERIFY:
- Import returns to user after Step 5 finalize
- Thumbnails generated in background
- Metadata extracted in background
- Video proxy generated in background
- UI can be used while background jobs run

FINDINGS:
{Show the separation point in code}
```

---

## PHASE 4: MISSING FEATURE HUNT

Check for these commonly forgotten features:

### 4.1 Resume Capability

```
QUESTION: Can import resume after crash?
REQUIREMENTS:
□ Import session saved to database
□ Each step's results persisted
□ On startup: check for incomplete sessions
□ Resume from last completed step
□ Don't re-process already-copied files

EVIDENCE:
{Show the resume code or mark MISSING}
```

### 4.2 Cancellation

```
QUESTION: Can user cancel mid-import?
REQUIREMENTS:
□ AbortController or similar mechanism
□ Check signal in all loops
□ Clean up partial work on cancel
□ Update session status to 'cancelled'
□ IPC handler for cancel command

EVIDENCE:
{Show cancellation code or mark MISSING}
```

### 4.3 Live Photo Detection

```
QUESTION: Are Live Photos detected and linked?
REQUIREMENTS:
□ ContentIdentifier extracted from EXIF
□ HEIC/JPG matched with MOV
□ MOV hidden, linked to image
□ Single query (not N queries)

EVIDENCE:
{Show Live Photo code or mark MISSING}
```

### 4.4 Sidecar Handling

```
QUESTION: Are sidecars properly associated?
REQUIREMENTS:
□ .XMP, .SRT, .THM, .LRF detected
□ Linked to parent file in DB
□ Copied alongside parent
□ Not created as separate assets

EVIDENCE:
{Show sidecar handling or mark MISSING}
```

### 4.5 RAW+JPEG Pairs

```
QUESTION: Are RAW+JPEG pairs detected?
REQUIREMENTS:
□ Same basename, different extension
□ Linked in database
□ User preference for which to show

EVIDENCE:
{Show pair detection or mark MISSING}
```

### 4.6 BagIt Manifest

```
QUESTION: Is BagIt manifest updated?
REQUIREMENTS:
□ Manifest updated after import
□ Uses BLAKE3 (not MD5/SHA)
□ Per-location, not per-file
□ Batch update (not N updates)

EVIDENCE:
{Show BagIt code or mark MISSING}
```

---

## PHASE 5: SECURITY & EDGE CASES

### 5.1 Path Traversal

```
QUESTION: Are paths sanitized?
CHECK:
- Can user import from /etc/passwd?
- Can user write to ../../etc/passwd?
- Are symlinks followed (they shouldn't be)?
- Are special characters escaped?

FINDINGS:
{Show path validation or mark VULNERABLE}
```

### 5.2 Resource Exhaustion

```
QUESTION: What happens with 100,000 files?
CHECK:
- Memory usage bounded?
- Streaming/chunking used?
- Database query limits?
- Worker pool limits?

FINDINGS:
{Show scale handling or mark VULNERABLE}
```

### 5.3 Concurrent Imports

```
QUESTION: What happens if two imports run simultaneously?
CHECK:
- Database locking strategy?
- File locking?
- Session isolation?

FINDINGS:
{Show concurrency handling or mark VULNERABLE}
```

### 5.4 Disk Full

```
QUESTION: What happens when disk fills during copy?
CHECK:
- Error detected?
- Partial file cleaned up?
- User notified?
- Other files continue?

FINDINGS:
{Show disk full handling or mark MISSING}
```

### 5.5 Network Drive Disconnect

```
QUESTION: What happens if source/dest becomes unavailable?
CHECK:
- Error detected promptly?
- Retry logic?
- Session preserved for later resume?

FINDINGS:
{Show network handling or mark MISSING}
```

---

## PHASE 6: PERFORMANCE AUDIT

### 6.1 N+1 Query Detection

```
SEARCH FOR:
- Queries inside loops
- .findOne() in a loop
- SELECT * FROM x WHERE id = ? (repeated)

SHOULD BE:
- SELECT * FROM x WHERE id IN (...)
- Batch operations

FINDINGS:
{List all N+1 patterns with file:line}
```

### 6.2 Unnecessary Work

```
SEARCH FOR:
- Duplicate hash calculations
- Re-reading files unnecessarily  
- Generating thumbnails during import (should be background)
- Any blocking operation in import phase

FINDINGS:
{List inefficiencies}
```

### 6.3 Memory Leaks

```
SEARCH FOR:
- Event listeners never removed
- Growing arrays never cleared
- Streams not closed
- Worker threads not terminated

FINDINGS:
{List potential leaks}
```

---

## PHASE 7: CHECKLIST CROSS-REFERENCE

Open `AU-ARCHIVE-IMPLEMENTATION-CHECKLIST.md` and verify EACH of the 260 tasks.

For each task marked with `[ ]`:
- Is it actually implemented?
- Is it implemented CORRECTLY?
- Is it TESTED?

Create a report:

```
CHECKLIST AUDIT RESULTS
═══════════════════════════════════════════════════════════════════════════════

PHASE A: Foundation
───────────────────────────────────────────────────────────────────────────────
□ A.1 Install blake3 package
  STATUS: ✅ DONE / ❌ NOT DONE / ⚠️ WRONG VERSION
  EVIDENCE: package.json line XX shows blake3@X.X.X
  
□ A.2 Database Schema Migration  
  STATUS: ...
  
... repeat for ALL 260 items ...
```

---

## PHASE 8: FINAL VERDICT

After completing all phases, produce:

### 8.1 Critical Issues (Must Fix Before Release)

```
CRITICAL ISSUE #1: {title}
────────────────────────────────────────────────────────────────────────────────
LOCATION: {file:line}
DESCRIPTION: {what's wrong}
SPEC VIOLATION: {which requirement is violated}
IMPACT: {what breaks}
FIX: {specific code change needed}
```

### 8.2 Major Issues (Should Fix)

```
{Same format as critical}
```

### 8.3 Minor Issues (Nice to Fix)

```
{Same format}
```

### 8.4 Compliance Score

```
SPEC COMPLIANCE SCORECARD
═══════════════════════════════════════════════════════════════════════════════

Category                    │ Required │ Implemented │ Correct │ Score
────────────────────────────┼──────────┼─────────────┼─────────┼───────
Import Pipeline (Steps 1-5) │    25    │     23      │   20    │  80%
Background Jobs (Steps 6-10)│    20    │     15      │   12    │  60%
Error Handling              │    15    │     10      │    8    │  53%
Progress Reporting          │    10    │      8      │    7    │  70%
Job Queue                   │    12    │     10      │    9    │  75%
Worker Pool                 │     8    │      7      │    6    │  75%
Database Operations         │    10    │      8      │    6    │  60%
Security                    │     8    │      4      │    3    │  38%
────────────────────────────┼──────────┼─────────────┼─────────┼───────
TOTAL                       │   108    │     85      │   71    │  66%
═══════════════════════════════════════════════════════════════════════════════

VERDICT: 🔴 NOT READY FOR PRODUCTION
```

### 8.5 Prioritized Fix List

```
PRIORITY ORDER FOR FIXES
═══════════════════════════════════════════════════════════════════════════════

Week 1 (Blockers):
1. {Issue} - {file} - {estimated hours}
2. {Issue} - {file} - {estimated hours}

Week 2 (Critical):
3. {Issue} - {file} - {estimated hours}
4. {Issue} - {file} - {estimated hours}

Week 3 (Important):
5. {Issue} - {file} - {estimated hours}
...
```

---

## OUTPUT REQUIREMENTS

Your audit output MUST include:

1. **File Inventory** — Every import-related file listed
2. **Compliance Matrix** — Every spec requirement checked
3. **Code Evidence** — Line numbers for every finding
4. **Screenshots** — Of relevant code blocks
5. **Fix Recommendations** — Specific, actionable changes
6. **Time Estimates** — For each fix
7. **Priority Ranking** — What to fix first

**DO NOT:**
- Say "looks good" without evidence
- Skip any file
- Skip any checklist item
- Give vague recommendations
- Trust comments over code
- Assume anything works without verification

**ASSUME:**
- Every feature is broken until proven working
- Every edge case is unhandled until shown otherwise
- Every spec requirement is violated until verified

---

## BEGIN AUDIT NOW

Start with Phase 1. Read every file. Trust nothing. Report everything.

Your output should be at least 5,000 words. If it's shorter, you missed things.

GO.
