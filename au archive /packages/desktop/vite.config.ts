import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import electron from 'vite-plugin-electron';
import path from 'path';
import fs from 'fs';
import { build } from 'esbuild';

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
    fs.copyFileSync(srcPath, destPath);
    console.log('[preload] Copied static preload.cjs to dist-electron/preload/index.cjs');
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

/**
 * Custom plugin to build hash worker using esbuild with proper CommonJS output.
 *
 * WHY THIS EXISTS:
 * vite-plugin-electron ignores lib.formats and always outputs ESM syntax
 * even when we request CJS format. This breaks worker threads which need
 * pure CommonJS when package.json has "type": "module".
 *
 * SOLUTION:
 * Use esbuild directly to compile the worker to CommonJS format.
 */
function buildHashWorkerPlugin(): Plugin {
  const srcPath = path.resolve(__dirname, 'electron/workers/hash.worker.ts');
  const destDir = path.resolve(__dirname, 'dist-electron/workers');
  const destPath = path.join(destDir, 'hash.worker.cjs');

  async function buildWorker() {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    await build({
      entryPoints: [srcPath],
      outfile: destPath,
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs', // CRITICAL: Must be CommonJS for worker threads
      external: [
        'blake3',       // Native module with WASM fallback
        'worker_threads',
        'fs',
        'child_process',
        'util',
        'crypto',
      ],
      logLevel: 'info',
    });

    console.log('[hash-worker] Built hash.worker.cjs with CommonJS format');
  }

  return {
    name: 'build-hash-worker',
    // Build on startup
    async buildStart() {
      await buildWorker();
    },
    // Watch for changes in dev mode
    configureServer(server) {
      // Initial build
      buildWorker().catch(console.error);
      // Watch for changes
      server.watcher.add(srcPath);
      server.watcher.on('change', async (changedPath) => {
        if (changedPath === srcPath) {
          await buildWorker();
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
    // Build hash worker with esbuild (proper CommonJS output)
    buildHashWorkerPlugin(),
    // Only configure main process - NO preload or worker entries
    // Workers and preload are handled by custom plugins above
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
                'kysely',
                'electron',
                // Sharp is a native module with platform-specific binaries
                // that use dynamic requires - must be external to the bundle
                'sharp',
                // unzipper has optional S3 support that requires this package
                // we don't use S3 features, so mark as external to prevent crash
                '@aws-sdk/client-s3',
                // BLAKE3 has native bindings with WASM fallback
                // Must be external to use the correct CJS/Node entry point
                'blake3',
                // Puppeteer uses dynamic requires for browser detection
                'puppeteer-core',
                'puppeteer-extra',
                'puppeteer-extra-plugin-stealth',
                // ONNX Runtime has platform-specific native bindings
                // Must be external to load correct darwin/arm64 binary
                'onnxruntime-node',
              ],
            },
          },
        },
      },
      // REMOVED: worker entry - handled by buildHashWorkerPlugin instead
      // REMOVED: preload entry - handled by copyPreloadPlugin instead
    ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@core': path.resolve(__dirname, '../core/src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
