# Network-Safe Import System - Implementation Guide

**For:** Less experienced developers
**Prerequisite:** Familiarity with TypeScript and async/await

---

## Overview

This guide walks through implementing a network-safe file import system for wedding video files. The system:

1. Detects if files are on local disk or network storage (NAS)
2. Copies files to organized managed storage
3. Verifies copies via hash comparison
4. Handles network failures gracefully with retry and resume

---

## Step-by-Step Implementation

### Step 1: Create the Import Services Directory

**What:** Create a new folder for import-related services

**How:**
```bash
mkdir -p packages/desktop/electron/services/import
```

**Expected:** New empty directory exists

---

### Step 2: Create types.ts

**What:** Define all shared TypeScript types for the import pipeline

**File:** `packages/desktop/electron/services/import/types.ts`

**Key Types:**
- `StorageType`: 'local' | 'network'
- `ImportStatus`: The current state of an import (pending, copying, etc.)
- `ScannedFile`, `HashedFile`, `CopiedFile`, `ValidatedFile`: File at each pipeline stage

**Why:** TypeScript types ensure all services agree on data shapes. Defining them in one place prevents bugs from mismatched types.

---

### Step 3: Create storage-detection.ts

**What:** Service to detect if a file path is on local disk or network storage

**File:** `packages/desktop/electron/services/import/storage-detection.ts`

**Key Functions:**
1. `isNetworkPath(path)` - Returns true if path is on network storage
2. `getStorageConfig(path)` - Returns I/O settings (buffer size, concurrency)

**Logic:**
- Check for explicit network prefixes: `smb://`, `nfs://`, `//`
- On macOS, check `/Volumes/` paths (exclude known local like "Macintosh HD")
- On Linux, check `/mnt/` and `/media/` paths

**Why This Matters:**
- Network storage is SLOW and UNRELIABLE compared to local SSD
- We need larger buffers (fewer round-trips) and sequential operations for network
- We need retry logic because network can disconnect mid-transfer

---

### Step 4: Create copy-service.ts

**What:** Service to copy files with network safety protocols

**File:** `packages/desktop/electron/services/import/copy-service.ts`

**Key Components:**

1. **NetworkFailureError class**
   - Custom error type for network failures
   - Includes consecutive error count for abort decisions
   - Marks import as "paused" (resumable) vs "failed"

2. **copyFileWithRetry function**
   - Wraps Node.js copy with retry logic
   - Uses exponential backoff: wait 1s, then 3s, then 5s between retries
   - Detects network errors by error code (ETIMEDOUT, ECONNRESET, etc.)

3. **buildDestinationPath function**
   - Constructs organized folder path: `{working_path}/{couple}/{medium}/{camera}/`
   - Uses BLAKE3 hash as filename (guarantees uniqueness)

4. **Atomic copy pattern**
   - Copy to `.tmp` file first
   - Rename to final name only after success
   - Prevents partial/corrupted files

**Why Retry Matters:**
- Network can hiccup for a second and recover
- Without retry, users lose entire import for a brief disconnect
- With retry, most transient errors self-heal

---

### Step 5: Create validator-service.ts

**What:** Service to verify copied files via BLAKE3 re-hash

**File:** `packages/desktop/electron/services/import/validator-service.ts`

**Key Functions:**
1. `validateFile(file)` - Re-hash destination, compare to expected
2. `rollbackFile(path)` - Delete invalid file from destination

**Why Validation:**
- Network transfers can corrupt data silently
- Hash comparison catches ANY corruption (even single bit flip)
- Auto-rollback prevents bad files from entering archive

**The Process:**
1. Read destination file
2. Compute BLAKE3 hash
3. Compare to hash from source (computed during copy)
4. If match: file is valid
5. If mismatch: delete file, mark as error

---

### Step 6: Add Database Migration

**What:** Create table to store import session state for resume

**File:** Modify `packages/desktop/electron/main/database.ts`

**Add Migration 23:**
```sql
CREATE TABLE import_sessions (
    session_id TEXT PRIMARY KEY,
    couple_id INTEGER,
    status TEXT,
    last_step INTEGER,
    can_resume INTEGER,
    -- JSON blobs for each step's results
    scan_result TEXT,
    copy_results TEXT,
    validation_results TEXT,
    -- Timestamps
    started_at TEXT,
    completed_at TEXT
);
```

**Why Session Persistence:**
- If app crashes, we can resume from last completed step
- If network fails, user can retry when connection restores
- All progress saved to database (survives restart)

---

