# BagIt Self-Documenting Archive: Implementation Guide

**For Less Experienced Developers**

This guide explains the BagIt implementation in the Abandoned Archive project. It follows the [BagIt RFC 8493](https://datatracker.ietf.org/doc/html/rfc8493) specification from the Library of Congress.

---

## Table of Contents

1. [What is BagIt?](#what-is-bagit)
2. [Why We Use It](#why-we-use-it)
3. [Architecture Overview](#architecture-overview)
4. [File Structure](#file-structure)
5. [Key Files Explained](#key-files-explained)
6. [How to Use the API](#how-to-use-the-api)
7. [Integration Points](#integration-points)
8. [Testing](#testing)
9. [Troubleshooting](#troubleshooting)

---

## What is BagIt?

BagIt is a file packaging format developed by the Library of Congress for digital preservation. It creates a "bag" of files with:

1. **Checksums** - SHA256 hashes to verify file integrity
2. **Metadata** - Human-readable information about the contents
3. **Standard structure** - Tools can validate bags automatically

Think of it as a "self-describing archive" - even if the database is gone, the files still know what they are.

---

## Why We Use It

From the original requirement:

> "The Goal is if something is orphaned from the database or its 35 years from now and the database doesnt work we didnt do all of this for nothing."

BagIt ensures each location folder can stand alone. Someone finding these files in 2060 can:
- Read `bag-info.txt` to understand what the location is
- Run `shasum -a 256 -c manifest-sha256.txt` to verify files aren't corrupted
- Reconstruct basic database records from the metadata

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Renderer (UI)                            │
│  window.electronAPI.bagit.regenerate(locid)                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ IPC
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     IPC Handlers                                 │
│  packages/desktop/electron/main/ipc-handlers/bagit.ts           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
┌─────────────────────────┐       ┌─────────────────────────────┐
│     BagItService        │       │   BagItIntegrityService     │
│  (File Generation)      │       │   (Validation & Scheduling) │
│                         │       │                             │
│  - writeBagitTxt()      │       │  - validateAllBags()        │
│  - writeBagInfo()       │       │  - validateSingleBag()      │
│  - writeManifest()      │       │  - scheduleValidationIfDue()│
│  - writeTagManifest()   │       │  - getBagStatusSummary()    │
└─────────────────────────┘       └─────────────────────────────┘
              │                                 │
              └────────────────┬────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Filesystem                                   │
│  [archive]/locations/NY-Mill/abandoned-mill-abc123/              │
│  └── org-doc-abc123/_archive/                                    │
│      ├── bagit.txt                                               │
│      ├── bag-info.txt                                            │
│      ├── manifest-sha256.txt                                     │
│      └── tagmanifest-sha256.txt                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Structure

Each location has BagIt files in its documents folder:

```
[archivePath]/locations/[STATE]-[TYPE]/[SLOCNAM]-[LOC12]/
├── org-img-[LOC12]/           # Images
│   ├── a3d5e8f9...jpg
│   └── a3d5e8f9...jpg.xmp     # XMP sidecar
├── org-vid-[LOC12]/           # Videos
├── org-doc-[LOC12]/           # Documents
│   ├── _archive/              # BagIt package lives here
│   │   ├── bagit.txt
│   │   ├── bag-info.txt
│   │   ├── manifest-sha256.txt
│   │   └── tagmanifest-sha256.txt
│   └── [user documents...]
└── org-map-[LOC12]/           # Maps
```

---

## Key Files Explained

### 1. `bagit.txt` - Version Declaration

```
BagIt-Version: 1.0
Tag-File-Character-Encoding: UTF-8
```

This is static and never changes. It tells tools "this is a BagIt 1.0 bag".

### 2. `bag-info.txt` - Location Metadata

Human-readable key-value pairs:

```
Source-Organization: Abandoned Archive
Bagging-Date: 2025-11-30
Bag-Software-Agent: Abandoned Archive v0.1.0
External-Identifier: abc123def456
External-Description: Seneca Army Depot - Main Bunker Complex
Location-Type: Military
Location-State: NY
Location-City: Romulus
GPS-Latitude: 42.823400
GPS-Longitude: -76.845600
GPS-Source: map_confirmed
Payload-Oxum: 2400000000.53
```

**Key fields:**
- `External-Identifier`: The location's `loc12` ID
- `Payload-Oxum`: `total_bytes.file_count` for quick validation
- All GPS and address fields for database reconstruction

### 3. `manifest-sha256.txt` - File Checksums

Lists every payload file with its SHA256 hash:

```
a3d5e8f9abc123def456789...  ../org-img-abc123/a3d5e8f9abc123...jpg
b4e6f0abc234def567890123...  ../org-vid-abc123/b4e6f0abc234...mp4
```

Format: `HASH  RELATIVE_PATH` (two spaces between)

### 4. `tagmanifest-sha256.txt` - Metadata Checksums

Checksums of the metadata files themselves:

```
e8f9abc123def456789012...  bagit.txt
f0abc234def567890123...    bag-info.txt
g1bcd345efg678901234...    manifest-sha256.txt
```

This proves the metadata hasn't been tampered with.

---

## How to Use the API

### From the Renderer (Svelte)

```typescript
// Regenerate bag for a location
await window.electronAPI.bagit.regenerate(locid);

// Validate a single location
const result = await window.electronAPI.bagit.validate(locid);
// result: { status: 'valid', payloadOxum: { bytes: 12345, count: 50 } }

// Validate all locations
const summary = await window.electronAPI.bagit.validateAll();
// summary: { totalLocations: 100, validCount: 95, ... }

// Get status for a location
const status = await window.electronAPI.bagit.status(locid);
// status: { bag_status: 'valid', bag_last_verified: '2025-11-30T...', bag_last_error: null }

// Get summary of all bag statuses
const summary = await window.electronAPI.bagit.summary();
// summary: { valid: 45, incomplete: 2, invalid: 0, none: 3 }

// Listen for validation progress
const unsubscribe = window.electronAPI.bagit.onProgress((progress) => {
  console.log(`Validating ${progress.current}/${progress.total}: ${progress.currentLocation}`);
});
// Don't forget to unsubscribe when done
unsubscribe();
```

### From Main Process

```typescript
import { BagItService } from '../../services/bagit-service';
import { BagItIntegrityService } from '../../services/bagit-integrity-service';

// Initialize services
const bagItService = new BagItService(archivePath);
const integrityService = new BagItIntegrityService(db, bagItService, archivePath);

// Generate bag for a new location
await bagItService.initializeBag(location);

// Update bag after metadata changes
await bagItService.updateBagInfo(location, mediaFiles);

// Update manifest after file import
await bagItService.updateManifest(location, mediaFiles);

// Validate a bag
const result = await bagItService.validateBag(location, mediaFiles);

// Quick validation (Payload-Oxum only)
const quickResult = await bagItService.quickValidate(location, mediaFiles);
```

---

## Integration Points

### When Bags Get Updated

| Event | Action | Method Called |
|-------|--------|---------------|
| Location created | Initialize new bag | `bagItService.initializeBag()` |
| Location metadata edited | Update bag-info.txt | `bagItService.updateBagInfo()` |
| Media imported | Update manifest | `bagItService.updateManifest()` |
| Media deleted | Update manifest | `bagItService.updateManifest()` |
| Weekly schedule | Validate all bags | `integrityService.validateAllBags()` |
| Manual trigger | Regenerate bag | `bagItService.regenerateBag()` |

### Database Fields

The `locs` table has three new columns:

```sql
bag_status TEXT DEFAULT 'none'      -- 'none', 'valid', 'complete', 'incomplete', 'invalid'
bag_last_verified TEXT              -- ISO8601 timestamp
bag_last_error TEXT                 -- Error message if validation failed
```

### Settings

The app stores the last validation date in settings:

```sql
INSERT INTO settings (key, value) VALUES ('bagit_last_validation', '2025-11-30T12:00:00Z');
```

---

## Testing

### Manual Validation

You can validate bags from the command line:

```bash
cd /path/to/archive/locations/NY-Mill/abandoned-mill-abc123/org-doc-abc123/_archive

# Quick check: Does bag-info.txt exist?
cat bag-info.txt

# Verify all checksums match
shasum -a 256 -c manifest-sha256.txt

# Verify metadata checksums
shasum -a 256 -c tagmanifest-sha256.txt
```

### Unit Tests

Test cases to implement:

```typescript
describe('BagItService', () => {
  it('should create all four BagIt files on initializeBag', async () => {
    // ...
  });

  it('should update Payload-Oxum when files are added', async () => {
    // ...
  });

  it('should detect missing files during validation', async () => {
    // ...
  });

  it('should detect checksum mismatches', async () => {
    // ...
  });
});
```

---

## Troubleshooting

### Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| "Archive folder not configured" | Settings not set | Configure archive folder in Settings |
| `bag_status = 'incomplete'` | Files were deleted outside the app | Run "Regenerate Archive" to update manifest |
| `bag_status = 'invalid'` | Checksum mismatch | File was modified; check for corruption |
| BagIt files missing | Location created before this feature | Run "Regenerate Archive" button |

### Debug Logging

BagIt operations log to console:

```
[BagIt] Initialized bag for location: Seneca Army Depot (abc123def456)
[BagIt] Updated manifest for location: Seneca Army Depot (47 files)
[BagIt] Validation complete: 45 valid, 2 incomplete, 0 invalid (1234ms)
```

### Recovery

If bags get corrupted or out of sync:

1. **For single location**: Click "Regenerate Archive" in Location Detail
2. **For all locations**: Click "Verify All Locations" in Settings
3. **For severe issues**: Delete `_archive/` folder and regenerate

---

## Code Locations

| Component | File Path |
|-----------|-----------|
| BagIt Service | `packages/desktop/electron/services/bagit-service.ts` |
| Integrity Service | `packages/desktop/electron/services/bagit-integrity-service.ts` |
| IPC Handlers | `packages/desktop/electron/main/ipc-handlers/bagit.ts` |
| Preload API | `packages/desktop/electron/preload/preload.cjs` (search for "bagit") |
| Type Definitions | `packages/desktop/src/types/electron.d.ts` (search for "BagIt") |
| Database Migration | `packages/desktop/electron/main/database.ts` (Migration 40) |
| Implementation Plan | `docs/plans/bagit-implementation-plan.md` |

---

## Further Reading

- [RFC 8493 - BagIt Specification](https://datatracker.ietf.org/doc/html/rfc8493)
- [Library of Congress - BagIt](https://www.loc.gov/standards/mets/mets-home.html)
- [NDSA Fixity Guidance](https://www.digitalpreservation.gov/documents/NDSA-Fixity-Guidance-Report-final100214.pdf)

---

**Last Updated**: 2025-11-30
**Author**: Abandoned Archive Development Team
