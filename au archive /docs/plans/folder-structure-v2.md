# Folder Structure v2 Plan

**Status:** Draft
**Date:** 2025-12-09
**Breaking Change:** Yes (fresh database required)

---

## Summary

Simplify location identification and folder structure by:
1. Replacing UUID with BLAKE3 16-char IDs for locations
2. Using state-based top-level folders
3. Making folder names rename-safe (hash only, no name in path)
4. Full BagIt (RFC 8493) compliance for archival integrity
5. Adding human-readable README.txt sidecars
6. Consolidating web-sourced content into parallel folder structure

---

## Current vs Proposed

### Current Structure
```
[archive]/
├── .thumbnails/[bucket]/           # Generated thumbnails
├── .previews/[bucket]/             # RAW file previews
├── .posters/[bucket]/              # Video poster frames
├── .cache/video-proxies/           # Video proxy cache
├── _database/                      # Database snapshots
├── _websources/                    # Unlinked web archives
└── locations/
    └── [STATE]-[TYPE]/
        └── [SLOCNAM]-[LOC12]/
            ├── org-img-[LOC12]/
            ├── org-vid-[LOC12]/
            ├── org-map-[LOC12]/
            ├── org-doc-[LOC12]/
            │   ├── _archive/           # BagIt files
            │   └── _websources/        # Web archives
            └── _archive-[SUB12]/       # Sub-location BagIt
```

**Problems:**
- Name in folder path → rename requires folder rename
- Type in folder path → type change requires folder move
- UUID is 36 chars (verbose)
- Multiple ID formats (UUID in DB, LOC12 in folders)
- BagIt nested inside org-doc (not RFC compliant)
- Underscore prefixes (`_archive`, `_websources`)

### Proposed Structure
```
[archive]/
├── .thumbnails/[bucket]/           # Generated thumbnails (unchanged)
├── .previews/[bucket]/             # RAW file previews (unchanged)
├── .posters/[bucket]/              # Video poster frames (unchanged)
├── .cache/video-proxies/           # Video proxy cache (unchanged)
├── database/                       # Database snapshots (no underscore)
├── websources/                     # Unlinked web archives (no underscore)
└── locations/
    └── [STATE]/
        └── [LOCID]/
            ├── bagit.txt
            ├── bag-info.txt
            ├── manifest-blake3.txt
            ├── tagmanifest-blake3.txt
            ├── README.txt
            └── data/
                ├── org-img/
                ├── org-vid/
                ├── org-doc/
                ├── org-map/
                ├── web-img/
                ├── web-vid/
                ├── web-doc/
                └── sloc-[SUBID]/    # Sub-location media
```

**Benefits:**
- Hash-only folder name → rename-safe
- State-only hierarchy → simpler paths
- One ID format everywhere (BLAKE3 16-char)
- RFC 8493 BagIt compliant → any BagIt tool can validate
- No underscores in folder names
- Clear separation: original (`org-*`) vs web-sourced (`web-*`)
- Sub-locations contained within parent location's BagIt

---

## Location ID Generation

### Algorithm
```typescript
import { createHash } from 'blake3';
import crypto from 'crypto';

function generateLocationId(): string {
  const randomBytes = crypto.randomBytes(32);
  return createHash().update(randomBytes).digest('hex').slice(0, 16);
}
```

### Properties
| Property | Value |
|----------|-------|
| Algorithm | BLAKE3 |
| Input | 32 random bytes |
| Output | 16 lowercase hex characters |
| Example | `a7f3b2c1e9d4f086` |
| Collision at 50k | Effectively zero (64-bit space) |

### Consistency
| Entity | ID Format | Source |
|--------|-----------|--------|
| Location | BLAKE3 16-char | Random bytes |
| Sub-location | BLAKE3 16-char | Random bytes |
| Image | BLAKE3 16-char | File content |
| Video | BLAKE3 16-char | File content |
| Document | BLAKE3 16-char | File content |
| Map | BLAKE3 16-char | File content |

**One hash function. One ID length. One format.**

---

## Folder Hierarchy

### Level 1: State
- Two-letter uppercase state code
- Required at location creation
- Changing state moves the entire location folder

```
locations/
├── NY/
├── PA/
├── OH/
└── ...
```

### Level 2: Location ID
- BLAKE3 16-char hash
- Generated once at creation
- Never changes (rename-safe)

