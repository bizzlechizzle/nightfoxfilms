# Plan: Complete Reset Script for Fresh Import Testing

## Problem

Running `python3 resetdb.py -a /Volumes/abandoned/archive` doesn't wipe everything needed for a real-world fresh import test. The current script clears:

**Currently cleared (archive support):**
- `.thumbnails/` - Image thumbnails (400, 800, 1920px)
- `.previews/` - RAW file previews (extracted/converted JPEGs)
- `.posters/` - Video poster frames
- `.cache/video-proxies/` - Video proxy files (720p playback versions)
- `_database/` - Database snapshot exports

**NOT cleared (discovered gaps):**

1. **`locations/` folder** - The actual media files and folder structure
   - Contains all imported images, videos, documents
   - Contains `_archive/` BagIt folders (bagit.txt, manifest-sha256.txt, etc.)
   - This is THE archive data - without clearing this, re-import will find existing files

2. **XMP sidecar files** - `.xmp` files stored alongside media
   - Rating, labels, keywords metadata
   - Stored in same folder as media files (inside `locations/`)

3. **`.DS_Store` files** - macOS creates these automatically
   - Not critical but good hygiene

## Why This Matters

For a **real fresh import test**, you need:
- Empty database (currently handled)
- Empty archive folder (NOT currently handled)
- No cached thumbnails/previews/proxies (currently handled)

Without clearing `locations/`, re-importing would:
- Find existing files with same SHA256 hashes
- Skip actual file copies (idempotent import)
- NOT test the full import pipeline (hashing, copying, metadata extraction)

## Proposed Changes

### Option A: Add `--wipe-media` flag (Recommended)

Add a new flag that explicitly clears the `locations/` folder. This is DESTRUCTIVE and should require explicit opt-in.

**New flags:**
- `--wipe-media` - Clear the `locations/` folder (media files, BagIt archives, XMP sidecars)
- Keep existing `--nuclear` for browser profile only

**Usage:**
```bash
# Standard reset (DB, config, logs, caches)
python3 resetdb.py -a /path/to/archive

# Full wipe for fresh import testing (DESTRUCTIVE)
python3 resetdb.py -a /path/to/archive --wipe-media

# Complete nuke (media + browser profile)
python3 resetdb.py -a /path/to/archive --wipe-media --nuclear
```

### Option B: Add `--fresh-import` convenience flag

Alias that combines clearing everything needed for fresh import testing:
- DB + config + logs
- Archive support dirs (.thumbnails, .previews, .posters, .cache, _database)
- Archive media (`locations/`)

```bash
python3 resetdb.py -a /path/to/archive --fresh-import
```

## Implementation Details

### Files to modify:
- `resetdb.py` (root directory)

### Changes:
1. Add `--wipe-media` argument to argparse
2. Add warning message in preview showing `locations/` will be deleted
3. Add extra confirmation for `--wipe-media` (type "DELETE" or similar)
4. Add `remove_dir(archive / "locations", "Media archive")` when flag is set
5. Update docstring and help text

### Safety measures:
- Double confirmation required for `--wipe-media`
- Show estimated file count/size before deletion
- Warn that BagIt archives will be lost
- Log what was deleted

### Scope check:
- This modifies `resetdb.py` (allowed per lilbits.md - it's a utility script)
- Does NOT modify CLAUDE.md, techguide.md, or lilbits.md
- Follows "One Script = One Function" - reset script already handles cleanup

## What Gets Cleared (Complete List with `--wipe-media`)

### App Config (always):
- `~/Library/Application Support/@au-archive/desktop/data/au-archive.db` + WAL/SHM
- `~/Library/Application Support/@au-archive/desktop/config.json`
- `~/Library/Application Support/@au-archive/desktop/backups/`
- `~/Library/Application Support/@au-archive/desktop/logs/`
- `~/Library/Application Support/@au-archive/desktop/maintenance-history.json`
- Dev database: `packages/desktop/data/au-archive.db`

### Archive Support (with `-a`):
- `[archive]/.thumbnails/` - Multi-tier image thumbnails
- `[archive]/.previews/` - RAW file preview JPEGs
- `[archive]/.posters/` - Video poster frames
- `[archive]/.cache/video-proxies/` - Video playback proxies
- `[archive]/_database/` - Database snapshots

### Archive Media (with `--wipe-media`):
- `[archive]/locations/` - All imported media files
  - Images (org-img-*/*)
  - Videos (org-vid-*/*)
  - Documents (org-doc-*/*)
  - BagIt archives (org-doc-*/_archive/*)
  - XMP sidecars (*.xmp)

### Browser (with `--nuclear`):
- `~/Library/Application Support/@au-archive/desktop/research-browser/`

## Update lilbits.md

After implementation, update lilbits.md entry for resetdb.py with new flags documentation.

## Questions for User

None - the task is clear: enable complete wipe for fresh import testing.

## Risk Assessment

- **Low risk**: Utility script change only
- **Safety built-in**: Requires explicit flag + extra confirmation
- **Reversible**: If user has backups, they can restore
- **No production impact**: Test utility only
