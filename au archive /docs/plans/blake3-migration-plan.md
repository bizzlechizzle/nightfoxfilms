# BLAKE3 Migration Plan

**Status:** Ready for Implementation
**Date:** 2025-12-04
**Breaking Change:** Yes - requires fresh database

---

## Executive Summary

Complete migration from SHA-256 (64 hex chars) to BLAKE3 (16 hex chars) for all internal hashing operations. This is a **fresh start** migration — all existing test data will be discarded.

### Key Changes
- **Algorithm:** SHA-256 → BLAKE3
- **Hash length:** 64 hex chars → 16 hex chars
- **Column naming:** `*sha` → `*hash` (e.g., `imgsha` → `imghash`)
- **BagIt:** Simplified to export-only (per audit recommendation)
- **SHA-256:** Retained ONLY in export-service.ts for RFC 8493 compliance

---

## Audit Results: Files Requiring Changes

### Category 1: Core Hash Infrastructure

| File | LOC | Changes Required |
|------|-----|------------------|
| `packages/desktop/package.json` | - | Add `blake3` dependency |
| `packages/desktop/electron/services/crypto-service.ts` | 41 | Complete rewrite to BLAKE3 |
| `packages/desktop/electron/__tests__/unit/crypto-service.test.ts` | ~50 | Update test vectors |

### Category 2: Database Layer

| File | LOC | Changes Required |
|------|-----|------------------|
| `packages/desktop/electron/main/database.ts` | 1000+ | Update schema, rename columns |
| `packages/desktop/electron/main/database.types.ts` | 561 | Rename all `*sha` to `*hash` |
| `packages/desktop/electron/main/schema.sql` | ~250 | Update reference copy |

### Category 3: Domain Models

| File | LOC | Changes Required |
|------|-----|------------------|
| `packages/core/src/domain/media.ts` | 82 | Rename fields, add validation |
| `packages/core/src/domain/location.ts` | 367 | Rename `hero_imgsha` → `hero_imghash` |
| `packages/core/src/domain/location.test.ts` | ~100 | Update test data |

### Category 4: Repository Layer

| File | LOC | Changes Required |
|------|-----|------------------|
| `packages/desktop/electron/repositories/sqlite-media-repository.ts` | 600+ | Rename all column refs |
| `packages/desktop/electron/repositories/sqlite-location-repository.ts` | 800+ | Rename `hero_imgsha` refs |
| `packages/desktop/electron/repositories/sqlite-sublocation-repository.ts` | 300+ | Rename `hero_imgsha` refs |
| `packages/desktop/electron/repositories/sqlite-import-repository.ts` | 200+ | Rename hash refs |

### Category 5: Service Layer

| File | LOC | Changes Required |
|------|-----|------------------|
| `packages/desktop/electron/services/file-import-service.ts` | 800+ | Use new hash function, rename vars |
| `packages/desktop/electron/services/media-path-service.ts` | 127 | Update bucketing (logic same, var names) |
| `packages/desktop/electron/services/database-archive-service.ts` | 313 | Update checksum logic |
| `packages/desktop/electron/services/thumbnail-service.ts` | ~200 | Update hash refs |
| `packages/desktop/electron/services/poster-frame-service.ts` | ~150 | Update hash refs |
| `packages/desktop/electron/services/preview-extractor-service.ts` | ~200 | Update hash refs |
| `packages/desktop/electron/services/video-proxy-service.ts` | ~200 | Update hash refs |
| `packages/desktop/electron/services/phase-import-service.ts` | ~300 | Update hash refs |
| `packages/desktop/electron/services/import-intelligence-service.ts` | ~200 | Update hash refs |
| `packages/desktop/electron/services/import-manifest.ts` | ~100 | Update hash refs |
| `packages/desktop/electron/services/location-duplicate-service.ts` | ~150 | Update hash refs |

### Category 6: BagIt Simplification (per audit)

