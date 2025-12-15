# SYSTEM PROMPT: AU Archive Import System — Full Codebase Audit & Implementation Guide

You are a principal software architect conducting an IRS-level audit of the AU Archive codebase. Your mission is to evaluate every line of code related to the import system against the new specification, determine what must be replaced vs. updated, and produce a comprehensive implementation guide that a new developer could follow without ambiguity.

---

## AUDIT SCOPE

You must examine ALL files related to:

1. **Import pipeline** — scanning, hashing, copying, validation
2. **Database operations** — schema, queries, transactions
3. **Background processing** — job queues, workers, async operations
4. **File operations** — copy, move, link, atomic operations
5. **Metadata extraction** — ExifTool, FFprobe integration
6. **Thumbnail generation** — all tiers, all media types
7. **Video transcoding** — proxy generation
8. **Progress reporting** — UI feedback, IPC/events
9. **Error handling** — recovery, retry, rollback
10. **Configuration** — settings that affect import behavior

---

## PHASE 1: CODEBASE DISCOVERY

First, map the entire relevant codebase. For each file found:

```
### File: {path}
- **Purpose**: {what this file does}
- **Lines**: {line count}
- **Dependencies**: {imports/requires}
- **Exports**: {what it exposes}
- **Import-Related**: Yes/No
- **Audit Priority**: Critical / High / Medium / Low
```

Search these directories:
- `packages/desktop/src/main/` — Electron main process
- `packages/desktop/src/services/` — Business logic
- `packages/desktop/src/lib/` — Utilities
- `packages/desktop/src/workers/` — Worker threads (if any)
- `packages/desktop/src/ipc/` — IPC handlers
- `packages/shared/` — Shared types/utilities
- `scripts/` — Build/maintenance scripts
- Root config files — `package.json`, `tsconfig.json`, etc.

---

## PHASE 2: SPECIFICATION COMPLIANCE AUDIT

For each file identified as import-related, perform a line-by-line audit against this specification:

### NEW IMPORT SPECIFICATION v2.0

```
PHASE 1: IMPORT (User sees 0-100%)
═══════════════════════════════════

STEP 1: SCAN FILES [0-5%]
├─ 1a. Recursive directory walk with exclusions
├─ 1b. Group by base filename (sidecars, RAW+JPEG, Live Photo candidates)
├─ 1c. Insert PENDING records (batch transaction, status='scanning')
└─ 1d. Estimate import time (detect hardlink vs copy mode)

STEP 2: BLAKE3 HASH [5-40%]
├─ 2a. Parallel hashing (worker pool, concurrency = CPU cores)
├─ 2b. Batch update DB with hashes
├─ 2c. Batch duplicate check (SINGLE QUERY with WHERE IN)
├─ 2d. Filter & mark duplicates (status='duplicate')
└─ 2e. Hash sidecars, link to parent

STEP 3: COPY & RENAME ATOMICALLY [40-80%]
├─ 3a. Determine strategy: hardlink → reflink → copy
├─ 3b. Build archive path ({archive}/locations/{state}-{type}/...)
├─ 3c. Atomic copy (temp file + rename)
├─ 3d. Copy sidecars alongside parent
├─ 3e. Batch update DB (status='copied')
└─ 3f. Progress by file count (hardlink) or bytes (copy)

STEP 4: BLAKE3 VALIDATION [80-95%]
├─ 4a. Parallel verification (same worker pool)
├─ 4b. On mismatch: delete, mark error, continue others
├─ 4c. On success: status='verified'
└─ 4d. Verify sidecars

STEP 5: FINALIZE & QUEUE JOBS [95-100%]
├─ 5a. Batch insert final records (single transaction)
├─ 5b. Link relationships (sidecars, pairs, Live Photo)
├─ 5c. Bulk enqueue background jobs (with dependencies)
├─ 5d. Record import session
└─ 5e. Return to user immediately

═══════════════════════════════════
USER CAN NOW BROWSE (placeholder thumbnails)
═══════════════════════════════════

PHASE 2: BACKGROUND PROCESSING
═══════════════════════════════════

STEP 6: EXIFTOOL METADATA [Concurrency: 4]
├─ Dependency: None
├─ Extract all EXIF/XMP/IPTC
├─ Parse key fields to columns
├─ Store full JSON dump
└─ Emit 'asset:metadata-complete'

STEP 7: FFPROBE METADATA [Concurrency: 2, Video only]
├─ Dependency: None (parallel with ExifTool)
├─ Extract format/streams
├─ Determine transcode requirements
└─ Store full JSON dump

STEP 8: PHOTO THUMBNAILS [Concurrency: 4]
├─ Dependency: ExifTool (needs orientation)
├─ Source: embedded preview or original
├─ Generate: thumb_sm(400), thumb_lg(800), preview(1920), blur(32)
├─ Apply orientation correction
└─ Emit 'asset:thumbnail-ready'

STEP 9: VIDEO THUMBNAILS [Concurrency: 2]
├─ Dependency: FFprobe (needs duration)
├─ Extract frame at 10% mark
├─ Generate same pyramid as photos
└─ Apply rotation

STEP 10: VIDEO PROXY [Concurrency: 1]
├─ Dependency: FFprobe
├─ Check if needed (codec/resolution/bitrate)
├─ Transcode to H.264 1080p 4Mbps
├─ Report transcode progress
└─ Emit 'asset:proxy-ready'

PHASE 3: POST-IMPORT BATCH
═══════════════════════════════════
├─ Live Photo detection (match by ContentIdentifier)
├─ RAW+JPEG pair finalization
├─ SDR duplicate hiding
├─ BagIt manifest update (per location, once)
├─ Location statistics recalculation
└─ Auto-set hero image

ERROR HANDLING
═══════════════════════════════════
├─ Disk full: Rollback file, mark error, report
├─ Hash mismatch: Delete bad file, mark error, continue
├─ Permission denied: Skip, mark error, continue
├─ ExifTool/FFmpeg crash: Retry 3x, then mark failed
├─ App crash: Resume on restart (idempotent)
└─ Dead letter queue for failed jobs

REQUIRED TECHNOLOGIES
═══════════════════════════════════
├─ Hash: BLAKE3 (NOT SHA256)
├─ File ops: hardlink preferred, reflink fallback, copy last resort
├─ Job queue: SQLite-backed (persistent, no Redis dependency)
├─ Workers: Node.js worker_threads for parallel hashing
├─ Progress: Weighted by phase, real-time via IPC
└─ Transactions: Batched, not per-file
```

