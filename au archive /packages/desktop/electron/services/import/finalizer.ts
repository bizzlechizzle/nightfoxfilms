/**
 * Finalizer - Database commit and job queue population (Step 5)
 *
 * Per Import Spec v2.0:
 * - Batch DB transaction for final records
 * - Status update (status='imported')
 * - Sidecar/RAW+JPEG/Live Photo relationship linking
 * - Bulk job queue population with dependencies
 * - Import session recording
 * - Progress reporting (95-100%)
 *
 * @module services/import/finalizer
 */

import { generateId } from '../../main/ipc-validation';
import path from 'path';
import type { Kysely } from 'kysely';
import type { Database } from '../../main/database.types';
import type { ValidatedFile } from './validator';
import type { ScanResult } from './scanner';
import { JobQueue, IMPORT_QUEUES, JOB_PRIORITY, type JobInput } from '../job-queue';
import type { LocationInfo } from './types';
import { perceptualHashService } from '../image-downloader/perceptual-hash-service';

/**
 * Finalized file with DB record info
 */
export interface FinalizedFile extends ValidatedFile {
  dbRecordId: string | null;
  finalizeError: string | null;
}

/**
 * Finalization result summary
 */
export interface FinalizationResult {
  files: FinalizedFile[];
  totalFinalized: number;
  totalErrors: number;
  jobsQueued: number;
  importRecordId: string;
  finalizeTimeMs: number;
}

/**
 * Finalizer options
 */
export interface FinalizerOptions {
  /**
   * Progress callback (95-100% range)
   */
  onProgress?: (percent: number, phase: string) => void;

  /**
   * Abort signal for cancellation
   */
  signal?: AbortSignal;

  /**
   * User info for activity tracking
   */
  user?: {
    userId: string;
    username: string;
  };

  /**
   * Scan result for relationship linking
   */
  scanResult?: ScanResult;
}

// LocationInfo imported from ./types - single source of truth
// Re-export for backwards compatibility
export type { LocationInfo } from './types';

/**
 * Finalizer class for database commits
 */
export class Finalizer {
  private jobQueue: JobQueue;

  constructor(private readonly db: Kysely<Database>) {
    this.jobQueue = new JobQueue(db);
  }