| File | Action | New LOC |
|------|--------|---------|
| `packages/desktop/electron/services/bagit-service.ts` | **REPLACE** with export-only | ~200 |
| `packages/desktop/electron/services/bagit-integrity-service.ts` | **DELETE** | -482 |
| `packages/desktop/electron/main/ipc-handlers/bagit.ts` | **SIMPLIFY** | ~50 |
| NEW: `packages/desktop/electron/services/integrity-service.ts` | **CREATE** | ~100 |
| NEW: `packages/desktop/electron/services/bagit-export-service.ts` | **CREATE** | ~200 |

### Category 7: IPC Handlers

| File | Changes Required |
|------|------------------|
| `packages/desktop/electron/main/ipc-handlers/media-processing.ts` | Rename hash params |
| `packages/desktop/electron/main/ipc-handlers/media-import.ts` | Rename hash params |
| `packages/desktop/electron/main/ipc-handlers/locations.ts` | Rename `hero_imgsha` |
| `packages/desktop/electron/main/ipc-handlers/sublocations.ts` | Rename `hero_imgsha` |
| `packages/desktop/electron/main/ipc-handlers/stats-settings.ts` | Rename hash refs |
| `packages/desktop/electron/main/ipc-handlers/storage.ts` | Rename hash refs |
| `packages/desktop/electron/main/ipc-validation.ts` | Rename validation schemas |

### Category 8: Preload & Types

| File | Changes Required |
|------|------------------|
| `packages/desktop/electron/preload/index.ts` | Rename exposed methods |
| `packages/desktop/src/types/electron.d.ts` | Update type definitions |

### Category 9: UI Components (Svelte)

| File | Changes Required |
|------|------------------|
| `packages/desktop/src/pages/Dashboard.svelte` | Rename `hero_imgsha` refs |
| `packages/desktop/src/pages/LocationDetail.svelte` | Rename hash refs |
| `packages/desktop/src/components/MediaViewer.svelte` | Rename hash refs |
| `packages/desktop/src/components/location/LocationHero.svelte` | Rename `hero_imgsha` |
| `packages/desktop/src/components/location/LocationGallery.svelte` | Rename hash refs |
| `packages/desktop/src/components/location/LocationOriginalAssets.svelte` | Rename hash refs |
| `packages/desktop/src/components/location/SubLocationGrid.svelte` | Rename `hero_imgsha` |
| `packages/desktop/src/components/location/LocationNerdStats.svelte` | Update BagIt display |
| `packages/desktop/src/components/location/types.ts` | Rename hash types |
| `packages/desktop/src/lib/display-helpers.ts` | Rename hash refs |
| `packages/desktop/src/lib/constants.ts` | Update any hash constants |
| `packages/desktop/src/pages/Settings.svelte` | Update BagIt UI |

### Category 10: Tests

| File | Changes Required |
|------|------------------|
| `packages/desktop/electron/__tests__/unit/crypto-service.test.ts` | BLAKE3 test vectors |
| `packages/desktop/electron/__tests__/integration/helpers/test-database.ts` | Update schema |
| `packages/desktop/electron/__tests__/integration/kanye7-import.integration.test.ts` | Update hash refs |
| `packages/desktop/electron/__tests__/integration/media-repository.integration.test.ts` | Update hash refs |
| `packages/desktop/electron/__tests__/integration/location-repository.integration.test.ts` | Update hash refs |

### Category 11: Documentation

| File | Changes Required |
|------|------------------|
| `docs/contracts/hashing.md` | Complete rewrite |
| `docs/contracts/data-ownership.md` | Update manifest refs |
| `docs/workflows/import.md` | Update SHA256 → BLAKE3 |
| `docs/workflows/export.md` | Update checksum refs |
| `docs/DATA_FLOW.md` | Update hash references |
| `packages/desktop/CLAUDE.md` | Update hash mentions |
| `packages/core/CLAUDE.md` | Update hash mentions |
| NEW: `docs/decisions/ADR-045-blake3-migration.md` | Decision record |

---

## Naming Convention Changes

### Column Renames (Database)

