/**
 * Job Builder - Unified image processing job queue builder
 *
 * SINGLE SOURCE OF TRUTH for image processing jobs.
 * All import paths (local files, web images) MUST use these functions.
 *
 * Per docs/plans/unified-image-processing-pipeline.md:
 * - queueImageProcessingJobs(): Per-file jobs (ExifTool, Thumbnail, Tagging)
 * - queueLocationPostProcessing(): Per-location jobs (GPS, Stats, BagIt, etc.)
 * - needsProcessing(): Skip logic for already-processed images
 *
 * @module services/import/job-builder
 */

import { generateId } from '../../main/ipc-validation';
import type { Kysely } from 'kysely';
import type { Database } from '../../main/database.types';
import { JobQueue, IMPORT_QUEUES, JOB_PRIORITY, type JobInput } from '../job-queue';
import { getLogger } from '../logger-service';

const logger = getLogger();

// ============================================================================
// Type Definitions
// ============================================================================

export interface ImageJobParams {
  imghash: string;
  archivePath: string;
  locid: string;
  subid: string | null;
}

export interface ImageJobResult {
  /** Job IDs that were queued */
  jobs: string[];
  /** Job types that were skipped (already processed) */
  skipped: string[];
  /** The ExifTool job ID (needed for dependency chain) */
  exifJobId: string | null;
}

export interface LocationJobParams {
  locid: string;
  subid: string | null;
  /** Last ExifTool job ID for dependency chain (optional) */
  lastExifJobId?: string;
  /** Whether images were imported (affects tag aggregation) */
  hasImages?: boolean;
  /** Whether documents were imported (affects SRT telemetry) */
  hasDocuments?: boolean;
}

export interface LocationJobResult {
  /** Job IDs that were queued */
  jobs: string[];
}

export interface ProcessingStatus {
  exiftool: boolean;
  thumbnail: boolean;
  tagging: boolean;
}

// ============================================================================
// Processing Status Check
// ============================================================================

/**
 * Check if an image needs processing for each stage.
 *
 * Used to skip jobs for already-processed images (e.g., re-imports, backfill).
 *
 * @param image - Image record with processing status fields
 * @returns Object indicating which stages need processing
 */
export function needsProcessing(image: {
  meta_exiftool: string | null;
  thumb_path_sm: string | null;
  auto_tags: string | null;
}): ProcessingStatus {
  return {
    exiftool: image.meta_exiftool === null,
    thumbnail: image.thumb_path_sm === null,
    tagging: image.auto_tags === null,
  };
}

// ============================================================================
// Per-File Job Builder
// ============================================================================

/**
 * Queue all standard processing jobs for an imported image.
 *
 * This is the SINGLE SOURCE OF TRUTH for image processing.
 * Call this from ANY import path after successful DB insert.
 *
 * Jobs queued:
 * 1. EXIFTOOL (HIGH priority) - Extracts metadata
 * 2. THUMBNAIL (NORMAL priority, depends on ExifTool) - Generates thumbnails
 * 3. IMAGE_TAGGING (BACKGROUND priority, depends on ExifTool) - RAM++ tagging
 *
 * @param db - Database connection
 * @param params - Image parameters
 * @param options - Optional settings
 * @returns Job IDs and skipped stages
 */
