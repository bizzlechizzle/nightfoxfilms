/**
 * Image Downloader IPC Handlers
 *
 * Exposes the intelligent image downloading system to the renderer:
 * - URL pattern transformation for full-resolution image discovery
 * - Perceptual hashing for duplicate detection
 * - Download staging and candidate comparison
 * - pHash backfill for existing images
 *
 * IPC Channel Pattern: `downloader:action`
 *
 * @module ipc-handlers/image-downloader
 */

import { ipcMain, app } from 'electron';
import { z } from 'zod';
import path from 'path';
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';
import { Blake3IdSchema } from '../ipc-validation';
import {
  DownloadOrchestrator,
  createDownloadOrchestrator,
  type DiscoveredImage,
  type ProcessPageOptions,
} from '../../services/image-downloader/download-orchestrator';
import {
  perceptualHashService,
  pHashDistance,
  arePHashSimilar,
} from '../../services/image-downloader/perceptual-hash-service';
import {
  backfillPerceptualHashes,
  getBackfillStatus,
  runBackfillBackground,
} from '../../services/image-downloader/phash-backfill-job';
import {
  urlPatternTransformer,
  createUrlPatternTransformer,
} from '../../services/image-downloader/url-pattern-transformer';
import {
  validateImageUrl,
  validateImageUrls,
  findBestUrl,
} from '../../services/image-downloader/url-validator';
import {
  imageEnhanceService,
  type EnhanceOptions,
} from '../../services/image-downloader/image-enhance-service';
import {
  imageSourceDiscovery,
  applySitePatterns,
  parseSrcset,
} from '../../services/image-downloader/image-source-discovery';
import {
  imageQualityAnalyzer,
  type ImageQualityReport,
} from '../../services/image-downloader/image-quality-analyzer';
import {
  getGlobalMonitor,
  scanPageForImages,
} from '../../services/image-downloader/browser-image-capture';
import type BetterSqlite3 from 'better-sqlite3';
import { JobQueue, IMPORT_QUEUES, JOB_PRIORITY } from '../../services/job-queue';
import {
  queueImageProcessingJobs,
  queueLocationPostProcessing,
} from '../../services/import/job-builder';

// Singleton orchestrator instance
let orchestrator: DownloadOrchestrator | null = null;

/**
 * Get or create the download orchestrator instance
 */
async function getOrchestrator(db: Kysely<Database>): Promise<DownloadOrchestrator> {
  if (!orchestrator) {
    // Get staging directory from settings or use default
    const result = await db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'archive_folder')
      .executeTakeFirst();

    const archivePath = result?.value || path.join(app.getPath('userData'), 'archive');
    const stagingDir = path.join(archivePath, '.staging');

    // Get raw SQLite connection from Kysely for better-sqlite3 operations
    // The orchestrator needs direct access for prepared statements
    const rawDb = (db as unknown as { connection: { client: BetterSqlite3.Database } }).connection?.client;

    if (!rawDb) {
      throw new Error('Could not get raw database connection');
    }

    orchestrator = createDownloadOrchestrator(rawDb, stagingDir);
    await orchestrator.initialize();
  }
  return orchestrator;
}

/**
 * Get raw SQLite database for direct operations
 */
function getRawDb(db: Kysely<Database>): BetterSqlite3.Database {
  const rawDb = (db as unknown as { connection: { client: BetterSqlite3.Database } }).connection?.client;
  if (!rawDb) {
    throw new Error('Could not get raw database connection');
  }
  return rawDb;
}