| Table | Old Column | New Column |
|-------|------------|------------|
| imgs | imgsha | imghash |
| vids | vidsha | vidhash |
| docs | docsha | dochash |
| maps | mapsha | maphash |
| locs | hero_imgsha | hero_imghash |
| slocs | hero_imgsha | hero_imghash |
| video_proxies | vidsha | vidhash |

### Variable/Property Renames (Code)

| Context | Old | New |
|---------|-----|-----|
| Domain types | `imgsha: string` | `imghash: string` |
| Function params | `findImageByHash(imgsha)` | `findImageByHash(imghash)` |
| Local variables | `const sha = await calculateSHA256()` | `const hash = await calculateHash()` |
| Comments | "SHA256 computed..." | "BLAKE3 computed..." |

### `loc12` Clarification

`loc12` is **NOT a hash** — it's a 12-character ID derived from UUID:
```typescript
static generateLoc12(uuid: string): string {
  return uuid.replace(/-/g, '').substring(0, 12);
}
```
**Action:** Keep as-is. No changes needed.

---

## Implementation Phases

### Phase 1: Core Hash Service

**Files:**
1. `packages/desktop/package.json` — Add dependency
2. `packages/desktop/electron/services/crypto-service.ts` — Rewrite

**New crypto-service.ts:**
```typescript
import { createHash } from 'blake3';
import { createReadStream } from 'fs';
import { Readable } from 'stream';

/**
 * Hash length constant: 16 hex characters (64 bits)
 */
export const HASH_LENGTH = 16;

/**
 * Calculate BLAKE3 hash of a file
 * @param filePath - Absolute path to the file
 * @returns Promise resolving to 16-char lowercase hex hash
 * @example
 * const hash = await calculateHash('/path/to/file.jpg');
 * // Returns: "a7f3b2c1e9d4f086"
 */
export async function calculateHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hasher = createHash();
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hasher.update(chunk));
    stream.on('end', () => {
      // Take first 8 bytes (64 bits) = 16 hex chars
      const fullHash = hasher.digest('hex');
      resolve(fullHash.substring(0, HASH_LENGTH));
    });
    stream.on('error', reject);
  });
}

/**
 * Calculate BLAKE3 hash of a buffer
 * @param buffer - Buffer to hash
 * @returns 16-char lowercase hex hash
 */
export function calculateHashBuffer(buffer: Buffer): string {
  const fullHash = createHash().update(buffer).digest('hex');
  return fullHash.substring(0, HASH_LENGTH);
}

/**
 * Validate a hash string format
 * @param hash - String to validate
 * @returns true if valid 16-char lowercase hex
 */
export function isValidHash(hash: string): boolean {
  return /^[a-f0-9]{16}$/.test(hash);
}
```

### Phase 2: Database Schema

**New database.ts schema (key changes):**
```sql
-- Images table
CREATE TABLE IF NOT EXISTS imgs (
  imghash TEXT PRIMARY KEY,  -- Was: imgsha
  ...
);

-- Videos table
CREATE TABLE IF NOT EXISTS vids (
  vidhash TEXT PRIMARY KEY,  -- Was: vidsha
  ...
);

-- Documents table
CREATE TABLE IF NOT EXISTS docs (
  dochash TEXT PRIMARY KEY,  -- Was: docsha
  ...
);

-- Maps table
CREATE TABLE IF NOT EXISTS maps (
  maphash TEXT PRIMARY KEY,  -- Was: mapsha
  ...
);

-- Locations table
CREATE TABLE IF NOT EXISTS locs (
  ...
  hero_imghash TEXT REFERENCES imgs(imghash),  -- Was: hero_imgsha
  ...
);

-- Sub-locations table
CREATE TABLE IF NOT EXISTS slocs (
  ...
  hero_imghash TEXT REFERENCES imgs(imghash),  -- Was: hero_imgsha
  ...
);

-- Video proxies table
CREATE TABLE IF NOT EXISTS video_proxies (
  vidhash TEXT PRIMARY KEY,  -- Was: vidsha
  ...
);
```

