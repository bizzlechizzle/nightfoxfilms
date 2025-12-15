# Where's Waldo: AU Archive Bug Hunt Report

Date: 2025-11-21
Status: RESOLVED

## The Problem

The app was completely non-functional. The Settings page showed nothing, the database appeared empty, and no API calls worked.

### Symptoms
- "Electron API not available - preload script may have failed to load" errors everywhere
- Settings page blank
- Archive folder not displaying
- No locations visible
- All pages failing to load data

### Console Error
```
Unable to load preload script: /Users/bryant/Documents/au archive /packages/desktop/dist-electron/preload/index.cjs

SyntaxError: Cannot use import statement outside a module
    at new Script (node:vm:94:7)
```

## Root Cause Analysis

### Primary Bug: Preload Script ESM/CJS Mismatch

**Location:** `electron/preload/index.ts` line 1

**The Bug:**
```typescript
import { contextBridge, ipcRenderer, webUtils } from 'electron';
```

**Why It Failed:**
1. The Vite config marks `electron` as **external** (it must be, since it's a runtime module)
2. When a module is external, Rollup does NOT transform its import statements
3. The file is saved as `.cjs` (CommonJS), but contains ESM `import` syntax
4. Node.js sees `.cjs` extension and expects CommonJS
5. Node.js throws "Cannot use import statement outside a module"

**The Fix:**
```typescript
const { contextBridge, ipcRenderer, webUtils } = require('electron');
```

### Secondary Issue: Empty Database

The database existed but had 0 records:
- 0 settings (no `archive_folder`)
- 0 locations
- 0 users (migration creates default user on first run)

This was a data issue, not a code issue. The database schema was correct.

## Files Changed

### 1. electron/preload/index.ts

**Before:**
```typescript
import { contextBridge, ipcRenderer, webUtils } from 'electron';
```

**After:**
```typescript
// CRITICAL: Use require() for electron in preload scripts
// ESM imports don't get converted to require() when electron is external
// This causes "Cannot use import statement outside a module" errors
const { contextBridge, ipcRenderer, webUtils } = require('electron');
```

## Build Verification

After fix, the built preload file starts with proper CommonJS:
```javascript
"use strict";const{contextBridge:r,ipcRenderer:o,webUtils:c}=require("electron")
```

## Database Seeding

Created CLI tool at `packages/desktop/scripts/seed-database.sh`:

```bash
# Check database status
./scripts/seed-database.sh --status

# Seed everything (archive folder + 20 locations)
./scripts/seed-database.sh --all /path/to/archive

# Set archive folder only
./scripts/seed-database.sh --archive /path/to/archive

# Seed 20 test locations only
./scripts/seed-database.sh --seed

# Clear all data
./scripts/seed-database.sh --clear
```

### Test Locations Seeded
20 abandoned locations including:
- Kings Park Psychiatric Center (NY)
- Buffalo Central Terminal (NY)
- Eastern State Penitentiary (PA)
- Greystone Park Psychiatric Hospital (NJ)
- Hudson River State Hospital (NY)
- And 15 more...

## Technical Deep Dive

### Why ESM imports fail for external modules in CJS output

When Vite/Rollup bundles code:

1. **Internal modules**: Import statements are resolved and bundled together
2. **External modules**: Import statements are preserved as-is

For external modules with `format: 'cjs'`:
- Rollup SHOULD convert `import { x } from 'y'` to `const { x } = require('y')`
- But for some reason with vite-plugin-electron, it doesn't always work
- Using `require()` directly bypasses this issue entirely

### Electron Preload Script Requirements

1. Must be CommonJS format (Electron loads it with Node.js CJS loader)
2. Must use `.cjs` extension if package.json has `"type": "module"`
3. `electron` module must be external (it's a runtime module)
4. Use `require('electron')` instead of `import from 'electron'`

## Verification Steps

1. Build the app: `pnpm run build`
2. Check preload output: `head -1 dist-electron/preload/index.cjs`
   - Should start with `"use strict";const{...}=require("electron")`
   - Should NOT contain `import { ... } from "electron"`
3. Run the app: `pnpm run dev`
4. Open DevTools console - should have no preload errors
5. Navigate to Settings - should show Archive Folder field
6. Navigate to Locations - should show 20 seeded locations

## Lessons Learned

1. **Always use require() for electron in preload scripts** - ESM imports are unreliable
2. **Check the built output, not just the source** - The bug was only visible in dist-electron/
3. **Empty database != broken code** - Verify data exists before assuming code is broken
4. **Read console errors carefully** - "Cannot use import statement" clearly pointed to ESM/CJS issue
