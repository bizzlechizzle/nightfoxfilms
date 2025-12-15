# Abandoned Upstate Archive - Implementation Plan

**Version:** 0.1.0
**Timeline:** 14 weeks (3.5 months)
**Start Date:** TBD
**Status:** Pre-Implementation

---

## TARGET: Overview

This document provides a week-by-week implementation plan for building the Abandoned Upstate Archive desktop application from scratch. Each phase includes specific tasks, code examples, and validation checkpoints.

---

## CHECKLIST: Pre-Flight Checklist

Before starting development, ensure the following are installed:

### Required Software

```bash
# Node.js (v20 LTS recommended)
node --version  # Should be v20.x or v18.x
npm --version

# pnpm (package manager)
npm install -g pnpm
pnpm --version  # Should be 8.x or 9.x

# Git
git --version

# Code Editor
# Recommended: VS Code with extensions:
# - Svelte for VS Code
# - ESLint
# - Prettier
# - TypeScript and JavaScript Language Features
```

### Optional (Install During Development)

```bash
# ExifTool (for metadata extraction)
# macOS:
brew install exiftool

# Linux (Debian/Ubuntu):
sudo apt-get install libimage-exiftool-perl

# FFmpeg (for video metadata)
# macOS:
brew install ffmpeg

# Linux:
sudo apt-get install ffmpeg
```

### Verify Environment

```bash
# Check disk space (need ~20GB for development)
df -h

# Check Git configuration
git config --global user.name
git config --global user.email
```

---

## ARCHITECTURE: Phase 1: Foundation (Weeks 1-2)

**Goal:** Set up project structure, tooling, and database foundation.

### Week 1: Project Scaffolding

#### Day 1: Monorepo Setup

**1. Initialize Git Repository (Already Done)**

```bash
cd /home/user/au-archive

# Verify current state
git status
git log --oneline
```

**2. Create Monorepo Structure**

```bash
# Create directories
mkdir -p packages/core/src/{domain,services,repositories,utils}
mkdir -p packages/desktop/electron/{main,preload,repositories}
mkdir -p packages/desktop/src/{pages,components,stores,lib}
mkdir -p packages/desktop/public
mkdir -p resources/{icons,bin}
mkdir -p tests/{unit,integration}

# Move existing assets
mv abandoned-upstate-logo.png resources/icons/
mv abandoned-upstate-icon.png resources/icons/
```

**3. Initialize pnpm Workspace**

```bash
# Create workspace config
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'packages/*'
EOF

# Create root package.json
cat > package.json << 'EOF'
{
  "name": "abandoned-upstate-archive",
  "version": "0.1.0",
  "private": true,
  "description": "Desktop application for archiving abandoned locations",
  "repository": {
    "type": "git",
    "url": "https://github.com/bizzlechizzle/au-archive.git"
  },
  "scripts": {
    "dev": "pnpm --filter desktop dev",
    "build": "pnpm --filter core build && pnpm --filter desktop build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "format": "prettier --write \"**/*.{ts,tsx,svelte,json,md}\""
  },
  "devDependencies": {
    "prettier": "^3.1.1",
    "prettier-plugin-svelte": "^3.1.2",
    "typescript": "^5.3.3"
  }
}
EOF
```

**4. Create Core Package**

```bash
cd packages/core

# package.json
cat > package.json << 'EOF'
{
  "name": "@au-archive/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest",
    "lint": "eslint src"
  },
  "dependencies": {
    "zod": "^3.22.4",
    "date-fns": "^3.0.6",
    "slugify": "^1.6.6"
  },
  "devDependencies": {
    "@types/node": "^20.10.6",
    "typescript": "^5.3.3",
    "vitest": "^1.1.0"
  }
}
EOF

# tsconfig.json
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF
```

**5. Create Desktop Package**