**Remove these columns** (per BagIt audit):
- `locs.bag_status`
- `locs.bag_last_verified`
- `locs.bag_last_error`

### Phase 3: Domain Models

**packages/core/src/domain/media.ts:**
```typescript
// Image Schema
export const ImageSchema = BaseMediaSchema.extend({
  imghash: z.string().length(16).regex(/^[a-f0-9]+$/),  // Was: imgsha
  imgnam: z.string(),
  ...
});

// Video Schema
export const VideoSchema = BaseMediaSchema.extend({
  vidhash: z.string().length(16).regex(/^[a-f0-9]+$/),  // Was: vidsha
  ...
});

// Document Schema
export const DocumentSchema = BaseMediaSchema.extend({
  dochash: z.string().length(16).regex(/^[a-f0-9]+$/),  // Was: docsha
  ...
});

// Map Schema
export const MapSchema = BaseMediaSchema.extend({
  maphash: z.string().length(16).regex(/^[a-f0-9]+$/),  // Was: mapsha
  ...
});
```

**packages/core/src/domain/location.ts:**
```typescript
export const LocationInputSchema = z.object({
  ...
  hero_imghash: z.string().length(16).regex(/^[a-f0-9]+$/).optional(),  // Was: hero_imgsha
  ...
});
```

### Phase 4: Repository Layer

Update all queries to use new column names. Example from sqlite-media-repository.ts:
```typescript
// Before
async findImageByHash(imgsha: string): Promise<MediaImage> {
  const row = await this.db
    .selectFrom('imgs')
    .selectAll()
    .where('imgsha', '=', imgsha)
    .executeTakeFirstOrThrow();
  return row;
}

// After
async findImageByHash(imghash: string): Promise<MediaImage> {
  const row = await this.db
    .selectFrom('imgs')
    .selectAll()
    .where('imghash', '=', imghash)
    .executeTakeFirstOrThrow();
  return row;
}
```

### Phase 5: Service Layer

**file-import-service.ts key changes:**
```typescript
// Before
import { CryptoService } from './crypto-service';
const sha = await this.cryptoService.calculateSHA256(filePath);

// After
import { calculateHash, HASH_LENGTH } from './crypto-service';
const hash = await calculateHash(filePath);
```

**media-path-service.ts bucketing (logic unchanged):**
```typescript
// Bucket directory uses first 2 chars of hash
// With 16-char hash: "a7f3b2c1e9d4f086" → bucket "a7/"
const bucket = hash.substring(0, 2);
```

### Phase 6: New Integrity Service

**packages/desktop/electron/services/integrity-service.ts:**
```typescript
import { calculateHash } from './crypto-service';
import fs from 'fs/promises';
import path from 'path';

/**
 * Lightweight file integrity verification using BLAKE3
 * Replaces complex BagIt validation for day-to-day operations
 */

/**
 * Verify a single file's hash matches expected value
 */
export async function verifyFile(filePath: string, expectedHash: string): Promise<boolean> {
  try {
    const actualHash = await calculateHash(filePath);
    return actualHash === expectedHash;
  } catch {
    return false;
  }
}

/**
 * Generate a manifest of all files in a directory
 * @returns Map of relative paths to BLAKE3 hashes
 */
export async function generateManifest(directory: string): Promise<Map<string, string>> {
  const manifest = new Map<string, string>();

  async function scan(dir: string, base: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(base, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath, relativePath);
      } else if (entry.isFile()) {
        const hash = await calculateHash(fullPath);
        manifest.set(relativePath, hash);
      }
    }
  }

  await scan(directory, '');
  return manifest;
}

/**
 * Verify all files in a manifest
 * @returns Object with valid count, invalid files, and missing files
 */
export async function verifyManifest(
  directory: string,
  manifest: Map<string, string>
): Promise<{
  validCount: number;
  invalidFiles: string[];
  missingFiles: string[];
}> {
  const result = {
    validCount: 0,
    invalidFiles: [] as string[],
    missingFiles: [] as string[],
  };

  for (const [relativePath, expectedHash] of manifest) {
    const fullPath = path.join(directory, relativePath);
    try {
      await fs.access(fullPath);
      const isValid = await verifyFile(fullPath, expectedHash);
      if (isValid) {
        result.validCount++;
      } else {
        result.invalidFiles.push(relativePath);
      }
    } catch {
      result.missingFiles.push(relativePath);
    }
  }

  return result;
}
```

