# Tech Guide — Nightfox Films v0.1.0

Technical implementation guide for developers. Complements CLAUDE.md with specific configuration details, build setup, and troubleshooting.

---

## Environment Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20+ LTS (22+ recommended) | Use nvm for version management |
| pnpm | 10+ | Install via `npm install -g pnpm` or corepack |
| Git | 2.x+ | Required for version control |
| Python | 3.8+ | For scene detection, sharpness scoring scripts |
| FFmpeg | Latest | Required for video processing |
| ExifTool | Latest | Required for metadata extraction |
| b3sum | Latest (optional) | Native BLAKE3 for faster hashing |

### Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| macOS (arm64) | Full | Primary development platform |
| macOS (x64) | Full | Intel Mac support |
| Linux (x64) | Partial | Tested on Ubuntu 22.04 |
| Windows | Limited | Manual setup required |

---

## Repository Structure

```
nightfox/
├── CLAUDE.md            # Project rules and conventions (read first)
├── techguide.md         # This file - implementation details
├── lilbits.md           # Script registry
├── package.json         # Root workspace config
├── pnpm-workspace.yaml  # Monorepo workspace definition
│
├── packages/
│   ├── core/            # Domain models, types, validation
│   │   └── src/
│   │       └── types.ts # Shared TypeScript interfaces
│   │
│   └── desktop/         # Electron application
│       ├── electron/    # Main process
│       │   ├── main/    # App lifecycle, database, IPC
│       │   ├── preload/ # Context bridge (CommonJS)
│       │   ├── services/# Business logic
│       │   └── repositories/  # SQLite implementations
│       ├── src/         # Renderer process (Svelte)
│       │   ├── components/
│       │   ├── pages/
│       │   └── lib/
│       ├── scripts/     # Python scripts (scene detection, etc.)
│       └── public/      # Static assets (fonts)
│
├── docs/                # Documentation
│   ├── IMPLEMENTATION.md # Phase-by-phase build guide
│   ├── schema.sql       # Database schema reference
│   └── decisions/       # Architecture decision records
│
├── .claude/             # Claude Code skills
│   └── skills/
│       ├── braun-design-verification/
│       └── machinelogic/
│
└── resources/           # Bundled binaries, LUTs
    ├── bin/             # ffmpeg, exiftool (optional)
    └── luts/            # Color lookup tables
```

---

## Setup From Scratch

### Quick Start (Recommended)

```bash
# Clone repository
git clone https://github.com/bizzlechizzle/nightfox.git
cd nightfox

# Install dependencies
pnpm install

# Build core package
pnpm --filter core build

# Start development
pnpm dev
```

### Manual Setup

```bash
# 1. Install dependencies
pnpm install
# Expected: Installs node_modules, runs postinstall (builds core)

# 2. Build packages
pnpm build
# Expected: Compiles core TypeScript, bundles desktop app

# 3. Start development server
pnpm dev
# Expected: Opens Electron window with hot reload
```

---

## Build System

### Vite Configuration

The build uses Vite 6 with custom plugins:

**Key Config: `packages/desktop/vite.config.ts`**

```typescript
// Custom plugin copies preload.cjs WITHOUT bundling
// vite-plugin-electron transforms entry files, breaking pure CommonJS
function copyPreloadPlugin(): Plugin { ... }

// External modules (native/platform-specific)
rollupOptions: {
  external: ['electron', 'better-sqlite3', 'blake3', 'sharp', ...]
}
```

### Output Locations

| Build | Output Directory | Contents |
|-------|------------------|----------|
| Renderer | `dist/` | HTML, CSS, JS bundle |
| Main process | `dist-electron/main/` | Bundled main.js |
| Preload | `dist-electron/preload/` | Copied preload.cjs (not bundled) |

### Critical: Preload Script

The preload script **MUST** be pure CommonJS:

```javascript
// electron/preload/preload.cjs
const { contextBridge, ipcRenderer } = require("electron");
// Never use 'import' - breaks at runtime
```

This file is copied directly (not bundled) via `copyPreloadPlugin()`.

---

## Database

### Location

| Mode | Path |
|------|------|
| Development | `packages/desktop/data/nightfox.db` |
| Production | `[userData]/nightfox.db` |

### Connection Setup

```typescript
// packages/desktop/electron/main/database.ts
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');  // Write-ahead logging
sqlite.pragma('foreign_keys = ON');   // Enforce relationships
```