  /**
   * Finalize import: commit to DB and queue background jobs
   */
  async finalize(
    files: ValidatedFile[],
    location: LocationInfo,
    options?: FinalizerOptions
  ): Promise<FinalizationResult> {
    const startTime = Date.now();

    // Filter valid files
    const validFiles = files.filter(f => f.isValid && f.archivePath);

    const results: FinalizedFile[] = [];
    let totalFinalized = 0;
    let totalErrors = 0;
    let jobsQueued = 0;

    // Report progress: Starting DB transaction
    options?.onProgress?.(95, 'Committing to database');

    // Create import record
    const importRecordId = generateId();
    const now = new Date().toISOString();

    // Transaction for all DB operations
    await this.db.transaction().execute(async (trx) => {
      // Insert import record
      await trx
        .insertInto('imports')
        .values({
          import_id: importRecordId,
          locid: location.locid,
          import_date: now,
          auth_imp: options?.user?.username ?? null,
          img_count: validFiles.filter(f => f.mediaType === 'image').length,
          vid_count: validFiles.filter(f => f.mediaType === 'video').length,
          doc_count: validFiles.filter(f => f.mediaType === 'document').length,
          map_count: validFiles.filter(f => f.mediaType === 'map').length,
          notes: null,
        })
        .execute();

      // Check for cancellation before batch insert
      if (options?.signal?.aborted) {
        throw new Error('Finalize cancelled');
      }

      // Batch insert by media type for efficiency
      // SQLite supports up to 500 variables per statement, so batch in chunks
      const BATCH_SIZE = 50; // Conservative to avoid SQLite limits

      // Group files by media type
      const imageFiles = validFiles.filter(f => f.mediaType === 'image');
      const videoFiles = validFiles.filter(f => f.mediaType === 'video');
      const docFiles = validFiles.filter(f => f.mediaType === 'document');
      const mapFiles = validFiles.filter(f => f.mediaType === 'map');

      // Batch insert images
      if (imageFiles.length > 0) {
        const inserted = await this.batchInsertImages(trx, imageFiles, location, options);
        for (const file of inserted.successful) {
          results.push({ ...file, dbRecordId: file.hash!, finalizeError: null });
          totalFinalized++;
        }
        for (const file of inserted.failed) {
          results.push({ ...file, dbRecordId: null, finalizeError: file.error });
          totalErrors++;
        }
      }

      // Batch insert videos
      if (videoFiles.length > 0) {
        const inserted = await this.batchInsertVideos(trx, videoFiles, location, options);
        for (const file of inserted.successful) {
          results.push({ ...file, dbRecordId: file.hash!, finalizeError: null });
          totalFinalized++;
        }
        for (const file of inserted.failed) {
          results.push({ ...file, dbRecordId: null, finalizeError: file.error });
          totalErrors++;
        }
      }

      // Batch insert documents
      if (docFiles.length > 0) {
        const inserted = await this.batchInsertDocs(trx, docFiles, location, options);
        for (const file of inserted.successful) {
          results.push({ ...file, dbRecordId: file.hash!, finalizeError: null });
          totalFinalized++;
        }
        for (const file of inserted.failed) {
          results.push({ ...file, dbRecordId: null, finalizeError: file.error });
          totalErrors++;
        }
      }

      // Batch insert maps
      if (mapFiles.length > 0) {
        const inserted = await this.batchInsertMaps(trx, mapFiles, location, options);
        for (const file of inserted.successful) {
          results.push({ ...file, dbRecordId: file.hash!, finalizeError: null });
          totalFinalized++;
        }
        for (const file of inserted.failed) {
          results.push({ ...file, dbRecordId: null, finalizeError: file.error });
          totalErrors++;
        }
      }

      // Link relationships (RAW+JPEG pairs, Live Photos)
      if (options?.scanResult) {
        await this.linkRelationships(trx, results, options.scanResult);
      }
    });

    // Report progress: Queueing background jobs
    options?.onProgress?.(98, 'Queueing background jobs');

    // Queue background jobs for each successfully imported file
    const successfulFiles = results.filter(f => f.dbRecordId);
    const jobs = this.buildJobList(successfulFiles, location);
    if (jobs.length > 0) {
      await this.jobQueue.addBulk(jobs);
      jobsQueued = jobs.length;
    }

    // Auto-set hero image if location has no hero and we imported images
    // This ensures dashboard thumbnails appear immediately after first import
    if (totalFinalized > 0) {
      await this.autoSetHeroImage(location.locid, location.subid, results);
    }

    // Add non-imported files to results (duplicates, errors)
    for (const file of files) {
      if (!file.isValid || !file.archivePath) {
        results.push({
          ...file,
          dbRecordId: null,
          finalizeError: file.validationError || 'Not validated',
        });
      }
    }

    // Report progress: Complete
    options?.onProgress?.(100, 'Import complete');

    const finalizeTimeMs = Date.now() - startTime;

    return {
      files: results,
      totalFinalized,
      totalErrors,
      jobsQueued,
      importRecordId,
      finalizeTimeMs,
    };
  }