### Phase 7: BagIt Export Service

**packages/desktop/electron/services/bagit-export-service.ts:**
```typescript
import { createHash } from 'crypto';  // SHA-256 for RFC 8493 compliance
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';

/**
 * RFC 8493 BagIt package generation for export/sharing
 * SHA-256 is used ONLY here for standards compliance
 */

interface BagExportOptions {
  locationId: string;
  locationName: string;
  locationType: string;
  metadata: Record<string, string>;
  files: Array<{ path: string; relativePath: string }>;
  outputDir: string;
  includeAuthorship?: boolean;
}

/**
 * Calculate SHA-256 hash for RFC 8493 manifest
 * This is the ONLY place SHA-256 is used in the codebase
 */
async function calculateSHA256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Generate RFC 8493 compliant BagIt package
 */
export async function exportRFCCompliantBag(options: BagExportOptions): Promise<void> {
  const archiveDir = path.join(options.outputDir, '_archive');
  await fs.mkdir(archiveDir, { recursive: true });

  // 1. Generate bagit.txt
  await fs.writeFile(
    path.join(archiveDir, 'bagit.txt'),
    'BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n'
  );

  // 2. Generate bag-info.txt
  const bagInfo = [
    `Source-Organization: Abandoned Archive`,
    `Bagging-Date: ${new Date().toISOString().split('T')[0]}`,
    `Bag-Software-Agent: Abandoned Archive v0.1.0`,
    `External-Identifier: ${options.locationId}`,
    `External-Description: ${options.locationName}`,
    `Location-Type: ${options.locationType}`,
  ];

  for (const [key, value] of Object.entries(options.metadata)) {
    if (value) bagInfo.push(`${key}: ${value}`);
  }

  // Calculate Payload-Oxum (total bytes.file count)
  let totalBytes = 0;
  for (const file of options.files) {
    const stat = await fs.stat(file.path);
    totalBytes += stat.size;
  }
  bagInfo.push(`Payload-Oxum: ${totalBytes}.${options.files.length}`);
  bagInfo.push(`Bag-Count: 1 of 1`);

  await fs.writeFile(
    path.join(archiveDir, 'bag-info.txt'),
    bagInfo.join('\n') + '\n'
  );

  // 3. Generate manifest-sha256.txt (RFC 8493 requires SHA-256)
  const manifestLines: string[] = [];
  for (const file of options.files) {
    const sha256 = await calculateSHA256(file.path);
    manifestLines.push(`${sha256}  ${file.relativePath}`);
  }
  await fs.writeFile(
    path.join(archiveDir, 'manifest-sha256.txt'),
    manifestLines.join('\n') + '\n'
  );

  // 4. Generate tagmanifest-sha256.txt
  const tagFiles = ['bagit.txt', 'bag-info.txt', 'manifest-sha256.txt'];
  const tagManifestLines: string[] = [];
  for (const tagFile of tagFiles) {
    const sha256 = await calculateSHA256(path.join(archiveDir, tagFile));
    tagManifestLines.push(`${sha256}  ${tagFile}`);
  }
  await fs.writeFile(
    path.join(archiveDir, 'tagmanifest-sha256.txt'),
    tagManifestLines.join('\n') + '\n'
  );
}
```

### Phase 8: Tests