### Schema Management

- **Schema source**: Inline migrations in `database.ts`
- **Reference copy**: `docs/schema.sql` (not used at runtime)
- **Migration pattern**: Check column/table existence, ALTER if missing

```typescript
// Migration pattern
const columns = sqlite.pragma('table_info(files)');
if (!columns.some(col => col.name === 'new_column')) {
  sqlite.exec('ALTER TABLE files ADD COLUMN new_column TEXT');
}
```

### Tables Overview

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| settings | Key-value config | key (TEXT) |
| cameras | Camera profiles | id (INTEGER) |
| camera_patterns | File matching patterns | id (INTEGER) |
| couples | Wedding projects | id (INTEGER) |
| files | Imported video files | id (INTEGER), blake3 (UNIQUE) |
| file_metadata | Full metadata dumps | file_id (FK) |
| file_sidecars | Sidecar relationships | (video_file_id, sidecar_file_id) |
| scenes | Detected scenes | id (INTEGER) |
| ai_analysis | AI results with attribution | id (INTEGER) |
| exports | Generated screenshots/clips | id (INTEGER) |
| jobs | Background job queue | id (INTEGER) |

---

## IPC Architecture

### Channel Naming Convention

```
domain:action
```

Examples:
- `camera:create`, `camera:findAll`
- `couple:import`, `couple:exportJson`
- `file:hash`, `file:import`
- `settings:get`, `settings:set`

### Handler Registration

```typescript
// packages/desktop/electron/main/ipc-handlers/index.ts
export function registerAllHandlers(db: Database): void {
  registerCameraHandlers(db);
  registerCoupleHandlers(db);
  registerFileHandlers(db);
  registerSettingsHandlers(db);
}
```

### Preload Bridge

```javascript
// packages/desktop/electron/preload/preload.cjs
contextBridge.exposeInMainWorld('electronAPI', {
  cameras: {
    findAll: () => ipcRenderer.invoke('camera:findAll'),
    create: (input) => ipcRenderer.invoke('camera:create', input),
    // ...
  },
  // ...
});
```

### Validation

IPC handlers use Zod validation:

```typescript
import { z } from 'zod';

const CameraInputSchema = z.object({
  name: z.string().min(1),
  medium: z.enum(['dadcam', 'super8', 'modern']),
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
| blake3 | BLAKE3 hashing | `pnpm --filter desktop rebuild` |
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
      "blake3",
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

## External Tools

### FFmpeg

Used for: Video transcoding, frame extraction, audio normalization

```bash
# Check installation
ffmpeg -version

# Install (macOS)
brew install ffmpeg
```

### ExifTool

Used for: Full metadata extraction (make/model, GPS, dates)

```bash
# Check installation
exiftool -ver

# Install (macOS)
brew install exiftool
```

### b3sum (Optional)

Native BLAKE3 binary for faster hashing:

```bash
# Check installation
b3sum --version

# Install (macOS)
brew install b3sum
```

Falls back to WASM if not available.

### Python Dependencies (Scene Detection)

```bash
# Create virtual environment
cd packages/desktop/scripts
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install scenedetect opencv-python
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
   const result = await window.electronAPI.domain.action(input);
   ```

---

## Troubleshooting

### Installation Issues

| Problem | Solution |
|---------|----------|
| "Ignored build scripts: better-sqlite3..." | Run `pnpm reinstall` |
| "Electron failed to install correctly" | Run `pnpm reinstall` |
| "Failed to resolve entry for package @nightfox/core" | Run `pnpm --filter core build` |
| "vite: command not found" | Run `pnpm install` |

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
| ffprobe not found | Install via `brew install ffmpeg` |
| exiftool not found | Install via `brew install exiftool` |
| Scene detection fails | Check Python venv and dependencies |

---

## External Dependencies

| Tool | Documentation |
|------|---------------|
| Electron | https://www.electronjs.org/docs |
| Svelte 5 | https://svelte.dev/docs |
| better-sqlite3 | https://github.com/WiseLibs/better-sqlite3 |
| FFmpeg | https://ffmpeg.org/documentation.html |
| ExifTool | https://exiftool.org/ |
| PySceneDetect | https://scenedetect.com/ |
| LiteLLM | https://docs.litellm.ai/ |

---

## Version History

| Version | Date | Notes |
|---------|------|-------|
| 0.1.0 | 2025-XX-XX | Initial implementation |

---

End of Technical Guide