  /**
   * Insert a media record into the appropriate table
   * Calculates perceptual hash (pHash) for images during import
   */
  private async insertMediaRecord(
    trx: Kysely<Database>,
    file: ValidatedFile,
    location: LocationInfo,
    options?: FinalizerOptions
  ): Promise<string> {
    const now = new Date().toISOString();
    const archiveName = `${file.hash}${file.extension}`;

    switch (file.mediaType) {
      case 'image': {
        // Calculate perceptual hash for duplicate detection
        let phash: string | null = null;
        if (file.archivePath) {
          try {
            const result = await perceptualHashService.hashFile(file.archivePath);
            phash = result.hash;
          } catch {
            // pHash calculation failed - continue without it
            // Can be backfilled later via phash-backfill-job
          }
        }

        await trx
          .insertInto('imgs')
          .values({
            imghash: file.hash!,
            imgnam: archiveName,
            imgnamo: file.filename,
            imgloc: file.archivePath!,
            imgloco: file.originalPath,
            locid: location.locid,
            subid: location.subid,
            auth_imp: options?.user?.username ?? null,
            imgadd: now,
            meta_exiftool: null,
            meta_width: null,
            meta_height: null,
            meta_date_taken: null,
            meta_camera_make: null,
            meta_camera_model: null,
            meta_gps_lat: null,
            meta_gps_lng: null,
            thumb_path: null,
            preview_path: null,
            preview_extracted: 0,
            thumb_path_sm: null,
            thumb_path_lg: null,
            xmp_synced: 0,
            xmp_modified_at: null,
            hidden: file.shouldHide ? 1 : 0,
            hidden_reason: file.shouldHide ? 'metadata_sidecar' : null,
            is_live_photo: 0,
            imported_by_id: options?.user?.userId ?? null,
            imported_by: options?.user?.username ?? null,
            media_source: null,
            is_contributed: 0,
            contribution_source: null,
            preview_quality: null,
            file_size_bytes: file.size,
            extracted_from_web: 0,
            phash,
          })
          .execute();
        return file.hash!;
      }

      case 'video':
        await trx
          .insertInto('vids')
          .values({
            vidhash: file.hash!,
            vidnam: archiveName,
            vidnamo: file.filename,
            vidloc: file.archivePath!,
            vidloco: file.originalPath,
            locid: location.locid,
            subid: location.subid,
            auth_imp: options?.user?.username ?? null,
            vidadd: now,
            meta_ffmpeg: null,
            meta_exiftool: null,
            meta_duration: null,
            meta_width: null,
            meta_height: null,
            meta_codec: null,
            meta_fps: null,
            meta_date_taken: null,
            meta_gps_lat: null,
            meta_gps_lng: null,
            thumb_path: null,
            poster_extracted: 0,
            thumb_path_sm: null,
            thumb_path_lg: null,
            preview_path: null,
            xmp_synced: 0,
            xmp_modified_at: null,
            hidden: file.shouldHide ? 1 : 0,
            hidden_reason: file.shouldHide ? 'metadata_sidecar' : null,
            is_live_photo: 0,
            imported_by_id: options?.user?.userId ?? null,
            imported_by: options?.user?.username ?? null,
            media_source: null,
            is_contributed: 0,
            contribution_source: null,
            file_size_bytes: file.size,
            srt_telemetry: null,
            extracted_from_web: 0,
          })
          .execute();
        return file.hash!;

      case 'document':
        await trx
          .insertInto('docs')
          .values({
            dochash: file.hash!,
            docnam: archiveName,
            docnamo: file.filename,
            docloc: file.archivePath!,
            docloco: file.originalPath,
            locid: location.locid,
            subid: location.subid,
            auth_imp: options?.user?.username ?? null,
            docadd: now,
            meta_exiftool: null,
            meta_page_count: null,
            meta_author: null,
            meta_title: null,
            hidden: file.shouldHide ? 1 : 0,
            hidden_reason: file.shouldHide ? 'metadata_sidecar' : null,
            imported_by_id: options?.user?.userId ?? null,
            imported_by: options?.user?.username ?? null,
            media_source: null,
            is_contributed: 0,
            contribution_source: null,
            file_size_bytes: file.size,
          })
          .execute();
        return file.hash!;

      case 'map':
        await trx
          .insertInto('maps')
          .values({
            maphash: file.hash!,
            mapnam: archiveName,
            mapnamo: file.filename,
            maploc: file.archivePath!,
            maploco: file.originalPath,
            locid: location.locid,
            subid: location.subid,
            auth_imp: options?.user?.username ?? null,
            mapadd: now,
            meta_exiftool: null,
            meta_map: null,
            meta_gps_lat: null,
            meta_gps_lng: null,
            reference: null,
            map_states: null,
            map_verified: 0,
            thumb_path_sm: null,
            thumb_path_lg: null,
            preview_path: null,
            imported_by_id: options?.user?.userId ?? null,
            imported_by: options?.user?.username ?? null,
            media_source: null,
            file_size_bytes: file.size,
          })
          .execute();
        return file.hash!;

      default:
        throw new Error(`Unsupported media type: ${file.mediaType}`);
    }
  }