**crypto-service.test.ts with BLAKE3:**
```typescript
import { calculateHash, calculateHashBuffer, isValidHash, HASH_LENGTH } from '../services/crypto-service';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('crypto-service (BLAKE3)', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crypto-test-'));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true });
  });

  describe('calculateHash', () => {
    it('returns exactly 16 lowercase hex characters', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const hash = await calculateHash(testFile);

      expect(hash).toHaveLength(HASH_LENGTH);
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('returns consistent hash for same content', async () => {
      const testFile = path.join(tempDir, 'consistent.txt');
      await fs.writeFile(testFile, 'consistent content');

      const hash1 = await calculateHash(testFile);
      const hash2 = await calculateHash(testFile);

      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different content', async () => {
      const file1 = path.join(tempDir, 'file1.txt');
      const file2 = path.join(tempDir, 'file2.txt');
      await fs.writeFile(file1, 'content A');
      await fs.writeFile(file2, 'content B');

      const hash1 = await calculateHash(file1);
      const hash2 = await calculateHash(file2);

      expect(hash1).not.toBe(hash2);
    });

    it('handles empty files', async () => {
      const emptyFile = path.join(tempDir, 'empty.txt');
      await fs.writeFile(emptyFile, '');

      const hash = await calculateHash(emptyFile);

      expect(hash).toHaveLength(HASH_LENGTH);
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('handles large files', async () => {
      const largeFile = path.join(tempDir, 'large.bin');
      const largeContent = Buffer.alloc(10 * 1024 * 1024); // 10MB
      await fs.writeFile(largeFile, largeContent);

      const hash = await calculateHash(largeFile);

      expect(hash).toHaveLength(HASH_LENGTH);
    });
  });

  describe('calculateHashBuffer', () => {
    it('returns 16 lowercase hex characters', () => {
      const buffer = Buffer.from('test');
      const hash = calculateHashBuffer(buffer);

      expect(hash).toHaveLength(HASH_LENGTH);
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('isValidHash', () => {
    it('accepts valid 16-char lowercase hex', () => {
      expect(isValidHash('a7f3b2c1e9d4f086')).toBe(true);
    });

    it('rejects uppercase hex', () => {
      expect(isValidHash('A7F3B2C1E9D4F086')).toBe(false);
    });

    it('rejects wrong length', () => {
      expect(isValidHash('a7f3b2c1')).toBe(false);
      expect(isValidHash('a7f3b2c1e9d4f086abcd')).toBe(false);
    });

    it('rejects non-hex characters', () => {
      expect(isValidHash('a7f3b2c1e9d4f08g')).toBe(false);
    });
  });
});
```

### Phase 9: Documentation Updates

See ADR document for decision rationale.

---

## Junior Developer Checklist

### Pre-Flight
- [ ] Read CLAUDE.md completely
- [ ] Read this migration plan completely
- [ ] Ensure no active database connections
- [ ] Back up any test data you want to preserve

### Step 1: Add Dependency
```bash
cd packages/desktop
pnpm add blake3
```
- [ ] Verify package.json includes `"blake3": "^X.X.X"`
- [ ] Run `pnpm install` in project root

### Step 2: Update crypto-service.ts
- [ ] Replace entire file with new BLAKE3 implementation
- [ ] Verify imports work: `import { createHash } from 'blake3';`
- [ ] Export `HASH_LENGTH = 16`

### Step 3: Update Tests First
- [ ] Update crypto-service.test.ts
- [ ] Run tests: `pnpm test` — expect failures until schema updated

### Step 4: Update Database Schema
- [ ] Edit database.ts SCHEMA_SQL constant
- [ ] Rename all `*sha` columns to `*hash`
- [ ] Remove `bag_status`, `bag_last_verified`, `bag_last_error`
- [ ] Delete existing database file: `rm packages/desktop/data/au-archive.db`

### Step 5: Update database.types.ts
- [ ] Global find/replace in file:
  - `imgsha` → `imghash`
  - `vidsha` → `vidhash`
  - `docsha` → `dochash`
  - `mapsha` → `maphash`
  - `hero_imgsha` → `hero_imghash`

### Step 6: Update Domain Models
- [ ] Update packages/core/src/domain/media.ts
- [ ] Update packages/core/src/domain/location.ts
- [ ] Build core: `pnpm --filter core build`