```bash
cd ../desktop

# package.json
cat > package.json << 'EOF'
{
  "name": "@au-archive/desktop",
  "version": "0.1.0",
  "type": "module",
  "main": "electron/main/index.js",
  "scripts": {
    "dev": "vite",
    "build": "vite build && electron-builder",
    "preview": "vite preview",
    "electron:dev": "concurrently \"vite\" \"electron .\"",
    "test": "vitest",
    "lint": "eslint src electron"
  },
  "dependencies": {
    "@au-archive/core": "workspace:*",
    "better-sqlite3": "^11.0.0",
    "kysely": "^0.27.2",
    "leaflet": "^1.9.4",
    "supercluster": "^8.0.1",
    "exiftool-vendored": "^25.3.0",
    "fluent-ffmpeg": "^2.1.2",
    "sharp": "^0.33.1"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^3.0.1",
    "@types/leaflet": "^1.9.8",
    "@types/better-sqlite3": "^7.6.8",
    "autoprefixer": "^10.4.16",
    "concurrently": "^8.2.2",
    "electron": "^28.1.0",
    "electron-builder": "^24.9.1",
    "postcss": "^8.4.32",
    "svelte": "^5.0.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.3.3",
    "vite": "^5.0.10",
    "vite-plugin-electron": "^0.28.2",
    "vitest": "^1.1.0"
  }
}
EOF

# tsconfig.json
cat > tsconfig.json << 'EOF'
{
  "extends": "@au-archive/core/tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "electron/**/*"],
  "exclude": ["node_modules"]
}
EOF
```

**6. Install Dependencies**

```bash
cd /home/user/au-archive

# Install all dependencies
pnpm install
```

**Checkpoint:** Verify monorepo structure works
```bash
pnpm -r list  # Should show core and desktop packages
```

---

#### Day 2-3: Vite + Svelte + Electron Setup

**1. Create Vite Config**

```bash
cd packages/desktop

cat > vite.config.ts << 'EOF'
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import electron from 'vite-plugin-electron';
import path from 'path';

export default defineConfig({
  plugins: [
    svelte(),
    electron([
      {
        entry: 'electron/main/index.ts',
        onstart(options) {
          options.startup();
        },
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['better-sqlite3', 'exiftool-vendored', 'fluent-ffmpeg']
            }
          }
        }
      },
      {
        entry: 'electron/preload/index.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload'
          }
        }
      }
    ])
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@core': path.resolve(__dirname, '../core/src')
    }
  }
});
EOF
```

**2. Create Svelte Config**

```bash
cat > svelte.config.js << 'EOF'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: true // Enable Svelte 5 runes
  }
};
EOF
```

**3. Create Tailwind Config**

```bash
cat > tailwind.config.js << 'EOF'
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        accent: '#b9975c',
        background: '#fffbf7',
        foreground: '#454545'
      }
    }
  },
  plugins: []
};
EOF

cat > postcss.config.js << 'EOF'
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
EOF
```

**4. Create App Entry Point**

```bash
mkdir -p src/lib

cat > src/app.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
    Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
}

body {
  margin: 0;
  padding: 0;
  background-color: #fffbf7;
  color: #454545;
}
EOF

cat > src/App.svelte << 'EOF'
<script lang="ts">
  import './app.css';

  let count = $state(0);

  function increment() {
    count++;
  }
</script>

<main class="p-8">
  <h1 class="text-4xl font-bold mb-4">Abandoned Upstate Archive</h1>
  <p class="mb-4">Development Environment Ready!</p>

  <button
    class="px-4 py-2 bg-accent text-white rounded hover:opacity-90"
    onclick={increment}
  >
    Count: {count}
  </button>
</main>
EOF

cat > src/main.ts << 'EOF'
import App from './App.svelte';

const app = new App({
  target: document.getElementById('app')!
});

export default app;
EOF
```

**5. Create HTML Template**

```bash
cat > index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Abandoned Upstate Archive</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
EOF
```

**6. Create Electron Main Process**

```bash
mkdir -p electron/main

cat > electron/main/index.ts << 'EOF'
import { app, BrowserWindow } from 'electron';
import path from 'path';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, '../../resources/icons/abandoned-upstate-icon.png')
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
EOF
```

**7. Create Preload Script**

```bash
mkdir -p electron/preload

cat > electron/preload/index.ts << 'EOF'
import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Placeholder - will add actual API methods later
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
});
EOF
```

**8. Test Development Environment**

```bash
cd /home/user/au-archive

# Start development server
pnpm dev
```

**Checkpoint:**
- Vite should start on http://localhost:5173
- Browser window should show "Abandoned Upstate Archive" with a counter button
- Click button should increment count
- DevTools should be open

Press `Ctrl+C` to stop.

---

#### Day 4-5: Database Setup

**1. Create Database Schema**

