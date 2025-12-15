/**
 * Nightfox Films - Database Module
 *
 * SQLite database with embedded schema and migrations.
 * Uses better-sqlite3 for synchronous operations.
 *
 * Pattern: Schema embedded in code to avoid bundling issues with Vite.
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import Database, { type Database as SqliteDatabase } from 'better-sqlite3';

let db: SqliteDatabase | null = null;

/**
 * Database schema SQL - embedded to avoid bundling issues with Vite
 * This schema is kept in sync with docs/schema.sql for reference
 *
 * BLAKE3 Hash Format: 16 lowercase hex characters (64-bit output)
 */
const SCHEMA_SQL = `
-- =============================================================================
-- SETTINGS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- CAMERAS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    medium TEXT NOT NULL CHECK (medium IN ('dadcam', 'super8', 'modern')),
    make TEXT,
    model TEXT,
    is_default INTEGER DEFAULT 0,
    notes TEXT,
    lut_path TEXT,
    deinterlace INTEGER DEFAULT 0,
    audio_channels TEXT DEFAULT 'stereo' CHECK (audio_channels IN ('stereo', 'mono', 'none')),
    sharpness_baseline REAL,
    transcode_preset TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- CAMERA_PATTERNS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS camera_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    pattern_type TEXT NOT NULL CHECK (pattern_type IN ('filename', 'folder', 'extension')),
    pattern TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_camera_patterns_camera_id ON camera_patterns(camera_id);
CREATE INDEX IF NOT EXISTS idx_camera_patterns_priority ON camera_patterns(priority DESC);

-- =============================================================================
-- COUPLES TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS couples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    wedding_date TEXT,
    folder_name TEXT,
    notes TEXT,
    file_count INTEGER DEFAULT 0,
    total_duration_seconds REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_couples_wedding_date ON couples(wedding_date);
CREATE INDEX IF NOT EXISTS idx_couples_folder_name ON couples(folder_name);

-- =============================================================================
-- FILES TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blake3 TEXT UNIQUE NOT NULL,
    original_filename TEXT NOT NULL,
    original_path TEXT,
    managed_path TEXT,
    extension TEXT NOT NULL,
    file_size INTEGER,
    couple_id INTEGER REFERENCES couples(id) ON DELETE SET NULL,
    camera_id INTEGER REFERENCES cameras(id) ON DELETE SET NULL,
    detected_make TEXT,
    detected_model TEXT,
    medium TEXT CHECK (medium IN ('dadcam', 'super8', 'modern')),
    file_type TEXT CHECK (file_type IN ('video', 'sidecar', 'audio', 'other')),
    duration_seconds REAL,
    width INTEGER,
    height INTEGER,
    frame_rate REAL,
    codec TEXT,
    bitrate INTEGER,
    is_processed INTEGER DEFAULT 0,
    is_hidden INTEGER DEFAULT 0,
    recorded_at TEXT,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_files_blake3 ON files(blake3);
CREATE INDEX IF NOT EXISTS idx_files_couple_id ON files(couple_id);
CREATE INDEX IF NOT EXISTS idx_files_camera_id ON files(camera_id);
CREATE INDEX IF NOT EXISTS idx_files_original_filename ON files(original_filename);
CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);
CREATE INDEX IF NOT EXISTS idx_files_medium ON files(medium);
CREATE INDEX IF NOT EXISTS idx_files_detected_make ON files(detected_make);

-- =============================================================================
-- FILE_METADATA TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS file_metadata (
    file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    exiftool_json TEXT,
    ffprobe_json TEXT,
    extracted_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- FILE_SIDECARS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS file_sidecars (
    video_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    sidecar_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    sidecar_type TEXT,
    PRIMARY KEY (video_file_id, sidecar_file_id)
);

CREATE INDEX IF NOT EXISTS idx_file_sidecars_video ON file_sidecars(video_file_id);
CREATE INDEX IF NOT EXISTS idx_file_sidecars_sidecar ON file_sidecars(sidecar_file_id);

-- =============================================================================
-- SCENES TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    scene_number INTEGER NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    duration REAL NOT NULL,
    start_frame INTEGER,
    end_frame INTEGER,
    detection_method TEXT CHECK (detection_method IN ('content', 'adaptive', 'threshold')),
    confidence REAL,
    best_frame_number INTEGER,
    best_frame_sharpness REAL,
    best_frame_path TEXT,
    scene_type TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scenes_file_id ON scenes(file_id);
CREATE INDEX IF NOT EXISTS idx_scenes_timing ON scenes(file_id, start_time);

-- =============================================================================
-- AI_ANALYSIS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS ai_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
    scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
    analysis_type TEXT NOT NULL,
    result_json TEXT NOT NULL,
    model_name TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    confidence REAL,
    prompt_used TEXT,
    processing_time_ms INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_file_id ON ai_analysis(file_id);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_scene_id ON ai_analysis(scene_id);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_type ON ai_analysis(analysis_type);

-- =============================================================================
-- EXPORTS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS exports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
    scene_id INTEGER REFERENCES scenes(id) ON DELETE SET NULL,
    couple_id INTEGER REFERENCES couples(id) ON DELETE SET NULL,
    export_type TEXT NOT NULL CHECK (export_type IN ('screenshot', 'clip')),
    output_path TEXT NOT NULL,
    output_format TEXT,
    width INTEGER,
    height INTEGER,
    aspect_ratio TEXT CHECK (aspect_ratio IN ('16:9', '9:16', '1:1', '4:5', '4:3')),
    start_time REAL,
    end_time REAL,
    duration REAL,
    lut_applied TEXT,
    audio_normalized INTEGER DEFAULT 0,
    crop_applied TEXT,
    caption TEXT,
    caption_ai_analysis_id INTEGER REFERENCES ai_analysis(id),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'error', 'dead')),
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exports_file_id ON exports(file_id);
CREATE INDEX IF NOT EXISTS idx_exports_couple_id ON exports(couple_id);
CREATE INDEX IF NOT EXISTS idx_exports_type ON exports(export_type);
CREATE INDEX IF NOT EXISTS idx_exports_status ON exports(status);

-- =============================================================================
-- IMPORT_QUEUE TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS import_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    file_size INTEGER,
    couple_id INTEGER REFERENCES couples(id),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'hashing', 'extracting', 'copying', 'complete', 'error', 'skipped')),
    error_message TEXT,
    progress_percent INTEGER DEFAULT 0,
    result_file_id INTEGER REFERENCES files(id),
    result_blake3 TEXT,
    was_duplicate INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_import_queue_status ON import_queue(status);
CREATE INDEX IF NOT EXISTS idx_import_queue_couple_id ON import_queue(couple_id);

-- =============================================================================
-- JOBS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
    couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 0,
    depends_on_job_id INTEGER REFERENCES jobs(id),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'error', 'dead')),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    started_at TEXT,
    completed_at TEXT,
    processing_time_ms INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_file_id ON jobs(file_id);

-- =============================================================================
-- VIEWS
-- =============================================================================

CREATE VIEW IF NOT EXISTS v_files_with_camera AS
SELECT
    f.*,
    c.name AS camera_name,
    c.medium AS camera_medium,
    c.lut_path AS camera_lut_path,
    cp.name AS couple_name,
    cp.wedding_date AS couple_wedding_date
FROM files f
LEFT JOIN cameras c ON f.camera_id = c.id
LEFT JOIN couples cp ON f.couple_id = cp.id
WHERE f.is_hidden = 0;

CREATE VIEW IF NOT EXISTS v_unmatched_files AS
SELECT
    f.*,
    cp.name AS couple_name
FROM files f
LEFT JOIN couples cp ON f.couple_id = cp.id
WHERE f.camera_id IS NULL
  AND (f.detected_make IS NOT NULL OR f.detected_model IS NOT NULL)
  AND f.is_hidden = 0;

CREATE VIEW IF NOT EXISTS v_job_summary AS
SELECT
    job_type,
    status,
    COUNT(*) AS count
FROM jobs
GROUP BY job_type, status;

-- =============================================================================
-- TRIGGERS
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS tr_files_insert_update_couple_stats
AFTER INSERT ON files
WHEN NEW.couple_id IS NOT NULL
BEGIN
    UPDATE couples
    SET
        file_count = file_count + 1,
        total_duration_seconds = total_duration_seconds + COALESCE(NEW.duration_seconds, 0),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.couple_id;
END;

CREATE TRIGGER IF NOT EXISTS tr_files_delete_update_couple_stats
AFTER DELETE ON files
WHEN OLD.couple_id IS NOT NULL
BEGIN
    UPDATE couples
    SET
        file_count = file_count - 1,
        total_duration_seconds = total_duration_seconds - COALESCE(OLD.duration_seconds, 0),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = OLD.couple_id;
END;

CREATE TRIGGER IF NOT EXISTS tr_cameras_update_timestamp
AFTER UPDATE ON cameras
BEGIN
    UPDATE cameras SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS tr_couples_update_timestamp
AFTER UPDATE ON couples
BEGIN
    UPDATE couples SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS tr_files_update_timestamp
AFTER UPDATE ON files
BEGIN
    UPDATE files SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
`;

