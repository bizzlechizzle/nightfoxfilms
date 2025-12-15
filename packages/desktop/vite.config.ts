import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';
import fs from 'fs';

/**
 * Custom plugin to copy preload script WITHOUT any bundling/transformation.
 *
 * WHY THIS EXISTS:
 * vite-plugin-electron always transforms entry files, adding ESM syntax
 * like "import require$$0 from 'electron'" even to .cjs files.
 * This breaks Electron preload scripts which MUST be pure CommonJS.
 *
 * SOLUTION:
 * Don't use vite-plugin-electron for preload at all.
 * Just copy the static .cjs file directly to dist-electron/preload/
 */
function copyPreloadPlugin(): Plugin {
  const srcPath = path.resolve(__dirname, 'electron/preload/preload.cjs');
  const destDir = path.resolve(__dirname, 'dist-electron/preload');
  const destPath = path.join(destDir, 'index.cjs');

  function copyPreload() {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      console.log('[preload] Copied static preload.cjs to dist-electron/preload/index.cjs');
    }
  }

  return {
    name: 'copy-preload',
    // Copy on build start
    buildStart() {
      copyPreload();
    },
    // Watch for changes in dev mode
    configureServer(server) {
      // Initial copy
      copyPreload();
      // Watch for changes
      server.watcher.add(srcPath);
      server.watcher.on('change', (changedPath) => {
        if (changedPath === srcPath) {
          copyPreload();
          // Trigger electron reload by touching main
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    svelte(),
    // Copy preload FIRST, before electron plugin runs
    copyPreloadPlugin(),
    // Only configure main process - NO preload entries
    // Preload is handled by custom plugin above
    electron([
      {
        entry: 'electron/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: [
                'zod',
                'better-sqlite3',
                'electron',
                // BLAKE3 has native bindings - must be external
                'blake3',
                'blake3/browser', // Prevent bundling browser version
                // exiftool-vendored spawns external process
                'exiftool-vendored',
                // fluent-ffmpeg spawns external process
                'fluent-ffmpeg',
              ],
            },
          },
        },
      },
    ]),
    // Handle Electron renderer module resolution
    renderer(),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: '@core', replacement: path.resolve(__dirname, '../core/src') },
      // Force svelte to use client version (exact match only, not subpaths)
      { find: /^svelte$/, replacement: path.resolve(__dirname, '../../node_modules/svelte/src/index-client.js') },
    ],
    // Force browser conditions for all imports
    conditions: ['browser', 'module', 'import', 'default'],
  },
  // Don't pre-bundle Svelte - let it resolve with browser conditions at runtime
  optimizeDeps: {
    exclude: ['svelte'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Ensure client-side build
    ssr: false,
  },
  server: {
    port: 5173,
  },
});
