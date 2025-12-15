# Tech Guide — Abandoned Archive v0.1.0

Technical implementation guide for developers. Complements CLAUDE.md with specific configuration details, build setup, and troubleshooting.

---

## Environment Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20+ LTS (22+ recommended) | Use nvm for version management |
| pnpm | 10+ | Install via `npm install -g pnpm` or corepack |
| Git | 2.x+ | Required for version control |
| Python | 3.8+ | For utility scripts (run-dedup.py, resetdb.py) |
| ExifTool | Latest | Optional for dev; bundled via exiftool-vendored |
| FFmpeg | Latest | Optional for dev; required for video processing |
| libpostal | Latest | Optional; enables offline address parsing |

### Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| macOS (arm64) | ✅ Full | Primary development platform |
| macOS (x64) | ✅ Full | Intel Mac support |
| Linux (x64) | ⚠️ Partial | Tested on Ubuntu 22.04 |
| Windows | ⚠️ Limited | Manual browser install required |

---

## Repository Structure

```
au-archive/
├── CLAUDE.md            # Project rules and conventions (read first)
├── techguide.md         # This file - implementation details
├── lilbits.md           # Script registry
├── package.json         # Root workspace config
├── pnpm-workspace.yaml  # Monorepo workspace definition
│
├── packages/
│   ├── core/            # Domain models, repository contracts
│   │   ├── src/domain/  # Location, Media entities
│   │   └── src/repositories/  # Interface contracts
│   │
│   └── desktop/         # Electron application
│       ├── electron/    # Main process
│       │   ├── main/    # App lifecycle, database, IPC
│       │   ├── preload/ # Context bridge (CommonJS)
│       │   ├── services/# Business logic
│       │   └── repositories/  # SQLite implementations
│       └── src/         # Renderer process (Svelte)
│           ├── components/
│           ├── pages/
│           ├── stores/
│           └── lib/
│
├── scripts/             # Utility scripts (see lilbits.md)
├── docs/                # Contracts, workflows, decisions
│   ├── contracts/       # GPS, hashing, addressing specs
│   ├── workflows/       # Import, mapping, export flows
│   └── decisions/       # Architecture decision records
│
└── resources/           # Icons, binaries, assets (packaged)
```

---

## Setup From Scratch

### Quick Start (Recommended)

```bash
# Clone repository
git clone https://github.com/bizzlechizzle/au-archive.git
cd au-archive

# Run full setup (installs deps, builds, downloads browser)
./scripts/setup.sh

# Start development
pnpm dev
```

### Manual Setup

```bash
# 1. Install dependencies
pnpm install
# Expected: Installs node_modules, runs postinstall (builds core, rebuilds native modules)

# 2. Verify dependencies
pnpm deps
# Expected: Shows status of Node.js, pnpm, git, optional tools

# 3. Build packages
pnpm build
# Expected: Compiles core TypeScript, bundles desktop app

# 4. Start development server
pnpm dev
# Expected: Opens Electron window with hot reload
```

### Setup Options

```bash
./scripts/setup.sh              # Full setup (recommended)
./scripts/setup.sh --skip-optional  # Skip libpostal, exiftool, ffmpeg
./scripts/setup.sh --skip-browser   # Skip Ungoogled Chromium (~150MB)
./scripts/setup.sh --verbose        # Show detailed output
./scripts/setup.sh --help           # Show all options
```

---

## Build System

### Vite Configuration

The build uses Vite 5 with custom plugins:

**Key Config: `packages/desktop/vite.config.ts`**

```typescript
// Custom plugin copies preload.cjs WITHOUT bundling
// vite-plugin-electron transforms entry files, breaking pure CommonJS
function copyPreloadPlugin(): Plugin { ... }

// External modules (native/platform-specific)
rollupOptions: {
  external: ['zod', 'better-sqlite3', 'kysely', 'electron', 'sharp']
}
```

### Output Locations

| Build | Output Directory | Contents |
|-------|------------------|----------|
| Renderer | `dist/` | HTML, CSS, JS bundle |
| Main process | `dist-electron/main/` | Bundled main.js |
| Preload | `dist-electron/preload/` | Copied index.cjs (not bundled) |

### Critical: Preload Script

The preload script **MUST** be pure CommonJS:

```javascript
// electron/preload/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');
// Never use 'import' - breaks at runtime
```

This file is copied directly (not bundled) via `copyPreloadPlugin()`.

---

## Database

### Location

| Mode | Path |
|------|------|
| Development | `packages/desktop/data/au-archive.db` |
| Production | `[userData]/auarchive.db` |
| Custom | Set via Settings → Database Location |

### Connection Setup

```typescript
// packages/desktop/electron/main/database.ts
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');  // Write-ahead logging
sqlite.pragma('foreign_keys = ON');   // Enforce relationships
```

### Schema Management

- **Schema source**: Embedded in `database.ts` as `SCHEMA_SQL` constant
- **Reference copy**: `schema.sql` (not used at runtime)
- **Migrations**: 39 inline migrations in `runMigrations()`
- **Pattern**: Check column/table existence, ALTER if missing

```typescript
// Migration pattern
const columns = sqlite.pragma('table_info(locs)');
if (!columns.some(col => col.name === 'new_column')) {
  sqlite.exec('ALTER TABLE locs ADD COLUMN new_column TEXT');
}
```

### Tables Overview

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| locs | Locations | locid (UUID) |
| slocs | Sub-locations | subid (UUID) |
| imgs | Images | imgsha (SHA256) |
| vids | Videos | vidsha (SHA256) |
| docs | Documents | docsha (SHA256) |
| maps | Historical maps | mapsha (SHA256) |
| users | User accounts | user_id (UUID) |
| settings | Key-value config | key (TEXT) |
| ref_maps | Reference map imports | map_id (UUID) |
| ref_map_points | Points from ref maps | point_id (UUID) |