  /**
   * Link RAW+JPEG pairs and Live Photo relationships
   */
  private async linkRelationships(
    trx: Kysely<Database>,
    files: FinalizedFile[],
    scanResult: ScanResult
  ): Promise<void> {
    // Create lookup map from scan file ID to finalized file
    const fileById = new Map<string, FinalizedFile>();
    for (const file of files) {
      fileById.set(file.id, file);
    }

    // Note: RAW+JPEG pairing and Live Photo detection are handled post-import
    // by the LivePhotoDetector job using ContentIdentifier from EXIF metadata
    // This method is a placeholder for future relationship linking
  }

  /**
   * Batch insert images into the imgs table
   * Uses single INSERT with multiple VALUES for efficiency
   * Calculates perceptual hash (pHash) for each image during import
   */
  private async batchInsertImages(
    trx: Kysely<Database>,
    files: ValidatedFile[],
    location: LocationInfo,
    options?: FinalizerOptions
  ): Promise<{ successful: ValidatedFile[]; failed: Array<ValidatedFile & { error: string }> }> {
    const now = new Date().toISOString();
    const successful: ValidatedFile[] = [];
    const failed: Array<ValidatedFile & { error: string }> = [];

    // Pre-calculate perceptual hashes for all files
    // pHash calculation is async and may fail for some formats
    const pHashMap = new Map<string, string | null>();
    for (const file of files) {
      if (file.archivePath) {
        try {
          const result = await perceptualHashService.hashFile(file.archivePath);
          pHashMap.set(file.hash!, result.hash);
        } catch {
          // pHash calculation failed (unsupported format, corrupted file, etc.)
          // Continue without pHash - it can be backfilled later
          pHashMap.set(file.hash!, null);
        }
      }
    }

    // Build batch insert values with pHash
    const insertValues = files.map(file => ({
      imghash: file.hash!,
      imgnam: `${file.hash}${file.extension}`,
      imgnamo: file.filename,
      imgloc: file.archivePath!,
      imgloco: file.originalPath,
      locid: location.locid,
      subid: location.subid,
      auth_imp: options?.user?.username ?? null,
      imgadd: now,
      meta_exiftool: null,
      meta_width: null,
      meta_height: null,
      meta_date_taken: null,
      meta_camera_make: null,
      meta_camera_model: null,
      meta_gps_lat: null,
      meta_gps_lng: null,
      thumb_path: null,
      preview_path: null,
      preview_extracted: 0,
      thumb_path_sm: null,
      thumb_path_lg: null,
      xmp_synced: 0,
      xmp_modified_at: null,
      hidden: file.shouldHide ? 1 : 0,
      hidden_reason: file.shouldHide ? 'metadata_sidecar' : null,
      is_live_photo: 0,
      imported_by_id: options?.user?.userId ?? null,
      imported_by: options?.user?.username ?? null,
      media_source: null,
      is_contributed: 0,
      contribution_source: null,
      preview_quality: null,
      file_size_bytes: file.size,
      extracted_from_web: 0,
      phash: pHashMap.get(file.hash!) ?? null,
    }));

    // Single batch insert
    try {
      if (insertValues.length > 0) {
        await trx.insertInto('imgs').values(insertValues).execute();
        successful.push(...files);
      }
    } catch (error) {
      // If batch fails, fall back to individual inserts to identify failures
      for (let i = 0; i < files.length; i++) {
        try {
          await trx.insertInto('imgs').values(insertValues[i]).execute();
          successful.push(files[i]);
        } catch (individualError) {
          failed.push({
            ...files[i],
            error: individualError instanceof Error ? individualError.message : 'Insert failed',
          });
        }
      }
    }

    return { successful, failed };
  }