```bash
cd packages/desktop

mkdir -p electron/database

cat > electron/database/schema.sql << 'EOF'
-- Locations Table
CREATE TABLE IF NOT EXISTS locs (
  -- Identity
  locid TEXT PRIMARY KEY,
  loc12 TEXT UNIQUE NOT NULL,

  -- Basic Info
  locnam TEXT NOT NULL,
  slocnam TEXT,
  akanam TEXT,

  -- Classification
  type TEXT,
  stype TEXT,

  -- GPS (Primary Source of Truth)
  gps_lat REAL,
  gps_lng REAL,
  gps_accuracy REAL,
  gps_source TEXT CHECK(gps_source IN ('user_map_click', 'photo_exif', 'geocoded_address', 'manual_entry', 'imported')),
  gps_verified_on_map INTEGER DEFAULT 0,
  gps_captured_at TEXT,
  gps_leaflet_data TEXT,

  -- Address (Secondary, Optional)
  address_street TEXT,
  address_city TEXT,
  address_county TEXT,
  address_state TEXT CHECK(length(address_state) = 2 OR address_state IS NULL),
  address_zipcode TEXT,
  address_confidence TEXT CHECK(address_confidence IN ('high', 'medium', 'low') OR address_confidence IS NULL),
  address_geocoded_at TEXT,

  -- Status
  condition TEXT,
  status TEXT,
  documentation TEXT,
  access TEXT,
  historic INTEGER DEFAULT 0,

  -- Relationships
  sublocs TEXT,
  sub12 TEXT,

  -- Metadata
  locadd TEXT NOT NULL,
  locup TEXT,
  auth_imp TEXT,

  -- Regions
  regions TEXT,
  state TEXT,

  UNIQUE(slocnam)
);

-- Indexes for locs
CREATE INDEX IF NOT EXISTS idx_locs_state ON locs(address_state);
CREATE INDEX IF NOT EXISTS idx_locs_type ON locs(type);
CREATE INDEX IF NOT EXISTS idx_locs_gps ON locs(gps_lat, gps_lng) WHERE gps_lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_locs_loc12 ON locs(loc12);

-- Sub-Locations Table
CREATE TABLE IF NOT EXISTS slocs (
  subid TEXT PRIMARY KEY,
  sub12 TEXT UNIQUE NOT NULL,
  locid TEXT NOT NULL REFERENCES locs(locid) ON DELETE CASCADE,
  subnam TEXT NOT NULL,
  ssubname TEXT,
  UNIQUE(subnam, locid)
);

CREATE INDEX IF NOT EXISTS idx_slocs_locid ON slocs(locid);

-- Images Table
CREATE TABLE IF NOT EXISTS imgs (
  imgsha TEXT PRIMARY KEY,
  imgnam TEXT NOT NULL,
  imgnamo TEXT NOT NULL,
  imgloc TEXT NOT NULL,
  imgloco TEXT NOT NULL,

  locid TEXT REFERENCES locs(locid) ON DELETE SET NULL,
  subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL,

  auth_imp TEXT,
  imgadd TEXT,

  meta_exiftool TEXT,
  meta_width INTEGER,
  meta_height INTEGER,
  meta_date_taken TEXT,
  meta_camera_make TEXT,
  meta_camera_model TEXT,
  meta_gps_lat REAL,
  meta_gps_lng REAL
);

CREATE INDEX IF NOT EXISTS idx_imgs_locid ON imgs(locid);
CREATE INDEX IF NOT EXISTS idx_imgs_subid ON imgs(subid);

-- Videos Table
CREATE TABLE IF NOT EXISTS vids (
  vidsha TEXT PRIMARY KEY,
  vidnam TEXT NOT NULL,
  vidnamo TEXT NOT NULL,
  vidloc TEXT NOT NULL,
  vidloco TEXT NOT NULL,

  locid TEXT REFERENCES locs(locid) ON DELETE SET NULL,
  subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL,

  auth_imp TEXT,
  vidadd TEXT,

  meta_ffmpeg TEXT,
  meta_exiftool TEXT,
  meta_duration REAL,
  meta_width INTEGER,
  meta_height INTEGER,
  meta_codec TEXT,
  meta_fps REAL,
  meta_date_taken TEXT
);

CREATE INDEX IF NOT EXISTS idx_vids_locid ON vids(locid);
CREATE INDEX IF NOT EXISTS idx_vids_subid ON vids(subid);

-- Documents Table
CREATE TABLE IF NOT EXISTS docs (
  docsha TEXT PRIMARY KEY,
  docnam TEXT NOT NULL,
  docnamo TEXT NOT NULL,
  docloc TEXT NOT NULL,
  docloco TEXT NOT NULL,

  locid TEXT REFERENCES locs(locid) ON DELETE SET NULL,
  subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL,

  auth_imp TEXT,
  docadd TEXT,

  meta_exiftool TEXT,
  meta_page_count INTEGER,
  meta_author TEXT,
  meta_title TEXT
);

CREATE INDEX IF NOT EXISTS idx_docs_locid ON docs(locid);

-- Maps Table
CREATE TABLE IF NOT EXISTS maps (
  mapsha TEXT PRIMARY KEY,
  mapnam TEXT NOT NULL,
  mapnamo TEXT NOT NULL,
  maploc TEXT NOT NULL,
  maploco TEXT NOT NULL,

  locid TEXT REFERENCES locs(locid) ON DELETE SET NULL,
  subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL,

  auth_imp TEXT,
  mapadd TEXT,

  meta_exiftool TEXT,
  meta_map TEXT,

  reference TEXT,
  map_states TEXT,
  map_verified INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_maps_locid ON maps(locid);

-- Settings/User Table
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('archive_folder', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('delete_on_import', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('current_user', 'default');
INSERT OR IGNORE INTO settings (key, value) VALUES ('db_version', '1');
EOF
```