---

## IPC Architecture

### Channel Naming Convention

```
domain:action
```

Examples:
- `location:create`, `location:findById`
- `media:import`, `media:generateThumbnail`
- `settings:get`, `settings:set`

### Handler Registration

```typescript
// packages/desktop/electron/main/ipc-handlers/index.ts
export function registerAllHandlers(): void {
  registerLocationHandlers();
  registerMediaHandlers();
  // ... all domain handlers
}
```

### Preload Bridge

```javascript
// packages/desktop/electron/preload/preload.cjs
contextBridge.exposeInMainWorld('electron', {
  location: {
    findAll: (filters) => ipcRenderer.invoke('location:findAll', filters),
    create: (input) => ipcRenderer.invoke('location:create', input),
    // ...
  },
  // ...
});
```

### Validation

68% of IPC channels use Zod validation:

```typescript
// packages/desktop/electron/main/ipc-validation.ts
import { z } from 'zod';

const LocationInputSchema = z.object({
  locnam: z.string().min(1),
  type: z.string().optional(),
  // ...
});
```

---

## Native Modules

### Required Rebuilds

| Module | Purpose | Rebuild Command |
|--------|---------|-----------------|
| better-sqlite3 | SQLite database | `pnpm --filter desktop rebuild` |
| sharp | Image processing | `pnpm --filter desktop rebuild` |
| electron | Electron framework | Automatic via postinstall |

### pnpm v10+ Configuration

Native module build scripts are pre-approved in `package.json`:

```json
{
  "pnpm": {
    "onlyBuiltDependencies": [
      "electron",
      "better-sqlite3",
      "esbuild",
      "sharp",
      "7zip-bin",
      "@electron/rebuild"
    ]
  }
}
```

If you see "Ignored build scripts" warnings:

```bash
pnpm reinstall  # Clean install from scratch
```

---

## Development Workflow

### Daily Development

```bash
# Start dev server with hot reload
pnpm dev

# In another terminal, run tests
pnpm test

# Before committing
pnpm lint
```

### Making Changes

1. **Renderer changes** (Svelte): Hot reload automatically
2. **Main process changes**: Requires restart (`Ctrl+C`, `pnpm dev`)
3. **Preload changes**: Requires restart (file is copied, not bundled)
4. **Database schema**: Add new migration in `database.ts`

### Adding a New IPC Channel

1. Add handler in `electron/main/ipc-handlers/[domain].ts`:
   ```typescript
   ipcMain.handle('domain:action', async (_, input) => {
     // Validate, process, return
   });
   ```

2. Expose in `electron/preload/preload.cjs`:
   ```javascript
   domain: {
     action: (input) => ipcRenderer.invoke('domain:action', input),
   }
   ```

3. Add types in `src/types/electron.d.ts`:
   ```typescript
   domain: {
     action(input: InputType): Promise<OutputType>;
   }
   ```

4. Use in renderer:
   ```typescript
   const result = await window.electron.domain.action(input);
   ```

---

## Troubleshooting

### Installation Issues

| Problem | Solution |
|---------|----------|
| "Ignored build scripts: better-sqlite3, electron..." | Run `pnpm reinstall` |
| "Electron failed to install correctly" | Run `pnpm reinstall` |
| "Failed to resolve entry for package @au-archive/core" | Run `pnpm build:core` |
| "vite: command not found" | Run `pnpm install` |
| "Missing X server or $DISPLAY" (Linux) | Use `xvfb-run pnpm dev` |

### Runtime Issues

| Problem | Solution |
|---------|----------|
| Preload crashes silently | Check for `import` syntax in `.cjs` file |
| Database locked errors | Close other Electron instances |
| Native module mismatch | Run `pnpm --filter desktop rebuild` |
| Types out of sync | Run `pnpm --filter core build` first |
| App starts but shows blank screen | Check DevTools console for errors |

### Database Issues

| Problem | Solution |
|---------|----------|
| Foreign key constraint failed | Check referenced record exists |
| Migration failed | Backup db, check SQL syntax, restore |
| Schema out of sync | Delete db file, restart app |

### Media Issues

| Problem | Solution |
|---------|----------|
| ExifTool not found | Install via `brew install exiftool` or bundled |
| FFmpeg error | Install via `brew install ffmpeg` |
| Thumbnails not generating | Check sharp module is rebuilt |
| Video proxies fail | Check FFmpeg is installed and accessible |

---

## Platform-Specific Notes

### macOS

- Primary development platform
- Notarization required for distribution
- Research Browser: Ungoogled Chromium downloaded by setup script

### Linux

- Tested on Ubuntu 22.04
- May need `libnss3`, `libatk-bridge2.0-0` for Electron
- For headless: `xvfb-run pnpm dev`

### Windows

- Limited testing
- Manual Chromium installation required
- Native module rebuilds may need Visual Studio Build Tools

---

## External Dependencies

| Tool | Documentation |
|------|---------------|
| Electron | https://www.electronjs.org/docs |
| Svelte 5 | https://svelte.dev/docs |
| Leaflet | https://leafletjs.com/reference.html |
| ExifTool | https://exiftool.org/ |
| FFmpeg | https://ffmpeg.org/documentation.html |
| better-sqlite3 | https://github.com/WiseLibs/better-sqlite3 |
| Kysely | https://kysely.dev/ |

---

## Version History

| Version | Date | Notes |
|---------|------|-------|
| 0.1.0 | 2025-11-30 | Initial stable release |

---

End of Technical Guide
