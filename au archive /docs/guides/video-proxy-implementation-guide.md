# Video Proxy System - Implementation Guide

A step-by-step guide for implementing the video proxy system in the AU Archive Electron app.

## Overview

This guide walks through creating a video proxy system that generates optimized H.264 preview videos for smooth, instant playback. The system solves three problems:

1. **Slow loading** - 4K videos are 100-300MB; proxies are 3-10MB
2. **No scrubbing** - `media://` protocol lacks range request support; proxies use `file://` with faststart
3. **Wrong rotation** - FFmpeg autorotate bakes rotation into proxy pixels

## Prerequisites

- FFmpeg installed and working (already bundled with app)
- Understanding of Electron IPC (main ↔ renderer communication)
- Basic TypeScript and Svelte knowledge

## Implementation Steps

### Step 1: Database Migration

Create a new migration file to store proxy metadata.

**File:** `packages/desktop/migrations/0037_video_proxies.ts`

```typescript
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('video_proxies')
    .addColumn('vidsha', 'text', (col) => col.primaryKey())
    .addColumn('proxy_path', 'text', (col) => col.notNull())
    .addColumn('generated_at', 'text', (col) => col.notNull())
    .addColumn('last_accessed', 'text', (col) => col.notNull())
    .addColumn('file_size_bytes', 'integer')
    .addColumn('original_width', 'integer')
    .addColumn('original_height', 'integer')
    .addColumn('proxy_width', 'integer')
    .addColumn('proxy_height', 'integer')
    .execute();

  // Foreign key constraint
  await sql`
    CREATE TRIGGER video_proxies_fk_delete
    AFTER DELETE ON vids
    BEGIN
      DELETE FROM video_proxies WHERE vidsha = OLD.vidsha;
    END
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS video_proxies_fk_delete`.execute(db);
  await db.schema.dropTable('video_proxies').ifExists().execute();
}
```

**Why this design:**
- `vidsha` is the primary key, matching the `vids` table
- `last_accessed` enables 30-day auto-purge
- `file_size_bytes` helps display cache stats in Settings
- Trigger ensures orphaned proxies are cleaned up

### Step 2: VideoProxyService

This service handles FFmpeg transcoding to create proxy videos.

**File:** `packages/desktop/electron/services/video-proxy-service.ts`

