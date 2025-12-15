-- Nightfox Films Database Schema
-- Version: 1.0.0
--
-- This is the complete database schema for Nightfox Films.
-- Use this as reference - the actual schema is managed via migrations in database.ts
--
-- BLAKE3 Hash Format: 16 lowercase hex characters (64-bit output)
-- Example: "a7f3b2c1e9d4f086"

-- =============================================================================
-- SETTINGS TABLE
-- =============================================================================
-- Key-value store for application settings
-- All settings have sensible defaults in the application code

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Default settings (inserted on first run)
-- storage_path: Base path for managed files
-- litellm_url: LiteLLM proxy URL (default: http://localhost:4000)
-- litellm_model_vlm: Vision-language model alias
-- litellm_model_llm: Text model alias
-- theme: 'light' | 'dark' | 'system'

-- =============================================================================
-- CAMERAS TABLE
-- =============================================================================
-- Camera profiles for automatic file matching and processing

CREATE TABLE IF NOT EXISTS cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                          -- Human-readable name: "Canon HV20"
    medium TEXT NOT NULL CHECK (medium IN ('dadcam', 'super8', 'modern')),
    notes TEXT,                                   -- Free-form notes about quirks

    -- Technical defaults
    lut_path TEXT,                               -- Path to LUT file (relative to luts/)
    deinterlace INTEGER DEFAULT 0,              -- 0=false, 1=true
    audio_channels TEXT DEFAULT 'stereo',       -- 'stereo' | 'mono' | 'none'

    -- Quality profile
    sharpness_baseline REAL,                    -- Expected Laplacian variance for "good"
    transcode_preset TEXT,                      -- 'prores_hq' | 'h265_high' | etc.

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- CAMERA_PATTERNS TABLE
-- =============================================================================
-- File matching patterns for cameras (priority order: filename > folder > extension)

CREATE TABLE IF NOT EXISTS camera_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    pattern_type TEXT NOT NULL CHECK (pattern_type IN ('filename', 'folder', 'extension')),
    pattern TEXT NOT NULL,                       -- Glob pattern: "*.MTS", "**/AVCHD/**"
    priority INTEGER DEFAULT 0,                  -- Higher = checked first

    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_camera_patterns_camera_id ON camera_patterns(camera_id);
CREATE INDEX IF NOT EXISTS idx_camera_patterns_priority ON camera_patterns(priority DESC);

-- =============================================================================
-- COUPLES TABLE
-- =============================================================================
-- Wedding couples/projects

CREATE TABLE IF NOT EXISTS couples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                          -- "Smith-Jones"
    wedding_date TEXT,                           -- ISO8601 date: "2024-06-15"
    folder_name TEXT,                            -- Auto-generated: "2024-06-15-smith-jones"
    notes TEXT,                                   -- Free-form notes

    -- Stats (denormalized for fast queries)
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
-- Core table for all imported video files
-- Primary key is BLAKE3 hash (16-char hex)

CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blake3 TEXT UNIQUE NOT NULL,                 -- BLAKE3 16-char hex (primary identifier)

    -- Original file info
    original_filename TEXT NOT NULL,             -- User's original filename
    original_path TEXT,                          -- Where it was imported from
    managed_path TEXT,                           -- Where we copied it to (relative to storage_path)
    extension TEXT NOT NULL,                     -- Lowercase: ".mp4", ".mts"
    file_size INTEGER,                           -- Bytes

    -- Relationships
    couple_id INTEGER REFERENCES couples(id) ON DELETE SET NULL,
    camera_id INTEGER REFERENCES cameras(id) ON DELETE SET NULL,  -- NULL = unmatched

    -- Camera detection fallback (when camera_id is NULL)
    detected_make TEXT,                          -- From EXIF: "Canon", "JVC"
    detected_model TEXT,                         -- From EXIF: "HV20", "Everio"

    -- Classification
    medium TEXT CHECK (medium IN ('dadcam', 'super8', 'modern')),
    file_type TEXT CHECK (file_type IN ('video', 'sidecar', 'audio', 'other')),

    -- Denormalized video info (for fast queries)
    duration_seconds REAL,
    width INTEGER,
    height INTEGER,
    frame_rate REAL,
    codec TEXT,
    bitrate INTEGER,

    -- Processing status
    is_processed INTEGER DEFAULT 0,              -- 0=pending, 1=complete
    is_hidden INTEGER DEFAULT 0,                 -- 0=visible, 1=hidden (e.g., sidecar)

    -- Timestamps
    recorded_at TEXT,                            -- When video was recorded (from metadata)
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
-- Full metadata dumps (exiftool + ffprobe JSON)
-- Stored separately to keep files table lean

CREATE TABLE IF NOT EXISTS file_metadata (
    file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    exiftool_json TEXT,                          -- Full exiftool -json output
    ffprobe_json TEXT,                           -- Full ffprobe -print_format json output
    extracted_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- FILE_SIDECARS TABLE
-- =============================================================================
-- Links video files to their sidecar files (.TOD <-> .MOI, etc.)

CREATE TABLE IF NOT EXISTS file_sidecars (
    video_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    sidecar_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    sidecar_type TEXT,                           -- 'moi', 'lrf', 'thm', 'srt', 'xml'
    PRIMARY KEY (video_file_id, sidecar_file_id)
);

CREATE INDEX IF NOT EXISTS idx_file_sidecars_video ON file_sidecars(video_file_id);
CREATE INDEX IF NOT EXISTS idx_file_sidecars_sidecar ON file_sidecars(sidecar_file_id);

-- =============================================================================
-- SCENES TABLE
-- =============================================================================
-- Detected scenes within video files

CREATE TABLE IF NOT EXISTS scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,

    -- Timing
    scene_number INTEGER NOT NULL,               -- 1-indexed within file
    start_time REAL NOT NULL,                    -- Seconds from start
    end_time REAL NOT NULL,                      -- Seconds from start
    duration REAL NOT NULL,                      -- end_time - start_time

    -- Frame info
    start_frame INTEGER,
    end_frame INTEGER,

    -- Detection info
    detection_method TEXT,                       -- 'content' | 'adaptive' | 'threshold'
    confidence REAL,                             -- 0.0 - 1.0

    -- Best frame selection
    best_frame_number INTEGER,                   -- Sharpest frame in scene
    best_frame_sharpness REAL,                   -- Laplacian variance
    best_frame_path TEXT,                        -- Exported frame path

    -- Classification (optional)
    scene_type TEXT,                             -- 'ceremony', 'reception', 'dance', etc.

    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scenes_file_id ON scenes(file_id);
CREATE INDEX IF NOT EXISTS idx_scenes_timing ON scenes(file_id, start_time);

-- =============================================================================
-- AI_ANALYSIS TABLE
-- =============================================================================
-- AI-generated analysis results with full attribution

CREATE TABLE IF NOT EXISTS ai_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
    scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,

    -- Analysis type
    analysis_type TEXT NOT NULL,                 -- 'caption', 'description', 'tags', 'faces'

    -- Results
    result_json TEXT NOT NULL,                   -- Full result as JSON

    -- Attribution (REQUIRED per CLAUDE.md)
    model_name TEXT NOT NULL,                    -- "qwen2-vl:7b", "gpt-4o", etc.
    provider_name TEXT NOT NULL,                 -- "ollama", "openai" (via LiteLLM)
    confidence REAL,                             -- 0.0 - 1.0 if model provides it

    -- Audit
    prompt_used TEXT,                            -- For debugging/reproduction
    processing_time_ms INTEGER,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_file_id ON ai_analysis(file_id);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_scene_id ON ai_analysis(scene_id);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_type ON ai_analysis(analysis_type);

-- =============================================================================
-- EXPORTS TABLE
-- =============================================================================
-- Generated assets (screenshots, clips)

CREATE TABLE IF NOT EXISTS exports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
    scene_id INTEGER REFERENCES scenes(id) ON DELETE SET NULL,
    couple_id INTEGER REFERENCES couples(id) ON DELETE SET NULL,

    -- Export type
    export_type TEXT NOT NULL CHECK (export_type IN ('screenshot', 'clip')),

    -- Output info
    output_path TEXT NOT NULL,                   -- Relative to exports folder
    output_format TEXT,                          -- 'jpeg', 'png', 'mp4', 'mov'

    -- Dimensions
    width INTEGER,
    height INTEGER,
    aspect_ratio TEXT,                           -- '16:9', '9:16', '1:1', '4:5'

    -- For clips only
    start_time REAL,
    end_time REAL,
    duration REAL,

    -- Processing applied
    lut_applied TEXT,                            -- LUT filename if applied
    audio_normalized INTEGER DEFAULT 0,          -- 0=no, 1=yes
    crop_applied TEXT,                           -- JSON: {"x":0,"y":0,"w":1080,"h":1920}

    -- Caption (if AI-generated)
    caption TEXT,
    caption_ai_analysis_id INTEGER REFERENCES ai_analysis(id),

    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'error')),
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
-- Tracks import progress for large batches