**2. Create Database Connection Module**

```bash
cat > electron/database/connection.ts << 'EOF'
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) {
    return db;
  }

  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'auarchive.db');

  // Ensure directory exists
  fs.mkdirSync(userDataPath, { recursive: true });

  db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Initialize schema
  initializeSchema(db);

  return db;
}

function initializeSchema(db: Database.Database) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  // Execute schema
  db.exec(schema);

  console.log('Database initialized successfully');
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
EOF
```

**3. Update Main Process to Initialize DB**

```bash
cat > electron/main/index.ts << 'EOF'
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { getDatabase, closeDatabase } from '../database/connection';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  // Initialize database
  const db = getDatabase();
  console.log('Database ready');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, '../../resources/icons/abandoned-upstate-icon.png')
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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

app.on('will-quit', () => {
  closeDatabase();
});
EOF
```

**Checkpoint:** Run app and verify database is created
```bash
pnpm dev

# In another terminal, check if database was created:
# macOS/Linux:
ls -la ~/Library/Application\ Support/abandoned-upstate-archive/auarchive.db
# Or check console output for "Database ready"
```

---

### Week 2: Core Domain Models & Repository Pattern

#### Day 6-7: Core Domain Models

**1. Create Location Domain Model**

```bash
cd packages/core/src/domain

cat > location.ts << 'EOF'
import { z } from 'zod';
import slugify from 'slugify';

// GPS Coordinates Schema
export const GPSCoordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().optional(),
  source: z.enum(['user_map_click', 'photo_exif', 'geocoded_address', 'manual_entry', 'imported']),
  verifiedOnMap: z.boolean().default(false),
  capturedAt: z.string().datetime().optional(),
  leafletData: z.record(z.unknown()).optional()
});

export type GPSCoordinates = z.infer<typeof GPSCoordinatesSchema>;

// Address Schema
export const AddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  county: z.string().optional(),
  state: z.string().length(2).optional(),
  zipcode: z.string().regex(/^\d{5}(-\d{4})?$/).optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  geocodedAt: z.string().datetime().optional()
});

export type Address = z.infer<typeof AddressSchema>;

// Location Input Schema (for creating/updating)
export const LocationInputSchema = z.object({
  locnam: z.string().min(1).max(255),
  slocnam: z.string().max(12).optional(),
  akanam: z.string().optional(),
  type: z.string().optional(),
  stype: z.string().optional(),
  gps: GPSCoordinatesSchema.optional(),
  address: AddressSchema.optional(),
  condition: z.string().optional(),
  status: z.string().optional(),
  documentation: z.string().optional(),
  access: z.string().optional(),
  historic: z.boolean().default(false),
  auth_imp: z.string().optional()
});

export type LocationInput = z.infer<typeof LocationInputSchema>;

// Full Location Schema (from database)
export const LocationSchema = LocationInputSchema.extend({
  locid: z.string().uuid(),
  loc12: z.string().length(12),
  locadd: z.string().datetime(),
  locup: z.string().datetime().optional(),
  sublocs: z.array(z.string()).default([]),
  sub12: z.string().optional(),
  regions: z.array(z.string()).default([]),
  state: z.string().optional() // Legacy field
});

export type Location = z.infer<typeof LocationSchema>;

// GPS Confidence Type
export type GPSConfidence = 'verified' | 'high' | 'medium' | 'low' | 'none';

// Location class with business logic
export class LocationEntity {
  constructor(private readonly data: Location) {}

  // Generate short name from location name
  static generateShortName(name: string): string {
    const slug = slugify(name, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g
    });
    return slug.substring(0, 12);
  }

  // Generate 12-character unique ID
  static generateLoc12(uuid: string): string {
    // Take first 12 chars of UUID (remove hyphens)
    return uuid.replace(/-/g, '').substring(0, 12);
  }

  // Get GPS confidence level
  getGPSConfidence(): GPSConfidence {
    if (!this.data.gps) return 'none';

    const { source, verifiedOnMap, accuracy } = this.data.gps;

    if (verifiedOnMap && source === 'user_map_click') {
      return 'verified';
    }

    if (source === 'photo_exif' && accuracy && accuracy < 10) {
      return 'high';
    }

    if (source === 'geocoded_address') {
      return 'medium';
    }

    return 'low';
  }

  // Check if location needs map verification
  needsMapVerification(): boolean {
    return this.data.gps?.verifiedOnMap === false;
  }

  // Validate GPS coordinates are within reasonable bounds
  hasValidGPS(): boolean {
    if (!this.data.gps) return false;

    const { lat, lng } = this.data.gps;
    return (
      lat >= -90 && lat <= 90 &&
      lng >= -180 && lng <= 180
    );
  }

  // Get full address string
  getFullAddress(): string | null {
    const { address } = this.data;
    if (!address) return null;

    const parts = [
      address.street,
      address.city,
      address.state,
      address.zipcode
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(', ') : null;
  }

  // Get display name (with AKA if exists)
  getDisplayName(): string {
    if (this.data.akanam) {
      return `${this.data.locnam} (${this.data.akanam})`;
    }
    return this.data.locnam;
  }

  // Check if location is documented
  isDocumented(): boolean {
    return this.data.documentation !== 'No Visit / Keyboard Scout';
  }

  // Get raw data
  toJSON(): Location {
    return this.data;
  }
}
EOF
```

