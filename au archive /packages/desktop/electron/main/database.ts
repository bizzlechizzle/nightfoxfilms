import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { Database as DatabaseSchema } from './database.types';
import { getEffectiveDatabasePath, getDefaultDatabasePath } from '../services/bootstrap-config';

let db: Kysely<DatabaseSchema> | null = null;
let sqliteDb: SqliteDatabase | null = null;

/**
 * Database schema SQL - embedded to avoid bundling issues with Vite
 * This schema is kept in sync with schema.sql for reference
 */
const SCHEMA_SQL = `
-- AU Archive Database Schema
-- SQLite database for local-first abandoned location archive

-- Locations table (primary entity)
-- ADR-046: locid is BLAKE3 16-char hash (not UUID, no separate loc12)
CREATE TABLE IF NOT EXISTS locs (
  -- Identity (BLAKE3 16-char hash)
  locid TEXT PRIMARY KEY CHECK(length(locid) = 16),

  -- Basic Info
  locnam TEXT NOT NULL,
  slocnam TEXT,
  akanam TEXT,

  -- Classification
  category TEXT,
  class TEXT,

  -- GPS (Primary Source of Truth)
  gps_lat REAL,
  gps_lng REAL,
  gps_accuracy REAL,
  gps_source TEXT,
  gps_verified_on_map INTEGER DEFAULT 0,
  gps_captured_at TEXT,
  gps_leaflet_data TEXT,

  -- Address (Secondary, Optional)
  address_street TEXT,
  address_city TEXT,
  address_county TEXT,
  address_state TEXT CHECK(length(address_state) = 2),
  address_zipcode TEXT,
  address_confidence TEXT,
  address_geocoded_at TEXT,

  -- Status
  condition TEXT,
  status TEXT,
  documentation TEXT,
  access TEXT,
  historic INTEGER DEFAULT 0,
  favorite INTEGER DEFAULT 0,

  -- Relationships
  sublocs TEXT,

  -- Metadata
  locadd TEXT,
  locup TEXT,
  auth_imp TEXT,

  -- Regions
  regions TEXT,
  state TEXT
);

CREATE INDEX IF NOT EXISTS idx_locs_state ON locs(address_state);
CREATE INDEX IF NOT EXISTS idx_locs_category ON locs(category);
CREATE INDEX IF NOT EXISTS idx_locs_gps ON locs(gps_lat, gps_lng) WHERE gps_lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_locs_favorite ON locs(favorite) WHERE favorite = 1;
-- OPT-043: Covering index for ultra-fast Atlas map queries
-- Includes all columns needed by findInBoundsForMap to avoid table lookups
CREATE INDEX IF NOT EXISTS idx_locs_map_bounds ON locs(gps_lat, gps_lng, locid, locnam, category, gps_verified_on_map, address_state, address_city, favorite)
  WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL;

-- Sub-Locations table
-- ADR-046: subid is BLAKE3 16-char hash (not UUID, no separate sub12)
CREATE TABLE IF NOT EXISTS slocs (
  subid TEXT PRIMARY KEY CHECK(length(subid) = 16),
  locid TEXT NOT NULL REFERENCES locs(locid) ON DELETE CASCADE,

  subnam TEXT NOT NULL,
  ssubname TEXT,

  UNIQUE(subnam, locid)
);

CREATE INDEX IF NOT EXISTS idx_slocs_locid ON slocs(locid);

-- Images table
CREATE TABLE IF NOT EXISTS imgs (
  imghash TEXT PRIMARY KEY,
  imgnam TEXT NOT NULL,
  imgnamo TEXT NOT NULL,
  imgloc TEXT NOT NULL,
  imgloco TEXT NOT NULL,

  locid TEXT REFERENCES locs(locid),
  subid TEXT REFERENCES slocs(subid),

  auth_imp TEXT,
  imgadd TEXT,

  meta_exiftool TEXT,

  -- Extracted metadata (for quick access)
  meta_width INTEGER,
  meta_height INTEGER,
  meta_date_taken TEXT,
  meta_camera_make TEXT,
  meta_camera_model TEXT,
  meta_gps_lat REAL,
  meta_gps_lng REAL
);

CREATE INDEX IF NOT EXISTS idx_imgs_locid ON imgs(locid);
CREATE INDEX IF NOT EXISTS idx_imgs_subid ON imgs(subid);
CREATE INDEX IF NOT EXISTS idx_imgs_hash ON imgs(imghash);

-- Videos table
CREATE TABLE IF NOT EXISTS vids (
  vidhash TEXT PRIMARY KEY,
  vidnam TEXT NOT NULL,
  vidnamo TEXT NOT NULL,
  vidloc TEXT NOT NULL,
  vidloco TEXT NOT NULL,

  locid TEXT REFERENCES locs(locid),
  subid TEXT REFERENCES slocs(subid),

  auth_imp TEXT,
  vidadd TEXT,

  meta_ffmpeg TEXT,
  meta_exiftool TEXT,

  -- Extracted metadata
  meta_duration REAL,
  meta_width INTEGER,
  meta_height INTEGER,
  meta_codec TEXT,
  meta_fps REAL,
  meta_date_taken TEXT,
  -- FIX 3.2: GPS from video metadata (dashcams, phones)
  meta_gps_lat REAL,
  meta_gps_lng REAL
);

CREATE INDEX IF NOT EXISTS idx_vids_locid ON vids(locid);
CREATE INDEX IF NOT EXISTS idx_vids_subid ON vids(subid);

-- Documents table
CREATE TABLE IF NOT EXISTS docs (
  dochash TEXT PRIMARY KEY,
  docnam TEXT NOT NULL,
  docnamo TEXT NOT NULL,
  docloc TEXT NOT NULL,
  docloco TEXT NOT NULL,

  locid TEXT REFERENCES locs(locid),
  subid TEXT REFERENCES slocs(subid),

  auth_imp TEXT,
  docadd TEXT,

  meta_exiftool TEXT,

  -- Document-specific metadata
  meta_page_count INTEGER,
  meta_author TEXT,
  meta_title TEXT
);

CREATE INDEX IF NOT EXISTS idx_docs_locid ON docs(locid);

-- Maps table (Historical Maps)
CREATE TABLE IF NOT EXISTS maps (
  maphash TEXT PRIMARY KEY,
  mapnam TEXT NOT NULL,
  mapnamo TEXT NOT NULL,
  maploc TEXT NOT NULL,
  maploco TEXT NOT NULL,

  locid TEXT REFERENCES locs(locid),
  subid TEXT REFERENCES slocs(subid),

  auth_imp TEXT,
  mapadd TEXT,

  meta_exiftool TEXT,
  meta_map TEXT,
  -- FIX 3.4: GPS from parsed GPX/KML files
  meta_gps_lat REAL,
  meta_gps_lng REAL,

  reference TEXT,
  map_states TEXT,
  map_verified INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_maps_locid ON maps(locid);

-- Settings table (key-value store)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * Get the database file path
 * Uses custom path from bootstrap config if set, otherwise userData directory
 */
export function getDatabasePath(): string {
  return getEffectiveDatabasePath();
}

/**
 * Get the default database path (for display purposes)
 * This is the path used when no custom path is configured
 */
export function getDefaultDbPath(): string {
  return getDefaultDatabasePath();
}

/**
 * Initialize the database schema
 * Uses embedded SQL schema to avoid file bundling issues
 */
function initializeSchema(sqlite: Database.Database): void {
  const schema = SCHEMA_SQL;

  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    sqlite.exec(statement);
  }

  console.log('Database schema initialized');
}

/**
 * Check if the database has the required schema tables
 * Returns true if core tables exist, false if schema needs initialization
 */
function hasSchema(sqlite: Database.Database): boolean {
  const tables = sqlite.pragma('table_list') as Array<{ name: string }>;
  const tableNames = tables.map(t => t.name);

  // Check for core tables that must exist
  const requiredTables = ['locs', 'slocs', 'imgs', 'vids', 'docs', 'maps'];
  const hasAllRequired = requiredTables.every(t => tableNames.includes(t));

  return hasAllRequired;
}

/**
 * Run database migrations for existing databases
 * Checks for missing columns and adds them
 * Safe to call on databases that already have all migrations applied
 */
function runMigrations(sqlite: Database.Database): void {
  try {
    // Get current table list for migration checks
    const tables = sqlite.pragma('table_list') as Array<{ name: string }>;
    const tableNames = tables.map(t => t.name);

    // Safety check: core tables must exist before running migrations
    if (!tableNames.includes('locs')) {
      throw new Error('Core table "locs" missing - schema initialization required');
    }

    // Migration 1: Add favorite column if it doesn't exist
    const columns = sqlite.pragma('table_info(locs)') as Array<{ name: string }>;
    const hasFavorite = columns.some(col => col.name === 'favorite');

    if (!hasFavorite) {
      console.log('Running migration: Adding favorite column to locs table');
      sqlite.exec('ALTER TABLE locs ADD COLUMN favorite INTEGER DEFAULT 0');
      sqlite.exec('CREATE INDEX IF NOT EXISTS idx_locs_favorite ON locs(favorite) WHERE favorite = 1');
      console.log('Migration completed: favorite column added');
    }

    // Migration 2: Create imports table if it doesn't exist
    const hasImports = tableNames.includes('imports');

    if (!hasImports) {
      console.log('Running migration: Creating imports table');
      sqlite.exec(`
        CREATE TABLE imports (
          import_id TEXT PRIMARY KEY,
          locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
          import_date TEXT NOT NULL,
          auth_imp TEXT,
          img_count INTEGER DEFAULT 0,
          vid_count INTEGER DEFAULT 0,
          doc_count INTEGER DEFAULT 0,
          map_count INTEGER DEFAULT 0,
          notes TEXT
        );
        CREATE INDEX idx_imports_date ON imports(import_date DESC);
        CREATE INDEX idx_imports_locid ON imports(locid);
      `);
      console.log('Migration completed: imports table created');
    }

    // Migration 3: Create notes table if it doesn't exist
    const hasNotes = tableNames.includes('notes');

    if (!hasNotes) {
      console.log('Running migration: Creating notes table');
      sqlite.exec(`
        CREATE TABLE notes (
          note_id TEXT PRIMARY KEY,
          locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
          note_text TEXT NOT NULL,
          note_date TEXT NOT NULL,
          auth_imp TEXT,
          note_type TEXT DEFAULT 'general'
        );
        CREATE INDEX idx_notes_locid ON notes(locid);
        CREATE INDEX idx_notes_date ON notes(note_date DESC);
      `);
      console.log('Migration completed: notes table created');
    }

    // Migration 4: Create projects tables if they don't exist
    const hasProjects = tableNames.includes('projects');

    if (!hasProjects) {
      console.log('Running migration: Creating projects tables');
      sqlite.exec(`
        CREATE TABLE projects (
          project_id TEXT PRIMARY KEY,
          project_name TEXT NOT NULL UNIQUE,
          description TEXT,
          created_date TEXT NOT NULL,
          auth_imp TEXT
        );
        CREATE INDEX idx_projects_name ON projects(project_name);
        CREATE INDEX idx_projects_date ON projects(created_date DESC);

        CREATE TABLE project_locations (
          project_id TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
          locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
          added_date TEXT NOT NULL,
          PRIMARY KEY (project_id, locid)
        );
        CREATE INDEX idx_project_locations_project ON project_locations(project_id);
        CREATE INDEX idx_project_locations_location ON project_locations(locid);
      `);
      console.log('Migration completed: projects tables created');
    }

    // Migration 5: Create bookmarks table if it doesn't exist
    const hasBookmarks = tableNames.includes('bookmarks');

    if (!hasBookmarks) {
      console.log('Running migration: Creating bookmarks table');
      sqlite.exec(`
        CREATE TABLE bookmarks (
          bookmark_id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          title TEXT,
          locid TEXT REFERENCES locs(locid) ON DELETE SET NULL,
          bookmark_date TEXT NOT NULL,
          auth_imp TEXT,
          thumbnail_path TEXT
        );
        CREATE INDEX idx_bookmarks_date ON bookmarks(bookmark_date DESC);
        CREATE INDEX idx_bookmarks_locid ON bookmarks(locid);
      `);
      console.log('Migration completed: bookmarks table created');
    }

    // Migration 6: Create settings table if it doesn't exist
    const hasSettings = tableNames.includes('settings');

    if (!hasSettings) {
      console.log('Running migration: Creating settings table');
      sqlite.exec(`
        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
      console.log('Migration completed: settings table created');
    }

    // Migration 7: Create users table if it doesn't exist
    const hasUsers = tableNames.includes('users');

    if (!hasUsers) {
      console.log('Running migration: Creating users table');
      sqlite.exec(`
        CREATE TABLE users (
          user_id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          display_name TEXT,
          created_date TEXT NOT NULL
        );
        CREATE INDEX idx_users_username ON users(username);
      `);

      // NOTE: No default user created - users must be created via Setup wizard with required PIN
      console.log('Migration completed: users table created');
    }

    // Migration 8: Add thumbnail/preview/XMP columns to imgs and vids tables
    const imgColumns = sqlite.pragma('table_info(imgs)') as Array<{ name: string }>;
    const hasThumbPath = imgColumns.some(col => col.name === 'thumb_path');

    if (!hasThumbPath) {
      console.log('Running migration: Adding thumbnail/preview/XMP columns');

      // Add columns to imgs table
      sqlite.exec(`
        ALTER TABLE imgs ADD COLUMN thumb_path TEXT;
        ALTER TABLE imgs ADD COLUMN preview_path TEXT;
        ALTER TABLE imgs ADD COLUMN preview_extracted INTEGER DEFAULT 0;
        ALTER TABLE imgs ADD COLUMN xmp_synced INTEGER DEFAULT 0;
        ALTER TABLE imgs ADD COLUMN xmp_modified_at TEXT;
      `);

      // Add columns to vids table
      sqlite.exec(`
        ALTER TABLE vids ADD COLUMN thumb_path TEXT;
        ALTER TABLE vids ADD COLUMN poster_extracted INTEGER DEFAULT 0;
        ALTER TABLE vids ADD COLUMN xmp_synced INTEGER DEFAULT 0;
        ALTER TABLE vids ADD COLUMN xmp_modified_at TEXT;
      `);

      // Create indexes for finding media without thumbnails
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_imgs_thumb_path ON imgs(thumb_path);
        CREATE INDEX IF NOT EXISTS idx_vids_thumb_path ON vids(thumb_path);
      `);

      console.log('Migration completed: thumbnail/preview/XMP columns added');
    }

    // Migration 9: Add multi-tier thumbnail columns (Premium Archive)
    // Adds thumb_path_sm (400px), thumb_path_lg (800px), preview_path (1920px)
    const imgColumnsCheck = sqlite.pragma('table_info(imgs)') as Array<{ name: string }>;
    const hasThumbPathSm = imgColumnsCheck.some(col => col.name === 'thumb_path_sm');

    if (!hasThumbPathSm) {
      console.log('Running migration 9: Adding multi-tier thumbnail columns');

      // Add columns to imgs table
      sqlite.exec(`
        ALTER TABLE imgs ADD COLUMN thumb_path_sm TEXT;
        ALTER TABLE imgs ADD COLUMN thumb_path_lg TEXT;
      `);
      // Note: preview_path already exists from migration 8

      // Add columns to vids table
      sqlite.exec(`
        ALTER TABLE vids ADD COLUMN thumb_path_sm TEXT;
        ALTER TABLE vids ADD COLUMN thumb_path_lg TEXT;
        ALTER TABLE vids ADD COLUMN preview_path TEXT;
      `);

      // Add columns to maps table (maps can have thumbnails too)
      sqlite.exec(`
        ALTER TABLE maps ADD COLUMN thumb_path_sm TEXT;
        ALTER TABLE maps ADD COLUMN thumb_path_lg TEXT;
        ALTER TABLE maps ADD COLUMN preview_path TEXT;
      `);

      // Create indexes for finding media without multi-tier thumbnails
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_imgs_thumb_sm ON imgs(thumb_path_sm);
        CREATE INDEX IF NOT EXISTS idx_vids_thumb_sm ON vids(thumb_path_sm);
        CREATE INDEX IF NOT EXISTS idx_maps_thumb_sm ON maps(thumb_path_sm);
      `);

      console.log('Migration 9 completed: multi-tier thumbnail columns added');
    }

    // Migration 10: Add hero_imghash to locs table for hero image selection
    // Per Kanye6: Allow users to select a featured image for each location
    const locsColumnsCheck = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string }>;
    const hasHeroImgsha = locsColumnsCheck.some(col => col.name === 'hero_imghash');

    if (!hasHeroImgsha) {
      console.log('Running migration 10: Adding hero_imghash column to locs');

      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN hero_imghash TEXT;
      `);

      // Create index for finding locations with hero images
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_locs_hero_imghash ON locs(hero_imghash) WHERE hero_imghash IS NOT NULL;
      `);

      console.log('Migration 10 completed: hero_imghash column added');
    }

    // Migration 11: Add darktable_path column to imgs table (DEPRECATED)
    // NOTE: Darktable integration has been REMOVED from the app.
    // Columns remain for backwards compatibility but are unused.
    // Per original Kanye10: Darktable CLI integration for premium RAW processing
    const imgColsForDarktable = sqlite.prepare('PRAGMA table_info(imgs)').all() as Array<{ name: string }>;
    const hasDarktablePath = imgColsForDarktable.some(col => col.name === 'darktable_path');

    if (!hasDarktablePath) {
      console.log('Running migration 11: Adding Darktable columns to imgs');

      sqlite.exec(`
        ALTER TABLE imgs ADD COLUMN darktable_path TEXT;
        ALTER TABLE imgs ADD COLUMN darktable_processed INTEGER DEFAULT 0;
        ALTER TABLE imgs ADD COLUMN darktable_processed_at TEXT;
      `);

      // Create index for finding RAW files pending Darktable processing
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_imgs_darktable ON imgs(darktable_processed) WHERE darktable_processed = 0;
      `);

      console.log('Migration 11 completed: Darktable columns added');
    }

    // Migration 12: Add address normalization columns to locs table
    // Per Kanye9: Store both raw and normalized addresses for premium archive
    const hasAddressRaw = locsColumnsCheck.some(col => col.name === 'address_raw');

    if (!hasAddressRaw) {
      console.log('Running migration 12: Adding address normalization columns to locs');

      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN address_raw TEXT;
        ALTER TABLE locs ADD COLUMN address_normalized TEXT;
        ALTER TABLE locs ADD COLUMN address_parsed_json TEXT;
        ALTER TABLE locs ADD COLUMN address_source TEXT;
      `);

      console.log('Migration 12 completed: address normalization columns added');
    }

    // Migration 13: Add GPS geocode tier columns to locs table
    // Per Kanye9: Track which tier of cascade geocoding was used for accurate zoom levels
    const hasGeocodeTier = locsColumnsCheck.some(col => col.name === 'gps_geocode_tier');

    if (!hasGeocodeTier) {
      console.log('Running migration 13: Adding GPS geocode tier columns to locs');

      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN gps_geocode_tier INTEGER;
        ALTER TABLE locs ADD COLUMN gps_geocode_query TEXT;
      `);

      console.log('Migration 13 completed: GPS geocode tier columns added');
    }

    // Migration 14: Add verification tracking columns to locs table
    // Per DECISION-010: Verification system for address, GPS, and location-level
    // - address_verified: User confirmed address is correct
    // - gps_verified_at/by: Metadata for existing gps_verified_on_map
    // - location_verified: Computed when BOTH address AND GPS verified
    const locsColsForVerification = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string }>;
    const hasAddressVerified = locsColsForVerification.some(col => col.name === 'address_verified');

    if (!hasAddressVerified) {
      console.log('Running migration 14: Adding verification tracking columns to locs');

      sqlite.exec(`
        -- Address verification
        ALTER TABLE locs ADD COLUMN address_verified INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN address_verified_at TEXT;
        ALTER TABLE locs ADD COLUMN address_verified_by TEXT;

        -- GPS verification metadata (gps_verified_on_map already exists)
        ALTER TABLE locs ADD COLUMN gps_verified_at TEXT;
        ALTER TABLE locs ADD COLUMN gps_verified_by TEXT;

        -- Location-level verification (set when BOTH address AND GPS verified)
        ALTER TABLE locs ADD COLUMN location_verified INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN location_verified_at TEXT;
      `);

      // Create index for finding verified locations
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_locs_verified ON locs(location_verified) WHERE location_verified = 1;
        CREATE INDEX IF NOT EXISTS idx_locs_address_verified ON locs(address_verified) WHERE address_verified = 1;
      `);

      console.log('Migration 14 completed: verification tracking columns added');
    }

    // Migration 15: Add cultural_region column to locs table
    // Per DECISION-011: Location Box UI redesign with cultural region support
    // Cultural region is user-entered, subjective, does NOT count toward Location ✓
    const locsColsForCulturalRegion = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string }>;
    const hasCulturalRegion = locsColsForCulturalRegion.some(col => col.name === 'cultural_region');

    if (!hasCulturalRegion) {
      console.log('Running migration 15: Adding cultural_region column to locs');

      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN cultural_region TEXT;
      `);

      console.log('Migration 15 completed: cultural_region column added');
    }

    // Migration 16: Add Census region/division and state direction columns to locs table
    // Per DECISION-012: Auto-population of regions for location discovery
    // - census_region: One of 4 US Census regions (Northeast, Midwest, South, West)
    // - census_division: One of 9 US Census divisions (New England, Middle Atlantic, etc.)
    // - state_direction: Position within state (e.g., "Eastern NY", "Central TX")
    // Note: cultural_region already exists from Migration 15
    const locsColsForCensus = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string }>;
    const hasCensusRegion = locsColsForCensus.some(col => col.name === 'census_region');

    if (!hasCensusRegion) {
      console.log('Running migration 16: Adding Census region/division columns to locs');

      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN census_region TEXT;
        ALTER TABLE locs ADD COLUMN census_division TEXT;
        ALTER TABLE locs ADD COLUMN state_direction TEXT;
      `);

      // Create indexes for filtering by region
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_locs_census_region ON locs(census_region) WHERE census_region IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_locs_census_division ON locs(census_division) WHERE census_division IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_locs_cultural_region ON locs(cultural_region) WHERE cultural_region IS NOT NULL;
      `);

      console.log('Migration 16 completed: Census region/division columns added');
    }

    // Migration 17: Add Information box fields for DECISION-013
    // - built_year/abandoned_year: Text storage for flexible date formats
    // - built_type/abandoned_type: 'year', 'range', 'date' for UI formatting
    // - project: Boolean flag for project membership
    // - doc_interior/exterior/drone/web_history: Documentation checkboxes
    const locsColsForInfo = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string }>;
    const hasBuiltYear = locsColsForInfo.some(col => col.name === 'built_year');

    if (!hasBuiltYear) {
      console.log('Running migration 17: Adding Information box columns to locs');

      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN built_year TEXT;
        ALTER TABLE locs ADD COLUMN built_type TEXT;
        ALTER TABLE locs ADD COLUMN abandoned_year TEXT;
        ALTER TABLE locs ADD COLUMN abandoned_type TEXT;
        ALTER TABLE locs ADD COLUMN project INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN doc_interior INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN doc_exterior INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN doc_drone INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN doc_web_history INTEGER DEFAULT 0;
      `);

      // Create index for project flag
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_locs_project ON locs(project) WHERE project = 1;
      `);

      console.log('Migration 17 completed: Information box columns added');
    }

    // Migration 18: Add Country Cultural Region and geographic hierarchy fields
    // Per DECISION-017: Local & Region sections overhaul
    // - country_cultural_region: 50 national-level regions (from GeoJSON)
    // - country_cultural_region_verified: User verification flag
    // - local_cultural_region_verified: User verification for existing cultural_region
    // - country: Defaults to "United States"
    // - continent: Defaults to "North America"
    const locsColsForCountryRegion = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string }>;
    const hasCountryCulturalRegion = locsColsForCountryRegion.some(col => col.name === 'country_cultural_region');

    if (!hasCountryCulturalRegion) {
      console.log('Running migration 18: Adding Country Cultural Region and geographic hierarchy columns to locs');

      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN country_cultural_region TEXT;
        ALTER TABLE locs ADD COLUMN country_cultural_region_verified INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN local_cultural_region_verified INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN country TEXT DEFAULT 'United States';
        ALTER TABLE locs ADD COLUMN continent TEXT DEFAULT 'North America';
      `);

      // Create index for country cultural region filtering
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_locs_country_cultural_region ON locs(country_cultural_region) WHERE country_cultural_region IS NOT NULL;
      `);

      console.log('Migration 18 completed: Country Cultural Region and geographic hierarchy columns added');
    }

    // Migration 19: Add Information Box overhaul fields
    // Per DECISION-019: Historical name and name verification fields
    // - historical_name: Historical/original name of location
    // - locnam_verified: User verified location name is correct
    // - historical_name_verified: User verified historical name is correct
    // - akanam_verified: User verified AKA name is correct
    const locsColsForInfoOverhaul = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string }>;
    const hasHistoricalName = locsColsForInfoOverhaul.some(col => col.name === 'historical_name');

    if (!hasHistoricalName) {
      console.log('Running migration 19: Adding Information Box overhaul columns to locs');

      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN historical_name TEXT;
        ALTER TABLE locs ADD COLUMN locnam_verified INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN historical_name_verified INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN akanam_verified INTEGER DEFAULT 0;
      `);

      console.log('Migration 19 completed: Information Box overhaul columns added');
    }

    // Migration 20: Add Map Find documentation and status change tracking
    // Per Information Box overhaul:
    // - doc_map_find: Documentation checkbox for Map Find
    // - status_changed_at: Track when status last changed for nerd stats
    const locsColsForMapFind = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string }>;
    const hasDocMapFind = locsColsForMapFind.some(col => col.name === 'doc_map_find');

    if (!hasDocMapFind) {
      console.log('Running migration 20: Adding doc_map_find and status_changed_at columns to locs');

      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN doc_map_find INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN status_changed_at TEXT;
      `);

      console.log('Migration 20 completed: doc_map_find and status_changed_at columns added');
    }

    // Migration 21: Add hero display name fields
    // Per hero redesign: Smart title shortening with manual override
    // - locnam_short: Optional custom short name for hero display
    // - locnam_use_the: Boolean to prepend "The" to display name
    const locsColsForDisplayName = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string }>;
    const hasLocnamShort = locsColsForDisplayName.some(col => col.name === 'locnam_short');

    if (!hasLocnamShort) {
      console.log('Running migration 21: Adding hero display name columns to locs');

      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN locnam_short TEXT;
        ALTER TABLE locs ADD COLUMN locnam_use_the INTEGER DEFAULT 0;
      `);

      console.log('Migration 21 completed: hero display name columns added');
    }

    // Migration 22: Add hero image focal point columns
    // Per premium UX: Allow user to set crop center point for hero images
    // - hero_focal_x: 0-1 horizontal position (0.5 = center)
    // - hero_focal_y: 0-1 vertical position (0.5 = center)
    const locsColsForFocal = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string }>;
    const hasHeroFocalX = locsColsForFocal.some(col => col.name === 'hero_focal_x');

    if (!hasHeroFocalX) {
      console.log('Running migration 22: Adding hero focal point columns to locs');

      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN hero_focal_x REAL DEFAULT 0.5;
        ALTER TABLE locs ADD COLUMN hero_focal_y REAL DEFAULT 0.5;
      `);

      console.log('Migration 22 completed: hero focal point columns added');
    }

    // Migration 23: Add hidden and live photo columns to media tables
    // Per premium UX: Hide Live Photo videos, SDR duplicates, user-hidden items
    // - hidden: 0/1 flag for hiding from default view
    // - hidden_reason: 'user', 'live_photo', 'sdr_duplicate'
    // - is_live_photo: Flag for iPhone Live Photos and Android Motion Photos
    const imgColsForHidden = sqlite.prepare('PRAGMA table_info(imgs)').all() as Array<{ name: string }>;
    const hasHiddenCol = imgColsForHidden.some(col => col.name === 'hidden');

    if (!hasHiddenCol) {
      console.log('Running migration 23: Adding hidden and live photo columns to media tables');

      // Add columns to imgs table
      sqlite.exec(`
        ALTER TABLE imgs ADD COLUMN hidden INTEGER DEFAULT 0;
        ALTER TABLE imgs ADD COLUMN hidden_reason TEXT;
        ALTER TABLE imgs ADD COLUMN is_live_photo INTEGER DEFAULT 0;
      `);

      // Add columns to vids table
      sqlite.exec(`
        ALTER TABLE vids ADD COLUMN hidden INTEGER DEFAULT 0;
        ALTER TABLE vids ADD COLUMN hidden_reason TEXT;
        ALTER TABLE vids ADD COLUMN is_live_photo INTEGER DEFAULT 0;
      `);

      // Add columns to docs table
      sqlite.exec(`
        ALTER TABLE docs ADD COLUMN hidden INTEGER DEFAULT 0;
        ALTER TABLE docs ADD COLUMN hidden_reason TEXT;
      `);

      // Create indexes for filtering hidden items
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_imgs_hidden ON imgs(hidden) WHERE hidden = 1;
        CREATE INDEX IF NOT EXISTS idx_vids_hidden ON vids(hidden) WHERE hidden = 1;
        CREATE INDEX IF NOT EXISTS idx_docs_hidden ON docs(hidden) WHERE hidden = 1;
        CREATE INDEX IF NOT EXISTS idx_imgs_live_photo ON imgs(is_live_photo) WHERE is_live_photo = 1;
        CREATE INDEX IF NOT EXISTS idx_vids_live_photo ON vids(is_live_photo) WHERE is_live_photo = 1;
      `);

      console.log('Migration 23 completed: hidden and live photo columns added');
    }

    // Migration 24: User authentication system
    // Multi-user support with simple PIN authentication
    // - pin_hash: SHA256 hash of user's PIN (null = no PIN required)
    // - is_active: Soft delete flag for users
    // - last_login: Track last login timestamp
    // - app_mode setting: 'single' or 'multi' user mode
    const userColsForPin = sqlite.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    const hasPinHash = userColsForPin.some(col => col.name === 'pin_hash');

    if (!hasPinHash) {
      console.log('Running migration 24: Adding user authentication columns');

      // Add authentication columns to users table
      sqlite.exec(`
        ALTER TABLE users ADD COLUMN pin_hash TEXT;
        ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1;
        ALTER TABLE users ADD COLUMN last_login TEXT;
      `);

      // Set default app_mode to 'single' for existing installations
      const existingMode = sqlite.prepare("SELECT value FROM settings WHERE key = 'app_mode'").get();
      if (!existingMode) {
        sqlite.prepare("INSERT INTO settings (key, value) VALUES ('app_mode', 'single')").run();
      }

      console.log('Migration 24 completed: user authentication columns added');
    }

    // Migration 25: Activity tracking and author attribution
    // Phase 2 & 3: Track who creates, modifies, imports, and documents locations
    // - created_by_id, modified_by_id: Foreign keys to users table
    // - created_by, modified_by: Username strings for display (denormalized for performance)
    // - modified_at: Timestamp of last modification
    // - imported_by_id, imported_by: Track who imported media
    // - media_source: Track where media came from (e.g., "Personal camera", "Facebook archive")
    // - location_authors: Junction table for multiple authors per location
    const locsColsForTracking = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string }>;
    const hasCreatedById = locsColsForTracking.some(col => col.name === 'created_by_id');

    if (!hasCreatedById) {
      console.log('Running migration 25: Adding activity tracking and author attribution');

      // Add tracking columns to locs table
      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN created_by_id TEXT REFERENCES users(user_id);
        ALTER TABLE locs ADD COLUMN created_by TEXT;
        ALTER TABLE locs ADD COLUMN modified_by_id TEXT REFERENCES users(user_id);
        ALTER TABLE locs ADD COLUMN modified_by TEXT;
        ALTER TABLE locs ADD COLUMN modified_at TEXT;
      `);

      // Add tracking columns to imgs table
      sqlite.exec(`
        ALTER TABLE imgs ADD COLUMN imported_by_id TEXT REFERENCES users(user_id);
        ALTER TABLE imgs ADD COLUMN imported_by TEXT;
        ALTER TABLE imgs ADD COLUMN media_source TEXT;
      `);

      // Add tracking columns to vids table
      sqlite.exec(`
        ALTER TABLE vids ADD COLUMN imported_by_id TEXT REFERENCES users(user_id);
        ALTER TABLE vids ADD COLUMN imported_by TEXT;
        ALTER TABLE vids ADD COLUMN media_source TEXT;
      `);

      // Add tracking columns to docs table
      sqlite.exec(`
        ALTER TABLE docs ADD COLUMN imported_by_id TEXT REFERENCES users(user_id);
        ALTER TABLE docs ADD COLUMN imported_by TEXT;
        ALTER TABLE docs ADD COLUMN media_source TEXT;
      `);

      // Add tracking columns to maps table
      sqlite.exec(`
        ALTER TABLE maps ADD COLUMN imported_by_id TEXT REFERENCES users(user_id);
        ALTER TABLE maps ADD COLUMN imported_by TEXT;
        ALTER TABLE maps ADD COLUMN media_source TEXT;
      `);

      // Create location_authors junction table for multiple contributors
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS location_authors (
          locid TEXT NOT NULL REFERENCES locs(locid) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'contributor',
          added_at TEXT NOT NULL,
          PRIMARY KEY (locid, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_location_authors_locid ON location_authors(locid);
        CREATE INDEX IF NOT EXISTS idx_location_authors_user_id ON location_authors(user_id);
      `);

      // Create indexes for activity queries
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_locs_created_by_id ON locs(created_by_id) WHERE created_by_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_locs_modified_by_id ON locs(modified_by_id) WHERE modified_by_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_imgs_imported_by_id ON imgs(imported_by_id) WHERE imported_by_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_vids_imported_by_id ON vids(imported_by_id) WHERE imported_by_id IS NOT NULL;
      `);

      // Backfill existing locations with auth_imp data if available
      // This preserves the existing author attribution from the auth_imp field
      sqlite.exec(`
        UPDATE locs SET created_by = auth_imp WHERE created_by IS NULL AND auth_imp IS NOT NULL;
        UPDATE imgs SET imported_by = auth_imp WHERE imported_by IS NULL AND auth_imp IS NOT NULL;
        UPDATE vids SET imported_by = auth_imp WHERE imported_by IS NULL AND auth_imp IS NOT NULL;
        UPDATE docs SET imported_by = auth_imp WHERE imported_by IS NULL AND auth_imp IS NOT NULL;
        UPDATE maps SET imported_by = auth_imp WHERE imported_by IS NULL AND auth_imp IS NOT NULL;
      `);

      console.log('Migration 25 completed: activity tracking and author attribution columns added');
    }

    // Migration 26: Media contributor tracking
    // Track whether media was shot by the user (author) or contributed by someone else
    // - is_contributed: 0 = author shot it, 1 = someone else contributed it
    // - contribution_source: Free text describing who/where from (e.g., "John Smith via text")
    const imgsColsForContrib = sqlite.prepare('PRAGMA table_info(imgs)').all() as Array<{ name: string }>;
    const hasContributed = imgsColsForContrib.some(col => col.name === 'is_contributed');

    if (!hasContributed) {
      console.log('Running migration 26: Adding media contributor tracking');

      // Add contributor columns to imgs table
      sqlite.exec(`
        ALTER TABLE imgs ADD COLUMN is_contributed INTEGER DEFAULT 0;
        ALTER TABLE imgs ADD COLUMN contribution_source TEXT;
      `);

      // Add contributor columns to vids table
      sqlite.exec(`
        ALTER TABLE vids ADD COLUMN is_contributed INTEGER DEFAULT 0;
        ALTER TABLE vids ADD COLUMN contribution_source TEXT;
      `);

      console.log('Migration 26 completed: media contributor tracking columns added');
    }

    // Migration 27: Add contributor tracking to docs table
    // Consistency with imgs/vids - docs can also be contributed by others
    const docsColsForContrib = sqlite.prepare('PRAGMA table_info(docs)').all() as Array<{ name: string }>;
    const docsHasContributed = docsColsForContrib.some(col => col.name === 'is_contributed');

    if (!docsHasContributed) {
      console.log('Running migration 27: Adding contributor tracking to docs table');

      sqlite.exec(`
        ALTER TABLE docs ADD COLUMN is_contributed INTEGER DEFAULT 0;
        ALTER TABLE docs ADD COLUMN contribution_source TEXT;
      `);

      console.log('Migration 27 completed: docs contributor tracking columns added');
    }

    // Migration 28: Enhanced sub-location fields
    // Add type, status, hero image, primary flag, and activity tracking to slocs table
    const slocsColumns = sqlite.prepare('PRAGMA table_info(slocs)').all() as Array<{ name: string }>;
    const slocsHasType = slocsColumns.some(col => col.name === 'type');

    if (!slocsHasType) {
      console.log('Running migration 28: Adding enhanced sub-location fields to slocs');

      sqlite.exec(`
        ALTER TABLE slocs ADD COLUMN type TEXT;
        ALTER TABLE slocs ADD COLUMN status TEXT;
        ALTER TABLE slocs ADD COLUMN hero_imghash TEXT REFERENCES imgs(imghash);
        ALTER TABLE slocs ADD COLUMN is_primary INTEGER DEFAULT 0;
        ALTER TABLE slocs ADD COLUMN created_date TEXT;
        ALTER TABLE slocs ADD COLUMN created_by TEXT;
        ALTER TABLE slocs ADD COLUMN modified_date TEXT;
        ALTER TABLE slocs ADD COLUMN modified_by TEXT;
      `);

      // Create index for finding primary sub-locations
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_slocs_is_primary ON slocs(is_primary) WHERE is_primary = 1;
        CREATE INDEX IF NOT EXISTS idx_slocs_type ON slocs(type) WHERE type IS NOT NULL;
      `);

      console.log('Migration 28 completed: enhanced sub-location fields added');
    }

    // Migration 29: Remove UNIQUE constraint on slocnam
    // The slocnam (short location name) was incorrectly marked UNIQUE in the original schema.
    // Multiple locations can legitimately have the same abbreviation (e.g., "Hospital").
    // SQLite requires table rebuild to drop constraints.
    // Check if migration needed by testing if we can insert duplicate slocnam
    const migration29Check = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql LIKE '%slocnam%' AND sql LIKE '%UNIQUE%'").get();
    const tableInfoForSlocnam = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='locs'").get() as { sql: string } | undefined;
    const hasSlocnamUnique = tableInfoForSlocnam?.sql?.includes('UNIQUE(slocnam)');

    if (hasSlocnamUnique || migration29Check) {
      console.log('Running migration 29: Removing UNIQUE constraint on slocnam');

      // Disable foreign keys during table rebuild
      sqlite.exec(`PRAGMA foreign_keys = OFF`);

      // Clean up any leftover locs_new from interrupted migration
      sqlite.exec(`DROP TABLE IF EXISTS locs_new`);

      // Get all column names from locs table
      const locsTableInfo = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;
      const columnDefs = locsTableInfo.map(col => {
        let def = `${col.name} ${col.type || 'TEXT'}`;
        if (col.pk) def += ' PRIMARY KEY';
        if (col.notnull && !col.pk) def += ' NOT NULL';
        if (col.dflt_value !== null) def += ` DEFAULT ${col.dflt_value}`;
        return def;
      }).join(',\n  ');

      // Create new table without UNIQUE(slocnam) constraint
      // Keep UNIQUE on loc12 and CHECK on address_state
      sqlite.exec(`
        CREATE TABLE locs_new (
          ${columnDefs},
          UNIQUE(loc12),
          CHECK(address_state IS NULL OR length(address_state) = 2)
        )
      `);

      sqlite.exec(`INSERT INTO locs_new SELECT * FROM locs`);
      sqlite.exec(`DROP TABLE locs`);
      sqlite.exec(`ALTER TABLE locs_new RENAME TO locs`);

      // Recreate indexes
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_locs_state ON locs(address_state);
        CREATE INDEX IF NOT EXISTS idx_locs_category ON locs(category);
        CREATE INDEX IF NOT EXISTS idx_locs_gps ON locs(gps_lat, gps_lng) WHERE gps_lat IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_locs_loc12 ON locs(loc12);
        CREATE INDEX IF NOT EXISTS idx_locs_favorite ON locs(favorite) WHERE favorite = 1;
        CREATE INDEX IF NOT EXISTS idx_locs_verified ON locs(location_verified) WHERE location_verified = 1;
        CREATE INDEX IF NOT EXISTS idx_locs_address_verified ON locs(address_verified) WHERE address_verified = 1;
        CREATE INDEX IF NOT EXISTS idx_locs_census_region ON locs(census_region) WHERE census_region IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_locs_census_division ON locs(census_division) WHERE census_division IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_locs_cultural_region ON locs(cultural_region) WHERE cultural_region IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_locs_country_cultural_region ON locs(country_cultural_region) WHERE country_cultural_region IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_locs_project ON locs(project) WHERE project = 1;
        CREATE INDEX IF NOT EXISTS idx_locs_hero_imghash ON locs(hero_imghash) WHERE hero_imghash IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_locs_created_by_id ON locs(created_by_id) WHERE created_by_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_locs_modified_by_id ON locs(modified_by_id) WHERE modified_by_id IS NOT NULL
      `);

      // Re-enable foreign keys
      sqlite.exec(`PRAGMA foreign_keys = ON`);

      console.log('Migration 29 completed: UNIQUE constraint on slocnam removed');
    }

    // Migration 30: Add preview_quality column to imgs table
    // Track quality of extracted previews for RAW files
    // Values: 'full' (LibRaw rendered), 'embedded' (ExifTool extracted), 'low' (< 50% resolution)
    const imgsColsForQuality = sqlite.prepare('PRAGMA table_info(imgs)').all() as Array<{ name: string }>;
    const hasPreviewQuality = imgsColsForQuality.some(col => col.name === 'preview_quality');

    if (!hasPreviewQuality) {
      console.log('Running migration 30: Adding preview_quality column to imgs');

      sqlite.exec(`
        ALTER TABLE imgs ADD COLUMN preview_quality TEXT DEFAULT 'embedded';
      `);

      // Create index for finding low-quality previews that need regeneration
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_imgs_preview_quality ON imgs(preview_quality) WHERE preview_quality = 'low';
      `);

      console.log('Migration 30 completed: preview_quality column added');
    }

    // Migration 31: Add GPS columns to slocs (sub-locations) table
    // Per user spec: Sub-locations need their OWN GPS, separate from host location
    // Host location = campus-level GPS (e.g., main entrance)
    // Sub-location = building-specific GPS (e.g., individual building)
    const slocsColsForGps = sqlite.prepare('PRAGMA table_info(slocs)').all() as Array<{ name: string }>;
    const slocsHasGpsLat = slocsColsForGps.some(col => col.name === 'gps_lat');

    if (!slocsHasGpsLat) {
      console.log('Running migration 31: Adding GPS columns to slocs');

      sqlite.exec(`
        ALTER TABLE slocs ADD COLUMN gps_lat REAL;
        ALTER TABLE slocs ADD COLUMN gps_lng REAL;
        ALTER TABLE slocs ADD COLUMN gps_accuracy REAL;
        ALTER TABLE slocs ADD COLUMN gps_source TEXT;
        ALTER TABLE slocs ADD COLUMN gps_verified_on_map INTEGER DEFAULT 0;
        ALTER TABLE slocs ADD COLUMN gps_captured_at TEXT;
      `);

      // Create index for sub-locations with GPS
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_slocs_gps ON slocs(gps_lat, gps_lng) WHERE gps_lat IS NOT NULL;
      `);

      console.log('Migration 31 completed: GPS columns added to slocs');
    }

    // Migration 32: Add akanam and historicalName columns to slocs table
    // Per sub-location edit form: Buildings can have their own AKA and historical names
    const slocsColsForAka = sqlite.prepare('PRAGMA table_info(slocs)').all() as Array<{ name: string }>;
    const slocsHasAkanam = slocsColsForAka.some(col => col.name === 'akanam');

    if (!slocsHasAkanam) {
      console.log('Running migration 32: Adding akanam and historicalName columns to slocs');

      sqlite.exec(`
        ALTER TABLE slocs ADD COLUMN akanam TEXT;
        ALTER TABLE slocs ADD COLUMN historicalName TEXT;
      `);

      console.log('Migration 32 completed: akanam and historicalName columns added to slocs');
    }

    // Migration 33: Add view_count and last_viewed_at columns to locs table
    // For Nerd Stats: Track how many times a location has been viewed
    const locsColsForViews = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string }>;
    const locsHasViewCount = locsColsForViews.some(col => col.name === 'view_count');

    if (!locsHasViewCount) {
      console.log('Running migration 33: Adding view_count and last_viewed_at columns to locs');

      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN view_count INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN last_viewed_at TEXT;
      `);

      console.log('Migration 33 completed: view_count and last_viewed_at columns added to locs');
    }

    // Migration 34: Create location_views table for per-user view tracking
    // Tracks who viewed what location and when, for analytics and future features
    const locationViewsExists = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='location_views'"
    ).get();

    if (!locationViewsExists) {
      console.log('Running migration 34: Creating location_views table');

      sqlite.exec(`
        CREATE TABLE location_views (
          view_id TEXT PRIMARY KEY,
          locid TEXT NOT NULL,
          user_id TEXT NOT NULL,
          viewed_at TEXT NOT NULL,
          FOREIGN KEY (locid) REFERENCES locs(locid) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        );

        -- Index for efficient queries by location and user
        CREATE INDEX idx_location_views_locid ON location_views(locid);
        CREATE INDEX idx_location_views_user_id ON location_views(user_id);
        CREATE INDEX idx_location_views_viewed_at ON location_views(viewed_at);
        -- Composite index for checking if user already viewed today
        CREATE INDEX idx_location_views_locid_user_date ON location_views(locid, user_id, viewed_at);
      `);

      console.log('Migration 34 completed: location_views table created');
    }

    // Migration 35: Add subid column to bookmarks table for sub-location support
    const bookmarkColumns = sqlite.pragma('table_info(bookmarks)') as Array<{ name: string }>;
    const bookmarksHasSubid = bookmarkColumns.some(col => col.name === 'subid');

    if (!bookmarksHasSubid) {
      console.log('Running migration 35: Adding subid column to bookmarks table');

      sqlite.exec(`
        ALTER TABLE bookmarks ADD COLUMN subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL;
        CREATE INDEX idx_bookmarks_subid ON bookmarks(subid);
      `);

      console.log('Migration 35 completed: subid column added to bookmarks');
    }

    // Migration 36: Create video_proxies table for optimized video playback
    // Stores H.264 proxy videos with faststart for instant scrubbing
    // Per video-proxy-system-plan.md: Solves slow loading, no scrubbing, and rotation issues
    const videoProxiesExists = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='video_proxies'"
    ).get();

    if (!videoProxiesExists) {
      console.log('Running migration 36: Creating video_proxies table');

      sqlite.exec(`
        CREATE TABLE video_proxies (
          vidhash TEXT PRIMARY KEY,
          proxy_path TEXT NOT NULL,
          generated_at TEXT NOT NULL,
          last_accessed TEXT NOT NULL,
          file_size_bytes INTEGER,
          original_width INTEGER,
          original_height INTEGER,
          proxy_width INTEGER,
          proxy_height INTEGER
        );

        -- Index for finding old proxies to purge
        CREATE INDEX idx_video_proxies_last_accessed ON video_proxies(last_accessed);

        -- Trigger to auto-delete proxy records when video is deleted
        CREATE TRIGGER video_proxies_fk_delete
        AFTER DELETE ON vids
        BEGIN
          DELETE FROM video_proxies WHERE vidhash = OLD.vidhash;
        END;
      `);

      console.log('Migration 36 completed: video_proxies table created');
    }

    // Migration 37: Create reference maps tables for user-imported map data
    // Stores imported KML, GPX, GeoJSON, etc. for location reference
    const refMapsExists = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ref_maps'"
    ).get();

    if (!refMapsExists) {
      console.log('Running migration 37: Creating reference maps tables');

      sqlite.exec(`
        -- Imported map files metadata
        CREATE TABLE ref_maps (
          map_id TEXT PRIMARY KEY,
          map_name TEXT NOT NULL,
          file_path TEXT NOT NULL,
          file_type TEXT NOT NULL,
          point_count INTEGER DEFAULT 0,
          imported_at TEXT NOT NULL,
          imported_by TEXT
        );

        CREATE INDEX idx_ref_maps_name ON ref_maps(map_name);

        -- Points extracted from imported maps
        CREATE TABLE ref_map_points (
          point_id TEXT PRIMARY KEY,
          map_id TEXT NOT NULL REFERENCES ref_maps(map_id) ON DELETE CASCADE,
          name TEXT,
          description TEXT,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          state TEXT,
          category TEXT,
          raw_metadata TEXT
        );

        CREATE INDEX idx_ref_map_points_map ON ref_map_points(map_id);
        CREATE INDEX idx_ref_map_points_state ON ref_map_points(state);
        CREATE INDEX idx_ref_map_points_coords ON ref_map_points(lat, lng);
      `);

      console.log('Migration 37 completed: reference maps tables created');
    }

    // Migration 38: Create location_exclusions table for "different place" decisions
    // ADR: ADR-pin-conversion-duplicate-prevention.md
    // Stores user decisions that two names refer to different places
    // Prevents re-prompting for the same pair during location creation
    const locationExclusionsExists = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='location_exclusions'"
    ).get();

    if (!locationExclusionsExists) {
      console.log('Running migration 38: Creating location_exclusions table');

      sqlite.exec(`
        -- Stores user decisions that two names refer to different places
        -- Prevents re-prompting for the same pair
        CREATE TABLE location_exclusions (
          exclusion_id TEXT PRIMARY KEY,
          name_a TEXT NOT NULL,
          name_b TEXT NOT NULL,
          decided_at TEXT NOT NULL,
          decided_by TEXT
        );

        -- Index for efficient lookup (both directions)
        CREATE INDEX idx_location_exclusions_names ON location_exclusions(name_a, name_b);
      `);

      console.log('Migration 38 completed: location_exclusions table created');
    }

    // Migration 39: Add aka_names to ref_map_points for deduplication
    // Stores alternate names when merging duplicate pins
    const akaColumnExists = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('ref_map_points') WHERE name='aka_names'"
    ).get() as { cnt: number };

    if (akaColumnExists.cnt === 0) {
      console.log('Running migration 39: Adding aka_names to ref_map_points');

      sqlite.exec(`
        -- Add aka_names column for storing alternate names from merged pins
        ALTER TABLE ref_map_points ADD COLUMN aka_names TEXT;

        -- Add index for rounded GPS lookup (deduplication)
        CREATE INDEX IF NOT EXISTS idx_ref_map_points_gps_rounded
          ON ref_map_points(ROUND(lat, 4), ROUND(lng, 4));
      `);

      console.log('Migration 39 completed: aka_names column added');
    }

    // Migration 40: Add BagIt self-documenting archive columns to locs table
    // Per RFC 8493: Each location folder becomes a self-documenting archive
    // that can be understood 35+ years from now without the database
    // - bag_status: 'none', 'valid', 'complete', 'incomplete', 'invalid'
    // - bag_last_verified: ISO8601 timestamp of last integrity check
    // - bag_last_error: Error message if validation failed
    const locsColsForBagit = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string }>;
    const hasBagStatus = locsColsForBagit.some(col => col.name === 'bag_status');

    if (!hasBagStatus) {
      console.log('Running migration 40: Adding BagIt archive columns to locs');

      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN bag_status TEXT DEFAULT 'none';
        ALTER TABLE locs ADD COLUMN bag_last_verified TEXT;
        ALTER TABLE locs ADD COLUMN bag_last_error TEXT;
      `);

      // Create index for finding locations needing validation
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_locs_bag_status ON locs(bag_status) WHERE bag_status != 'valid';
      `);

      console.log('Migration 40 completed: BagIt archive columns added');
    }

    // Migration 41: Create sidecar_imports table for metadata-only imports
    // Stores metadata from XML sidecar files when media file is not imported
    // Use case: Import XML metadata for reference without bringing large media files
    const sidecarImportsExists = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sidecar_imports'"
    ).get();

    if (!sidecarImportsExists) {
      console.log('Running migration 41: Creating sidecar_imports table');

      sqlite.exec(`
        -- Metadata-only imports from XML sidecar files
        -- When a media file has a matching .xml sidecar, we can import just the metadata
        CREATE TABLE sidecar_imports (
          sidecar_id TEXT PRIMARY KEY,
          original_filename TEXT NOT NULL,
          original_path TEXT NOT NULL,
          xml_filename TEXT NOT NULL,
          xml_path TEXT NOT NULL,
          xml_content TEXT,
          parsed_metadata TEXT,
          media_type TEXT,
          import_date TEXT NOT NULL,
          imported_by TEXT,
          imported_by_id TEXT REFERENCES users(user_id),
          locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
          subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL
        );

        -- Indexes for efficient queries
        CREATE INDEX idx_sidecar_imports_locid ON sidecar_imports(locid);
        CREATE INDEX idx_sidecar_imports_date ON sidecar_imports(import_date DESC);
        CREATE INDEX idx_sidecar_imports_original ON sidecar_imports(original_filename);
      `);

      console.log('Migration 41 completed: sidecar_imports table created');
    }

    // Migration 42: Add linked_locid to ref_map_points for GPS enrichment tracking
    // When a ref point's GPS is applied to an existing location, we link them
    // instead of deleting the ref point - preserving provenance and metadata
    const refPointCols = sqlite.prepare('PRAGMA table_info(ref_map_points)').all() as Array<{ name: string }>;
    const hasLinkedLocid = refPointCols.some(col => col.name === 'linked_locid');

    if (!hasLinkedLocid) {
      console.log('Running migration 42: Adding linked_locid to ref_map_points');

      sqlite.exec(`
        -- Track which location received GPS from this ref point
        ALTER TABLE ref_map_points ADD COLUMN linked_locid TEXT REFERENCES locs(locid) ON DELETE SET NULL;

        -- When the link was created
        ALTER TABLE ref_map_points ADD COLUMN linked_at TEXT;

        -- Index for filtering out linked points from Atlas layer
        CREATE INDEX IF NOT EXISTS idx_ref_map_points_linked ON ref_map_points(linked_locid);
      `);

      console.log('Migration 42 completed: ref_map_points linking columns added');
    }

    // Migration 43: Add ON DELETE CASCADE to media tables (imgs, vids, docs, maps)
    // OPT-036: Location deletion was failing with FOREIGN KEY constraint error
    // SQLite requires table rebuild to modify foreign key constraints
    const imgsFkCheck = sqlite.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='imgs'"
    ).get() as { sql: string } | undefined;
    const needsCascadeFix = imgsFkCheck?.sql && !imgsFkCheck.sql.includes('ON DELETE CASCADE');

    if (needsCascadeFix) {
      console.log('Running migration 43: Adding ON DELETE CASCADE to media tables');

      // Disable FK checks during table rebuild
      sqlite.exec('PRAGMA foreign_keys = OFF');

      try {
        // ===== REBUILD imgs TABLE =====
        // Get all current columns dynamically
        const imgCols = sqlite.prepare('PRAGMA table_info(imgs)').all() as Array<{
          name: string; type: string; notnull: number; dflt_value: string | null; pk: number
        }>;
        const imgColNames = imgCols.map(c => c.name).join(', ');

        sqlite.exec(`
          CREATE TABLE imgs_new (
            imghash TEXT PRIMARY KEY,
            imgnam TEXT NOT NULL,
            imgnamo TEXT NOT NULL,
            imgloc TEXT NOT NULL,
            imgloco TEXT NOT NULL,
            locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
            subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL,
            auth_imp TEXT,
            imgadd TEXT,
            meta_exiftool TEXT,
            meta_width INTEGER,
            meta_height INTEGER,
            meta_date_taken TEXT,
            meta_camera_make TEXT,
            meta_camera_model TEXT,
            meta_gps_lat REAL,
            meta_gps_lng REAL,
            thumb_path TEXT,
            preview_path TEXT,
            preview_extracted INTEGER DEFAULT 0,
            xmp_synced INTEGER DEFAULT 0,
            xmp_modified_at TEXT,
            thumb_path_sm TEXT,
            thumb_path_lg TEXT,
            darktable_path TEXT,
            darktable_processed INTEGER DEFAULT 0,
            darktable_processed_at TEXT,
            hidden INTEGER DEFAULT 0,
            hidden_reason TEXT,
            is_live_photo INTEGER DEFAULT 0,
            imported_by_id TEXT,
            imported_by TEXT,
            media_source TEXT,
            is_contributed INTEGER DEFAULT 0,
            contribution_source TEXT,
            preview_quality TEXT DEFAULT 'embedded'
          )
        `);

        sqlite.exec(`INSERT INTO imgs_new (${imgColNames}) SELECT ${imgColNames} FROM imgs`);
        sqlite.exec('DROP TABLE imgs');
        sqlite.exec('ALTER TABLE imgs_new RENAME TO imgs');

        // Recreate indexes for imgs
        sqlite.exec(`
          CREATE INDEX IF NOT EXISTS idx_imgs_locid ON imgs(locid);
          CREATE INDEX IF NOT EXISTS idx_imgs_subid ON imgs(subid);
          CREATE INDEX IF NOT EXISTS idx_imgs_sha ON imgs(imghash);
          CREATE INDEX IF NOT EXISTS idx_imgs_thumb_path ON imgs(thumb_path);
          CREATE INDEX IF NOT EXISTS idx_imgs_thumb_sm ON imgs(thumb_path_sm);
          CREATE INDEX IF NOT EXISTS idx_imgs_darktable ON imgs(darktable_processed) WHERE darktable_processed = 0;
          CREATE INDEX IF NOT EXISTS idx_imgs_hidden ON imgs(hidden) WHERE hidden = 1;
          CREATE INDEX IF NOT EXISTS idx_imgs_live_photo ON imgs(is_live_photo) WHERE is_live_photo = 1;
          CREATE INDEX IF NOT EXISTS idx_imgs_imported_by_id ON imgs(imported_by_id) WHERE imported_by_id IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_imgs_preview_quality ON imgs(preview_quality) WHERE preview_quality = 'low'
        `);

        // ===== REBUILD vids TABLE =====
        const vidCols = sqlite.prepare('PRAGMA table_info(vids)').all() as Array<{
          name: string; type: string; notnull: number; dflt_value: string | null; pk: number
        }>;
        const vidColNames = vidCols.map(c => c.name).join(', ');

        sqlite.exec(`
          CREATE TABLE vids_new (
            vidhash TEXT PRIMARY KEY,
            vidnam TEXT NOT NULL,
            vidnamo TEXT NOT NULL,
            vidloc TEXT NOT NULL,
            vidloco TEXT NOT NULL,
            locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
            subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL,
            auth_imp TEXT,
            vidadd TEXT,
            meta_ffmpeg TEXT,
            meta_exiftool TEXT,
            meta_duration REAL,
            meta_width INTEGER,
            meta_height INTEGER,
            meta_codec TEXT,
            meta_fps REAL,
            meta_date_taken TEXT,
            meta_gps_lat REAL,
            meta_gps_lng REAL,
            thumb_path TEXT,
            poster_extracted INTEGER DEFAULT 0,
            xmp_synced INTEGER DEFAULT 0,
            xmp_modified_at TEXT,
            thumb_path_sm TEXT,
            thumb_path_lg TEXT,
            preview_path TEXT,
            hidden INTEGER DEFAULT 0,
            hidden_reason TEXT,
            is_live_photo INTEGER DEFAULT 0,
            imported_by_id TEXT,
            imported_by TEXT,
            media_source TEXT,
            is_contributed INTEGER DEFAULT 0,
            contribution_source TEXT
          )
        `);

        sqlite.exec(`INSERT INTO vids_new (${vidColNames}) SELECT ${vidColNames} FROM vids`);
        sqlite.exec('DROP TABLE vids');
        sqlite.exec('ALTER TABLE vids_new RENAME TO vids');

        // Recreate indexes for vids
        sqlite.exec(`
          CREATE INDEX IF NOT EXISTS idx_vids_locid ON vids(locid);
          CREATE INDEX IF NOT EXISTS idx_vids_subid ON vids(subid);
          CREATE INDEX IF NOT EXISTS idx_vids_thumb_path ON vids(thumb_path);
          CREATE INDEX IF NOT EXISTS idx_vids_thumb_sm ON vids(thumb_path_sm);
          CREATE INDEX IF NOT EXISTS idx_vids_hidden ON vids(hidden) WHERE hidden = 1;
          CREATE INDEX IF NOT EXISTS idx_vids_live_photo ON vids(is_live_photo) WHERE is_live_photo = 1;
          CREATE INDEX IF NOT EXISTS idx_vids_imported_by_id ON vids(imported_by_id) WHERE imported_by_id IS NOT NULL
        `);

        // ===== REBUILD docs TABLE =====
        const docCols = sqlite.prepare('PRAGMA table_info(docs)').all() as Array<{
          name: string; type: string; notnull: number; dflt_value: string | null; pk: number
        }>;
        const docColNames = docCols.map(c => c.name).join(', ');

        sqlite.exec(`
          CREATE TABLE docs_new (
            dochash TEXT PRIMARY KEY,
            docnam TEXT NOT NULL,
            docnamo TEXT NOT NULL,
            docloc TEXT NOT NULL,
            docloco TEXT NOT NULL,
            locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
            subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL,
            auth_imp TEXT,
            docadd TEXT,
            meta_exiftool TEXT,
            meta_page_count INTEGER,
            meta_author TEXT,
            meta_title TEXT,
            hidden INTEGER DEFAULT 0,
            hidden_reason TEXT,
            imported_by_id TEXT,
            imported_by TEXT,
            media_source TEXT,
            is_contributed INTEGER DEFAULT 0,
            contribution_source TEXT
          )
        `);

        sqlite.exec(`INSERT INTO docs_new (${docColNames}) SELECT ${docColNames} FROM docs`);
        sqlite.exec('DROP TABLE docs');
        sqlite.exec('ALTER TABLE docs_new RENAME TO docs');

        // Recreate indexes for docs
        sqlite.exec(`
          CREATE INDEX IF NOT EXISTS idx_docs_locid ON docs(locid);
          CREATE INDEX IF NOT EXISTS idx_docs_hidden ON docs(hidden) WHERE hidden = 1
        `);

        // ===== REBUILD maps TABLE =====
        const mapCols = sqlite.prepare('PRAGMA table_info(maps)').all() as Array<{
          name: string; type: string; notnull: number; dflt_value: string | null; pk: number
        }>;
        const mapColNames = mapCols.map(c => c.name).join(', ');

        sqlite.exec(`
          CREATE TABLE maps_new (
            maphash TEXT PRIMARY KEY,
            mapnam TEXT NOT NULL,
            mapnamo TEXT NOT NULL,
            maploc TEXT NOT NULL,
            maploco TEXT NOT NULL,
            locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
            subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL,
            auth_imp TEXT,
            mapadd TEXT,
            meta_exiftool TEXT,
            meta_map TEXT,
            meta_gps_lat REAL,
            meta_gps_lng REAL,
            reference TEXT,
            map_states TEXT,
            map_verified INTEGER DEFAULT 0,
            thumb_path_sm TEXT,
            thumb_path_lg TEXT,
            preview_path TEXT,
            imported_by_id TEXT,
            imported_by TEXT,
            media_source TEXT
          )
        `);

        sqlite.exec(`INSERT INTO maps_new (${mapColNames}) SELECT ${mapColNames} FROM maps`);
        sqlite.exec('DROP TABLE maps');
        sqlite.exec('ALTER TABLE maps_new RENAME TO maps');

        // Recreate indexes for maps
        sqlite.exec(`
          CREATE INDEX IF NOT EXISTS idx_maps_locid ON maps(locid);
          CREATE INDEX IF NOT EXISTS idx_maps_thumb_sm ON maps(thumb_path_sm)
        `);

        console.log('Migration 43 completed: ON DELETE CASCADE added to imgs, vids, docs, maps');
      } finally {
        // Re-enable FK checks
        sqlite.exec('PRAGMA foreign_keys = ON');
      }
    }

    // Migration 44: Add file_size_bytes column to media tables (OPT-047)
    // Stores file size at import time for instant archive size queries
    // Per data-ownership.md: "Every media file's provenance... is auditable at any time"
    const imgsHasFileSize = sqlite.prepare('PRAGMA table_info(imgs)').all() as Array<{ name: string }>;
    if (!imgsHasFileSize.some(col => col.name === 'file_size_bytes')) {
      console.log('Running migration 44: Adding file_size_bytes to media tables');

      // Add column to imgs table
      sqlite.exec('ALTER TABLE imgs ADD COLUMN file_size_bytes INTEGER');

      // Add column to vids table
      sqlite.exec('ALTER TABLE vids ADD COLUMN file_size_bytes INTEGER');

      // Add column to docs table
      sqlite.exec('ALTER TABLE docs ADD COLUMN file_size_bytes INTEGER');

      // Add column to maps table
      sqlite.exec('ALTER TABLE maps ADD COLUMN file_size_bytes INTEGER');

      console.log('Migration 44 completed: file_size_bytes added to imgs, vids, docs, maps');
    }

    // Migration 45: Video Proxy Immich Model (OPT-053)
    // - Add proxy_version column for tracking re-encode needs
    // - proxy_path now stores path relative to video location (alongside original)
    // - last_accessed column deprecated (no longer used - proxies are permanent)
    // Per OPT-053: Proxies generated at import time, stored alongside originals, never purged
    const vpHasVersion = sqlite.prepare('PRAGMA table_info(video_proxies)').all() as Array<{ name: string }>;
    if (!vpHasVersion.some(col => col.name === 'proxy_version')) {
      console.log('Running migration 45: Video proxy Immich model (OPT-053)');

      // Add proxy_version column (default 1 for existing proxies)
      sqlite.exec('ALTER TABLE video_proxies ADD COLUMN proxy_version INTEGER DEFAULT 1');

      // Note: last_accessed column remains but is deprecated (unused)
      // Note: idx_video_proxies_last_accessed index remains but is unused
      // We don't drop them to avoid table rebuild - they're harmless

      console.log('Migration 45 completed: proxy_version added, Immich model ready');
    }

    // Migration 46: SRT Telemetry column for DJI drone videos (OPT-055)
    // Stores parsed telemetry summary (GPS bounds, altitude range, duration) from
    // DJI SRT files that accompany drone videos. SRT file itself stays in docs table,
    // but parsed telemetry data is stored on the matching video record for queries.
    const vidsHasSrtTelemetry = sqlite.prepare('PRAGMA table_info(vids)').all() as Array<{ name: string }>;
    if (!vidsHasSrtTelemetry.some(col => col.name === 'srt_telemetry')) {
      console.log('Running migration 46: Adding srt_telemetry column to vids (OPT-055)');

      sqlite.exec('ALTER TABLE vids ADD COLUMN srt_telemetry TEXT');

      console.log('Migration 46 completed: srt_telemetry column added');
    }

    // Migration 47: Auto-hide existing metadata sidecar files (OPT-060)
    // Fixes existing .srt, .lrf, .thm files that were imported before OPT-060
    // These are metadata sidecars that should be hidden from the documents list
    // New imports will be auto-hidden during INSERT (transaction-safe)
    const unhiddenMetadataCount = sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM docs
      WHERE (
        lower(docnamo) LIKE '%.srt' OR
        lower(docnamo) LIKE '%.lrf' OR
        lower(docnamo) LIKE '%.thm'
      ) AND hidden = 0
    `).get() as { cnt: number };

    if (unhiddenMetadataCount.cnt > 0) {
      console.log(`Running migration 47: Hiding ${unhiddenMetadataCount.cnt} existing metadata sidecar files (OPT-060)`);

      sqlite.exec(`
        UPDATE docs
        SET hidden = 1, hidden_reason = 'metadata_sidecar'
        WHERE (
          lower(docnamo) LIKE '%.srt' OR
          lower(docnamo) LIKE '%.lrf' OR
          lower(docnamo) LIKE '%.thm'
        ) AND hidden = 0
      `);

      console.log('Migration 47 completed: Metadata sidecar files hidden');
    }

    // Migration 48: Add is_host_only column to locs table (OPT-062)
    // Marks locations as "host-only" - campuses/complexes expecting sub-locations
    // When checked, user intends to add sub-locations later; location created without media
    const isHostOnlyExists = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('locs') WHERE name='is_host_only'"
    ).get() as { cnt: number };

    if (isHostOnlyExists.cnt === 0) {
      console.log('Running migration 48: Adding is_host_only column to locs');

      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN is_host_only INTEGER DEFAULT 0;
      `);

      console.log('Migration 48 completed: is_host_only column added');
    }

    // Migration 49: Import System v2.0 - Jobs table and import sessions
    // Per Import Spec v2.0: SQLite-backed priority queue with dependency support
    const hasJobsTable = tableNames.includes('jobs');

    if (!hasJobsTable) {
      console.log('Running migration 49: Creating jobs and import_sessions tables');

      // Jobs table for SQLite-backed priority queue
      sqlite.exec(`
        CREATE TABLE jobs (
          job_id TEXT PRIMARY KEY,
          queue TEXT NOT NULL,
          priority INTEGER DEFAULT 10,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'dead')),
          payload TEXT NOT NULL,
          depends_on TEXT,
          attempts INTEGER DEFAULT 0,
          max_attempts INTEGER DEFAULT 3,
          error TEXT,
          result TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          started_at TEXT,
          completed_at TEXT,
          locked_by TEXT,
          locked_at TEXT
        );

        -- Index for efficient job polling: get next job by queue and priority
        CREATE INDEX idx_jobs_queue_status_priority ON jobs(queue, status, priority DESC);
        -- Index for dependency resolution
        CREATE INDEX idx_jobs_depends_on ON jobs(depends_on) WHERE depends_on IS NOT NULL;
        -- Index for finding stale locks
        CREATE INDEX idx_jobs_locked_at ON jobs(locked_at) WHERE locked_at IS NOT NULL;
      `);

      // Import sessions table for tracking and resumption
      // NOTE: locid has ON DELETE CASCADE - see Migration 54 for fix applied to existing DBs
      sqlite.exec(`
        CREATE TABLE import_sessions (
          session_id TEXT PRIMARY KEY,
          locid TEXT NOT NULL REFERENCES locs(locid) ON DELETE CASCADE,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'scanning', 'hashing', 'copying', 'validating', 'finalizing', 'completed', 'cancelled', 'failed')),
          source_paths TEXT NOT NULL,
          copy_strategy TEXT,
          total_files INTEGER DEFAULT 0,
          processed_files INTEGER DEFAULT 0,
          duplicate_files INTEGER DEFAULT 0,
          error_files INTEGER DEFAULT 0,
          total_bytes INTEGER DEFAULT 0,
          processed_bytes INTEGER DEFAULT 0,
          started_at TEXT DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT,
          error TEXT,
          can_resume INTEGER DEFAULT 1,
          last_step INTEGER DEFAULT 0
        );

        CREATE INDEX idx_import_sessions_status ON import_sessions(status) WHERE status NOT IN ('completed', 'cancelled');
        CREATE INDEX idx_import_sessions_locid ON import_sessions(locid);
      `);

      // Dead letter queue for failed jobs that exceeded max retries
      sqlite.exec(`
        CREATE TABLE job_dead_letter (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id TEXT NOT NULL,
          queue TEXT NOT NULL,
          payload TEXT NOT NULL,
          error TEXT,
          attempts INTEGER,
          failed_at TEXT DEFAULT CURRENT_TIMESTAMP,
          acknowledged INTEGER DEFAULT 0
        );

        CREATE INDEX idx_job_dead_letter_queue ON job_dead_letter(queue, acknowledged);
      `);

      console.log('Migration 49 completed: jobs, import_sessions, job_dead_letter tables created');
    }

    // Migration 50: Add retry_after column to jobs table for exponential backoff
    // Also add scan_result, hash_results, copy_results, validation_results to import_sessions for resume
    const retryAfterExists = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('jobs') WHERE name='retry_after'"
    ).get() as { cnt: number };

    if (retryAfterExists.cnt === 0) {
      console.log('Running migration 50: Adding retry_after to jobs, results columns to import_sessions');

      // Add retry_after for exponential backoff
      sqlite.exec(`
        ALTER TABLE jobs ADD COLUMN retry_after TEXT;
        ALTER TABLE jobs ADD COLUMN last_error TEXT;
      `);

      // Create index for efficient polling with retry_after check
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_jobs_retry_after ON jobs(retry_after) WHERE retry_after IS NOT NULL;
      `);

      // Add result storage columns to import_sessions for proper resume
      sqlite.exec(`
        ALTER TABLE import_sessions ADD COLUMN scan_result TEXT;
        ALTER TABLE import_sessions ADD COLUMN hash_results TEXT;
        ALTER TABLE import_sessions ADD COLUMN copy_results TEXT;
        ALTER TABLE import_sessions ADD COLUMN validation_results TEXT;
      `);

      console.log('Migration 50 completed: retry_after and session result columns added');
    }

    // Migration 51: Monitoring & Audit System
    // Creates tables for metrics, traces, and job audit logs
    const metricsTableExists = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='metrics'"
    ).get() as { cnt: number };

    if (metricsTableExists.cnt === 0) {
      console.log('Running migration 51: Creating monitoring and audit tables');

      sqlite.exec(`
        -- Metrics table (time-series performance data)
        -- Ring buffer: old data auto-cleaned by maintenance scheduler
        CREATE TABLE metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          value REAL NOT NULL,
          timestamp INTEGER NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('counter', 'gauge', 'histogram')),
          tags TEXT
        );

        CREATE INDEX idx_metrics_name_timestamp ON metrics(name, timestamp);
        CREATE INDEX idx_metrics_timestamp ON metrics(timestamp);

        -- Traces table (distributed tracing spans)
        CREATE TABLE traces (
          span_id TEXT PRIMARY KEY,
          trace_id TEXT NOT NULL,
          parent_span_id TEXT,
          operation TEXT NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER,
          duration INTEGER,
          status TEXT NOT NULL CHECK(status IN ('running', 'success', 'error')),
          tags TEXT,
          logs TEXT
        );

        CREATE INDEX idx_traces_trace_id ON traces(trace_id);
        CREATE INDEX idx_traces_operation ON traces(operation);
        CREATE INDEX idx_traces_start_time ON traces(start_time);

        -- Job audit log (execution history for each job)
        CREATE TABLE job_audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id TEXT NOT NULL,
          queue TEXT NOT NULL,
          asset_hash TEXT,
          location_id TEXT,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          duration INTEGER,
          status TEXT NOT NULL CHECK(status IN ('started', 'success', 'error', 'timeout')),
          attempt INTEGER NOT NULL DEFAULT 1,
          error_message TEXT,
          result TEXT
        );

        CREATE INDEX idx_job_audit_job_id ON job_audit_log(job_id);
        CREATE INDEX idx_job_audit_asset ON job_audit_log(asset_hash);
        CREATE INDEX idx_job_audit_started_at ON job_audit_log(started_at);
        CREATE INDEX idx_job_audit_queue ON job_audit_log(queue, started_at);

        -- Import session audit (enhanced tracking)
        CREATE TABLE import_audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          step TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('started', 'progress', 'completed', 'error')),
          message TEXT,
          context TEXT
        );

        CREATE INDEX idx_import_audit_session ON import_audit_log(session_id);
        CREATE INDEX idx_import_audit_timestamp ON import_audit_log(timestamp);

        -- Alert history
        CREATE TABLE alert_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          alert_id TEXT NOT NULL,
          name TEXT NOT NULL,
          severity TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'critical')),
          message TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          context TEXT,
          acknowledged INTEGER DEFAULT 0,
          acknowledged_at INTEGER,
          acknowledged_by TEXT
        );

        CREATE INDEX idx_alert_history_timestamp ON alert_history(timestamp);
        CREATE INDEX idx_alert_history_severity ON alert_history(severity, acknowledged);

        -- Health check snapshots (periodic health state)
        CREATE TABLE health_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('healthy', 'warning', 'critical')),
          checks TEXT NOT NULL,
          recommendations TEXT
        );

        CREATE INDEX idx_health_timestamp ON health_snapshots(timestamp);
      `);

      console.log('Migration 51 completed: monitoring and audit tables created');
    }

    // Migration 52: Restore hero_focal_x/y columns for image centering (OPT-074)
    const locColumns52 = sqlite.prepare(`PRAGMA table_info(locs)`).all() as Array<{ name: string }>;
    const hasHeroFocalX52 = locColumns52.some(col => col.name === 'hero_focal_x');
    if (!hasHeroFocalX52) {
      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN hero_focal_x REAL DEFAULT 0.5;
        ALTER TABLE locs ADD COLUMN hero_focal_y REAL DEFAULT 0.5;
      `);
      console.log('Migration 52 completed: hero_focal_x/y columns restored');
    }

    // Migration 52b: Restore hero_focal_x/y columns for sub-locations
    const slocColumns52 = sqlite.prepare(`PRAGMA table_info(slocs)`).all() as Array<{ name: string }>;
    const hasSlocHeroFocalX = slocColumns52.some(col => col.name === 'hero_focal_x');
    if (!hasSlocHeroFocalX) {
      sqlite.exec(`
        ALTER TABLE slocs ADD COLUMN hero_focal_x REAL DEFAULT 0.5;
        ALTER TABLE slocs ADD COLUMN hero_focal_y REAL DEFAULT 0.5;
      `);
      console.log('Migration 52b completed: hero_focal_x/y columns added to slocs');
    }

    // Migration 53: OPT-077 Video proxy aspect ratio fix
    // Delete old proxies (proxy_version < 2) so they regenerate with correct rotation handling
    // This is a one-time cleanup - affected videos will regenerate proxies on next playback
    const oldProxies = sqlite.prepare(
      `SELECT COUNT(*) as count FROM video_proxies WHERE proxy_version < 2`
    ).get() as { count: number };

    if (oldProxies.count > 0) {
      console.log(`Migration 53: Clearing ${oldProxies.count} old video proxies for OPT-077 aspect ratio fix`);

      // Get paths of old proxy files to delete
      const proxyPaths = sqlite.prepare(
        `SELECT proxy_path FROM video_proxies WHERE proxy_version < 2`
      ).all() as Array<{ proxy_path: string }>;

      // Delete DB records
      sqlite.exec(`DELETE FROM video_proxies WHERE proxy_version < 2`);

      // Delete physical files (non-blocking, don't fail migration if files missing)
      const fs = require('fs');
      let deletedFiles = 0;
      for (const { proxy_path } of proxyPaths) {
        try {
          if (fs.existsSync(proxy_path)) {
            fs.unlinkSync(proxy_path);
            deletedFiles++;
          }
        } catch {
          // File may be locked or already deleted - continue
        }
      }

      console.log(`Migration 53 completed: Deleted ${deletedFiles} proxy files, ${oldProxies.count} DB records. Proxies will regenerate on playback.`);
    }

    // Migration 54: Fix import_sessions FK constraint (OPT-084)
    // Migration 49 created import_sessions with locid REFERENCES locs(locid) but
    // MISSING "ON DELETE CASCADE". This causes FOREIGN KEY constraint failures
    // when deleting locations that have import session records.
    // SQLite requires table rebuild to modify foreign key constraints.
    const importSessionsFkCheck = sqlite.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='import_sessions'"
    ).get() as { sql: string } | undefined;
    const needsImportSessionsCascadeFix = importSessionsFkCheck?.sql &&
      !importSessionsFkCheck.sql.includes('ON DELETE CASCADE');

    if (needsImportSessionsCascadeFix) {
      console.log('Running migration 54: Adding ON DELETE CASCADE to import_sessions (OPT-084)');

      // Disable FK checks during table rebuild
      sqlite.exec('PRAGMA foreign_keys = OFF');

      try {
        // Get current columns
        const sessionCols = sqlite.prepare('PRAGMA table_info(import_sessions)').all() as Array<{
          name: string; type: string; notnull: number; dflt_value: string | null; pk: number
        }>;
        const sessionColNames = sessionCols.map(c => c.name).join(', ');

        // Rebuild table with proper CASCADE
        sqlite.exec(`
          CREATE TABLE import_sessions_new (
            session_id TEXT PRIMARY KEY,
            locid TEXT NOT NULL REFERENCES locs(locid) ON DELETE CASCADE,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'scanning', 'hashing', 'copying', 'validating', 'finalizing', 'completed', 'cancelled', 'failed')),
            source_paths TEXT NOT NULL,
            copy_strategy TEXT,
            total_files INTEGER DEFAULT 0,
            processed_files INTEGER DEFAULT 0,
            duplicate_files INTEGER DEFAULT 0,
            error_files INTEGER DEFAULT 0,
            total_bytes INTEGER DEFAULT 0,
            processed_bytes INTEGER DEFAULT 0,
            started_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT,
            error TEXT,
            can_resume INTEGER DEFAULT 1,
            last_step INTEGER DEFAULT 0,
            scan_result TEXT,
            hash_results TEXT,
            copy_results TEXT,
            validation_results TEXT
          )
        `);

        sqlite.exec(`INSERT INTO import_sessions_new (${sessionColNames}) SELECT ${sessionColNames} FROM import_sessions`);
        sqlite.exec('DROP TABLE import_sessions');
        sqlite.exec('ALTER TABLE import_sessions_new RENAME TO import_sessions');

        // Recreate indexes
        sqlite.exec(`
          CREATE INDEX IF NOT EXISTS idx_import_sessions_status ON import_sessions(status) WHERE status NOT IN ('completed', 'cancelled');
          CREATE INDEX IF NOT EXISTS idx_import_sessions_locid ON import_sessions(locid)
        `);

        console.log('Migration 54 completed: import_sessions now has ON DELETE CASCADE');
      } finally {
        // Re-enable FK checks
        sqlite.exec('PRAGMA foreign_keys = ON');
      }
    }

    // Migration 55: Add location stats columns for location-stats job
    // These columns cache media counts/stats computed by the background job
    const locsColumns = sqlite.prepare('PRAGMA table_info(locs)').all() as Array<{ name: string }>;
    if (!locsColumns.some((c) => c.name === 'img_count')) {
      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN img_count INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN vid_count INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN doc_count INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN map_count INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN total_size_bytes INTEGER DEFAULT 0;
        ALTER TABLE locs ADD COLUMN earliest_media_date TEXT;
        ALTER TABLE locs ADD COLUMN latest_media_date TEXT;
        ALTER TABLE locs ADD COLUMN stats_updated_at TEXT;
      `);
      console.log('Migration 55 completed: Added location stats columns (img_count, vid_count, etc.)');
    }

    // Migration 56: OPT-093 Add sub-location stats and BagIt columns
    // Mirror the locs stats columns for sub-locations
    // Enables sub-location-specific media counts and stats
    const slocs56Columns = sqlite.prepare('PRAGMA table_info(slocs)').all() as Array<{ name: string }>;
    if (!slocs56Columns.some((c) => c.name === 'img_count')) {
      sqlite.exec(`
        ALTER TABLE slocs ADD COLUMN img_count INTEGER DEFAULT 0;
        ALTER TABLE slocs ADD COLUMN vid_count INTEGER DEFAULT 0;
        ALTER TABLE slocs ADD COLUMN doc_count INTEGER DEFAULT 0;
        ALTER TABLE slocs ADD COLUMN map_count INTEGER DEFAULT 0;
        ALTER TABLE slocs ADD COLUMN total_size_bytes INTEGER DEFAULT 0;
        ALTER TABLE slocs ADD COLUMN earliest_media_date TEXT;
        ALTER TABLE slocs ADD COLUMN latest_media_date TEXT;
        ALTER TABLE slocs ADD COLUMN stats_updated_at TEXT;
      `);
      console.log('Migration 56a completed: Added sub-location stats columns (OPT-093)');
    }
    // Add BagIt status columns for sub-locations (separate check in case partial migration)
    if (!slocs56Columns.some((c) => c.name === 'bag_status')) {
      sqlite.exec(`
        ALTER TABLE slocs ADD COLUMN bag_status TEXT DEFAULT 'none';
        ALTER TABLE slocs ADD COLUMN bag_last_verified TEXT;
        ALTER TABLE slocs ADD COLUMN bag_last_error TEXT;
      `);
      console.log('Migration 56b completed: Added sub-location BagIt columns (OPT-093)');
    }

    // Migration 57: OPT-109 Create web_sources table (rename from bookmarks)
    // Transform simple bookmarks into comprehensive web archive sources
    const webSourcesExists = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='web_sources'"
    ).get() as { cnt: number };

    if (webSourcesExists.cnt === 0) {
      console.log('Running migration 57: Creating web_sources table for web archiving');

      // Create the new web_sources table with full archive support
      sqlite.exec(`
        CREATE TABLE web_sources (
          source_id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          title TEXT,
          locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
          subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL,
          source_type TEXT DEFAULT 'article',
          notes TEXT,

          -- Archive status
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'archiving', 'complete', 'partial', 'failed')),
          component_status TEXT,  -- JSON object tracking each component

          -- Extracted metadata (from Trafilatura)
          extracted_title TEXT,
          extracted_author TEXT,
          extracted_date TEXT,
          extracted_publisher TEXT,
          word_count INTEGER DEFAULT 0,
          image_count INTEGER DEFAULT 0,
          video_count INTEGER DEFAULT 0,

          -- Archive paths
          archive_path TEXT,
          screenshot_path TEXT,
          pdf_path TEXT,
          html_path TEXT,
          warc_path TEXT,

          -- File hashes (BLAKE3)
          screenshot_hash TEXT,
          pdf_hash TEXT,
          html_hash TEXT,
          warc_hash TEXT,
          content_hash TEXT,

          -- Provenance
          provenance_hash TEXT,

          -- Error tracking
          archive_error TEXT,
          retry_count INTEGER DEFAULT 0,

          -- Timestamps
          created_at TEXT NOT NULL,
          archived_at TEXT,
          auth_imp TEXT
        );

        -- Indexes for efficient queries
        CREATE INDEX idx_websources_locid ON web_sources(locid);
        CREATE INDEX idx_websources_subid ON web_sources(subid);
        CREATE INDEX idx_websources_status ON web_sources(status);
        CREATE INDEX idx_websources_created ON web_sources(created_at DESC);
        CREATE INDEX idx_websources_type ON web_sources(source_type);
      `);

      // Migrate existing bookmarks data if table exists
      const bookmarksExists = sqlite.prepare(
        "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='bookmarks'"
      ).get() as { cnt: number };

      if (bookmarksExists.cnt > 0) {
        sqlite.exec(`
          INSERT INTO web_sources (
            source_id, url, title, locid, subid,
            status, created_at, auth_imp
          )
          SELECT
            bookmark_id, url, title, locid, subid,
            'pending', bookmark_date, auth_imp
          FROM bookmarks;

          DROP TABLE bookmarks;
        `);
        console.log('Migration 57: Migrated existing bookmarks to web_sources');
      }

      console.log('Migration 57 completed: web_sources table created');
    }

    // Migration 58: OPT-109 Create web_source_versions table
    // Track archive versions over time (re-archiving creates new version)
    const versionsExists = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='web_source_versions'"
    ).get() as { cnt: number };

    if (versionsExists.cnt === 0) {
      console.log('Running migration 58: Creating web_source_versions table');

      sqlite.exec(`
        CREATE TABLE web_source_versions (
          version_id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL REFERENCES web_sources(source_id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          archived_at TEXT NOT NULL,

          -- Stats for this version
          word_count INTEGER DEFAULT 0,
          image_count INTEGER DEFAULT 0,
          video_count INTEGER DEFAULT 0,

          -- Hashes for change detection
          content_hash TEXT,
          screenshot_hash TEXT,
          html_hash TEXT,

          -- Archive folder for this version
          archive_path TEXT NOT NULL,

          UNIQUE(source_id, version_number)
        );

        CREATE INDEX idx_wsversions_source ON web_source_versions(source_id);
        CREATE INDEX idx_wsversions_date ON web_source_versions(archived_at DESC);
      `);

      console.log('Migration 58 completed: web_source_versions table created');
    }

    // Migration 59: OPT-109 Add source attribution to imgs and vids tables
    // Links extracted media back to their web source
    const imgsColumns59 = sqlite.prepare('PRAGMA table_info(imgs)').all() as Array<{ name: string }>;
    if (!imgsColumns59.some((c) => c.name === 'source_id')) {
      console.log('Running migration 59: Adding web source attribution to media tables');

      sqlite.exec(`
        -- Add source attribution to imgs table
        ALTER TABLE imgs ADD COLUMN source_id TEXT REFERENCES web_sources(source_id) ON DELETE SET NULL;
        ALTER TABLE imgs ADD COLUMN source_url TEXT;
        ALTER TABLE imgs ADD COLUMN extracted_from_web INTEGER DEFAULT 0;

        -- Add source attribution to vids table
        ALTER TABLE vids ADD COLUMN source_id TEXT REFERENCES web_sources(source_id) ON DELETE SET NULL;
        ALTER TABLE vids ADD COLUMN source_url TEXT;
        ALTER TABLE vids ADD COLUMN extracted_from_web INTEGER DEFAULT 0;

        -- Indexes for filtering web-extracted media
        CREATE INDEX idx_imgs_source ON imgs(source_id) WHERE source_id IS NOT NULL;
        CREATE INDEX idx_imgs_extracted ON imgs(extracted_from_web) WHERE extracted_from_web = 1;
        CREATE INDEX idx_vids_source ON vids(source_id) WHERE source_id IS NOT NULL;
        CREATE INDEX idx_vids_extracted ON vids(extracted_from_web) WHERE extracted_from_web = 1;
      `);

      console.log('Migration 59 completed: Web source attribution columns added to media tables');
    }

    // Migration 60: OPT-109 Create FTS5 full-text search for web sources
    // Enables searching across all archived web content
    const ftsExists = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='web_sources_fts'"
    ).get() as { cnt: number };

    if (ftsExists.cnt === 0) {
      console.log('Running migration 60: Creating FTS5 full-text search for web sources');

      sqlite.exec(`
        -- Full-text search virtual table
        CREATE VIRTUAL TABLE web_sources_fts USING fts5(
          source_id UNINDEXED,
          url,
          title,
          extracted_title,
          extracted_text,
          content='web_sources',
          content_rowid='rowid',
          tokenize='porter unicode61'
        );

        -- Add rowid to web_sources for FTS content sync
        -- Note: SQLite tables have implicit rowid unless WITHOUT ROWID

        -- Triggers to keep FTS in sync
        CREATE TRIGGER web_sources_fts_insert AFTER INSERT ON web_sources BEGIN
          INSERT INTO web_sources_fts(rowid, source_id, url, title, extracted_title, extracted_text)
          VALUES (NEW.rowid, NEW.source_id, NEW.url, NEW.title, NEW.extracted_title, '');
        END;

        CREATE TRIGGER web_sources_fts_delete AFTER DELETE ON web_sources BEGIN
          INSERT INTO web_sources_fts(web_sources_fts, rowid, source_id, url, title, extracted_title, extracted_text)
          VALUES ('delete', OLD.rowid, OLD.source_id, OLD.url, OLD.title, OLD.extracted_title, '');
        END;

        CREATE TRIGGER web_sources_fts_update AFTER UPDATE ON web_sources BEGIN
          INSERT INTO web_sources_fts(web_sources_fts, rowid, source_id, url, title, extracted_title, extracted_text)
          VALUES ('delete', OLD.rowid, OLD.source_id, OLD.url, OLD.title, OLD.extracted_title, '');
          INSERT INTO web_sources_fts(rowid, source_id, url, title, extracted_title, extracted_text)
          VALUES (NEW.rowid, NEW.source_id, NEW.url, NEW.title, NEW.extracted_title, '');
        END;
      `);

      console.log('Migration 60 completed: FTS5 full-text search created for web sources');
    }

    // Migration 61: OPT-109 Fix - Add missing extracted_text column to web_sources
    // The FTS5 table references this column but it was missing from the base table
    const hasExtractedText = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('web_sources') WHERE name='extracted_text'"
    ).get() as { cnt: number };

    if (hasExtractedText.cnt === 0) {
      console.log('Running migration 61: Adding extracted_text column to web_sources');

      sqlite.exec(`
        ALTER TABLE web_sources ADD COLUMN extracted_text TEXT;
      `);

      // Rebuild FTS index to sync with new column
      sqlite.exec(`INSERT INTO web_sources_fts(web_sources_fts) VALUES('rebuild')`);

      console.log('Migration 61 completed: extracted_text column added');
    }

    // Migration 62: OPT-109 Fix - Add missing columns to web_source_versions
    // The repository code expects more columns than the original migration created
    const versionsColumns = sqlite.prepare('PRAGMA table_info(web_source_versions)').all() as Array<{ name: string }>;
    const versionColNames = versionsColumns.map((c) => c.name);

    if (!versionColNames.includes('screenshot_path')) {
      console.log('Running migration 62: Adding missing columns to web_source_versions');

      sqlite.exec(`
        -- Add individual file paths
        ALTER TABLE web_source_versions ADD COLUMN screenshot_path TEXT;
        ALTER TABLE web_source_versions ADD COLUMN pdf_path TEXT;
        ALTER TABLE web_source_versions ADD COLUMN html_path TEXT;
        ALTER TABLE web_source_versions ADD COLUMN warc_path TEXT;

        -- Add missing hashes
        ALTER TABLE web_source_versions ADD COLUMN pdf_hash TEXT;
        ALTER TABLE web_source_versions ADD COLUMN warc_hash TEXT;

        -- Add change tracking
        ALTER TABLE web_source_versions ADD COLUMN content_changed INTEGER DEFAULT 0;
        ALTER TABLE web_source_versions ADD COLUMN diff_summary TEXT;
      `);

      console.log('Migration 62 completed: web_source_versions columns added');
    }

    // Migration 63: OPT-110 Fix - Fix FTS5 triggers to use actual extracted_text
    // The original triggers used empty string '' instead of NEW.extracted_text
    // This broke full-text search on web source content
    const triggerCheck = sqlite.prepare(
      "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='web_sources_fts_insert'"
    ).get() as { sql: string } | undefined;

    // Check if trigger uses empty string (broken) or actual column (fixed)
    if (triggerCheck && triggerCheck.sql && triggerCheck.sql.includes("''")) {
      console.log('Running migration 63: Fixing FTS5 triggers to use extracted_text');

      sqlite.exec(`
        -- Drop broken triggers
        DROP TRIGGER IF EXISTS web_sources_fts_insert;
        DROP TRIGGER IF EXISTS web_sources_fts_update;
        DROP TRIGGER IF EXISTS web_sources_fts_delete;

        -- Recreate triggers with correct extracted_text reference
        CREATE TRIGGER web_sources_fts_insert AFTER INSERT ON web_sources BEGIN
          INSERT INTO web_sources_fts(rowid, source_id, url, title, extracted_title, extracted_text)
          VALUES (NEW.rowid, NEW.source_id, NEW.url, NEW.title, NEW.extracted_title,
                  COALESCE(NEW.extracted_text, ''));
        END;

        CREATE TRIGGER web_sources_fts_delete AFTER DELETE ON web_sources BEGIN
          INSERT INTO web_sources_fts(web_sources_fts, rowid, source_id, url, title, extracted_title, extracted_text)
          VALUES ('delete', OLD.rowid, OLD.source_id, OLD.url, OLD.title, OLD.extracted_title,
                  COALESCE(OLD.extracted_text, ''));
        END;

        CREATE TRIGGER web_sources_fts_update AFTER UPDATE ON web_sources BEGIN
          INSERT INTO web_sources_fts(web_sources_fts, rowid, source_id, url, title, extracted_title, extracted_text)
          VALUES ('delete', OLD.rowid, OLD.source_id, OLD.url, OLD.title, OLD.extracted_title,
                  COALESCE(OLD.extracted_text, ''));
          INSERT INTO web_sources_fts(rowid, source_id, url, title, extracted_title, extracted_text)
          VALUES (NEW.rowid, NEW.source_id, NEW.url, NEW.title, NEW.extracted_title,
                  COALESCE(NEW.extracted_text, ''));
        END;

        -- Rebuild FTS index to pick up any existing data
        INSERT INTO web_sources_fts(web_sources_fts) VALUES('rebuild');
      `);

      console.log('Migration 63 completed: FTS5 triggers fixed');
    }

    // Migration 64: OPT-110 Backfill - Read existing text files and populate extracted_text
    // This populates the FTS index with content from existing archives
    // Note: Path migration is deferred to avoid data loss - new archives use correct paths
    const needsTextBackfill = sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM web_sources
      WHERE extracted_text IS NULL
      AND word_count > 0
      AND archive_path IS NOT NULL
    `).get() as { cnt: number };

    if (needsTextBackfill.cnt > 0) {
      console.log(`Running migration 64: Backfilling extracted_text for ${needsTextBackfill.cnt} sources`);

      // Get all sources that have word_count but no extracted_text
      const sources = sqlite.prepare(`
        SELECT source_id, archive_path, word_count
        FROM web_sources
        WHERE extracted_text IS NULL
        AND word_count > 0
        AND archive_path IS NOT NULL
      `).all() as Array<{ source_id: string; archive_path: string; word_count: number }>;

      let backfilled = 0;
      // Use already-imported fs and path modules (ESM compatible)

      for (const source of sources) {
        try {
          // Look for text file in archive
          const textDir = path.join(source.archive_path, 'text');
          if (fs.existsSync(textDir)) {
            const files = fs.readdirSync(textDir);
            const contentFile = files.find((f: string) => f.endsWith('_content.txt'));

            if (contentFile) {
              const textPath = path.join(textDir, contentFile);
              const content = fs.readFileSync(textPath, 'utf-8');

              if (content && content.trim()) {
                sqlite.prepare(`
                  UPDATE web_sources SET extracted_text = ? WHERE source_id = ?
                `).run(content, source.source_id);
                backfilled++;
              }
            }
          }
        } catch (err) {
          console.warn(`Failed to backfill text for ${source.source_id}:`, err);
        }
      }

      // Rebuild FTS index to include backfilled content
      if (backfilled > 0) {
        sqlite.exec(`INSERT INTO web_sources_fts(web_sources_fts) VALUES('rebuild')`);
      }

      console.log(`Migration 64 completed: Backfilled ${backfilled} sources with extracted_text`);
    }

    // Migration 65: Add stype column to slocs table for sub-location sub-types
    // Host locations and sub-locations each have their own type/subtype taxonomies
    const slocsHasStype = sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM pragma_table_info('slocs') WHERE name = 'stype'
    `).get() as { cnt: number };

    if (slocsHasStype.cnt === 0) {
      console.log('Running migration 65: Adding stype column to slocs table');
      sqlite.exec(`ALTER TABLE slocs ADD COLUMN stype TEXT`);
      console.log('Migration 65 completed: stype column added to slocs');
    }

    // Migration 66: OPT-111 Enhanced web source metadata for archive viewer
    // Add domain, extracted_links, page_metadata_json columns to web_sources
    // Create web_source_images and web_source_videos tables for per-item metadata
    const wsHasDomain = sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM pragma_table_info('web_sources') WHERE name = 'domain'
    `).get() as { cnt: number };

    if (wsHasDomain.cnt === 0) {
      console.log('Running migration 66: Enhanced web source metadata tables');

      // Add new columns to web_sources for page-level metadata
      sqlite.exec(`
        ALTER TABLE web_sources ADD COLUMN domain TEXT;
        ALTER TABLE web_sources ADD COLUMN extracted_links TEXT;
        ALTER TABLE web_sources ADD COLUMN page_metadata_json TEXT;
        ALTER TABLE web_sources ADD COLUMN http_headers_json TEXT;
        ALTER TABLE web_sources ADD COLUMN canonical_url TEXT;
        ALTER TABLE web_sources ADD COLUMN language TEXT;
        ALTER TABLE web_sources ADD COLUMN favicon_path TEXT;
      `);

      // Create web_source_images table for per-image metadata
      // Stores extracted metadata like alt, caption, credit, EXIF for each image
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS web_source_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id TEXT NOT NULL,
          image_index INTEGER NOT NULL,

          url TEXT NOT NULL,
          local_path TEXT,
          hash TEXT,

          width INTEGER,
          height INTEGER,
          size INTEGER,

          original_filename TEXT,
          alt TEXT,
          caption TEXT,
          credit TEXT,
          attribution TEXT,
          srcset_variants TEXT,
          context_html TEXT,
          link_url TEXT,

          exif_json TEXT,

          is_hi_res INTEGER DEFAULT 0,
          is_hero INTEGER DEFAULT 0,

          created_at TEXT DEFAULT (datetime('now')),

          FOREIGN KEY (source_id) REFERENCES web_sources(source_id) ON DELETE CASCADE
        )
      `);
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_web_source_images_source ON web_source_images(source_id)`);

      // Create web_source_videos table for per-video metadata
      // Stores yt-dlp extracted metadata like title, uploader, duration, etc.
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS web_source_videos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id TEXT NOT NULL,
          video_index INTEGER NOT NULL,

          url TEXT NOT NULL,
          local_path TEXT,
          hash TEXT,

          title TEXT,
          description TEXT,
          duration INTEGER,
          size INTEGER,
          platform TEXT,

          uploader TEXT,
          uploader_url TEXT,
          upload_date TEXT,
          view_count INTEGER,
          like_count INTEGER,

          tags TEXT,
          categories TEXT,
          thumbnail_url TEXT,
          thumbnail_path TEXT,
          metadata_json TEXT,

          created_at TEXT DEFAULT (datetime('now')),

          FOREIGN KEY (source_id) REFERENCES web_sources(source_id) ON DELETE CASCADE
        )
      `);
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_web_source_videos_source ON web_source_videos(source_id)`);

      console.log('Migration 66 completed: Enhanced web source metadata tables created');
    }

    // Migration 67: Rename type/stype to category/class
    // Renames columns in locs and slocs tables for clearer terminology
    const locsCols = sqlite.prepare("PRAGMA table_info(locs)").all() as { name: string }[];
    const hasLocType = locsCols.some(c => c.name === 'type');
    const hasLocCategory = locsCols.some(c => c.name === 'category');

    if (hasLocType && !hasLocCategory) {
      console.log('Running migration 67: Renaming type/stype to category/class');

      // Rename locs columns
      sqlite.exec(`ALTER TABLE locs RENAME COLUMN type TO category`);
      sqlite.exec(`ALTER TABLE locs RENAME COLUMN stype TO class`);

      // Rename slocs columns
      sqlite.exec(`ALTER TABLE slocs RENAME COLUMN type TO category`);
      sqlite.exec(`ALTER TABLE slocs RENAME COLUMN stype TO class`);

      // Recreate indexes with new names
      sqlite.exec(`DROP INDEX IF EXISTS idx_locs_type`);
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_locs_category ON locs(category)`);
      sqlite.exec(`DROP INDEX IF EXISTS idx_slocs_type`);
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_slocs_category ON slocs(category)`);

      // Recreate the covering index with renamed column
      sqlite.exec(`DROP INDEX IF EXISTS idx_locs_map_bounds`);
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_locs_map_bounds ON locs(
        gps_lat, gps_lng, locid, locnam, category, gps_verified_on_map, address_state, address_city, favorite
      ) WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL`);

      console.log('Migration 67 completed: type/stype renamed to category/class');
    }

    // Migration 68: Merge Audit Log for duplicate detection research provenance
    // Tracks all auto-merges and user-confirmed merges for audit trail
    const mergeAuditExists = sqlite.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='merge_audit_log'`
    ).get();
    if (!mergeAuditExists) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS merge_audit_log (
          merge_id TEXT PRIMARY KEY NOT NULL,
          merged_at TEXT NOT NULL DEFAULT (datetime('now')),
          merged_by TEXT,

          -- Survivor (kept location)
          survivor_locid TEXT NOT NULL,
          survivor_name TEXT NOT NULL,

          -- Merged entity (can be location or ref_map_point)
          merged_type TEXT NOT NULL CHECK (merged_type IN ('location', 'ref_map_point')),
          merged_locid TEXT,
          merged_point_id TEXT,
          merged_name TEXT,

          -- Match details for research verification
          match_type TEXT NOT NULL CHECK (match_type IN ('gps', 'name', 'combined', 'name_gps', 'name_state', 'name_only')),
          gps_distance_meters INTEGER,
          name_similarity INTEGER,
          confidence_score INTEGER,
          confidence_tier TEXT,

          -- Token set details for debugging
          shared_tokens TEXT,
          unique_tokens_1 TEXT,
          unique_tokens_2 TEXT,

          -- Flags
          was_auto_merged INTEGER NOT NULL DEFAULT 0,
          was_blocked INTEGER NOT NULL DEFAULT 0,
          block_reason TEXT,
          is_generic_name INTEGER NOT NULL DEFAULT 0,
          required_user_review INTEGER NOT NULL DEFAULT 0,

          -- What fields were updated
          fields_updated TEXT,

          -- Audit metadata
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Indices for audit queries
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_merge_audit_survivor ON merge_audit_log(survivor_locid)`);
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_merge_audit_merged_at ON merge_audit_log(merged_at)`);
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_merge_audit_type ON merge_audit_log(match_type)`);

      console.log('Migration 68 completed: merge_audit_log table created');
    }

    // Migration 69: Timeline events table for location history
    const hasTimelineTable = sqlite.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='location_timeline'
    `).get();

    if (!hasTimelineTable) {
      sqlite.exec(`
        CREATE TABLE location_timeline (
          event_id TEXT PRIMARY KEY,
          locid TEXT NOT NULL REFERENCES locs(locid) ON DELETE CASCADE,
          subid TEXT REFERENCES slocs(subid) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          event_subtype TEXT,
          date_start TEXT,
          date_end TEXT,
          date_precision TEXT NOT NULL,
          date_display TEXT,
          date_edtf TEXT,
          date_sort INTEGER,
          date_override TEXT,
          override_reason TEXT,
          source_type TEXT,
          source_ref TEXT,
          source_device TEXT,
          media_count INTEGER DEFAULT 0,
          media_hashes TEXT,
          auto_approved INTEGER DEFAULT 0,
          user_approved INTEGER DEFAULT 0,
          approved_at TEXT,
          approved_by TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          created_by TEXT,
          updated_at TEXT,
          updated_by TEXT
        );

        CREATE INDEX idx_timeline_locid ON location_timeline(locid);
        CREATE INDEX idx_timeline_subid ON location_timeline(subid);
        CREATE INDEX idx_timeline_type ON location_timeline(event_type);
        CREATE INDEX idx_timeline_date ON location_timeline(date_sort);
      `);
      console.log('[Migration 69] Created location_timeline table');

      // Backfill: Create database_entry events from existing locadd
      const locsWithAdd = sqlite.prepare(`SELECT locid, locadd FROM locs WHERE locadd IS NOT NULL`).all() as { locid: string; locadd: string }[];
      for (const loc of locsWithAdd) {
        const dateStr = loc.locadd.split('T')[0];
        const dateSort = dateStr ? parseInt(dateStr.replace(/-/g, '')) : 99999999;
        sqlite.prepare(`
          INSERT INTO location_timeline (
            event_id, locid, event_type, date_start, date_precision,
            date_display, date_sort, source_type, created_at
          ) VALUES (?, ?, 'database_entry', ?, 'exact', ?, ?, 'system', datetime('now'))
        `).run(
          Math.random().toString(36).substring(2, 18).padEnd(16, '0').substring(0, 16),
          loc.locid,
          dateStr,
          dateStr, // ISO 8601: YYYY-MM-DD
          dateSort
        );
      }
      console.log(`[Migration 69] Backfilled ${locsWithAdd.length} database_entry events`);

      // Backfill: Create blank established events for all locations
      const allLocs = sqlite.prepare(`SELECT locid FROM locs`).all() as { locid: string }[];
      for (const loc of allLocs) {
        sqlite.prepare(`
          INSERT INTO location_timeline (
            event_id, locid, event_type, event_subtype, date_precision,
            date_display, date_sort, source_type, created_at
          ) VALUES (?, ?, 'established', 'built', 'unknown', NULL, 99999999, 'manual', datetime('now'))
        `).run(
          Math.random().toString(36).substring(2, 18).padEnd(16, '0').substring(0, 16),
          loc.locid
        );
      }
      console.log(`[Migration 69] Backfilled ${allLocs.length} established events for locations`);

      // Backfill: Create blank established events for all sub-locations
      const allSlocs = sqlite.prepare(`SELECT subid, locid FROM slocs`).all() as { subid: string; locid: string }[];
      for (const sloc of allSlocs) {
        sqlite.prepare(`
          INSERT INTO location_timeline (
            event_id, locid, subid, event_type, event_subtype, date_precision,
            date_display, date_sort, source_type, created_at
          ) VALUES (?, ?, ?, 'established', 'built', 'unknown', NULL, 99999999, 'manual', datetime('now'))
        `).run(
          Math.random().toString(36).substring(2, 18).padEnd(16, '0').substring(0, 16),
          sloc.locid,
          sloc.subid
        );
      }
      console.log(`[Migration 69] Backfilled ${allSlocs.length} established events for sub-locations`);

      console.log('Migration 69 completed: location_timeline table created with backfill');
    }

    // Migration 70: Backfill visit events from existing images with meta_date_taken
    const hasVisitEvents = sqlite.prepare(`
      SELECT 1 FROM location_timeline WHERE event_type = 'visit' LIMIT 1
    `).get();

    if (!hasVisitEvents) {
      console.log('[Migration 70] Backfilling visit events from existing images...');

      // Film scanner makes to exclude (dates are scan dates, not capture dates)
      const filmScannerMakes = [
        'noritsu', 'pakon', 'frontier', 'imacon', 'flextight', 'plustek',
        'pacific image', 'reflecta', 'dimage scan', 'coolscan', 'perfection'
      ];
      const filmExcludePattern = filmScannerMakes.map(m => `meta_camera_make NOT LIKE '%${m}%'`).join(' AND ');

      // Get distinct date/location combinations from images (excluding film scans)
      const imgDates = sqlite.prepare(`
        SELECT
          locid,
          subid,
          DATE(meta_date_taken) as visit_date,
          meta_camera_make,
          meta_camera_model,
          COUNT(*) as photo_count,
          GROUP_CONCAT(imghash) as hashes
        FROM imgs
        WHERE meta_date_taken IS NOT NULL
          AND locid IS NOT NULL
          AND (meta_camera_make IS NULL OR (${filmExcludePattern}))
        GROUP BY locid, subid, DATE(meta_date_taken)
        ORDER BY visit_date
      `).all() as Array<{
        locid: string;
        subid: string | null;
        visit_date: string;
        meta_camera_make: string | null;
        meta_camera_model: string | null;
        photo_count: number;
        hashes: string;
      }>;

      // Cellphone makes for auto-approval
      const cellphoneMakes = ['apple', 'samsung', 'google', 'pixel', 'oneplus', 'xiaomi', 'huawei', 'oppo', 'vivo', 'motorola', 'lg', 'sony mobile', 'htc', 'nokia', 'realme', 'poco', 'asus'];

      for (const visit of imgDates) {
        const device = visit.meta_camera_make && visit.meta_camera_model
          ? `${visit.meta_camera_make} ${visit.meta_camera_model}`.trim()
          : (visit.meta_camera_make || visit.meta_camera_model || null);

        const isCellphone = visit.meta_camera_make
          ? cellphoneMakes.some(m => visit.meta_camera_make!.toLowerCase().includes(m))
          : false;

        const dateSort = visit.visit_date ? parseInt(visit.visit_date.replace(/-/g, '')) : 99999999;
        const hashArray = visit.hashes ? visit.hashes.split(',') : [];

        sqlite.prepare(`
          INSERT INTO location_timeline (
            event_id, locid, subid, event_type, date_start, date_precision,
            date_display, date_sort, source_type, source_device,
            media_count, media_hashes, auto_approved, created_at
          ) VALUES (?, ?, ?, 'visit', ?, 'exact', ?, ?, 'exif', ?, ?, ?, ?, datetime('now'))
        `).run(
          Math.random().toString(36).substring(2, 18).padEnd(16, '0').substring(0, 16),
          visit.locid,
          visit.subid,
          visit.visit_date,
          visit.visit_date,
          dateSort,
          device,
          visit.photo_count,
          JSON.stringify(hashArray),
          isCellphone ? 1 : 0
        );
      }

      console.log(`[Migration 70] Created ${imgDates.length} visit events from existing images`);
    }

    // Migration 71: OPT-115 Enhanced capture tracking for web sources
    // Track capture method (extension vs puppeteer) and store full structured metadata
    const wsHasCaptureMethod = sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM pragma_table_info('web_sources') WHERE name = 'capture_method'
    `).get() as { cnt: number };

    if (wsHasCaptureMethod.cnt === 0) {
      console.log('Running migration 71: OPT-115 Enhanced capture tracking');

      // Add capture tracking columns
      sqlite.exec(`
        ALTER TABLE web_sources ADD COLUMN capture_method TEXT;
        ALTER TABLE web_sources ADD COLUMN extension_captured_at TEXT;
        ALTER TABLE web_sources ADD COLUMN puppeteer_captured_at TEXT;
        ALTER TABLE web_sources ADD COLUMN extension_screenshot_path TEXT;
        ALTER TABLE web_sources ADD COLUMN extension_html_path TEXT;
      `);

      // Add structured metadata columns (separate from page_metadata_json for queryability)
      sqlite.exec(`
        ALTER TABLE web_sources ADD COLUMN og_title TEXT;
        ALTER TABLE web_sources ADD COLUMN og_description TEXT;
        ALTER TABLE web_sources ADD COLUMN og_image TEXT;
        ALTER TABLE web_sources ADD COLUMN twitter_card_json TEXT;
        ALTER TABLE web_sources ADD COLUMN schema_org_json TEXT;
        ALTER TABLE web_sources ADD COLUMN http_status INTEGER;
      `);

      console.log('Migration 71 completed: OPT-115 capture tracking columns added');
    }

    // Migration 72: Image Downloader Schema
    // Perceptual hashing for duplicate detection, download source tracking, URL patterns
    // Per image-downloader-audit.md: pHash as 16-char hex for BLAKE3 consistency
    const imgsHasPhash = sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM pragma_table_info('imgs') WHERE name = 'phash'
    `).get() as { cnt: number };

    if (imgsHasPhash.cnt === 0) {
      console.log('Running migration 72: Image Downloader schema');

      // Add perceptual hash column to imgs table
      sqlite.exec(`
        ALTER TABLE imgs ADD COLUMN phash TEXT;
      `);

      // Create index on phash for duplicate detection
      // Bucket prefix enables efficient Hamming distance pre-filtering
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_imgs_phash ON imgs(phash) WHERE phash IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_imgs_phash_bucket ON imgs(substr(phash, 1, 4)) WHERE phash IS NOT NULL;
      `);

      // Download sources - provenance tracking for downloaded images
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS download_sources (
          source_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          source_url TEXT NOT NULL,
          page_url TEXT,
          site_domain TEXT NOT NULL,
          discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
          downloaded_at TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'downloading', 'staging', 'completed', 'failed', 'duplicate', 'skipped')),
          imghash TEXT REFERENCES imgs(imghash) ON DELETE SET NULL,
          original_width INTEGER,
          original_height INTEGER,
          file_size INTEGER,
          format TEXT,
          phash TEXT,
          pattern_id TEXT,
          error_message TEXT,
          retry_count INTEGER DEFAULT 0,
          metadata_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_download_sources_status ON download_sources(status);
        CREATE INDEX IF NOT EXISTS idx_download_sources_domain ON download_sources(site_domain);
        CREATE INDEX IF NOT EXISTS idx_download_sources_phash ON download_sources(phash) WHERE phash IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_download_sources_url ON download_sources(source_url);
      `);

      // URL transformation patterns (trainable for WordPress, CDNs, etc.)
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS url_patterns (
          pattern_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          site_type TEXT NOT NULL DEFAULT 'generic' CHECK (site_type IN ('wordpress', 'cdn', 'hosting', 'generic')),
          domain_regex TEXT NOT NULL,
          path_regex TEXT NOT NULL,
          transform_js TEXT NOT NULL,
          test_input TEXT,
          test_expected TEXT,
          confidence REAL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
          success_count INTEGER DEFAULT 0,
          fail_count INTEGER DEFAULT 0,
          is_enabled INTEGER DEFAULT 1,
          is_builtin INTEGER DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_url_patterns_enabled ON url_patterns(is_enabled) WHERE is_enabled = 1;
        CREATE INDEX IF NOT EXISTS idx_url_patterns_confidence ON url_patterns(confidence DESC);
      `);

      // Format preferences for quality comparison (JPG > WebP logic)
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS format_preferences (
          format TEXT PRIMARY KEY,
          priority INTEGER NOT NULL,
          quality_weight REAL DEFAULT 1.0,
          convert_to TEXT
        );

        INSERT OR IGNORE INTO format_preferences (format, priority, quality_weight, convert_to) VALUES
          ('tiff', 1, 1.0, NULL),
          ('png', 2, 1.0, NULL),
          ('jpeg', 3, 1.0, NULL),
          ('jpg', 3, 1.0, NULL),
          ('webp', 4, 0.9, NULL),
          ('avif', 5, 0.85, 'jpg'),
          ('heic', 6, 0.85, 'jpg'),
          ('gif', 7, 0.5, NULL);
      `);

      // Download staging queue for candidate comparison
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS download_staging (
          staging_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          source_id TEXT NOT NULL REFERENCES download_sources(source_id) ON DELETE CASCADE,
          staging_path TEXT NOT NULL,
          blake3_hash TEXT,
          phash TEXT,
          width INTEGER,
          height INTEGER,
          file_size INTEGER,
          format TEXT,
          quality_score REAL,
          is_selected INTEGER DEFAULT 0,
          comparison_group TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_download_staging_group ON download_staging(comparison_group);
        CREATE INDEX IF NOT EXISTS idx_download_staging_source ON download_staging(source_id);
        CREATE INDEX IF NOT EXISTS idx_download_staging_selected ON download_staging(is_selected) WHERE is_selected = 1;
      `);

      console.log('Migration 72 completed: Image Downloader schema created');
    }

    // Migration 73: Date Engine - NLP date extraction for web sources
    const hasDateExtractions = sqlite.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='date_extractions'`
    ).get();

    if (!hasDateExtractions) {
      // Main date extractions table
      sqlite.exec(`
        CREATE TABLE date_extractions (
          extraction_id TEXT PRIMARY KEY,

          -- Source reference
          source_type TEXT NOT NULL CHECK(source_type IN ('web_source', 'image_caption', 'document', 'manual')),
          source_id TEXT NOT NULL,
          locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
          subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL,

          -- Parsed date
          raw_text TEXT NOT NULL,
          parsed_date TEXT,
          date_start TEXT,
          date_end TEXT,
          date_precision TEXT NOT NULL,
          date_display TEXT,
          date_edtf TEXT,
          date_sort INTEGER,

          -- Context
          sentence TEXT NOT NULL,
          sentence_position INTEGER,
          category TEXT NOT NULL CHECK(category IN ('build_date', 'site_visit', 'obituary', 'publication', 'closure', 'opening', 'demolition', 'unknown')),
          category_confidence REAL DEFAULT 0,
          category_keywords TEXT,

          -- Rich confidence scoring
          keyword_distance INTEGER,
          sentence_position_type TEXT CHECK(sentence_position_type IN ('beginning', 'middle', 'end') OR sentence_position_type IS NULL),
          source_age_days INTEGER,
          overall_confidence REAL DEFAULT 0,

          -- Article date context (for relative dates)
          article_date TEXT,
          relative_date_anchor TEXT,
          was_relative_date INTEGER DEFAULT 0,

          -- Parsing metadata
          parser_name TEXT DEFAULT 'chrono',
          parser_confidence REAL DEFAULT 0,
          century_bias_applied INTEGER DEFAULT 0,
          original_year_ambiguous INTEGER DEFAULT 0,

          -- Duplicate detection & merging
          is_primary INTEGER DEFAULT 1,
          merged_from_ids TEXT,
          duplicate_of_id TEXT,

          -- Timeline conflict detection
          conflict_event_id TEXT REFERENCES location_timeline(event_id) ON DELETE SET NULL,
          conflict_type TEXT CHECK(conflict_type IN ('date_mismatch', 'category_mismatch', 'duplicate') OR conflict_type IS NULL),
          conflict_resolved INTEGER DEFAULT 0,

          -- Verification
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'auto_approved', 'user_approved', 'rejected', 'converted', 'reverted')),
          auto_approve_reason TEXT,
          reviewed_at TEXT,
          reviewed_by TEXT,
          rejection_reason TEXT,

          -- Timeline linkage & undo
          timeline_event_id TEXT REFERENCES location_timeline(event_id) ON DELETE SET NULL,
          converted_at TEXT,
          reverted_at TEXT,
          reverted_by TEXT,

          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT
        );

        CREATE INDEX idx_date_extractions_source ON date_extractions(source_type, source_id);
        CREATE INDEX idx_date_extractions_locid ON date_extractions(locid);
        CREATE INDEX idx_date_extractions_status ON date_extractions(status);
        CREATE INDEX idx_date_extractions_category ON date_extractions(category);
        CREATE INDEX idx_date_extractions_date_sort ON date_extractions(date_sort);
        CREATE INDEX idx_date_extractions_conflict ON date_extractions(conflict_event_id) WHERE conflict_event_id IS NOT NULL;
        CREATE INDEX idx_date_extractions_primary ON date_extractions(locid, date_start, category) WHERE is_primary = 1;
      `);

      // ML Learning table
      sqlite.exec(`
        CREATE TABLE date_engine_learning (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          keyword TEXT NOT NULL,
          approval_count INTEGER DEFAULT 0,
          rejection_count INTEGER DEFAULT 0,
          weight_modifier REAL DEFAULT 1.0,
          last_updated TEXT,
          UNIQUE(category, keyword)
        );
      `);

      // Custom regex patterns table
      sqlite.exec(`
        CREATE TABLE date_patterns (
          pattern_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          regex TEXT NOT NULL,
          category TEXT,
          priority INTEGER DEFAULT 0,
          enabled INTEGER DEFAULT 1,
          test_cases TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_date_patterns_enabled ON date_patterns(enabled, priority DESC);
      `);

      // Add extraction tracking to web_sources
      const wsColumns = sqlite.prepare(`PRAGMA table_info(web_sources)`).all() as Array<{ name: string }>;
      if (!wsColumns.some(col => col.name === 'dates_extracted_at')) {
        sqlite.exec(`ALTER TABLE web_sources ADD COLUMN dates_extracted_at TEXT`);
      }
      if (!wsColumns.some(col => col.name === 'dates_extraction_count')) {
        sqlite.exec(`ALTER TABLE web_sources ADD COLUMN dates_extraction_count INTEGER DEFAULT 0`);
      }

      console.log('Migration 73 completed: Date Engine tables created');
    }

    // Migration 74: Document Intelligence Extraction Providers
    // Stores configuration for spaCy, Ollama, and cloud LLM providers
    const tablesForMig74 = sqlite.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='extraction_providers'
    `).all() as Array<{ name: string }>;

    if (tablesForMig74.length === 0) {
      console.log('Running migration 74: Creating extraction_providers table');

      sqlite.exec(`
        -- Extraction provider configurations
        CREATE TABLE IF NOT EXISTS extraction_providers (
          provider_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('spacy', 'ollama', 'anthropic', 'google', 'openai')),
          enabled INTEGER DEFAULT 1,
          priority INTEGER DEFAULT 10,
          settings_json TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- Entity extractions (unified storage for all entity types)
        CREATE TABLE IF NOT EXISTS entity_extractions (
          extraction_id TEXT PRIMARY KEY,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          locid TEXT REFERENCES locs(locid) ON DELETE SET NULL,
          entity_type TEXT NOT NULL CHECK(entity_type IN ('date', 'person', 'organization', 'location', 'summary')),

          -- Raw extraction data
          raw_text TEXT NOT NULL,
          normalized_value TEXT,

          -- Date-specific fields
          date_start TEXT,
          date_end TEXT,
          date_precision TEXT,
          date_category TEXT,
          is_approximate INTEGER DEFAULT 0,

          -- Entity-specific fields
          entity_role TEXT,
          entity_subtype TEXT,
          mentions TEXT, -- JSON array

          -- Confidence and provenance
          overall_confidence REAL,
          provider_id TEXT,
          model_used TEXT,
          context_sentence TEXT,

          -- Review status
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'corrected')),
          reviewed_at TEXT,
          reviewed_by TEXT,
          user_correction TEXT,

          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- Document summaries (separate table for clarity)
        CREATE TABLE IF NOT EXISTS document_summaries (
          summary_id TEXT PRIMARY KEY,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          locid TEXT REFERENCES locs(locid) ON DELETE SET NULL,

          title TEXT,
          summary_text TEXT,
          key_facts TEXT, -- JSON array

          provider_id TEXT,
          model_used TEXT,
          confidence REAL,

          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'corrected')),
          reviewed_at TEXT,
          reviewed_by TEXT,

          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- Indices for common queries
        CREATE INDEX IF NOT EXISTS idx_entity_extractions_source ON entity_extractions(source_type, source_id);
        CREATE INDEX IF NOT EXISTS idx_entity_extractions_locid ON entity_extractions(locid) WHERE locid IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_entity_extractions_type ON entity_extractions(entity_type);
        CREATE INDEX IF NOT EXISTS idx_entity_extractions_status ON entity_extractions(status);

        CREATE INDEX IF NOT EXISTS idx_document_summaries_source ON document_summaries(source_type, source_id);
        CREATE INDEX IF NOT EXISTS idx_document_summaries_locid ON document_summaries(locid) WHERE locid IS NOT NULL;
      `);

      console.log('Migration 74 completed: Document Intelligence tables created');
    }

    // Migration 75: Extraction Pipeline - Smart titles, summaries, auto-tagging
    // OPT-120: Background LLM extraction for web sources
    // Adds smart_title, smart_summary to web_sources and location_timeline
    // Adds location_type, era to locs for auto-tagging
    const wsHasSmartTitle = sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM pragma_table_info('web_sources') WHERE name = 'smart_title'
    `).get() as { cnt: number };

    if (wsHasSmartTitle.cnt === 0) {
      console.log('Running migration 75: Extraction Pipeline columns');

      // Add smart extraction columns to web_sources
      sqlite.exec(`
        ALTER TABLE web_sources ADD COLUMN smart_title TEXT;
        ALTER TABLE web_sources ADD COLUMN smart_summary TEXT;
        ALTER TABLE web_sources ADD COLUMN extraction_status TEXT DEFAULT 'pending';
        ALTER TABLE web_sources ADD COLUMN extraction_confidence REAL;
        ALTER TABLE web_sources ADD COLUMN extraction_provider TEXT;
        ALTER TABLE web_sources ADD COLUMN extraction_model TEXT;
        ALTER TABLE web_sources ADD COLUMN extraction_completed_at TEXT;
      `);

      // Add auto-tagging columns to locs
      // Note: 'status' already exists for abandoned/active status
      sqlite.exec(`
        ALTER TABLE locs ADD COLUMN location_type TEXT;
        ALTER TABLE locs ADD COLUMN era TEXT;
      `);

      // Add smart title/summary columns to location_timeline
      sqlite.exec(`
        ALTER TABLE location_timeline ADD COLUMN smart_title TEXT;
        ALTER TABLE location_timeline ADD COLUMN tldr TEXT;
        ALTER TABLE location_timeline ADD COLUMN confidence REAL;
        ALTER TABLE location_timeline ADD COLUMN needs_review INTEGER DEFAULT 0;
      `);

      // Create extraction_queue for background processing
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS extraction_queue (
          queue_id TEXT PRIMARY KEY,
          source_type TEXT NOT NULL CHECK(source_type IN ('web_source', 'document', 'media')),
          source_id TEXT NOT NULL,
          locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,

          -- Tasks to run
          tasks TEXT NOT NULL, -- JSON array: ['dates', 'entities', 'title', 'summary']

          -- Status
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'partial')),
          priority INTEGER DEFAULT 0,
          attempts INTEGER DEFAULT 0,
          max_attempts INTEGER DEFAULT 3,

          -- Results
          results_json TEXT,
          error_message TEXT,

          -- Timestamps
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          started_at TEXT,
          completed_at TEXT,

          UNIQUE(source_type, source_id)
        );

        CREATE INDEX IF NOT EXISTS idx_extraction_queue_status ON extraction_queue(status, priority DESC);
        CREATE INDEX IF NOT EXISTS idx_extraction_queue_locid ON extraction_queue(locid);
      `);

      // Create indices for new columns
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_ws_extraction_status ON web_sources(extraction_status);
        CREATE INDEX IF NOT EXISTS idx_locs_location_type ON locs(location_type);
        CREATE INDEX IF NOT EXISTS idx_locs_era ON locs(era);
        CREATE INDEX IF NOT EXISTS idx_timeline_needs_review ON location_timeline(needs_review) WHERE needs_review = 1;
      `);

      console.log('Migration 75 completed: Extraction Pipeline columns and queue created');
    }

    // Migration 76: RAM++ Image Auto-Tagging System
    // Adds ML-generated tags to images with confidence scores
    // Creates location_tag_summary for aggregated location-level insights
    const imgHasAutoTags = sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM pragma_table_info('imgs') WHERE name = 'auto_tags'
    `).get() as { cnt: number };

    if (imgHasAutoTags.cnt === 0) {
      console.log('Running migration 76: RAM++ Image Auto-Tagging System');

      // Add auto-tagging columns to imgs table
      sqlite.exec(`
        -- ML-generated tags stored as JSON array: ["abandoned", "factory", "graffiti"]
        ALTER TABLE imgs ADD COLUMN auto_tags TEXT;
        -- Source: 'ram++' (ML), 'manual' (user), 'hybrid' (user edited ML tags)
        ALTER TABLE imgs ADD COLUMN auto_tags_source TEXT;
        -- Per-tag confidence scores: {"abandoned": 0.95, "factory": 0.87}
        ALTER TABLE imgs ADD COLUMN auto_tags_confidence TEXT;
        -- ISO timestamp when tags were generated
        ALTER TABLE imgs ADD COLUMN auto_tags_at TEXT;
        -- Quality score for hero selection (0-1, higher = better)
        ALTER TABLE imgs ADD COLUMN quality_score REAL;
        -- Detected view type: 'interior', 'exterior', 'aerial', 'detail'
        ALTER TABLE imgs ADD COLUMN view_type TEXT;
      `);

      // Create location_tag_summary table for aggregated location-level insights
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS location_tag_summary (
          locid TEXT PRIMARY KEY REFERENCES locs(locid) ON DELETE CASCADE,

          -- Aggregated tags from all images (top 20 by frequency)
          dominant_tags TEXT,           -- JSON: ["factory", "machinery", "decay"]
          tag_counts TEXT,              -- JSON: {"factory": 45, "machinery": 32}

          -- Auto-suggested values from tag analysis
          suggested_type TEXT,          -- Auto-detected location type
          suggested_type_confidence REAL,
          suggested_era TEXT,           -- Inferred from architecture tags
          suggested_era_confidence REAL,

          -- Image statistics
          total_images INTEGER DEFAULT 0,
          tagged_images INTEGER DEFAULT 0,
          interior_count INTEGER DEFAULT 0,
          exterior_count INTEGER DEFAULT 0,
          aerial_count INTEGER DEFAULT 0,

          -- Condition indicators from tags
          has_graffiti INTEGER DEFAULT 0,
          has_equipment INTEGER DEFAULT 0,
          has_decay INTEGER DEFAULT 0,
          has_nature_reclaim INTEGER DEFAULT 0,
          condition_score REAL,         -- 0-1, aggregated from decay/condition tags

          -- Best hero candidate (highest quality exterior shot)
          best_hero_imghash TEXT,
          best_hero_score REAL,

          -- Timestamps
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_loc_tag_summary_suggested ON location_tag_summary(suggested_type);
      `);

      // Create image_tagging_queue for tracking tagging jobs
      // This is separate from the main jobs table for better querying
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS image_tagging_queue (
          imghash TEXT PRIMARY KEY,
          locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
          image_path TEXT NOT NULL,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
          priority INTEGER DEFAULT 0,
          attempts INTEGER DEFAULT 0,
          error_message TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          started_at TEXT,
          completed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_img_tag_queue_status ON image_tagging_queue(status, priority DESC);
        CREATE INDEX IF NOT EXISTS idx_img_tag_queue_locid ON image_tagging_queue(locid);
      `);

      // Create indices for tag queries
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_imgs_auto_tags ON imgs(auto_tags) WHERE auto_tags IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_imgs_view_type ON imgs(view_type) WHERE view_type IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_imgs_quality_score ON imgs(quality_score) WHERE quality_score IS NOT NULL;
      `);

      console.log('Migration 76 completed: RAM++ Image Auto-Tagging System created');
    }

    // Migration 77: People profiles table for extracted person entities
    const hasPeopleProfiles = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='people_profiles'"
    ).get();

    if (!hasPeopleProfiles) {
      console.log('Running migration 77: People profiles table');
      sqlite.exec(`
        CREATE TABLE people_profiles (
          profile_id TEXT PRIMARY KEY,
          locid TEXT NOT NULL,
          full_name TEXT NOT NULL,
          normalized_name TEXT,
          role TEXT DEFAULT 'unknown',
          date_start TEXT,
          date_end TEXT,
          key_facts TEXT,
          photo_hash TEXT,
          social_links TEXT,
          source_refs TEXT,
          aliases TEXT,
          confidence REAL DEFAULT 0.5,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'merged')),
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (locid) REFERENCES locs(locid) ON DELETE CASCADE
        );

        CREATE INDEX idx_people_profiles_locid ON people_profiles(locid);
        CREATE INDEX idx_people_profiles_normalized ON people_profiles(normalized_name);
        CREATE INDEX idx_people_profiles_status ON people_profiles(status);
      `);
      console.log('Migration 77 completed: People profiles table created');
    }

    // Migration 78: Company profiles table for extracted organization entities
    const hasCompanyProfiles = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='company_profiles'"
    ).get();

    if (!hasCompanyProfiles) {
      console.log('Running migration 78: Company profiles table');
      sqlite.exec(`
        CREATE TABLE company_profiles (
          profile_id TEXT PRIMARY KEY,
          locid TEXT NOT NULL,
          full_name TEXT NOT NULL,
          normalized_name TEXT,
          org_type TEXT DEFAULT 'unknown',
          industry TEXT,
          relationship TEXT DEFAULT 'unknown',
          date_start TEXT,
          date_end TEXT,
          key_facts TEXT,
          logo_hash TEXT,
          logo_source TEXT,
          source_refs TEXT,
          aliases TEXT,
          confidence REAL DEFAULT 0.5,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'merged')),
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (locid) REFERENCES locs(locid) ON DELETE CASCADE
        );

        CREATE INDEX idx_company_profiles_locid ON company_profiles(locid);
        CREATE INDEX idx_company_profiles_normalized ON company_profiles(normalized_name);
        CREATE INDEX idx_company_profiles_status ON company_profiles(status);
      `);
      console.log('Migration 78 completed: Company profiles table created');
    }

    // Migration 79: Fact conflicts table for tracking contradictory information
    const hasFactConflicts = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='fact_conflicts'"
    ).get();

    if (!hasFactConflicts) {
      console.log('Running migration 79: Fact conflicts table');
      sqlite.exec(`
        CREATE TABLE fact_conflicts (
          conflict_id TEXT PRIMARY KEY,
          locid TEXT NOT NULL,
          conflict_type TEXT NOT NULL CHECK(conflict_type IN ('date_mismatch', 'name_mismatch', 'fact_mismatch', 'role_mismatch', 'type_mismatch')),
          field_name TEXT NOT NULL,
          claim_a_value TEXT,
          claim_a_source TEXT,
          claim_a_confidence REAL,
          claim_a_context TEXT,
          claim_b_value TEXT,
          claim_b_source TEXT,
          claim_b_confidence REAL,
          claim_b_context TEXT,
          resolved INTEGER DEFAULT 0,
          resolution TEXT CHECK(resolution IN ('claim_a', 'claim_b', 'both_valid', 'neither', 'merged')),
          resolution_notes TEXT,
          resolved_by TEXT,
          resolved_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (locid) REFERENCES locs(locid) ON DELETE CASCADE
        );

        CREATE INDEX idx_fact_conflicts_locid ON fact_conflicts(locid);
        CREATE INDEX idx_fact_conflicts_resolved ON fact_conflicts(resolved);
        CREATE INDEX idx_fact_conflicts_type ON fact_conflicts(conflict_type);
      `);
      console.log('Migration 79 completed: Fact conflicts table created');
    }

    // Migration 80: Extraction inputs table for replay capability
    const hasExtractionInputs = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='extraction_inputs'"
    ).get();

    if (!hasExtractionInputs) {
      console.log('Running migration 80: Extraction inputs table');
      sqlite.exec(`
        CREATE TABLE extraction_inputs (
          input_id TEXT PRIMARY KEY,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          locid TEXT,
          raw_text TEXT NOT NULL,
          preprocessing_json TEXT,
          extraction_json TEXT,
          prompt_version TEXT,
          provider TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (locid) REFERENCES locs(locid) ON DELETE SET NULL
        );

        CREATE INDEX idx_extraction_inputs_source ON extraction_inputs(source_type, source_id);
        CREATE INDEX idx_extraction_inputs_locid ON extraction_inputs(locid);
      `);
      console.log('Migration 80 completed: Extraction inputs table created');
    }

    // Migration 81: Source authority table for ranking source credibility
    const hasSourceAuthority = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='source_authority'"
    ).get();

    if (!hasSourceAuthority) {
      console.log('Running migration 81: Source authority table');
      sqlite.exec(`
        CREATE TABLE source_authority (
          domain TEXT PRIMARY KEY,
          tier INTEGER NOT NULL DEFAULT 3 CHECK(tier BETWEEN 1 AND 4),
          notes TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Default authority tiers
        INSERT INTO source_authority (domain, tier, notes) VALUES
          ('wikipedia.org', 2, 'Encyclopedia - verify citations'),
          ('newspapers.com', 1, 'Historical newspaper archive'),
          ('findagrave.com', 2, 'Cemetery records'),
          ('ancestry.com', 2, 'Genealogy records'),
          ('loc.gov', 1, 'Library of Congress'),
          ('archives.gov', 1, 'National Archives'),
          ('nps.gov', 1, 'National Park Service'),
          ('historicaerials.com', 2, 'Aerial photography archive');
      `);
      console.log('Migration 81 completed: Source authority table created with defaults');
    }

    // Migration 82: Add multi-source support to location_timeline
    const timelineCols = sqlite.prepare("PRAGMA table_info(location_timeline)").all() as { name: string }[];
    if (!timelineCols.some((c: { name: string }) => c.name === 'source_refs')) {
      console.log('Running migration 82: Multi-source support for location_timeline');
      sqlite.exec(`
        ALTER TABLE location_timeline ADD COLUMN source_refs TEXT;
        ALTER TABLE location_timeline ADD COLUMN verb_context TEXT;
        ALTER TABLE location_timeline ADD COLUMN prompt_version TEXT;
      `);
      console.log('Migration 82 completed: Multi-source columns added to location_timeline');
    }

    // Migration 83: Add profile columns to entity_extractions
    const entityCols = sqlite.prepare("PRAGMA table_info(entity_extractions)").all() as { name: string }[];
    if (!entityCols.some((c: { name: string }) => c.name === 'profile_json')) {
      console.log('Running migration 83: Profile columns for entity_extractions');
      sqlite.exec(`
        ALTER TABLE entity_extractions ADD COLUMN profile_json TEXT;
        ALTER TABLE entity_extractions ADD COLUMN normalized_name TEXT;
        ALTER TABLE entity_extractions ADD COLUMN aliases TEXT;
        ALTER TABLE entity_extractions ADD COLUMN cross_location_refs TEXT;
        ALTER TABLE entity_extractions ADD COLUMN prompt_version TEXT;
      `);
      // Create index for normalized name lookups
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_entity_extractions_normalized ON entity_extractions(normalized_name);
      `);
      console.log('Migration 83 completed: Profile columns added to entity_extractions');
    }

    // Migration 84: Extracted addresses table for address validation
    // Per LLM Tools Overhaul: Extract addresses from web sources to validate/suggest corrections
    const hasExtractedAddresses = tableNames.includes('extracted_addresses');
    if (!hasExtractedAddresses) {
      console.log('Running migration 84: Creating extracted_addresses table');
      sqlite.exec(`
        CREATE TABLE extracted_addresses (
          address_id TEXT PRIMARY KEY,
          locid TEXT NOT NULL REFERENCES locs(locid) ON DELETE CASCADE,
          source_id TEXT NOT NULL,
          source_type TEXT DEFAULT 'web',

          -- Address components (normalized)
          street TEXT,
          city TEXT,
          county TEXT,
          state TEXT CHECK(state IS NULL OR length(state) = 2),
          zipcode TEXT,
          full_address TEXT NOT NULL,

          -- Extraction metadata
          confidence REAL DEFAULT 0.5 CHECK(confidence >= 0 AND confidence <= 1),
          context_sentence TEXT,
          verb_context TEXT,
          prompt_version TEXT,

          -- Status workflow
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'applied')),

          -- Comparison with location address
          matches_location INTEGER DEFAULT 0,
          suggested_corrections TEXT,

          -- Timestamps
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          applied_at TEXT,
          applied_by TEXT,

          UNIQUE(locid, full_address)
        );

        CREATE INDEX idx_extracted_addresses_locid ON extracted_addresses(locid);
        CREATE INDEX idx_extracted_addresses_status ON extracted_addresses(status);
        CREATE INDEX idx_extracted_addresses_source ON extracted_addresses(source_id);
      `);
      console.log('Migration 84 completed: extracted_addresses table created');
    }

    // Migration 85: Credentials table for encrypted API key storage
    // Per LiteLLM Integration Plan: Secure storage using Electron safeStorage
    const hasCredentialsTable = tableNames.includes('credentials');
    if (!hasCredentialsTable) {
      console.log('Running migration 85: Creating credentials table');
      sqlite.exec(`
        CREATE TABLE credentials (
          provider TEXT PRIMARY KEY,
          encrypted_key TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      console.log('Migration 85 completed: credentials table created');
    }

    // Migration 86: LiteLLM settings table for proxy configuration
    // Per LiteLLM Integration Plan: Unified AI gateway configuration
    const hasLiteLLMSettings = tableNames.includes('litellm_settings');
    if (!hasLiteLLMSettings) {
      console.log('Running migration 86: Creating litellm_settings table');
      sqlite.exec(`
        CREATE TABLE litellm_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        -- Insert default settings
        INSERT INTO litellm_settings (key, value) VALUES
          ('default_model', 'extraction-local'),
          ('auto_start', 'true'),
          ('idle_timeout_minutes', '10'),
          ('max_concurrent', '5'),
          ('log_level', 'warning'),
          ('port', '4000'),
          ('privacy_enabled', 'true'),
          ('privacy_redact_gps', 'true'),
          ('privacy_redact_addresses', 'true'),
          ('privacy_redact_phones', 'false'),
          ('privacy_redact_emails', 'false'),
          ('privacy_excluded_locations', '[]');
      `);
      console.log('Migration 86 completed: litellm_settings table created with defaults');
    }

    // Migration 87: Update extraction_providers CHECK constraint to include 'litellm'
    // SQLite doesn't support ALTER CHECK, so we recreate the table
    const providerTypeCheck = sqlite.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type='table' AND name='extraction_providers'
    `).get() as { sql: string } | undefined;

    if (providerTypeCheck && !providerTypeCheck.sql.includes("'litellm'")) {
      console.log('Running migration 87: Adding litellm to extraction_providers type constraint');

      sqlite.exec(`
        -- Create new table with updated CHECK constraint
        CREATE TABLE extraction_providers_new (
          provider_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('spacy', 'ollama', 'anthropic', 'google', 'openai', 'litellm')),
          enabled INTEGER DEFAULT 1,
          priority INTEGER DEFAULT 10,
          settings_json TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- Copy existing data
        INSERT INTO extraction_providers_new
        SELECT * FROM extraction_providers;

        -- Drop old table and rename new one
        DROP TABLE extraction_providers;
        ALTER TABLE extraction_providers_new RENAME TO extraction_providers;
      `);

      console.log('Migration 87 completed: extraction_providers now supports litellm type');
    }

    // Migration 88: Create extraction_costs table for LLM usage tracking
    const hasCostsTable = sqlite.prepare(`
      SELECT 1 FROM sqlite_master WHERE type='table' AND name='extraction_costs'
    `).get();

    if (!hasCostsTable) {
      console.log('Running migration 88: Creating extraction_costs table');
      sqlite.exec(`
        CREATE TABLE extraction_costs (
          cost_id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
          cost_usd REAL NOT NULL DEFAULT 0,
          locid TEXT REFERENCES locs(locid) ON DELETE SET NULL,
          source_type TEXT,
          source_id TEXT,
          operation TEXT,
          duration_ms INTEGER,
          success INTEGER DEFAULT 1,
          error_message TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- Index for querying by provider/model
        CREATE INDEX idx_extraction_costs_provider ON extraction_costs(provider, model);

        -- Index for querying by location
        CREATE INDEX idx_extraction_costs_locid ON extraction_costs(locid) WHERE locid IS NOT NULL;

        -- Index for time-based queries (daily/monthly reports)
        CREATE INDEX idx_extraction_costs_created ON extraction_costs(created_at);

        -- Index for cost aggregation
        CREATE INDEX idx_extraction_costs_aggregate ON extraction_costs(provider, created_at, cost_usd);
      `);
      console.log('Migration 88 completed: extraction_costs table created');
    }

    // Migration 89: VLM Enhancement columns for Stage 2 deep analysis
    // Stores results from Qwen3-VL or similar large vision-language models
    const imgsColumnsFor89 = sqlite.prepare(`PRAGMA table_info(imgs)`).all() as Array<{ name: string }>;
    const hasVLMDescription = imgsColumnsFor89.some(col => col.name === 'vlm_description');

    if (!hasVLMDescription) {
      sqlite.exec(`
        -- Rich natural language description from VLM
        ALTER TABLE imgs ADD COLUMN vlm_description TEXT;

        -- Short caption suitable for alt text
        ALTER TABLE imgs ADD COLUMN vlm_caption TEXT;

        -- Architectural style detected (Art Deco, Mid-Century Modern, etc.)
        ALTER TABLE imgs ADD COLUMN vlm_architectural_style TEXT;

        -- Estimated construction period (stored as JSON for start/end/confidence/reasoning)
        ALTER TABLE imgs ADD COLUMN vlm_period_json TEXT;

        -- Condition assessment (stored as JSON with overall/score/details/observations)
        ALTER TABLE imgs ADD COLUMN vlm_condition_json TEXT;

        -- Notable features (stored as JSON array)
        ALTER TABLE imgs ADD COLUMN vlm_features_json TEXT;

        -- Search keywords (stored as JSON array)
        ALTER TABLE imgs ADD COLUMN vlm_keywords_json TEXT;

        -- Model used for VLM enhancement
        ALTER TABLE imgs ADD COLUMN vlm_model TEXT;

        -- Timestamp of VLM enhancement
        ALTER TABLE imgs ADD COLUMN vlm_enhanced_at TEXT;
      `);
      console.log('Migration 89 completed: VLM Enhancement columns added to imgs');
    }

  } catch (error) {
    console.error('Error running migrations:', error);
    throw error;
  }
}

/**
 * OPT-044: Ensure critical performance indices exist
 * Runs every startup to handle DBs created before indices were added
 * This is a safety net - indices should also be in SCHEMA_SQL and migrations
 */
function ensureCriticalIndices(sqlite: Database.Database): void {
  const criticalIndices = [
    {
      name: 'idx_locs_map_bounds',
      sql: `CREATE INDEX IF NOT EXISTS idx_locs_map_bounds ON locs(
        gps_lat, gps_lng, locid, locnam, category, gps_verified_on_map, address_state, address_city, favorite
      ) WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL`,
      description: 'Covering index for Atlas findInBoundsForMap queries'
    },
    {
      name: 'idx_locs_gps',
      sql: `CREATE INDEX IF NOT EXISTS idx_locs_gps ON locs(gps_lat, gps_lng) WHERE gps_lat IS NOT NULL`,
      description: 'Basic GPS index for spatial queries'
    }
  ];

  for (const { name, sql, description } of criticalIndices) {
    const exists = sqlite.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='index' AND name=?`
    ).get(name);

    if (!exists) {
      console.log(`[Database] Creating missing critical index: ${name} (${description})`);
      sqlite.exec(sql);
      console.log(`[Database] ${name} created successfully`);
    }
  }
}

