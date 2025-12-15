# Data Flow

## Pipeline Summary

1. Import service receives file paths, computes SHA256, assigns organized name (`<sha>.<ext>`), and copies into archive storage.
2. Metadata services call ExifTool/FFmpeg/sharp, normalize results, and persist in SQLite via repositories.
3. GPS pipeline enforces confidence rules and writes `gps_*` fields plus derived address data.
4. BagIt service updates self-documenting archive files (manifest, bag-info) for each location after imports.
5. Database archive service exports SQLite snapshot to archive folder after backups and on app quit.
6. Renderer queries locations/media via preload, hydrates UI stores, and updates map/list components.
7. Exporters read from SQLite and the file store, producing CSV/GeoJSON/HTML bundles tied to SHA references.

## Import Spine

Watcher scans drop zone, hashes every file, copies into archive folder, and links to locations via SHA primary keys before metadata extraction.

## Smoke Checklist Before Shipping

1. Import at least one photo, video, and document; confirm SHA + organized filenames in DB.
2. Create a location via map pin and verify address normalization + confidence state.
3. Toggle resource folders to test Light vs Offline Beast detection and UI toggling.
4. Run lint + targeted tests; capture outputs in task log.

## Error Response Norms

- Prefer inline errors + recovery instructions.
- Log technical error to console/log file, surface human-readable summary in UI.
- Offline edition must not crash when network fails; show limited-state UI.

## Failure Budget

Prefer graceful degradation (disabled buttons + tooltips) instead of throwing when resources are missing.
