# AU Archive Technical Implementation Guide

Version: 0.1.0
Last Updated: 2025-11-21

---

## Purpose

This guide provides detailed technical implementation information for developers working on AU Archive. It complements claude.md by providing specific configuration details, API documentation, and troubleshooting steps.

---

## Quick Reference

### File Structure

```
au-archive/
├── claude.md         # Architecture & specification (you are here)
├── techguide.md      # This file - implementation details
├── lilbits.md        # Script documentation
├── packages/
│   ├── core/         # Business logic (framework-agnostic)
│   └── desktop/      # Electron app
├── resources/        # Icons, binaries, assets
└── scripts/          # Build and utility scripts
```

### Key Technologies

- Desktop: Electron 28+
- Frontend: Svelte 5 + TypeScript 5.3+
- Database: SQLite (better-sqlite3)
- Build: Vite 5+ + pnpm 8+
- Mapping: Leaflet.js + Supercluster
- Metadata: exiftool-vendored, fluent-ffmpeg

---

## Development Environment Setup

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20+ LTS (22+ recommended) | Use nvm for version management |
| pnpm | 8+ (10+ recommended) | Install via `npm install -g pnpm` or corepack |
| Git | 2.x+ | Required for version control |
| ExifTool | Latest | Optional for dev, bundled in production |
| FFmpeg | Latest | Optional for dev, bundled in production |

### Installation

```bash
# Clone repository
git clone https://github.com/bizzlechizzle/au-archive.git
cd au-archive

# Install dependencies (automatically builds core package via postinstall)
pnpm install

# Start development
pnpm dev
```

**Note:** The `postinstall` script automatically runs `pnpm --filter core build` after installation.

### pnpm v10+ Native Module Build Scripts

pnpm v10+ blocks native module build scripts by default for security. This project has pre-configured approval in `package.json`:

```json
{
  "pnpm": {
    "onlyBuiltDependencies": [
      "electron",
      "better-sqlite3",
      "esbuild",
      "sharp",
      "7zip-bin"
    ]
  }
}
```

If you see "Ignored build scripts" warnings, run:
```bash
rm -rf node_modules packages/*/node_modules
pnpm install
```

### Common Installation Issues

**Issue: "vite: command not found"**
```bash
# node_modules not installed
pnpm install
```

**Issue: "Electron failed to install correctly"**
```bash
# Build scripts were blocked - clean reinstall
pnpm reinstall
# Or manually:
rm -rf node_modules packages/*/node_modules
pnpm install
```

**Issue: "Failed to resolve entry for package @au-archive/core"**
```bash
# Core package not built (postinstall may have failed)
pnpm build:core
# Or reinstall completely:
pnpm reinstall
```

**Issue: "Missing X server or $DISPLAY" (Linux/CI)**
```bash
# Normal in headless environments - Electron needs a display
# For CI, use xvfb-run: xvfb-run pnpm dev
```

### Development Commands

```bash
# Development mode (hot reload)
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint

# Format code
pnpm format
```

---

## Component Implementation Details

### Core Package (packages/core/)

Purpose: Framework-agnostic business logic that can be reused across desktop/mobile/web

Key Modules:
- domain/: Entity models with business logic
- services/: Business services (LocationService, ImportService, etc.)
- repositories/: Data access interfaces (abstract, no implementation)
- utils/: Shared utilities (validation, crypto, etc.)

### Desktop Package (packages/desktop/)

Purpose: Electron desktop application

Structure:
- electron/main/: Main process (Node.js)
- electron/preload/: Context bridge (security layer)
- electron/repositories/: SQLite implementations
- src/: Renderer process (Svelte UI)

---

## Database

### Connection

Database location: [userData]/auarchive.db
Connection: Synchronous (better-sqlite3)
Foreign keys: ENABLED via PRAGMA

### Schema Files

- electron/database/schema.sql: Initial schema
- electron/database/migrations/: Future migrations

### Common Queries

See packages/desktop/electron/repositories/ for prepared statement examples

---

## API Documentation (IPC Channels)

### Database Operations

Channel: db:location:create
Input: LocationInput object
Output: Location object
Error: Validation error or database error

Channel: db:location:findAll
Input: Optional filters (state, type, hasGPS, search)
Output: Array of Location objects
Error: Database error

Channel: db:location:findById
Input: Location ID (UUID string)
Output: Location object or null
Error: Database error

### File Operations

