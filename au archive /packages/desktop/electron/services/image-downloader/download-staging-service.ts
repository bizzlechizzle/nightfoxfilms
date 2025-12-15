/**
 * Download Staging Service
 *
 * Downloads image candidates to a staging area for comparison.
 * After comparison, the best version is kept and moved to final location.
 *
 * Staging workflow:
 * 1. Download candidates to staging directory
 * 2. Calculate BLAKE3 hash and pHash for each
 * 3. Compare candidates and select winner
 * 4. Move winner to import pipeline
 * 5. Clean up losers
 *
 * @module services/image-downloader/download-staging-service
 */

import { mkdir, rm, copyFile, writeFile, stat, readdir, unlink } from 'fs/promises';
import { join, extname } from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import sharp from 'sharp';
import type Database from 'better-sqlite3';
import { calculateHash, calculateHashBuffer } from '../crypto-service';
import { perceptualHashService, type PHashResult } from './perceptual-hash-service';
import { getFormatFromContentType } from './url-validator';
import { getLogger } from '../logger-service';

const logger = getLogger();

export interface StagedImage {
  stagingId: string;
  sourceId: string;
  stagingPath: string;
  blake3Hash: string;
  phash: string;
  width: number;
  height: number;
  fileSize: number;
  format: string;
  qualityScore: number;
  url: string;
}

export interface ComparisonGroup {
  groupId: string;
  candidates: StagedImage[];
  winner: StagedImage | null;
}

export interface StagingStats {
  totalStaged: number;
  totalBytes: number;
  oldestFile: Date | null;
}

/**
 * Download Staging Service
 *
 * Manages the staging area for downloaded images.
 */
export class DownloadStagingService {
  private readonly stagingDir: string;
  private readonly db: Database.Database;
  private initialized = false;

  constructor(db: Database.Database, stagingDir: string) {
    this.db = db;
    this.stagingDir = stagingDir;
  }

  /**
   * Initialize the staging directory
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await mkdir(this.stagingDir, { recursive: true });
    this.initialized = true;

    logger.info('DownloadStagingService', 'Initialized staging directory', {
      path: this.stagingDir,
    });
  }

  /**
   * Download an image to staging and collect metadata
   *
   * @param sourceId - ID of the download source record
   * @param url - URL to download
   * @param comparisonGroup - Group ID for comparing candidates
   * @returns Staged image metadata
   */
  async stageImage(
    sourceId: string,
    url: string,
    comparisonGroup: string
  ): Promise<StagedImage> {
    await this.initialize();

    const stagingId = this.generateId();

    logger.debug('DownloadStagingService', 'Staging image', {
      stagingId,
      url,
      comparisonGroup,
    });

    // Download the image
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'image/*,*/*',
      },
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    // Determine file extension
    const contentType = response.headers.get('content-type');
    const format = getFormatFromContentType(contentType) || this.getExtFromUrl(url) || 'jpg';
    const stagingPath = join(this.stagingDir, `${stagingId}.${format}`);

    // Stream download to file
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(stagingPath, buffer);

    // Collect metadata in parallel
    const [blake3Hash, phashResult, metadata, stats] = await Promise.all([
      calculateHashBuffer(buffer),
      perceptualHashService.hashBuffer(buffer),
      this.getImageMetadata(buffer),
      stat(stagingPath),
    ]);

    // Calculate quality score: resolution × format_weight
    const formatWeight = this.getFormatWeight(format);
    const qualityScore = metadata.width * metadata.height * formatWeight;

    const staged: StagedImage = {
      stagingId,
      sourceId,
      stagingPath,
      blake3Hash,
      phash: phashResult.hash,
      width: metadata.width,
      height: metadata.height,
      fileSize: stats.size,
      format,
      qualityScore,
      url,
    };