**2. Create Image/Video/Document Models**

```bash
cat > media.ts << 'EOF'
import { z } from 'zod';

// Base Media Schema
const BaseMediaSchema = z.object({
  locid: z.string().uuid().optional(),
  subid: z.string().uuid().optional(),
  auth_imp: z.string().optional()
});

// Image Schema
export const ImageSchema = BaseMediaSchema.extend({
  imgsha: z.string(),
  imgnam: z.string(),
  imgnamo: z.string(),
  imgloc: z.string(),
  imgloco: z.string(),
  imgadd: z.string().datetime(),
  meta_exiftool: z.record(z.unknown()).optional(),
  meta_width: z.number().optional(),
  meta_height: z.number().optional(),
  meta_date_taken: z.string().datetime().optional(),
  meta_camera_make: z.string().optional(),
  meta_camera_model: z.string().optional(),
  meta_gps_lat: z.number().optional(),
  meta_gps_lng: z.number().optional()
});

export type Image = z.infer<typeof ImageSchema>;

// Video Schema
export const VideoSchema = BaseMediaSchema.extend({
  vidsha: z.string(),
  vidnam: z.string(),
  vidnamo: z.string(),
  vidloc: z.string(),
  vidloco: z.string(),
  vidadd: z.string().datetime(),
  meta_ffmpeg: z.record(z.unknown()).optional(),
  meta_exiftool: z.record(z.unknown()).optional(),
  meta_duration: z.number().optional(),
  meta_width: z.number().optional(),
  meta_height: z.number().optional(),
  meta_codec: z.string().optional(),
  meta_fps: z.number().optional(),
  meta_date_taken: z.string().datetime().optional()
});

export type Video = z.infer<typeof VideoSchema>;

// Document Schema
export const DocumentSchema = BaseMediaSchema.extend({
  docsha: z.string(),
  docnam: z.string(),
  docnamo: z.string(),
  docloc: z.string(),
  docloco: z.string(),
  docadd: z.string().datetime(),
  meta_exiftool: z.record(z.unknown()).optional(),
  meta_page_count: z.number().optional(),
  meta_author: z.string().optional(),
  meta_title: z.string().optional()
});

export type Document = z.infer<typeof DocumentSchema>;

// Map Schema
export const MapSchema = BaseMediaSchema.extend({
  mapsha: z.string(),
  mapnam: z.string(),
  mapnamo: z.string(),
  maploc: z.string(),
  maploco: z.string(),
  mapadd: z.string().datetime(),
  meta_exiftool: z.record(z.unknown()).optional(),
  meta_map: z.record(z.unknown()).optional(),
  reference: z.string().optional(),
  map_states: z.string().optional(),
  map_verified: z.boolean().default(false)
});

export type Map = z.infer<typeof MapSchema>;
EOF
```

**3. Create Index File**

