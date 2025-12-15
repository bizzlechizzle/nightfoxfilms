/**
 * Tagging Job Handler
 *
 * Processes IMAGE_TAGGING and LOCATION_TAG_AGGREGATION jobs from the queue.
 * Runs in background with lowest priority per CLAUDE.md Rule 9.
 *
 * @module services/import/tagging-job-handler
 */

import type { Kysely } from 'kysely';
import type { Database } from '../../main/database.types';
import { getImageTaggingService, type EnhancedTagResult } from '../tagging/image-tagging-service';
import { getLocationTagAggregator } from '../tagging/location-tag-aggregator';
import { getLogger } from '../logger-service';
import { JobQueue, IMPORT_QUEUES, JOB_PRIORITY } from '../job-queue';
import fs from 'fs/promises';

const logger = getLogger();

// ============================================================================
// Type Definitions
// ============================================================================

export interface ImageTaggingJobPayload {
  imghash: string;
  imagePath: string;
  locid: string;
  subid?: string | null;
  priority?: number;
}

export interface ImageTaggingJobResult {
  success: boolean;
  imghash: string;
  locid: string;
  tags?: string[];
  viewType?: string;
  qualityScore?: number;
  suggestedType?: string | null;
  duration_ms?: number;
  error?: string;
}

export interface LocationAggregationJobPayload {
  locid: string;
  applyType?: boolean;   // Auto-apply suggested type if confident
  applyEra?: boolean;    // Auto-apply suggested era if confident
}

export interface LocationAggregationJobResult {
  success: boolean;
  locid: string;
  taggedImages?: number;
  totalImages?: number;
  dominantTags?: string[];
  suggestedType?: string | null;
  typeApplied?: boolean;
  eraApplied?: boolean;
  error?: string;
}

// ============================================================================
// Job Handlers
// ============================================================================

/**
 * Process a single image tagging job
 *
 * Uses the 800px thumbnail (JPEG) instead of original RAW files for better
 * compatibility with Florence-2/RAM++ which expect standard image formats.
 */