/**
 * Default settings inserted on first run
 */
const DEFAULT_SETTINGS = `
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('storage_path', NULL),
    ('litellm_url', 'http://localhost:4000'),
    ('litellm_model_vlm', 'local-vlm'),
    ('litellm_model_llm', 'local-llm'),
    ('theme', 'system'),
    ('auto_detect_scenes', '1'),
    ('default_export_format', 'jpeg'),
    ('default_clip_codec', 'h264');
`;

/**
 * Get the default database path
 */
export function getDefaultDatabasePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'nightfox.db');
}

/**
 * Get the data directory path
 */
export function getDataDirectory(): string {
  const userDataPath = app.getPath('userData');
  const dataDir = path.join(userDataPath, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

/**
 * Initialize the database
 */
export function initializeDatabase(dbPath?: string): SqliteDatabase {
  if (db) {
    return db;
  }

  const effectivePath = dbPath || getDefaultDatabasePath();

  // Ensure directory exists
  const dbDir = path.dirname(effectivePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  console.log(`[Database] Opening database at: ${effectivePath}`);

  // Open database with WAL mode
  db = new Database(effectivePath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Run schema
  db.exec(SCHEMA_SQL);

  // Insert default settings
  db.exec(DEFAULT_SETTINGS);

  // Run migrations
  runMigrations(db);

  console.log('[Database] Initialized successfully');

  return db;
}

/**
 * Get the database instance
 */
export function getDatabase(): SqliteDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[Database] Closed');
  }
}

/**
 * Run database migrations
 */
function runMigrations(database: SqliteDatabase): void {
  // Create migrations table if it doesn't exist
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Get applied migrations
  const applied = new Set(
    database.prepare('SELECT id FROM migrations').all().map((row: any) => row.id)
  );

  // Define migrations
  const migrations: Array<{ id: number; name: string; sql: string }> = [
    // Migration 1: Add couple export fields
    {
      id: 1,
      name: 'add_couple_export_fields',
      sql: `
        -- Add JSON export tracking to couples
        ALTER TABLE couples ADD COLUMN last_export_at TEXT;
        ALTER TABLE couples ADD COLUMN export_path TEXT;
      `,
    },
    // Migration 2: Add file thumbnail path
    {
      id: 2,
      name: 'add_file_thumbnail',
      sql: `
        ALTER TABLE files ADD COLUMN thumbnail_path TEXT;
      `,
    },
    // Migration 3: Add scene thumbnail
    {
      id: 3,
      name: 'add_scene_thumbnail',
      sql: `
        ALTER TABLE scenes ADD COLUMN thumbnail_path TEXT;
      `,
    },
    // Migration 4: Add camera make/model/is_default
    {
      id: 4,
      name: 'add_camera_make_model_default',
      sql: `
        ALTER TABLE cameras ADD COLUMN make TEXT;
        ALTER TABLE cameras ADD COLUMN model TEXT;
        ALTER TABLE cameras ADD COLUMN is_default INTEGER DEFAULT 0;
      `,
    },
    // Migration 5: Add scene caption and wedding_moment fields
    {
      id: 5,
      name: 'add_scene_caption_fields',
      sql: `
        ALTER TABLE scenes ADD COLUMN caption TEXT;
        ALTER TABLE scenes ADD COLUMN wedding_moment TEXT;
      `,
    },
    // Migration 6: Add wedding photography CMS tables
    {
      id: 6,
      name: 'add_wedding_cms_tables',
      sql: `
        -- Wedding Photography Tracking Table
        CREATE TABLE IF NOT EXISTS weddings (
            id TEXT PRIMARY KEY NOT NULL,
            partner_a_name TEXT NOT NULL,
            partner_b_name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            wedding_date TEXT NOT NULL,
            venue_name TEXT,
            venue_city TEXT,
            venue_state TEXT,
            status TEXT DEFAULT 'imported' CHECK (status IN ('imported', 'culling', 'editing', 'delivered', 'archived')),
            date_imported TEXT DEFAULT CURRENT_TIMESTAMP,
            date_culling_started TEXT,
            date_editing_started TEXT,
            date_delivered TEXT,
            date_archived TEXT,
            total_images INTEGER DEFAULT 0,
            culled_images INTEGER DEFAULT 0,
            edited_images INTEGER DEFAULT 0,
            delivered_images INTEGER DEFAULT 0,
            source_path TEXT,
            working_path TEXT,
            delivery_path TEXT,
            package_name TEXT,
            contracted_images INTEGER,
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_weddings_status ON weddings(status);
        CREATE INDEX IF NOT EXISTS idx_weddings_date ON weddings(wedding_date);
        CREATE INDEX IF NOT EXISTS idx_weddings_display_name ON weddings(display_name);

        -- Wedding Status History Table
        CREATE TABLE IF NOT EXISTS wedding_status_history (
            id TEXT PRIMARY KEY NOT NULL,
            wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
            from_status TEXT,
            to_status TEXT NOT NULL,
            changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            notes TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_wedding_status_history_wedding ON wedding_status_history(wedding_id);

        -- Wedding Tags Table
        CREATE TABLE IF NOT EXISTS wedding_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            UNIQUE(wedding_id, tag)
        );

        CREATE INDEX IF NOT EXISTS idx_wedding_tags_wedding ON wedding_tags(wedding_id);
        CREATE INDEX IF NOT EXISTS idx_wedding_tags_tag ON wedding_tags(tag);

        -- Trigger to update weddings.updated_at
        CREATE TRIGGER IF NOT EXISTS tr_weddings_update_timestamp
        AFTER UPDATE ON weddings
        BEGIN
            UPDATE weddings SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END;
      `,
    },
  ];

  // Apply pending migrations
  for (const migration of migrations) {
    if (!applied.has(migration.id)) {
      console.log(`[Database] Applying migration ${migration.id}: ${migration.name}`);
      try {
        database.exec(migration.sql);
        database
          .prepare('INSERT INTO migrations (id, name) VALUES (?, ?)')
          .run(migration.id, migration.name);
      } catch (error) {
        // Some migrations may fail if columns already exist - that's OK
        console.log(`[Database] Migration ${migration.id} skipped (may already be applied)`);
        database
          .prepare('INSERT OR IGNORE INTO migrations (id, name) VALUES (?, ?)')
          .run(migration.id, migration.name);
      }
    }
  }
}

/**
 * Get database statistics
 */
export function getDatabaseStats(): {
  tables: number;
  totalRows: number;
  sizeBytes: number;
} {
  const database = getDatabase();

  // Count tables
  const tables = database
    .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .get() as { count: number };

  // Count total rows across main tables
  const mainTables = ['settings', 'cameras', 'camera_patterns', 'couples', 'files', 'scenes', 'exports', 'jobs'];
  let totalRows = 0;

  for (const table of mainTables) {
    try {
      const result = database.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
      totalRows += result.count;
    } catch {
      // Table may not exist yet
    }
  }

  // Get database file size
  const dbPath = getDefaultDatabasePath();
  let sizeBytes = 0;
  if (fs.existsSync(dbPath)) {
    sizeBytes = fs.statSync(dbPath).size;
  }

  return {
    tables: tables.count,
    totalRows,
    sizeBytes,
  };
}