```
locations/NY/
├── a7f3b2c1e9d4f086/
├── b3c4d5e6f7a8b9c0/
└── ...
```

### Level 3: BagIt Structure
RFC 8493 compliant bag with `data/` payload directory.

```
locations/NY/a7f3b2c1e9d4f086/
├── bagit.txt              # BagIt version declaration
├── bag-info.txt           # Location metadata (machine + human readable)
├── manifest-blake3.txt    # Checksums for all files in data/
├── tagmanifest-blake3.txt # Checksums for bag-info.txt, README.txt
├── README.txt             # Human-readable summary
└── data/                  # Payload directory (RFC 8493 standard)
```

### Level 4: Content Folders (inside data/)

| Folder | Purpose | Content Examples |
|--------|---------|------------------|
| `org-img/` | Original images | Camera photos, scanned photos |
| `org-vid/` | Original videos | Camera recordings |
| `org-doc/` | Original documents | PDFs, scanned documents |
| `org-map/` | Original maps | Scanned floor plans, historical maps |
| `web-img/` | Web-sourced images | Downloaded photos |
| `web-vid/` | Web-sourced videos | Downloaded videos |
| `web-doc/` | Web archives | .warc files, HTML, bookmarks |
| `sloc-[SUBID]/` | Sub-location media | All media for a specific sub-location |

```
data/
├── org-img/
│   ├── a7f3b2c1e9d4f086.jpg
│   ├── a7f3b2c1e9d4f086.xmp     # XMP sidecar (alongside original)
│   └── .a7f3b2c1e9d4f086.proxy.mp4  # Video proxy (if video, hidden)
├── org-vid/
├── org-doc/
├── org-map/
├── web-img/
├── web-vid/
├── web-doc/
└── sloc-b3c4d5e6f7a8b9c0/       # Sub-location folder
    ├── org-img/
    ├── org-vid/
    └── ...
```

**Naming pattern:** `[source]-[type]/`
- Source: `org` (original) or `web` (web-sourced)
- Type: `img`, `vid`, `doc`, `map`

**Sub-location pattern:** `sloc-[SUBID]/`
- Contains same folder structure as parent
- Included in parent's BagIt manifest

---

## Sidecar Files

### XMP Sidecars
Stored alongside original media files:
```
data/org-img/a7f3b2c1e9d4f086.jpg
data/org-img/a7f3b2c1e9d4f086.xmp    # XMP metadata sidecar
```

### Video Proxies (Inline)
Stored as hidden files alongside originals (OPT-053 Immich model):
```
data/org-vid/a7f3b2c1e9d4f086.mov
data/org-vid/.a7f3b2c1e9d4f086.proxy.mp4   # Hidden proxy file
```

**Note:** Video proxies are also cached globally in `.cache/video-proxies/` for faster access.

---

## BagIt Integration (RFC 8493)

### bagit.txt
```
BagIt-Version: 1.0
Tag-File-Character-Encoding: UTF-8
```

### bag-info.txt
```
Source-Organization: AU Archive
Bagging-Date: 2025-12-09
Bag-Software-Agent: AU Archive v0.1.0
External-Identifier: a7f3b2c1e9d4f086
Location-Name: Willard State Hospital
Location-State: NY
Location-Type: Hospital
Location-County: Seneca
Location-GPS: 42.6821, -76.8773
Payload-Oxum: 1234567.42
```

### manifest-blake3.txt
```
a7f3b2c1e9d4f086  data/org-img/photo001.jpg
b3c4d5e6f7a8b9c0  data/org-img/photo002.jpg
c4d5e6f7a8b9c0d1  data/org-vid/video001.mp4
d5e6f7a8b9c0d1e2  data/sloc-e6f7a8b9c0d1e2f3/org-img/sub-photo.jpg
```

### tagmanifest-blake3.txt
```
e6f7a8b9c0d1e2f3  bag-info.txt
f7a8b9c0d1e2f3a4  README.txt
```

### Validation
Any BagIt-compliant tool can validate the bag:
```bash
bagit.py --validate locations/NY/a7f3b2c1e9d4f086/
```

---

## README.txt Sidecar

Human-readable file for discovery without the app or BagIt tools.