export async function handleImageTaggingJob(
  db: Kysely<Database>,
  payload: ImageTaggingJobPayload
): Promise<ImageTaggingJobResult> {
  const { imghash, imagePath, locid, subid } = payload;

  try {
    const service = getImageTaggingService();
    await service.initialize();

    // Use 800px thumbnail (JPEG) instead of original RAW for compatibility
    // Query the stored thumb_path_lg from the database
    const imgRecord = await db
      .selectFrom('imgs')
      .select(['thumb_path_lg'])
      .where('imghash', '=', imghash)
      .executeTakeFirst();

    // Check if thumbnail exists, fall back to original if not
    let tagImagePath = imagePath;
    if (imgRecord?.thumb_path_lg) {
      try {
        await fs.access(imgRecord.thumb_path_lg);
        tagImagePath = imgRecord.thumb_path_lg;
        logger.debug('TaggingJob', `Using thumbnail for tagging: ${tagImagePath}`);
      } catch {
        logger.debug('TaggingJob', `Thumbnail not accessible, using original: ${imagePath}`);
      }
    } else {
      logger.debug('TaggingJob', `No thumbnail path stored, using original: ${imagePath}`);
    }

    // Tag the image
    const result = await service.tagImage(tagImagePath);

    // Store tags in database
    const now = new Date().toISOString();
    await db
      .updateTable('imgs')
      .set({
        auto_tags: JSON.stringify(result.tags),
        auto_tags_source: 'ram++',  // Will change to 'florence-2' in Phase 3
        auto_tags_confidence: JSON.stringify(result.confidence),
        auto_tags_at: now,
        quality_score: result.qualityScore,
        view_type: result.viewType.type !== 'unknown' ? result.viewType.type : null,
      })
      .where('imghash', '=', imghash)
      .execute();

    logger.info('TaggingJob', `Tagged image ${imghash.slice(0, 8)}... with ${result.tags.length} tags in ${result.duration_ms}ms`);

    return {
      success: true,
      imghash,
      locid,
      tags: result.tags,
      viewType: result.viewType.type,
      qualityScore: result.qualityScore,
      suggestedType: result.suggestedType?.type,
      duration_ms: result.duration_ms,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.warn('TaggingJob', `Failed to tag ${imghash}: ${error}`);

    // Job queue will handle error status and retries
    return {
      success: false,
      imghash,
      locid,
      error,
    };
  }
}

/**
 * Process a location tag aggregation job
 */
export async function handleLocationAggregationJob(
  db: Kysely<Database>,
  payload: LocationAggregationJobPayload
): Promise<LocationAggregationJobResult> {
  const { locid, applyType = true, applyEra = true } = payload;

  try {
    const aggregator = getLocationTagAggregator(db);

    // Aggregate tags for the location
    const result = await aggregator.aggregateLocation(locid);

    if (!result.success || !result.summary) {
      return {
        success: false,
        locid,
        error: result.error ?? 'No summary generated',
      };
    }

    const { summary } = result;

    // Optionally apply suggestions to location
    let typeApplied = false;
    let eraApplied = false;

    if (applyType || applyEra) {
      const applied = await aggregator.applySuggestions(locid, {
        typeThreshold: 0.7,
        eraThreshold: 0.7,
        overwrite: false,  // Don't overwrite user-set values
      });
      typeApplied = applied.typeApplied;
      eraApplied = applied.eraApplied;
    }

    logger.info('AggregationJob', `Aggregated location ${locid}: ${summary.taggedImages}/${summary.totalImages} images, type=${summary.suggestedType}`);

    return {
      success: true,
      locid,
      taggedImages: summary.taggedImages,
      totalImages: summary.totalImages,
      dominantTags: summary.dominantTags,
      suggestedType: summary.suggestedType,
      typeApplied,
      eraApplied,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.warn('AggregationJob', `Failed to aggregate location ${locid}: ${error}`);

    return {
      success: false,
      locid,
      error,
    };
  }
}

// ============================================================================
// Queue Helpers
// ============================================================================

/**
 * Queue an image for tagging using the main job queue
 */
export async function queueImageForTagging(
  db: Kysely<Database>,
  imghash: string,
  imagePath: string,
  locid: string,
  priority = 0
): Promise<void> {
  const jobQueue = new JobQueue(db);

  // Check if job already exists for this image
  const existing = await db
    .selectFrom('jobs')
    .select('job_id')
    .where('queue', '=', IMPORT_QUEUES.IMAGE_TAGGING)
    .where('status', 'in', ['pending', 'processing'])
    .where('payload', 'like', `%"imghash":"${imghash}"%`)
    .executeTakeFirst();

  if (existing) {
    logger.debug('TaggingJob', `Image ${imghash} already queued for tagging`);
    return;
  }

  // Add to main job queue
  const payload: ImageTaggingJobPayload = {
    imghash,
    imagePath,
    locid,
    priority,
  };

  await jobQueue.addJob({
    queue: IMPORT_QUEUES.IMAGE_TAGGING,
    priority: priority > 0 ? priority : JOB_PRIORITY.BACKGROUND, // Lowest priority per CLAUDE.md Rule 9
    payload,
    maxAttempts: 3,
  });

  logger.info('TaggingJob', `Queued image ${imghash.slice(0, 8)}... for tagging`);
}

/**
 * Get pending images to tag for a location
 */
export async function getPendingTaggingJobs(
  db: Kysely<Database>,
  limit = 100
): Promise<ImageTaggingJobPayload[]> {
  const rows = await db
    .selectFrom('image_tagging_queue')
    .select(['imghash', 'image_path', 'locid'])
    .where('status', '=', 'pending')
    .orderBy('priority', 'desc')
    .orderBy('created_at', 'asc')
    .limit(limit)
    .execute();

  return rows
    .filter(row => row.locid !== null)
    .map(row => ({
      imghash: row.imghash,
      imagePath: row.image_path,
      locid: row.locid!,  // Safe: filtered above
    }));
}

/**
 * Get tagging queue statistics from main jobs table
 */
export async function getTaggingQueueStats(db: Kysely<Database>): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}> {
  const result = await db
    .selectFrom('jobs')
    .select([
      (eb) => eb.fn.count<number>(
        eb.case().when('status', '=', 'pending').then(1).end()
      ).as('pending'),
      (eb) => eb.fn.count<number>(
        eb.case().when('status', '=', 'processing').then(1).end()
      ).as('processing'),
      (eb) => eb.fn.count<number>(
        eb.case().when('status', '=', 'completed').then(1).end()
      ).as('completed'),
      (eb) => eb.fn.count<number>(
        eb.case().when('status', '=', 'failed').then(1).end()
      ).as('failed'),
    ])
    .where('queue', '=', IMPORT_QUEUES.IMAGE_TAGGING)
    .executeTakeFirst();

  return {
    pending: Number(result?.pending ?? 0),
    processing: Number(result?.processing ?? 0),
    completed: Number(result?.completed ?? 0),
    failed: Number(result?.failed ?? 0),
  };
}
