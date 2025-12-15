# Nightfox Films Implementation Guide

**Version:** 1.0.0
**Target:** Claude Code step-by-step execution

This guide provides complete, executable instructions for building Nightfox Films from scratch. Each phase builds on the previous one. Execute phases in order.

---

## Pre-Implementation Checklist

Before starting, ensure you have:

- [ ] Node.js 20+ installed (`node --version`)
- [ ] pnpm 10+ installed (`pnpm --version`)
- [ ] Git installed (`git --version`)
- [ ] Python 3.8+ installed (`python3 --version`)
- [ ] FFmpeg installed (`ffmpeg -version`)
- [ ] ExifTool installed (`exiftool -ver`)

---

## Phase 1: Project Scaffold

**Objective:** Initialize pnpm monorepo with core and desktop packages.

### Step 1.1: Initialize Repository

```bash
cd /Volumes/Jay/nightfox
git init
```

### Step 1.2: Create Root package.json

Create `package.json`:

```json
{
  "name": "nightfox",
  "version": "0.1.0",
  "private": true,
  "description": "Wedding videography workflow management",
  "repository": {
    "type": "git",
    "url": "https://github.com/bizzlechizzle/nightfox.git"
  },
  "author": "Nightfox Films",
  "license": "UNLICENSED",
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=10.0.0"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "electron",
      "better-sqlite3",
      "esbuild",
      "sharp",
      "7zip-bin",
      "@electron/rebuild",
      "blake3",
      "bufferutil",
      "utf-8-validate"
    ]
  },
  "scripts": {
    "postinstall": "pnpm --filter core build",
    "dev": "pnpm --filter desktop dev",
    "build": "pnpm --filter core build && pnpm --filter desktop build",
    "build:core": "pnpm --filter core build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "format": "prettier --write \"**/*.{ts,tsx,svelte,json,md}\"",
    "clean": "rm -rf node_modules packages/*/node_modules packages/*/dist packages/*/dist-electron",
    "reinstall": "pnpm clean && pnpm install",
    "deps": "bash scripts/check-deps.sh"
  }
}
```

### Step 1.3: Create pnpm Workspace

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
```

### Step 1.4: Create .npmrc

Create `.npmrc`:

```ini
shamefully-hoist=true
strict-peer-dependencies=false
auto-install-peers=true
```

### Step 1.5: Create .gitignore

Create `.gitignore`:

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
dist-electron/
*.tsbuildinfo

# Database
data/
*.db
*.db-journal
*.db-wal
*.db-shm

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Logs
logs/
*.log
npm-debug.log*
pnpm-debug.log*

# Test
coverage/

# Electron
release/
```

### Step 1.6: Create Core Package

Create `packages/core/package.json`:

```json
{
  "name": "@nightfox/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "vitest": "^1.2.0"
  }
}
```

Create `packages/core/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Create `packages/core/src/index.ts`:

```typescript
// Re-export all types
export * from './types';
```

Copy the types file:

```bash
cp /Volumes/Jay/nightfox/packages/core/src/types.ts /Volumes/Jay/nightfox/packages/core/src/types.ts
```

### Step 1.7: Create Desktop Package

Create `packages/desktop/package.json`:

```json
{
  "name": "@nightfox/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist-electron/main/index.js",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build && electron-builder",
    "preview": "vite preview",
    "rebuild": "electron-rebuild -f -w better-sqlite3,sharp",
    "test": "vitest run",
    "lint": "eslint src electron --ext .ts,.svelte"
  },
  "dependencies": {
    "@nightfox/core": "workspace:*",
    "better-sqlite3": "^11.6.0",
    "blake3": "^2.1.7",
    "exiftool-vendored": "^33.2.0",
    "fluent-ffmpeg": "^2.1.3",
    "kysely": "^0.27.5",
    "sharp": "^0.33.5",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.7.1",
    "@skeletonlabs/skeleton": "^2.10.0",
    "@skeletonlabs/tw-plugin": "^0.4.0",
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "@types/better-sqlite3": "^7.6.11",
    "@types/fluent-ffmpeg": "^2.1.27",
    "@types/node": "^20.10.0",
    "autoprefixer": "^10.4.16",
    "electron": "^35.2.1",
    "electron-builder": "^25.1.8",
    "postcss": "^8.4.32",
    "svelte": "^5.2.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.3.3",
    "vite": "^6.0.1",
    "vite-plugin-electron": "^0.28.8",
    "vite-plugin-electron-renderer": "^0.14.6",
    "vitest": "^1.2.0"
  }
}
```

Create `packages/desktop/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "outDir": "./dist",
    "rootDir": ".",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "allowSyntheticDefaultImports": true,
    "types": ["node", "svelte"]
  },
  "include": ["src/**/*", "electron/**/*"],
  "exclude": ["node_modules", "dist", "dist-electron"]
}
```

### Step 1.8: Copy Braun Design System

Create `packages/desktop/public/fonts/` and copy fonts:

```bash
mkdir -p packages/desktop/public/fonts
cp "/Volumes/Jay/nightfox/au archive /packages/desktop/public/fonts/"*.woff2 packages/desktop/public/fonts/
```

Create `packages/desktop/src/app.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Braun Linear Font Family */
@font-face {
  font-family: 'Braun Linear';
  src: url('/fonts/BraunLinear-Thin.woff2') format('woff2');
  font-weight: 100;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Braun Linear';
  src: url('/fonts/BraunLinear-Light.woff2') format('woff2');
  font-weight: 300;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Braun Linear';
  src: url('/fonts/BraunLinear-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Braun Linear';
  src: url('/fonts/BraunLinear-Medium.woff2') format('woff2');
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Braun Linear';
  src: url('/fonts/BraunLinear-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

@layer base {
  :root {
    /* Braun color tokens */
    --color-bg: #FAFAF8;
    --color-bg-alt: #F4F4F2;
    --color-surface: #FFFFFF;
    --color-border: #E2E1DE;
    --color-border-muted: #EEEEED;
    --color-text: #1C1C1A;
    --color-text-secondary: #5C5C58;
    --color-text-muted: #8A8A86;
    --color-text-disabled: #C0BFBC;

    /* Typography */
    --font-sans: 'Braun Linear', system-ui, -apple-system, sans-serif;

    /* Type scale */
    --step--1: 0.8125rem;   /* 13px */
    --step-0: 0.875rem;     /* 14px */
    --step-1: 1rem;         /* 16px */
    --step-2: 1.25rem;      /* 20px */
    --step-3: 1.75rem;      /* 28px */
    --step-4: 2.5rem;       /* 40px */
  }

  body {
    margin: 0;
    padding: 0;
    font-family: var(--font-sans);
    font-size: var(--step-0);
    line-height: 1.5;
    color: var(--color-text);
    background-color: var(--color-bg);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-sans);
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: -0.02em;
    margin: 0;
  }

  h1 { font-size: var(--step-3); font-weight: 700; }
  h2 { font-size: var(--step-2); }
  h3 { font-size: var(--step-1); }

  p { margin: 0 0 1rem; }

  ::selection {
    background-color: rgba(28, 28, 26, 0.15);
    color: inherit;
  }
}

@layer components {
  .section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #8A8A86;
    margin-bottom: 1rem;
  }

  .form-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #5C5C58;
    margin-bottom: 0.5rem;
    display: block;
  }
}
```

Create `packages/desktop/tailwind.config.js`:

```javascript
import { skeleton } from '@skeletonlabs/tw-plugin';