```typescript
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { getDb } from '../main/database';
import { getArchiveBasePath } from './media-path-service';

interface ProxyResult {
  success: boolean;
  proxyPath?: string;
  error?: string;
}

interface VideoMetadata {
  width: number;
  height: number;
  duration?: number;
}

/**
 * Calculate proxy dimensions.
 * - Landscape: max 1080p height (don't upscale)
 * - Portrait: max 720p width (don't upscale)
 */
function calculateProxySize(width: number, height: number): { width: number; height: number } {
  const isPortrait = height > width;

  if (isPortrait) {
    // Portrait: max 720 width
    if (width <= 720) {
      return { width, height }; // Don't upscale
    }
    const scale = 720 / width;
    return {
      width: 720,
      height: Math.round(height * scale / 2) * 2 // Even number for H.264
    };
  } else {
    // Landscape: max 1080 height
    if (height <= 1080) {
      return { width, height }; // Don't upscale
    }
    const scale = 1080 / height;
    return {
      width: Math.round(width * scale / 2) * 2, // Even number for H.264
      height: 1080
    };
  }
}

/**
 * Get the proxy cache directory path.
 */
export async function getProxyCacheDir(): Promise<string> {
  const archiveBase = await getArchiveBasePath();
  const cacheDir = path.join(archiveBase, '.cache', 'video-proxies');
  await fs.mkdir(cacheDir, { recursive: true });
  return cacheDir;
}

/**
 * Generate a proxy video for the given video file.
 */
export async function generateProxy(
  vidsha: string,
  sourcePath: string,
  metadata: VideoMetadata
): Promise<ProxyResult> {
  const cacheDir = await getProxyCacheDir();
  const proxyPath = path.join(cacheDir, `${vidsha}_proxy.mp4`);

  // Check if proxy already exists
  try {
    await fs.access(proxyPath);
    return { success: true, proxyPath };
  } catch {
    // Proxy doesn't exist, generate it
  }

  const { width: targetWidth, height: targetHeight } = calculateProxySize(
    metadata.width,
    metadata.height
  );

  // Build FFmpeg scale filter
  const isPortrait = metadata.height > metadata.width;
  const scaleFilter = isPortrait
    ? `scale=${targetWidth}:-2`  // Portrait: set width
    : `scale=-2:${targetHeight}`; // Landscape: set height

  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', sourcePath,
      '-vf', scaleFilter,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      '-y', // Overwrite if exists
      proxyPath
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', async (code) => {
      if (code === 0) {
        // Get file size and save to database
        try {
          const stats = await fs.stat(proxyPath);
          const db = getDb();
          const now = new Date().toISOString();

          await db
            .insertInto('video_proxies')
            .values({
              vidsha,
              proxy_path: proxyPath,
              generated_at: now,
              last_accessed: now,
              file_size_bytes: stats.size,
              original_width: metadata.width,
              original_height: metadata.height,
              proxy_width: targetWidth,
              proxy_height: targetHeight
            })
            .onConflict((oc) => oc
              .column('vidsha')
              .doUpdateSet({
                proxy_path: proxyPath,
                generated_at: now,
                last_accessed: now,
                file_size_bytes: stats.size
              })
            )
            .execute();

          resolve({ success: true, proxyPath });
        } catch (err) {
          resolve({ success: false, error: `Database error: ${err}` });
        }
      } else {
        resolve({ success: false, error: `FFmpeg failed: ${stderr.slice(-500)}` });
      }
    });

    ffmpeg.on('error', (err) => {
      resolve({ success: false, error: `FFmpeg spawn error: ${err.message}` });
    });
  });
}

/**
 * Get proxy path for a video if it exists.
 */
export async function getProxyPath(vidsha: string): Promise<string | null> {
  const db = getDb();

  const proxy = await db
    .selectFrom('video_proxies')
    .select(['proxy_path', 'vidsha'])
    .where('vidsha', '=', vidsha)
    .executeTakeFirst();

  if (!proxy) return null;

  // Verify file exists
  try {
    await fs.access(proxy.proxy_path);

    // Update last_accessed
    await db
      .updateTable('video_proxies')
      .set({ last_accessed: new Date().toISOString() })
      .where('vidsha', '=', vidsha)
      .execute();

    return proxy.proxy_path;
  } catch {
    // File doesn't exist, clean up record
    await db
      .deleteFrom('video_proxies')
      .where('vidsha', '=', vidsha)
      .execute();
    return null;
  }
}
```

**Key concepts:**
- `calculateProxySize()`: Never upscales; respects original resolution
- `spawn()`: Runs FFmpeg as a child process
- `-movflags +faststart`: Enables instant seeking/scrubbing
- `-crf 23`: Quality setting (lower = better, 23 is good balance)
- Database upsert handles regeneration gracefully

### Step 3: ProxyCacheService

Manages cache lifecycle and cleanup.

**File:** `packages/desktop/electron/services/proxy-cache-service.ts`

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { getDb } from '../main/database';
import { getProxyCacheDir } from './video-proxy-service';

interface CacheStats {
  totalCount: number;
  totalSizeBytes: number;
  oldestAccess: string | null;
  newestAccess: string | null;
}

interface PurgeResult {
  deleted: number;
  freedBytes: number;
}

/**
 * Get cache statistics.
 */
export async function getCacheStats(): Promise<CacheStats> {
  const db = getDb();

  const stats = await db
    .selectFrom('video_proxies')
    .select([
      db.fn.count('vidsha').as('count'),
      db.fn.sum('file_size_bytes').as('size'),
      db.fn.min('last_accessed').as('oldest'),
      db.fn.max('last_accessed').as('newest')
    ])
    .executeTakeFirst();

  return {
    totalCount: Number(stats?.count || 0),
    totalSizeBytes: Number(stats?.size || 0),
    oldestAccess: stats?.oldest as string | null,
    newestAccess: stats?.newest as string | null
  };
}

/**
 * Purge proxies not accessed in the last N days.
 */
export async function purgeOldProxies(daysOld: number = 30): Promise<PurgeResult> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);
  const cutoffISO = cutoff.toISOString();

  const db = getDb();

  // Find stale proxies
  const stale = await db
    .selectFrom('video_proxies')
    .select(['vidsha', 'proxy_path', 'file_size_bytes'])
    .where('last_accessed', '<', cutoffISO)
    .execute();

  let deleted = 0;
  let freedBytes = 0;

  for (const proxy of stale) {
    // Delete file
    try {
      await fs.unlink(proxy.proxy_path);
      freedBytes += proxy.file_size_bytes || 0;
    } catch {
      // File may already be gone
    }

    // Delete record
    await db
      .deleteFrom('video_proxies')
      .where('vidsha', '=', proxy.vidsha)
      .execute();

    deleted++;
  }

  return { deleted, freedBytes };
}