### Step 7: Refactor import-controller.ts

**What:** Add orchestrator to coordinate the 5-step pipeline

**Major Changes:**

1. **Add ImportOrchestrator class**
   - Coordinates: scan -> hash -> copy -> validate -> finalize
   - Detects network source at start (affects flow)
   - Saves session state after each step
   - Handles NetworkFailureError specially (paused vs failed)

2. **Network Source Flow**
   - Skip separate hash step (hash computed during copy)
   - This halves network I/O (read file once, not twice)

3. **Resume Functionality**
   - Load session from database
   - Skip completed steps
   - Continue from where we left off

**Why Orchestration:**
- Single place to understand entire flow
- Clear step-by-step progression
- Easy to add new steps later

---

### Step 8: Update UI Components

**What:** Update CoupleDetail.svelte with new import UI

**Changes:**
1. Add "Copy to managed storage" toggle (default: on)
2. Show 5-step progress indicator during import
3. Show network detection status ("Importing from: Network/Local")
4. Add "Resume" button for paused imports

---

### Step 9: Test the System

**Test Cases:**

1. **Local Import (Happy Path)**
   - Select files from local disk
   - Verify files copied to managed storage
   - Verify folder structure correct
   - Verify database records created

2. **Duplicate Detection**
   - Import same file twice
   - Verify second import detects duplicate
   - Verify no duplicate copy created

3. **Cancel and Resume**
   - Start import with many files
   - Cancel mid-import
   - Resume import
   - Verify continues from where stopped

4. **Validation Rollback**
   - Intentionally corrupt a copied file
   - Run validation
   - Verify corrupted file deleted

---

## Key Concepts Explained

### BLAKE3 Hashing

BLAKE3 is a cryptographic hash function. It takes any file and produces a unique 16-character "fingerprint".

- Same file = same hash (always)
- Different file = different hash (virtually guaranteed)
- Even 1 bit change = completely different hash

We use it for:
1. **Duplicate detection:** Same hash = same file already imported
2. **Integrity verification:** Hash after copy must match hash before copy
3. **Unique filenames:** Hash as filename prevents collisions

### Network vs Local I/O

**Local SSD:**
- Super fast (500+ MB/s)
- Very reliable
- Can do many parallel operations

**Network (NAS over SMB):**
- Slower (10-100 MB/s typical)
- Can disconnect randomly
- Overwhelmed by parallel operations

That's why we:
- Use larger buffers for network (1MB vs 64KB)
- Do sequential operations for network (1 at a time)
- Add delays between operations (let network breathe)
- Retry on errors (network often recovers)

### Session Persistence

The database `import_sessions` table stores:
- Which step we're on (1-5)
- Results from completed steps
- Whether we can resume

If app crashes at step 3 (copying), on restart we:
1. Find incomplete session in database
2. Load step 1 and 2 results from database
3. Resume from step 3 (don't redo scan/hash)

This saves potentially hours of re-work on large imports.

### Atomic File Operations

"Atomic" means "all or nothing". For file copy:

**Bad (non-atomic):**
1. Create `file.mp4`
2. Write data... (crash here = partial file!)
3. Done

**Good (atomic):**
1. Create `file.mp4.tmp`
2. Write data... (crash here = only temp file affected)
3. Rename `file.mp4.tmp` to `file.mp4` (instant, can't fail halfway)
4. Done

If crash during step 2, temp file is cleaned up later. Original destination never has partial data.

---

## Common Errors and Solutions

### "ETIMEDOUT" or "ECONNRESET"
**Cause:** Network disconnected or timed out
**Solution:** System will auto-retry up to 3 times. If persists, check network connection.

### "Hash mismatch"
**Cause:** File corrupted during transfer
**Solution:** System auto-deletes bad copy. Re-import the file.

### "Import paused"
**Cause:** Too many consecutive network errors (5+)
**Solution:** Network appears down. Check connection, then click Resume.

### "Duplicate detected"
**Cause:** File already imported (same BLAKE3 hash)
**Solution:** Not an error. File skipped to prevent duplicates.

---

## Verification Checklist

After implementation, verify:

- [ ] Files copied to correct folder structure
- [ ] BLAKE3 hash matches after copy
- [ ] Invalid copies automatically deleted
- [ ] Network paths detected correctly
- [ ] Local paths use fast I/O settings
- [ ] Network paths use safe I/O settings
- [ ] Session saved to database
- [ ] Import can be resumed after cancel
- [ ] UI shows progress correctly
- [ ] App runs without errors
