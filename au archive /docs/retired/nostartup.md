# AU Archive Startup Failure Audit Report

**Date:** 2025-11-21
**Auditor:** Claude Code
**Status:** CRITICAL - Multiple boot-loop causing bugs identified

---

## Executive Summary

The application is experiencing boot loops due to **multiple critical bugs** in the database initialization and startup orchestration code. The root cause is a flawed assumption that "database file exists = schema exists", which causes the app to skip schema creation and immediately attempt migrations on an empty database.

---

## Critical Bugs (Boot Loop Causes)

### BUG #1: Database File Exists But Has No Tables (THE ROOT CAUSE)

**File:** `packages/desktop/electron/main/database.ts:382-403`

**The Problem:**
```typescript
export function getDatabase(): Kysely<DatabaseSchema> {
  // ...
  const dbPath = getDatabasePath();
  const isNewDatabase = !fs.existsSync(dbPath);  // <-- FLAWED CHECK

  const sqlite = new Database(dbPath, { /* ... */ });

  if (isNewDatabase) {
    initializeSchema(sqlite);  // Only runs if file doesn't exist
  } else {
    runMigrations(sqlite);     // <-- CRASHES HERE - no tables exist!
  }
}
```

**Why It Fails:**
1. `fs.existsSync(dbPath)` only checks if the FILE exists, not if it has any TABLES
2. The database file can exist but be empty (0 tables) due to:
   - Previous failed initialization that created the file but didn't create tables
   - Corrupted database
   - Manual file creation
   - SQLite creating the file on first connection attempt
3. When `isNewDatabase = false` but no tables exist, `runMigrations()` tries to ALTER/query non-existent tables

**Exact Error:**
```
Error running migrations: SqliteError: no such table: locs
```

**Impact:** 100% boot failure on reinstall or corrupted state

---

### BUG #2: Migration Logic Assumes Tables Exist

**File:** `packages/desktop/electron/main/database.ts:241-249`

**The Problem:**
```typescript
function runMigrations(sqlite: Database.Database): void {
  // Migration 1: Add favorite column if it doesn't exist
  const columns = sqlite.pragma('table_info(locs)') as Array<{ name: string }>;
  const hasFavorite = columns.some(col => col.name === 'favorite');

  if (!hasFavorite) {
    sqlite.exec('ALTER TABLE locs ADD COLUMN favorite INTEGER DEFAULT 0');  // CRASH!
  }
  // ...
}
```

**Why It Fails:**
1. `pragma table_info(locs)` returns empty array `[]` if `locs` table doesn't exist
2. Empty array means `hasFavorite = false`
3. Code then tries `ALTER TABLE locs ADD COLUMN...` on non-existent table
4. SQLite throws `SqliteError: no such table: locs`

**Impact:** Cascading failure from Bug #1

---

### BUG #3: Recovery System Uses Wrong Database Path

**File:** `packages/desktop/electron/services/recovery-system.ts:26`

**The Problem:**
```typescript
// recovery-system.ts
constructor() {
  this.dbPath = join(app.getPath('userData'), 'au-archive.db');  // WRONG!
}

// database.ts (correct path)
export function getDatabasePath(): string {
  const userDataPath = app.getPath('userData');
  const dbDir = path.join(userDataPath, 'data');  // Note: 'data' subdirectory
  return path.join(dbDir, 'au-archive.db');       // Correct path
}
```

**Actual Paths:**
- Recovery system looks at: `{userData}/au-archive.db`
- Database actually at: `{userData}/data/au-archive.db`

**Impact:** Recovery system can NEVER find or restore the actual database

---

### BUG #4: Maintenance Scheduler Uses Wrong Database Path

**File:** `packages/desktop/electron/services/maintenance-scheduler.ts:40`

**The Problem:**
```typescript
constructor() {
  this.dbPath = join(app.getPath('userData'), 'au-archive.db');  // WRONG!
}
```

**Impact:** VACUUM and ANALYZE operations run on wrong/non-existent file

---

### BUG #5: Integrity Checker Opens Separate Connection Without Checking Tables

**File:** `packages/desktop/electron/services/integrity-checker.ts:31-32`

**The Problem:**
```typescript
async runFullCheck(): Promise<IntegrityResult> {
  const dbPath = getDatabasePath();
  const db = new Database(dbPath, { readonly: true });  // New connection

  const integrityResults = db.pragma('integrity_check');
  // ...
}
```

**Why It's Problematic:**
1. Opens a completely separate connection to the database
2. SQLite `integrity_check` on an empty database returns `ok` (no tables = no corruption)
3. The integrity check passes but the database is actually unusable
4. Does not verify that required tables exist

**Impact:** False positive "healthy" status on empty databases

---

## Architectural Issues

### ISSUE #1: No Schema Version Tracking

**Problem:** The migration system has no persistent record of which migrations have run. It relies on:
- Checking if columns exist
- Checking if tables exist

**Why It's Bad:**
- No way to add data-only migrations
- Can't handle schema changes that don't add tables/columns
- Race conditions if two migrations check the same thing