/**
 * Clear all proxies (manual purge).
 */
export async function clearAllProxies(): Promise<PurgeResult> {
  const db = getDb();

  const all = await db
    .selectFrom('video_proxies')
    .select(['vidsha', 'proxy_path', 'file_size_bytes'])
    .execute();

  let freedBytes = 0;

  for (const proxy of all) {
    try {
      await fs.unlink(proxy.proxy_path);
      freedBytes += proxy.file_size_bytes || 0;
    } catch {}
  }

  await db.deleteFrom('video_proxies').execute();

  // Also clear the directory in case of orphaned files
  try {
    const cacheDir = await getProxyCacheDir();
    const files = await fs.readdir(cacheDir);
    for (const file of files) {
      if (file.endsWith('_proxy.mp4')) {
        await fs.unlink(path.join(cacheDir, file));
      }
    }
  } catch {}

  return { deleted: all.length, freedBytes };
}

/**
 * Update last_accessed for all videos in a location.
 * Called when user views a location.
 */
export async function touchLocationProxies(locid: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  // Get all video SHAs for this location
  const videos = await db
    .selectFrom('vids')
    .select('vidsha')
    .where('locid', '=', locid)
    .execute();

  if (videos.length === 0) return;

  const shas = videos.map(v => v.vidsha);

  await db
    .updateTable('video_proxies')
    .set({ last_accessed: now })
    .where('vidsha', 'in', shas)
    .execute();
}
```

### Step 4: Database Types

Add type definitions for the new table.

**File:** `packages/desktop/electron/main/database.types.ts` (add to existing)

```typescript
// Add to existing Database interface
export interface VideoProxy {
  vidsha: string;
  proxy_path: string;
  generated_at: string;
  last_accessed: string;
  file_size_bytes: number | null;
  original_width: number | null;
  original_height: number | null;
  proxy_width: number | null;
  proxy_height: number | null;
}

// In the Database interface, add:
video_proxies: VideoProxy;
```

### Step 5: IPC Handlers

Add handlers in the media processing IPC file.

**File:** `packages/desktop/electron/main/ipc-handlers/media-processing.ts` (add to existing)

```typescript
import { generateProxy, getProxyPath, getProxyCacheDir } from '../../services/video-proxy-service';
import { getCacheStats, purgeOldProxies, clearAllProxies, touchLocationProxies } from '../../services/proxy-cache-service';

// Add these handlers:

ipcMain.handle('media:generateProxy', async (_event, vidsha: string, sourcePath: string, metadata: { width: number; height: number }) => {
  return generateProxy(vidsha, sourcePath, metadata);
});

ipcMain.handle('media:getProxyPath', async (_event, vidsha: string) => {
  return getProxyPath(vidsha);
});

ipcMain.handle('media:getProxyCacheStats', async () => {
  return getCacheStats();
});

ipcMain.handle('media:purgeOldProxies', async (_event, daysOld?: number) => {
  return purgeOldProxies(daysOld);
});

ipcMain.handle('media:clearAllProxies', async () => {
  return clearAllProxies();
});

ipcMain.handle('media:touchLocationProxies', async (_event, locid: string) => {
  return touchLocationProxies(locid);
});

ipcMain.handle('media:generateProxiesForLocation', async (event, locid: string) => {
  const db = getDb();

  // Get all videos for location that don't have proxies
  const videos = await db
    .selectFrom('vids')
    .leftJoin('video_proxies', 'vids.vidsha', 'video_proxies.vidsha')
    .select(['vids.vidsha', 'vids.file_path', 'vids.meta_width', 'vids.meta_height'])
    .where('vids.locid', '=', locid)
    .where('video_proxies.vidsha', 'is', null)
    .execute();

  let generated = 0;
  let failed = 0;

  for (const video of videos) {
    const result = await generateProxy(
      video.vidsha,
      video.file_path,
      { width: video.meta_width || 1920, height: video.meta_height || 1080 }
    );

    if (result.success) {
      generated++;
    } else {
      failed++;
    }

    // Emit progress
    event.sender.send('media:proxyProgress', {
      locid,
      generated,
      failed,
      total: videos.length
    });
  }

  return { generated, failed, total: videos.length };
});
```

### Step 6: Preload Bridge

Add methods to expose proxy functions to renderer.

**File:** `packages/desktop/electron/preload/index.ts` (add to existing media object)

```typescript
// In the media object, add these methods:
generateProxy: (vidsha: string, sourcePath: string, metadata: { width: number; height: number }) =>
  ipcRenderer.invoke('media:generateProxy', vidsha, sourcePath, metadata),

