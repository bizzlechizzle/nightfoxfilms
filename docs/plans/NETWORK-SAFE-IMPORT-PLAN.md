# Network-Safe Import System Implementation Plan

**Created:** 2025-12-16
**Status:** In Progress
**Goal:** Mirror au archive's network-safe import with copy/organization for wedding films

---

## 1. Problem Statement

Current Nightfox import system:
- Catalogs files by reference only (stores `original_path`)
- No file copying to managed storage (`managed_path` always NULL)
- No network safety protocols (no retry, no timeout, no validation)
- Files remain on source media (SD cards, external drives) which may become unavailable

Required system (mirroring au archive):
- Copy files to organized managed storage
- Network-aware I/O with retry and throttling
- Post-copy verification via BLAKE3 re-hash
- Session persistence for crash recovery
- Resumable imports after network failures

---

## 2. Architecture Overview

### 2.1 Pipeline Flow

```
Source Files (SD Card / NAS / External)
         |
         v
+------------------+
| 1. SCAN          | Enumerate files, detect file types
+------------------+
         |
         v
+------------------+
| 2. HASH          | BLAKE3 hash (skip for network sources - inline during copy)
+------------------+
         |
         v
+------------------+
| 3. COPY          | Copy to managed storage with network safety
+------------------+
         |
         v
+------------------+
| 4. VALIDATE      | Re-hash destination, compare, rollback invalid
+------------------+
         |
         v
+------------------+
| 5. FINALIZE      | Insert to database, link sidecars
+------------------+
```

### 2.2 Network vs Local Flow

**Local Source:**
1. Scan -> 2. Hash (parallel) -> 3. Copy -> 4. Validate -> 5. Finalize

**Network Source (SMB/NFS):**
1. Scan -> 2. SKIP -> 3. Copy+Hash (inline) -> 4. Validate -> 5. Finalize

### 2.3 Folder Organization

```
{couple.working_path}/
└── {couple.folder_name}/           # "2025-12-31-julia-sven"
    └── source/
        ├── modern/
        │   ├── {camera.slug}/      # "sony-a7siii"
        │   │   ├── {blake3}.mp4
        │   │   └── {blake3}.xml    # Sidecar
        │   └── unknown/            # Unmatched camera
        ├── dadcam/
        │   └── {camera.slug}/
        └── super8/
            └── {camera.slug}/
```

---

## 3. Files to Create

### 3.1 storage-detection.ts (NEW)
**Path:** `packages/desktop/electron/services/import/storage-detection.ts`

**Purpose:** Detect network vs local storage, return I/O configuration

**Functions:**
- `isNetworkPath(path: string): boolean`
- `getStorageType(path: string): 'local' | 'network'`
- `getStorageConfig(path: string): StorageConfig`

**Constants:**
- `NETWORK_PATH_PREFIXES`: smb://, nfs://, afp://, //
- `LOCAL_VOLUME_PATTERNS`: macintosh hd, ssd, internal
- `STORAGE_CONFIGS`: buffer size, concurrency, delay per storage type

### 3.2 copy-service.ts (NEW)
**Path:** `packages/desktop/electron/services/import/copy-service.ts`

**Purpose:** Copy files with network safety protocols

**Classes:**
- `NetworkFailureError extends Error` - Resumable network failures
- `CopyService` - Main copy orchestration

**Functions:**
- `buildDestinationPath(couple, file, camera): string`
- `copyWithVerification(src, dst, expectedHash): Promise<CopyResult>`
- `copyFileWithRetry(src, dst, options): Promise<void>`
- `ensureDirectoryStructure(basePath): Promise<void>`

**Network Safety Features:**
- Exponential backoff retry (1s, 3s, 5s)
- Network error code detection (EAGAIN, ECONNRESET, ETIMEDOUT, etc.)
- Consecutive error abort threshold (5 errors)
- Atomic temp-then-rename
- 1MB buffer for network, 64KB for local
- 50ms inter-operation delay for network
- Inline hashing during copy for network sources