### Step 7: Update Repositories
- [ ] sqlite-media-repository.ts
- [ ] sqlite-location-repository.ts
- [ ] sqlite-sublocation-repository.ts
- [ ] sqlite-import-repository.ts

### Step 8: Update Services
For each service file:
- [ ] Replace `calculateSHA256` with `calculateHash`
- [ ] Replace `sha` variables with `hash`
- [ ] Update any `imgsha`/`vidsha`/etc references

### Step 9: Update IPC Layer
- [ ] media-processing.ts
- [ ] media-import.ts
- [ ] locations.ts
- [ ] sublocations.ts
- [ ] stats-settings.ts
- [ ] storage.ts
- [ ] ipc-validation.ts

### Step 10: Update Preload
- [ ] preload/index.ts — rename exposed methods if needed
- [ ] src/types/electron.d.ts — update type definitions

### Step 11: Update UI Components
- [ ] Dashboard.svelte
- [ ] LocationDetail.svelte
- [ ] MediaViewer.svelte
- [ ] LocationHero.svelte
- [ ] LocationGallery.svelte
- [ ] LocationOriginalAssets.svelte
- [ ] SubLocationGrid.svelte

### Step 12: Create New Services
- [ ] Create integrity-service.ts
- [ ] Create bagit-export-service.ts
- [ ] Simplify bagit.ts IPC handler
- [ ] Delete bagit-integrity-service.ts

### Step 13: Update Remaining Tests
- [ ] test-database.ts
- [ ] kanye7-import.integration.test.ts
- [ ] media-repository.integration.test.ts
- [ ] location-repository.integration.test.ts

### Step 14: Run Verification
```bash
# Must return ZERO results (excluding bagit-export-service.ts)
grep -ri 'sha256\|sha-256\|SHA256' packages/ --include='*.ts' --include='*.js' | grep -v bagit-export-service | grep -v node_modules | wc -l

# Must return ZERO results
grep -ri 'imgsha\|vidsha\|docsha\|mapsha' packages/ --include='*.ts' --include='*.js' | grep -v node_modules | wc -l

# Should return many results
grep -ri 'imghash\|vidhash\|dochash\|maphash' packages/ --include='*.ts' | head -10
```

### Step 15: Run Full Test Suite
```bash
pnpm -r test
pnpm -r lint
pnpm build
pnpm dev  # Manual smoke test
```

### Step 16: Update Documentation
- [ ] docs/contracts/hashing.md
- [ ] docs/contracts/data-ownership.md
- [ ] docs/workflows/import.md
- [ ] docs/workflows/export.md
- [ ] docs/DATA_FLOW.md
- [ ] packages/desktop/CLAUDE.md
- [ ] packages/core/CLAUDE.md

---

## Quality Gates

Before marking migration complete:

| Gate | Command | Expected Result |
|------|---------|-----------------|
| No SHA-256 in code | `grep -ri 'sha256' packages/ --include='*.ts' \| grep -v bagit-export \| grep -v node_modules` | 0 lines |
| No old column names | `grep -ri 'imgsha\|vidsha\|docsha\|mapsha' packages/ --include='*.ts' \| grep -v node_modules` | 0 lines |
| Hash length is 16 | Check `HASH_LENGTH` constant | 16 |
| Tests pass | `pnpm -r test` | All pass |
| Build succeeds | `pnpm build` | No errors |
| Lint passes | `pnpm -r lint` | No errors |
| App runs | `pnpm dev` | Opens without crash |
| Import works | Import test image | Hash is 16 chars |
| Docs updated | Manual review | All references updated |

---

## Rollback Plan

This is a breaking change with no rollback path. If issues arise:
1. Revert all code changes via git
2. Delete new database file
3. Restore from backup (if any test data was preserved)

---

## Timeline

This migration should be executed in a single session to avoid mixed state. Estimated effort: 4-6 hours for experienced developer.

---

**End of Migration Plan**
