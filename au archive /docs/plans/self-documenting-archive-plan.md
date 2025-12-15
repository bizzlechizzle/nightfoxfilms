# Self-Documenting Archive Plan

**Goal**: Make each location folder a standalone archive that can be understood and verified 35+ years from now without the database.

**Principle**: "If the database is gone, the archive should still tell its story."

---

## Current State

### What Exists
| Component | Location | Purpose |
|-----------|----------|---------|
| XMP Sidecars | Per-media file (`.xmp`) | Industry-standard metadata (ratings, keywords, etc.) |
| Import Manifests | `[archive]/imports/imp-*.json` | Per-import session audit trail |
| Database (SQLite) | `data/au-archive.db` | All location/media metadata (single point of failure) |

### What's Missing
- No per-location metadata files
- No human-readable README per folder
- No file manifest with checksums
- If database corrupts, folders become "orphan containers"

---

## Proposed Solution: Location Documentation Package

Each location folder gets **3 files** in a `_docs/` subfolder:

```
[archivePath]/locations/NY-Mill/abandoned-mill-abc123def456/
├── _docs/
│   ├── location.json       # Machine-readable metadata
│   ├── README.txt          # Human-readable summary
│   └── MANIFEST.txt        # File inventory with SHA256
├── org-img-abc123def456/
├── org-vid-abc123def456/
├── org-doc-abc123def456/
└── org-map-abc123def456/
```

### Why `_docs/` subfolder?
- Keeps metadata separate from media
- Underscore prefix sorts to top in file browsers
- Clear purpose without cluttering media folders
- Easy to exclude from media counts

---

## File Specifications

### 1. `location.json` — Machine-Readable Metadata

**Purpose**: Complete location record in portable, parseable format

```json
{
  "_schema": "au-archive/location/v1",
  "_generated_at": "2025-11-30T18:00:00Z",
  "_generator": "Abandoned Archive v0.1.0",

  "location": {
    "id": "abc123-def456-...",
    "loc12": "abc123def456",
    "name": "Seneca Army Depot - Main Bunker Complex",
    "short_name": "seneca-army-depot-main",
    "type": "Military",
    "access_status": "restricted",
    "created_at": "2025-11-30T12:00:00Z",
    "updated_at": "2025-11-30T18:00:00Z"
  },

  "gps": {
    "latitude": 42.8234,
    "longitude": -76.8456,
    "source": "map_confirmed",
    "verified_on_map": true,
    "accuracy_meters": null,
    "captured_at": "2025-11-30T12:30:00Z"
  },

  "address": {
    "street": null,
    "city": "Romulus",
    "county": "Seneca",
    "state": "NY",
    "zipcode": "14541"
  },

  "region": {
    "census_region": "Northeast",
    "census_division": "Middle Atlantic",
    "state_direction": "Upstate NY",
    "cultural_region": "Finger Lakes"
  },

  "media": {
    "images": 47,
    "videos": 3,
    "documents": 2,
    "maps": 1
  },

  "notes": "Former Cold War munitions storage. White deer population..."
}
```

### 2. `README.txt` — Human-Readable Summary

**Purpose**: Anyone can open this in 35 years and understand what's here

```
================================================================================
                         ABANDONED ARCHIVE - LOCATION RECORD
================================================================================

Location: Seneca Army Depot - Main Bunker Complex
ID: abc123def456
Type: Military
State: New York

Generated: November 30, 2025 at 6:00 PM
Generator: Abandoned Archive v0.1.0

--------------------------------------------------------------------------------
GPS COORDINATES
--------------------------------------------------------------------------------
Latitude:  42.8234
Longitude: -76.8456
Source: Map Confirmed (verified on satellite imagery)

--------------------------------------------------------------------------------
ADDRESS
--------------------------------------------------------------------------------
City: Romulus
County: Seneca
State: NY
ZIP: 14541

--------------------------------------------------------------------------------
REGION
--------------------------------------------------------------------------------
Census Region: Northeast
Census Division: Middle Atlantic
State Direction: Upstate NY
Cultural Region: Finger Lakes

--------------------------------------------------------------------------------
MEDIA SUMMARY
--------------------------------------------------------------------------------
Images:    47 files in org-img-abc123def456/
Videos:     3 files in org-vid-abc123def456/
Documents:  2 files in org-doc-abc123def456/
Maps:       1 file  in org-map-abc123def456/

Total: 53 files

--------------------------------------------------------------------------------
NOTES
--------------------------------------------------------------------------------
Former Cold War munitions storage. White deer population...

--------------------------------------------------------------------------------
FILE VERIFICATION
--------------------------------------------------------------------------------
All media files are named by their SHA256 hash (first 64 characters).
Example: a3d5e8f9abc123...jpg

To verify file integrity:
  1. Compute SHA256 hash of file contents
  2. Compare to filename (excluding extension)
  3. Match = file is intact and unmodified

Full checksums available in MANIFEST.txt

--------------------------------------------------------------------------------
ABOUT THIS ARCHIVE
--------------------------------------------------------------------------------
This folder is part of an Abandoned Archive collection.
All data is local-first with no cloud dependencies.
Database: SQLite (au-archive.db)
XMP sidecars contain additional per-file metadata.

For questions: [user-configurable contact info]
================================================================================
```

### 3. `MANIFEST.txt` — File Inventory with Checksums

**Purpose**: Complete file list for integrity verification and recovery

