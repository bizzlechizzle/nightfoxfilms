/**
 * Download Orchestrator
 *
 * Coordinates the full image download workflow:
 * 1. Discover image URLs on page (via existing websource-extraction)
 * 2. Transform URLs to find full-resolution candidates
 * 3. Download candidates to staging
 * 4. Select best version using perceptual hashing
 * 5. Check for duplicates in archive
 * 6. Hand off to import pipeline
 *
 * @module services/image-downloader/download-orchestrator
 */

import type Database from 'better-sqlite3';
import { join } from 'path';
import {
  UrlPatternTransformer,
  createUrlPatternTransformer,
  type TransformResult,
} from './url-pattern-transformer';
import {
  DownloadStagingService,
  createDownloadStagingService,
  type StagedImage,
} from './download-staging-service';
import {
  perceptualHashService,
  type SimilarImage,
} from './perceptual-hash-service';
import {
  validateImageUrl,
  findBestUrl,
  isLikelyThumbnail,
  type UrlValidation,
} from './url-validator';
import { getLogger } from '../logger-service';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface DiscoveredImage {
  url: string;
  alt?: string;
  srcset?: string[];
  width?: number;
  height?: number;
  context?: {
    parentElement?: string;
    caption?: string;
    linkUrl?: string;
  };
}

export interface ProcessedImage {
  originalUrl: string;
  selectedUrl: string | null;
  staged: StagedImage | null;
  existingDuplicate: SimilarImage | null;
  candidateCount: number;
  stagedCount: number;
  status: 'staged' | 'duplicate' | 'failed' | 'skipped';
  error?: string;
}

export interface ProcessPageResult {
  pageUrl: string;
  images: ProcessedImage[];
  totalDiscovered: number;
  totalStaged: number;
  totalDuplicates: number;
  totalFailed: number;
  durationMs: number;
}

export interface ProcessPageOptions {
  /** Progress callback */
  onProgress?: (stage: string, current: number, total: number) => void;
  /** Called when an image URL is discovered */
  onImageFound?: (url: string) => void;
  /** Called when an image is staged */
  onImageStaged?: (staged: StagedImage) => void;
  /** Minimum image width to include */
  minWidth?: number;
  /** Minimum image height to include */
  minHeight?: number;
  /** Maximum images to process */
  maxImages?: number;
  /** Skip thumbnail-like URLs */
  skipThumbnails?: boolean;
  /** Check for duplicates before downloading */
  checkDuplicates?: boolean;
  /** Hamming distance threshold for duplicate detection */
  duplicateThreshold?: number;
}

export interface SourceRecord {
  sourceId: string;
  sourceUrl: string;
  pageUrl: string;
  siteDomain: string;
  status: string;
}

// ============================================================================
// Orchestrator
// ============================================================================

/**
 * Download Orchestrator
 *
 * Main entry point for the image downloading system.
 */
export class DownloadOrchestrator {
  private readonly urlTransformer: UrlPatternTransformer;
  private readonly stagingService: DownloadStagingService;
  private readonly db: Database.Database;

  constructor(db: Database.Database, stagingDir: string) {
    this.db = db;
    this.urlTransformer = createUrlPatternTransformer(db);
    this.stagingService = createDownloadStagingService(db, stagingDir);
  }

