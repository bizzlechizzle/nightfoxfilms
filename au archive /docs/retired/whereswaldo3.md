# Where's Waldo 3: The Final Fix

Date: 2025-11-21
Status: RESOLVED

---

## What Failed in Round 2

### The Problem with onstart Hook

In whereswaldo2.md, we tried using vite-plugin-electron's `onstart` hook to copy the static preload file:

```typescript
{
  entry: 'electron/preload/preload.cjs',
  onstart(args) {
    fs.copyFileSync(srcPath, destPath);
    args.reload();
  },
}
```

**Why it failed:** The `onstart` hook runs AFTER Vite has already bundled the file. By the time our copy runs, Vite has already transformed the .cjs file and written it to disk with ESM syntax.

### Evidence

Built output showed:
```javascript
import require$$0 from "electron";  // ESM import added by Vite
var preload = {};
const { contextBridge, ipcRenderer, webUtils } = require$$0;
```

Our source file was correct CommonJS, but Vite transformed it before our hook ran.

---

## The Root Cause (Final Answer)

### vite-plugin-electron ALWAYS Transforms Entry Files

No matter what settings you use:
- `format: 'cjs'` - ignored, adds ESM wrapper anyway
- `exports: 'none'` - ignored
- `exports: 'auto'` - ignored
- Using `.cjs` extension - ignored
- Using `onstart` hook - runs too late

The plugin transforms ALL entry files through Rollup/Vite bundling, which wraps them in ESM-compatible code including `import` statements for externalized modules.

### Why Electron Rejects This

Electron's preload script loader uses Node.js CommonJS module loader:
1. Sees `.cjs` extension
2. Expects pure CommonJS (no import/export)
3. Finds `import require$$0 from "electron"`
4. Throws: "Cannot use import statement outside a module"

---

## The Solution: Don't Use vite-plugin-electron for Preload

### Implementation

Created a custom Vite plugin that copies the preload file WITHOUT any bundling:

```typescript
function copyPreloadPlugin(): Plugin {
  const srcPath = path.resolve(__dirname, 'electron/preload/preload.cjs');
  const destDir = path.resolve(__dirname, 'dist-electron/preload');
  const destPath = path.join(destDir, 'index.cjs');

  function copyPreload() {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(srcPath, destPath);
    console.log('[preload] Copied static preload.cjs');
  }

  return {
    name: 'copy-preload',
    buildStart() {
      copyPreload();
    },
    configureServer(server) {
      copyPreload();
      server.watcher.add(srcPath);
      server.watcher.on('change', (changedPath) => {
        if (changedPath === srcPath) {
          copyPreload();
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
  };
}
```

### Key Changes to vite.config.ts

1. **Import fs module** at top level
2. **Create copyPreloadPlugin()** function
3. **Add plugin BEFORE electron()** in plugins array
4. **Remove preload entry** from electron() config

Before:
```typescript
electron([
  { entry: 'electron/main/index.ts', ... },
  { entry: 'electron/preload/preload.cjs', onstart() {...}, ... },
])
```

After:
```typescript
copyPreloadPlugin(),  // Custom plugin - no bundling
electron([
  { entry: 'electron/main/index.ts', ... },
  // NO preload entry
])
```

---

## Verification

### Check Built Output
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

### Check for ESM Syntax
```bash
grep -E "^import |^export " dist-electron/preload/index.cjs
```

Should return nothing (no matches).

---

## Timeline of Fixes

| Round | Approach | Result |
|-------|----------|--------|
| 1 | Change `import` to `require()` in source | Failed - Vite still adds ESM wrapper |
| 2 | Use `onstart` hook to copy static file | Failed - Hook runs after transformation |
| 3 | Remove from vite-plugin-electron, use custom copy plugin | **SUCCESS** |

---

## Files Changed in Round 3

| File | Change |
|------|--------|
| `vite.config.ts` | Added copyPreloadPlugin(), removed preload entry from electron() |

---

## Lessons Learned

1. **vite-plugin-electron is opinionated** - It will transform files whether you want it to or not.

2. **Hooks run post-build** - The `onstart` hook is for post-processing, not preventing transformation.

3. **Sometimes the simplest solution wins** - A file copy is simpler and more reliable than fighting a bundler.

4. **Electron preload has strict requirements** - Must be pure CommonJS, no ESM syntax anywhere.

5. **Test the actual output, not the config** - Config might look correct but produce wrong output.

---

## How to Maintain This

### If You Need to Modify the Preload Script

1. Edit `electron/preload/preload.cjs`
2. Keep it pure CommonJS:
   - Use `require()` not `import`
   - Use `module.exports` not `export`
3. The custom plugin will auto-copy on save (in dev mode)

### If You Need to Add IPC Methods

1. Add handler in `electron/main/ipc-handlers.ts`
2. Add method in `electron/preload/preload.cjs` API object
3. TypeScript types: Update `src/types/electron.d.ts`

### If vite-plugin-electron Gets Fixed

Future versions might properly handle CJS preload scripts. To test:
1. Remove `copyPreloadPlugin()` from config
2. Add back preload entry to electron() config
3. Build and check output for ESM syntax
4. If clean, you can remove the custom plugin

---

## Sources

- [electron-vite Troubleshooting](https://electron-vite.org/guide/troubleshooting)
- [ES Modules in Electron](https://www.electronjs.org/docs/latest/tutorial/esm)
- [vite-plugin-electron Issues #199](https://github.com/electron-vite/vite-plugin-electron/issues/199)

---

End of Report