```bash
cat > index.ts << 'EOF'
export * from './location';
export * from './media';
EOF
```

**Checkpoint:** Build core package
```bash
cd packages/core
pnpm build

# Should compile without errors
ls dist/  # Should see compiled .js and .d.ts files
```

---

#### Day 8-10: Repository Pattern

**1. Create Repository Interfaces**

```bash
cd packages/core/src/repositories

cat > location-repository.ts << 'EOF'
import { Location, LocationInput } from '../domain';

export interface LocationFilters {
  state?: string;
  type?: string;
  hasGPS?: boolean;
  documented?: boolean;
  search?: string;
}

export interface LocationRepository {
  create(input: LocationInput): Promise<Location>;
  findById(id: string): Promise<Location | null>;
  findAll(filters?: LocationFilters): Promise<Location[]>;
  update(id: string, input: Partial<LocationInput>): Promise<Location>;
  delete(id: string): Promise<void>;
  count(filters?: LocationFilters): Promise<number>;
}
EOF
```

**2. Implement SQLite Repository**

```bash
cd packages/desktop/electron/repositories

cat > sqlite-location-repository.ts << 'EOF'
import type { Database } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { LocationRepository, LocationFilters } from '@au-archive/core/repositories';
import { Location, LocationInput, LocationEntity } from '@au-archive/core/domain';

export class SQLiteLocationRepository implements LocationRepository {
  constructor(private readonly db: Database) {}

  async create(input: LocationInput): Promise<Location> {
    const locid = randomUUID();
    const loc12 = LocationEntity.generateLoc12(locid);
    const slocnam = input.slocnam || LocationEntity.generateShortName(input.locnam);
    const locadd = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO locs (
        locid, loc12, locnam, slocnam, akanam, type, stype,
        gps_lat, gps_lng, gps_accuracy, gps_source, gps_verified_on_map,
        gps_captured_at, gps_leaflet_data,
        address_street, address_city, address_county, address_state,
        address_zipcode, address_confidence, address_geocoded_at,
        condition, status, documentation, access, historic,
        locadd, auth_imp
      ) VALUES (
        @locid, @loc12, @locnam, @slocnam, @akanam, @type, @stype,
        @gps_lat, @gps_lng, @gps_accuracy, @gps_source, @gps_verified_on_map,
        @gps_captured_at, @gps_leaflet_data,
        @address_street, @address_city, @address_county, @address_state,
        @address_zipcode, @address_confidence, @address_geocoded_at,
        @condition, @status, @documentation, @access, @historic,
        @locadd, @auth_imp
      )
    `);

    stmt.run({
      locid,
      loc12,
      locnam: input.locnam,
      slocnam,
      akanam: input.akanam || null,
      type: input.type || null,
      stype: input.stype || null,
      gps_lat: input.gps?.lat || null,
      gps_lng: input.gps?.lng || null,
      gps_accuracy: input.gps?.accuracy || null,
      gps_source: input.gps?.source || null,
      gps_verified_on_map: input.gps?.verifiedOnMap ? 1 : 0,
      gps_captured_at: input.gps?.capturedAt || null,
      gps_leaflet_data: input.gps?.leafletData ? JSON.stringify(input.gps.leafletData) : null,
      address_street: input.address?.street || null,
      address_city: input.address?.city || null,
      address_county: input.address?.county || null,
      address_state: input.address?.state || null,
      address_zipcode: input.address?.zipcode || null,
      address_confidence: input.address?.confidence || null,
      address_geocoded_at: input.address?.geocodedAt || null,
      condition: input.condition || null,
      status: input.status || null,
      documentation: input.documentation || null,
      access: input.access || null,
      historic: input.historic ? 1 : 0,
      locadd,
      auth_imp: input.auth_imp || null
    });

    return this.findById(locid) as Promise<Location>;
  }

  async findById(id: string): Promise<Location | null> {
    const stmt = this.db.prepare('SELECT * FROM locs WHERE locid = ?');
    const row = stmt.get(id) as any;

    if (!row) return null;

    return this.mapRowToLocation(row);
  }

  async findAll(filters?: LocationFilters): Promise<Location[]> {
    let query = 'SELECT * FROM locs WHERE 1=1';
    const params: any[] = [];

    if (filters?.state) {
      query += ' AND address_state = ?';
      params.push(filters.state);
    }

    if (filters?.type) {
      query += ' AND type = ?';
      params.push(filters.type);
    }

    if (filters?.hasGPS) {
      query += ' AND gps_lat IS NOT NULL AND gps_lng IS NOT NULL';
    }

    if (filters?.search) {
      query += ' AND (locnam LIKE ? OR akanam LIKE ?)';
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    query += ' ORDER BY locadd DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => this.mapRowToLocation(row));
  }

  async update(id: string, input: Partial<LocationInput>): Promise<Location> {
    const locup = new Date().toISOString();

    // Build dynamic UPDATE query based on provided fields
    const updates: string[] = ['locup = @locup'];
    const params: any = { locid: id, locup };

    if (input.locnam !== undefined) {
      updates.push('locnam = @locnam');
      params.locnam = input.locnam;
    }

    if (input.slocnam !== undefined) {
      updates.push('slocnam = @slocnam');
      params.slocnam = input.slocnam;
    }

    if (input.gps !== undefined) {
      updates.push('gps_lat = @gps_lat', 'gps_lng = @gps_lng');
      params.gps_lat = input.gps.lat;
      params.gps_lng = input.gps.lng;
      // ... add other GPS fields
    }

    // ... add other fields as needed

    const query = `UPDATE locs SET ${updates.join(', ')} WHERE locid = @locid`;
    const stmt = this.db.prepare(query);
    stmt.run(params);

    return this.findById(id) as Promise<Location>;
  }

  async delete(id: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM locs WHERE locid = ?');
    stmt.run(id);
  }

  async count(filters?: LocationFilters): Promise<number> {
    let query = 'SELECT COUNT(*) as count FROM locs WHERE 1=1';
    const params: any[] = [];

    if (filters?.state) {
      query += ' AND address_state = ?';
      params.push(filters.state);
    }

    // ... add other filters

    const stmt = this.db.prepare(query);
    const result = stmt.get(...params) as { count: number };
    return result.count;
  }

  private mapRowToLocation(row: any): Location {
    return {
      locid: row.locid,
      loc12: row.loc12,
      locnam: row.locnam,
      slocnam: row.slocnam,
      akanam: row.akanam,
      type: row.type,
      stype: row.stype,
      gps: row.gps_lat && row.gps_lng ? {
        lat: row.gps_lat,
        lng: row.gps_lng,
        accuracy: row.gps_accuracy,
        source: row.gps_source,
        verifiedOnMap: row.gps_verified_on_map === 1,
        capturedAt: row.gps_captured_at,
        leafletData: row.gps_leaflet_data ? JSON.parse(row.gps_leaflet_data) : undefined
      } : undefined,
      address: {
        street: row.address_street,
        city: row.address_city,
        county: row.address_county,
        state: row.address_state,
        zipcode: row.address_zipcode,
        confidence: row.address_confidence,
        geocodedAt: row.address_geocoded_at
      },
      condition: row.condition,
      status: row.status,
      documentation: row.documentation,
      access: row.access,
      historic: row.historic === 1,
      sublocs: row.sublocs ? JSON.parse(row.sublocs) : [],
      sub12: row.sub12,
      locadd: row.locadd,
      locup: row.locup,
      auth_imp: row.auth_imp,
      regions: row.regions ? JSON.parse(row.regions) : [],
      state: row.state
    };
  }
}
EOF
```

**Checkpoint:** This completes Phase 1 foundation!

---

## UI: Phase 2: UI Foundation (Week 3)

### Week 3: Navigation & Basic Pages

#### Day 11-12: App Layout & Routing

**1. Install Skeleton UI**

```bash
cd packages/desktop

