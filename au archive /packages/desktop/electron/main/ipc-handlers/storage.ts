/**
 * Storage IPC Handlers
 * OPT-047: Rewritten to use database queries instead of blocking filesystem traversal
 *
 * Per data-ownership.md: "Settings page lists archive path, disk usage"
 * Per data-ownership.md: "Every media file's provenance... is auditable at any time"
 */
import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getDatabase } from '../database';
import { sql } from 'kysely';

/**
 * Get disk space info for a path using Node.js fs.statfs (Node 18.15+)
 */
async function getDiskSpace(targetPath: string): Promise<{ total: number; free: number }> {
  try {
    const stats = await fs.promises.statfs(targetPath);
    return {
      total: stats.blocks * stats.bsize,
      free: stats.bfree * stats.bsize,
    };
  } catch (error) {
    console.error('Error getting disk space:', error);
    return { total: 0, free: 0 };
  }
}

/**
 * Get total size of a directory recursively (for verify/backfill only)
 * This is intentionally slow and should only be called by user-initiated verify
 */
async function getDirectorySizeWithProgress(
  dirPath: string,
  onProgress?: (processed: number, currentFile: string) => void
): Promise<{ totalSize: number; fileCount: number }> {
  let totalSize = 0;
  let fileCount = 0;

  async function walk(dir: string): Promise<void> {
    try {
      const files = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const file of files) {
        const filePath = path.join(dir, file.name);
        if (file.isDirectory()) {
          await walk(filePath);
        } else if (file.isFile()) {
          try {
            const stats = await fs.promises.stat(filePath);
            totalSize += stats.size;
            fileCount++;
            if (onProgress && fileCount % 100 === 0) {
              onProgress(fileCount, file.name);
            }
          } catch {
            // Skip files we can't access
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be accessed
    }
  }

  await walk(dirPath);
  return { totalSize, fileCount };
}

/**
 * Get cached generated content sizes from settings
 */
async function getCachedGeneratedSizes(db: ReturnType<typeof getDatabase>): Promise<{
  thumbnailBytes: number;
  previewBytes: number;
  proxyBytes: number;
  lastUpdated: string | null;
}> {
  const keys = ['generated_thumbnails_bytes', 'generated_previews_bytes', 'generated_proxies_bytes', 'generated_size_updated_at'];
  const results = await db
    .selectFrom('settings')
    .select(['key', 'value'])
    .where('key', 'in', keys)
    .execute();

  const map = new Map(results.map(r => [r.key, r.value]));
  return {
    thumbnailBytes: parseInt(map.get('generated_thumbnails_bytes') || '0', 10),
    previewBytes: parseInt(map.get('generated_previews_bytes') || '0', 10),
    proxyBytes: parseInt(map.get('generated_proxies_bytes') || '0', 10),
    lastUpdated: map.get('generated_size_updated_at') || null,
  };
}

/**
 * Save generated content sizes to settings
 */
async function saveGeneratedSizes(
  db: ReturnType<typeof getDatabase>,
  sizes: { thumbnailBytes: number; previewBytes: number; proxyBytes: number }
): Promise<void> {
  const now = new Date().toISOString();
  const updates = [
    { key: 'generated_thumbnails_bytes', value: sizes.thumbnailBytes.toString() },
    { key: 'generated_previews_bytes', value: sizes.previewBytes.toString() },
    { key: 'generated_proxies_bytes', value: sizes.proxyBytes.toString() },
    { key: 'generated_size_updated_at', value: now },
  ];

  for (const { key, value } of updates) {
    await db
      .insertInto('settings')
      .values({ key, value })
      .onConflict(oc => oc.column('key').doUpdateSet({ value }))
      .execute();
  }
}

export function registerStorageHandlers() {
  /**
   * storage:getStats - Returns archive storage statistics
   * OPT-047: Uses database SUM queries instead of filesystem traversal
   * Returns in <100ms regardless of archive size
   */
  ipcMain.handle('storage:getStats', async () => {
    try {
      const db = getDatabase();

      // Get archive path from settings
      const archivePathRow = await db
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'archive_folder')
        .executeTakeFirst();

      const archivePath = archivePathRow?.value;

      if (!archivePath) {
        return null; // No archive path configured
      }

      // Check if archive path exists
      try {
        await fs.promises.access(archivePath);
      } catch {
        return null; // Archive path doesn't exist
      }

      // Get disk space (fast - single syscall)
      const diskSpace = await getDiskSpace(archivePath);

      // Get media size from database (instant - indexed SUM queries)
      // OPT-047: Sum file_size_bytes from all media tables
      const [imgSum, vidSum, docSum, mapSum] = await Promise.all([
        db.selectFrom('imgs')
          .select(eb => eb.fn.sum<string>('file_size_bytes').as('total'))
          .executeTakeFirst(),
        db.selectFrom('vids')
          .select(eb => eb.fn.sum<string>('file_size_bytes').as('total'))
          .executeTakeFirst(),
        db.selectFrom('docs')
          .select(eb => eb.fn.sum<string>('file_size_bytes').as('total'))
          .executeTakeFirst(),
        db.selectFrom('maps')
          .select(eb => eb.fn.sum<string>('file_size_bytes').as('total'))
          .executeTakeFirst(),
      ]);

      const mediaBytes =
        (parseInt(imgSum?.total || '0', 10) || 0) +
        (parseInt(vidSum?.total || '0', 10) || 0) +
        (parseInt(docSum?.total || '0', 10) || 0) +
        (parseInt(mapSum?.total || '0', 10) || 0);

      // Count files with missing file_size_bytes (need backfill)
      const [imgNull, vidNull, docNull, mapNull] = await Promise.all([
        db.selectFrom('imgs')
          .select(eb => eb.fn.count<string>('imghash').as('count'))
          .where('file_size_bytes', 'is', null)
          .executeTakeFirst(),
        db.selectFrom('vids')
          .select(eb => eb.fn.count<string>('vidhash').as('count'))
          .where('file_size_bytes', 'is', null)
          .executeTakeFirst(),
        db.selectFrom('docs')
          .select(eb => eb.fn.count<string>('dochash').as('count'))
          .where('file_size_bytes', 'is', null)
          .executeTakeFirst(),
        db.selectFrom('maps')
          .select(eb => eb.fn.count<string>('maphash').as('count'))
          .where('file_size_bytes', 'is', null)
          .executeTakeFirst(),
      ]);

      const unmeasuredCount =
        (parseInt(imgNull?.count || '0', 10) || 0) +
        (parseInt(vidNull?.count || '0', 10) || 0) +
        (parseInt(docNull?.count || '0', 10) || 0) +
        (parseInt(mapNull?.count || '0', 10) || 0);

      // Get cached generated content sizes
      const generated = await getCachedGeneratedSizes(db);

      // Get last verify timestamp
      const lastVerifyRow = await db
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'storage_last_verified_at')
        .executeTakeFirst();

      const drivePath = process.platform === 'win32'
        ? path.parse(archivePath).root
        : '/';

      // Total archive = media + generated content
      const archiveBytes = mediaBytes + generated.thumbnailBytes + generated.previewBytes + generated.proxyBytes;

      return {
        totalBytes: diskSpace.total,
        availableBytes: diskSpace.free,
        drivePath,
        // Media files (from database)
        mediaBytes,
        // Generated content (cached values)
        thumbnailBytes: generated.thumbnailBytes,
        previewBytes: generated.previewBytes,
        proxyBytes: generated.proxyBytes,
        // Total tracked
        archiveBytes,
        // Data quality
        unmeasuredCount,
        lastVerifiedAt: lastVerifyRow?.value || null,
      };
    } catch (error) {
      console.error('Error getting storage stats:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * storage:verifyIntegrity - User-initiated integrity verification
   * Walks filesystem, backfills missing file_size_bytes, reports mismatches
   * This is intentionally slow and shows progress
   */
  ipcMain.handle('storage:verifyIntegrity', async () => {
    try {
      const db = getDatabase();
      const mainWindow = BrowserWindow.getFocusedWindow();

      // Get archive path
      const archivePathRow = await db
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'archive_folder')
        .executeTakeFirst();

      const archivePath = archivePathRow?.value;
      if (!archivePath) {
        throw new Error('No archive folder configured');
      }

      const results = {
        totalFiles: 0,
        measuredFiles: 0,
        newMeasurements: 0,
        sizeMismatches: [] as Array<{ sha: string; table: string; expected: number; actual: number; path: string }>,
        missingFiles: [] as Array<{ sha: string; table: string; path: string }>,
        archiveBytes: 0,
        verifiedAt: new Date().toISOString(),
      };

      // Helper to verify and update file sizes
      async function verifyTable(
        tableName: 'imgs' | 'vids' | 'docs' | 'maps',
        shaCol: string,
        pathCol: string,
        sizeCol: string
      ): Promise<void> {
        const rows = await db
          .selectFrom(tableName)
          .select([shaCol as any, pathCol as any, sizeCol as any])
          .execute();

        for (const row of rows) {
          results.totalFiles++;
          const sha = (row as any)[shaCol];
          const filePath = (row as any)[pathCol];
          const storedSize = (row as any)[sizeCol];

          // Emit progress
          if (mainWindow && results.totalFiles % 50 === 0) {
            mainWindow.webContents.send('storage:verify:progress', {
              processed: results.totalFiles,
              currentFile: path.basename(filePath),
            });
          }

          try {
            const stats = await fs.promises.stat(filePath);
            const actualSize = stats.size;

            if (storedSize === null) {
              // Backfill missing size
              await db
                .updateTable(tableName)
                .set({ [sizeCol]: actualSize } as any)
                .where(shaCol as any, '=', sha)
                .execute();
              results.newMeasurements++;
              results.measuredFiles++;
              results.archiveBytes += actualSize;
            } else if (storedSize !== actualSize) {
              // Size mismatch - possible corruption
              results.sizeMismatches.push({
                sha,
                table: tableName,
                expected: storedSize,
                actual: actualSize,
                path: filePath,
              });
              results.measuredFiles++;
              results.archiveBytes += actualSize;
            } else {
              // Size matches
              results.measuredFiles++;
              results.archiveBytes += actualSize;
            }
          } catch {
            // File missing from disk
            results.missingFiles.push({
              sha,
              table: tableName,
              path: filePath,
            });
          }
        }
      }

      // Verify all media tables
      await verifyTable('imgs', 'imghash', 'imgloc', 'file_size_bytes');
      await verifyTable('vids', 'vidhash', 'vidloc', 'file_size_bytes');
      await verifyTable('docs', 'dochash', 'docloc', 'file_size_bytes');
      await verifyTable('maps', 'maphash', 'maploc', 'file_size_bytes');

      // Update generated content sizes by scanning directories
      const thumbnailsDir = path.join(archivePath, '.thumbnails');
      const previewsDir = path.join(archivePath, '.previews');
      const proxiesDir = path.join(archivePath, '.cache', 'video-proxies');

      const [thumbSize, previewSize, proxySize] = await Promise.all([
        getDirectorySizeWithProgress(thumbnailsDir).then(r => r.totalSize).catch(() => 0),
        getDirectorySizeWithProgress(previewsDir).then(r => r.totalSize).catch(() => 0),
        getDirectorySizeWithProgress(proxiesDir).then(r => r.totalSize).catch(() => 0),
      ]);

      // Save generated sizes
      await saveGeneratedSizes(db, {
        thumbnailBytes: thumbSize,
        previewBytes: previewSize,
        proxyBytes: proxySize,
      });

      // Save verify timestamp
      await db
        .insertInto('settings')
        .values({ key: 'storage_last_verified_at', value: results.verifiedAt })
        .onConflict(oc => oc.column('key').doUpdateSet({ value: results.verifiedAt }))
        .execute();

      // Add generated content to total
      results.archiveBytes += thumbSize + previewSize + proxySize;

      return results;
    } catch (error) {
      console.error('Error verifying storage integrity:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });
}