getProxyPath: (vidsha: string) =>
  ipcRenderer.invoke('media:getProxyPath', vidsha),

getProxyCacheStats: () =>
  ipcRenderer.invoke('media:getProxyCacheStats'),

purgeOldProxies: (daysOld?: number) =>
  ipcRenderer.invoke('media:purgeOldProxies', daysOld),

clearAllProxies: () =>
  ipcRenderer.invoke('media:clearAllProxies'),

touchLocationProxies: (locid: string) =>
  ipcRenderer.invoke('media:touchLocationProxies', locid),

generateProxiesForLocation: (locid: string) =>
  ipcRenderer.invoke('media:generateProxiesForLocation', locid),

onProxyProgress: (callback: (progress: { locid: string; generated: number; failed: number; total: number }) => void) => {
  const handler = (_event: unknown, progress: { locid: string; generated: number; failed: number; total: number }) => callback(progress);
  ipcRenderer.on('media:proxyProgress', handler);
  return () => ipcRenderer.removeListener('media:proxyProgress', handler);
}
```

### Step 7: TypeScript Types

**File:** `packages/desktop/src/types/electron.d.ts` (add to media interface)

```typescript
// Add to the media interface:
generateProxy: (vidsha: string, sourcePath: string, metadata: { width: number; height: number }) => Promise<{
  success: boolean;
  proxyPath?: string;
  error?: string;
}>;
getProxyPath: (vidsha: string) => Promise<string | null>;
getProxyCacheStats: () => Promise<{
  totalCount: number;
  totalSizeBytes: number;
  oldestAccess: string | null;
  newestAccess: string | null;
}>;
purgeOldProxies: (daysOld?: number) => Promise<{ deleted: number; freedBytes: number }>;
clearAllProxies: () => Promise<{ deleted: number; freedBytes: number }>;
touchLocationProxies: (locid: string) => Promise<void>;
generateProxiesForLocation: (locid: string) => Promise<{ generated: number; failed: number; total: number }>;
onProxyProgress: (callback: (progress: { locid: string; generated: number; failed: number; total: number }) => void) => () => void;
```

### Step 8: MediaViewer Update

Modify MediaViewer to use proxies for playback.

**File:** `packages/desktop/src/components/MediaViewer.svelte`

The key changes:
1. Check for proxy on mount
2. If proxy exists, use `file://` protocol
3. If no proxy, show "Preparing preview..." and generate
4. Switch to proxy when ready