export default {
  content: [
    './index.html',
    './src/**/*.{svelte,js,ts}',
    './node_modules/@skeletonlabs/skeleton/**/*.{html,js,svelte,ts}'
  ],
  theme: {
    extend: {
      colors: {
        braun: {
          50: '#FAFAF8',
          100: '#F4F4F2',
          200: '#EEEEED',
          300: '#E2E1DE',
          400: '#C0BFBC',
          500: '#8A8A86',
          600: '#5C5C58',
          900: '#1C1C1A',
        },
        success: '#4A8C5E',
        error: '#B85C4A',
        warning: '#C9A227',
      },
      fontFamily: {
        sans: ['Braun Linear', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '2px',
        md: '4px',
        lg: '4px',
        xl: '4px',
        '2xl': '4px',
        '3xl': '4px',
        full: '9999px',
      },
      boxShadow: {
        none: 'none',
        sm: 'none',
        DEFAULT: 'none',
        md: 'none',
        lg: 'none',
        xl: 'none',
        '2xl': 'none',
      },
    },
  },
  plugins: [skeleton],
};
```

Create `packages/desktop/postcss.config.cjs`:

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

### Step 1.9: Install Dependencies

```bash
pnpm install
```

### Step 1.10: Verification

```bash
# Build core package
pnpm --filter core build

# Check that dist/index.js exists
ls packages/core/dist/
```

**Phase 1 Complete Checklist:**
- [ ] Root package.json with pnpm config
- [ ] pnpm-workspace.yaml configured
- [ ] packages/core with types
- [ ] packages/desktop skeleton
- [ ] Braun fonts copied
- [ ] app.css with Braun design tokens
- [ ] tailwind.config.js with Braun colors
- [ ] Dependencies installed
- [ ] Core package builds

---

## Phase 2: Database Layer

**Objective:** Create SQLite database with migrations and settings service.

### Step 2.1: Create Database Directory Structure

```bash
mkdir -p packages/desktop/electron/main
mkdir -p packages/desktop/data
```

### Step 2.2: Create Database Module

Create `packages/desktop/electron/main/database.ts`:

```typescript
import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const isDev = !app.isPackaged;
  const dbDir = isDev
    ? join(process.cwd(), 'packages/desktop/data')
    : join(app.getPath('userData'));

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = join(dbDir, 'nightfox.db');
  console.log('Database path:', dbPath);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function runMigrations(db: Database.Database): void {
  // Migration 1: Initial schema
  db.exec(`
    -- Settings table
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Cameras table
    CREATE TABLE IF NOT EXISTS cameras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      medium TEXT NOT NULL CHECK (medium IN ('dadcam', 'super8', 'modern')),
      notes TEXT,
      lut_path TEXT,
      deinterlace INTEGER DEFAULT 0,
      audio_channels TEXT DEFAULT 'stereo',
      sharpness_baseline REAL,
      transcode_preset TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Camera patterns table
    CREATE TABLE IF NOT EXISTS camera_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
      pattern_type TEXT NOT NULL CHECK (pattern_type IN ('filename', 'folder', 'extension')),
      pattern TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Couples table
    CREATE TABLE IF NOT EXISTS couples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      wedding_date TEXT,
      folder_name TEXT,
      notes TEXT,
      file_count INTEGER DEFAULT 0,
      total_duration_seconds REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Files table
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blake3 TEXT UNIQUE NOT NULL,
      original_filename TEXT NOT NULL,
      original_path TEXT,
      managed_path TEXT,
      extension TEXT NOT NULL,
      file_size INTEGER,
      couple_id INTEGER REFERENCES couples(id) ON DELETE SET NULL,
      camera_id INTEGER REFERENCES cameras(id) ON DELETE SET NULL,
      detected_make TEXT,
      detected_model TEXT,
      medium TEXT CHECK (medium IN ('dadcam', 'super8', 'modern')),
      file_type TEXT CHECK (file_type IN ('video', 'sidecar', 'audio', 'other')),
      duration_seconds REAL,
      width INTEGER,
      height INTEGER,
      frame_rate REAL,
      codec TEXT,
      bitrate INTEGER,
      is_processed INTEGER DEFAULT 0,
      is_hidden INTEGER DEFAULT 0,
      recorded_at TEXT,
      imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- File metadata table
    CREATE TABLE IF NOT EXISTS file_metadata (
      file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      exiftool_json TEXT,
      ffprobe_json TEXT,
      extracted_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- File sidecars table
    CREATE TABLE IF NOT EXISTS file_sidecars (
      video_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      sidecar_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      sidecar_type TEXT,
      PRIMARY KEY (video_file_id, sidecar_file_id)
    );

    -- Scenes table
    CREATE TABLE IF NOT EXISTS scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      scene_number INTEGER NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      duration REAL NOT NULL,
      start_frame INTEGER,
      end_frame INTEGER,
      detection_method TEXT,
      confidence REAL,
      best_frame_number INTEGER,
      best_frame_sharpness REAL,
      best_frame_path TEXT,
      scene_type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- AI analysis table
    CREATE TABLE IF NOT EXISTS ai_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
      scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
      analysis_type TEXT NOT NULL,
      result_json TEXT NOT NULL,
      model_name TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      confidence REAL,
      prompt_used TEXT,
      processing_time_ms INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Exports table
    CREATE TABLE IF NOT EXISTS exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
      scene_id INTEGER REFERENCES scenes(id) ON DELETE SET NULL,
      couple_id INTEGER REFERENCES couples(id) ON DELETE SET NULL,
      export_type TEXT NOT NULL CHECK (export_type IN ('screenshot', 'clip')),
      output_path TEXT NOT NULL,
      output_format TEXT,
      width INTEGER,
      height INTEGER,
      aspect_ratio TEXT,
      start_time REAL,
      end_time REAL,
      duration REAL,
      lut_applied TEXT,
      audio_normalized INTEGER DEFAULT 0,
      crop_applied TEXT,
      caption TEXT,
      caption_ai_analysis_id INTEGER REFERENCES ai_analysis(id),
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'error')),
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Jobs table
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
      couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,
      priority INTEGER DEFAULT 0,
      depends_on_job_id INTEGER REFERENCES jobs(id),
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'error', 'dead')),
      error_message TEXT,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      started_at TEXT,
      completed_at TEXT,
      processing_time_ms INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_camera_patterns_camera_id ON camera_patterns(camera_id);
    CREATE INDEX IF NOT EXISTS idx_files_blake3 ON files(blake3);
    CREATE INDEX IF NOT EXISTS idx_files_couple_id ON files(couple_id);
    CREATE INDEX IF NOT EXISTS idx_files_camera_id ON files(camera_id);
    CREATE INDEX IF NOT EXISTS idx_files_original_filename ON files(original_filename);
    CREATE INDEX IF NOT EXISTS idx_scenes_file_id ON scenes(file_id);
    CREATE INDEX IF NOT EXISTS idx_ai_analysis_file_id ON ai_analysis(file_id);
    CREATE INDEX IF NOT EXISTS idx_exports_couple_id ON exports(couple_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  `);

  // Insert default settings
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );

  const defaults: [string, string | null][] = [
    ['storage_path', null],
    ['litellm_url', 'http://localhost:4000'],
    ['litellm_model_vlm', 'local-vlm'],
    ['litellm_model_llm', 'local-llm'],
    ['theme', 'system'],
  ];

  for (const [key, value] of defaults) {
    insertSetting.run(key, value);
  }

  console.log('Database migrations complete');
}
```

### Step 2.3: Create Settings Service

Create `packages/desktop/electron/services/settings-service.ts`:

```typescript
import type Database from 'better-sqlite3';

export class SettingsService {
  constructor(private db: Database.Database) {}

  get(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string | null } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string | null): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = CURRENT_TIMESTAMP`
      )
      .run(key, value);
  }

  getAll(): Record<string, string | null> {
    const rows = this.db
      .prepare('SELECT key, value FROM settings')
      .all() as Array<{ key: string; value: string | null }>;

    return rows.reduce(
      (acc, row) => {
        acc[row.key] = row.value;
        return acc;
      },
      {} as Record<string, string | null>
    );
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }
}
```

### Step 2.4: Verification

Create a test file `packages/desktop/electron/main/database.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Database', () => {
  let db: Database.Database;
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nightfox-test-'));
    db = new Database(join(tempDir, 'test.db'));
    db.pragma('foreign_keys = ON');
  });

  afterAll(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    expect(tables.length).toBeGreaterThan(0);
  });
});
```

**Phase 2 Complete Checklist:**
- [ ] database.ts with migrations
- [ ] settings-service.ts
- [ ] Database creates successfully
- [ ] Default settings inserted

---

## Phase 3: External Tools

**Objective:** Create wrappers for ffprobe, exiftool, ffmpeg, and blake3.

### Step 3.1: Create External Tools Directory

```bash
mkdir -p packages/desktop/electron/services/external
```

### Step 3.2: Create FFprobe Wrapper

Create `packages/desktop/electron/services/external/ffprobe.ts`:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import type { FFProbeResult } from '@nightfox/core';

const execAsync = promisify(exec);

export async function probe(filePath: string): Promise<FFProbeResult> {
  const { stdout } = await execAsync(
    `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`
  );
  return JSON.parse(stdout);
}

export async function probeRaw(filePath: string): Promise<string> {
  const { stdout } = await execAsync(
    `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`
  );
  return stdout;
}

export async function getDuration(filePath: string): Promise<number> {
  const result = await probe(filePath);
  return parseFloat(result.format.duration) || 0;
}