### Format (Plain Text)
```
Willard State Hospital
======================
State:    NY
Type:     Hospital
County:   Seneca
GPS:      42.6821, -76.8773
Created:  2025-12-09
Modified: 2025-12-09

Sub-Locations:
- Main Building (b3c4d5e6f7a8b9c0)
- Power Plant (c4d5e6f7a8b9c0d1)

Notes:
Opened 1869 as Willard Asylum for the Chronic Insane.
Closed 1995. Buildings in various states of decay.
```

### Update Rules
- Generated on location creation
- Updated when metadata changes (name, type, county, GPS, notes)
- Updated when sub-locations added/removed
- Checksum updated in tagmanifest-blake3.txt after each change

### Discovery Without App
```bash
# Find all NY locations
cat locations/NY/*/README.txt

# Find "Willard" anywhere
grep -r "Willard" locations/*/*/README.txt

# List all hospitals
grep -l "Type:.*Hospital" locations/*/*/README.txt
```

---

## Global Folders (Archive Root)

```
[archive]/
├── .thumbnails/          # Generated thumbnails (hidden, cache)
│   └── [bucket]/         # 2-char hash prefix buckets
├── .previews/            # RAW file previews (hidden, cache)
│   └── [bucket]/
├── .posters/             # Video poster frames (hidden, cache)
│   └── [bucket]/
├── .cache/               # Other caches (hidden)
│   └── video-proxies/    # Video proxy cache
├── database/             # Database snapshots (visible, important)
│   ├── au-archive-snapshot.db
│   ├── snapshot.sha256
│   └── snapshot-info.json
├── websources/           # Unlinked web archives (visible)
│   └── [source_id]/
└── locations/            # Main location storage
```

**Naming conventions:**
- Dot prefix (`.`) = cache/generated, can be regenerated
- No prefix = important data, should be backed up

---

## Sub-Location Handling

Sub-locations are stored within the parent location's BagIt bag.

### Structure
```
locations/NY/a7f3b2c1e9d4f086/
└── data/
    ├── org-img/              # Parent location images
    ├── sloc-b3c4d5e6f7a8b9c0/   # Sub-location 1
    │   ├── org-img/
    │   ├── org-vid/
    │   └── org-doc/
    └── sloc-c4d5e6f7a8b9c0d1/   # Sub-location 2
        └── ...
```

### Benefits
- Sub-locations travel with parent (single folder copy)
- Single BagIt manifest covers all content
- Parent's README.txt lists all sub-locations
- No orphaned sub-location folders

### Sub-Location README
Each sub-location folder can optionally have its own README:
```
locations/NY/a7f3b2c1e9d4f086/data/sloc-b3c4d5e6f7a8b9c0/README.txt
```

---

## State Change Protocol

When user changes location state (e.g., NY → PA):

### Steps
1. Validate target path doesn't exist: `locations/PA/[LOCID]/`
2. Move entire folder: `locations/NY/[LOCID]/` → `locations/PA/[LOCID]/`
3. Update database record
4. Update README.txt (State field)
5. Update bag-info.txt (Location-State field)
6. Regenerate tagmanifest-blake3.txt
7. Log move in audit trail

### Edge Cases
| Scenario | Action |
|----------|--------|
| Target folder exists | Error: "Location ID conflict in target state" |
| Move fails mid-operation | Rollback: restore original, log error |

---

## Location Creation Requirements

| Field | Required | Mutable | Folder Impact |
|-------|----------|---------|---------------|
| State | Yes | Yes (moves folder) | `locations/[STATE]/` |
| Name | Yes | Yes (updates README + bag-info only) | None |
| Location ID | Auto-generated | Never | `locations/[STATE]/[LOCID]/` |
| Type | No | Yes (updates README + bag-info only) | None |
| County | No | Yes (updates README + bag-info only) | None |
| GPS | No | Yes (updates README + bag-info only) | None |

---

## Path Length Analysis

### Worst Case Path
```
/Users/username/Documents/Archives/locations/NY/a7f3b2c1e9d4f086/data/sloc-b3c4d5e6f7a8b9c0/org-img/c4d5e6f7a8b9c0d1.jpg
```

**Character count: ~125 characters**

### Comparison to Current
```
/Users/username/Documents/Archives/locations/NY-HOSPITAL/willard-asylum-550e8400e29b/org-img-550e8400e29b/IMG_1234.jpg
```