export async function queueImageProcessingJobs(
  db: Kysely<Database>,
  params: ImageJobParams,
  options?: {
    /** Skip processing check and always queue all jobs */
    forceAll?: boolean;
    /** Check existing processing status before queueing */
    checkExisting?: boolean;
  }
): Promise<ImageJobResult> {
  const { imghash, archivePath, locid, subid } = params;
  const { forceAll = false, checkExisting = true } = options ?? {};

  const jobs: string[] = [];
  const skipped: string[] = [];
  let exifJobId: string | null = null;

  // Check existing processing status if requested
  let status: ProcessingStatus = { exiftool: true, thumbnail: true, tagging: true };

  if (checkExisting && !forceAll) {
    const image = await db
      .selectFrom('imgs')
      .select(['meta_exiftool', 'thumb_path_sm', 'auto_tags'])
      .where('imghash', '=', imghash)
      .executeTakeFirst();

    if (image) {
      status = needsProcessing(image);
    }
  }

  const jobQueue = new JobQueue(db);

  const basePayload = {
    hash: imghash,
    mediaType: 'image' as const,
    archivePath,
    locid,
    subid,
  };

  // 1. EXIFTOOL (HIGH priority) - Always first in chain
  if (forceAll || status.exiftool) {
    exifJobId = generateId();
    await jobQueue.addJob({
      queue: IMPORT_QUEUES.EXIFTOOL,
      priority: JOB_PRIORITY.HIGH,
      jobId: exifJobId,
      payload: basePayload,
    });
    jobs.push(exifJobId);
    logger.debug('JobBuilder', `Queued EXIFTOOL for ${imghash.slice(0, 8)}...`);
  } else {
    skipped.push('exiftool');
  }

  // 2. THUMBNAIL (NORMAL priority, depends on ExifTool for orientation)
  if (forceAll || status.thumbnail) {
    const thumbJobId = generateId();
    await jobQueue.addJob({
      queue: IMPORT_QUEUES.THUMBNAIL,
      priority: JOB_PRIORITY.NORMAL,
      jobId: thumbJobId,
      payload: basePayload,
      dependsOn: exifJobId ?? undefined, // May not have exif job if skipped
    });
    jobs.push(thumbJobId);
    logger.debug('JobBuilder', `Queued THUMBNAIL for ${imghash.slice(0, 8)}...`);
  } else {
    skipped.push('thumbnail');
  }

  // 3. IMAGE_TAGGING (BACKGROUND priority, depends on ExifTool)
  if (forceAll || status.tagging) {
    const tagJobId = generateId();
    await jobQueue.addJob({
      queue: IMPORT_QUEUES.IMAGE_TAGGING,
      priority: JOB_PRIORITY.BACKGROUND,
      jobId: tagJobId,
      payload: {
        imghash,
        imagePath: archivePath,
        locid,
        subid,
      },
      dependsOn: exifJobId ?? undefined,
    });
    jobs.push(tagJobId);
    logger.debug('JobBuilder', `Queued IMAGE_TAGGING for ${imghash.slice(0, 8)}...`);
  } else {
    skipped.push('tagging');
  }

  if (jobs.length > 0) {
    logger.info('JobBuilder', `Queued ${jobs.length} jobs for image ${imghash.slice(0, 8)}...${skipped.length > 0 ? ` (skipped: ${skipped.join(', ')})` : ''}`);
  }

  return { jobs, skipped, exifJobId };
}

// ============================================================================
// Per-Location Job Builder
// ============================================================================

/**
 * Queue location-level jobs after an import batch completes.
 *
 * Should be called ONCE per import session, not per image.
 * These jobs aggregate data across all media in a location.
 *
 * Jobs queued:
 * 1. GPS_ENRICHMENT (NORMAL priority) - Aggregate GPS from media to location
 * 2. LIVE_PHOTO (NORMAL priority) - Detect Live Photo pairs
 * 3. SRT_TELEMETRY (NORMAL priority) - Link DJI telemetry (if documents imported)
 * 4. LOCATION_STATS (BACKGROUND priority) - Recalculate counts and dates
 * 5. BAGIT (BACKGROUND priority) - Update RFC 8493 manifest
 * 6. LOCATION_TAG_AGGREGATION (BACKGROUND priority) - Aggregate tags (if images imported)
 *
 * @param db - Database connection
 * @param params - Location parameters
 * @returns Job IDs that were queued
 */