export async function getResolution(
  filePath: string
): Promise<{ width: number; height: number } | null> {
  const result = await probe(filePath);
  const videoStream = result.streams.find((s) => s.codec_type === 'video');
  if (videoStream?.width && videoStream?.height) {
    return { width: videoStream.width, height: videoStream.height };
  }
  return null;
}
```

### Step 3.3: Create ExifTool Wrapper

Create `packages/desktop/electron/services/external/exiftool.ts`:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ExifToolResult } from '@nightfox/core';

const execAsync = promisify(exec);

export async function extract(filePath: string): Promise<string> {
  const { stdout } = await execAsync(`exiftool -json -n "${filePath}"`);
  return stdout;
}

export async function extractParsed(filePath: string): Promise<ExifToolResult> {
  const raw = await extract(filePath);
  const arr = JSON.parse(raw);
  return arr[0];
}

export async function getMakeModel(
  filePath: string
): Promise<{ make: string | null; model: string | null }> {
  try {
    const result = await extractParsed(filePath);
    return {
      make: result.Make || null,
      model: result.Model || null,
    };
  } catch {
    return { make: null, model: null };
  }
}
```

### Step 3.4: Create FFmpeg Wrapper

Create `packages/desktop/electron/services/external/ffmpeg.ts`:

```typescript
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

export interface TranscodeOptions {
  input: string;
  output: string;
  codec?: 'h264' | 'h265' | 'prores';
  lut?: string;
  crop?: { x: number; y: number; width: number; height: number };
  normalize_audio?: boolean;
  progress?: (percent: number) => void;
}

export async function transcode(options: TranscodeOptions): Promise<void> {
  const outputDir = dirname(options.output);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const args: string[] = ['-i', options.input, '-y'];

  // Build filter chain
  const filters: string[] = [];

  if (options.crop) {
    filters.push(
      `crop=${options.crop.width}:${options.crop.height}:${options.crop.x}:${options.crop.y}`
    );
  }

  if (options.lut) {
    filters.push(`lut3d="${options.lut}"`);
  }

  if (filters.length > 0) {
    args.push('-vf', filters.join(','));
  }

  // Codec selection
  switch (options.codec) {
    case 'h265':
      args.push('-c:v', 'libx265', '-crf', '23');
      break;
    case 'prores':
      args.push('-c:v', 'prores_ks', '-profile:v', '3');
      break;
    default:
      args.push('-c:v', 'libx264', '-crf', '23', '-preset', 'medium');
  }

  // Audio normalization
  if (options.normalize_audio) {
    args.push('-af', 'loudnorm=I=-16:LRA=11:TP=-1.5');
  } else {
    args.push('-c:a', 'aac', '-b:a', '192k');
  }

  args.push(options.output);

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);

    proc.stderr.on('data', (data: Buffer) => {
      // Parse progress if callback provided
      if (options.progress) {
        const str = data.toString();
        const match = str.match(/time=(\d+):(\d+):(\d+)/);
        if (match) {
          // Would need total duration to calculate percent
        }
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

export async function extractFrame(
  input: string,
  timeSeconds: number,
  output: string
): Promise<void> {
  const outputDir = dirname(output);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-ss',
      timeSeconds.toString(),
      '-i',
      input,
      '-vframes',
      '1',
      '-q:v',
      '2',
      '-y',
      output,
    ]);

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg frame extraction failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}
```

### Step 3.5: Create Crypto Service (BLAKE3)

Create `packages/desktop/electron/services/crypto-service.ts`:

```typescript
import { createReadStream, statSync } from 'fs';
import { createHash } from 'blake3';
import { randomBytes } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

export const HASH_LENGTH = 16;

// Paths to check for native b3sum binary (much faster than WASM)
const B3SUM_PATHS = [
  '/opt/homebrew/bin/b3sum', // Homebrew on Apple Silicon
  '/usr/local/bin/b3sum', // Homebrew on Intel
  '/usr/bin/b3sum', // System install
];

function findB3sum(): string | null {
  for (const path of B3SUM_PATHS) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

async function calculateHashNative(filePath: string): Promise<string> {
  const b3sum = findB3sum();
  if (!b3sum) throw new Error('b3sum not found');

  const { stdout } = await execAsync(`"${b3sum}" --no-names "${filePath}"`);
  const fullHash = stdout.trim();
  return fullHash.substring(0, HASH_LENGTH);
}

async function calculateHashWasm(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hasher = createHash();
    const BUFFER_SIZE = 1024 * 1024; // 1MB for network efficiency
    const stream = createReadStream(filePath, { highWaterMark: BUFFER_SIZE });

    stream.on('data', (chunk: Buffer | string) => {
      hasher.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    stream.on('end', () => {
      const fullHash = hasher.digest('hex');
      resolve(fullHash.substring(0, HASH_LENGTH));
    });

    stream.on('error', reject);
  });
}

export async function calculateHash(filePath: string): Promise<string> {
  const b3sum = findB3sum();
  if (b3sum) {
    try {
      return await calculateHashNative(filePath);
    } catch (error) {
      console.warn('b3sum failed, falling back to WASM:', error);
      return calculateHashWasm(filePath);
    }
  }
  return calculateHashWasm(filePath);
}

function calculateHashBuffer(buffer: Buffer): string {
  const hasher = createHash();
  hasher.update(buffer);
  return hasher.digest('hex').substring(0, HASH_LENGTH);
}

export function generateId(): string {
  const bytes = randomBytes(32);
  return calculateHashBuffer(bytes);
}

export function isValidHash(hash: string): boolean {
  return /^[a-f0-9]{16}$/.test(hash);
}

export async function getFileSize(filePath: string): Promise<number> {
  return statSync(filePath).size;
}

// Class wrapper for backward compatibility
export class CryptoService {
  async calculateHash(filePath: string): Promise<string> {
    return calculateHash(filePath);
  }

  generateId(): string {
    return generateId();
  }

  isValidHash(hash: string): boolean {
    return isValidHash(hash);
  }
}
```

### Step 3.6: Create Index Export

Create `packages/desktop/electron/services/external/index.ts`:

```typescript
export * from './ffprobe';
export * from './exiftool';
export * from './ffmpeg';
```

**Phase 3 Complete Checklist:**
- [ ] ffprobe.ts wrapper
- [ ] exiftool.ts wrapper
- [ ] ffmpeg.ts wrapper
- [ ] crypto-service.ts (BLAKE3)
- [ ] All wrappers handle errors

---

## Phase 4: Camera System

**Objective:** Implement camera profiles CRUD and pattern matching.

### Step 4.1: Create Camera Repository

Create `packages/desktop/electron/repositories/camera-repository.ts`:

```typescript
import type Database from 'better-sqlite3';
import type {
  Camera,
  CameraPattern,
  CameraInput,
  CameraPatternInput,
  CameraWithPatterns,
} from '@nightfox/core';

export class CameraRepository {
  constructor(private db: Database.Database) {}

  findAll(): Camera[] {
    return this.db
      .prepare('SELECT * FROM cameras ORDER BY name')
      .all() as Camera[];
  }

  findById(id: number): Camera | null {
    return (
      (this.db.prepare('SELECT * FROM cameras WHERE id = ?').get(id) as Camera) ||
      null
    );
  }

  findByIdWithPatterns(id: number): CameraWithPatterns | null {
    const camera = this.findById(id);
    if (!camera) return null;

    const patterns = this.db
      .prepare(
        'SELECT * FROM camera_patterns WHERE camera_id = ? ORDER BY priority DESC'
      )
      .all(id) as CameraPattern[];

    return { ...camera, patterns };
  }

  create(input: CameraInput): number {
    const result = this.db
      .prepare(
        `INSERT INTO cameras (name, medium, notes, lut_path, deinterlace, audio_channels, sharpness_baseline, transcode_preset)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name,
        input.medium,
        input.notes ?? null,
        input.lut_path ?? null,
        input.deinterlace ? 1 : 0,
        input.audio_channels ?? 'stereo',
        input.sharpness_baseline ?? null,
        input.transcode_preset ?? null
      );
    return result.lastInsertRowid as number;
  }

  update(id: number, input: Partial<CameraInput>): void {
    const camera = this.findById(id);
    if (!camera) throw new Error(`Camera ${id} not found`);

    this.db
      .prepare(
        `UPDATE cameras SET
           name = COALESCE(?, name),
           medium = COALESCE(?, medium),
           notes = COALESCE(?, notes),
           lut_path = COALESCE(?, lut_path),
           deinterlace = COALESCE(?, deinterlace),
           audio_channels = COALESCE(?, audio_channels),
           sharpness_baseline = COALESCE(?, sharpness_baseline),
           transcode_preset = COALESCE(?, transcode_preset),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(
        input.name,
        input.medium,
        input.notes,
        input.lut_path,
        input.deinterlace !== undefined ? (input.deinterlace ? 1 : 0) : undefined,
        input.audio_channels,
        input.sharpness_baseline,
        input.transcode_preset,
        id
      );
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM cameras WHERE id = ?').run(id);
  }

  // Pattern management
  addPattern(input: CameraPatternInput): number {
    const result = this.db
      .prepare(
        `INSERT INTO camera_patterns (camera_id, pattern_type, pattern, priority)
         VALUES (?, ?, ?, ?)`
      )
      .run(input.camera_id, input.pattern_type, input.pattern, input.priority ?? 0);
    return result.lastInsertRowid as number;
  }

  removePattern(patternId: number): void {
    this.db.prepare('DELETE FROM camera_patterns WHERE id = ?').run(patternId);
  }

  getPatterns(cameraId: number): CameraPattern[] {
    return this.db
      .prepare(
        'SELECT * FROM camera_patterns WHERE camera_id = ? ORDER BY priority DESC'
      )
      .all(cameraId) as CameraPattern[];
  }

  getAllPatterns(): CameraPattern[] {
    return this.db
      .prepare('SELECT * FROM camera_patterns ORDER BY priority DESC, camera_id')
      .all() as CameraPattern[];
  }
}
```

### Step 4.2: Create Camera Matcher Service

Create `packages/desktop/electron/services/camera-matcher.ts`:

```typescript
import type { CameraPattern, Camera } from '@nightfox/core';
import { minimatch } from 'minimatch';
import { basename, dirname } from 'path';

export interface MatchResult {
  camera_id: number | null;
  match_type: 'filename' | 'folder' | 'extension' | 'metadata' | null;
  confidence: number;
  detected_make: string | null;
  detected_model: string | null;
}

export class CameraMatcher {
  private patterns: CameraPattern[] = [];
  private cameras: Map<number, Camera> = new Map();

  loadPatterns(patterns: CameraPattern[], cameras: Camera[]): void {
    this.patterns = patterns.sort((a, b) => b.priority - a.priority);
    this.cameras = new Map(cameras.map((c) => [c.id, c]));
  }

  match(
    filePath: string,
    metadata?: { make?: string | null; model?: string | null }
  ): MatchResult {
    const filename = basename(filePath);
    const folder = dirname(filePath);
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();

    // Priority 1: Filename patterns
    for (const pattern of this.patterns.filter(
      (p) => p.pattern_type === 'filename'
    )) {
      if (minimatch(filename, pattern.pattern, { nocase: true })) {
        return {
          camera_id: pattern.camera_id,
          match_type: 'filename',
          confidence: 1.0,
          detected_make: metadata?.make ?? null,
          detected_model: metadata?.model ?? null,
        };
      }
    }

    // Priority 2: Folder patterns
    for (const pattern of this.patterns.filter(
      (p) => p.pattern_type === 'folder'
    )) {
      if (minimatch(folder, pattern.pattern, { nocase: true })) {
        return {
          camera_id: pattern.camera_id,
          match_type: 'folder',
          confidence: 0.9,
          detected_make: metadata?.make ?? null,
          detected_model: metadata?.model ?? null,
        };
      }
    }

    // Priority 3: Extension patterns
    for (const pattern of this.patterns.filter(
      (p) => p.pattern_type === 'extension'
    )) {
      if (ext === pattern.pattern.toLowerCase()) {
        return {
          camera_id: pattern.camera_id,
          match_type: 'extension',
          confidence: 0.7,
          detected_make: metadata?.make ?? null,
          detected_model: metadata?.model ?? null,
        };
      }
    }

    // No pattern match - return detected metadata only
    return {
      camera_id: null,
      match_type: null,
      confidence: 0,
      detected_make: metadata?.make ?? null,
      detected_model: metadata?.model ?? null,
    };
  }
}
```

### Step 4.3: Add Minimatch Dependency

```bash
cd packages/desktop
pnpm add minimatch
pnpm add -D @types/minimatch
```

**Phase 4 Complete Checklist:**
- [ ] CameraRepository with CRUD
- [ ] CameraPattern management
- [ ] CameraMatcher service
- [ ] Pattern priority ordering
- [ ] Fallback to detected make/model

---

## Phase 5: Import Pipeline

**Objective:** Implement complete file import workflow.

### Step 5.1: Create Scanner Service

Create `packages/desktop/electron/services/import/scanner.ts`:

```typescript
import { readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';

export interface FileCandidate {
  filePath: string;
  originalName: string;
  extension: string;
  size: number;
}

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mov', '.avi', '.mkv', '.webm',
  '.ts', '.mts', '.m2ts', '.vob', '.3gp', '.ogv',
  '.tod', '.mod', '.mpg', '.mpeg',
]);

const SIDECAR_EXTENSIONS = new Set(['.moi', '.lrf', '.thm', '.srt', '.xml']);

const SKIP_EXTENSIONS = new Set(['.aae', '.psd', '.psb', '.acr', '.ds_store']);

export function scanDirectory(dirPath: string): FileCandidate[] {
  const candidates: FileCandidate[] = [];

  function scan(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories
        if (!entry.name.startsWith('.')) {
          scan(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();

        // Skip unwanted extensions
        if (SKIP_EXTENSIONS.has(ext)) continue;

        // Check if video or sidecar
        if (VIDEO_EXTENSIONS.has(ext) || SIDECAR_EXTENSIONS.has(ext)) {
          const stats = statSync(fullPath);
          candidates.push({
            filePath: fullPath,
            originalName: entry.name,
            extension: ext,
            size: stats.size,
          });
        }
      }
    }
  }

  scan(dirPath);
  return candidates;
}

export function classifyFile(
  extension: string
): 'video' | 'sidecar' | 'audio' | 'other' {
  const ext = extension.toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (SIDECAR_EXTENSIONS.has(ext)) return 'sidecar';
  if (['.mp3', '.wav', '.aac', '.flac'].includes(ext)) return 'audio';
  return 'other';
}

export function findSidecarPair(
  videoPath: string,
  candidates: FileCandidate[]
): FileCandidate | null {
  const videoBase = basename(videoPath, extname(videoPath));

  // Look for matching .MOI for .TOD, etc.
  for (const candidate of candidates) {
    const candidateBase = basename(candidate.filePath, candidate.extension);
    if (
      candidateBase.toLowerCase() === videoBase.toLowerCase() &&
      SIDECAR_EXTENSIONS.has(candidate.extension)
    ) {
      return candidate;
    }
  }
  return null;
}
```

### Step 5.2: Create Metadata Service

Create `packages/desktop/electron/services/import/metadata.ts`:

```typescript
import * as ffprobe from '../external/ffprobe';
import * as exiftool from '../external/exiftool';
import type { FFProbeResult, ExifToolResult } from '@nightfox/core';

export interface ExtractedMetadata {
  ffprobe: FFProbeResult | null;
  exiftool: ExifToolResult | null;
  ffprobeRaw: string | null;
  exiftoolRaw: string | null;

  // Extracted fields
  duration: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  codec: string | null;
  bitrate: number | null;
  make: string | null;
  model: string | null;
  recordedAt: string | null;
}

export async function extractMetadata(
  filePath: string
): Promise<ExtractedMetadata> {
  let ffprobeResult: FFProbeResult | null = null;
  let exiftoolResult: ExifToolResult | null = null;
  let ffprobeRaw: string | null = null;
  let exiftoolRaw: string | null = null;

  // Extract ffprobe
  try {
    ffprobeRaw = await ffprobe.probeRaw(filePath);
    ffprobeResult = JSON.parse(ffprobeRaw);
  } catch (error) {
    console.warn('FFprobe failed:', error);
  }

  // Extract exiftool
  try {
    exiftoolRaw = await exiftool.extract(filePath);
    const parsed = JSON.parse(exiftoolRaw);
    exiftoolResult = parsed[0];
  } catch (error) {
    console.warn('ExifTool failed:', error);
  }

  // Extract key fields
  const videoStream = ffprobeResult?.streams?.find(
    (s) => s.codec_type === 'video'
  );

  let frameRate: number | null = null;
  if (videoStream?.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (den && den !== 0) {
      frameRate = num / den;
    }
  }

  return {
    ffprobe: ffprobeResult,
    exiftool: exiftoolResult,
    ffprobeRaw,
    exiftoolRaw,
    duration: ffprobeResult?.format?.duration
      ? parseFloat(ffprobeResult.format.duration)
      : null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    frameRate,
    codec: videoStream?.codec_name ?? null,
    bitrate: ffprobeResult?.format?.bit_rate
      ? parseInt(ffprobeResult.format.bit_rate)
      : null,
    make: exiftoolResult?.Make ?? null,
    model: exiftoolResult?.Model ?? null,
    recordedAt: exiftoolResult?.CreateDate ?? null,
  };
}
```

### Step 5.3: Create File Manager Service

Create `packages/desktop/electron/services/import/file-manager.ts`:

```typescript
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import type { Medium } from '@nightfox/core';

export interface ManagedFileResult {
  managedPath: string; // Relative to storage root
  fullPath: string; // Absolute path
}

export function buildManagedPath(
  storagePath: string,
  coupleFolder: string | null,
  medium: Medium | null,
  hash: string,
  extension: string
): ManagedFileResult {
  const year = coupleFolder?.substring(0, 4) || new Date().getFullYear().toString();
  const folder = coupleFolder || '_unsorted';
  const mediumFolder = medium || 'modern';

  const relativePath = join(year, folder, 'raw', mediumFolder, `${hash}${extension}`);
  const fullPath = join(storagePath, relativePath);

  return {
    managedPath: relativePath,
    fullPath,
  };
}

export function copyToManagedLocation(
  sourcePath: string,
  destinationPath: string
): void {
  const dir = join(destinationPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  copyFileSync(sourcePath, destinationPath);
}

export function generateCoupleFolder(
  name: string,
  weddingDate: string | null
): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  if (weddingDate) {
    return `${weddingDate}-${sanitized}`;
  }
  return sanitized;
}
```

### Step 5.4: Create Import Pipeline

Create `packages/desktop/electron/services/import/pipeline.ts`:

```typescript
import type Database from 'better-sqlite3';
import type { ImportResult, ImportBatchResult, Medium } from '@nightfox/core';
import { calculateHash } from '../crypto-service';
import { scanDirectory, classifyFile, findSidecarPair } from './scanner';
import { extractMetadata } from './metadata';
import { buildManagedPath, copyToManagedLocation } from './file-manager';
import { CameraMatcher } from '../camera-matcher';
import { CameraRepository } from '../../repositories/camera-repository';
import { SettingsService } from '../settings-service';

export interface ImportOptions {
  couple_id: number | null;
  couple_folder: string | null;
  on_progress?: (current: number, total: number, filename: string) => void;
}

export class ImportPipeline {
  private cameraMatcher: CameraMatcher;
  private cameraRepo: CameraRepository;
  private settings: SettingsService;

  constructor(private db: Database.Database) {
    this.cameraMatcher = new CameraMatcher();
    this.cameraRepo = new CameraRepository(db);
    this.settings = new SettingsService(db);
  }

  async importDirectory(
    dirPath: string,
    options: ImportOptions
  ): Promise<ImportBatchResult> {
    // Load camera patterns
    const cameras = this.cameraRepo.findAll();
    const patterns = this.cameraRepo.getAllPatterns();
    this.cameraMatcher.loadPatterns(patterns, cameras);

    // Get storage path
    const storagePath = this.settings.get('storage_path');
    if (!storagePath) {
      throw new Error('Storage path not configured');
    }

    // Scan directory
    const candidates = scanDirectory(dirPath);
    const results: ImportResult[] = [];

    let processed = 0;
    const total = candidates.length;

    for (const candidate of candidates) {
      options.on_progress?.(processed, total, candidate.originalName);

      const result = await this.importFile(candidate.filePath, {
        ...options,
        storagePath,
        allCandidates: candidates,
      });

      results.push(result);
      processed++;
    }

    options.on_progress?.(total, total, 'Complete');

    return {
      total: results.length,
      imported: results.filter((r) => r.success && !r.duplicate).length,
      duplicates: results.filter((r) => r.duplicate).length,
      skipped: results.filter((r) => r.skipped).length,
      errors: results.filter((r) => !r.success && !r.skipped).length,
      files: results,
    };
  }

  private async importFile(
    filePath: string,
    options: ImportOptions & { storagePath: string; allCandidates: any[] }
  ): Promise<ImportResult> {
    try {
      // 1. Hash the file
      const hash = await calculateHash(filePath);

      // 2. Check for duplicate
      const existing = this.db
        .prepare('SELECT id FROM files WHERE blake3 = ?')
        .get(hash);

      if (existing) {
        return {
          success: true,
          hash,
          type: 'skipped',
          duplicate: true,
          skipped: true,
        };
      }

      // 3. Extract metadata
      const metadata = await extractMetadata(filePath);

      // 4. Match camera
      const match = this.cameraMatcher.match(filePath, {
        make: metadata.make,
        model: metadata.model,
      });

      // Determine medium from camera or guess from extension
      let medium: Medium | null = null;
      if (match.camera_id) {
        const camera = this.cameraRepo.findById(match.camera_id);
        medium = camera?.medium ?? null;
      }

      // 5. Classify file type
      const ext =
        filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
      const fileType = classifyFile(ext);

      // 6. Build managed path
      const { managedPath, fullPath } = buildManagedPath(
        options.storagePath,
        options.couple_folder,
        medium,
        hash,
        ext
      );

      // 7. Copy file
      copyToManagedLocation(filePath, fullPath);

      // 8. Insert into database
      const insertFile = this.db.prepare(`
        INSERT INTO files (
          blake3, original_filename, original_path, managed_path, extension,
          file_size, couple_id, camera_id, detected_make, detected_model,
          medium, file_type, duration_seconds, width, height, frame_rate,
          codec, bitrate, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = insertFile.run(
        hash,
        filePath.substring(filePath.lastIndexOf('/') + 1),
        filePath,
        managedPath,
        ext,
        metadata.ffprobe?.format?.size
          ? parseInt(metadata.ffprobe.format.size)
          : null,
        options.couple_id,
        match.camera_id,
        match.detected_make,
        match.detected_model,
        medium,
        fileType,
        metadata.duration,
        metadata.width,
        metadata.height,
        metadata.frameRate,
        metadata.codec,
        metadata.bitrate,
        metadata.recordedAt
      );

      const fileId = result.lastInsertRowid as number;

      // 9. Store full metadata
      this.db
        .prepare(
          `INSERT INTO file_metadata (file_id, exiftool_json, ffprobe_json)
           VALUES (?, ?, ?)`
        )
        .run(fileId, metadata.exiftoolRaw, metadata.ffprobeRaw);

      // 10. Handle sidecar linking
      if (fileType === 'video') {
        const sidecar = findSidecarPair(filePath, options.allCandidates);
        if (sidecar) {
          // Sidecar will be linked when it's imported
        }
      }

      return {
        success: true,
        hash,
        type: fileType,
        duplicate: false,
        archivePath: managedPath,
      };
    } catch (error) {
      return {
        success: false,
        hash: '',
        type: 'other',
        duplicate: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
```

**Phase 5 Complete Checklist:**
- [ ] Scanner service finds video/sidecar files
- [ ] Metadata extraction (ffprobe + exiftool)
- [ ] Camera pattern matching
- [ ] File copy to managed location
- [ ] Database insert with full metadata
- [ ] Progress callback support

---

## Phase 6: Couples Management

**Objective:** Implement couples CRUD and JSON export.

### Step 6.1: Create Couples Repository

Create `packages/desktop/electron/repositories/couple-repository.ts`:

```typescript
import type Database from 'better-sqlite3';
import type { Couple, CoupleInput, File } from '@nightfox/core';
import { generateCoupleFolder } from '../services/import/file-manager';

export class CoupleRepository {
  constructor(private db: Database.Database) {}

  findAll(): Couple[] {
    return this.db
      .prepare('SELECT * FROM couples ORDER BY wedding_date DESC, name')
      .all() as Couple[];
  }

  findById(id: number): Couple | null {
    return (
      (this.db
        .prepare('SELECT * FROM couples WHERE id = ?')
        .get(id) as Couple) || null
    );
  }

  create(input: CoupleInput): number {
    const folderName = generateCoupleFolder(input.name, input.wedding_date ?? null);

    const result = this.db
      .prepare(
        `INSERT INTO couples (name, wedding_date, folder_name, notes)
         VALUES (?, ?, ?, ?)`
      )
      .run(input.name, input.wedding_date ?? null, folderName, input.notes ?? null);

    return result.lastInsertRowid as number;
  }

  update(id: number, input: Partial<CoupleInput>): void {
    const couple = this.findById(id);
    if (!couple) throw new Error(`Couple ${id} not found`);

    // Regenerate folder name if name or date changed
    let folderName = couple.folder_name;
    if (input.name || input.wedding_date !== undefined) {
      folderName = generateCoupleFolder(
        input.name ?? couple.name,
        input.wedding_date ?? couple.wedding_date
      );
    }

    this.db
      .prepare(
        `UPDATE couples SET
           name = COALESCE(?, name),
           wedding_date = COALESCE(?, wedding_date),
           folder_name = ?,
           notes = COALESCE(?, notes),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(input.name, input.wedding_date, folderName, input.notes, id);
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM couples WHERE id = ?').run(id);
  }

  getFiles(coupleId: number): File[] {
    return this.db
      .prepare(
        `SELECT * FROM files
         WHERE couple_id = ? AND is_hidden = 0
         ORDER BY recorded_at, original_filename`
      )
      .all(coupleId) as File[];
  }

  recalculateStats(coupleId: number): void {
    this.db
      .prepare(
        `UPDATE couples SET
           file_count = (SELECT COUNT(*) FROM files WHERE couple_id = ? AND is_hidden = 0),
           total_duration_seconds = (SELECT COALESCE(SUM(duration_seconds), 0) FROM files WHERE couple_id = ? AND is_hidden = 0),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(coupleId, coupleId, coupleId);
  }
}
```

### Step 6.2: Create JSON Export Service

Create `packages/desktop/electron/services/export/json-export.ts`:

```typescript
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type Database from 'better-sqlite3';
import type { Couple, File, Camera, Scene, Export as ExportRecord } from '@nightfox/core';

export interface CoupleExport {
  version: string;
  exported_at: string;
  couple: Couple;
  files: Array<File & { camera_name?: string }>;
  scenes: Scene[];
  exports: ExportRecord[];
}

export class JsonExportService {
  constructor(private db: Database.Database) {}

  exportCouple(coupleId: number, outputDir: string): string {
    // Get couple
    const couple = this.db
      .prepare('SELECT * FROM couples WHERE id = ?')
      .get(coupleId) as Couple | undefined;

    if (!couple) throw new Error(`Couple ${coupleId} not found`);

    // Get files with camera names
    const files = this.db
      .prepare(
        `SELECT f.*, c.name as camera_name
         FROM files f
         LEFT JOIN cameras c ON f.camera_id = c.id
         WHERE f.couple_id = ? AND f.is_hidden = 0
         ORDER BY f.recorded_at, f.original_filename`
      )
      .all(coupleId) as Array<File & { camera_name?: string }>;

    // Get scenes for these files
    const fileIds = files.map((f) => f.id);
    const scenes =
      fileIds.length > 0
        ? (this.db
            .prepare(
              `SELECT * FROM scenes WHERE file_id IN (${fileIds.join(',')})
               ORDER BY file_id, scene_number`
            )
            .all() as Scene[])
        : [];

    // Get exports
    const exports = this.db
      .prepare(
        `SELECT * FROM exports WHERE couple_id = ?
         ORDER BY created_at DESC`
      )
      .all(coupleId) as ExportRecord[];

    const exportData: CoupleExport = {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      couple,
      files,
      scenes,
      exports,
    };

    // Ensure output directory exists
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = join(outputDir, `${couple.folder_name}.json`);
    writeFileSync(outputPath, JSON.stringify(exportData, null, 2));

    return outputPath;
  }

  exportAllCouples(storagePath: string): void {
    const couples = this.db.prepare('SELECT * FROM couples').all() as Couple[];

    for (const couple of couples) {
      if (couple.folder_name) {
        const year = couple.wedding_date?.substring(0, 4) || new Date().getFullYear().toString();
        const outputDir = join(storagePath, year, couple.folder_name);
        this.exportCouple(couple.id, outputDir);
      }
    }
  }
}
```

**Phase 6 Complete Checklist:**
- [ ] CoupleRepository CRUD
- [ ] Folder name generation
- [ ] Stats recalculation
- [ ] JSON export service
- [ ] Export includes files, scenes, exports

---

## Phase 7: UI Shell

**Objective:** Set up Electron main process, IPC handlers, and Svelte pages.

### Step 7.1: Create Electron Main Entry

Create `packages/desktop/electron/main/index.ts`:

```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { getDatabase, closeDatabase } from './database';
import { registerAllHandlers } from './ipc-handlers';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
    backgroundColor: '#FAFAF8',
    titleBarStyle: 'hiddenInset',
  });

  // Initialize database and register handlers
  const db = getDatabase();
  registerAllHandlers(db);

  // Load app
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
```

### Step 7.2: Create IPC Handlers

Create `packages/desktop/electron/main/ipc-handlers/index.ts`:

```typescript
import type Database from 'better-sqlite3';
import { registerCameraHandlers } from './camera-handlers';
import { registerCoupleHandlers } from './couple-handlers';
import { registerFileHandlers } from './file-handlers';
import { registerSettingsHandlers } from './settings-handlers';

export function registerAllHandlers(db: Database.Database): void {
  registerCameraHandlers(db);
  registerCoupleHandlers(db);
  registerFileHandlers(db);
  registerSettingsHandlers(db);
}
```

Create `packages/desktop/electron/main/ipc-handlers/camera-handlers.ts`:

```typescript
import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { CameraRepository } from '../../repositories/camera-repository';

const CameraInputSchema = z.object({
  name: z.string().min(1),
  medium: z.enum(['dadcam', 'super8', 'modern']),
  notes: z.string().nullable().optional(),
  lut_path: z.string().nullable().optional(),
  deinterlace: z.boolean().optional(),
  audio_channels: z.enum(['stereo', 'mono', 'none']).optional(),
  sharpness_baseline: z.number().nullable().optional(),
  transcode_preset: z.string().nullable().optional(),
});

export function registerCameraHandlers(db: Database.Database): void {
  const repo = new CameraRepository(db);

  ipcMain.handle('camera:findAll', async () => {
    return repo.findAll();
  });

  ipcMain.handle('camera:findById', async (_event, id: unknown) => {
    const parsed = z.number().parse(id);
    return repo.findByIdWithPatterns(parsed);
  });

  ipcMain.handle('camera:create', async (_event, input: unknown) => {
    const validated = CameraInputSchema.parse(input);
    const id = repo.create(validated);
    return { success: true, id };
  });

  ipcMain.handle('camera:update', async (_event, id: unknown, input: unknown) => {
    const parsedId = z.number().parse(id);
    const validated = CameraInputSchema.partial().parse(input);
    repo.update(parsedId, validated);
    return { success: true };
  });

  ipcMain.handle('camera:delete', async (_event, id: unknown) => {
    const parsed = z.number().parse(id);
    repo.delete(parsed);
    return { success: true };
  });

  ipcMain.handle('camera:addPattern', async (_event, input: unknown) => {
    const validated = z
      .object({
        camera_id: z.number(),
        pattern_type: z.enum(['filename', 'folder', 'extension']),
        pattern: z.string().min(1),
        priority: z.number().optional(),
      })
      .parse(input);
    const id = repo.addPattern(validated);
    return { success: true, id };
  });

  ipcMain.handle('camera:removePattern', async (_event, id: unknown) => {
    const parsed = z.number().parse(id);
    repo.removePattern(parsed);
    return { success: true };
  });
}
```

Create `packages/desktop/electron/main/ipc-handlers/couple-handlers.ts`:

```typescript
import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { CoupleRepository } from '../../repositories/couple-repository';
import { JsonExportService } from '../../services/export/json-export';
import { SettingsService } from '../../services/settings-service';
import { join } from 'path';

const CoupleInputSchema = z.object({
  name: z.string().min(1),
  wedding_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export function registerCoupleHandlers(db: Database.Database): void {
  const repo = new CoupleRepository(db);
  const jsonExport = new JsonExportService(db);
  const settings = new SettingsService(db);

  ipcMain.handle('couple:findAll', async () => {
    return repo.findAll();
  });

  ipcMain.handle('couple:findById', async (_event, id: unknown) => {
    const parsed = z.number().parse(id);
    return repo.findById(parsed);
  });

  ipcMain.handle('couple:create', async (_event, input: unknown) => {
    const validated = CoupleInputSchema.parse(input);
    const id = repo.create(validated);
    return { success: true, id };
  });

  ipcMain.handle('couple:update', async (_event, id: unknown, input: unknown) => {
    const parsedId = z.number().parse(id);
    const validated = CoupleInputSchema.partial().parse(input);
    repo.update(parsedId, validated);
    return { success: true };
  });

  ipcMain.handle('couple:delete', async (_event, id: unknown) => {
    const parsed = z.number().parse(id);
    repo.delete(parsed);
    return { success: true };
  });

  ipcMain.handle('couple:getFiles', async (_event, id: unknown) => {
    const parsed = z.number().parse(id);
    return repo.getFiles(parsed);
  });

  ipcMain.handle('couple:exportJson', async (_event, id: unknown) => {
    const parsed = z.number().parse(id);
    const storagePath = settings.get('storage_path');
    if (!storagePath) throw new Error('Storage path not configured');

    const couple = repo.findById(parsed);
    if (!couple) throw new Error('Couple not found');

    const year = couple.wedding_date?.substring(0, 4) || new Date().getFullYear().toString();
    const outputDir = join(storagePath, year, couple.folder_name || '');

    const outputPath = jsonExport.exportCouple(parsed, outputDir);
    return { success: true, path: outputPath };
  });
}
```

Create `packages/desktop/electron/main/ipc-handlers/file-handlers.ts`:

```typescript
import { ipcMain, dialog, BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { ImportPipeline } from '../../services/import/pipeline';

const ImportInputSchema = z.object({
  directory: z.string(),
  couple_id: z.number().nullable().optional(),
  couple_folder: z.string().nullable().optional(),
});

export function registerFileHandlers(db: Database.Database): void {
  const pipeline = new ImportPipeline(db);

  ipcMain.handle('file:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('file:import', async (event, input: unknown) => {
    const validated = ImportInputSchema.parse(input);

    const result = await pipeline.importDirectory(validated.directory, {
      couple_id: validated.couple_id ?? null,
      couple_folder: validated.couple_folder ?? null,
      on_progress: (current, total, filename) => {
        event.sender.send('file:import:progress', { current, total, filename });
      },
    });

    return result;
  });

  ipcMain.handle('file:findByCouple', async (_event, coupleId: unknown) => {
    const parsed = z.number().parse(coupleId);
    return db
      .prepare(
        `SELECT * FROM files WHERE couple_id = ? AND is_hidden = 0
         ORDER BY recorded_at, original_filename`
      )
      .all(parsed);
  });
}
```

Create `packages/desktop/electron/main/ipc-handlers/settings-handlers.ts`:

```typescript
import { ipcMain, dialog } from 'electron';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { SettingsService } from '../../services/settings-service';

export function registerSettingsHandlers(db: Database.Database): void {
  const service = new SettingsService(db);

  ipcMain.handle('settings:get', async (_event, key: unknown) => {
    const parsed = z.string().parse(key);
    return service.get(parsed);
  });

  ipcMain.handle('settings:set', async (_event, key: unknown, value: unknown) => {
    const parsedKey = z.string().parse(key);
    const parsedValue = z.string().nullable().parse(value);
    service.set(parsedKey, parsedValue);
    return { success: true };
  });

  ipcMain.handle('settings:getAll', async () => {
    return service.getAll();
  });

  ipcMain.handle('settings:selectStoragePath', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!result.canceled && result.filePaths[0]) {
      service.set('storage_path', result.filePaths[0]);
      return result.filePaths[0];
    }
    return null;
  });
}
```

### Step 7.3: Create Preload Script

Create `packages/desktop/electron/preload/preload.cjs`:

```javascript
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

const api = {
  cameras: {
    findAll: invoke("camera:findAll"),
    findById: invoke("camera:findById"),
    create: invoke("camera:create"),
    update: (id, input) => ipcRenderer.invoke("camera:update", id, input),
    delete: invoke("camera:delete"),
    addPattern: invoke("camera:addPattern"),
    removePattern: invoke("camera:removePattern"),
  },
  couples: {
    findAll: invoke("couple:findAll"),
    findById: invoke("couple:findById"),
    create: invoke("couple:create"),
    update: (id, input) => ipcRenderer.invoke("couple:update", id, input),
    delete: invoke("couple:delete"),
    getFiles: invoke("couple:getFiles"),
    exportJson: invoke("couple:exportJson"),
  },
  files: {
    selectDirectory: invoke("file:selectDirectory"),
    import: invoke("file:import"),
    findByCouple: invoke("file:findByCouple"),
    onImportProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("file:import:progress", listener);
      return () => ipcRenderer.removeListener("file:import:progress", listener);
    },
  },
  settings: {
    get: invoke("settings:get"),
    set: (key, value) => ipcRenderer.invoke("settings:set", key, value),
    getAll: invoke("settings:getAll"),
    selectStoragePath: invoke("settings:selectStoragePath"),
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
```

### Step 7.4: Create Vite Config

Create `packages/desktop/vite.config.ts`:

```typescript
import { defineConfig, Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Custom plugin to copy preload without bundling
function copyPreloadPlugin(): Plugin {
  return {
    name: 'copy-preload',
    closeBundle() {
      const src = join(__dirname, 'electron/preload/preload.cjs');
      const destDir = join(__dirname, 'dist-electron/preload');
      const dest = join(destDir, 'preload.cjs');

      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }
      copyFileSync(src, dest);
      console.log('Copied preload.cjs');
    },
  };
}

export default defineConfig({
  plugins: [
    svelte(),
    electron([
      {
        entry: 'electron/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: [
                'electron',
                'better-sqlite3',
                'blake3',
                'sharp',
                'exiftool-vendored',
                'fluent-ffmpeg',
              ],
            },
          },
        },
      },
    ]),
    renderer(),
    copyPreloadPlugin(),
  ],
  build: {
    rollupOptions: {
      external: ['better-sqlite3', 'blake3', 'sharp'],
    },
  },
});
```

### Step 7.5: Create Renderer Entry

Create `packages/desktop/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Nightfox Films</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Create `packages/desktop/src/main.ts`:

```typescript
import './app.css';
import App from './App.svelte';

const app = new App({
  target: document.getElementById('app')!,
});

export default app;
```

Create `packages/desktop/src/App.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  let currentPage = 'dashboard';
  let storagePath: string | null = null;

  const pages = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'import', label: 'Import' },
    { id: 'cameras', label: 'Cameras' },
    { id: 'couples', label: 'Couples' },
    { id: 'settings', label: 'Settings' },
  ];

  onMount(async () => {
    storagePath = await window.electronAPI.settings.get('storage_path');
  });
</script>

<div class="flex h-screen bg-braun-50">
  <!-- Sidebar -->
  <nav class="w-56 bg-white border-r border-braun-300 p-4">
    <div class="mb-8">
      <h1 class="text-xl font-bold text-braun-900">Nightfox</h1>
      <p class="text-xs text-braun-500">Films</p>
    </div>

    <ul class="space-y-1">
      {#each pages as page}
        <li>
          <button
            class="w-full text-left px-3 py-2 rounded text-sm font-medium transition-colors"
            class:bg-braun-100={currentPage === page.id}
            class:text-braun-900={currentPage === page.id}
            class:text-braun-600={currentPage !== page.id}
            on:click={() => (currentPage = page.id)}
          >
            {page.label}
          </button>
        </li>
      {/each}
    </ul>
  </nav>

  <!-- Main content -->
  <main class="flex-1 overflow-auto p-8">
    {#if !storagePath && currentPage !== 'settings'}
      <div class="bg-warning/10 border border-warning rounded p-4 mb-6">
        <p class="text-sm text-braun-900">
          Please configure your storage path in Settings before importing files.
        </p>
      </div>
    {/if}

    {#if currentPage === 'dashboard'}
      <h2 class="text-2xl font-bold mb-6">Dashboard</h2>
      <p class="text-braun-600">Welcome to Nightfox Films.</p>
    {:else if currentPage === 'import'}
      <h2 class="text-2xl font-bold mb-6">Import</h2>
      <p class="text-braun-600">Import workflow coming soon.</p>
    {:else if currentPage === 'cameras'}
      <h2 class="text-2xl font-bold mb-6">Cameras</h2>
      <p class="text-braun-600">Camera management coming soon.</p>
    {:else if currentPage === 'couples'}
      <h2 class="text-2xl font-bold mb-6">Couples</h2>
      <p class="text-braun-600">Couples management coming soon.</p>
    {:else if currentPage === 'settings'}
      <h2 class="text-2xl font-bold mb-6">Settings</h2>
      <div class="max-w-xl space-y-6">
        <div>
          <label class="form-label">Storage Path</label>
          <div class="flex gap-2">
            <input
              type="text"
              value={storagePath || 'Not configured'}
              readonly
              class="flex-1 px-3 py-2 border border-braun-300 rounded bg-braun-50 text-sm"
            />
            <button
              class="px-4 py-2 bg-braun-900 text-white rounded text-sm font-medium"
              on:click={async () => {
                const path = await window.electronAPI.settings.selectStoragePath();
                if (path) storagePath = path;
              }}
            >
              Browse
            </button>
          </div>
          <p class="text-xs text-braun-500 mt-1">
            This is where imported files will be stored.
          </p>
        </div>
      </div>
    {/if}
  </main>
</div>
```