```svelte
<script lang="ts">
  // Add these variables
  let proxyPath: string | null = null;
  let generatingProxy = false;

  // Add this function
  async function loadProxy(video: { vidsha: string; file_path: string; meta_width?: number; meta_height?: number }) {
    // Check for existing proxy
    proxyPath = await window.electronAPI.media.getProxyPath(video.vidsha);

    if (!proxyPath) {
      // Generate proxy
      generatingProxy = true;
      const result = await window.electronAPI.media.generateProxy(
        video.vidsha,
        video.file_path,
        { width: video.meta_width || 1920, height: video.meta_height || 1080 }
      );
      generatingProxy = false;

      if (result.success && result.proxyPath) {
        proxyPath = result.proxyPath;
      }
    }
  }

  // Call loadProxy when current media changes and is a video
  $: if (currentMedia?.type === 'video') {
    proxyPath = null;
    loadProxy(currentMedia);
  }
</script>

<!-- In the template, update video rendering -->
{#if currentMedia.type === 'video'}
  {#if generatingProxy}
    <div class="flex flex-col items-center gap-4">
      <div class="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full"></div>
      <p class="text-surface-300">Preparing preview...</p>
    </div>
  {:else if proxyPath}
    <video
      src={`file://${proxyPath}`}
      controls
      class="max-w-full max-h-full object-contain"
    >
      <track kind="captions" />
    </video>
  {:else}
    <!-- Fallback to original -->
    <video
      src={`media://${currentMedia.path}`}
      controls
      class="max-w-full max-h-full object-contain"
    >
      <track kind="captions" />
    </video>
  {/if}
{/if}
```

### Step 9: LocationDetail Pre-generation

When a user views a location, pre-generate proxies for all videos.

**File:** `packages/desktop/src/pages/LocationDetail.svelte`

Add to the `onMount` function:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let unsubscribeProgress: (() => void) | null = null;
  let proxyProgress = { generated: 0, total: 0 };

  onMount(async () => {
    // ... existing code ...

    // Touch all proxies for this location (updates last_accessed)
    await window.electronAPI.media.touchLocationProxies(locid);

    // Start background proxy generation
    unsubscribeProgress = window.electronAPI.media.onProxyProgress((progress) => {
      if (progress.locid === locid) {
        proxyProgress = progress;
      }
    });

    window.electronAPI.media.generateProxiesForLocation(locid);
  });

  onDestroy(() => {
    if (unsubscribeProgress) {
      unsubscribeProgress();
    }
  });
</script>

<!-- Optionally show progress indicator -->
{#if proxyProgress.total > 0 && proxyProgress.generated < proxyProgress.total}
  <div class="text-xs text-surface-400">
    Preparing videos: {proxyProgress.generated}/{proxyProgress.total}
  </div>
{/if}
```

### Step 10: Settings UI

Add cache management section to Settings.

**File:** `packages/desktop/src/pages/Settings.svelte`

Add a new section:

```svelte
<script lang="ts">
  let cacheStats = { totalCount: 0, totalSizeBytes: 0, oldestAccess: null, newestAccess: null };
  let clearingCache = false;
  let purgingOld = false;

  async function loadCacheStats() {
    cacheStats = await window.electronAPI.media.getProxyCacheStats();
  }

  async function handleClearCache() {
    clearingCache = true;
    const result = await window.electronAPI.media.clearAllProxies();
    await loadCacheStats();
    clearingCache = false;
  }

  async function handlePurgeOld() {
    purgingOld = true;
    const result = await window.electronAPI.media.purgeOldProxies(30);
    await loadCacheStats();
    purgingOld = false;
  }

  onMount(() => {
    loadCacheStats();
  });
</script>

<!-- Add this section -->
<section class="card p-6">
  <h3 class="h4 mb-4">Video Proxies</h3>
  <p class="text-sm text-surface-400 mb-4">
    Preview videos are cached for fast playback. Old previews are automatically purged after 30 days.
  </p>

  <div class="grid grid-cols-2 gap-4 mb-4">
    <div>
      <span class="text-surface-400">Cached videos:</span>
      <span class="font-medium">{cacheStats.totalCount}</span>
    </div>
    <div>
      <span class="text-surface-400">Cache size:</span>
      <span class="font-medium">{formatBytes(cacheStats.totalSizeBytes)}</span>
    </div>
  </div>

  <div class="flex gap-2">
    <button
      class="btn variant-soft"
      on:click={handlePurgeOld}
      disabled={purgingOld}
    >
      {purgingOld ? 'Purging...' : 'Purge Old (30+ days)'}
    </button>
    <button
      class="btn variant-soft-error"
      on:click={handleClearCache}
      disabled={clearingCache}
    >
      {clearingCache ? 'Clearing...' : 'Clear All'}
    </button>
  </div>
</section>
```

## Testing Checklist

1. **Import a video** - Verify proxy generates in background
2. **Play a video** - Should load instantly with smooth scrubbing
3. **Check rotation** - Portrait videos should display correctly
4. **View Settings** - Cache stats should show accurate counts
5. **Clear cache** - Verify files are deleted
6. **Wait 30+ days** (or adjust cutoff for testing) - Old proxies should purge

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| "FFmpeg spawn error" | FFmpeg not in PATH | Check ffmpeg installation |
| Proxy not generating | Missing video metadata | Check meta_width/meta_height in vids table |
| File not found | Proxy deleted but record exists | `getProxyPath()` handles this automatically |
| Cache not clearing | Permission error | Check write permissions on .cache folder |

## Performance Notes

- Proxy generation takes 5-30 seconds per video (depends on length)
- Proxies are 3-10MB each (vs 100-300MB originals)
- First video in a location generates immediately
- Rest generate in background while user browses