**Industry Standard:** Use a `schema_version` or `migrations` table to track applied migrations.

---

### ISSUE #2: Singleton Services Access Each Other at Module Load Time

**Example:** `packages/desktop/electron/services/health-monitor.ts:12`

```typescript
const logger = getLogger();  // Runs at module import time
```

**Problem:**
- Module imports happen before `app.whenReady()`
- `app.getPath('userData')` may not be available yet
- Circular dependencies can cause undefined behavior

---

### ISSUE #3: Multiple Database Connections

**Services that open their own connections:**
1. `database.ts` - Main Kysely connection
2. `integrity-checker.ts` - Separate readonly connection
3. `maintenance-scheduler.ts` - Separate connection for VACUUM
4. `backup-scheduler.ts` - Uses `fs.copyFile` (doesn't use SQLite backup API)

**Problems:**
- SQLite in WAL mode supports concurrent readers, but VACUUM requires exclusive lock
- No connection pooling or coordination
- Can cause `SQLITE_BUSY` errors under load

---

### ISSUE #4: No Graceful Degradation

**Current behavior:** If any startup step fails, the app exits immediately.

```typescript
catch (error) {
  await dialog.showErrorBox('Startup Error', ...);
  app.exit(1);  // Hard exit, no recovery options
}
```

**Better approach:**
- Offer to delete corrupted database and start fresh
- Offer to run in "read-only" mode
- Offer to export what data can be recovered

---

### ISSUE #5: Error Handling Doesn't Preserve Context

**Problem:** Errors are caught and re-thrown without preserving the original stack:

```typescript
} catch (error) {
  console.error('Error running migrations:', error);
  throw error;  // Original error, but context is lost
}
```

**Better approach:** Wrap errors with context about what operation was being attempted.

---

## Scaling & Production Issues

### SCALE #1: No Database Connection Limits

**Problem:** Each IPC call creates queries through Kysely, but there's no connection pooling or limit.

**Impact at scale:** Under heavy IPC traffic, could exhaust file descriptors or memory.

---

### SCALE #2: Synchronous File I/O in Main Process

**Examples:**
```typescript
// database.ts:211
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// logger-service.ts:138
fs.appendFileSync(this.currentLogFile, logLine, 'utf-8');
```

**Impact:** Blocks the main process, causing UI freezes during disk I/O.

---

### SCALE #3: No Rate Limiting on Health Checks

**Problem:** Health checks can run on every IPC call if triggered.

**Impact:** With many concurrent operations, health checks could create significant overhead.

---

### SCALE #4: Backup Creates Full Copy Without WAL Checkpoint

**File:** `packages/desktop/electron/services/backup-scheduler.ts:101`

```typescript
await fs.copyFile(dbPath, backupPath);  // Just copies the file
```

**Problems:**
1. Doesn't checkpoint WAL first (`PRAGMA wal_checkpoint(TRUNCATE)`)
2. Copied database may have uncommitted transactions
3. Should use SQLite's backup API for consistency

---

### SCALE #5: No Index on High-Cardinality Queries

**Current indexes:**
```sql
CREATE INDEX idx_locs_state ON locs(address_state);
CREATE INDEX idx_locs_type ON locs(type);
```

**Missing indexes for common queries:**
- Full-text search on `locnam`
- Combined queries on multiple filter criteria
- Pagination queries need proper covering indexes

---

## Immediate Fixes Required

### FIX #1: Check for Table Existence, Not Just File Existence

```typescript
export function getDatabase(): Kysely<DatabaseSchema> {
  if (db) return db;

  const dbPath = getDatabasePath();
  const fileExists = fs.existsSync(dbPath);

  const sqlite = new Database(dbPath, { /* ... */ });
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Check if schema exists by looking for core table
  const tables = sqlite.pragma('table_list') as Array<{ name: string }>;
  const hasSchema = tables.some(t => t.name === 'locs');

  if (!hasSchema) {
    console.log(fileExists ? 'Reinitializing empty database' : 'Creating new database');
    initializeSchema(sqlite);
  }

  // Always run migrations after schema exists
  runMigrations(sqlite);

  // ... rest of function
}
```

---

### FIX #2: Fix Paths in Recovery System

```typescript
// recovery-system.ts
import { getDatabasePath } from '../main/database';

constructor() {
  this.dbPath = getDatabasePath();  // Use the canonical path function
}
```

---

### FIX #3: Fix Paths in Maintenance Scheduler

```typescript
// maintenance-scheduler.ts
import { getDatabasePath } from '../main/database';

constructor() {
  this.dbPath = getDatabasePath();  // Use the canonical path function
}
```

---

### FIX #4: Add Schema Version Table

```sql
CREATE TABLE IF NOT EXISTS _schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  description TEXT
);
```

```typescript
function runMigrations(sqlite: Database.Database): void {
  // Ensure schema version table exists
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS _schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT
    )
  `);

  const currentVersion = sqlite.prepare(
    'SELECT MAX(version) as version FROM _schema_version'
  ).get() as { version: number | null };

  const version = currentVersion?.version ?? 0;

  // Run migrations in order
  if (version < 1) {
    // Migration 1: Add favorite column
    sqlite.exec('ALTER TABLE locs ADD COLUMN favorite INTEGER DEFAULT 0');
    sqlite.exec("INSERT INTO _schema_version VALUES (1, datetime('now'), 'Add favorite column')");
  }

  if (version < 2) {
    // Migration 2: Add imports table
    // ...
  }
}
```

---

### FIX #5: Add Table Existence Check Before Column Checks

```typescript
function runMigrations(sqlite: Database.Database): void {
  const tables = sqlite.pragma('table_list') as Array<{ name: string }>;

  // Safety check - if core tables don't exist, schema needs initialization, not migration
  if (!tables.some(t => t.name === 'locs')) {
    throw new Error('Core tables missing - database needs schema initialization, not migration');
  }

  // Now safe to run migrations
  // ...
}
```

---

## What I Would Do Differently

### 1. Separate Database Layer from Application Code

Create a dedicated `DatabaseManager` class that:
- Handles all connection lifecycle
- Provides a single point of truth for database path
- Manages schema creation and migrations
- Provides health check methods

```typescript
class DatabaseManager {
  private static instance: DatabaseManager;
  private db: Kysely<DatabaseSchema> | null = null;
  private sqlite: Database.Database | null = null;

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  getPath(): string {
    return join(app.getPath('userData'), 'data', 'au-archive.db');
  }