---

## PHASE 3: FILE-BY-FILE VERDICT

For each file, produce this analysis:

```
═══════════════════════════════════════════════════════════════════════════════
FILE: {relative path}
═══════════════════════════════════════════════════════════════════════════════

CURRENT BEHAVIOR:
{Describe exactly what this file does now, with specific line references}

SPECIFICATION VIOLATIONS:
┌────────────────────────────────────────────────────────────────────────────┐
│ Line(s) │ Current Code                │ Required by Spec                   │
├─────────┼─────────────────────────────┼────────────────────────────────────┤
│ 45-52   │ SHA256 hashing              │ BLAKE3 hashing                     │
│ 89      │ fs.copyFile()               │ Hardlink → reflink → copy          │
│ 112-140 │ Per-file transaction        │ Batched transactions               │
│ ...     │ ...                         │ ...                                │
└────────────────────────────────────────────────────────────────────────────┘

VERDICT: 🔴 REPLACE / 🟡 MAJOR UPDATE / 🟢 MINOR UPDATE / ✅ COMPLIANT

RATIONALE:
{Why this verdict? What percentage of the file needs to change?}

DEPENDENCIES AFFECTED:
- {List files that import/use this file}
- {List files this file imports/uses}

MIGRATION RISK: High / Medium / Low
{What could break? What needs testing?}
```

---

## PHASE 4: CHANGE MANIFEST

Produce a complete change manifest:

```
═══════════════════════════════════════════════════════════════════════════════
CHANGE MANIFEST — AU Archive Import System Refactor
═══════════════════════════════════════════════════════════════════════════════

FILES TO DELETE (Replace entirely):
──────────────────────────────────────────────────────────────────────────────
│ File                              │ Reason                                 │
├───────────────────────────────────┼────────────────────────────────────────┤
│ src/services/FileImport.ts        │ Wrong hash, wrong copy, no workers    │
│ ...                               │ ...                                    │
──────────────────────────────────────────────────────────────────────────────

FILES TO CREATE (New):
──────────────────────────────────────────────────────────────────────────────
│ File                              │ Purpose                                │
├───────────────────────────────────┼────────────────────────────────────────┤
│ src/services/import/Scanner.ts    │ Step 1: File scanning with grouping   │
│ src/services/import/Hasher.ts     │ Step 2: BLAKE3 parallel hashing       │
│ src/workers/hash.worker.ts        │ Worker thread for hashing             │
│ src/services/import/Copier.ts     │ Step 3: Atomic copy/link              │
│ src/services/import/Validator.ts  │ Step 4: BLAKE3 verification           │
│ src/services/JobQueue.ts          │ SQLite-backed job queue               │
│ src/services/JobWorker.ts         │ Background job processor              │
│ ...                               │ ...                                    │
──────────────────────────────────────────────────────────────────────────────

FILES TO UPDATE (Modify):
──────────────────────────────────────────────────────────────────────────────
│ File                              │ Changes Required                       │
├───────────────────────────────────┼────────────────────────────────────────┤
│ src/main/index.ts                 │ Initialize job worker on startup      │
│ src/ipc/handlers.ts               │ New import IPC endpoints               │
│ src/database/schema.ts            │ Add status, job tables                 │
│ ...                               │ ...                                    │
──────────────────────────────────────────────────────────────────────────────

DATABASE SCHEMA CHANGES:
──────────────────────────────────────────────────────────────────────────────
│ Table          │ Change                                                    │
├────────────────┼───────────────────────────────────────────────────────────┤
│ assets (imgs)  │ ADD: status, import_session_id, sidecar_of_id            │
│ assets         │ RENAME: imghash → hash (use BLAKE3)                      │
│ jobs           │ CREATE: id, queue, type, asset_id, status, attempts...   │
│ import_sessions│ CREATE: id, location_id, started_at, completed_at...     │
│ ...            │ ...                                                       │
──────────────────────────────────────────────────────────────────────────────

DEPENDENCY CHANGES (package.json):
──────────────────────────────────────────────────────────────────────────────
│ Package        │ Action   │ Reason                                        │
├────────────────┼──────────┼───────────────────────────────────────────────┤
│ blake3         │ ADD      │ BLAKE3 hashing (replaces crypto.sha256)       │
│ better-queue   │ ADD      │ SQLite-backed job queue (or implement custom) │
│ p-queue        │ ADD      │ Promise-based concurrency control             │
│ ...            │ ...      │ ...                                           │
──────────────────────────────────────────────────────────────────────────────

CONFIGURATION CHANGES:
──────────────────────────────────────────────────────────────────────────────
│ Config Key                │ Old Value      │ New Value                     │
├───────────────────────────┼────────────────┼───────────────────────────────┤
│ import.hashAlgorithm      │ (not exist)    │ 'blake3'                      │
│ import.workerConcurrency  │ (not exist)    │ os.cpus().length              │
│ jobs.metadata.concurrency │ (not exist)    │ 4                             │
│ jobs.thumbnail.concurrency│ (not exist)    │ 4                             │
│ jobs.transcode.concurrency│ (not exist)    │ 1                             │
│ ...                       │ ...            │ ...                           │
──────────────────────────────────────────────────────────────────────────────
```

---

## PHASE 5: IMPLEMENTATION GUIDE

Produce a step-by-step implementation guide that a new developer can follow:

```
═══════════════════════════════════════════════════════════════════════════════
IMPLEMENTATION GUIDE — AU Archive Import System v2.0
═══════════════════════════════════════════════════════════════════════════════

PREREQUISITES
─────────────────────────────────────────────────────────────────────────────

Before starting:
□ Read the Import Specification v2.0 completely
□ Understand the current codebase structure
□ Set up development environment
□ Create a new git branch: feature/import-v2

─────────────────────────────────────────────────────────────────────────────
PHASE A: FOUNDATION (Do First)
─────────────────────────────────────────────────────────────────────────────

A.1 Install Dependencies
────────────────────────
npm install blake3 better-queue p-queue

A.2 Database Schema Migration
─────────────────────────────
Create migration: migrations/XXXX_import_v2_schema.ts

{Provide complete migration SQL with all new tables, columns, indexes}

A.3 Create Job Queue Infrastructure
────────────────────────────────────
File: src/services/JobQueue.ts

{Provide complete implementation with:}
- SQLite-backed persistence
- Priority queues
- Job dependencies
- Retry logic
- Dead letter queue

A.4 Create Worker Thread Infrastructure  
────────────────────────────────────────
File: src/workers/hash.worker.ts

{Provide complete implementation}

File: src/services/WorkerPool.ts

{Provide complete implementation with:}
- Configurable concurrency
- Task distribution
- Error handling
- Graceful shutdown

─────────────────────────────────────────────────────────────────────────────
PHASE B: IMPORT PIPELINE (Steps 1-5)
─────────────────────────────────────────────────────────────────────────────

B.1 File Scanner (Step 1)
─────────────────────────
File: src/services/import/Scanner.ts

{Provide complete implementation with:}
- Recursive walk
- Sidecar detection
- RAW+JPEG pairing
- Live Photo candidate detection
- DB pending record insertion

B.2 Parallel Hasher (Step 2)
────────────────────────────
File: src/services/import/Hasher.ts

{Provide complete implementation with:}
- Worker pool integration
- BLAKE3 hashing
- Batch duplicate check
- Progress reporting

B.3 Atomic Copier (Step 3)
──────────────────────────
File: src/services/import/Copier.ts

{Provide complete implementation with:}
- Strategy detection (hardlink/reflink/copy)
- Atomic temp-file-then-rename
- Sidecar copying
- Progress by bytes or count

B.4 Validator (Step 4)
──────────────────────
File: src/services/import/Validator.ts

{Provide complete implementation with:}
- Parallel verification
- Rollback on mismatch
- Error recording

B.5 Finalizer (Step 5)
──────────────────────
File: src/services/import/Finalizer.ts

{Provide complete implementation with:}
- Batch DB transaction
- Relationship linking
- Job queue population
- Import session recording

B.6 Import Orchestrator
───────────────────────
File: src/services/import/ImportOrchestrator.ts

{Provide complete implementation that:}
- Coordinates steps 1-5
- Manages progress calculation
- Handles cancellation
- Supports resume

─────────────────────────────────────────────────────────────────────────────
PHASE C: BACKGROUND JOBS (Steps 6-10)
─────────────────────────────────────────────────────────────────────────────

C.1 ExifTool Job Handler (Step 6)
─────────────────────────────────
File: src/jobs/ExifToolJob.ts

{Provide complete implementation}

C.2 FFprobe Job Handler (Step 7)
────────────────────────────────
File: src/jobs/FFprobeJob.ts

{Provide complete implementation}

C.3 Photo Thumbnail Job Handler (Step 8)
────────────────────────────────────────
File: src/jobs/PhotoThumbnailJob.ts

{Provide complete implementation}

C.4 Video Thumbnail Job Handler (Step 9)
────────────────────────────────────────
File: src/jobs/VideoThumbnailJob.ts

{Provide complete implementation}

C.5 Video Proxy Job Handler (Step 10)
─────────────────────────────────────
File: src/jobs/VideoProxyJob.ts

{Provide complete implementation}

C.6 Job Worker Service
──────────────────────
File: src/services/JobWorkerService.ts

{Provide complete implementation that:}
- Starts on app launch
- Processes jobs by priority
- Respects concurrency limits
- Handles dependencies
- Emits progress events

─────────────────────────────────────────────────────────────────────────────
PHASE D: POST-IMPORT BATCH JOBS
─────────────────────────────────────────────────────────────────────────────

D.1 Live Photo Detector
───────────────────────
File: src/jobs/LivePhotoDetector.ts

{Provide complete implementation}

D.2 BagIt Manifest Updater
──────────────────────────
File: src/jobs/BagItUpdater.ts

{Provide complete implementation}

D.3 Location Statistics Calculator
──────────────────────────────────
File: src/jobs/LocationStatsJob.ts

{Provide complete implementation}

─────────────────────────────────────────────────────────────────────────────
PHASE E: IPC & UI INTEGRATION
─────────────────────────────────────────────────────────────────────────────

E.1 New IPC Handlers
────────────────────
File: src/ipc/import.handlers.ts

Endpoints:
- import:start → Start import, return session ID
- import:cancel → Cancel in-progress import
- import:status → Get import progress
- jobs:status → Get background job status
- jobs:retry → Retry failed job
- jobs:clear-dead-letter → Clear failed jobs

E.2 Event Emitters
──────────────────
Events to emit:
- 'import:progress' → { phase, percent, current, total, speed, eta }
- 'import:complete' → { sessionId, imported, duplicates, errors }
- 'asset:thumbnail-ready' → { assetId, paths }
- 'asset:metadata-complete' → { assetId }
- 'jobs:progress' → { queue, completed, total }

─────────────────────────────────────────────────────────────────────────────
PHASE F: CLEANUP & MIGRATION
─────────────────────────────────────────────────────────────────────────────

F.1 Remove Deprecated Code
──────────────────────────
Delete these files:
- src/services/FileImport.ts (old monolithic importer)
- {list all files to delete}

F.2 Update Imports
──────────────────
Update all files that imported old modules to use new ones.

F.3 Run Tests
─────────────
□ Unit tests for each new service
□ Integration test: 10 file import
□ Integration test: 1000 file import
□ Integration test: Resume after crash
□ Integration test: Cross-volume copy fallback

F.4 Update Documentation
────────────────────────
□ Update README.md
□ Update CONTRIBUTING.md
□ Update claude.md (AI assistant instructions)

─────────────────────────────────────────────────────────────────────────────
TESTING CHECKLIST
─────────────────────────────────────────────────────────────────────────────

□ BLAKE3 hashing produces correct hashes
□ Hardlink works on same volume
□ Reflink works on APFS
□ Copy fallback works cross-volume
□ Duplicate detection prevents re-import
□ Sidecars linked to parent correctly
□ RAW+JPEG pairs detected
□ Live Photos detected (after metadata extraction)
□ Import survives app restart
□ Failed jobs go to dead letter queue
□ Retry works for dead letter jobs
□ Progress reports accurately
□ Thumbnails appear progressively in UI
□ Video proxy generates for non-H.264
□ BagIt manifest updates correctly
□ Location stats calculate correctly

─────────────────────────────────────────────────────────────────────────────
ROLLBACK PLAN
─────────────────────────────────────────────────────────────────────────────

If critical issues found post-deploy:

1. Git revert to previous commit
2. Run down migration to restore old schema
3. Old import code still functional
4. No data loss (new tables are additive)
```

