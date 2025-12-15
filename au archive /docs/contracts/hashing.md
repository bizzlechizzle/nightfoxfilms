# File/Hash Contract

**Version:** 2.0 (BLAKE3)
**Updated:** 2025-12-04
**ADR:** ADR-045-blake3-migration

---

## Hashing Algorithm

### Internal Operations: BLAKE3

All internal hashing uses BLAKE3 with 64-bit output:

| Property | Value |
|----------|-------|
| Algorithm | BLAKE3 |
| Output length | 64 bits (8 bytes) |
| Hex format | 16 lowercase characters |
| Example | `a7f3b2c1e9d4f086` |
| NPM package | `blake3` |

```typescript
import { calculateHash, HASH_LENGTH } from './crypto-service';

const hash = await calculateHash('/path/to/file.jpg');
// Returns: "a7f3b2c1e9d4f086" (exactly 16 chars)
```

### Export Operations: SHA-256 (RFC 8493)

BagIt export packages use SHA-256 for RFC 8493 compliance:

| Property | Value |
|----------|-------|
| Algorithm | SHA-256 |
| Output length | 256 bits (32 bytes) |
| Hex format | 64 lowercase characters |
| Usage | Export manifests only |

SHA-256 is computed on-demand during export, never stored.

---

## Hash as Primary Key

Media files are identified by their BLAKE3 hash:

| Table | Primary Key Column |
|-------|-------------------|
| imgs | imghash |
| vids | vidhash |
| docs | dochash |
| maps | maphash |

Hash is computed **before** any metadata extraction or file moves.

---

## Collision Handling

- Hash collisions are treated as duplicates
- Reuse existing metadata links instead of duplicating bytes
- Collision probability at 1M files: ~1 in 34 million (acceptable for local archive)

---

## Naming Convention

Each imported file has two names:

| Name | Description | Example |
|------|-------------|---------|
| `original_name` | User's original filename | `IMG_1234.jpg` |
| `organized_name` | Hash-based archive name | `a7f3b2c1e9d4f086.jpg` |

Organized paths: `[archive]/locations/[STATE]/[LOCID]/data/org-img/` (ADR-046)

---

## Bucket Directories

Thumbnails and previews use 2-char hash prefix for directory bucketing:

```
.thumbnails/a7/a7f3b2c1e9d4f086_sm.jpg
.thumbnails/a7/a7f3b2c1e9d4f086_lg.jpg
.previews/a7/a7f3b2c1e9d4f086.jpg
```

This limits directory size to ~256 buckets (00-ff).

---

## Storage + Linking

- Media tables reference files by hash (primary key) plus location/sub-location IDs
- Imports are idempotent; rerunning import on same directory only adds links, not bytes
- **Location deletion is permanent and destructive** (OPT-036):
  - Requires PIN confirmation
  - Cascade deletes all linked media records
  - Removes original media files from location folder
  - Removes generated thumbnails, previews, posters, and video proxies
  - Cannot be undone — backup before deleting

---

## Audit Trail

- Capture importer username, timestamps, and source paths for every record
- Export/report ability to map hash → organized path → metadata

---

## Import Sequence

1. User selects files/folders; renderer sends absolute paths through preload
2. Main process validates permissions and checks available disk space
3. **Hash service streams file, computes BLAKE3, assigns organized filename**
4. File copies into archive folder; metadata extraction runs afterward
5. Repository upserts media record keyed by hash and links to location/sub-location
6. Import queue stores status (`pending`, `processing`, `complete`, `error`)

---

## Integrity Verification

### Internal (Day-to-Day)

Simple BLAKE3 verification via integrity-service.ts:

```typescript
import { verifyFile } from './integrity-service';

const isValid = await verifyFile('/path/to/file.jpg', 'a7f3b2c1e9d4f086');
```

### Export (RFC Compliant)

BagIt packages generated on export include:
- `manifest-sha256.txt` — SHA-256 checksums for all payload files
- `tagmanifest-sha256.txt` — SHA-256 checksums for metadata files
- `bag-info.txt` — Location metadata for database-independent reconstruction

---

## Validation

Hash strings must match this pattern:

```typescript
const HashSchema = z.string().length(16).regex(/^[a-f0-9]+$/);
```

- Exactly 16 characters
- Lowercase hexadecimal only

---

## History

| Version | Date | Algorithm | Hash Length |
|---------|------|-----------|-------------|
| 1.0 | 2024-XX-XX | SHA-256 | 64 hex chars |
| 2.0 | 2025-12-04 | BLAKE3 | 16 hex chars |

See ADR-045 for migration rationale.