Channel: file:import
Input: { filePath: string, locId: string }
Output: Import result with new file paths
Error: File system error, duplicate file, invalid type

Channel: file:calculateSHA256
Input: File path string
Output: SHA256 hash string
Error: File not found, permission error

### Metadata Extraction

Channel: metadata:extractExif
Input: Image file path
Output: EXIF metadata object
Error: ExifTool error, invalid file

Channel: metadata:extractVideo
Input: Video file path
Output: FFmpeg metadata object
Error: FFmpeg error, invalid file

### Geocoding

Channel: geocode:reverse
Input: { lat: number, lng: number }
Output: ReverseGeocodeResult with address
Error: Network error, API error

---

## Configuration

### Environment Variables

None required for MVP. All configuration via UI settings.

### Settings Storage

Location: Database settings table
Format: Key-value pairs

Key settings:
- archive_folder: User-selected archive location
- delete_on_import: Boolean (true/false)
- current_user: Username for auth_imp field
- db_version: Schema version number

---

## File System Operations

### Archive Folder Structure

User selects base folder via settings. App creates:

```
[SELECTED_FOLDER]/
├── locations/
│   └── [STATE]-[TYPE]/
│       └── [SLOCNAM]-[LOC12]/
│           ├── org-img-[LOC12]/
│           ├── org-vid-[LOC12]/
│           └── org-doc-[LOC12]/
└── documents/
    └── maps/
        ├── user-maps/
        └── archive-maps/
```

### File Import Process

1. User selects files via file picker
2. Calculate SHA256 hash
3. Check for duplicates in database
4. Extract metadata (background job)
5. Copy/hardlink to archive folder
6. Verify integrity
7. Insert database record
8. Optional: Delete original

### Hardlink vs Copy

Prefer hardlink when source and destination are same filesystem.
Fallback to copy for cross-filesystem operations.

---

## Mapping Implementation

### Leaflet Setup

```typescript
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const map = L.map('map', {
  center: [42.6526, -73.7562], // Albany, NY
  zoom: 7,
  layers: [satelliteLayer] // Default to satellite
});
```

### Tile Layer Configuration

Satellite (default):
- Provider: ESRI World Imagery
- Max Zoom: 19
- Attribution required

Street:
- Provider: OpenStreetMap
- Max Zoom: 19
- Attribution required

Topographic:
- Provider: OpenTopoMap
- Max Zoom: 17
- Attribution required

### Marker Clustering

Use Supercluster library:
- Cluster radius: 60 pixels
- Max zoom for clustering: 16
- Min points to form cluster: 2

### GPS Confidence Colors