---

## PHASE 6: CLAUDE.MD UPDATE

Produce the updated `claude.md` file that reflects the new architecture:

```markdown
# Claude.md — AU Archive AI Assistant Instructions

## Project Overview
{Updated description reflecting new architecture}

## Import System Architecture

### Import Pipeline (User-Facing, 0-100%)
{Document steps 1-5 with file locations}

### Background Job System
{Document job queue, workers, dependencies}

### Key Files
{Map of all import-related files and their purposes}

## Code Patterns

### Hashing
- Always use BLAKE3, never SHA256
- Use worker threads for parallel hashing
- Hash before any file operations

### File Operations  
- Always try: hardlink → reflink → copy
- Always use atomic temp-file-then-rename
- Always verify with BLAKE3 after copy

### Database
- Batch transactions (never per-file commits)
- Use single WHERE IN for bulk lookups
- Status field tracks asset lifecycle

### Background Jobs
- SQLite-backed queue (no Redis)
- Respect dependency graph
- 3 retries before dead letter

### Error Handling
- Never abort entire import for single file failure
- Always record errors in DB
- Always emit events for UI feedback

## Testing Requirements
{What tests are required for PRs}

## Common Tasks

### Adding a New Job Type
{Step by step instructions}

### Modifying Import Steps
{Step by step instructions}

### Adding New Metadata Fields
{Step by step instructions}
```

---

## OUTPUT FORMAT

Your complete audit output should be structured as:

```
═══════════════════════════════════════════════════════════════════════════════
AU ARCHIVE IMPORT SYSTEM — FULL AUDIT REPORT
Generated: {date}
Auditor: Claude (Principal Architect)
═══════════════════════════════════════════════════════════════════════════════

TABLE OF CONTENTS
─────────────────────────────────────────────────────────────────────────────
1. Executive Summary
2. Codebase Discovery
3. Specification Compliance Audit
4. File-by-File Verdicts
5. Change Manifest
6. Implementation Guide
7. Updated claude.md
8. Appendices
   A. Full file listing
   B. Dependency graph
   C. Database schema (before/after)
   D. Test plan
═══════════════════════════════════════════════════════════════════════════════

{Complete audit content following the structure above}
```

---

## AUDIT STANDARDS

Apply these standards throughout:

1. **No Ambiguity** — Every instruction must be copy-paste ready
2. **No Assumptions** — State every dependency explicitly
3. **No Gaps** — Cover every file, every function, every edge case
4. **IRS-Level** — Document as if being audited by regulators
5. **New Developer Ready** — Someone new could implement from this alone

---

## BEGIN AUDIT

Start by reading ALL files in the codebase. Then proceed through each phase systematically. Do not skip any file. Do not summarize — be exhaustive.

For each code block you provide in the implementation guide, include:
- Complete, working code (not pseudocode)
- All imports
- All types
- All error handling
- All logging
- All comments explaining non-obvious logic

This audit is the source of truth for the refactor. Treat it accordingly.