CREATE TABLE IF NOT EXISTS import_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Source info
    source_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    file_size INTEGER,

    -- Target
    couple_id INTEGER REFERENCES couples(id),

    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'hashing', 'extracting', 'copying', 'complete', 'error', 'skipped')),
    error_message TEXT,

    -- Progress tracking
    progress_percent INTEGER DEFAULT 0,

    -- Result
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
-- Background job queue for processing tasks

CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Job definition
    job_type TEXT NOT NULL,                      -- 'scene_detection', 'sharpness', 'export', etc.
    payload_json TEXT NOT NULL,                  -- Job-specific parameters

    -- Targeting
    file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
    couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,

    -- Scheduling
    priority INTEGER DEFAULT 0,                  -- Higher = process first
    depends_on_job_id INTEGER REFERENCES jobs(id),

    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'error', 'dead')),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,

    -- Timing
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

-- Files with camera info (for listing)
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

-- Unmatched files (camera_id is NULL but has detected make/model)
CREATE VIEW IF NOT EXISTS v_unmatched_files AS
SELECT
    f.*,
    cp.name AS couple_name
FROM files f
LEFT JOIN couples cp ON f.couple_id = cp.id
WHERE f.camera_id IS NULL
  AND (f.detected_make IS NOT NULL OR f.detected_model IS NOT NULL)
  AND f.is_hidden = 0;

