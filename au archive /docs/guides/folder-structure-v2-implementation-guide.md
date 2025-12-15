# Folder Structure v2 - Implementation Guide

**For:** Developers implementing the migration
**Skill Level:** Intermediate TypeScript/Electron
**Prerequisites:** Read CLAUDE.md, folder-structure-v2.md, master-checklist.md

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Phase 1: Database Schema Changes](#phase-1-database-schema-changes)
4. [Phase 2: ID Generation](#phase-2-id-generation)
5. [Phase 3: Core Services](#phase-3-core-services)
6. [Phase 4: Repositories](#phase-4-repositories)
7. [Phase 5: IPC Handlers](#phase-5-ipc-handlers)
8. [Phase 6: Import Pipeline](#phase-6-import-pipeline)
9. [Phase 7: Tests](#phase-7-tests)
10. [Phase 8: Documentation](#phase-8-documentation)
11. [Phase 9: Verification](#phase-9-verification)
12. [Troubleshooting](#troubleshooting)

---

## Overview

### What We're Changing

| Before | After |
|--------|-------|
| UUID (36 chars) for locid | BLAKE3 16-char for locid |
| Separate loc12 column (12 chars) | locid IS the short ID |
| `STATE-TYPE/SLOCNAM-LOC12/` | `STATE/LOCID/` |
| `org-img-LOC12/` | `data/org-img/` |
| `_archive/` nested in org-doc | BagIt at location root |
| `_database/` | `database/` |

### Why We're Changing

1. **Simplification**: One ID format everywhere
2. **Rename-safe**: Location name not in folder path
3. **RFC 8493 compliance**: Proper BagIt structure
4. **No underscore prefixes**: Cleaner folder names
5. **Scalability**: Handles 100k+ locations

---

## Prerequisites

### Before Starting

1. **Fresh Database Required**
   ```bash
   python3 resetdb.py -a /path/to/archive --wipe-media
   ```

2. **Create Feature Branch**
   ```bash
   git checkout -b feature/folder-structure-v2
   ```

3. **Verify Dependencies**
   ```bash
   pnpm deps
   ```

4. **Read These Files**
   - `/docs/plans/folder-structure-v2.md`
   - `/docs/plans/folder-structure-v2-master-checklist.md`
   - `/CLAUDE.md`

---

## Phase 1: Database Schema Changes

### Duration: ~2 hours
### Files to Modify: 3

---

### Step 1.1: Update database.ts Schema SQL

**File:** `packages/desktop/electron/main/database.ts`

**Find this code (around line 20-24):**
```typescript
CREATE TABLE IF NOT EXISTS locs (
  -- Identity
  locid TEXT PRIMARY KEY,
  loc12 TEXT UNIQUE NOT NULL,
```

**Replace with:**
```typescript
CREATE TABLE IF NOT EXISTS locs (
  -- Identity (BLAKE3 16-char hash)
  locid TEXT PRIMARY KEY CHECK(length(locid) = 16),
```

**Find this code (around line 77):**
```typescript
CREATE INDEX IF NOT EXISTS idx_locs_loc12 ON locs(loc12);
```

**Delete this line entirely.**

---

### Step 1.2: Update slocs Table in database.ts

**Find this code (around line 85-90):**
```typescript
CREATE TABLE IF NOT EXISTS slocs (
  subid TEXT PRIMARY KEY,
  sub12 TEXT UNIQUE NOT NULL,
```

**Replace with:**
```typescript
CREATE TABLE IF NOT EXISTS slocs (
  -- Identity (BLAKE3 16-char hash)
  subid TEXT PRIMARY KEY CHECK(length(subid) = 16),
```

**Also find and remove any index on sub12.**

---

### Step 1.3: Update database.types.ts

**File:** `packages/desktop/electron/main/database.types.ts`

**Find the Locs interface and remove loc12:**
```typescript
// BEFORE
export interface Locs {
  locid: string;
  loc12: string;
  locnam: string;
  // ... rest
}

// AFTER
export interface Locs {
  locid: string;  // BLAKE3 16-char hash
  locnam: string;
  // ... rest (remove loc12 line entirely)
}
```

**Find the Slocs interface and remove sub12:**
```typescript
// BEFORE
export interface Slocs {
  subid: string;
  sub12: string;
  // ... rest
}

// AFTER
export interface Slocs {
  subid: string;  // BLAKE3 16-char hash
  // ... rest (remove sub12 line entirely)
}
```

---

### Step 1.4: Update schema.sql Reference File

**File:** `packages/desktop/electron/main/schema.sql`

Apply the same changes as database.ts. This file is for reference only but should stay in sync.

---

### Step 1.5: Remove loc12 from Migration Code

**File:** `packages/desktop/electron/main/database.ts`

Search for any migrations that reference `loc12` or `sub12` and remove those columns from the migration code. Look in the `runMigrations()` function.

---

### Verification for Phase 1

```bash
# Search for remaining loc12 in database files
grep -n "loc12" packages/desktop/electron/main/database*.ts

# Should return only comments or this check
# If you see column definitions, you missed something
```

---

## Phase 2: ID Generation

### Duration: ~1 hour
### Files to Modify: 3

---

### Step 2.1: Add BLAKE3 ID Generation to crypto-service.ts

**File:** `packages/desktop/electron/services/crypto-service.ts`

**Add these imports at the top:**
```typescript
import { createHash as blake3Hash } from 'blake3';
import crypto from 'crypto';
```

**Add these functions:**
```typescript
/**
 * Generate a unique location ID using BLAKE3 hash of random bytes.
 * Returns a 16-character lowercase hex string.
 *
 * @example
 * const locid = generateLocationId();
 * // Returns: "a7f3b2c1e9d4f086"
 */
export function generateLocationId(): string {
  const randomBytes = crypto.randomBytes(32);
  return blake3Hash()
    .update(randomBytes)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Generate a unique sub-location ID using BLAKE3 hash of random bytes.
 * Returns a 16-character lowercase hex string.
 * Same algorithm as generateLocationId() - separate function for clarity.
 */
export function generateSubLocationId(): string {
  const randomBytes = crypto.randomBytes(32);
  return blake3Hash()
    .update(randomBytes)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Validate that a string is a valid location/sub-location ID.
 * Must be exactly 16 lowercase hex characters.
 */
export function isValidEntityId(id: string): boolean {
  return /^[a-f0-9]{16}$/.test(id);
}
```

---

### Step 2.2: Remove generateLoc12 from location.ts

**File:** `packages/core/src/domain/location.ts`

**Find and DELETE this method (around line 184-186):**
```typescript
static generateLoc12(uuid: string): string {
  return uuid.substring(0, 12).replace(/-/g, '');
}
```

**Find and UPDATE the Zod schema (around line 115):**
```typescript
// BEFORE
loc12: z.string().length(12),

// AFTER - DELETE this line entirely
```

**Find and UPDATE any other loc12 references in the schema:**
```typescript
// BEFORE
sub12: z.string().optional(),

// AFTER - DELETE this line entirely
```

---

### Step 2.3: Export New Functions

**File:** `packages/desktop/electron/services/crypto-service.ts`

Ensure the functions are exported:
```typescript
export {
  calculateHash,
  generateLocationId,
  generateSubLocationId,
  isValidEntityId,
  HASH_LENGTH,
};
```

---

### Verification for Phase 2

```bash
# Test the new function works
cd packages/desktop
npx ts-node -e "
const { generateLocationId } = require('./electron/services/crypto-service');
const id = generateLocationId();
console.log('Generated ID:', id);
console.log('Length:', id.length);
console.log('Valid:', /^[a-f0-9]{16}$/.test(id));
"
```

---

## Phase 3: Core Services

### Duration: ~4 hours
### Files to Modify: 4

---

### Step 3.1: Update copier.ts - buildLocationPath()

**File:** `packages/desktop/electron/services/import/copier.ts`

**Find the buildLocationPath method (around line 527-536):**
```typescript
// BEFORE
private buildLocationPath(location: LocationInfo): string {
  const state = (location.address_state || 'XX').toUpperCase();
  const type = (location.type || 'unknown').toLowerCase().replace(/\s+/g, '-');
  const slocnam = (location.slocnam || 'location').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const loc12 = location.loc12;
  const stateType = `${state}-${type}`;
  const locFolder = `${slocnam}-${loc12}`;
  return path.join(this.archiveBasePath, 'locations', stateType, locFolder);
}
```

**Replace with:**
```typescript
// AFTER - New structure: locations/STATE/LOCID/
private buildLocationPath(location: LocationInfo): string {
  const state = (location.address_state || 'XX').toUpperCase();
  const locid = location.locid;

  // Validate locid format
  if (!locid || locid.length !== 16) {
    throw new Error(`Invalid location ID: ${locid}`);
  }

  return path.join(this.archiveBasePath, 'locations', state, locid);
}
```

---

### Step 3.2: Update copier.ts - getSubfolder()

**Find the getSubfolder method (around line 174-197):**
```typescript
// BEFORE
private getSubfolder(location: LocationInfo, mediaType: MediaType): string {
  const loc12 = location.loc12;
  const subSuffix = location.subid
    ? `-${location.sub12 || location.subid.substring(0, 12)}`
    : '';

  let subfolder: string;
  switch (mediaType) {
    case 'image':
      subfolder = `org-img-${loc12}${subSuffix}`;
      break;
    case 'video':
      subfolder = `org-vid-${loc12}${subSuffix}`;
      break;
    // ... etc
  }
  return subfolder;
}
```

**Replace with:**
```typescript
// AFTER - New structure: data/org-[type]/ or data/sloc-[SUBID]/org-[type]/
private getSubfolder(location: LocationInfo, mediaType: MediaType): string {
  // Determine base path based on whether this is a sub-location
  let basePath = 'data';
  if (location.subid) {
    basePath = path.join('data', `sloc-${location.subid}`);
  }

  // Determine media type folder
  let typeFolder: string;
  switch (mediaType) {
    case 'image':
      typeFolder = 'org-img';
      break;
    case 'video':
      typeFolder = 'org-vid';
      break;
    case 'document':
      typeFolder = 'org-doc';
      break;
    case 'map':
      typeFolder = 'org-map';
      break;
    default:
      typeFolder = 'org-doc';  // Fallback
  }

  return path.join(basePath, typeFolder);
}
```

---

### Step 3.3: Update copier.ts - buildFilePath()

**Find the buildFilePath method and update similarly:**
```typescript
// AFTER
private buildFilePath(
  location: LocationInfo,
  mediaType: MediaType,
  hash: string,
  extension: string
): string {
  const locationPath = this.buildLocationPath(location);
  const subfolder = this.getSubfolder(location, mediaType);
  const filename = `${hash}${extension}`;

  return path.join(locationPath, subfolder, filename);
}
```

---

### Step 3.4: Update copier.ts - Remove loc12/sub12 References

Search the entire file for `loc12` and `sub12` and remove all references. Update the LocationInfo destructuring to not expect these fields.

---

### Step 3.5: Update bagit-service.ts - Complete Restructure

**File:** `packages/desktop/electron/services/bagit-service.ts`

This file needs significant changes. Here's the new structure:

**Update the BagLocation interface:**
```typescript
// BEFORE
export interface BagLocation {
  locid: string;
  loc12: string;
  locnam: string;
  // ...
}

// AFTER
export interface BagLocation {
  locid: string;  // BLAKE3 16-char
  locnam: string;
  address_state?: string;
  type?: string;
  address_county?: string;
  gps_lat?: number;
  gps_lng?: number;
  // ... other metadata fields
}
```

**Update getArchiveFolderPath():**
```typescript
// BEFORE - was nested in org-doc-LOC12/_archive/
getArchiveFolderPath(location: BagLocation): string {
  const locationPath = this.getLocationFolderPath(location);
  const docFolder = `org-doc-${location.loc12}`;
  return path.join(locationPath, docFolder, '_archive');
}

// AFTER - BagIt files at location root
getBagItPath(location: BagLocation): string {
  const state = (location.address_state || 'XX').toUpperCase();
  return path.join(this.archiveBasePath, 'locations', state, location.locid);
}
```

**Update manifest paths to use data/ prefix:**
```typescript
// Manifest entries should now look like:
// a7f3b2c1e9d4f086  data/org-img/photo001.jpg
// b3c4d5e6f7a8b9c0  data/org-vid/video001.mp4
```

---

### Step 3.6: Update database-archive-service.ts

**File:** `packages/desktop/electron/services/database-archive-service.ts`

**Find the folder constant:**
```typescript
// BEFORE
private static readonly DB_FOLDER = '_database';

// AFTER
private static readonly DB_FOLDER = 'database';
```

---

### Step 3.7: Update websource-orchestrator-service.ts

**File:** `packages/desktop/electron/services/websource-orchestrator-service.ts`

**Update getArchivePath():**
```typescript
// BEFORE
archivePath = path.join(
  this.archiveBasePath,
  'locations',
  stateTypeFolder,
  locationFolder,
  docFolder,
  '_websources',
  `${domain}-${source.source_id}`
);

// AFTER
archivePath = path.join(
  this.archiveBasePath,
  'locations',
  state,
  location.locid,
  'data',
  'web-doc',
  `${domain}-${source.source_id}`
);
```

**Update unlinked sources path:**
```typescript
// BEFORE
archivePath = path.join(this.archiveBasePath, '_websources', source.source_id);

// AFTER
archivePath = path.join(this.archiveBasePath, 'websources', source.source_id);
```

---

### Verification for Phase 3

```bash
# Build to check for TypeScript errors
pnpm --filter desktop build

# Should complete with no errors
```

---

## Phase 4: Repositories

### Duration: ~2 hours
### Files to Modify: 2

---

### Step 4.1: Update sqlite-location-repository.ts

**File:** `packages/desktop/electron/repositories/sqlite-location-repository.ts`

**Update imports:**
```typescript
// ADD this import
import { generateLocationId } from '../services/crypto-service';

// REMOVE this if present
// import { LocationEntity } from '@au-archive/core';
```

**Update create method:**
```typescript
// BEFORE
async create(input: LocationInput): Promise<Location> {
  const locid = randomUUID();
  const loc12 = LocationEntity.generateLoc12(locid);

  await this.db.insertInto('locs').values({
    locid,
    loc12,
    // ...
  }).execute();
}

// AFTER
async create(input: LocationInput): Promise<Location> {
  const locid = generateLocationId();

  await this.db.insertInto('locs').values({
    locid,
    // ... (no loc12)
  }).execute();
}
```

**Update all SELECT statements to remove loc12:**
```typescript
// BEFORE
.select(['locid', 'loc12', 'locnam', ...])

// AFTER
.select(['locid', 'locnam', ...])
```

**Update all return mappings:**
```typescript
// BEFORE
return {
  locid: row.locid,
  loc12: row.loc12,
  // ...
};

// AFTER
return {
  locid: row.locid,
  // ... (no loc12)
};
```

---

### Step 4.2: Update sqlite-sublocation-repository.ts

**File:** `packages/desktop/electron/repositories/sqlite-sublocation-repository.ts`

**Update imports:**
```typescript
import { generateSubLocationId } from '../services/crypto-service';
```

**Update create method:**
```typescript
// BEFORE
async create(input: SubLocationInput): Promise<SubLocation> {
  const subid = randomUUID();
  const sub12 = subid.substring(0, 12).replace(/-/g, '');

  await this.db.insertInto('slocs').values({
    subid,
    sub12,
    // ...
  }).execute();
}

// AFTER
async create(input: SubLocationInput): Promise<SubLocation> {
  const subid = generateSubLocationId();

  await this.db.insertInto('slocs').values({
    subid,
    // ... (no sub12)
  }).execute();
}
```

**Update delete method - folder paths:**
```typescript
// BEFORE
const bagitFolder = path.join(locationFolder, `_archive-${existing.sub12}`);

// AFTER - Sub-location content is inside parent's data folder
// No separate _archive folder to delete
// Media is in: data/sloc-[SUBID]/org-img/, etc.
const slocFolder = path.join(locationFolder, 'data', `sloc-${subid}`);
```

---

### Verification for Phase 4

```bash
# Run repository tests
pnpm --filter desktop test -- --grep "repository"
```

---

## Phase 5: IPC Handlers

### Duration: ~2 hours
### Files to Modify: 5

---

### Step 5.1: Update import-v2.ts

**File:** `packages/desktop/electron/main/ipc-handlers/import-v2.ts`

**Update validation schema:**
```typescript
// BEFORE
const LocationInfoSchema = z.object({
  locid: z.string(),
  loc12: z.string(),
  // ...
});

// AFTER
const LocationInfoSchema = z.object({
  locid: z.string().length(16),
  // ... (no loc12)
});
```

**Update all loc12 references:**
```typescript
// BEFORE
loc12: validated.loc12,
loc12: location.loc12,

// AFTER - remove these lines
```

---

### Step 5.2: Update Other IPC Handlers

Apply the same pattern to:
- `packages/desktop/electron/main/ipc-handlers/bagit.ts`
- `packages/desktop/electron/main/ipc-handlers/locations.ts`
- `packages/desktop/electron/main/ipc-handlers/media-import.ts`
- `packages/desktop/electron/main/ipc-handlers/storage.ts`

For each file:
1. Search for `loc12`
2. Remove from Zod schemas
3. Remove from object mappings
4. Remove from SELECT queries

---

### Verification for Phase 5

```bash
# Check for remaining loc12 in handlers
grep -rn "loc12" packages/desktop/electron/main/ipc-handlers/
```

---

## Phase 6: Import Pipeline

### Duration: ~2 hours
### Files to Modify: 5

---

### Step 6.1: Update types.ts

**File:** `packages/desktop/electron/services/import/types.ts`

```typescript
// BEFORE
export interface LocationInfo {
  locid: string;
  loc12: string;
  subid?: string | null;
  sub12?: string | null;
  // ...
}

// AFTER
export interface LocationInfo {
  locid: string;  // BLAKE3 16-char
  subid?: string | null;  // BLAKE3 16-char if present
  // ... (remove loc12 and sub12)
}
```

---

### Step 6.2: Update scanner.ts Exclusions

**File:** `packages/desktop/electron/services/import/scanner.ts`

```typescript
// BEFORE
const EXCLUDED_FOLDERS = [
  '.thumbnails',
  '.previews',
  '.posters',
  '.cache',
  '_database',
  // ...
];

// AFTER
const EXCLUDED_FOLDERS = [
  '.thumbnails',
  '.previews',
  '.posters',
  '.cache',
  'database',  // Changed from _database
  'websources',  // Changed from _websources
  // ...
];
```

---

### Step 6.3-6.5: Update Other Import Files

Apply similar changes to:
- `orchestrator.ts` - Remove loc12 from location info handling
- `finalizer.ts` - Update path generation
- `file-import-service.ts` - Update comments and path logic
- `phase-import-service.ts` - Update folder path spec

---

## Phase 7: Tests

### Duration: ~2 hours
### Files to Modify: 4

---

### Step 7.1: Update copier.test.ts

**File:** `packages/desktop/electron/__tests__/unit/copier.test.ts`

```typescript
// BEFORE
const mockLocation = {
  locid: 'test-uuid',
  loc12: 'ABC123',
  // ...
};

expect(result.archivePath).toContain('org-img-ABC123');

// AFTER
const mockLocation = {
  locid: 'a7f3b2c1e9d4f086',  // 16-char BLAKE3
  // ... (no loc12)
};

expect(result.archivePath).toContain('data/org-img');
expect(result.archivePath).toContain('a7f3b2c1e9d4f086');
```

---

### Step 7.2: Add New Tests

Add tests for:
1. BLAKE3 ID generation (16 chars, hex)
2. New folder structure validation
3. BagIt RFC 8493 compliance

```typescript
// Example new test
describe('generateLocationId', () => {
  it('should generate 16-char hex ID', () => {
    const id = generateLocationId();
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateLocationId());
    }
    expect(ids.size).toBe(1000);
  });
});
```

---

## Phase 8: Documentation

### Duration: ~1 hour
### Files to Modify: 10+

---

### Step 8.1: Update CLAUDE.md

**File:** `/CLAUDE.md`

**Update Archive folder structure in Critical Gotchas:**
```markdown
| **Archive folder structure** | `[base]/locations/[STATE]/[LOCID]/data/org-{img,vid,doc,map}/` |
```

**Update any other references to the old structure.**

---

### Step 8.2: Update Contracts

Update these files to reflect new structure:
- `docs/contracts/hashing.md`
- `docs/contracts/data-ownership.md`
- `docs/workflows/import.md`

---

### Step 8.3: Update Package READMEs

- `packages/core/CLAUDE.md`
- `packages/desktop/CLAUDE.md`

---

## Phase 9: Verification

### Duration: ~1 hour

---

### Step 9.1: Run All Verification Commands

```bash
# Verify loc12 removed
grep -rn "loc12" packages/ --include="*.ts" --include="*.svelte" | grep -v node_modules | grep -v ".d.ts"
# Expected: 0 results (or only in comments)

# Verify sub12 removed
grep -rn "sub12" packages/ --include="*.ts" --include="*.svelte" | grep -v node_modules | grep -v ".d.ts"
# Expected: 0 results (or only in comments)

# Verify _archive updated
grep -rn "'_archive'" packages/ --include="*.ts" | grep -v node_modules
# Expected: 0 results

# Verify _database updated
grep -rn "'_database'" packages/ --include="*.ts" | grep -v node_modules
# Expected: 0 results

# Verify _websources updated
grep -rn "'_websources'" packages/ --include="*.ts" | grep -v node_modules
# Expected: 0 results

# Verify org-[type]-LOC12 patterns updated
grep -rn "org-img-\|org-vid-\|org-doc-\|org-map-" packages/ --include="*.ts" | grep -v node_modules
# Expected: 0 results with LOC12 suffix

# Verify tests pass
pnpm -r test

# Verify build succeeds
pnpm build
```

---

### Step 9.2: Manual Testing

1. Start the app: `pnpm dev`
2. Create a new location with State=NY, Name="Test Location"
3. Verify folder created: `locations/NY/[16-char-id]/`
4. Import an image
5. Verify file at: `locations/NY/[16-char-id]/data/org-img/[hash].jpg`
6. Check README.txt created
7. Check bagit.txt, bag-info.txt created

---

## Troubleshooting

### Common Issues

**Issue: "loc12 is not defined"**
- Cause: Missing update in a file
- Solution: Search for the error location and remove loc12 reference

**Issue: "Cannot find module 'blake3'"**
- Cause: blake3 not installed
- Solution: `pnpm add blake3`

**Issue: "Path too long on Windows"**
- Cause: Deep nesting
- Solution: Verify path length in buildFilePath()

**Issue: "Foreign key constraint failed"**
- Cause: Database has old schema
- Solution: Run `python3 resetdb.py` for fresh database

**Issue: Tests failing with "expected 12, got 16"**
- Cause: Test still expects old ID length
- Solution: Update test assertions for 16-char IDs

---

## Completion Checklist

- [ ] All verification commands pass (0 results)
- [ ] All tests pass
- [ ] Build succeeds
- [ ] Manual testing confirms new folder structure
- [ ] Documentation updated
- [ ] Ready for code review

---

## Next Steps After Implementation

1. Run full test suite
2. Create test location and verify structure
3. Update master checklist with completion status
4. Commit changes
5. Push to GitHub
6. Create PR for review (if applicable)