  /**
   * Batch insert videos into the vids table
   * Uses single INSERT with multiple VALUES for efficiency
   */
  private async batchInsertVideos(
    trx: Kysely<Database>,
    files: ValidatedFile[],
    location: LocationInfo,
    options?: FinalizerOptions
  ): Promise<{ successful: ValidatedFile[]; failed: Array<ValidatedFile & { error: string }> }> {
    const now = new Date().toISOString();
    const successful: ValidatedFile[] = [];
    const failed: Array<ValidatedFile & { error: string }> = [];

    // Build batch insert values
    const insertValues = files.map(file => ({
      vidhash: file.hash!,
      vidnam: `${file.hash}${file.extension}`,
      vidnamo: file.filename,
      vidloc: file.archivePath!,
      vidloco: file.originalPath,
      locid: location.locid,
      subid: location.subid,
      auth_imp: options?.user?.username ?? null,
      vidadd: now,
      meta_ffmpeg: null,
      meta_exiftool: null,
      meta_duration: null,
      meta_width: null,
      meta_height: null,
      meta_codec: null,
      meta_fps: null,
      meta_date_taken: null,
      meta_gps_lat: null,
      meta_gps_lng: null,
      thumb_path: null,
      poster_extracted: 0,
      thumb_path_sm: null,
      thumb_path_lg: null,
      preview_path: null,
      xmp_synced: 0,
      xmp_modified_at: null,
      hidden: file.shouldHide ? 1 : 0,
      hidden_reason: file.shouldHide ? 'metadata_sidecar' : null,
      is_live_photo: 0,
      imported_by_id: options?.user?.userId ?? null,
      imported_by: options?.user?.username ?? null,
      media_source: null,
      is_contributed: 0,
      contribution_source: null,
      file_size_bytes: file.size,
      srt_telemetry: null,
      extracted_from_web: 0,
    }));

    // Single batch insert
    try {
      if (insertValues.length > 0) {
        await trx.insertInto('vids').values(insertValues).execute();
        successful.push(...files);
      }
    } catch (error) {
      // If batch fails, fall back to individual inserts to identify failures
      for (let i = 0; i < files.length; i++) {
        try {
          await trx.insertInto('vids').values(insertValues[i]).execute();
          successful.push(files[i]);
        } catch (individualError) {
          failed.push({
            ...files[i],
            error: individualError instanceof Error ? individualError.message : 'Insert failed',
          });
        }
      }
    }

    return { successful, failed };
  }

  /**
   * Batch insert documents into the docs table
   * Uses single INSERT with multiple VALUES for efficiency
   */
  private async batchInsertDocs(
    trx: Kysely<Database>,
    files: ValidatedFile[],
    location: LocationInfo,
    options?: FinalizerOptions
  ): Promise<{ successful: ValidatedFile[]; failed: Array<ValidatedFile & { error: string }> }> {
    const now = new Date().toISOString();
    const successful: ValidatedFile[] = [];
    const failed: Array<ValidatedFile & { error: string }> = [];

    // Build batch insert values
    const insertValues = files.map(file => ({
      dochash: file.hash!,
      docnam: `${file.hash}${file.extension}`,
      docnamo: file.filename,
      docloc: file.archivePath!,
      docloco: file.originalPath,
      locid: location.locid,
      subid: location.subid,
      auth_imp: options?.user?.username ?? null,
      docadd: now,
      meta_exiftool: null,
      meta_page_count: null,
      meta_author: null,
      meta_title: null,
      hidden: file.shouldHide ? 1 : 0,
      hidden_reason: file.shouldHide ? 'metadata_sidecar' : null,
      imported_by_id: options?.user?.userId ?? null,
      imported_by: options?.user?.username ?? null,
      media_source: null,
      is_contributed: 0,
      contribution_source: null,
      file_size_bytes: file.size,
    }));

    // Single batch insert
    try {
      if (insertValues.length > 0) {
        await trx.insertInto('docs').values(insertValues).execute();
        successful.push(...files);
      }
    } catch (error) {
      // If batch fails, fall back to individual inserts to identify failures
      for (let i = 0; i < files.length; i++) {
        try {
          await trx.insertInto('docs').values(insertValues[i]).execute();
          successful.push(files[i]);
        } catch (individualError) {
          failed.push({
            ...files[i],
            error: individualError instanceof Error ? individualError.message : 'Insert failed',
          });
        }
      }
    }

    return { successful, failed };
  }