```
================================================================================
FILE MANIFEST - Seneca Army Depot - Main Bunker Complex (abc123def456)
================================================================================
Generated: 2025-11-30 18:00:00
Total Files: 53
Total Size: 2.4 GB

================================================================================
IMAGES (47 files, 1.8 GB)
================================================================================
Folder: org-img-abc123def456/

SHA256                                                           Filename                                      Size      Date Taken
---------------------------------------------------------------- --------------------------------------------- --------- -----------
a3d5e8f9abc123def456789012345678901234567890123456789012345678   a3d5e8f9abc123def456789...jpg                 4.2 MB    2024-06-15
b4e6f0abc234def567890123456789012345678901234567890123456789012   b4e6f0abc234def567890...jpg                   3.8 MB    2024-06-15
...

================================================================================
VIDEOS (3 files, 580 MB)
================================================================================
Folder: org-vid-abc123def456/

SHA256                                                           Filename                                      Size      Duration
---------------------------------------------------------------- --------------------------------------------- --------- ---------
c5f7g1bcd345efg678901234567890123456789012345678901234567890123   c5f7g1bcd345efg67890...mp4                    245 MB    4:32
...

================================================================================
DOCUMENTS (2 files, 12 MB)
================================================================================
Folder: org-doc-abc123def456/

SHA256                                                           Filename                                      Size      Type
---------------------------------------------------------------- --------------------------------------------- --------- -----
d6h8i2cde456fgh789012345678901234567890123456789012345678901234   d6h8i2cde456fgh7890...pdf                     8.2 MB    PDF
...

================================================================================
INTEGRITY VERIFICATION
================================================================================
To verify all files on Unix/Mac:
  cd [this folder]
  shasum -a 256 -c MANIFEST.txt

To verify single file:
  shasum -a 256 org-img-abc123def456/a3d5e8f9abc123...jpg

Expected: a3d5e8f9abc123def456789012345678901234567890123456789012345678

================================================================================
```

---

## Implementation Strategy

### Option A: Write-Through (Recommended)
Update `_docs/` files immediately when:
- Location is created
- Location metadata is edited
- Media is imported to location
- Media is removed from location

**Pros**: Always in sync, no background jobs needed
**Cons**: Extra disk writes on every change

### Option B: On-Demand Generation
Generate `_docs/` files only when:
- User clicks "Generate Archive Docs" button
- User exports/backs up location
- User explicitly requests regeneration

**Pros**: No extra disk I/O during normal use
**Cons**: Files can become stale, user must remember to regenerate

### Option C: Periodic Sync (Hybrid)
- Queue changes in memory
- Flush to disk every N minutes or on app close
- Track `docs_synced_at` timestamp

**Pros**: Balanced approach
**Cons**: Still has sync window where files are stale

---

## Recommended: Option A (Write-Through)

**Rationale**:
1. Archive integrity is core mission — stale docs defeat the purpose
2. Disk I/O is cheap; location edits are infrequent
3. Import batches can update docs once at end, not per-file
4. Simpler code: no background jobs, no sync state

**Implementation Points**:
- Create `LocationDocsService` in `electron/services/`
- Hook into location create/update in repository
- Hook into media import completion
- Regenerate on media deletion
- Add "Regenerate Docs" button in location detail for manual refresh

---

## Questions for User Approval

### Q1: Folder Structure
**Current proposal**: `_docs/` subfolder
**Alternative**: Files in location root (alongside media folders)

### Q2: File Naming
**Current proposal**: `location.json`, `README.txt`, `MANIFEST.txt`
**Alternative**: `index.json`, `about.txt`, `files.txt` (shorter names)

### Q3: Generation Strategy
**Current proposal**: Write-through (always in sync)
**Alternative**: On-demand only (user triggers)

### Q4: MANIFEST Format
**Current proposal**: Human-readable text with embedded checksums
**Alternative**: Standard `SHA256SUMS` format (Unix-compatible `shasum -c`)

### Q5: What About Existing Locations?
- Batch regenerate all docs on first launch after update?
- Add "Regenerate All Docs" button in Settings?
- Only generate docs for new/edited locations?

### Q6: XMP Relationship
- Should `location.json` include per-file XMP metadata (duplicating info)?
- Or reference XMP sidecars and let them be source of truth for file-level metadata?

---

## Scope Boundaries

### In Scope
- `_docs/` folder with 3 files per location
- Write-through generation on location/media changes
- Basic integrity verification instructions in README

### Out of Scope (Future)
- Dublin Core / METS XML (institutional archive formats)
- Per-media JSON files (XMP sidecars already serve this)
- Automatic integrity checking on app launch
- Cloud sync of docs (violates offline-first principle)

---

## Implementation Tasks (Draft)

1. [ ] Create `LocationDocsService` class
2. [ ] Implement `generateLocationJson()` method
3. [ ] Implement `generateReadmeTxt()` method
4. [ ] Implement `generateManifestTxt()` method
5. [ ] Hook into `LocationRepository.save()`
6. [ ] Hook into `FileImportService` completion
7. [ ] Hook into media deletion
8. [ ] Add IPC channel `location:regenerateDocs`
9. [ ] Add "Regenerate Docs" button to LocationDetail page
10. [ ] Add "Regenerate All Docs" button to Settings
11. [ ] Handle batch generation for existing locations
12. [ ] Update `docs/workflows/import.md` with new step
13. [ ] Add tests for doc generation

---

## Success Criteria

1. Every location folder contains `_docs/` with 3 files
2. Files stay in sync with database automatically
3. README is readable by humans without any special tools
4. MANIFEST enables file integrity verification via standard tools
5. location.json can rebuild basic database record if needed
6. Works offline, no external dependencies

---

**Status**: DRAFT - Awaiting user approval before implementation