    // Record in database
    this.db
      .prepare(
        `
      INSERT INTO download_staging
      (staging_id, source_id, staging_path, blake3_hash, phash, width, height, file_size, format, quality_score, comparison_group)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        staged.stagingId,
        staged.sourceId,
        staged.stagingPath,
        staged.blake3Hash,
        staged.phash,
        staged.width,
        staged.height,
        staged.fileSize,
        staged.format,
        staged.qualityScore,
        comparisonGroup
      );

    logger.info('DownloadStagingService', 'Image staged', {
      stagingId,
      size: staged.fileSize,
      dimensions: `${staged.width}x${staged.height}`,
      format: staged.format,
      qualityScore: staged.qualityScore,
    });

    return staged;
  }

  /**
   * Stage an image from a buffer (already downloaded)
   */
  async stageFromBuffer(
    sourceId: string,
    buffer: Buffer,
    format: string,
    comparisonGroup: string,
    url: string
  ): Promise<StagedImage> {
    await this.initialize();

    const stagingId = this.generateId();
    const stagingPath = join(this.stagingDir, `${stagingId}.${format}`);

    await writeFile(stagingPath, buffer);

    const [blake3Hash, phashResult, metadata, stats] = await Promise.all([
      calculateHashBuffer(buffer),
      perceptualHashService.hashBuffer(buffer),
      this.getImageMetadata(buffer),
      stat(stagingPath),
    ]);

    const formatWeight = this.getFormatWeight(format);
    const qualityScore = metadata.width * metadata.height * formatWeight;

    const staged: StagedImage = {
      stagingId,
      sourceId,
      stagingPath,
      blake3Hash,
      phash: phashResult.hash,
      width: metadata.width,
      height: metadata.height,
      fileSize: stats.size,
      format,
      qualityScore,
      url,
    };

    this.db
      .prepare(
        `
      INSERT INTO download_staging
      (staging_id, source_id, staging_path, blake3_hash, phash, width, height, file_size, format, quality_score, comparison_group)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        staged.stagingId,
        staged.sourceId,
        staged.stagingPath,
        staged.blake3Hash,
        staged.phash,
        staged.width,
        staged.height,
        staged.fileSize,
        staged.format,
        staged.qualityScore,
        comparisonGroup
      );

