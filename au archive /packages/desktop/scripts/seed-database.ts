#!/usr/bin/env npx ts-node
/**
 * AU Archive Database Seeder
 *
 * Seeds the database with test locations and sets the archive_folder.
 * Run with: npx ts-node scripts/seed-database.ts
 *
 * Options:
 *   --archive-folder <path>  Set the archive folder path
 *   --seed-locations         Seed 20 test locations
 *   --clear                  Clear existing data before seeding
 */

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

// Database path (same as the app uses)
function getDatabasePath(): string {
  const userDataPath = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    '@au-archive',
    'desktop',
    'data'
  );

  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  return path.join(userDataPath, 'au-archive.db');
}

// Generate a 12-character short ID
function generateLoc12(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 6);

  const random = crypto.randomBytes(3).toString('hex');
  return `${slug}-${random}`;
}

// Test locations data for New York State
const testLocations = [
  {
    locnam: 'Grossinger\'s Catskill Resort',
    type: 'Resort',
    stype: 'Hotel',
    address_city: 'Liberty',
    address_county: 'Sullivan',
    address_state: 'NY',
    address_zipcode: '12754',
    gps_lat: 41.8012,
    gps_lng: -74.7468,
    condition: 'demolished',
    status: 'demolished',
    access: 'none',
  },
  {
    locnam: 'Eastern State Penitentiary',
    type: 'Prison',
    stype: 'Correctional Facility',
    address_city: 'Philadelphia',
    address_county: 'Philadelphia',
    address_state: 'PA',
    address_zipcode: '19130',
    gps_lat: 39.9683,
    gps_lng: -75.1727,
    condition: 'stabilized',
    status: 'museum',
    access: 'public',
  },
  {
    locnam: 'Greystone Park Psychiatric Hospital',
    type: 'Hospital',
    stype: 'Psychiatric',
    address_city: 'Parsippany',
    address_county: 'Morris',
    address_state: 'NJ',
    address_zipcode: '07054',
    gps_lat: 40.8442,
    gps_lng: -74.4175,
    condition: 'demolished',
    status: 'demolished',
    access: 'none',
  },
  {
    locnam: 'Buffalo Central Terminal',
    type: 'Transportation',
    stype: 'Train Station',
    address_city: 'Buffalo',
    address_county: 'Erie',
    address_state: 'NY',
    address_zipcode: '14211',
    gps_lat: 42.8831,
    gps_lng: -78.8175,
    condition: 'restoring',
    status: 'restoration',
    access: 'limited',
  },
  {
    locnam: 'Kings Park Psychiatric Center',
    type: 'Hospital',
    stype: 'Psychiatric',
    address_city: 'Kings Park',
    address_county: 'Suffolk',
    address_state: 'NY',
    address_zipcode: '11754',
    gps_lat: 40.8854,
    gps_lng: -73.2456,
    condition: 'abandoned',
    status: 'abandoned',
    access: 'restricted',
  },
  {
    locnam: 'Letchworth Village',
    type: 'Hospital',
    stype: 'Developmental Center',
    address_city: 'Thiells',
    address_county: 'Rockland',
    address_state: 'NY',
    address_zipcode: '10984',
    gps_lat: 41.2109,
    gps_lng: -74.0673,
    condition: 'deteriorating',
    status: 'abandoned',
    access: 'restricted',
  },
  {
    locnam: 'Pilgrim State Hospital',
    type: 'Hospital',
    stype: 'Psychiatric',
    address_city: 'Brentwood',
    address_county: 'Suffolk',
    address_state: 'NY',
    address_zipcode: '11717',
    gps_lat: 40.7736,
    gps_lng: -73.2562,
    condition: 'partial',
    status: 'partial_use',
    access: 'restricted',
  },
  {
    locnam: 'Bethlehem Steel',
    type: 'Industrial',
    stype: 'Steel Mill',
    address_city: 'Lackawanna',
    address_county: 'Erie',
    address_state: 'NY',
    address_zipcode: '14218',
    gps_lat: 42.8167,
    gps_lng: -78.8333,
    condition: 'demolished',
    status: 'demolished',
    access: 'none',
  },
  {
    locnam: 'Hudson River State Hospital',
    type: 'Hospital',
    stype: 'Psychiatric',
    address_city: 'Poughkeepsie',
    address_county: 'Dutchess',
    address_state: 'NY',
    address_zipcode: '12601',
    gps_lat: 41.7081,
    gps_lng: -73.9075,
    condition: 'deteriorating',
    status: 'redevelopment',
    access: 'restricted',
  },
  {
    locnam: 'Willard Asylum',
    type: 'Hospital',
    stype: 'Psychiatric',
    address_city: 'Willard',
    address_county: 'Seneca',
    address_state: 'NY',
    address_zipcode: '14588',
    gps_lat: 42.6845,
    gps_lng: -76.8684,
    condition: 'partial',
    status: 'partial_use',
    access: 'restricted',
  },
  {
    locnam: 'Rochester Subway',
    type: 'Transportation',
    stype: 'Subway',
    address_city: 'Rochester',
    address_county: 'Monroe',
    address_state: 'NY',
    address_zipcode: '14604',
    gps_lat: 43.1566,
    gps_lng: -77.6088,
    condition: 'abandoned',
    status: 'abandoned',
    access: 'restricted',
  },
  {
    locnam: 'Carousel Mall (Destiny USA parking)',
    type: 'Commercial',
    stype: 'Shopping Mall',
    address_city: 'Syracuse',
    address_county: 'Onondaga',
    address_state: 'NY',
    address_zipcode: '13290',
    gps_lat: 43.0667,
    gps_lng: -76.1667,
    condition: 'operational',
    status: 'operational',
    access: 'public',
  },
  {
    locnam: 'Harlem Valley Psychiatric Center',
    type: 'Hospital',
    stype: 'Psychiatric',
    address_city: 'Wingdale',
    address_county: 'Dutchess',
    address_state: 'NY',
    address_zipcode: '12594',
    gps_lat: 41.6364,
    gps_lng: -73.5447,
    condition: 'demolished',
    status: 'demolished',
    access: 'none',
  },
  {
    locnam: 'Fort Totten',
    type: 'Military',
    stype: 'Fort',
    address_city: 'Bayside',
    address_county: 'Queens',
    address_state: 'NY',
    address_zipcode: '11359',
    gps_lat: 40.7928,
    gps_lng: -73.7750,
    condition: 'preserved',
    status: 'park',
    access: 'public',
  },
  {
    locnam: 'North Brother Island',
    type: 'Hospital',
    stype: 'Quarantine',
    address_city: 'Bronx',
    address_county: 'Bronx',
    address_state: 'NY',
    address_zipcode: '10474',
    gps_lat: 40.8011,
    gps_lng: -73.9000,
    condition: 'deteriorating',
    status: 'abandoned',
    access: 'restricted',
  },
  {
    locnam: 'Bannerman Castle',
    type: 'Military',
    stype: 'Arsenal',
    address_city: 'Beacon',
    address_county: 'Dutchess',
    address_state: 'NY',
    address_zipcode: '12508',
    gps_lat: 41.4533,
    gps_lng: -73.9867,
    condition: 'ruins',
    status: 'historic_site',
    access: 'limited',
  },
  {
    locnam: 'Utica State Hospital',
    type: 'Hospital',
    stype: 'Psychiatric',
    address_city: 'Utica',
    address_county: 'Oneida',
    address_state: 'NY',
    address_zipcode: '13502',
    gps_lat: 43.1009,
    gps_lng: -75.2327,
    condition: 'partial',
    status: 'mixed_use',
    access: 'limited',
  },
  {
    locnam: 'Ellis Island Hospital',
    type: 'Hospital',
    stype: 'Immigration',
    address_city: 'Jersey City',
    address_county: 'Hudson',
    address_state: 'NJ',
    address_zipcode: '07305',
    gps_lat: 40.6992,
    gps_lng: -74.0392,
    condition: 'stabilized',
    status: 'tours',
    access: 'limited',
  },
  {
    locnam: 'Borscht Belt Hotels Ruins',
    type: 'Resort',
    stype: 'Hotel',
    address_city: 'Monticello',
    address_county: 'Sullivan',
    address_state: 'NY',
    address_zipcode: '12701',
    gps_lat: 41.6556,
    gps_lng: -74.6900,
    condition: 'ruins',
    status: 'abandoned',
    access: 'restricted',
  },
  {
    locnam: 'Central Islip State Hospital',
    type: 'Hospital',
    stype: 'Psychiatric',
    address_city: 'Central Islip',
    address_county: 'Suffolk',
    address_state: 'NY',
    address_zipcode: '11722',
    gps_lat: 40.7912,
    gps_lng: -73.2012,
    condition: 'demolished',
    status: 'redeveloped',
    access: 'public',
  },
];