### Step 7.6: Add TypeScript Declarations

Create `packages/desktop/src/types/electron.d.ts`:

```typescript
interface ElectronAPI {
  cameras: {
    findAll(): Promise<any[]>;
    findById(id: number): Promise<any>;
    create(input: any): Promise<{ success: boolean; id: number }>;
    update(id: number, input: any): Promise<{ success: boolean }>;
    delete(id: number): Promise<{ success: boolean }>;
    addPattern(input: any): Promise<{ success: boolean; id: number }>;
    removePattern(id: number): Promise<{ success: boolean }>;
  };
  couples: {
    findAll(): Promise<any[]>;
    findById(id: number): Promise<any>;
    create(input: any): Promise<{ success: boolean; id: number }>;
    update(id: number, input: any): Promise<{ success: boolean }>;
    delete(id: number): Promise<{ success: boolean }>;
    getFiles(id: number): Promise<any[]>;
    exportJson(id: number): Promise<{ success: boolean; path: string }>;
  };
  files: {
    selectDirectory(): Promise<string | null>;
    import(input: any): Promise<any>;
    findByCouple(coupleId: number): Promise<any[]>;
    onImportProgress(callback: (progress: any) => void): () => void;
  };
  settings: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string | null): Promise<{ success: boolean }>;
    getAll(): Promise<Record<string, string | null>>;
    selectStoragePath(): Promise<string | null>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
```