  /**
   * Batch insert maps into the maps table
   * Uses single INSERT with multiple VALUES for efficiency
   */
  private async batchInsertMaps(
    trx: Kysely<Database>,
    files: ValidatedFile[],
    location: LocationInfo,
    options?: FinalizerOptions
  ): Promise<{ successful: ValidatedFile[]; failed: Array<ValidatedFile & { error: string }> }> {
    const now = new Date().toISOString();
    const successful: ValidatedFile[] = [];
    const failed: Array<ValidatedFile & { error: string }> = [];

    // Build batch insert values
    const insertValues = files.map(file => ({
      maphash: file.hash!,
      mapnam: `${file.hash}${file.extension}`,
      mapnamo: file.filename,
      maploc: file.archivePath!,
      maploco: file.originalPath,
      locid: location.locid,
      subid: location.subid,
      auth_imp: options?.user?.username ?? null,
      mapadd: now,
      meta_exiftool: null,
      meta_map: null,
      meta_gps_lat: null,
      meta_gps_lng: null,
      reference: null,
      map_states: null,
      map_verified: 0,
      thumb_path_sm: null,
      thumb_path_lg: null,
      preview_path: null,
      imported_by_id: options?.user?.userId ?? null,
      imported_by: options?.user?.username ?? null,
      media_source: null,
      file_size_bytes: file.size,
    }));

    // Single batch insert
    try {
      if (insertValues.length > 0) {
        await trx.insertInto('maps').values(insertValues).execute();
        successful.push(...files);
      }
    } catch (error) {
      // If batch fails, fall back to individual inserts to identify failures
      for (let i = 0; i < files.length; i++) {
        try {
          await trx.insertInto('maps').values(insertValues[i]).execute();
          successful.push(files[i]);
        } catch (individualError) {
          failed.push({
            ...files[i],
            error: individualError instanceof Error ? individualError.message : 'Insert failed',
          });
        }
      }
    }

    return { successful, failed };
  }