pnpm add @skeletonlabs/skeleton @skeletonlabs/tw-plugin
```

**2. Update Tailwind Config**

```bash
cat > tailwind.config.js << 'EOF'
import { skeleton } from '@skeletonlabs/tw-plugin';

export default {
  content: [
    './src/**/*.{html,js,svelte,ts}',
    './node_modules/@skeletonlabs/skeleton/**/*.{html,js,svelte,ts}'
  ],
  theme: {
    extend: {
      colors: {
        accent: '#b9975c',
        background: '#fffbf7',
        foreground: '#454545'
      }
    }
  },
  plugins: [
    skeleton({
      themes: { preset: ['skeleton'] }
    })
  ]
};
EOF
```

**3. Create Simple Router**

```bash
mkdir -p src/lib

cat > src/lib/router.ts << 'EOF'
import { writable } from 'svelte/store';

export type Route =
  | '/dashboard'
  | '/locations'
  | '/atlas'
  | '/imports'
  | '/settings'
  | `/location/${string}`;

export const currentRoute = writable<Route>('/dashboard');

export function navigate(route: Route) {
  currentRoute.set(route);
}
EOF
```

**4. Create App Shell**

```bash
cat > src/App.svelte << 'EOF'
<script lang="ts">
  import './app.css';
  import { currentRoute, navigate } from './lib/router';
  import Dashboard from './pages/Dashboard.svelte';
  import Locations from './pages/Locations.svelte';
  import Atlas from './pages/Atlas.svelte';
  import Imports from './pages/Imports.svelte';
  import Settings from './pages/Settings.svelte';

  const menuItems = [
    { route: '/dashboard', label: 'Dashboard', icon: 'STATS:' },
    { route: '/locations', label: 'Locations', icon: 'LOCATION:' },
    { route: '/atlas', label: 'Atlas', icon: 'MAP:' },
    { route: '/imports', label: 'Imports', icon: '📥' },
    { route: '/settings', label: 'Settings', icon: '⚙️' }
  ];