export async function queueLocationPostProcessing(
  db: Kysely<Database>,
  params: LocationJobParams
): Promise<LocationJobResult> {
  const { locid, subid, lastExifJobId, hasImages = true, hasDocuments = false } = params;

  const jobs: string[] = [];
  const jobQueue = new JobQueue(db);

  const locationPayload = { locid };
  const locationWithSubPayload = { locid, subid };

  // 1. GPS_ENRICHMENT (NORMAL priority)
  // Aggregates GPS from media to location/sub-location
  const gpsEnrichmentJobId = generateId();
  await jobQueue.addJob({
    queue: IMPORT_QUEUES.GPS_ENRICHMENT,
    priority: JOB_PRIORITY.NORMAL,
    jobId: gpsEnrichmentJobId,
    payload: locationWithSubPayload,
    dependsOn: lastExifJobId,
  });
  jobs.push(gpsEnrichmentJobId);

  // 2. LIVE_PHOTO (NORMAL priority)
  // Detects Live Photo pairs by ContentIdentifier
  // Location-wide, not sub-location specific
  const livePhotoJobId = generateId();
  await jobQueue.addJob({
    queue: IMPORT_QUEUES.LIVE_PHOTO,
    priority: JOB_PRIORITY.NORMAL,
    jobId: livePhotoJobId,
    payload: locationPayload,
    dependsOn: lastExifJobId,
  });
  jobs.push(livePhotoJobId);

  // 3. SRT_TELEMETRY (NORMAL priority) - Only if documents were imported
  if (hasDocuments) {
    const srtJobId = generateId();
    await jobQueue.addJob({
      queue: IMPORT_QUEUES.SRT_TELEMETRY,
      priority: JOB_PRIORITY.NORMAL,
      jobId: srtJobId,
      payload: locationPayload,
      dependsOn: lastExifJobId,
    });
    jobs.push(srtJobId);
  }

  // 4. LOCATION_STATS (BACKGROUND priority)
  // Recalculates media counts and date ranges
  const statsJobId = generateId();
  await jobQueue.addJob({
    queue: IMPORT_QUEUES.LOCATION_STATS,
    priority: JOB_PRIORITY.BACKGROUND,
    jobId: statsJobId,
    payload: locationWithSubPayload,
    dependsOn: gpsEnrichmentJobId,
  });
  jobs.push(statsJobId);

  // 5. BAGIT (BACKGROUND priority)
  // Updates RFC 8493 archive manifest
  const bagitJobId = generateId();
  await jobQueue.addJob({
    queue: IMPORT_QUEUES.BAGIT,
    priority: JOB_PRIORITY.BACKGROUND,
    jobId: bagitJobId,
    payload: locationWithSubPayload,
    dependsOn: gpsEnrichmentJobId,
  });
  jobs.push(bagitJobId);

  // 6. LOCATION_TAG_AGGREGATION (BACKGROUND priority) - Only if images imported
  if (hasImages) {
    const tagAggJobId = generateId();
    await jobQueue.addJob({
      queue: IMPORT_QUEUES.LOCATION_TAG_AGGREGATION,
      priority: JOB_PRIORITY.BACKGROUND,
      jobId: tagAggJobId,
      payload: {
        locid,
        applyType: true,
        applyEra: true,
      },
      dependsOn: gpsEnrichmentJobId,
    });
    jobs.push(tagAggJobId);
  }

  logger.info('JobBuilder', `Queued ${jobs.length} location jobs for ${locid.slice(0, 8)}...`);

  return { jobs };
}

// ============================================================================
// Batch Helpers
// ============================================================================

/**
 * Queue processing jobs for multiple images in a batch.
 *
 * More efficient than calling queueImageProcessingJobs() in a loop
 * because it batches the job queue inserts.
 *
 * @param db - Database connection
 * @param images - Array of image parameters
 * @returns Combined results with last ExifTool job ID for dependencies
 */
export async function queueImageBatchProcessing(
  db: Kysely<Database>,
  images: ImageJobParams[],
  options?: {
    forceAll?: boolean;
    checkExisting?: boolean;
  }
): Promise<{
  totalJobs: number;
  totalSkipped: number;
  lastExifJobId: string | null;
}> {
  let totalJobs = 0;
  let totalSkipped = 0;
  let lastExifJobId: string | null = null;

  for (const image of images) {
    const result = await queueImageProcessingJobs(db, image, options);
    totalJobs += result.jobs.length;
    totalSkipped += result.skipped.length;
    if (result.exifJobId) {
      lastExifJobId = result.exifJobId;
    }
  }

  return { totalJobs, totalSkipped, lastExifJobId };
}
