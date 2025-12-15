# v0.1.0 Release Notes

**Release Date:** 2025-11-30
**Version:** 0.1.0 (Initial Stable Release)

---

## Overview

This is the first stable release of Abandoned Archive, a desktop application for cataloging abandoned places with verifiable, local-first evidence.

---

## What's New

### Core Features

- **Location Management** - Create, edit, and organize locations with GPS coordinates, addresses, and metadata
- **Media Import** - Import images, videos, and documents with SHA256 hashing for deduplication
- **GPS Verification** - Map-confirmed GPS with confidence tiers (map, EXIF, geocode, manual)
- **Reference Map Import** - Import KML/KMZ files with intelligent name matching
- **Cascade Geocoding** - Multi-tier address-to-GPS lookup (street → city → county → state)
- **Sub-Locations** - Campus/building hierarchy for complex sites
- **User Attribution** - Track who photographed and imported each media item

### Technical Highlights

- **Offline-First** - SQLite database, no cloud dependencies
- **SHA256 Primary Keys** - Media files referenced by content hash
- **39 Database Migrations** - Stable schema with upgrade path
- **238 IPC Channels** - Complete Electron main-renderer communication
- **CommonJS Preload** - Stable context bridge implementation

---

## Stabilization Changes

### Fixes Applied

| Issue | Description |
|-------|-------------|
| FIX-001 | Removed unused `@aws-sdk/client-s3` dependency |
| FIX-002 | Removed debug console.log statements from UI components |

### Documentation Updates

- Rewrote `techguide.md` with accurate implementation details
- Rewrote `lilbits.md` documenting all 7 scripts
- Created stabilization documentation suite in `docs/stabilization/`

---

## Known Issues

### Known Limitations (Risk Accepted)

| Issue | Description | Status |
|-------|-------------|--------|
| Console.log in IPC handlers | 116 instances in main process (not user-visible in production) | Risk Accepted |
| IPC handlers without Zod | 4 handlers (database, health, ref-maps, research-browser) take no user input requiring validation | Risk Accepted |
| A11y warnings | Pre-existing modal dialog accessibility warnings | Risk Accepted |

---

## System Requirements

- **Node.js:** 20+
- **pnpm:** 10+
- **Platform:** macOS (arm64/x64), Linux (x64), Windows (x64)
- **Disk Space:** ~500MB for app, varies for archive storage

### Optional Dependencies

- **darktable-cli** - RAW file processing
- **exiftool** - Enhanced metadata extraction
- **ffmpeg** - Video thumbnail generation
- **libpostal** - Offline address parsing (Offline Beast edition)

---

## Installation

```bash
# Clone repository
git clone <repo-url>
cd au-archive

# Run setup
./scripts/setup.sh

# Launch in development mode
pnpm dev

# Build for production
pnpm build
```

---

## Files Changed in This Release

```
Modified:
- packages/desktop/package.json (removed AWS SDK)
- packages/desktop/src/components/ImportModal.svelte
- packages/desktop/src/components/Map.svelte
- packages/desktop/src/components/MediaViewer.svelte
- packages/desktop/src/pages/Imports.svelte
- packages/desktop/src/pages/LocationDetail.svelte
- lilbits.md (complete rewrite)

Added:
- techguide.md (restored to root)
- docs/stabilization/*.md (audit & implementation docs)
```

---

## Upgrade Path

This is the initial release. Future versions will include migration guides.

---

## Contributors

- Bryant (Primary Developer)
- Claude (AI Pair Programmer)

---

**Full documentation:** See `docs/` directory

**Report issues:** https://github.com/<repo>/issues
