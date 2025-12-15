# Export Workflow

## Export Formats

### CSV
- All location metadata in tabular format
- GPS coordinates as decimal degrees
- Media count per location
- SHA256 references to files

### GeoJSON
- Standard geographic format
- Compatible with mapping tools (QGIS, ArcGIS, Leaflet)
- Properties include all metadata
- Geometry: Point (lat/lng)

### HTML Bundle
- Self-contained archive with embedded map
- Includes thumbnails and metadata
- Works offline after export
- Links to original media files (if on same filesystem)

## Export Options

- **Filter by state** — Export only selected states
- **Filter by type** — Export only specific location types
- **GPS confidence filter** — Exclude low-confidence locations
- **Include media** — Copy media files into export folder
- **SHA integrity** — Include SHA256 checksums for verification

## Backup Workflow

1. User selects "Create Backup" from Settings
2. App prompts for destination folder
3. Exports:
   - SQLite database file (copy)
   - Media directory (full copy)
   - Backup manifest (timestamp, file list, checksums)
4. Verify integrity — Re-hash random sample, compare against stored SHAs
5. Log backup to `backup_log` table (timestamp, destination, status)

## Restoration Workflow

1. User selects "Restore Backup"
2. App prompts for backup folder
3. Verify backup integrity — Check manifest, compare checksums
4. Restore database — Copy SQLite file to userData location
5. Restore media — Copy media directory to archive location
6. Verify imports — Check that existing SHA records prevent duplicates
7. Restart app to load restored database

## Consent & Transparency

- Every export prompts for destination
- Summary shows what data will leave the machine
- **Nothing leaves silently**
- Export log maintained locally (timestamp, scope, destination)

## Verification Steps

After export:
1. Check file count matches expected
2. Verify SHA256 checksums (for critical exports)
3. Test import into clean database (for backups)
4. Confirm media files accessible (if included)

## Data Ownership Guarantee

- Exports never contain hidden identifiers
- No AI references in metadata
- Preserve original EXIF, captions, credits
- Never strip authorship information
