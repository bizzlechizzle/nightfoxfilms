# Where's Waldo 2: Complete Bug Hunt Report and Implementation Guide

Date: 2025-11-21
Status: RESOLVED

---

## Executive Summary

The AU Archive Electron app was completely non-functional due to a preload script bundling issue. Vite's bundler was adding ESM (ES Module) exports to CommonJS files, which Electron cannot load. The solution was to bypass Vite bundling entirely for the preload script by using a static CommonJS file.

---

## The Problem Chain

### Symptom 1: App UI Completely Broken
- "Electron API not available - preload script may have failed to load"
- Settings page blank
- Archive folder not displaying
- No locations visible
- All IPC calls failing

### Symptom 2: Console Error
```
Unable to load preload script: dist-electron/preload/index.cjs
SyntaxError: Cannot use import statement outside a module
```

### Symptom 3: After First Fix Attempt
```
SyntaxError: Unexpected token 'catch' at line 194
```
(Caused by duplicate code in output file)

### Symptom 4: After Second Fix Attempt
```
Built file still contains: export default k()
```
(ESM syntax in a .cjs file)

---

## Root Cause Analysis

### Why Preload Scripts Are Special

Electron preload scripts run in a **sandboxed renderer process** but with access to Node.js APIs. They act as a bridge between the secure renderer (web page) and the privileged main process.