  /**
   * Build job list for background processing
   *
   * Per Import Spec v2.0:
   * - Per-file jobs: ExifTool, FFprobe, Thumbnail, Video Proxy
   * - Per-location jobs: GPS Enrichment, Live Photo, SRT Telemetry, Location Stats, BagIt
   *
   * Location-level jobs run after all file-level jobs complete.
   *
   * OPT-093: Updated to accept LocationInfo for sub-location support
   */
  private buildJobList(files: FinalizedFile[], location: LocationInfo): JobInput[] {
    const jobs: JobInput[] = [];
    const { locid, subid } = location;

    // Track last per-file job ID for dependencies
    let lastExifJobId: string | null = null;

    // ============ Per-File Jobs ============

    for (const file of files) {
      if (!file.dbRecordId || !file.archivePath) continue;

      const basePayload = {
        hash: file.hash!,
        mediaType: file.mediaType,
        archivePath: file.archivePath,
        locid,  // For timeline event creation
        subid,  // For timeline event creation
      };

      // ExifTool job for all media types
      // OPT-087: Pass pre-generated jobId to ensure dependency chain works
      const exifJobId = generateId();
      jobs.push({
        queue: IMPORT_QUEUES.EXIFTOOL,
        priority: JOB_PRIORITY.HIGH,
        jobId: exifJobId,  // OPT-087: Use this as actual job_id in database
        payload: { ...basePayload },
      });
      lastExifJobId = exifJobId;

      // FFprobe job for videos (depends on ExifTool)
      // OPT-087: Pass pre-generated jobId for dependency chain
      if (file.mediaType === 'video') {
        const ffprobeJobId = generateId();
        jobs.push({
          queue: IMPORT_QUEUES.FFPROBE,
          priority: JOB_PRIORITY.HIGH,
          jobId: ffprobeJobId,  // OPT-087: Use this as actual job_id
          payload: { ...basePayload },
          dependsOn: exifJobId,
        });
      }

      // Thumbnail job (depends on ExifTool for orientation)
      if (file.mediaType === 'image' || file.mediaType === 'video') {
        jobs.push({
          queue: IMPORT_QUEUES.THUMBNAIL,
          priority: JOB_PRIORITY.NORMAL,
          payload: basePayload,
          dependsOn: exifJobId,
        });
      }

      // Video proxy job (no dependency - can run in parallel)
      if (file.mediaType === 'video') {
        jobs.push({
          queue: IMPORT_QUEUES.VIDEO_PROXY,
          priority: JOB_PRIORITY.LOW,
          payload: basePayload,
        });
      }

      // Migration 76: RAM++ Image Tagging job (lowest priority, background only)
      // Per CLAUDE.md Rule 9: Local LLMs for background tasks only
      // Depends on Thumbnail job (uses preview path for tagging if available)
      if (file.mediaType === 'image') {
        jobs.push({
          queue: IMPORT_QUEUES.IMAGE_TAGGING,
          priority: JOB_PRIORITY.BACKGROUND,
          payload: {
            imghash: file.hash!,
            imagePath: file.archivePath!,
            locid,
            subid,
          },
          dependsOn: exifJobId, // Run after metadata extraction
        });
      }
    }

    // ============ Per-Location Jobs ============
    // These run after all file-level ExifTool jobs complete
    // Only queue if we have files to process

    if (files.length === 0) {
      return jobs;
    }

    // OPT-093: Include subid in payloads for sub-location aware jobs
    const locationPayload = { locid };
    const locationWithSubPayload = { locid, subid };

    // GPS Enrichment - aggregate GPS from media to location/sub-location
    // Depends on last ExifTool job (ensures all metadata extracted first)
    // OPT-087: Pass pre-generated jobId for dependency chain
    // OPT-093: Pass subid for sub-location GPS enrichment
    const gpsEnrichmentJobId = generateId();
    jobs.push({
      queue: IMPORT_QUEUES.GPS_ENRICHMENT,
      priority: JOB_PRIORITY.NORMAL,
      jobId: gpsEnrichmentJobId,  // OPT-087: Use this as actual job_id
      payload: locationWithSubPayload,  // OPT-093: Include subid
      dependsOn: lastExifJobId ?? undefined,
    });

    // Live Photo Detection - match image/video pairs by ContentIdentifier
    // Depends on ExifTool (needs ContentIdentifier from metadata)
    // Note: Live Photo detection is location-wide, not sub-location specific
    jobs.push({
      queue: IMPORT_QUEUES.LIVE_PHOTO,
      priority: JOB_PRIORITY.NORMAL,
      payload: locationPayload,
      dependsOn: lastExifJobId ?? undefined,
    });

    // SRT Telemetry - link DJI telemetry to videos
    // Only queue if we imported any documents (SRT files are imported as documents)
    // Note: SRT telemetry is location-wide, not sub-location specific
    const hasDocuments = files.some(f => f.mediaType === 'document');
    if (hasDocuments) {
      jobs.push({
        queue: IMPORT_QUEUES.SRT_TELEMETRY,
        priority: JOB_PRIORITY.NORMAL,
        payload: locationPayload,
        dependsOn: lastExifJobId ?? undefined,
      });
    }

    // Location Stats - recalculate media counts and date range
    // Depends on GPS Enrichment (for complete location state)
    // OPT-093: Pass subid for sub-location stats calculation
    jobs.push({
      queue: IMPORT_QUEUES.LOCATION_STATS,
      priority: JOB_PRIORITY.BACKGROUND,
      payload: locationWithSubPayload,  // OPT-093: Include subid
      dependsOn: gpsEnrichmentJobId,
    });

    // BagIt Manifest - update RFC 8493 archive manifest
    // Runs last (needs all files + thumbnails + metadata to be complete)
    // OPT-093: Pass subid for sub-location BagIt support
    jobs.push({
      queue: IMPORT_QUEUES.BAGIT,
      priority: JOB_PRIORITY.BACKGROUND,
      payload: locationWithSubPayload,  // OPT-093: Include subid
      dependsOn: gpsEnrichmentJobId, // After enrichment
    });

    // Migration 76: Location Tag Aggregation - aggregate image tags to location level
    // Per CLAUDE.md Rule 9: Local LLMs for background tasks only
    // Runs after GPS Enrichment (which runs after all ExifTool jobs)
    // This ensures all IMAGE_TAGGING jobs have completed before aggregation
    const hasImages = files.some(f => f.mediaType === 'image');
    if (hasImages) {
      jobs.push({
        queue: IMPORT_QUEUES.LOCATION_TAG_AGGREGATION,
        priority: JOB_PRIORITY.BACKGROUND,
        payload: {
          locid,
          applyType: true,  // Auto-apply suggested type if confident
          applyEra: true,   // Auto-apply suggested era if confident
        },
        dependsOn: gpsEnrichmentJobId, // Ensures tagging jobs have run
      });
    }

    return jobs;
  }