function main() {
  const args = process.argv.slice(2);
  const dbPath = getDatabasePath();

  console.log('AU Archive Database CLI Tool');
  console.log('============================');
  console.log(`Database path: ${dbPath}`);
  console.log('');

  // Check if database exists
  if (!fs.existsSync(dbPath)) {
    console.error('ERROR: Database does not exist. Run the app first to initialize.');
    process.exit(1);
  }

  const db = new Database(dbPath);

  // Enable WAL mode and foreign keys
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Parse arguments
  const shouldClear = args.includes('--clear');
  const shouldSeed = args.includes('--seed-locations');
  const archiveFolderIndex = args.indexOf('--archive-folder');
  const archiveFolder = archiveFolderIndex >= 0 ? args[archiveFolderIndex + 1] : null;

  if (args.length === 0 || args.includes('--help')) {
    console.log('Usage: npx ts-node scripts/seed-database.ts [options]');
    console.log('');
    console.log('Options:');
    console.log('  --archive-folder <path>  Set the archive folder path');
    console.log('  --seed-locations         Seed 20 test locations');
    console.log('  --clear                  Clear existing data before seeding');
    console.log('  --status                 Show database status');
    console.log('  --help                   Show this help message');
    console.log('');

    // Show current status
    showStatus(db);
    db.close();
    return;
  }

  if (args.includes('--status')) {
    showStatus(db);
    db.close();
    return;
  }

  // Clear existing data if requested
  if (shouldClear) {
    console.log('Clearing existing data...');
    db.exec('DELETE FROM imgs');
    db.exec('DELETE FROM vids');
    db.exec('DELETE FROM docs');
    db.exec('DELETE FROM maps');
    db.exec('DELETE FROM notes');
    db.exec('DELETE FROM slocs');
    db.exec('DELETE FROM project_locations');
    db.exec('DELETE FROM projects');
    db.exec('DELETE FROM imports');
    db.exec('DELETE FROM bookmarks');
    db.exec('DELETE FROM locs');
    console.log('Data cleared.');
  }

  // Set archive folder if provided
  if (archiveFolder) {
    console.log(`Setting archive_folder to: ${archiveFolder}`);

    // Ensure directory exists
    if (!fs.existsSync(archiveFolder)) {
      console.log(`Creating archive folder: ${archiveFolder}`);
      fs.mkdirSync(archiveFolder, { recursive: true });
    }

    const stmt = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    stmt.run('archive_folder', archiveFolder);
    console.log('archive_folder setting saved.');
  }

  // Seed test locations
  if (shouldSeed) {
    console.log('Seeding test locations...');

    const now = new Date().toISOString();
    const insertStmt = db.prepare(`
      INSERT INTO locs (
        locid, loc12, locnam, slocnam, type, stype,
        address_city, address_county, address_state, address_zipcode,
        gps_lat, gps_lng, gps_source, gps_verified_on_map,
        condition, status, access, locadd, locup, auth_imp
      ) VALUES (
        @locid, @loc12, @locnam, @slocnam, @type, @stype,
        @address_city, @address_county, @address_state, @address_zipcode,
        @gps_lat, @gps_lng, @gps_source, @gps_verified_on_map,
        @condition, @status, @access, @locadd, @locup, @auth_imp
      )
    `);

    // ADR-046: Generate BLAKE3-like 16-char hex ID
    const generateBlake3Id = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

    let seededCount = 0;
    for (const loc of testLocations) {
      const locid = generateBlake3Id();
      const loc12 = generateLoc12(loc.locnam);
      const slocnam = loc.locnam.substring(0, 20).toLowerCase().replace(/[^a-z0-9]+/g, '-');

      try {
        insertStmt.run({
          locid,
          loc12,
          locnam: loc.locnam,
          slocnam,
          type: loc.type,
          stype: loc.stype,
          address_city: loc.address_city,
          address_county: loc.address_county,
          address_state: loc.address_state,
          address_zipcode: loc.address_zipcode,
          gps_lat: loc.gps_lat,
          gps_lng: loc.gps_lng,
          gps_source: 'manual_entry',
          gps_verified_on_map: 0,
          condition: loc.condition,
          status: loc.status,
          access: loc.access,
          locadd: now,
          locup: now,
          auth_imp: 'seed-script',
        });
        seededCount++;
        console.log(`  Added: ${loc.locnam}`);
      } catch (err) {
        console.error(`  Failed to add ${loc.locnam}:`, err);
      }
    }

    console.log(`\nSeeded ${seededCount} locations.`);
  }

  // NOTE: No default user created - users must be created via Setup wizard with required PIN
  // Seed script is for development location data only, not user accounts

  // Show final status
  console.log('\n');
  showStatus(db);

  db.close();
  console.log('\nDone!');
}

function showStatus(db: Database.Database) {
  console.log('Database Status:');
  console.log('-----------------');

  // Settings
  const settings = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  console.log(`Settings (${settings.length}):`);
  for (const s of settings) {
    console.log(`  ${s.key}: ${s.value}`);
  }

  // Counts
  const locCount = (db.prepare('SELECT COUNT(*) as c FROM locs').get() as { c: number }).c;
  const imgCount = (db.prepare('SELECT COUNT(*) as c FROM imgs').get() as { c: number }).c;
  const vidCount = (db.prepare('SELECT COUNT(*) as c FROM vids').get() as { c: number }).c;
  const docCount = (db.prepare('SELECT COUNT(*) as c FROM docs').get() as { c: number }).c;
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;

  console.log(`\nRecord Counts:`);
  console.log(`  Locations: ${locCount}`);
  console.log(`  Images: ${imgCount}`);
  console.log(`  Videos: ${vidCount}`);
  console.log(`  Documents: ${docCount}`);
  console.log(`  Users: ${userCount}`);
}

main();