  /**
   * Initialize the orchestrator
   * Should be called before processing
   */
  async initialize(): Promise<void> {
    await this.stagingService.initialize();

    // Seed built-in URL patterns if not already done
    const patternCount = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM url_patterns`)
      .get() as { cnt: number };

    if (patternCount.cnt === 0) {
      this.urlTransformer.seedBuiltinPatterns();
    }

    logger.info('DownloadOrchestrator', 'Initialized');
  }

  /**
   * Process a list of discovered images
   *
   * For each image:
   * 1. Find full-resolution candidates using URL patterns
   * 2. Validate candidates (HEAD request)
   * 3. Download best candidate to staging
   * 4. Check for duplicates in archive
   * 5. Return results for user selection
   */
  async processImages(
    images: DiscoveredImage[],
    pageUrl: string,
    options: ProcessPageOptions = {}
  ): Promise<ProcessPageResult> {
    const startTime = Date.now();
    const {
      onProgress,
      onImageFound,
      onImageStaged,
      minWidth = 100,
      minHeight = 100,
      maxImages = 100,
      skipThumbnails = false,
      checkDuplicates = true,
      duplicateThreshold = 5,
    } = options;

    // Filter and limit images
    let filtered = images.slice(0, maxImages);
    if (skipThumbnails) {
      filtered = filtered.filter((img) => !isLikelyThumbnail(img.url));
    }

    const results: ProcessedImage[] = [];
    const total = filtered.length;

    let totalStaged = 0;
    let totalDuplicates = 0;
    let totalFailed = 0;

    for (let i = 0; i < filtered.length; i++) {
      const img = filtered[i];
      onProgress?.('processing', i + 1, total);
      onImageFound?.(img.url);

      try {
        const result = await this.processImage(img, pageUrl, {
          minWidth,
          minHeight,
          checkDuplicates,
          duplicateThreshold,
        });

        results.push(result);

        if (result.staged) {
          totalStaged++;
          onImageStaged?.(result.staged);
        }
        if (result.existingDuplicate) {
          totalDuplicates++;
        }
        if (result.status === 'failed') {
          totalFailed++;
        }
      } catch (err) {
        logger.error(
          'DownloadOrchestrator',
          `Failed to process image ${img.url}`,
          err as Error
        );

        results.push({
          originalUrl: img.url,
          selectedUrl: null,
          staged: null,
          existingDuplicate: null,
          candidateCount: 0,
          stagedCount: 0,
          status: 'failed',
          error: (err as Error).message,
        });
        totalFailed++;
      }
    }

    const durationMs = Date.now() - startTime;

    logger.info('DownloadOrchestrator', 'Page processing complete', {
      pageUrl,
      totalDiscovered: images.length,
      totalProcessed: filtered.length,
      totalStaged,
      totalDuplicates,
      totalFailed,
      durationMs,
    });

    return {
      pageUrl,
      images: results,
      totalDiscovered: images.length,
      totalStaged,
      totalDuplicates,
      totalFailed,
      durationMs,
    };
  }

  /**
   * Process a single image
   */
  private async processImage(
    img: DiscoveredImage,
    pageUrl: string,
    options: {
      minWidth: number;
      minHeight: number;
      checkDuplicates: boolean;
      duplicateThreshold: number;
    }
  ): Promise<ProcessedImage> {
    const comparisonGroup = this.generateId();
    const candidates: Array<{
      url: string;
      patternId: string | null;
      confidence: number;
    }> = [];

    // Original URL is a candidate
    candidates.push({ url: img.url, patternId: null, confidence: 0.5 });

    // Add srcset variants if available
    if (img.srcset && img.srcset.length > 0) {
      for (const variant of img.srcset) {
        candidates.push({ url: variant, patternId: null, confidence: 0.6 });
      }
    }

    // Apply URL patterns to find full-res versions
    const transformResults = this.urlTransformer.transform(img.url);
    for (const result of transformResults) {
      candidates.push({
        url: result.transformedUrl,
        patternId: result.patternId,
        confidence: result.confidence,
      });
    }

    // Sort by confidence (highest first)
    candidates.sort((a, b) => b.confidence - a.confidence);

    // Validate and stage candidates
    let stagedCount = 0;

    for (const candidate of candidates) {
      try {
        // Quick validation first
        const validation = await validateImageUrl(candidate.url);

        if (!validation.exists || !validation.isImage) {
          if (candidate.patternId) {
            this.urlTransformer.recordOutcome(candidate.patternId, false);
          }
          continue;
        }

        // Check minimum dimensions if provided by validation
        // (Some servers return dimensions in headers)
        const headerWidth = parseInt(
          validation.headers['x-amz-meta-width'] || '0',
          10
        );
        const headerHeight = parseInt(
          validation.headers['x-amz-meta-height'] || '0',
          10
        );

        if (headerWidth > 0 && headerHeight > 0) {
          if (headerWidth < options.minWidth || headerHeight < options.minHeight) {
            continue;
          }
        }

        // Create source record
        const sourceId = this.recordSource(candidate.url, pageUrl, validation);

        // Download to staging
        const stagedImg = await this.stagingService.stageImage(
          sourceId,
          candidate.url,
          comparisonGroup
        );
        stagedCount++;

        // Check dimensions after download
        if (
          stagedImg.width < options.minWidth ||
          stagedImg.height < options.minHeight
        ) {
          // Too small, but keep for comparison
          continue;
        }

        // Record pattern success
        if (candidate.patternId) {
          this.urlTransformer.recordOutcome(candidate.patternId, true);
        }

        // Update source status
        this.updateSourceStatus(sourceId, 'staging');
      } catch (err) {
        logger.warn(
          'DownloadOrchestrator',
          `Failed to stage ${candidate.url}`,
          { error: (err as Error).message }
        );

        if (candidate.patternId) {
          this.urlTransformer.recordOutcome(candidate.patternId, false);
        }
      }
    }

    // Select winner from staged candidates
    const winner = await this.stagingService.selectWinner(comparisonGroup);

    if (!winner) {
      // No valid candidates staged
      await this.stagingService.cleanupGroup(comparisonGroup);

      return {
        originalUrl: img.url,
        selectedUrl: null,
        staged: null,
        existingDuplicate: null,
        candidateCount: candidates.length,
        stagedCount,
        status: 'failed',
        error: 'No valid candidates',
      };
    }

    // Check for duplicates in archive
    let existingDuplicate: SimilarImage | null = null;

    if (options.checkDuplicates) {
      existingDuplicate = perceptualHashService.findDuplicate(
        this.db,
        winner.phash,
        options.duplicateThreshold
      );

      if (existingDuplicate) {
        // Mark source as duplicate
        const source = this.db
          .prepare(
            `SELECT source_id FROM download_sources WHERE source_url = ?`
          )
          .get(winner.url) as { source_id: string } | undefined;

        if (source) {
          this.updateSourceStatus(source.source_id, 'duplicate');
        }
      }
    }

    // Cleanup losers
    await this.stagingService.cleanupGroup(comparisonGroup);

    return {
      originalUrl: img.url,
      selectedUrl: winner.url,
      staged: winner,
      existingDuplicate,
      candidateCount: candidates.length,
      stagedCount,
      status: existingDuplicate ? 'duplicate' : 'staged',
    };
  }

  /**
   * Import a staged image to a location
   * Moves from staging to final archive location
   */
  async importStagedImage(
    stagingId: string,
    locationId: string,
    archivePath: string
  ): Promise<{ imghash: string; finalPath: string }> {
    const staged = this.stagingService.getStagedImage(stagingId);

    if (!staged) {
      throw new Error(`Staged image not found: ${stagingId}`);
    }

    // Determine final path using archive structure
    // [archive]/locations/[STATE]/[LOCID]/data/org-img/[hash].[ext]
    const location = this.db
      .prepare(`SELECT address_state FROM locs WHERE locid = ?`)
      .get(locationId) as { address_state: string } | undefined;

    const state = location?.address_state || 'XX';
    const finalDir = join(
      archivePath,
      'locations',
      state,
      locationId,
      'data',
      'org-img'
    );
    const finalPath = join(finalDir, `${staged.blake3Hash}.${staged.format}`);

    // Promote winner (copies and cleans up staging)
    await this.stagingService.promoteWinner(stagingId, finalPath);

    // Update source record
    const source = this.db
      .prepare(`SELECT source_id FROM download_sources WHERE source_url = ?`)
      .get(staged.url) as { source_id: string } | undefined;

    if (source) {
      this.db
        .prepare(
          `
        UPDATE download_sources
        SET status = 'completed', imghash = ?, downloaded_at = datetime('now')
        WHERE source_id = ?
      `
        )
        .run(staged.blake3Hash, source.source_id);
    }

    logger.info('DownloadOrchestrator', 'Imported staged image', {
      stagingId,
      locationId,
      imghash: staged.blake3Hash,
      finalPath,
    });

    return {
      imghash: staged.blake3Hash,
      finalPath,
    };
  }

  /**
   * Get download history for a page
   */
  getPageHistory(pageUrl: string): SourceRecord[] {
    return this.db
      .prepare(
        `
      SELECT source_id, source_url, page_url, site_domain, status
      FROM download_sources
      WHERE page_url = ?
      ORDER BY created_at DESC
    `
      )
      .all(pageUrl) as SourceRecord[];
  }

  /**
   * Get all pending downloads
   */
  getPendingDownloads(): SourceRecord[] {
    return this.db
      .prepare(
        `
      SELECT source_id, source_url, page_url, site_domain, status
      FROM download_sources
      WHERE status = 'pending'
      ORDER BY created_at ASC
    `
      )
      .all() as SourceRecord[];
  }

  /**
   * Get staging service for direct access
   */
  getStagingService(): DownloadStagingService {
    return this.stagingService;
  }

  /**
   * Get URL transformer for direct access
   */
  getUrlTransformer(): UrlPatternTransformer {
    return this.urlTransformer;
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private generateId(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private recordSource(
    url: string,
    pageUrl: string,
    validation: UrlValidation
  ): string {
    const sourceId = this.generateId();
    const domain = new URL(url).hostname;

    this.db
      .prepare(
        `
      INSERT INTO download_sources (source_id, source_url, page_url, site_domain, status, file_size, format)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `
      )
      .run(
        sourceId,
        url,
        pageUrl,
        domain,
        validation.contentLength,
        validation.contentType?.split('/')[1] || null
      );

    return sourceId;
  }

  private updateSourceStatus(sourceId: string, status: string): void {
    this.db
      .prepare(
        `UPDATE download_sources SET status = ?, updated_at = datetime('now') WHERE source_id = ?`
      )
      .run(status, sourceId);
  }
}

/**
 * Create a download orchestrator instance
 */
export function createDownloadOrchestrator(
  db: Database.Database,
  stagingDir: string
): DownloadOrchestrator {
  return new DownloadOrchestrator(db, stagingDir);
}