**Phase 7 Complete Checklist:**
- [ ] Electron main entry
- [ ] All IPC handlers registered
- [ ] Preload script (CommonJS)
- [ ] Vite config with preload copy
- [ ] Basic Svelte app shell
- [ ] Navigation working
- [ ] Settings page functional

---

## Phase 8: Tools (Screenshots/Clips)

**Objective:** Implement scene detection, sharpness scoring, and export pipeline.

*This phase requires Python dependencies (PySceneDetect, OpenCV). Implementation details in machinelogic skill.*

### Step 8.1: Create Python Scripts Directory

```bash
mkdir -p packages/desktop/scripts
```

### Step 8.2: Create Scene Detection Script

Create `packages/desktop/scripts/scene_detect.py`:

```python
#!/usr/bin/env python3
"""Scene detection using PySceneDetect."""
import argparse
import json
import sys
from scenedetect import detect, ContentDetector, AdaptiveDetector

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', default='json')
    parser.add_argument('--method', default='content', choices=['content', 'adaptive'])
    parser.add_argument('--threshold', type=float, default=27.0)
    parser.add_argument('--min-scene-len', type=int, default=30)
    args = parser.parse_args()

    if args.method == 'content':
        detector = ContentDetector(threshold=args.threshold, min_scene_len=args.min_scene_len)
    else:
        detector = AdaptiveDetector(adaptive_threshold=3.0, min_scene_len=args.min_scene_len)

    scenes = detect(args.input, detector)

    result = {
        'scenes': [
            {
                'scene_number': i + 1,
                'start_time': scene[0].get_seconds(),
                'end_time': scene[1].get_seconds(),
                'start_frame': scene[0].get_frames(),
                'end_frame': scene[1].get_frames(),
                'duration': scene[1].get_seconds() - scene[0].get_seconds(),
            }
            for i, scene in enumerate(scenes)
        ],
        'method': args.method,
    }

    print(json.dumps(result))

if __name__ == '__main__':
    main()
```

