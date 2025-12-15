/**
 * Perceptual Hash Backfill Job
 *
 * Background job to calculate pHash for existing images in the archive.
 * Runs on startup or on-demand to fill in missing perceptual hashes.
 *
 * @module services/image-downloader/phash-backfill-job
 */

import type Database from 'better-sqlite3';
import { perceptualHashService } from './perceptual-hash-service';
import { getLogger } from '../logger-service';

const logger = getLogger();

export interface BackfillResult {
  processed: number;
  errors: number;
  skipped: number;
  durationMs: number;
}

export interface BackfillProgress {
  current: number;
  total: number;
  currentFile: string;
  processed: number;
  errors: number;
}

/**
 * Backfill perceptual hashes for existing images
 *
 * @param db - Database instance
 * @param onProgress - Progress callback
 * @param batchSize - Number of images to process in each batch
 * @param signal - Abort signal for cancellation
 * @returns Backfill result with counts
 */
export async function backfillPerceptualHashes(
  db: Database.Database,
  onProgress?: (progress: BackfillProgress) => void,
  batchSize = 50,
  signal?: AbortSignal
): Promise<BackfillResult> {
  const startTime = Date.now();

  // Get images without pHash
  const images = db
    .prepare(
      `
    SELECT imghash, imgloc FROM imgs
    WHERE phash IS NULL AND imgloc IS NOT NULL
    ORDER BY imgadd DESC
  `
    )
    .all() as Array<{ imghash: string; imgloc: string }>;

  const total = images.length;

  if (total === 0) {
    logger.info('pHashBackfill', 'No images need backfill');
    return {
      processed: 0,
      errors: 0,
      skipped: 0,
      durationMs: Date.now() - startTime,
    };
  }

  logger.info('pHashBackfill', `Starting backfill for ${total} images`);

  let processed = 0;
  let errors = 0;
  let skipped = 0;

  // Prepare update statement
  const updateStmt = db.prepare(`UPDATE imgs SET phash = ? WHERE imghash = ?`);

  // Process in batches
  for (let i = 0; i < images.length; i += batchSize) {
    if (signal?.aborted) {
      logger.info('pHashBackfill', 'Backfill cancelled');
      break;
    }

    const batch = images.slice(i, i + batchSize);

    for (const img of batch) {
      if (signal?.aborted) break;

      try {
        const result = await perceptualHashService.hashFile(img.imgloc);

        updateStmt.run(result.hash, img.imghash);
        processed++;

        onProgress?.({
          current: i + processed + errors + skipped,
          total,
          currentFile: img.imgloc,
          processed,
          errors,
        });
      } catch (err) {
        errors++;
        logger.warn('pHashBackfill', `Failed to hash ${img.imghash}`, {
          error: (err as Error).message,
          path: img.imgloc,
        });
      }
    }

    // Log progress every 100 images
    if ((processed + errors) % 100 === 0) {
      logger.debug('pHashBackfill', 'Progress', {
        processed,
        errors,
        remaining: total - processed - errors - skipped,
      });
    }
  }

  const durationMs = Date.now() - startTime;

  logger.info('pHashBackfill', 'Backfill complete', {
    processed,
    errors,
    skipped,
    durationMs,
    imagesPerSecond: Math.round(processed / (durationMs / 1000)),
  });

  return {
    processed,
    errors,
    skipped,
    durationMs,
  };
}

/**
 * Check if backfill is needed
 *
 * @param db - Database instance
 * @returns Object with count of images needing backfill
 */
export function getBackfillStatus(db: Database.Database): {
  needsBackfill: number;
  total: number;
  percentComplete: number;
} {
  const counts = db
    .prepare(
      `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN phash IS NOT NULL THEN 1 ELSE 0 END) as with_phash
    FROM imgs
    WHERE imgloc IS NOT NULL
  `
    )
    .get() as { total: number; with_phash: number };

  const needsBackfill = counts.total - counts.with_phash;
  const percentComplete =
    counts.total > 0 ? Math.round((counts.with_phash / counts.total) * 100) : 100;

  return {
    needsBackfill,
    total: counts.total,
    percentComplete,
  };
}

/**
 * Run backfill as a background job
 *
 * Designed to run on app startup without blocking.
 * Processes images in small batches with delays to avoid impacting performance.
 *
 * @param db - Database instance
 * @param delayBetweenBatches - Delay in ms between batches (default: 100)
 */
export async function runBackfillBackground(
  db: Database.Database,
  delayBetweenBatches = 100
): Promise<void> {
  const status = getBackfillStatus(db);

  if (status.needsBackfill === 0) {
    logger.debug('pHashBackfill', 'No backfill needed, all images have pHash');
    return;
  }

  logger.info('pHashBackfill', `Starting background backfill for ${status.needsBackfill} images`);

  // Get images without pHash, oldest first
  const images = db
    .prepare(
      `
    SELECT imghash, imgloc FROM imgs
    WHERE phash IS NULL AND imgloc IS NOT NULL
    ORDER BY imgadd ASC
    LIMIT 1000
  `
    )
    .all() as Array<{ imghash: string; imgloc: string }>;

  const updateStmt = db.prepare(`UPDATE imgs SET phash = ? WHERE imghash = ?`);
  let processed = 0;
  let errors = 0;

  for (const img of images) {
    try {
      const result = await perceptualHashService.hashFile(img.imgloc);
      updateStmt.run(result.hash, img.imghash);
      processed++;
    } catch {
      errors++;
    }

    // Small delay to avoid blocking main thread
    if ((processed + errors) % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
    }
  }

  logger.info('pHashBackfill', 'Background batch complete', {
    processed,
    errors,
    remaining: status.needsBackfill - processed - errors,
  });
}