### 3.3 validator-service.ts (NEW)
**Path:** `packages/desktop/electron/services/import/validator-service.ts`

**Purpose:** Post-copy integrity verification

**Functions:**
- `validateFile(file: CopiedFile): Promise<ValidatedFile>`
- `validateBatch(files: CopiedFile[], options): Promise<ValidationResult>`
- `rollbackFile(archivePath: string): Promise<void>`

**Features:**
- Re-hash destination file via BLAKE3
- Compare against expected hash
- Auto-rollback invalid files (delete from destination)
- Retry with backoff for network errors
- Per-file timeout (120 seconds)
- Consecutive error abort threshold

### 3.4 types.ts (NEW)
**Path:** `packages/desktop/electron/services/import/types.ts`

**Purpose:** Shared type definitions for import pipeline

**Types:**
```typescript
type ImportStatus = 'pending' | 'scanning' | 'hashing' | 'copying' | 'validating' | 'finalizing' | 'completed' | 'cancelled' | 'failed' | 'paused';

interface ScannedFile { ... }
interface HashedFile extends ScannedFile { ... }
interface CopiedFile extends HashedFile { ... }
interface ValidatedFile extends CopiedFile { ... }
interface FinalizedFile extends ValidatedFile { ... }

interface ImportSession { ... }
interface ImportProgress { ... }
interface ImportResult { ... }
```

---

## 4. Files to Modify

### 4.1 database.ts
**Add Migration 23:** Create `import_sessions` table

```sql
CREATE TABLE IF NOT EXISTS import_sessions (
    session_id TEXT PRIMARY KEY,
    couple_id INTEGER REFERENCES couples(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    last_step INTEGER DEFAULT 0,
    can_resume INTEGER DEFAULT 1,
    source_paths TEXT,          -- JSON array
    archive_path TEXT,
    total_files INTEGER DEFAULT 0,
    processed_files INTEGER DEFAULT 0,
    duplicate_files INTEGER DEFAULT 0,
    error_files INTEGER DEFAULT 0,
    total_bytes INTEGER DEFAULT 0,
    processed_bytes INTEGER DEFAULT 0,
    scan_result TEXT,           -- JSON
    hash_results TEXT,          -- JSON
    copy_results TEXT,          -- JSON
    validation_results TEXT,    -- JSON
    error TEXT,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_import_sessions_status ON import_sessions(status);
CREATE INDEX IF NOT EXISTS idx_import_sessions_couple ON import_sessions(couple_id);
```

### 4.2 import-controller.ts
**Major refactor:**

1. Add `ImportOrchestrator` class to coordinate 5-step pipeline
2. Add network source detection at start
3. Add session persistence after each step
4. Add `NetworkFailureError` handling -> paused state
5. Add resume functionality
6. Add location locking to prevent concurrent imports
7. Keep existing `determineFootageType` logic

### 4.3 import-service.ts
**Minor modifications:**

1. Extract scanning logic to separate function
2. Add inline hashing option for network sources
3. Add progress callbacks per-file

### 4.4 files-repository.ts
**Add methods:**

- `updateManagedPath(id: number, managedPath: string): void`
- `findBySidecarPattern(pattern: string, coupleId: number): File | null`

### 4.5 CoupleDetail.svelte
**UI changes:**

1. Add "Copy to storage" toggle (default: true)
2. Show import progress with step indicator
3. Show network detection status
4. Add resume button for paused imports

---

## 5. Implementation Phases

### Phase 1: Foundation (Types + Storage Detection)
1. Create `packages/desktop/electron/services/import/` directory
2. Create `types.ts` with all shared types
3. Create `storage-detection.ts` with network detection
4. Add unit tests for storage detection

### Phase 2: Copy Service
1. Create `copy-service.ts` with network safety
2. Implement `NetworkFailureError` class
3. Implement retry logic with exponential backoff
4. Implement atomic temp-then-rename
5. Implement inline hashing for network sources
6. Add unit tests for copy service

### Phase 3: Validator Service
1. Create `validator-service.ts`
2. Implement re-hash and compare
3. Implement auto-rollback
4. Implement retry with backoff
5. Add unit tests for validator