**Character count: ~125 characters**

**Result:** Similar path length, but new structure is more consistent.

---

## Database Changes

### Schema Changes

#### locs table
```sql
-- Before
locid TEXT PRIMARY KEY,           -- UUID (36 chars)
loc12 TEXT UNIQUE NOT NULL,       -- Short ID (12 chars)

-- After
locid TEXT PRIMARY KEY,           -- BLAKE3 16-char (IS the short ID)
-- loc12 column REMOVED (redundant)
```

#### slocs table
```sql
-- Before
subid TEXT PRIMARY KEY,           -- UUID
sub12 TEXT UNIQUE NOT NULL,       -- Short ID

-- After
subid TEXT PRIMARY KEY,           -- BLAKE3 16-char
-- sub12 column REMOVED (redundant)
```

#### Foreign Keys (all media tables)
```sql
-- imgs, vids, docs, maps tables
locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL,
```

### Column Removals
| Table | Column | Reason |
|-------|--------|--------|
| locs | loc12 | Redundant - locid IS the short ID now |
| slocs | sub12 | Redundant - subid IS the short ID now |

### Path Column Updates
All path columns change format:
- `imgloc`, `vidloc`, `docloc`, `maploc` — new folder structure
- `thumb_path`, `preview_path`, `poster_path` — unchanged (global cache)

---

## Migration Plan

### Prerequisites
- Fresh database (no migration of existing data)
- Wipe test files with `python3 resetdb.py -a /path/to/archive --wipe-media`

### Database Changes
1. Update schema to use BLAKE3 16-char for `locid` and `subid`
2. Remove `loc12` and `sub12` columns
3. Update all code references from `loc12` to `locid`
4. Update all code references from `sub12` to `subid`

### Code Changes
| File | Change |
|------|--------|
| `crypto-service.ts` | Add `generateLocationId()` function |
| `media-path-service.ts` | Update folder structure logic |
| `file-import-service.ts` | Update path generation |
| `location-handlers.ts` | Use new ID generation, remove loc12 references |
| `bagit-service.ts` | Update for new structure, RFC 8493 compliant |
| `database-archive-service.ts` | Change `_database` to `database` |
| `websource-orchestrator-service.ts` | Update path generation |
| `sqlite-location-repository.ts` | Remove loc12 column usage |
| `sqlite-sublocation-repository.ts` | Remove sub12 column usage |

### New Files
| File | Purpose |
|------|---------|
| `readme-service.ts` | Generate/update README.txt |

### Folder Structure Changes
1. Remove type from path
2. Remove name from path
3. Remove `loc12`/`sub12` from subfolder names
4. Add `data/` payload directory (RFC 8493)
5. Rename subfolders: `org-img-[LOC12]/` → `org-img/`
6. Add `org-map/` folder
7. Add `web-img/`, `web-vid/`, `web-doc/`
8. Add `sloc-[SUBID]/` for sub-locations
9. Move BagIt files to location root
10. Add README.txt generation
11. Change `_database/` to `database/`
12. Change `_websources/` to `websources/`

---

## Scale Analysis

| Locations | States | Avg per State | Max per State (estimated) |
|-----------|--------|---------------|---------------------------|
| 1,000 | 50 | 20 | 100 |
| 10,000 | 50 | 200 | 1,000 |
| 50,000 | 50 | 1,000 | 5,000 |
| 100,000 | 50 | 2,000 | 10,000 |

**Filesystem limits:**
- ext4: 64,000 subdirectories per directory
- NTFS: ~4 billion files per volume
- APFS: No practical limit

**Conclusion:** Structure scales to 100k+ locations without filesystem concerns.

---

## Next Steps

1. [ ] Review and approve this plan
2. [ ] Create database schema changes (remove loc12/sub12)
3. [ ] Update crypto-service.ts with generateLocationId()
4. [ ] Update media-path-service.ts for new structure
5. [ ] Update file-import-service.ts for new paths
6. [ ] Update bagit-service.ts for RFC 8493 compliance
7. [ ] Update database-archive-service.ts (rename folder)
8. [ ] Update websource-orchestrator-service.ts
9. [ ] Create readme-service.ts
10. [ ] Update all repository files (remove loc12/sub12)
11. [ ] Test with fresh database
12. [ ] Update CLAUDE.md and related docs