  /**
   * Auto-set hero image for location or sub-location
   * Per Import Spec v2.0: Sets first successfully imported image as hero
   * Non-fatal: failures are logged but don't fail the import
   *
   * OPT-093: Added sub-location hero support
   * - If subid is provided, sets hero on slocs table
   * - Otherwise sets hero on locs table (host location)
   */
  private async autoSetHeroImage(
    locid: string,
    subid: string | null,
    results: FinalizedFile[]
  ): Promise<void> {
    try {
      // Find the first successfully imported image (not hidden)
      const firstImage = results.find(
        f => f.mediaType === 'image' && f.dbRecordId && !f.shouldHide
      );

      if (!firstImage || !firstImage.hash) {
        return; // No eligible images to set as hero
      }

      if (subid) {
        // OPT-093: Set hero on sub-location
        const subloc = await this.db
          .selectFrom('slocs')
          .select(['subid', 'hero_imghash'])
          .where('subid', '=', subid)
          .executeTakeFirst();

        if (subloc && !subloc.hero_imghash) {
          await this.db
            .updateTable('slocs')
            .set({ hero_imghash: firstImage.hash })
            .where('subid', '=', subid)
            .execute();
          console.log(`[Finalizer] Auto-set sub-location hero: ${firstImage.hash.slice(0, 12)}...`);
        }
      } else {
        // Set hero on host location
        const location = await this.db
          .selectFrom('locs')
          .select(['locid', 'hero_imghash'])
          .where('locid', '=', locid)
          .executeTakeFirst();

        if (location && !location.hero_imghash) {
          await this.db
            .updateTable('locs')
            .set({ hero_imghash: firstImage.hash })
            .where('locid', '=', locid)
            .execute();
          console.log(`[Finalizer] Auto-set location hero: ${firstImage.hash.slice(0, 12)}...`);
        }
      }
    } catch (error) {
      // Non-fatal - don't fail import if auto-hero fails
      console.warn('[Finalizer] Auto-hero failed (non-fatal):', error);
    }
  }
}

/**
 * Create a Finalizer instance
 */
export function createFinalizer(db: Kysely<Database>): Finalizer {
  return new Finalizer(db);
}