export function registerImageDownloaderHandlers(db: Kysely<Database>) {
  // ============================================================================
  // URL Pattern Transformation
  // ============================================================================

  /**
   * Transform a URL using known patterns to find full-resolution versions
   */
  ipcMain.handle('downloader:transformUrl', async (_event, url: unknown) => {
    try {
      const validUrl = z.string().url().parse(url);
      const transformer = createUrlPatternTransformer(getRawDb(db));
      const results = transformer.transform(validUrl);
      return { success: true, results };
    } catch (error) {
      console.error('Error transforming URL:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Add a new URL pattern
   */
  ipcMain.handle('downloader:addPattern', async (_event, pattern: unknown) => {
    try {
      const validPattern = z.object({
        name: z.string().min(1),
        siteType: z.enum(['wordpress', 'cdn', 'hosting', 'generic']),
        domainRegex: z.string().min(1),
        pathRegex: z.string().min(1),
        transformJs: z.string().min(1),
        testInput: z.string().optional(),
        testExpected: z.string().optional(),
      }).parse(pattern);

      // Generate pattern ID from name
      const patternId = validPattern.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .substring(0, 32);

      const transformer = createUrlPatternTransformer(getRawDb(db));
      transformer.addPattern({
        patternId,
        name: validPattern.name,
        siteType: validPattern.siteType,
        domainRegex: validPattern.domainRegex,
        pathRegex: validPattern.pathRegex,
        transformJs: validPattern.transformJs,
        testInput: validPattern.testInput,
        testExpected: validPattern.testExpected,
      });

      return { success: true, patternId };
    } catch (error) {
      console.error('Error adding URL pattern:', error);
      if (error instanceof z.ZodError) {
        return { success: false, error: `Validation error: ${error.errors.map(e => e.message).join(', ')}` };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Get all URL patterns
   */
  ipcMain.handle('downloader:getPatterns', async () => {
    try {
      const transformer = createUrlPatternTransformer(getRawDb(db));
      const patterns = transformer.getAllPatterns();
      return { success: true, patterns };
    } catch (error) {
      console.error('Error getting URL patterns:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // URL Validation
  // ============================================================================

  /**
   * Validate a single image URL (HEAD request)
   */
  ipcMain.handle('downloader:validateUrl', async (_event, url: unknown) => {
    try {
      const validUrl = z.string().url().parse(url);
      const result = await validateImageUrl(validUrl);
      return { success: true, validation: result };
    } catch (error) {
      console.error('Error validating URL:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Validate multiple URLs and return valid ones
   */
  ipcMain.handle('downloader:validateUrls', async (_event, urls: unknown) => {
    try {
      const validUrls = z.array(z.string().url()).parse(urls);
      const results = await validateImageUrls(validUrls);
      return { success: true, results };
    } catch (error) {
      console.error('Error validating URLs:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Find best URL from candidates
   */
  ipcMain.handle('downloader:findBestUrl', async (_event, input: unknown) => {
    try {
      const validInput = z.object({
        candidates: z.array(z.object({
          url: z.string().url(),
          confidence: z.number().min(0).max(1),
          patternId: z.string().nullable().optional(),
        })),
      }).parse(input);

      const candidatesWithPatternId = validInput.candidates.map(c => ({
        ...c,
        patternId: c.patternId ?? null,
      }));

      const result = await findBestUrl(candidatesWithPatternId);
      return { success: true, best: result };
    } catch (error) {
      console.error('Error finding best URL:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // Smart Image Enhance
  // ============================================================================

  /**
   * Find the highest resolution version of an image URL
   * Uses recursive suffix stripping and multi-site patterns
   */
  ipcMain.handle('downloader:enhanceUrl', async (_event, input: unknown) => {
    try {
      const validInput = z.object({
        url: z.string().url(),
        options: z.object({
          maxCandidates: z.number().int().min(1).max(100).optional(),
          headTimeout: z.number().int().min(1000).max(30000).optional(),
          preferTraditionalFormats: z.boolean().optional(),
          maxDepth: z.number().int().min(1).max(10).optional(),
          validate: z.boolean().optional(),
        }).optional(),
      }).parse(input);

      const result = await imageEnhanceService.enhance(
        validInput.url,
        validInput.options as EnhanceOptions
      );

      return {
        success: true,
        originalUrl: result.originalUrl,
        bestUrl: result.bestUrl,
        bestSize: result.bestSize,
        improvement: result.improvement,
        candidateCount: result.allCandidates.length,
        validCount: result.allCandidates.filter(c => c.exists).length,
      };
    } catch (error) {
      console.error('Error enhancing URL:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Batch enhance multiple URLs
   */
  ipcMain.handle('downloader:enhanceUrls', async (event, input: unknown) => {
    try {
      const validInput = z.object({
        urls: z.array(z.string().url()),
        options: z.object({
          maxCandidates: z.number().int().min(1).max(100).optional(),
          headTimeout: z.number().int().min(1000).max(30000).optional(),
          preferTraditionalFormats: z.boolean().optional(),
          maxDepth: z.number().int().min(1).max(10).optional(),
          validate: z.boolean().optional(),
        }).optional(),
      }).parse(input);

      const results = await imageEnhanceService.enhanceBatch(
        validInput.urls,
        validInput.options as EnhanceOptions
      );

      // Send progress for each URL
      results.forEach((result, index) => {
        event.sender.send('downloader:enhanceProgress', {
          current: index + 1,
          total: validInput.urls.length,
          url: result.originalUrl,
          bestUrl: result.bestUrl,
          improvement: result.improvement,
        });
      });

      return {
        success: true,
        results: results.map(r => ({
          originalUrl: r.originalUrl,
          bestUrl: r.bestUrl,
          bestSize: r.bestSize,
          improvement: r.improvement,
        })),
      };
    } catch (error) {
      console.error('Error batch enhancing URLs:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // Perceptual Hashing
  // ============================================================================

  /**
   * Calculate perceptual hash for a file
   */
  ipcMain.handle('downloader:hashFile', async (_event, filePath: unknown) => {
    try {
      const validPath = z.string().min(1).parse(filePath);
      const result = await perceptualHashService.hashFile(validPath);
      return { success: true, ...result };
    } catch (error) {
      console.error('Error hashing file:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Calculate Hamming distance between two pHash values
   */
  ipcMain.handle('downloader:pHashDistance', async (_event, hash1: unknown, hash2: unknown) => {
    try {
      const validHash1 = z.string().length(16).regex(/^[a-f0-9]+$/).parse(hash1);
      const validHash2 = z.string().length(16).regex(/^[a-f0-9]+$/).parse(hash2);
      const distance = pHashDistance(validHash1, validHash2);
      const similar = arePHashSimilar(validHash1, validHash2);
      return { success: true, distance, similar };
    } catch (error) {
      console.error('Error calculating pHash distance:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Find similar images in the archive by pHash
   */
  ipcMain.handle('downloader:findSimilar', async (_event, input: unknown) => {
    try {
      const validInput = z.object({
        phash: z.string().length(16).regex(/^[a-f0-9]+$/),
        threshold: z.number().int().min(0).max(64).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }).parse(input);

      const allSimilar = perceptualHashService.findSimilarInDb(
        getRawDb(db),
        validInput.phash,
        validInput.threshold ?? 5
      );

      // Apply limit
      const limit = validInput.limit ?? 10;
      const similar = allSimilar.slice(0, limit);

      return { success: true, similar };
    } catch (error) {
      console.error('Error finding similar images:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Check if an image is a duplicate based on pHash
   */
  ipcMain.handle('downloader:checkDuplicate', async (_event, phash: unknown) => {
    try {
      const validPhash = z.string().length(16).regex(/^[a-f0-9]+$/).parse(phash);
      const duplicate = perceptualHashService.findDuplicate(getRawDb(db), validPhash, 5);
      return { success: true, isDuplicate: !!duplicate, duplicate };
    } catch (error) {
      console.error('Error checking duplicate:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // pHash Backfill
  // ============================================================================

  /**
   * Get backfill status (how many images need pHash)
   */
  ipcMain.handle('downloader:getBackfillStatus', async () => {
    try {
      const status = getBackfillStatus(getRawDb(db));
      return { success: true, ...status };
    } catch (error) {
      console.error('Error getting backfill status:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Run pHash backfill job (with progress reporting)
   */
  ipcMain.handle('downloader:runBackfill', async (event, options: unknown) => {
    try {
      const validOptions = z.object({
        batchSize: z.number().int().min(1).max(500).optional(),
      }).optional().parse(options);

      const result = await backfillPerceptualHashes(
        getRawDb(db),
        (progress) => {
          // Send progress updates to renderer
          event.sender.send('downloader:backfillProgress', progress);
        },
        validOptions?.batchSize ?? 50
      );

      return { success: true, ...result };
    } catch (error) {
      console.error('Error running backfill:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Start background backfill (non-blocking, runs on startup)
   */
  ipcMain.handle('downloader:startBackgroundBackfill', async () => {
    try {
      // Run in background without blocking
      runBackfillBackground(getRawDb(db)).catch((err) => {
        console.error('Background backfill error:', err);
      });
      return { success: true, message: 'Background backfill started' };
    } catch (error) {
      console.error('Error starting background backfill:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // Download Orchestration
  // ============================================================================

  /**
   * Process discovered images from a page
   */
  ipcMain.handle('downloader:processImages', async (event, input: unknown) => {
    try {
      const validInput = z.object({
        images: z.array(z.object({
          url: z.string().url(),
          alt: z.string().optional(),
          srcset: z.array(z.string()).optional(),
          width: z.number().optional(),
          height: z.number().optional(),
          context: z.object({
            parentElement: z.string().optional(),
            caption: z.string().optional(),
            linkUrl: z.string().optional(),
          }).optional(),
        })),
        pageUrl: z.string().url(),
        options: z.object({
          minWidth: z.number().int().min(0).optional(),
          minHeight: z.number().int().min(0).optional(),
          maxImages: z.number().int().min(1).max(500).optional(),
          skipThumbnails: z.boolean().optional(),
          checkDuplicates: z.boolean().optional(),
          duplicateThreshold: z.number().int().min(0).max(64).optional(),
        }).optional(),
      }).parse(input);

      const orch = await getOrchestrator(db);

      const options: ProcessPageOptions = {
        ...validInput.options,
        onProgress: (stage, current, total) => {
          event.sender.send('downloader:processProgress', { stage, current, total });
        },
        onImageFound: (url) => {
          event.sender.send('downloader:imageFound', { url });
        },
        onImageStaged: (staged) => {
          event.sender.send('downloader:imageStaged', staged);
        },
      };

      const result = await orch.processImages(
        validInput.images as DiscoveredImage[],
        validInput.pageUrl,
        options
      );

      return { success: true, result };
    } catch (error) {
      console.error('Error processing images:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Import a staged image to a location
   */
  ipcMain.handle('downloader:importStaged', async (_event, input: unknown) => {
    try {
      const validInput = z.object({
        stagingId: z.string().min(1),
        locationId: Blake3IdSchema,
      }).parse(input);

      const orch = await getOrchestrator(db);

      // Get archive path from settings
      const archiveResult = await db
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'archive_folder')
        .executeTakeFirst();

      if (!archiveResult?.value) {
        throw new Error('Archive folder not configured');
      }

      const result = await orch.importStagedImage(
        validInput.stagingId,
        validInput.locationId,
        archiveResult.value
      );

      // Queue ALL standard image processing jobs using unified job builder
      // Per docs/plans/unified-image-processing-pipeline.md:
      // - ExifTool (metadata extraction)
      // - Thumbnail generation
      // - RAM++ tagging
      // - Location-level jobs (GPS enrichment, stats, BagIt, etc.)
      try {
        // Queue per-file processing jobs
        const imageJobResult = await queueImageProcessingJobs(db, {
          imghash: result.imghash,
          archivePath: result.finalPath,
          locid: validInput.locationId,
          subid: null, // Web imports don't have sub-locations
        });

        // Queue location-level post-processing jobs
        // These aggregate data and update manifests
        await queueLocationPostProcessing(db, {
          locid: validInput.locationId,
          subid: null,
          lastExifJobId: imageJobResult.exifJobId ?? undefined,
          hasImages: true,
          hasDocuments: false,
        });

        console.log(`[ImageDownloader] Queued ${imageJobResult.jobs.length} processing jobs for web image ${result.imghash.slice(0, 8)}...`);
      } catch (jobError) {
        // Non-fatal: don't fail import if job queue fails
        console.warn('[ImageDownloader] Failed to queue processing jobs (non-fatal):', jobError);
      }

      return { success: true, ...result };
    } catch (error) {
      console.error('Error importing staged image:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Get download history for a page
   */
  ipcMain.handle('downloader:getPageHistory', async (_event, pageUrl: unknown) => {
    try {
      const validUrl = z.string().url().parse(pageUrl);
      const orch = await getOrchestrator(db);
      const history = orch.getPageHistory(validUrl);
      return { success: true, history };
    } catch (error) {
      console.error('Error getting page history:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Get all pending downloads
   */
  ipcMain.handle('downloader:getPending', async () => {
    try {
      const orch = await getOrchestrator(db);
      const pending = orch.getPendingDownloads();
      return { success: true, pending };
    } catch (error) {
      console.error('Error getting pending downloads:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Get staging stats
   */
  ipcMain.handle('downloader:getStagingStats', async () => {
    try {
      const orch = await getOrchestrator(db);
      const stagingService = orch.getStagingService();
      const stats = stagingService.getStats();
      return { success: true, stats };
    } catch (error) {
      console.error('Error getting staging stats:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Cleanup old staging files
   */
  ipcMain.handle('downloader:cleanupStaging', async (_event, maxAgeHours: unknown) => {
    try {
      const validMaxAge = z.number().int().min(1).max(168).optional().parse(maxAgeHours);
      const orch = await getOrchestrator(db);
      const stagingService = orch.getStagingService();
      const deleted = await stagingService.cleanupOld(validMaxAge ?? 24);
      return { success: true, deleted };
    } catch (error) {
      console.error('Error cleaning up staging:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // Image Source Discovery
  // ============================================================================

  /**
   * Discover all image sources from HTML content
   * Parses srcset, picture elements, meta tags, data attributes, etc.
   */
  ipcMain.handle('downloader:discoverSources', async (_event, input: unknown) => {
    try {
      const validInput = z.object({
        html: z.string().min(1),
        pageUrl: z.string().url(),
      }).parse(input);

      const result = imageSourceDiscovery.discoverFromHtml(
        validInput.html,
        validInput.pageUrl
      );

      return {
        success: true,
        pageUrl: result.pageUrl,
        title: result.title,
        totalSources: result.images.length,
        groups: result.imageGroups.length,
        sources: result.images.map(s => ({
          url: s.url,
          width: s.width,
          height: s.height,
          sourceType: s.sourceType,
          confidence: s.confidence,
          context: s.context,
        })),
        imageGroups: result.imageGroups.map(g => ({
          bestUrl: g.bestSource.url,
          sourceCount: g.sources.length,
          description: g.description,
        })),
      };
    } catch (error) {
      console.error('Error discovering sources:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Apply site-specific patterns to transform a URL
   * Returns all possible original URL candidates for major sites
   */
  ipcMain.handle('downloader:applySitePatterns', async (_event, url: unknown) => {
    try {
      const validUrl = z.string().url().parse(url);
      const sources = applySitePatterns(validUrl);

      return {
        success: true,
        originalUrl: validUrl,
        candidates: sources.map(s => ({
          url: s.url,
          confidence: s.confidence,
          source: s.context?.nearbyText,
        })),
      };
    } catch (error) {
      console.error('Error applying site patterns:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Parse srcset attribute into individual entries
   */
  ipcMain.handle('downloader:parseSrcset', async (_event, input: unknown) => {
    try {
      const validInput = z.object({
        srcset: z.string().min(1),
        baseUrl: z.string().url(),
      }).parse(input);

      const entries = parseSrcset(validInput.srcset, validInput.baseUrl);

      return {
        success: true,
        entries: entries.map(e => ({
          url: e.url,
          width: e.width,
          density: e.density,
          descriptor: e.descriptor,
        })),
        bestEntry: entries[0] || null,
      };
    } catch (error) {
      console.error('Error parsing srcset:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Comprehensive image finding: discover sources + enhance each + validate + rank
   * This is the "do everything" endpoint for getting the best image from a page
   */
  ipcMain.handle('downloader:findBestImages', async (event, input: unknown) => {
    try {
      const validInput = z.object({
        html: z.string().min(1),
        pageUrl: z.string().url(),
        options: z.object({
          maxImages: z.number().int().min(1).max(100).optional(),
          minWidth: z.number().int().min(0).optional(),
          validateAll: z.boolean().optional(),
          preferFormats: z.array(z.string()).optional(),
        }).optional(),
      }).parse(input);

      const opts = validInput.options || {};

      // Step 1: Discover all sources
      event.sender.send('downloader:findProgress', { stage: 'discovering', current: 0, total: 0 });
      const discovered = imageSourceDiscovery.discoverFromHtml(
        validInput.html,
        validInput.pageUrl
      );

      // Step 2: Enhance each unique source to find originals
      event.sender.send('downloader:findProgress', { stage: 'enhancing', current: 0, total: discovered.images.length });

      const enhancedResults = [];
      for (let i = 0; i < discovered.images.length; i++) {
        const source = discovered.images[i];
        event.sender.send('downloader:findProgress', { stage: 'enhancing', current: i + 1, total: discovered.images.length });

        try {
          const enhanced = await imageEnhanceService.enhance(source.url, {
            validate: opts.validateAll ?? false,
            maxCandidates: 20,
            headTimeout: 3000,
          });

          enhancedResults.push({
            originalSource: source,
            bestUrl: enhanced.bestUrl,
            bestSize: enhanced.bestSize,
            improvement: enhanced.improvement,
          });
        } catch {
          // Keep original if enhance fails
          enhancedResults.push({
            originalSource: source,
            bestUrl: source.url,
            bestSize: 0,
            improvement: 1,
          });
        }
      }

      // Step 3: Sort by size and return top results
      enhancedResults.sort((a, b) => b.bestSize - a.bestSize);

      const maxImages = opts.maxImages ?? 20;
      const topResults = enhancedResults.slice(0, maxImages);

      return {
        success: true,
        pageUrl: validInput.pageUrl,
        title: discovered.title,
        totalDiscovered: discovered.images.length,
        results: topResults.map(r => ({
          url: r.bestUrl,
          size: r.bestSize,
          improvement: r.improvement,
          sourceType: r.originalSource.sourceType,
          originalUrl: r.originalSource.url,
        })),
      };
    } catch (error) {
      console.error('Error finding best images:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // Image Quality Analysis
  // ============================================================================

  /**
   * Get image dimensions from URL (partial download for efficiency)
   */
  ipcMain.handle('downloader:getDimensions', async (_event, input: unknown) => {
    try {
      const validInput = z.object({
        url: z.string().url(),
        full: z.boolean().optional(),
        timeout: z.number().int().min(1000).max(60000).optional(),
      }).parse(input);

      if (validInput.full) {
        const result = await imageQualityAnalyzer.getFullImageDimensions(
          validInput.url,
          { timeout: validInput.timeout }
        );
        return { success: true, ...result };
      } else {
        const result = await imageQualityAnalyzer.getImageDimensions(
          validInput.url,
          { timeout: validInput.timeout }
        );
        return { success: true, ...result };
      }
    } catch (error) {
      console.error('Error getting dimensions:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Analyze JPEG quality from URL or buffer
   */
  ipcMain.handle('downloader:analyzeJpegQuality', async (_event, url: unknown) => {
    try {
      const validUrl = z.string().url().parse(url);

      // Download the image
      const response = await fetch(validUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AUArchive/1.0)' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const result = await imageQualityAnalyzer.analyzeJpegQuality(buffer);

      if (!result) {
        return { success: false, error: 'Not a valid JPEG image' };
      }

      return { success: true, ...result };
    } catch (error) {
      console.error('Error analyzing JPEG quality:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Detect watermarks in an image
   */
  ipcMain.handle('downloader:detectWatermark', async (_event, url: unknown) => {
    try {
      const validUrl = z.string().url().parse(url);

      const response = await fetch(validUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AUArchive/1.0)' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const result = await imageQualityAnalyzer.detectWatermark(buffer);

      return { success: true, ...result };
    } catch (error) {
      console.error('Error detecting watermark:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Comprehensive image quality analysis
   */
  ipcMain.handle('downloader:analyzeQuality', async (_event, input: unknown) => {
    try {
      const validInput = z.object({
        url: z.string().url(),
        timeout: z.number().int().min(1000).max(60000).optional(),
      }).parse(input);

      const result = await imageQualityAnalyzer.analyzeImageQuality(
        validInput.url,
        { timeout: validInput.timeout }
      );

      return { success: true, report: result };
    } catch (error) {
      console.error('Error analyzing image quality:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Analyze and rank multiple images by quality
   */
  ipcMain.handle('downloader:rankByQuality', async (event, input: unknown) => {
    try {
      const validInput = z.object({
        urls: z.array(z.string().url()),
        concurrency: z.number().int().min(1).max(10).optional(),
        timeout: z.number().int().min(1000).max(60000).optional(),
      }).parse(input);

      const results = await imageQualityAnalyzer.analyzeAndRankImages(
        validInput.urls,
        {
          concurrency: validInput.concurrency,
          timeout: validInput.timeout,
        }
      );

      // Send progress events
      results.forEach((result, index) => {
        event.sender.send('downloader:qualityProgress', {
          current: index + 1,
          total: validInput.urls.length,
          url: result.url,
          score: result.qualityScore,
          rank: result.rank,
        });
      });

      return {
        success: true,
        results: results.map(r => ({
          url: r.url,
          rank: r.rank,
          qualityScore: r.qualityScore,
          recommendation: r.recommendation,
          dimensions: r.dimensions,
          format: r.format,
          fileSize: r.fileSize,
          hasWatermark: r.watermark.hasWatermark,
          jpegQuality: r.jpegQuality?.estimatedQuality,
        })),
      };
    } catch (error) {
      console.error('Error ranking images by quality:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Calculate similarity hash for an image
   */
  ipcMain.handle('downloader:similarityHash', async (_event, url: unknown) => {
    try {
      const validUrl = z.string().url().parse(url);

      const response = await fetch(validUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AUArchive/1.0)' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const hash = await imageQualityAnalyzer.calculateSimilarityHash(buffer);

      return { success: true, hash };
    } catch (error) {
      console.error('Error calculating similarity hash:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Find similar images from a list of candidates
   */
  ipcMain.handle('downloader:findSimilarByHash', async (_event, input: unknown) => {
    try {
      const validInput = z.object({
        targetUrl: z.string().url(),
        candidateUrls: z.array(z.string().url()),
        threshold: z.number().int().min(0).max(64).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }).parse(input);

      // Download target image
      const targetResponse = await fetch(validInput.targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AUArchive/1.0)' },
      });

      if (!targetResponse.ok) {
        throw new Error(`Failed to fetch target: HTTP ${targetResponse.status}`);
      }

      const targetBuffer = Buffer.from(await targetResponse.arrayBuffer());

      const candidates = validInput.candidateUrls.map(url => ({ url }));

      const results = await imageQualityAnalyzer.findSimilarImages(
        targetBuffer,
        candidates,
        {
          threshold: validInput.threshold,
          limit: validInput.limit,
        }
      );

      return {
        success: true,
        similar: results,
        count: results.length,
      };
    } catch (error) {
      console.error('Error finding similar images:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // Browser Image Capture
  // ============================================================================

  /**
   * Get images captured from network requests
   */
  ipcMain.handle('downloader:getCapturedImages', async (_event, pageUrl?: unknown) => {
    try {
      const validPageUrl = pageUrl ? z.string().url().parse(pageUrl) : undefined;
      const monitor = getGlobalMonitor();

      if (!monitor) {
        return { success: false, error: 'Network monitor not initialized' };
      }

      const images = validPageUrl
        ? monitor.getImagesForPage(validPageUrl)
        : monitor.getCapturedImages();

      return {
        success: true,
        images: images.map(img => ({
          url: img.url,
          sourceUrl: img.sourceUrl,
          captureType: img.captureType,
          contentType: img.contentType,
          contentLength: img.contentLength,
          timestamp: img.timestamp,
        })),
        count: images.length,
      };
    } catch (error) {
      console.error('Error getting captured images:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Clear captured images
   */
  ipcMain.handle('downloader:clearCapturedImages', async (_event, maxAgeHours?: unknown) => {
    try {
      const validMaxAge = maxAgeHours
        ? z.number().int().min(0).max(168).parse(maxAgeHours)
        : undefined;

      const monitor = getGlobalMonitor();

      if (!monitor) {
        return { success: false, error: 'Network monitor not initialized' };
      }

      if (validMaxAge) {
        const cleared = monitor.clearOld(validMaxAge * 3600000);
        return { success: true, cleared };
      } else {
        monitor.clear();
        return { success: true, cleared: 'all' };
      }
    } catch (error) {
      console.error('Error clearing captured images:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  console.log('[IPC] Image downloader handlers registered');
}