/**
 * Get or create the database instance
 * Initializes the database on first run
 * FIX: Checks for TABLE existence, not just FILE existence
 */
export function getDatabase(): Kysely<DatabaseSchema> {
  if (db) {
    return db;
  }

  const dbPath = getDatabasePath();
  const fileExists = fs.existsSync(dbPath);

  // OPT-108: SQL logging opt-in via DEBUG_SQL=1 (was flooding console with job worker queries)
  const sqlite = new Database(dbPath, {
    verbose: process.env.DEBUG_SQL === '1' ? console.log : undefined,
  });

  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Check if schema exists (tables present), not just if file exists
  // This fixes boot loops caused by empty database files
  const schemaExists = hasSchema(sqlite);

  if (!schemaExists) {
    if (fileExists) {
      console.log('Database file exists but has no schema, reinitializing:', dbPath);
    } else {
      console.log('Creating new database at:', dbPath);
    }
    initializeSchema(sqlite);
  } else {
    console.log('Using existing database at:', dbPath);
  }

  // Always run migrations to ensure all tables exist
  runMigrations(sqlite);

  // OPT-044: Ensure critical performance indices exist (safety net for older DBs)
  ensureCriticalIndices(sqlite);

  const dialect = new SqliteDialect({
    database: sqlite,
  });

  db = new Kysely<DatabaseSchema>({
    dialect,
  });

  // Store raw sqlite instance for services that need it
  sqliteDb = sqlite;

  return db;
}

/**
 * Get the raw better-sqlite3 database instance
 * Use this for services that need direct SQL access
 */
export function getRawDatabase(): SqliteDatabase {
  if (!sqliteDb) {
    // Initialize database if not already done
    getDatabase();
  }
  if (!sqliteDb) {
    throw new Error('Database not initialized');
  }
  return sqliteDb;
}

/**
 * Close the database connection
 * Should be called when the app is closing
 */
export function closeDatabase(): void {
  if (db) {
    db.destroy();
    db = null;
    console.log('Database connection closed');
  }
}