-- Pending jobs summary
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

-- Update couple file count on insert
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

-- Update couple file count on delete
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

-- Update timestamps on cameras
CREATE TRIGGER IF NOT EXISTS tr_cameras_update_timestamp
AFTER UPDATE ON cameras
BEGIN
    UPDATE cameras SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Update timestamps on couples
CREATE TRIGGER IF NOT EXISTS tr_couples_update_timestamp
AFTER UPDATE ON couples
BEGIN
    UPDATE couples SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Update timestamps on files
CREATE TRIGGER IF NOT EXISTS tr_files_update_timestamp
AFTER UPDATE ON files
BEGIN
    UPDATE files SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- =============================================================================
-- INITIAL DATA
-- =============================================================================

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('storage_path', NULL),
    ('litellm_url', 'http://localhost:4000'),
    ('litellm_model_vlm', 'local-vlm'),
    ('litellm_model_llm', 'local-llm'),
    ('theme', 'system'),
    ('auto_detect_scenes', '1'),
    ('default_export_format', 'jpeg'),
    ('default_clip_codec', 'h264');

-- Example camera profiles (commented out - user creates their own)
-- INSERT INTO cameras (name, medium, notes) VALUES
--     ('Canon HV20', 'dadcam', 'MiniDV camera, 1080i AVCHD');
-- INSERT INTO camera_patterns (camera_id, pattern_type, pattern, priority) VALUES
--     (1, 'extension', '.mts', 10),
--     (1, 'folder', '**/AVCHD/**', 5);