    return staged;
  }

  /**
   * Compare candidates in a group and select winner
   *
   * Selection criteria:
   * 1. Quality score (resolution × format weight)
   * 2. If scores equal, prefer native formats (JPG > WebP)
   * 3. Exact duplicates (same BLAKE3) are deduplicated
   *
   * @param comparisonGroup - Group ID to compare
   * @returns The winning staged image, or null if no candidates
   */
  async selectWinner(comparisonGroup: string): Promise<StagedImage | null> {
    const candidates = this.db
      .prepare(
        `
      SELECT * FROM download_staging
      WHERE comparison_group = ?
      ORDER BY quality_score DESC, file_size DESC
    `
      )
      .all(comparisonGroup) as Array<{
      staging_id: string;
      source_id: string;
      staging_path: string;
      blake3_hash: string;
      phash: string;
      width: number;
      height: number;
      file_size: number;
      format: string;
      quality_score: number;
    }>;

    if (candidates.length === 0) {
      logger.debug('DownloadStagingService', 'No candidates in group', {
        comparisonGroup,
      });
      return null;
    }

    // Check for exact duplicates (same BLAKE3 hash)
    const uniqueByHash = new Map<
      string,
      (typeof candidates)[0] & { url?: string }
    >();
    for (const c of candidates) {
      if (
        !uniqueByHash.has(c.blake3_hash) ||
        c.quality_score > uniqueByHash.get(c.blake3_hash)!.quality_score
      ) {
        uniqueByHash.set(c.blake3_hash, c);
      }
    }

    // Get highest quality among unique images
    const winner = [...uniqueByHash.values()].sort(
      (a, b) => b.quality_score - a.quality_score
    )[0];

    // Mark winner in database
    this.db
      .prepare(`UPDATE download_staging SET is_selected = 1 WHERE staging_id = ?`)
      .run(winner.staging_id);

    logger.info('DownloadStagingService', 'Selected winner', {
      comparisonGroup,
      winnerId: winner.staging_id,
      qualityScore: winner.quality_score,
      dimensions: `${winner.width}x${winner.height}`,
      candidateCount: candidates.length,
      uniqueCount: uniqueByHash.size,
    });

    // Get source URL from download_sources
    const source = this.db
      .prepare(`SELECT source_url FROM download_sources WHERE source_id = ?`)
      .get(winner.source_id) as { source_url: string } | undefined;

    return {
      stagingId: winner.staging_id,
      sourceId: winner.source_id,
      stagingPath: winner.staging_path,
      blake3Hash: winner.blake3_hash,
      phash: winner.phash,
      width: winner.width,
      height: winner.height,
      fileSize: winner.file_size,
      format: winner.format,
      qualityScore: winner.quality_score,
      url: source?.source_url || '',
    };
  }

  /**
   * Clean up staging - delete non-winners from a comparison group
   */
  async cleanupGroup(comparisonGroup: string): Promise<number> {
    const losers = this.db
      .prepare(
        `
      SELECT staging_id, staging_path FROM download_staging
      WHERE comparison_group = ? AND is_selected = 0
    `
      )
      .all(comparisonGroup) as Array<{ staging_id: string; staging_path: string }>;

    let deleted = 0;

    for (const loser of losers) {
      try {
        await rm(loser.staging_path, { force: true });
        deleted++;
      } catch (err) {
        logger.warn('DownloadStagingService', `Failed to delete ${loser.staging_path}`, {
          error: (err as Error).message,
        });
      }
    }

    // Remove from database
    this.db
      .prepare(
        `DELETE FROM download_staging WHERE comparison_group = ? AND is_selected = 0`
      )
      .run(comparisonGroup);

    logger.debug('DownloadStagingService', 'Cleaned up group', {
      comparisonGroup,
      deleted,
    });

    return deleted;
  }

  /**
   * Get a staged image by ID
   */
  getStagedImage(stagingId: string): StagedImage | null {
    const row = this.db
      .prepare(
        `
      SELECT s.*, d.source_url
      FROM download_staging s
      LEFT JOIN download_sources d ON s.source_id = d.source_id
      WHERE s.staging_id = ?
    `
      )
      .get(stagingId) as
      | (Record<string, unknown> & { source_url?: string })
      | undefined;

    if (!row) return null;

    return {
      stagingId: row.staging_id as string,
      sourceId: row.source_id as string,
      stagingPath: row.staging_path as string,
      blake3Hash: row.blake3_hash as string,
      phash: row.phash as string,
      width: row.width as number,
      height: row.height as number,
      fileSize: row.file_size as number,
      format: row.format as string,
      qualityScore: row.quality_score as number,
      url: row.source_url || '',
    };
  }

  /**
   * Move winner to final destination (for import pipeline)
   *
   * @param stagingId - Staging ID of the winner
   * @param finalPath - Destination path
   * @returns The BLAKE3 hash of the file
   */
  async promoteWinner(stagingId: string, finalPath: string): Promise<string> {
    const staged = this.getStagedImage(stagingId);

    if (!staged) {
      throw new Error(`Staged image not found: ${stagingId}`);
    }

    // Copy to final location
    await copyFile(staged.stagingPath, finalPath);

    // Delete staging file
    await rm(staged.stagingPath, { force: true });

    // Remove from staging table
    this.db.prepare(`DELETE FROM download_staging WHERE staging_id = ?`).run(stagingId);

    logger.info('DownloadStagingService', 'Promoted winner to final location', {
      stagingId,
      finalPath,
      hash: staged.blake3Hash,
    });

    return staged.blake3Hash;
  }

  /**
   * Get staging statistics
   */
  async getStats(): Promise<StagingStats> {
    await this.initialize();

    const dbStats = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as total_staged,
        COALESCE(SUM(file_size), 0) as total_bytes,
        MIN(created_at) as oldest
      FROM download_staging
    `
      )
      .get() as { total_staged: number; total_bytes: number; oldest: string | null };

    return {
      totalStaged: dbStats.total_staged,
      totalBytes: dbStats.total_bytes,
      oldestFile: dbStats.oldest ? new Date(dbStats.oldest) : null,
    };
  }

  /**
   * Clean up old staging files (older than specified hours)
   */
  async cleanupOld(maxAgeHours = 24): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();

    const old = this.db
      .prepare(
        `
      SELECT staging_id, staging_path FROM download_staging
      WHERE created_at < ?
    `
      )
      .all(cutoff) as Array<{ staging_id: string; staging_path: string }>;

    let deleted = 0;

    for (const item of old) {
      try {
        await rm(item.staging_path, { force: true });
        deleted++;
      } catch {
        // File might already be deleted
      }
    }

    this.db.prepare(`DELETE FROM download_staging WHERE created_at < ?`).run(cutoff);

    logger.info('DownloadStagingService', 'Cleaned up old staging files', {
      deleted,
      maxAgeHours,
    });

    return deleted;
  }

  /**
   * Clear all staging (for testing or reset)
   */
  async clearAll(): Promise<number> {
    const all = this.db
      .prepare(`SELECT staging_path FROM download_staging`)
      .all() as Array<{ staging_path: string }>;

    for (const item of all) {
      try {
        await rm(item.staging_path, { force: true });
      } catch {
        // Ignore
      }
    }

    const result = this.db.prepare(`DELETE FROM download_staging`).run();

    logger.info('DownloadStagingService', 'Cleared all staging', {
      deleted: result.changes,
    });

    return result.changes;
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private generateId(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private async getImageMetadata(
    buffer: Buffer
  ): Promise<{ width: number; height: number }> {
    try {
      const metadata = await sharp(buffer).metadata();
      return {
        width: metadata.width || 0,
        height: metadata.height || 0,
      };
    } catch {
      return { width: 0, height: 0 };
    }
  }

  private getFormatWeight(format: string): number {
    const row = this.db
      .prepare(`SELECT quality_weight FROM format_preferences WHERE format = ?`)
      .get(format.toLowerCase()) as { quality_weight: number } | undefined;

    return row?.quality_weight ?? 0.5;
  }

  private getExtFromUrl(url: string): string | null {
    try {
      const pathname = new URL(url).pathname;
      const ext = extname(pathname).slice(1).toLowerCase();
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'tiff'].includes(ext)) {
        return ext;
      }
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * Create a download staging service instance
 */
export function createDownloadStagingService(
  db: Database.Database,
  stagingDir: string
): DownloadStagingService {
  return new DownloadStagingService(db, stagingDir);
}