### Step 8.3: Create Scene Detection Service

Create `packages/desktop/electron/services/scene-detection-service.ts`:

```typescript
import { spawn } from 'child_process';
import { join } from 'path';
import type { SceneDetectionResult, SceneDetectionMethod } from '@nightfox/core';

export interface SceneDetectionOptions {
  method?: SceneDetectionMethod;
  threshold?: number;
  minSceneLength?: number;
}

export async function detectScenes(
  videoPath: string,
  options: SceneDetectionOptions = {}
): Promise<SceneDetectionResult> {
  const scriptPath = join(__dirname, '../../scripts/scene_detect.py');
  const method = options.method || 'content';
  const threshold = options.threshold || 27.0;
  const minSceneLen = options.minSceneLength || 30;

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const proc = spawn('python3', [
      scriptPath,
      '--input', videoPath,
      '--method', method,
      '--threshold', threshold.toString(),
      '--min-scene-len', minSceneLen.toString(),
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resolve({
            ...result,
            duration_ms: Date.now() - startTime,
          });
        } catch (e) {
          reject(new Error(`Failed to parse scene detection output: ${e}`));
        }
      } else {
        reject(new Error(`Scene detection failed: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}
```

**Phase 8 Complete Checklist:**
- [ ] Python scene detection script
- [ ] Scene detection service wrapper
- [ ] Sharpness scoring (OpenCV)
- [ ] Frame extraction
- [ ] Export pipeline

---

## Phase 9: AI Integration

**Objective:** Integrate LiteLLM for captioning.

### Step 9.1: Create LiteLLM Client

Create `packages/desktop/electron/services/ai/litellm-client.ts`:

```typescript
import type { CaptionResult, AISource } from '@nightfox/core';

export interface LiteLLMConfig {
  baseUrl: string;
  modelVLM: string;
  modelLLM: string;
}

export class LiteLLMClient {
  constructor(private config: LiteLLMConfig) {}

  async generateCaption(
    frames: string[], // Base64 encoded
    context: { couple?: string; event?: string }
  ): Promise<CaptionResult> {
    const prompt = this.buildCaptionPrompt(context);

    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.modelVLM,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...frames.map((f) => ({
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${f}` },
              })),
            ],
          },
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error(`LiteLLM error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '';

    // Parse caption and hashtags from response
    const lines = content.split('\n').filter((l: string) => l.trim());
    const caption = lines[0] || '';
    const hashtags = lines
      .slice(1)
      .join(' ')
      .match(/#\w+/g) || [];

    return {
      caption,
      hashtags,
      source: {
        model: data.model || this.config.modelVLM,
        provider: 'litellm',
        timestamp: new Date(),
      },
    };
  }

  private buildCaptionPrompt(context: { couple?: string; event?: string }): string {
    let prompt = 'Write a short, engaging caption for this wedding video moment suitable for Instagram or TikTok.';

    if (context.couple) {
      prompt += ` The couple is ${context.couple}.`;
    }
    if (context.event) {
      prompt += ` This is from the ${context.event}.`;
    }

    prompt += '\n\nProvide:\n1. A caption (1-2 sentences)\n2. 3-5 relevant hashtags';

    return prompt;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

### Step 9.2: Create AI Service

Create `packages/desktop/electron/services/ai/ai-service.ts`:

```typescript
import type Database from 'better-sqlite3';
import { SettingsService } from '../settings-service';
import { LiteLLMClient } from './litellm-client';
import type { CaptionResult } from '@nightfox/core';

export class AIService {
  private client: LiteLLMClient | null = null;
  private settings: SettingsService;

  constructor(private db: Database.Database) {
    this.settings = new SettingsService(db);
  }

  private getClient(): LiteLLMClient {
    if (!this.client) {
      const baseUrl = this.settings.get('litellm_url') || 'http://localhost:4000';
      const modelVLM = this.settings.get('litellm_model_vlm') || 'local-vlm';
      const modelLLM = this.settings.get('litellm_model_llm') || 'local-llm';

      this.client = new LiteLLMClient({ baseUrl, modelVLM, modelLLM });
    }
    return this.client;
  }

  async generateCaption(
    fileId: number,
    sceneId: number | null,
    frames: string[]
  ): Promise<CaptionResult> {
    const client = this.getClient();

    // Get context from database
    const file = this.db
      .prepare(
        `SELECT f.*, c.name as couple_name
         FROM files f
         LEFT JOIN couples c ON f.couple_id = c.id
         WHERE f.id = ?`
      )
      .get(fileId) as any;

    const result = await client.generateCaption(frames, {
      couple: file?.couple_name,
    });

    // Store result in database
    this.db
      .prepare(
        `INSERT INTO ai_analysis
         (file_id, scene_id, analysis_type, result_json, model_name, provider_name)
         VALUES (?, ?, 'caption', ?, ?, ?)`
      )
      .run(
        fileId,
        sceneId,
        JSON.stringify(result),
        result.source.model,
        result.source.provider
      );

    return result;
  }

  async isAvailable(): Promise<boolean> {
    return this.getClient().isAvailable();
  }
}
```

**Phase 9 Complete Checklist:**
- [ ] LiteLLM client
- [ ] Caption generation
- [ ] AI result storage with attribution
- [ ] Error handling
- [ ] Availability check

---

## Verification Checklist

After completing all phases, verify:

### Build

```bash
pnpm install
pnpm build
pnpm dev
```

### Functionality

- [ ] App launches without errors
- [ ] Settings page allows storage path configuration
- [ ] Cameras can be created with patterns
- [ ] Couples can be created
- [ ] Files can be imported to a couple
- [ ] Progress shows during import
- [ ] Imported files appear in database
- [ ] JSON export creates valid files

### Code Quality

- [ ] No TypeScript errors
- [ ] No ESLint warnings
- [ ] Preload is pure CommonJS
- [ ] Native modules externalized in Vite

---

## Next Steps

After completing this guide:

1. **Enhance UI** - Build out full pages for each section
2. **Add Scene Detection** - Install Python dependencies, test workflow
3. **Add Export Pipeline** - Screenshot and clip generation
4. **Add AI Integration** - Set up LiteLLM, test captioning
5. **Polish** - Error handling, loading states, notifications

---

*Generated for Claude Code execution. Follow phases in order.*