- verified: Green (#10b981)
- high: Blue (#3b82f6)
- medium: Yellow/Orange (#f59e0b)
- low: Red (#ef4444)
- none: Gray (#6b7280)

---

## Metadata Extraction

### ExifTool

Library: exiftool-vendored
Binary: Bundled in resources/bin/
Supported: Images (JPEG, PNG, TIFF, etc.)

Key fields extracted:
- ImageWidth, ImageHeight
- DateTimeOriginal
- Make, Model (camera)
- GPSLatitude, GPSLongitude
- Full metadata as JSON blob

### FFmpeg

Library: fluent-ffmpeg
Binary: Bundled in resources/bin/
Supported: Videos (MP4, MOV, AVI, etc.)

Key fields extracted:
- Duration
- Width, Height
- Codec
- Frame rate
- Full metadata as JSON blob

---

## Testing

### Unit Tests

Location: tests/unit/
Framework: Vitest
Coverage: 60-70% target

Run: pnpm test

### Integration Tests

Location: tests/integration/
Framework: Vitest
Coverage: Key workflows only

Run: pnpm test:integration

### E2E Tests (Future)

Location: tests/e2e/
Framework: Playwright
Coverage: Critical user flows

---

## Build & Deployment

### Development Build

```bash
pnpm dev
```

Starts Vite dev server + Electron in development mode
Hot reload enabled
DevTools open by default

### Production Build

```bash
pnpm build
```

Outputs to dist/ folder
Includes Electron app + bundled binaries

### Packaging

Uses electron-builder
Outputs platform-specific installers:
- macOS: .dmg + .zip
- Linux: .AppImage + .deb
- Windows: .exe (future)

---

## Troubleshooting

### Installation Issues

**Issue: "Ignored build scripts: better-sqlite3, electron, esbuild, sharp"**
- Cause: pnpm v10+ blocks native module build scripts by default
- Solution: This project has pre-configured approval in package.json. If you still see this:
```bash
rm -rf node_modules packages/*/node_modules
pnpm install
```

**Issue: "Electron failed to install correctly"**
- Cause: Electron's post-install script was blocked
- Solution: Clean reinstall (see above)

**Issue: "Failed to resolve entry for package @au-archive/core"**
- Cause: The core package hasn't been built yet
- Solution: Build it before running dev:
```bash
pnpm --filter core build
```

**Issue: "vite: command not found"**
- Cause: Dependencies not installed
- Solution: `pnpm install`

**Issue: "Missing X server or $DISPLAY" (Linux)**
- Cause: Electron requires a display server
- Solution: Use xvfb for headless environments: `xvfb-run pnpm dev`

**Issue: peer dependency warnings (@skeletonlabs/skeleton)**
- Cause: Skeleton UI expects Tailwind CSS 4.x, we use 3.x
- Solution: Safe to ignore - app functions correctly with Tailwind 3.x

### Database Issues

Issue: Database locked
Solution: Ensure no other process has database open. Close all app instances.

Issue: Foreign key constraint failed
Solution: Check that referenced location/sub-location exists before inserting media.

Issue: Migration failed
Solution: Backup database, check migration SQL syntax, restore if needed.

### File Import Issues

Issue: SHA256 mismatch after import
Solution: File may be corrupted. Re-import from original source.

Issue: Permission denied
Solution: Check file permissions. Ensure archive folder is writable.

Issue: Duplicate file
Solution: Prompt user to skip or overwrite. Check imgsha/vidsha in database.

### Metadata Extraction Issues

Issue: ExifTool not found
Solution: Ensure ExifTool binary is in resources/bin/ or system PATH.

Issue: FFmpeg error
Solution: Check video file format. Ensure FFmpeg binary is accessible.

Issue: No GPS in EXIF
Solution: Not all images have GPS. Check if camera/phone has location enabled.

### Mapping Issues

Issue: Tiles not loading
Solution: Check internet connection. Verify tile server URL is correct.

Issue: Markers not appearing
Solution: Check GPS coordinates are valid (lat -90 to 90, lng -180 to 180).

Issue: Clustering not working
Solution: Ensure Supercluster is initialized with location array.

---

## Performance Optimization

### Database

Use indexes for common queries (state, type, GPS)
Use prepared statements (prevents SQL injection, faster execution)
Batch inserts for bulk operations
Use transactions for atomic operations

### File System

Use streams for large files
Implement progress callbacks for imports
Queue background jobs (thumbnail generation, metadata extraction)
Cache frequently accessed files

### UI

Use virtual scrolling for long lists
Lazy load images (thumbnail first, full size on click)
Debounce map movements
Use Svelte stores for reactive state

---

## Security Best Practices

### Input Validation

Validate all user input with Zod schemas
Check GPS coordinates are in valid range
Validate file types before import
Sanitize user-generated content

### SQL Injection Prevention

Use prepared statements (better-sqlite3 handles this)
Never concatenate user input into SQL queries
Use query builder (Kysely) for complex queries

### File System Security

Sandboxed file access via Electron
User explicitly selects archive folder
No arbitrary file system access
Verify file integrity with SHA256

### IPC Security

Context isolation enabled
No Node.js integration in renderer
Expose only necessary APIs via contextBridge
Validate all IPC messages in main process

---

## Common Patterns

### Repository Pattern

Interface: packages/core/src/repositories/
Implementation: packages/desktop/electron/repositories/

Allows swapping SQLite for PostgreSQL/MongoDB without changing business logic.

### Domain Models

Location: packages/core/src/domain/location.ts
Contains business logic (getGPSConfidence, needsMapVerification, etc.)
Framework-agnostic

### Service Layer

LocationService: CRUD operations + business logic
ImportService: File import pipeline
GeocodingService: Reverse geocoding

---

## External Resources

Electron Docs: https://www.electronjs.org/docs
Svelte 5 Docs: https://svelte.dev/docs/svelte/overview
Leaflet API: https://leafletjs.com/reference.html
ExifTool: https://exiftool.org/
FFmpeg: https://ffmpeg.org/documentation.html
Nominatim API: https://nominatim.org/release-docs/latest/api/Reverse/

---

## Version History

v0.1.0 - 2025-11-21
- Initial specification
- Architecture defined
- Technology stack selected

---

End of Technical Guide
