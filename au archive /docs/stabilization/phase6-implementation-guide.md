# v0.1.0 Implementation Guide

**Generated:** 2025-11-30
**Version:** 0.1.0 Stabilization

---

## Overview

This guide documents the complete implementation state of Abandoned Archive v0.1.0 for developers joining the project or resuming work after a break.

---

## Quick Start

```bash
# Clone and setup
git clone <repo-url>
cd au-archive

# Full setup (installs dependencies, builds packages, downloads Research Browser)
./scripts/setup.sh

# Or quick setup (skip optional dependencies)
./scripts/setup.sh --skip-optional

# Run in development mode
pnpm dev

# Build for production
pnpm build
```

---

## Architecture Overview

### Monorepo Structure

```
au-archive/
├── packages/
│   ├── core/           # Domain models, repository contracts
│   │   └── src/
│   │       ├── domain/      # Location, Media entities
│   │       └── repositories/ # Interface definitions
│   └── desktop/        # Electron application
│       ├── electron/
│       │   ├── main/        # App lifecycle, IPC handlers
│       │   ├── preload/     # CommonJS bridge (CRITICAL)
│       │   ├── services/    # Business logic services
│       │   └── repositories/ # SQLite implementations
│       └── src/
│           ├── pages/       # Svelte page components
│           ├── components/  # Reusable UI components
│           └── stores/      # Svelte stores
├── scripts/            # Setup and utility scripts
├── resources/          # Binary helpers, maps, icons
└── docs/               # Documentation
```

### Critical Files

| File | Purpose | Gotchas |
|------|---------|---------|
| `electron/preload/preload.cjs` | Context bridge | MUST be CommonJS, never bundled |
| `electron/main/database.ts` | SQLite + 39 migrations | Never edit existing migrations |
| `vite.config.ts` | Build config | Custom `copyPreloadPlugin()` |
| `electron/services/*` | Business logic | All 20+ services here |

---

## IPC Architecture

### Channel Naming Convention

All IPC channels follow `domain:action` format:

```typescript
// Good
'location:create'
'media:import'
'settings:get-all'

// Bad
'createLocation'
'importMedia'
```

### IPC Flow

```
Renderer → Preload Bridge → Main Process → Service → Repository → SQLite
                                 ↓
                            Response flows back
```

### Handler Registration

Handlers are registered in `electron/main/index.ts`:

```typescript
// Pattern
ipcMain.handle('domain:action', async (_, input) => {
  const schema = DomainActionSchema;
  const parsed = schema.parse(input);
  return await service.action(parsed);
});
```

### Current IPC Channels (238 total)

| Domain | Count | Examples |
|--------|-------|----------|
| location | 26 | create, update, delete, find-all |
| media | 28 | import, get-thumbnail, delete |
| sublocation | 14 | create, update, set-primary |
| ref-maps | 18 | import, find-matches, delete-point |
| geocode | 12 | forward, reverse, forward-cascade |
| imports | 8 | find-recent, get-stats |
| settings | 8 | get, set, get-all |
| ... | ... | ... |

---

## Database

### Location

- **Dev path:** `packages/desktop/data/au-archive.db`
- **Production path:** `[userData]/auarchive.db`

### Migrations

All 39 migrations are inline in `database.ts`:

```typescript
const migrations = [
  { id: 1, name: 'initial_schema', sql: '...' },
  { id: 2, name: 'add_location_fields', sql: '...' },
  // ... up to migration 39
];
```

**Rules:**
- Never edit existing migrations
- New changes require new migration
- Migrations run automatically on app start

### Key Tables

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| locations | Location records | locid (UUID) |
| sub_locations | Buildings within locations | subid (UUID) |
| images | Image metadata | imgsha (SHA256) |
| videos | Video metadata | vidsha (SHA256) |
| documents | Document metadata | docsha (SHA256) |
| users | User accounts | user_id (UUID) |
| ref_maps | Reference map imports | map_id (UUID) |
| ref_map_points | Points from ref maps | point_id (UUID) |

---

## Services Overview

### Import Flow

```
file-import-service.ts
├── Compute SHA256 (crypto-service.ts)
├── Check for duplicates
├── Copy to archive folder (media-path-service.ts)
├── Extract metadata
│   ├── exiftool-service.ts (images)
│   ├── ffmpeg-service.ts (videos)
│   └── sharp (thumbnails)
└── Insert/update database record
```

### GPS Flow

```
geocoding-service.ts
├── Forward geocode (address → GPS)
├── Reverse geocode (GPS → address)
├── Cascade geocoding (tries multiple strategies)
└── address-normalizer.ts
    ├── State code validation
    ├── ZIP code normalization
    └── City/county title-casing
```

### Key Services