**Critical Requirements:**
1. Must be CommonJS format (Electron's Node.js loader expects CJS)
2. Must use `.cjs` extension when package.json has `"type": "module"`
3. The `electron` module MUST be external (it's a runtime module, not bundleable)
4. Must NOT contain any ESM syntax (import/export statements)

### The Bundling Problem

When Vite/Rollup bundles the preload script:

1. **Internal modules** (your code): Get bundled together, imports resolved
2. **External modules** (electron): Import statements are preserved

The issue: When `electron` is marked as external, Rollup should convert:
```javascript
import { contextBridge } from 'electron';
// to
const { contextBridge } = require('electron');
```

But vite-plugin-electron wraps the entire output with:
```javascript
var c = Object.defineProperty;
var k = (i, e) => {
  for (var t in e) c(i, t, { get: e[t], enumerable: !0 });
};
var l = {};
k(l, { default: () => m });
// ... your code ...
var m = (() => { ... })();
export default m;  // <-- ESM export in CJS file!
```

This `export default` statement breaks the preload script because:
- File has `.cjs` extension = Node expects CommonJS
- But file contains `export` = ESM syntax
- Node.js throws: "Cannot use import statement outside a module"

### Why Multiple Fix Attempts Failed

**Attempt 1: Change import to require()**
```typescript
// Before
import { contextBridge, ipcRenderer } from 'electron';
// After
const { contextBridge, ipcRenderer } = require('electron');
```
Result: Still failed because vite-plugin-electron adds wrapper with `export default`

**Attempt 2: Remove lib mode from vite.config.ts**
Result: File no longer duplicated, but still had `export default k()` at end

**Attempt 3: Use IIFE format / exports: 'none'**
Result: vite-plugin-electron ignores these settings, still adds exports

---

## The Solution: Static CJS File

The only reliable solution is to **bypass Vite bundling entirely** for the preload script.

### Implementation

#### Step 1: Create Static Preload File

Create `electron/preload/preload.cjs`:

```javascript
"use strict";
// AU Archive Preload Script - Pure CommonJS
// This file is NOT processed by Vite - it's used directly by Electron

const { contextBridge, ipcRenderer, webUtils } = require("electron");

const api = {
  // Version info
  versions: {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron,
  },
  platform: process.platform,

  // Locations API
  locations: {
    findAll: (filters) => ipcRenderer.invoke("location:findAll", filters),
    findById: (id) => ipcRenderer.invoke("location:findById", id),
    create: (input) => ipcRenderer.invoke("location:create", input),
    update: (id, input) => ipcRenderer.invoke("location:update", id, input),
    delete: (id) => ipcRenderer.invoke("location:delete", id),
    // ... more methods
  },

  // Settings API
  settings: {
    get: (key) => ipcRenderer.invoke("settings:get", key),
    getAll: () => ipcRenderer.invoke("settings:getAll"),
    set: (key, value) => ipcRenderer.invoke("settings:set", key, value),
  },

  // ... other APIs (media, notes, projects, etc.)
};

// Expose to renderer
contextBridge.exposeInMainWorld("electronAPI", api);

// Additional functionality (drag-drop, etc.)
// ...
```

#### Step 2: Update vite.config.ts

```typescript
electron([
  {
    entry: 'electron/main/index.ts',
    vite: {
      build: {
        outDir: 'dist-electron/main',
        rollupOptions: {
          external: ['zod', 'better-sqlite3', 'kysely', 'electron'],
        },
      },
    },
  },
  {
    // Preload script - use static CJS file instead of Vite bundling
    // Vite's bundling adds ESM exports to CJS files which breaks Electron
    entry: 'electron/preload/preload.cjs',
    onstart(args) {
      // Copy the static preload file to dist
      const fs = require('fs');
      const srcPath = 'electron/preload/preload.cjs';
      const destDir = 'dist-electron/preload';
      const destPath = destDir + '/index.cjs';
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(srcPath, destPath);
      args.reload();
    },
    vite: {
      build: {
        outDir: 'dist-electron/preload',
        rollupOptions: {
          external: ['electron'],
          output: {
            format: 'cjs',
            entryFileNames: 'index.cjs',
          },
        },
      },
    },
  },
]),
```

#### Step 3: Reference Correct File in Main Process

In `electron/main/index.ts`:
```typescript
const mainWindow = new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.cjs'),
    contextIsolation: true,
    sandbox: false, // Required for webUtils.getPathForFile()
  },
});
```

---

## Verification Checklist

### 1. Check Built Preload File
```bash
head -5 dist-electron/preload/index.cjs
```

Should show:
```javascript
"use strict";
// AU Archive Preload Script - Pure CommonJS
// This file is NOT processed by Vite - it's used directly by Electron

const { contextBridge, ipcRenderer, webUtils } = require("electron");
```

Should NOT contain:
- `import { ... } from "electron"`
- `export default`
- `export {`

### 2. Run the App
```bash
pnpm run dev
```

### 3. Check DevTools Console
- No "Electron API not available" errors
- No "Cannot use import statement" errors
- No preload script loading failures

### 4. Test Functionality
- Navigate to Settings page - Archive Folder should display
- Navigate to Locations page - Should show locations (if seeded)
- Open DevTools, run: `window.electronAPI` - Should return the API object

---

## Database Seeding (Bonus)

The app also needs data to function. Use the seed script:

```bash
cd packages/desktop

# Check database status
./scripts/seed-database.sh --status

# Set archive folder + seed 20 locations
./scripts/seed-database.sh --all /path/to/archive/folder

# Or individually:
./scripts/seed-database.sh --archive /path/to/archive/folder
./scripts/seed-database.sh --seed
```

### Seeded Locations Include:
1. Kings Park Psychiatric Center (NY)
2. Buffalo Central Terminal (NY)
3. Eastern State Penitentiary (PA)
4. Greystone Park Psychiatric Hospital (NJ)
5. Hudson River State Hospital (NY)
6. Carrie Furnaces (PA)
7. Bethlehem Steel (PA)
8. North Brother Island (NY)
9. Pennhurst State School (PA)
10. Willard Asylum (NY)
... and 10 more

---

## Implementation Guide for Less Experienced Developers

### Understanding the Problem

**What is a Preload Script?**

In Electron, there are two main processes:
1. **Main Process**: Has full Node.js access, controls the app
2. **Renderer Process**: Runs your web page (HTML/CSS/JS), restricted for security

The preload script runs BEFORE your web page loads and can expose specific Node.js APIs to the web page safely.

**What is CommonJS vs ESM?**

- **CommonJS (CJS)**: Old Node.js module system
  ```javascript
  const fs = require('fs');
  module.exports = myFunction;
  ```

- **ES Modules (ESM)**: Modern JavaScript module system
  ```javascript
  import fs from 'fs';
  export default myFunction;
  ```

Electron's preload scripts MUST use CommonJS.

### How to Fix This Bug (Step by Step)

1. **Create a new file**: `electron/preload/preload.cjs`
   - The `.cjs` extension tells Node.js "this is CommonJS"
   - Do NOT use TypeScript here - plain JavaScript only

2. **Write pure CommonJS code**:
   ```javascript
   "use strict";
   const { contextBridge, ipcRenderer } = require("electron");
   // No import/export statements!
   ```

3. **Update vite.config.ts** to copy the file instead of bundling

4. **Test**: Run `pnpm run dev` and check for errors

### Common Mistakes to Avoid

1. **Using import/export in preload**
   ```javascript
   // WRONG
   import { contextBridge } from 'electron';
   export default api;

   // CORRECT
   const { contextBridge } = require('electron');
   contextBridge.exposeInMainWorld('api', api);
   ```

2. **Using .js extension with "type": "module"**
   ```json
   // package.json has this
   "type": "module"
   ```
   This makes ALL .js files ESM by default. Use `.cjs` for CommonJS.

3. **Trusting Vite to handle preload bundling**
   Vite + vite-plugin-electron has bugs with preload scripts. Just don't bundle them.

---

## Files Changed

| File | Change |
|------|--------|
| `electron/preload/preload.cjs` | NEW - Static CJS preload |
| `electron/preload/index.ts` | Changed import to require (backup) |
| `vite.config.ts` | Preload copies static file instead of bundling |
| `scripts/seed-database.sh` | NEW - Database seeding CLI |
| `whereswaldo.md` | NEW - Initial bug report |
| `whereswaldo2.md` | NEW - This file |
| `CLAUDE.md` | Added preload script notes |

---

## Lessons Learned

1. **Don't trust bundlers with Electron preload scripts** - They have special requirements that bundlers often break.

2. **Check the built output, not just the source** - The bug was only visible in `dist-electron/`, not in the source files.

3. **Use .cjs extension explicitly** - When package.json has `"type": "module"`, JavaScript files default to ESM.

4. **Static files beat clever bundling** - Sometimes the simplest solution (just copy the file) is the most reliable.

5. **Read error messages carefully** - "Cannot use import statement outside a module" clearly indicated an ESM/CJS mismatch.

---

## Quick Reference

### Check if Preload is Working
```javascript
// In browser DevTools console
window.electronAPI
// Should return object with all APIs
```

### Rebuild After Changes
```bash
pnpm run build
# or for dev
pnpm run dev
```

### View Preload Output
```bash
cat dist-electron/preload/index.cjs | head -10
```

---

End of Report