  async initialize(): Promise<void> {
    // All initialization in one place
  }

  async backup(targetPath: string): Promise<void> {
    // Use SQLite backup API, not file copy
  }

  async healthCheck(): Promise<HealthResult> {
    // Reuse existing connection
  }
}
```

### 2. Implement Proper Migration System

```typescript
interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
  down?: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Add favorite column',
    up: (db) => db.exec('ALTER TABLE locs ADD COLUMN favorite INTEGER DEFAULT 0'),
  },
  // ...
];
```

### 3. Use Async Initialization Pattern

```typescript
class App {
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initialize();
    await this.initPromise;
    this.initialized = true;
  }

  private async initialize(): Promise<void> {
    // Sequential initialization with proper error handling
  }
}
```

### 4. Implement Circuit Breaker for Recovery

```typescript
class RecoveryCircuitBreaker {
  private failures = 0;
  private readonly maxFailures = 3;

  async attemptRecovery(): Promise<RecoveryResult> {
    if (this.failures >= this.maxFailures) {
      return this.offerFactoryReset();
    }

    try {
      const result = await this.tryRecover();
      this.failures = 0;
      return result;
    } catch (error) {
      this.failures++;
      throw error;
    }
  }

  private async offerFactoryReset(): Promise<RecoveryResult> {
    // Offer to delete everything and start fresh
  }
}
```

### 5. Add Comprehensive Startup Diagnostics

```typescript
async function runStartupDiagnostics(): Promise<DiagnosticReport> {
  return {
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    userDataPath: app.getPath('userData'),
    databaseExists: fs.existsSync(getDatabasePath()),
    databaseHasSchema: await checkDatabaseSchema(),
    diskSpace: await checkDiskSpace(),
    permissions: await checkPermissions(),
    configValid: await validateConfig(),
  };
}
```

---

## Testing Recommendations

### 1. Add Unit Tests for Database Initialization

```typescript
describe('Database Initialization', () => {
  it('should create schema on new database', async () => {
    // Test with fresh database
  });

  it('should handle empty database file', async () => {
    // Create empty file, verify schema is created
  });

  it('should run migrations on existing database', async () => {
    // Create database with old schema, verify migrations run
  });

  it('should recover from corrupted database', async () => {
    // Create corrupted database, verify recovery works
  });
});
```

### 2. Add Integration Tests for Startup Sequence

```typescript
describe('Startup Sequence', () => {
  it('should complete full startup in under 5 seconds', async () => {
    // Time the full startup
  });

  it('should handle missing config gracefully', async () => {
    // Delete config, verify defaults are used
  });

  it('should offer recovery on database corruption', async () => {
    // Corrupt database, verify dialog appears
  });
});
```

---

## Conclusion

The boot loop is caused by a fundamental flaw in the database initialization logic that assumes "file exists = schema exists". This, combined with path mismatches in the recovery and maintenance systems, creates an unrecoverable state where:

1. Database file exists (from previous failed attempt)
2. Database has no tables
3. App skips schema creation
4. App tries to run migrations
5. Migrations fail because tables don't exist
6. App crashes
7. On restart, database file still exists
8. Repeat from step 2

The fix requires checking for TABLE existence, not FILE existence, and ensuring all services use the canonical database path.

---

## Priority Order for Fixes

1. **CRITICAL** - Fix database initialization to check table existence (Bug #1 & #2)
2. **CRITICAL** - Fix path in recovery-system.ts (Bug #3)
3. **HIGH** - Fix path in maintenance-scheduler.ts (Bug #4)
4. **HIGH** - Add schema version tracking
5. **MEDIUM** - Implement proper migration system
6. **MEDIUM** - Add startup diagnostics
7. **LOW** - Refactor to single DatabaseManager class
