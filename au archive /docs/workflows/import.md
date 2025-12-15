# Import Workflow

## Import Spine

Watcher scans drop zone, hashes every file (BLAKE3), copies into archive folder, and links to locations via hash primary keys **before metadata extraction**.

## Import Sequence

1. **User selects files/folders** — Renderer sends absolute paths through preload
2. **Main process validates** — Check permissions, available disk space
3. **Hash service computes BLAKE3** — Stream file, compute 16-char hex hash, assign organized name `<hash>.<ext>`
4. **File copied to archive folder** — Organized by location structure
5. **Metadata extraction runs** — ExifTool/FFmpeg/sharp extract metadata in background
6. **Repository upserts** — Media record keyed by BLAKE3 hash, linked to location/sub-location (if provided)
7. **Import queue updates** — Status: pending → processing → complete/error
8. **Post-import processing** — Live Photo detection, SDR duplicate hiding
9. **Auto-hero selection** — If location has no hero image and images were imported, first image becomes hero

## Folder Organization (ADR-046)

User-selected base folder → `locations/[STATE]/[LOCID]/`

Subfolders:
- `data/org-img/` — Images
- `data/org-vid/` — Videos
- `data/org-doc/` — Documents
- `archive/` — BagIt package (RFC 8493)

## Idempotency

Imports are idempotent. Rerunning import on same directory only adds links, not duplicate bytes. Hash collisions reuse existing files.

## Status Tracking

Import queue stores status for UI progress bars:
- `pending` — Queued, not started
- `processing` — Currently importing
- `complete` — Successfully imported
- `error` — Failed with reason

## Error Handling

- **Hash mismatch** — File corrupted, reject import
- **Permission denied** — Show error, suggest folder permissions fix
- **Disk space** — Check before import, warn user if insufficient
- **Duplicate file** — Prompt: skip or overwrite

## Progress Indicators

- Real-time progress bars in UI
- Background job for metadata extraction (doesn't block)
- Progress events emitted via IPC (`media:import:progress`)

## Audit Trail

Every import captures:
- Importer username
- Timestamps (import_date)
- Source paths (original_name)
- BLAKE3 hash (organized_name)

## Auto-Hero Selection

After a successful import, the system automatically sets a hero image for dashboard thumbnails:

- **Condition**: Location has no `hero_imgsha` AND at least one image was successfully imported
- **Selection**: First successfully imported image (not duplicate, not skipped)
- **Behavior**: Only runs once per location; manual hero selection always takes precedence
- **Non-blocking**: Failure to set auto-hero does not fail the import

This ensures new locations immediately appear with thumbnails on the Dashboard without requiring manual hero selection.

## Unified Image Processing Pipeline

**Single Source of Truth**: `packages/desktop/electron/services/import/job-builder.ts`

All image imports (local files AND web downloads) use the same processing pipeline via `job-builder.ts`. This ensures consistent metadata extraction, thumbnail generation, and tagging regardless of import source.

### Per-File Jobs (run for each image)

| Job | Priority | Depends On | Purpose |
|-----|----------|------------|---------|
| EXIFTOOL | HIGH (50) | - | Extract dimensions, date, GPS, camera info |
| THUMBNAIL | NORMAL (10) | ExifTool | Generate 400px, 800px, 1920px thumbnails |
| IMAGE_TAGGING | BACKGROUND (0) | ExifTool | RAM++ tags, view type, quality score |

### Per-Location Jobs (run once after batch)

| Job | Priority | Depends On | Purpose |
|-----|----------|------------|---------|
| GPS_ENRICHMENT | NORMAL (10) | Last ExifTool | Aggregate GPS from media to location |
| LIVE_PHOTO | NORMAL (10) | Last ExifTool | Detect Live Photo pairs |
| LOCATION_STATS | BACKGROUND (0) | GPS Enrichment | Update media counts and date ranges |
| BAGIT | BACKGROUND (0) | GPS Enrichment | Update RFC 8493 manifest |
| LOCATION_TAG_AGGREGATION | BACKGROUND (0) | GPS Enrichment | Aggregate tags, suggest type/era |

### Import Entry Points

| Entry Point | File | Uses Job Builder? |
|-------------|------|-------------------|
| Local Import v2 | `finalizer.ts` | Yes (builds same jobs) |
| Web Image Download | `image-downloader.ts` | Yes (`queueImageProcessingJobs`) |

### Backfill Existing Images

For images imported before the unified pipeline, run:

```bash
python scripts/backfill-image-processing.py --dry-run  # Preview
python scripts/backfill-image-processing.py            # Apply
python scripts/backfill-image-processing.py --web-only # Only web images
```