### Phase 4: Database Migration
1. Add migration 23 for `import_sessions` table
2. Add `updateManagedPath` to files repository
3. Test migration on fresh and existing databases

### Phase 5: Orchestrator Refactor
1. Create `ImportOrchestrator` class in import-controller.ts
2. Implement 5-step pipeline
3. Implement session persistence
4. Implement resume functionality
5. Implement network source detection
6. Wire up progress events

### Phase 6: UI Updates
1. Update CoupleDetail.svelte with new import UI
2. Add copy toggle and progress display
3. Add resume functionality
4. Test end-to-end flow

### Phase 7: Testing and Verification
1. Test local import flow
2. Test network import flow (if NAS available)
3. Test resume after cancel
4. Test duplicate detection
5. Test validation rollback
6. Verify app runs correctly

---

## 6. Network Error Codes

From au archive (comprehensive list for SMB/NFS reliability):

```typescript
const NETWORK_ERROR_CODES = [
  'EAGAIN',       // Resource temporarily unavailable
  'ECONNRESET',   // Connection reset
  'ETIMEDOUT',    // Connection timed out
  'EBUSY',        // Resource busy
  'EIO',          // I/O error
  'ENETUNREACH',  // Network unreachable
  'EPIPE',        // Broken pipe
  'ENOTCONN',     // Socket not connected (SMB disconnect)
  'EHOSTDOWN',    // Host is down
  'EHOSTUNREACH', // No route to host
  'ENETDOWN',     // Network is down
  'ECONNABORTED', // Connection aborted
  'ESTALE',       // Stale file handle (NFS)
  'ENOENT',       // File not found (may be network issue)
];
```

---

## 7. Configuration Constants

```typescript
// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  delays: [1000, 3000, 5000], // Exponential backoff
};

// Timeouts
const COPY_TIMEOUT_MS = 300000;       // 5 minutes per file
const VALIDATION_TIMEOUT_MS = 120000; // 2 minutes per file

// Network abort threshold
const NETWORK_ABORT_THRESHOLD = 5;    // Consecutive errors before abort

// Storage configs
const STORAGE_CONFIGS = {
  local: {
    bufferSize: 64 * 1024,    // 64KB
    concurrency: 4,           // Parallel operations
    operationDelayMs: 0,
  },
  network: {
    bufferSize: 1024 * 1024,  // 1MB (fewer round-trips)
    concurrency: 1,           // Sequential
    operationDelayMs: 50,     // Breathing room
  },
};
```

---

## 8. Testing Strategy

### Unit Tests
- Storage detection (various paths)
- Copy service retry logic
- Validator hash comparison
- Error code detection

### Integration Tests
- Full import flow (local)
- Session persistence and resume
- Duplicate detection
- Validation rollback

### Manual Tests
- Import from SD card
- Import from external drive
- Import from NAS (if available)
- Cancel and resume
- Disconnect network during import

---

## 9. Rollback Plan

If implementation fails:
1. Revert all new files in `services/import/`
2. Revert migration 23 (drop import_sessions table)
3. Revert changes to import-controller.ts
4. Original catalog-only behavior remains functional

---

## 10. CLAUDE.md Compliance Checklist

- [ ] KISS: Each service has single purpose
- [ ] FAANG PE: Network safety mirrors industry standards
- [ ] BPL: Session persistence ensures crash recovery
- [ ] BPA: Following au archive patterns (proven in production)
- [ ] NME: No emojis in code or comments
- [ ] WWYDD: Mirroring proven au archive approach
- [ ] DRETW: Reusing patterns from au archive
- [ ] LILBITS: Modular services (storage, copy, validate)

---

## 11. Success Criteria

1. Files copied to managed storage with correct folder structure
2. BLAKE3 hash verified after copy
3. Invalid copies automatically rolled back
4. Network sources detected and handled appropriately
5. Import can be resumed after cancel or network failure
6. Session state persisted to database
7. UI shows progress and allows resume
8. App runs and imports work end-to-end
