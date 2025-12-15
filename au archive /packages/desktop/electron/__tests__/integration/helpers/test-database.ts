import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { Database as DatabaseSchema } from '../../../main/database.types';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create a test database with schema
 */
export function createTestDatabase(): {
  db: Kysely<DatabaseSchema>;
  dbPath: string;
  cleanup: () => void;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-test-db-'));
  const dbPath = path.join(tempDir, 'test.db');

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Initialize schema
  const schemaPath = path.join(__dirname, '../../../main/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    sqlite.exec(statement);
  }

  const dialect = new SqliteDialect({ database: sqlite });
  const db = new Kysely<DatabaseSchema>({ dialect });

  const cleanup = () => {
    db.destroy();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };

  return { db, dbPath, cleanup };
}

/**
 * Create test location data with all required fields per database.types.ts
 * Use this for direct database inserts via Kysely
 */
// ADR-046: Generate BLAKE3-like 16-char hex ID for testing
function generateTestBlake3Id(): string {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

export function createTestLocation(overrides: Record<string, unknown> = {}) {
  return {
    // Identity - ADR-046: locid is BLAKE3 16-char hex
    locid: generateTestBlake3Id(),
    locnam: 'Test Location',

    // GPS verification flags (required numbers)
    gps_verified_on_map: 0,

    // Address verification flags (required numbers)
    address_verified: 0,

    // Location verification (required numbers)
    location_verified: 0,
    country_cultural_region_verified: 0,
    local_cultural_region_verified: 0,

    // Status flags (required numbers)
    historic: 0,
    favorite: 0,
    project: 0,

    // Documentation flags (required numbers)
    doc_interior: 0,
    doc_exterior: 0,
    doc_drone: 0,
    doc_web_history: 0,
    doc_map_find: 0,

    // Name verification flags (required numbers)
    locnam_verified: 0,
    historical_name_verified: 0,
    akanam_verified: 0,

    // Hero focal point (required numbers)
    hero_focal_x: 0.5,
    hero_focal_y: 0.5,

    // Host only flag
    is_host_only: 0,

    // View tracking (required number)
    view_count: 0,

    // Media counts (required numbers)
    img_count: 0,
    vid_count: 0,
    doc_count: 0,
    map_count: 0,
    total_size_bytes: 0,

    // Timestamps
    locadd: new Date().toISOString(),
    locup: new Date().toISOString(),

    ...overrides,
  };
}

/**
 * Create valid LocationInput for repository.create() calls
 * This matches the LocationInputSchema from @au-archive/core
 */
export function createLocationInput(overrides: Record<string, any> = {}) {
  return {
    locnam: overrides.locnam || 'Test Location',
    historic: false,
    favorite: false,
    project: false,
    docInterior: false,
    docExterior: false,
    docDrone: false,
    docWebHistory: false,
    docMapFind: false,
    locnamVerified: false,
    akanamVerified: false,
    isHostOnly: false,
    ...overrides,
  };
}

/**
 * Create test image data for mediaRepo.createImage() calls
 * Does NOT include imgadd - repository handles that
 * ADR-049: Uses 16-char hex IDs
 */
export function createTestImage(locid: string, overrides: Record<string, unknown> = {}) {
  const hash = (overrides.imghash as string) || generateTestBlake3Id();
  const imgnam = (overrides.imgnam as string) || `${hash}.jpg`;
  return {
    // Identity
    imghash: hash,
    imgnam,
    imgnamo: 'test-image.jpg',
    imgloc: `/archive/images/${hash}.jpg`,
    imgloco: '/original/path/test-image.jpg',
    locid,
    auth_imp: 'Test User',

    // Required number flags
    preview_extracted: 0,
    xmp_synced: 0,
    hidden: 0,
    is_live_photo: 0,
    is_contributed: 0,
    extracted_from_web: 0,

    ...overrides,
  };
}

/**
 * Create test image data for direct Kysely insert (includes imgadd)
 */
export function createTestImageForInsert(locid: string, overrides: Record<string, unknown> = {}) {
  return {
    ...createTestImage(locid, overrides),
    imgadd: new Date().toISOString(),
  };
}