</script>

<div class="flex h-screen bg-background">
  <!-- Left Sidebar -->
  <aside class="w-64 bg-foreground text-background flex flex-col">
    <div class="p-4">
      <h1 class="text-xl font-bold text-accent">Abandoned Upstate</h1>
      <p class="text-sm opacity-75">Archive v0.1.0</p>
    </div>

    <nav class="flex-1 px-2">
      {#each menuItems as item}
        <button
          class="w-full text-left px-4 py-3 rounded hover:bg-accent hover:text-foreground transition-colors mb-1"
          class:bg-accent={$currentRoute === item.route}
          class:text-foreground={$currentRoute === item.route}
          onclick={() => navigate(item.route)}
        >
          <span class="mr-2">{item.icon}</span>
          {item.label}
        </button>
      {/each}
    </nav>
  </aside>

  <!-- Main Content -->
  <main class="flex-1 overflow-auto">
    {#if $currentRoute === '/dashboard'}
      <Dashboard />
    {:else if $currentRoute === '/locations'}
      <Locations />
    {:else if $currentRoute === '/atlas'}
      <Atlas />
    {:else if $currentRoute === '/imports'}
      <Imports />
    {:else if $currentRoute === '/settings'}
      <Settings />
    {/if}
  </main>
</div>
EOF
```

**5. Create Placeholder Pages**

```bash
mkdir -p src/pages

# Dashboard
cat > src/pages/Dashboard.svelte << 'EOF'
<script lang="ts">
  let message = 'Welcome to Abandoned Upstate Archive';
</script>

<div class="p-8">
  <h1 class="text-3xl font-bold mb-4">Dashboard</h1>
  <p>{message}</p>
</div>
EOF

# Locations
cat > src/pages/Locations.svelte << 'EOF'
<div class="p-8">
  <h1 class="text-3xl font-bold mb-4">Locations</h1>
  <p>Location list will appear here</p>
</div>
EOF

# Atlas
cat > src/pages/Atlas.svelte << 'EOF'
<div class="p-8">
  <h1 class="text-3xl font-bold mb-4">Atlas</h1>
  <p>Map will appear here</p>
</div>
EOF

# Imports
cat > src/pages/Imports.svelte << 'EOF'
<div class="p-8">
  <h1 class="text-3xl font-bold mb-4">Imports</h1>
  <p>Import interface will appear here</p>
</div>
EOF

# Settings
cat > src/pages/Settings.svelte << 'EOF'
<div class="p-8">
  <h1 class="text-3xl font-bold mb-4">Settings</h1>
  <p>Settings will appear here</p>
</div>
EOF
```

**Checkpoint:** Run app and test navigation
```bash
pnpm dev
# Click through all menu items, verify pages load
```

---

## LOCATION: Phase 3: Mapping (Weeks 4-5)

### Week 4: Leaflet Integration

*[Continued with detailed implementation steps for Leaflet, GPS features, IPC communication, etc.]*

---

## NOTE: SUMMARY

This implementation plan provides:

PASS: **Weeks 1-2**: Foundation (monorepo, database, domain models)
PASS: **Week 3**: UI foundation (routing, layout, basic pages)
PASS: **Weeks 4-5**: Mapping with Leaflet + GPS-first workflow
PASS: **Weeks 6-7**: Media import + metadata extraction
PASS: **Weeks 8-10**: Full CRUD operations + file organization
PASS: **Weeks 11-12**: Polish + advanced features
PASS: **Weeks 13-14**: Testing + deployment

**Total:** ~350 hours of development work over 14 weeks.

---

**Next Steps:**
1. Review this plan
2. Confirm timeline is realistic
3. Begin with Week 1, Day 1
4. Checkpoint after each major milestone