| Service | Purpose |
|---------|---------|
| `file-import-service.ts` | Import orchestration |
| `media-path-service.ts` | Archive folder organization |
| `crypto-service.ts` | SHA256 hashing |
| `geocoding-service.ts` | Forward/reverse geocoding |
| `address-normalizer.ts` | Address field normalization |
| `location-duplicate-service.ts` | Duplicate detection |
| `jaro-winkler-service.ts` | String similarity matching |
| `darktable-service.ts` | RAW file processing |
| `research-browser-service.ts` | Embedded browser control |

---

## Preload Script (CRITICAL)

### Why CommonJS?

Electron's preload script runs in a special context between renderer and main processes. It must be CommonJS because:

1. ES modules crash before UI loads
2. `contextBridge` requires synchronous execution
3. Vite cannot bundle it (would break `require('electron')`)

### Current Implementation

```javascript
// electron/preload/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  locations: {
    findAll: () => ipcRenderer.invoke('location:find-all'),
    create: (data) => ipcRenderer.invoke('location:create', data),
    // ...
  },
  media: {
    import: (data) => ipcRenderer.invoke('media:import', data),
    // ...
  },
  // ... all 238 channels exposed
});
```

### Build Process

The preload script is copied (NOT bundled) via custom Vite plugin:

```typescript
// vite.config.ts
function copyPreloadPlugin() {
  return {
    name: 'copy-preload',
    writeBundle() {
      // Copy preload.cjs to dist-electron/preload/
    }
  };
}
```

---

## Testing

### Running Tests

```bash
# All tests
pnpm -r test

# Core package only
pnpm --filter core test

# Desktop package only
pnpm --filter desktop test
```

### Test Locations

- **Core:** `packages/core/src/__tests__/`
- **Desktop:** `packages/desktop/electron/__tests__/`

### Focus Areas

| Area | Tests For |
|------|-----------|
| Hashing | SHA256 computation, collision detection |
| GPS | Coordinate validation, confidence tiers |
| Address | Normalization, state code conversion |
| Import | File type detection, duplicate handling |

---

## Common Tasks

### Adding a New IPC Channel

1. Add handler in `electron/main/ipc-handlers/{domain}.ts`:
```typescript
ipcMain.handle('domain:new-action', async (_, input) => {
  const parsed = NewActionSchema.parse(input);
  return await service.newAction(parsed);
});
```

2. Add to preload in `electron/preload/preload.cjs`:
```javascript
domain: {
  newAction: (data) => ipcRenderer.invoke('domain:new-action', data),
}
```

3. Add TypeScript types in `src/types/electron.d.ts`

### Adding a New Service

1. Create service file: `electron/services/new-service.ts`
2. Export functions (not class typically)
3. Import in handlers that need it

### Adding a Migration

1. Find next migration number (currently 39)
2. Add to migrations array in `database.ts`:
```typescript
{
  id: 40,
  name: 'describe_change',
  sql: `
    ALTER TABLE ... ;
  `,
},
```

---

## Debugging

### Common Issues

| Issue | Solution |
|-------|----------|
| Preload crashes silently | Check for ES module syntax in `.cjs` |
| Database locked | Ensure only one Electron instance |
| Native module mismatch | `pnpm --filter desktop rebuild` |
| Types out of sync | `pnpm --filter core build` first |
| Build scripts ignored | `pnpm reinstall` |

### Useful Commands

```bash
# Check dependencies
./scripts/check-deps.sh

# Reset development database
python3 resetdb.py

# Rebuild native modules
pnpm --filter desktop rebuild

# Clean reinstall
pnpm reinstall
```

---

## Code Style

### File Naming

| Type | Convention | Example |
|------|------------|---------|
| Svelte components | PascalCase | `LocationCard.svelte` |
| Services/utilities | kebab-case | `hash-service.ts` |
| Domain models | PascalCase | `Location.ts` |
| IPC handlers | kebab-case | `location-handlers.ts` |

### Console Logging

**Production code:**
- ❌ No `console.log` for debugging
- ✅ Use `console.error` for actual errors
- ✅ Use logger service (v0.1.1) for structured logging

**Development:**
- Wrap debug logs: `if (process.env.NODE_ENV === 'development')`

---

## Known Limitations (Resolved or Risk Accepted)

1. **Logger Service** - Risk Accepted: Main process logs not user-visible in production
2. **Duplicate Script Consolidation** - FIXED: Removed run-dedup.mjs, kept Python version
3. **Duplicate Function Consolidation** - Risk Accepted: Both implementations work correctly
4. **Missing Zod Validation** - Risk Accepted: 4 handlers take no user-controlled input

---

## Key Documentation

| Doc | Purpose |
|-----|---------|
| `CLAUDE.md` | Project rules, boot sequence |
| `techguide.md` | Technical implementation details |
| `lilbits.md` | Script registry |
| `docs/ARCHITECTURE.md` | System architecture |
| `docs/DATA_FLOW.md` | Data pipeline details |
| `docs/contracts/*.md` | GPS, hashing, addressing rules |
| `docs/workflows/*.md` | User-facing workflows |

---

**END OF IMPLEMENTATION GUIDE**
