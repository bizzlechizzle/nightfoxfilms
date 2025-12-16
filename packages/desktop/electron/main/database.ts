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
import { seedCameras } from '../data/camera-seeds';
import { seedCouples } from '../data/couples-seeds';
import { seedLenses } from '../data/lenses-seeds';
import { seedEquipment } from '../data/equipment-seeds';
import { seedFilmStock } from '../data/film-stock-seeds';
import { seedProcessingLabs } from '../data/processing-labs-seeds';

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

  // Seed pre-trained cameras (only adds if they don't exist)
  const cameraResult = seedCameras(db);
  if (cameraResult.added > 0) {
    console.log(`[Database] Seeded ${cameraResult.added} pre-trained cameras`);
  }

  // Seed historical couples (only adds if they don't exist)
  const coupleResult = seedCouples(db);
  if (coupleResult.added > 0) {
    console.log(`[Database] Seeded ${coupleResult.added} historical couples`);
  }

  // Seed known lenses (only adds if they don't exist)
  const lensResult = seedLenses(db);
  if (lensResult.added > 0) {
    console.log(`[Database] Seeded ${lensResult.added} known lenses`);
  }

  // Seed equipment inventory (only adds if they don't exist)
  const equipmentResult = seedEquipment(db);
  if (equipmentResult.added > 0) {
    console.log(`[Database] Seeded ${equipmentResult.added} equipment items`);
  }

  // Seed film stock types (only adds if they don't exist)
  const filmStockResult = seedFilmStock(db);
  if (filmStockResult.added > 0) {
    console.log(`[Database] Seeded ${filmStockResult.added} film stock types`);
  }

  // Seed processing labs (only adds if they don't exist)
  const labsResult = seedProcessingLabs(db);
  if (labsResult.added > 0) {
    console.log(`[Database] Seeded ${labsResult.added} processing labs`);
  }

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
    // Migration 6: Add wedding videography CMS tables
    {
      id: 6,
      name: 'add_wedding_cms_tables',
      sql: `
        -- Wedding Videography Tracking Table
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
    // Migration 7: Enhance couples table with workflow tracking (replaces photography CMS)
    {
      id: 7,
      name: 'enhance_couples_workflow',
      sql: `
        -- Add workflow status to couples
        ALTER TABLE couples ADD COLUMN status TEXT DEFAULT 'booked' CHECK (status IN ('booked', 'shot', 'ingested', 'editing', 'delivered', 'archived'));

        -- Add contact info
        ALTER TABLE couples ADD COLUMN email TEXT;
        ALTER TABLE couples ADD COLUMN phone TEXT;

        -- Add venue info
        ALTER TABLE couples ADD COLUMN venue_name TEXT;
        ALTER TABLE couples ADD COLUMN venue_city TEXT;
        ALTER TABLE couples ADD COLUMN venue_state TEXT;

        -- Add workflow timestamps
        ALTER TABLE couples ADD COLUMN date_shot TEXT;
        ALTER TABLE couples ADD COLUMN date_ingested TEXT;
        ALTER TABLE couples ADD COLUMN date_editing_started TEXT;
        ALTER TABLE couples ADD COLUMN date_delivered TEXT;
        ALTER TABLE couples ADD COLUMN date_archived TEXT;

        -- Add path tracking
        ALTER TABLE couples ADD COLUMN source_path TEXT;
        ALTER TABLE couples ADD COLUMN working_path TEXT;
        ALTER TABLE couples ADD COLUMN delivery_path TEXT;

        -- Add package info
        ALTER TABLE couples ADD COLUMN package_name TEXT;
        ALTER TABLE couples ADD COLUMN contracted_deliverables INTEGER;

        -- Add index for status queries
        CREATE INDEX IF NOT EXISTS idx_couples_status ON couples(status);
      `,
    },
    // Migration 8: Add lens tracking and camera categories
    {
      id: 8,
      name: 'add_lens_tracking_and_camera_category',
      sql: `
        -- Add category to cameras (cinema, professional, hybrid, action, consumer, drone, smartphone)
        ALTER TABLE cameras ADD COLUMN category TEXT DEFAULT 'hybrid' CHECK (category IN ('cinema', 'professional', 'hybrid', 'action', 'consumer', 'drone', 'smartphone'));

        -- Add detected_lens to files (extracted from XML sidecar metadata)
        ALTER TABLE files ADD COLUMN detected_lens TEXT;

        -- Create lenses table for lens inventory
        CREATE TABLE IF NOT EXISTS lenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            make TEXT,
            model TEXT,
            focal_length TEXT,
            aperture TEXT,
            mount TEXT,
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_lenses_make ON lenses(make);
        CREATE INDEX IF NOT EXISTS idx_lenses_mount ON lenses(mount);
        CREATE INDEX IF NOT EXISTS idx_files_detected_lens ON files(detected_lens);

        -- Trigger to update lenses.updated_at
        CREATE TRIGGER IF NOT EXISTS tr_lenses_update_timestamp
        AFTER UPDATE ON lenses
        BEGIN
            UPDATE lenses SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END;
      `,
    },
    // Migration 9: Camera profile enhancements
    {
      id: 9,
      name: 'camera_profile_enhancements',
      sql: `
        -- Add nickname for user-friendly display name
        ALTER TABLE cameras ADD COLUMN nickname TEXT;

        -- Add filename pattern for per-camera export naming
        ALTER TABLE cameras ADD COLUMN filename_pattern TEXT;

        -- Add serial number to differentiate identical camera models
        ALTER TABLE cameras ADD COLUMN serial_number TEXT;

        -- Add color profile (gamma) for LUT suggestions
        ALTER TABLE cameras ADD COLUMN color_profile TEXT;

        -- Add color for UI identification
        ALTER TABLE cameras ADD COLUMN color TEXT;

        -- Add active flag to hide old cameras without deleting
        ALTER TABLE cameras ADD COLUMN is_active INTEGER DEFAULT 1;

        -- Index for serial number lookups (matching files to cameras)
        CREATE INDEX IF NOT EXISTS idx_cameras_serial ON cameras(serial_number);

        -- Index for active cameras
        CREATE INDEX IF NOT EXISTS idx_cameras_active ON cameras(is_active);
      `,
    },
    // Migration 10: Clean up category garbage from camera notes
    {
      id: 10,
      name: 'cleanup_camera_notes',
      sql: `
        -- Remove "Category: X. " prefix from notes
        UPDATE cameras
        SET notes = TRIM(
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(
                  REPLACE(
                    REPLACE(
                      REPLACE(
                        REPLACE(notes, 'Category: cinema. ', ''),
                        'Category: professional. ', ''),
                      'Category: hybrid. ', ''),
                    'Category: action. ', ''),
                  'Category: consumer. ', ''),
                'Category: drone. ', ''),
              'Category: smartphone. ', ''),
            'Category: unknown. ', '')
        )
        WHERE notes LIKE 'Category:%';

        -- Also handle capitalized versions (Prosumer, etc)
        UPDATE cameras
        SET notes = TRIM(
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(
                  REPLACE(
                    REPLACE(
                      REPLACE(
                        REPLACE(
                          REPLACE(notes, 'Category: Cinema. ', ''),
                          'Category: Professional. ', ''),
                        'Category: Hybrid. ', ''),
                      'Category: Prosumer. ', ''),
                    'Category: Action. ', ''),
                  'Category: Consumer. ', ''),
                'Category: Drone. ', ''),
              'Category: Smartphone. ', ''),
            'Category: Unknown. ', '')
        )
        WHERE notes LIKE 'Category:%';

        -- Clean up any remaining category patterns
        UPDATE cameras
        SET notes = NULL
        WHERE notes = '' OR notes LIKE 'Auto-trained from % sample files.';
      `,
    },
    // Migration 11: Add couple detail fields for dashboard redesign
    {
      id: 11,
      name: 'add_couple_detail_fields',
      sql: `
        -- Due date for delivery deadline
        ALTER TABLE couples ADD COLUMN due_date TEXT;

        -- Social media
        ALTER TABLE couples ADD COLUMN instagram TEXT;
        ALTER TABLE couples ADD COLUMN social_media_json TEXT;

        -- Deliverables tracking (JSON array of items with status)
        ALTER TABLE couples ADD COLUMN deliverables_json TEXT;

        -- Email/communication log
        ALTER TABLE couples ADD COLUMN email_log_json TEXT;

        -- Custom turnaround days (default 180 = 6 months)
        ALTER TABLE couples ADD COLUMN turnaround_days INTEGER DEFAULT 180;

        -- Calculate due_date for existing couples without one
        -- Due date = wedding_date + turnaround_days
        UPDATE couples
        SET due_date = date(wedding_date, '+120 days')
        WHERE due_date IS NULL AND wedding_date IS NOT NULL;
      `,
    },
    // Migration 12: Fix turnaround days from 120 to 180 (6 months)
    {
      id: 12,
      name: 'fix_turnaround_days_180',
      sql: `
        -- Update default turnaround to 180 days for all couples using old default
        UPDATE couples SET turnaround_days = 180 WHERE turnaround_days = 120;

        -- Recalculate all due dates based on 180 day turnaround
        UPDATE couples
        SET due_date = date(wedding_date, '+180 days')
        WHERE wedding_date IS NOT NULL;
      `,
    },
    // Migration 13: Mark all weddings before Sep 14, 2025 as delivered
    {
      id: 13,
      name: 'mark_past_weddings_delivered',
      sql: `
        UPDATE couples
        SET status = 'delivered'
        WHERE wedding_date IS NOT NULL
          AND wedding_date >= '1970-01-01'
          AND wedding_date <= '2025-09-13';
      `,
    },
    // Migration 14: Remove 'shot' status - convert to 'ingested', mark recent weddings as ingested
    {
      id: 14,
      name: 'remove_shot_status',
      sql: `
        -- Convert any 'shot' status to 'ingested' (shot status is being removed)
        UPDATE couples
        SET status = 'ingested'
        WHERE status = 'shot';

        -- Mark weddings from Sep 14, 2025 through Dec 15, 2025 as ingested
        UPDATE couples
        SET status = 'ingested'
        WHERE wedding_date IS NOT NULL
          AND wedding_date >= '2025-09-14'
          AND wedding_date <= '2025-12-15'
          AND status NOT IN ('delivered', 'archived');
      `,
    },
    // Migration 15: Add contract fields and update Julia & Sven with contract data
    {
      id: 15,
      name: 'add_contract_fields_and_julia_sven',
      sql: `
        -- Add videographer count (1 or 2)
        ALTER TABLE couples ADD COLUMN videographer_count INTEGER DEFAULT 1;

        -- Add mediums JSON array (e.g., '["modern"]' or '["super8", "dadcam", "modern"]')
        ALTER TABLE couples ADD COLUMN mediums_json TEXT;

        -- Add package price in dollars
        ALTER TABLE couples ADD COLUMN package_price INTEGER;

        -- Update Julia & Sven with full contract data
        UPDATE couples
        SET
          videographer_count = 2,
          mediums_json = '["modern"]',
          package_price = 3400,
          package_name = 'Modern Digital (Two Videographers)',
          venue_name = 'Pearl Street Grill and Brewery',
          venue_city = 'Buffalo',
          venue_state = 'NY',
          phone = '7169014672',
          contracted_deliverables = 3,
          deliverables_json = '[{"code":"highlight_modern","category":"edit","name":"2-4 Minute Highlight Film","medium":"modern","status":"pending"},{"code":"ceremony_speeches_uncut","category":"timeline","name":"Uncut Ceremony & Speeches","medium":"modern","status":"pending"},{"code":"raw_modern","category":"raw","name":"Raw Footage","medium":"modern","status":"pending"}]'
        WHERE name = 'Julia & Sven' AND wedding_date = '2025-12-31';
      `,
    },
    // Migration 16: Add location fields for getting ready and ceremony
    {
      id: 16,
      name: 'add_location_fields',
      sql: `
        -- Getting ready locations (hide after wedding date)
        ALTER TABLE couples ADD COLUMN getting_ready_1_name TEXT;
        ALTER TABLE couples ADD COLUMN getting_ready_1_address TEXT;
        ALTER TABLE couples ADD COLUMN getting_ready_2_name TEXT;
        ALTER TABLE couples ADD COLUMN getting_ready_2_address TEXT;

        -- Ceremony venue (if different from reception)
        ALTER TABLE couples ADD COLUMN ceremony_venue_name TEXT;
        ALTER TABLE couples ADD COLUMN ceremony_venue_address TEXT;
      `,
    },
    // Migration 17: Add venue_address and phone_2 fields, update Julia & Sven
    {
      id: 17,
      name: 'add_venue_address_phone_2',
      sql: `
        -- Street address for venue
        ALTER TABLE couples ADD COLUMN venue_address TEXT;

        -- Second partner phone number
        ALTER TABLE couples ADD COLUMN phone_2 TEXT;

        -- Update Julia & Sven with contract details
        UPDATE couples
        SET
          venue_address = '76 Pearl Street',
          phone_2 = '7742671370'
        WHERE name = 'Julia & Sven' AND wedding_date = '2025-12-31';
      `,
    },
    // Migration 18: Add partner contact fields
    {
      id: 18,
      name: 'add_partner_contact_fields',
      sql: `
        -- Partner 1 contact info
        ALTER TABLE couples ADD COLUMN partner_1_name TEXT;
        ALTER TABLE couples ADD COLUMN partner_1_email TEXT;
        ALTER TABLE couples ADD COLUMN partner_1_instagram TEXT;

        -- Partner 2 contact info
        ALTER TABLE couples ADD COLUMN partner_2_name TEXT;
        ALTER TABLE couples ADD COLUMN partner_2_email TEXT;
        ALTER TABLE couples ADD COLUMN partner_2_instagram TEXT;

        -- Shared mailing address
        ALTER TABLE couples ADD COLUMN mailing_address TEXT;

        -- Update Julia & Sven with partner details from contract
        UPDATE couples
        SET
          partner_1_name = 'Julia Bartsch',
          partner_2_name = 'Sven Patterson',
          mailing_address = '65 Cambridge Rd, Hilton, NY 15568'
        WHERE name = 'Julia & Sven' AND wedding_date = '2025-12-31';
      `,
    },
    // Migration 19: Add date_night_date field for engagement sessions
    {
      id: 19,
      name: 'add_date_night_date',
      sql: `
        -- Date night / engagement session date (shown in timeline before wedding)
        ALTER TABLE couples ADD COLUMN date_night_date TEXT;

        -- Update Julia & Sven to include Date Night in deliverables
        UPDATE couples
        SET deliverables_json = '[{"code":"highlight_modern","category":"edit","name":"2-4 Minute Highlight Film","medium":"modern","status":"pending"},{"code":"ceremony_speeches_uncut","category":"timeline","name":"Uncut Ceremony & Speeches","medium":"modern","status":"pending"},{"code":"raw_modern","category":"raw","name":"Raw Footage","medium":"modern","status":"pending"},{"code":"session_datenight","category":"session","name":"Date Night","medium":null,"status":"pending"}]'
        WHERE name = 'Julia & Sven' AND wedding_date = '2025-12-31';
      `,
    },
    // Migration 20: Add footage_type field to files for categorization
    {
      id: 20,
      name: 'add_footage_type',
      sql: `
        -- Footage type based on recording date vs couple's key dates
        -- Values: 'date_night', 'rehearsal', 'wedding', 'other'
        ALTER TABLE files ADD COLUMN footage_type TEXT DEFAULT 'other';
      `,
    },
    // Migration 21: Ensure Julia & Sven have complete deliverables (fixes existing databases)
    {
      id: 21,
      name: 'fix_julia_sven_deliverables',
      sql: `
        -- Force update Julia & Sven deliverables with Date Night included
        UPDATE couples
        SET
          deliverables_json = '[{"code":"highlight_modern","category":"edit","name":"2-4 Minute Highlight Film","medium":"modern","status":"pending"},{"code":"ceremony_speeches_uncut","category":"timeline","name":"Uncut Ceremony & Speeches","medium":"modern","status":"pending"},{"code":"raw_modern","category":"raw","name":"Raw Footage","medium":"modern","status":"pending"},{"code":"session_datenight","category":"session","name":"Date Night","medium":null,"status":"pending"}]',
          videographer_count = 2,
          mediums_json = '["modern"]'
        WHERE name = 'Julia & Sven';
      `,
    },
    // Migration 22: Remove ingested status - convert all ingested to editing
    {
      id: 22,
      name: 'remove_ingested_status',
      sql: `
        -- Convert all couples with ingested status to editing
        -- The ingested step is being removed from workflow
        UPDATE couples
        SET status = 'editing',
            date_editing_started = COALESCE(date_editing_started, date_ingested, CURRENT_TIMESTAMP)
        WHERE status = 'ingested';
      `,
    },
    // Migration 23: Create equipment table for physical inventory tracking
    {
      id: 23,
      name: 'create_equipment_table',
      sql: `
        CREATE TABLE IF NOT EXISTS equipment (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          equipment_type TEXT NOT NULL CHECK (equipment_type IN ('camera', 'lens', 'audio', 'lighting', 'support', 'accessory', 'media')),
          category TEXT,
          medium TEXT CHECK (medium IN ('dadcam', 'super8', 'modern')),
          camera_id INTEGER REFERENCES cameras(id) ON DELETE SET NULL,
          make TEXT,
          model TEXT,
          serial_number TEXT UNIQUE,
          purchase_date TEXT,
          purchase_price REAL,
          status TEXT DEFAULT 'available' CHECK (status IN ('available', 'loaned', 'maintenance', 'retired', 'lost')),
          loaner_eligible INTEGER DEFAULT 0,
          tutorial_url TEXT,
          image_path TEXT,
          notes TEXT,
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_equipment_type ON equipment(equipment_type);
        CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
        CREATE INDEX IF NOT EXISTS idx_equipment_medium ON equipment(medium);
        CREATE INDEX IF NOT EXISTS idx_equipment_loaner ON equipment(loaner_eligible);
        CREATE INDEX IF NOT EXISTS idx_equipment_camera_id ON equipment(camera_id);

        CREATE TRIGGER IF NOT EXISTS tr_equipment_update_timestamp
        AFTER UPDATE ON equipment
        BEGIN
          UPDATE equipment SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END;
      `,
    },
    // Migration 24: Create film_stock and processing_labs tables
    {
      id: 24,
      name: 'create_film_stock_and_labs_tables',
      sql: `
        CREATE TABLE IF NOT EXISTS film_stock (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          stock_type TEXT NOT NULL CHECK (stock_type IN ('film', 'tape')),
          format TEXT NOT NULL CHECK (format IN ('super8', 'vhs_c', 'hi8', 'minidv')),
          manufacturer TEXT,
          asa_iso INTEGER,
          is_daylight INTEGER,
          quantity_on_hand INTEGER DEFAULT 0,
          cost_per_unit REAL,
          processing_cost REAL,
          scan_cost REAL,
          footage_yield_sec INTEGER,
          expiration_date TEXT,
          storage_location TEXT,
          notes TEXT,
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_film_stock_type ON film_stock(stock_type);
        CREATE INDEX IF NOT EXISTS idx_film_stock_format ON film_stock(format);

        CREATE TRIGGER IF NOT EXISTS tr_film_stock_update_timestamp
        AFTER UPDATE ON film_stock
        BEGIN
          UPDATE film_stock SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END;

        CREATE TABLE IF NOT EXISTS processing_labs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          website TEXT,
          email TEXT,
          phone TEXT,
          address TEXT,
          turnaround_days INTEGER,
          services TEXT,
          scan_resolutions TEXT,
          scan_formats TEXT,
          your_rating INTEGER,
          notes TEXT,
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_processing_labs_active ON processing_labs(is_active);

        CREATE TRIGGER IF NOT EXISTS tr_processing_labs_update_timestamp
        AFTER UPDATE ON processing_labs
        BEGIN
          UPDATE processing_labs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END;
      `,
    },
    // Migration 25: Create camera_loans table for loan workflow
    {
      id: 25,
      name: 'create_camera_loans_table',
      sql: `
        CREATE TABLE IF NOT EXISTS camera_loans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
          couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL CHECK (event_type IN ('date_night', 'engagement', 'guest_cam')),
          status TEXT DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'preparing', 'shipped', 'delivered', 'active', 'return_shipped', 'received', 'inspected', 'completed', 'cancelled', 'lost', 'damaged')),
          requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
          approved_at TEXT,
          ship_by_date TEXT,
          event_date TEXT,
          due_back_date TEXT,
          shipped_at TEXT,
          ship_carrier TEXT,
          ship_tracking TEXT,
          delivered_at TEXT,
          return_shipped_at TEXT,
          return_carrier TEXT,
          return_tracking TEXT,
          return_received_at TEXT,
          inspected_at TEXT,
          condition_rating TEXT CHECK (condition_rating IN ('excellent', 'good', 'fair', 'damaged', 'lost')),
          condition_notes TEXT,
          media_included TEXT,
          footage_received INTEGER DEFAULT 0,
          footage_usable INTEGER DEFAULT 0,
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_camera_loans_equipment ON camera_loans(equipment_id);
        CREATE INDEX IF NOT EXISTS idx_camera_loans_couple ON camera_loans(couple_id);
        CREATE INDEX IF NOT EXISTS idx_camera_loans_status ON camera_loans(status);
        CREATE INDEX IF NOT EXISTS idx_camera_loans_event_date ON camera_loans(event_date);

        CREATE TRIGGER IF NOT EXISTS tr_camera_loans_update_timestamp
        AFTER UPDATE ON camera_loans
        BEGIN
          UPDATE camera_loans SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END;

        -- Trigger to update equipment status when loan status changes
        CREATE TRIGGER IF NOT EXISTS tr_camera_loans_update_equipment_status
        AFTER UPDATE ON camera_loans
        WHEN NEW.status != OLD.status
        BEGIN
          UPDATE equipment
          SET status = CASE
            WHEN NEW.status IN ('approved', 'preparing', 'shipped', 'delivered', 'active') THEN 'loaned'
            WHEN NEW.status IN ('completed', 'cancelled') THEN 'available'
            WHEN NEW.status = 'lost' THEN 'lost'
            ELSE status
          END
          WHERE id = NEW.equipment_id;
        END;
      `,
    },
    // Migration 26: Create film_usage table for per-project film tracking
    {
      id: 26,
      name: 'create_film_usage_table',
      sql: `
        CREATE TABLE IF NOT EXISTS film_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          film_stock_id INTEGER NOT NULL REFERENCES film_stock(id) ON DELETE CASCADE,
          couple_id INTEGER REFERENCES couples(id) ON DELETE SET NULL,
          camera_loan_id INTEGER REFERENCES camera_loans(id) ON DELETE SET NULL,
          equipment_id INTEGER REFERENCES equipment(id) ON DELETE SET NULL,
          cartridges_used INTEGER NOT NULL DEFAULT 1,
          shot_date TEXT,
          scene_notes TEXT,
          lab_id INTEGER REFERENCES processing_labs(id) ON DELETE SET NULL,
          lab_sent_at TEXT,
          lab_tracking_out TEXT,
          scans_received_at TEXT,
          scans_download_url TEXT,
          physical_received_at TEXT,
          lab_tracking_return TEXT,
          scan_resolution TEXT,
          scan_format TEXT,
          scan_asset_ids TEXT,
          total_cost REAL,
          issues TEXT,
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_film_usage_stock ON film_usage(film_stock_id);
        CREATE INDEX IF NOT EXISTS idx_film_usage_couple ON film_usage(couple_id);
        CREATE INDEX IF NOT EXISTS idx_film_usage_loan ON film_usage(camera_loan_id);
        CREATE INDEX IF NOT EXISTS idx_film_usage_lab ON film_usage(lab_id);

        CREATE TRIGGER IF NOT EXISTS tr_film_usage_update_timestamp
        AFTER UPDATE ON film_usage
        BEGIN
          UPDATE film_usage SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END;

        -- Trigger to decrement film stock when usage is recorded
        CREATE TRIGGER IF NOT EXISTS tr_film_usage_decrement_stock
        AFTER INSERT ON film_usage
        BEGIN
          UPDATE film_stock
          SET quantity_on_hand = quantity_on_hand - NEW.cartridges_used
          WHERE id = NEW.film_stock_id;
        END;
      `,
    },
    // Migration 27: Create import_sessions table for network-safe import with resume
    {
      id: 27,
      name: 'create_import_sessions_table',
      sql: `
        -- Import sessions table for tracking import progress and enabling resume
        -- Part of network-safe import system (mirrors au archive pattern)
        CREATE TABLE IF NOT EXISTS import_sessions (
          session_id TEXT PRIMARY KEY,
          couple_id INTEGER REFERENCES couples(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scanning', 'hashing', 'copying', 'validating', 'finalizing', 'completed', 'cancelled', 'failed', 'paused')),
          last_step INTEGER DEFAULT 0,
          can_resume INTEGER DEFAULT 1,
          source_paths TEXT,
          archive_path TEXT,
          total_files INTEGER DEFAULT 0,
          processed_files INTEGER DEFAULT 0,
          duplicate_files INTEGER DEFAULT 0,
          error_files INTEGER DEFAULT 0,
          total_bytes INTEGER DEFAULT 0,
          processed_bytes INTEGER DEFAULT 0,
          scan_result TEXT,
          hash_results TEXT,
          copy_results TEXT,
          validation_results TEXT,
          error TEXT,
          started_at TEXT DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_import_sessions_status ON import_sessions(status);
        CREATE INDEX IF NOT EXISTS idx_import_sessions_couple ON import_sessions(couple_id);
        CREATE INDEX IF NOT EXISTS idx_import_sessions_can_resume ON import_sessions(can_resume);
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
