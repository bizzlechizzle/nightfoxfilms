/**
 * Web Sources IPC Handlers
 * Handles websources:* IPC channels for the OPT-109 Web Archiving feature
 * Replaces bookmarks:* handlers with comprehensive web source management
 * ADR-046: Updated locid/subid validation from UUID to BLAKE3 16-char hex
 * OPT-113: Added auto-archive on create - queues archive job immediately after save
 * OPT-120: Added auto-extraction trigger on archive complete - queues LLM extraction job
 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';
import {
  SQLiteWebSourcesRepository,
  WebSourceInput,
  WebSourceUpdate,
  WebSourceStatus,
  WebSourceType,
  ComponentStatus,
} from '../../repositories/sqlite-websources-repository';
import { validate, LimitSchema, Blake3IdSchema } from '../ipc-validation';
import { JobQueue, IMPORT_QUEUES } from '../../services/job-queue';
import { getExtractionQueueService } from '../../services/extraction/extraction-queue-service';
import { getRawDatabase } from '../database';

// =============================================================================
// Validation Schemas
// =============================================================================

const WebSourceStatusSchema = z.enum(['pending', 'archiving', 'complete', 'partial', 'failed']);

// Source ID can be either:
// - 16-char BLAKE3 hash (new entries)
// - 36-char UUID (legacy migrated from bookmarks)
const SourceIdSchema = z.string().refine(
  (val) => val.length === 16 || val.length === 36,
  { message: 'Source ID must be 16 characters (BLAKE3) or 36 characters (UUID)' }
);

const WebSourceTypeSchema = z.enum([
  'article',
  'gallery',
  'video',
  'social',
  'map',
  'document',
  'archive',
  'other',
]);

const ComponentStatusSchema = z.object({
  screenshot: z.enum(['pending', 'done', 'failed', 'skipped']).optional(),
  pdf: z.enum(['pending', 'done', 'failed', 'skipped']).optional(),
  html: z.enum(['pending', 'done', 'failed', 'skipped']).optional(),
  warc: z.enum(['pending', 'done', 'failed', 'skipped']).optional(),
  images: z.enum(['pending', 'done', 'failed', 'skipped']).optional(),
  videos: z.enum(['pending', 'done', 'failed', 'skipped']).optional(),
  text: z.enum(['pending', 'done', 'failed', 'skipped']).optional(),
});

const WebSourceInputSchema = z.object({
  url: z.string().url(),
  title: z.string().nullable().optional(),
  locid: Blake3IdSchema.nullable().optional(),
  subid: Blake3IdSchema.nullable().optional(),
  source_type: WebSourceTypeSchema.optional(),
  notes: z.string().nullable().optional(),
  auth_imp: z.string().nullable().optional(),
});

const WebSourceUpdateSchema = z.object({
  title: z.string().nullable().optional(),
  locid: Blake3IdSchema.nullable().optional(),
  subid: Blake3IdSchema.nullable().optional(),
  source_type: WebSourceTypeSchema.optional(),
  notes: z.string().nullable().optional(),
  status: WebSourceStatusSchema.optional(),
  component_status: ComponentStatusSchema.optional(),
  extracted_title: z.string().nullable().optional(),
  extracted_author: z.string().nullable().optional(),
  extracted_date: z.string().nullable().optional(),
  extracted_publisher: z.string().nullable().optional(),
  word_count: z.number().int().nonnegative().optional(),
  image_count: z.number().int().nonnegative().optional(),
  video_count: z.number().int().nonnegative().optional(),
  archive_path: z.string().nullable().optional(),
  screenshot_path: z.string().nullable().optional(),
  pdf_path: z.string().nullable().optional(),
  html_path: z.string().nullable().optional(),
  warc_path: z.string().nullable().optional(),
  screenshot_hash: z.string().length(16).nullable().optional(),
  pdf_hash: z.string().length(16).nullable().optional(),
  html_hash: z.string().length(16).nullable().optional(),
  warc_hash: z.string().length(16).nullable().optional(),
  content_hash: z.string().length(16).nullable().optional(),
  provenance_hash: z.string().length(16).nullable().optional(),
  archive_error: z.string().nullable().optional(),
  retry_count: z.number().int().nonnegative().optional(),
  archived_at: z.string().datetime().nullable().optional(),
});

const ArchiveCompleteOptionsSchema = z.object({
  archive_path: z.string(),
  screenshot_path: z.string().nullable().optional(),
  pdf_path: z.string().nullable().optional(),
  html_path: z.string().nullable().optional(),
  warc_path: z.string().nullable().optional(),
  screenshot_hash: z.string().length(16).nullable().optional(),
  pdf_hash: z.string().length(16).nullable().optional(),
  html_hash: z.string().length(16).nullable().optional(),
  warc_hash: z.string().length(16).nullable().optional(),
  content_hash: z.string().length(16).nullable().optional(),
  provenance_hash: z.string().length(16).nullable().optional(),
  extracted_title: z.string().nullable().optional(),
  extracted_author: z.string().nullable().optional(),
  extracted_date: z.string().nullable().optional(),
  extracted_publisher: z.string().nullable().optional(),
  word_count: z.number().int().nonnegative().optional(),
  image_count: z.number().int().nonnegative().optional(),
  video_count: z.number().int().nonnegative().optional(),
});

const VersionOptionsSchema = z.object({
  archive_path: z.string(),
  screenshot_path: z.string().nullable().optional(),
  pdf_path: z.string().nullable().optional(),
  html_path: z.string().nullable().optional(),
  warc_path: z.string().nullable().optional(),
  screenshot_hash: z.string().length(16).nullable().optional(),
  pdf_hash: z.string().length(16).nullable().optional(),
  html_hash: z.string().length(16).nullable().optional(),
  warc_hash: z.string().length(16).nullable().optional(),
  content_hash: z.string().length(16).nullable().optional(),
});

const SearchOptionsSchema = z.object({
  locid: Blake3IdSchema.optional(),
  limit: z.number().int().positive().max(1000).optional(),
});

// =============================================================================
// Handler Registration
// =============================================================================

export function registerWebSourcesHandlers(db: Kysely<Database>) {
  const webSourcesRepo = new SQLiteWebSourcesRepository(db);
  const jobQueue = new JobQueue(db);

  // ---------------------------------------------------------------------------
  // Core CRUD Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new web source
   * OPT-113: Auto-queues archive job immediately after creation
   */
  ipcMain.handle('websources:create', async (_event, input: unknown) => {
    try {
      const validatedInput = WebSourceInputSchema.parse(input) as WebSourceInput;
      const source = await webSourcesRepo.create(validatedInput);

      // OPT-113: Auto-queue archive job (non-blocking)
      try {
        // Check if job already exists for this source (duplicate prevention)
        const existingJobs = await db
          .selectFrom('jobs')
          .select('job_id')
          .where('queue', '=', IMPORT_QUEUES.WEBSOURCE_ARCHIVE)
          .where('status', 'in', ['pending', 'processing'])
          .where('payload', 'like', `%"sourceId":"${source.source_id}"%`)
          .execute();

        if (existingJobs.length === 0) {
          await jobQueue.addJob({
            queue: IMPORT_QUEUES.WEBSOURCE_ARCHIVE,
            payload: { sourceId: source.source_id },
            priority: 5, // Lower priority than media imports (default 10)
          });
          console.log(`[WebSources] Auto-queued archive job for ${source.source_id}`);
        } else {
          console.log(`[WebSources] Archive job already queued for ${source.source_id}`);
        }
      } catch (queueError) {
        // Don't fail create if queue fails - just log and continue
        console.error('[WebSources] Failed to queue archive job:', queueError);
      }

      return source;
    } catch (error) {
      console.error('Error creating web source:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Find a web source by ID
   */
  ipcMain.handle('websources:findById', async (_event, source_id: unknown) => {
    try {
      const validatedId = SourceIdSchema.parse(source_id);
      return await webSourcesRepo.findById(validatedId);
    } catch (error) {
      console.error('Error finding web source:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Find a web source by URL
   */
  ipcMain.handle('websources:findByUrl', async (_event, url: unknown) => {
    try {
      const validatedUrl = z.string().url().parse(url);
      return await webSourcesRepo.findByUrl(validatedUrl);
    } catch (error) {
      console.error('Error finding web source by URL:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Find all web sources for a location
   */
  ipcMain.handle('websources:findByLocation', async (_event, locid: unknown) => {
    try {
      const validatedId = Blake3IdSchema.parse(locid);
      return await webSourcesRepo.findByLocation(validatedId);
    } catch (error) {
      console.error('Error finding web sources by location:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Find all web sources for a sub-location
   */
  ipcMain.handle('websources:findBySubLocation', async (_event, subid: unknown) => {
    try {
      const validatedId = Blake3IdSchema.parse(subid);
      return await webSourcesRepo.findBySubLocation(validatedId);
    } catch (error) {
      console.error('Error finding web sources by sub-location:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Find web sources by status
   */
  ipcMain.handle('websources:findByStatus', async (_event, status: unknown) => {
    try {
      const validatedStatus = WebSourceStatusSchema.parse(status) as WebSourceStatus;
      return await webSourcesRepo.findByStatus(validatedStatus);
    } catch (error) {
      console.error('Error finding web sources by status:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Find pending sources ready for archiving
   */
  ipcMain.handle('websources:findPendingForArchive', async (_event, limit: unknown = 10) => {
    try {
      const validatedLimit = validate(LimitSchema, limit);
      return await webSourcesRepo.findPendingForArchive(validatedLimit);
    } catch (error) {
      console.error('Error finding pending web sources:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Find recently added sources
   */
  ipcMain.handle('websources:findRecent', async (_event, limit: unknown = 10) => {
    try {
      const validatedLimit = validate(LimitSchema, limit);
      return await webSourcesRepo.findRecent(validatedLimit);
    } catch (error) {
      console.error('Error finding recent web sources:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Find all web sources
   */
  ipcMain.handle('websources:findAll', async () => {
    try {
      return await webSourcesRepo.findAll();
    } catch (error) {
      console.error('Error finding all web sources:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Update a web source
   */
  ipcMain.handle('websources:update', async (_event, source_id: unknown, updates: unknown) => {
    try {
      const validatedId = SourceIdSchema.parse(source_id);
      const validatedUpdates = WebSourceUpdateSchema.parse(updates) as WebSourceUpdate;
      return await webSourcesRepo.update(validatedId, validatedUpdates);
    } catch (error) {
      console.error('Error updating web source:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Delete a web source
   */
  ipcMain.handle('websources:delete', async (_event, source_id: unknown) => {
    try {
      const validatedId = SourceIdSchema.parse(source_id);
      await webSourcesRepo.delete(validatedId);
    } catch (error) {
      console.error('Error deleting web source:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ---------------------------------------------------------------------------
  // Archive Status Management
  // ---------------------------------------------------------------------------

  /**
   * Mark a source as archiving in progress
   */
  ipcMain.handle('websources:markArchiving', async (_event, source_id: unknown) => {
    try {
      const validatedId = SourceIdSchema.parse(source_id);
      await webSourcesRepo.markArchiving(validatedId);
    } catch (error) {
      console.error('Error marking web source as archiving:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Mark a source as archive complete
   * OPT-120: Also queues extraction job for LLM processing
   */
  ipcMain.handle('websources:markComplete', async (_event, source_id: unknown, options: unknown) => {
    try {
      const validatedId = SourceIdSchema.parse(source_id);
      const validatedOptions = ArchiveCompleteOptionsSchema.parse(options);
      const result = await webSourcesRepo.markComplete(validatedId, validatedOptions);

      // OPT-120: Queue extraction job (non-blocking)
      try {
        // Get the source to find locid
        const source = await webSourcesRepo.findById(validatedId);
        if (source) {
          const sqliteDb = getRawDatabase();
          const extractionQueue = getExtractionQueueService(sqliteDb);
          await extractionQueue.enqueue(
            'web_source',
            validatedId,
            source.locid || null,
            ['dates', 'entities', 'title', 'summary']
          );
          console.log(`[WebSources] Auto-queued extraction job for ${validatedId}`);
        }
      } catch (queueError) {
        // Don't fail if extraction queue fails - just log
        console.error('[WebSources] Failed to queue extraction job:', queueError);
      }

      return result;
    } catch (error) {
      console.error('Error marking web source as complete:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Mark a source as partially archived
   */
  ipcMain.handle(
    'websources:markPartial',
    async (_event, source_id: unknown, component_status: unknown, archive_path: unknown) => {
      try {
        const validatedId = SourceIdSchema.parse(source_id);
        const validatedComponentStatus = ComponentStatusSchema.parse(component_status) as ComponentStatus;
        const validatedPath = z.string().parse(archive_path);
        return await webSourcesRepo.markPartial(validatedId, validatedComponentStatus, { archive_path: validatedPath });
      } catch (error) {
        console.error('Error marking web source as partial:', error);
        if (error instanceof z.ZodError) {
          throw new Error(
            `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
          );
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
      }
    }
  );

  /**
   * Mark a source as failed
   */
  ipcMain.handle('websources:markFailed', async (_event, source_id: unknown, error_message: unknown) => {
    try {
      const validatedId = SourceIdSchema.parse(source_id);
      const validatedError = z.string().parse(error_message);
      return await webSourcesRepo.markFailed(validatedId, validatedError);
    } catch (error) {
      console.error('Error marking web source as failed:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Reset a failed source to pending for retry
   */
  ipcMain.handle('websources:resetToPending', async (_event, source_id: unknown) => {
    try {
      const validatedId = SourceIdSchema.parse(source_id);
      return await webSourcesRepo.resetToPending(validatedId);
    } catch (error) {
      console.error('Error resetting web source to pending:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Update component status during archiving
   */
  ipcMain.handle(
    'websources:updateComponentStatus',
    async (_event, source_id: unknown, component_status: unknown) => {
      try {
        const validatedId = SourceIdSchema.parse(source_id);
        const validatedComponentStatus = ComponentStatusSchema.parse(component_status) as ComponentStatus;
        await webSourcesRepo.updateComponentStatus(validatedId, validatedComponentStatus);
      } catch (error) {
        console.error('Error updating component status:', error);
        if (error instanceof z.ZodError) {
          throw new Error(
            `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
          );
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Version Management
  // ---------------------------------------------------------------------------

  /**
   * Create a new version snapshot
   */
  ipcMain.handle('websources:createVersion', async (_event, source_id: unknown, options: unknown) => {
    try {
      const validatedId = SourceIdSchema.parse(source_id);
      const validatedOptions = VersionOptionsSchema.parse(options);
      return await webSourcesRepo.createVersion(validatedId, validatedOptions);
    } catch (error) {
      console.error('Error creating web source version:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Find all versions for a web source
   */
  ipcMain.handle('websources:findVersions', async (_event, source_id: unknown) => {
    try {
      const validatedId = SourceIdSchema.parse(source_id);
      return await webSourcesRepo.findVersions(validatedId);
    } catch (error) {
      console.error('Error finding web source versions:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Find a specific version by number
   */
  ipcMain.handle(
    'websources:findVersionByNumber',
    async (_event, source_id: unknown, version_number: unknown) => {
      try {
        const validatedId = SourceIdSchema.parse(source_id);
        const validatedVersion = z.number().int().positive().parse(version_number);
        return await webSourcesRepo.findVersionByNumber(validatedId, validatedVersion);
      } catch (error) {
        console.error('Error finding web source version:', error);
        if (error instanceof z.ZodError) {
          throw new Error(
            `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
          );
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
      }
    }
  );

  /**
   * Get latest version for a web source
   */
  ipcMain.handle('websources:findLatestVersion', async (_event, source_id: unknown) => {
    try {
      const validatedId = SourceIdSchema.parse(source_id);
      return await webSourcesRepo.findLatestVersion(validatedId);
    } catch (error) {
      console.error('Error finding latest web source version:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get version count for a web source
   */
  ipcMain.handle('websources:countVersions', async (_event, source_id: unknown) => {
    try {
      const validatedId = SourceIdSchema.parse(source_id);
      return await webSourcesRepo.countVersions(validatedId);
    } catch (error) {
      console.error('Error counting web source versions:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ---------------------------------------------------------------------------
  // Full-Text Search
  // ---------------------------------------------------------------------------

  /**
   * Search web sources using full-text search
   */
  ipcMain.handle('websources:search', async (_event, query: unknown, options: unknown = {}) => {
    try {
      const validatedQuery = z.string().min(1).parse(query);
      const validatedOptions = SearchOptionsSchema.parse(options);
      return await webSourcesRepo.search(validatedQuery, validatedOptions);
    } catch (error) {
      console.error('Error searching web sources:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get overall statistics
   */
  ipcMain.handle('websources:getStats', async () => {
    try {
      return await webSourcesRepo.getStats();
    } catch (error) {
      console.error('Error getting web sources stats:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get statistics for a specific location
   */
  ipcMain.handle('websources:getStatsByLocation', async (_event, locid: unknown) => {
    try {
      const validatedId = Blake3IdSchema.parse(locid);
      return await webSourcesRepo.getStatsByLocation(validatedId);
    } catch (error) {
      console.error('Error getting web sources stats by location:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get total count
   */
  ipcMain.handle('websources:count', async () => {
    try {
      return await webSourcesRepo.count();
    } catch (error) {
      console.error('Error counting web sources:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get count by location
   */
  ipcMain.handle('websources:countByLocation', async (_event, locid: unknown) => {
    try {
      const validatedId = Blake3IdSchema.parse(locid);
      return await webSourcesRepo.countByLocation(validatedId);
    } catch (error) {
      console.error('Error counting web sources by location:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get count by sub-location
   */
  ipcMain.handle('websources:countBySubLocation', async (_event, subid: unknown) => {
    try {
      const validatedId = Blake3IdSchema.parse(subid);
      return await webSourcesRepo.countBySubLocation(validatedId);
    } catch (error) {
      console.error('Error counting web sources by sub-location:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ---------------------------------------------------------------------------
  // Migration
  // ---------------------------------------------------------------------------

  /**
   * Migrate existing bookmarks to web sources
   */
  ipcMain.handle('websources:migrateFromBookmarks', async () => {
    try {
      return await webSourcesRepo.migrateFromBookmarks();
    } catch (error) {
      console.error('Error migrating bookmarks to web sources:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ---------------------------------------------------------------------------
  // Orchestrator (Archive Operations)
  // ---------------------------------------------------------------------------

  // Import orchestrator (lazy to avoid circular deps)
  let orchestrator: ReturnType<typeof import('../../services/websource-orchestrator-service').getOrchestrator> | null = null;

  const getOrchestratorInstance = async () => {
    if (!orchestrator) {
      const { getOrchestrator } = await import('../../services/websource-orchestrator-service');
      orchestrator = getOrchestrator(db);
    }
    return orchestrator;
  };

  const ArchiveOptionsSchema = z.object({
    captureScreenshot: z.boolean().optional(),
    capturePdf: z.boolean().optional(),
    captureHtml: z.boolean().optional(),
    captureWarc: z.boolean().optional(),
    extractImages: z.boolean().optional(),
    extractVideos: z.boolean().optional(),
    extractText: z.boolean().optional(),
    linkMedia: z.boolean().optional(),
    timeout: z.number().int().positive().optional(),
    maxImages: z.number().int().positive().optional(),
    maxVideos: z.number().int().positive().optional(),
  });

  /**
   * Archive a single web source
   */
  ipcMain.handle('websources:archive', async (_event, source_id: unknown, options: unknown = {}) => {
    try {
      const validatedId = SourceIdSchema.parse(source_id);
      const validatedOptions = ArchiveOptionsSchema.parse(options);
      const orch = await getOrchestratorInstance();
      return await orch.archiveSource(validatedId, validatedOptions);
    } catch (error) {
      console.error('Error archiving web source:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Archive all pending web sources
   */
  ipcMain.handle('websources:archivePending', async (_event, limit: unknown = 10, options: unknown = {}) => {
    try {
      const validatedLimit = validate(LimitSchema, limit);
      const validatedOptions = ArchiveOptionsSchema.parse(options);
      const orch = await getOrchestratorInstance();
      return await orch.archivePending(validatedLimit, validatedOptions);
    } catch (error) {
      console.error('Error archiving pending web sources:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Re-archive an existing source (create new version)
   */
  ipcMain.handle('websources:rearchive', async (_event, source_id: unknown, options: unknown = {}) => {
    try {
      const validatedId = SourceIdSchema.parse(source_id);
      const validatedOptions = ArchiveOptionsSchema.parse(options);
      const orch = await getOrchestratorInstance();
      return await orch.rearchiveSource(validatedId, validatedOptions);
    } catch (error) {
      console.error('Error re-archiving web source:', error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Cancel current archiving operation
   */
  ipcMain.handle('websources:cancelArchive', async () => {
    try {
      const orch = await getOrchestratorInstance();
      await orch.cancel();
    } catch (error) {
      console.error('Error cancelling archive:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get current archiving status
   */
  ipcMain.handle('websources:archiveStatus', async () => {
    try {
      const orch = await getOrchestratorInstance();
      return orch.getStatus();
    } catch (error) {
      console.error('Error getting archive status:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // =============================================================================
  // OPT-111: Enhanced Metadata Handlers
  // =============================================================================

  /**
   * Get all images for a web source
   */
  ipcMain.handle('websources:getImages', async (_event, sourceId: string) => {
    try {
      const validatedId = SourceIdSchema.parse(sourceId);
      return await webSourcesRepo.findImages(validatedId);
    } catch (error) {
      console.error('Error getting web source images:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get all videos for a web source
   */
  ipcMain.handle('websources:getVideos', async (_event, sourceId: string) => {
    try {
      const validatedId = SourceIdSchema.parse(sourceId);
      return await webSourcesRepo.findVideos(validatedId);
    } catch (error) {
      console.error('Error getting web source videos:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get full detail for archive viewer (source + images + videos + intelligence)
   * OPT-120: Enhanced to include LLM-extracted data
   */
  ipcMain.handle('websources:getDetail', async (_event, sourceId: string) => {
    try {
      const validatedId = SourceIdSchema.parse(sourceId);

      const source = await webSourcesRepo.findById(validatedId);
      if (!source) {
        throw new Error('Web source not found');
      }

      const images = await webSourcesRepo.findImages(validatedId);
      const videos = await webSourcesRepo.findVideos(validatedId);

      // OPT-120: Fetch LLM-extracted intelligence data
      // Document summary
      const summary = await db
        .selectFrom('document_summaries')
        .selectAll()
        .where('source_type', '=', 'web_source')
        .where('source_id', '=', validatedId)
        .executeTakeFirst();

      // Entity extractions (people, organizations)
      const entities = await db
        .selectFrom('entity_extractions')
        .selectAll()
        .where('source_type', '=', 'web_source')
        .where('source_id', '=', validatedId)
        .where('status', 'in', ['pending', 'approved'])
        .orderBy('entity_type')
        .orderBy('entity_name')
        .execute();

      // Date extractions (LLM-detected dates from text)
      const extractedDates = await db
        .selectFrom('date_extractions')
        .selectAll()
        .where('source_type', '=', 'web_source')
        .where('source_id', '=', validatedId)
        .orderBy('parsed_date', 'asc')
        .execute();

      return {
        source,
        images,
        videos,
        // OPT-120: Intelligence data
        intelligence: {
          summary: summary || null,
          entities: entities || [],
          extractedDates: extractedDates || [],
        },
      };
    } catch (error) {
      console.error('Error getting web source detail:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ---------------------------------------------------------------------------
  // OPT-113: Archive Queue Operations
  // ---------------------------------------------------------------------------

  /**
   * Get count of pending web sources (global)
   */
  ipcMain.handle('websources:countPending', async () => {
    try {
      const result = await db
        .selectFrom('web_sources')
        .select(db.fn.count('source_id').as('count'))
        .where('status', '=', 'pending')
        .executeTakeFirst();

      return Number(result?.count || 0);
    } catch (error) {
      console.error('Error counting pending web sources:', error);
      return 0;
    }
  });

  /**
   * Get count of pending web sources for a specific location
   */
  ipcMain.handle('websources:countPendingByLocation', async (_event, locid: unknown) => {
    try {
      const validatedLocid = Blake3IdSchema.parse(locid);

      const result = await db
        .selectFrom('web_sources')
        .select(db.fn.count('source_id').as('count'))
        .where('locid', '=', validatedLocid)
        .where('status', '=', 'pending')
        .executeTakeFirst();

      return Number(result?.count || 0);
    } catch (error) {
      console.error('Error counting pending web sources for location:', error);
      return 0;
    }
  });

  /**
   * Queue all pending web sources for archiving (global)
   * Returns count of newly queued jobs
   */
  ipcMain.handle('websources:archiveAllPending', async (_event, limit: unknown = 100) => {
    try {
      const validatedLimit = validate(LimitSchema, limit) ?? 100;

      // Find pending sources
      const pendingSources = await db
        .selectFrom('web_sources')
        .select('source_id')
        .where('status', '=', 'pending')
        .limit(validatedLimit)
        .execute();

      let queued = 0;

      for (const source of pendingSources) {
        // Check if job already exists (duplicate prevention)
        const existing = await db
          .selectFrom('jobs')
          .select('job_id')
          .where('queue', '=', IMPORT_QUEUES.WEBSOURCE_ARCHIVE)
          .where('status', 'in', ['pending', 'processing'])
          .where('payload', 'like', `%"sourceId":"${source.source_id}"%`)
          .execute();

        if (existing.length === 0) {
          await jobQueue.addJob({
            queue: IMPORT_QUEUES.WEBSOURCE_ARCHIVE,
            payload: { sourceId: source.source_id },
            priority: 5,
          });
          queued++;
        }
      }

      console.log(`[WebSources] Queued ${queued} of ${pendingSources.length} pending sources for archiving`);
      return { queued, total: pendingSources.length };
    } catch (error) {
      console.error('Error archiving all pending:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Queue pending web sources for a specific location
   * Returns count of newly queued jobs
   */
  ipcMain.handle('websources:archivePendingByLocation', async (_event, locid: unknown, limit: unknown = 50) => {
    try {
      const validatedLocid = Blake3IdSchema.parse(locid);
      const validatedLimit = validate(LimitSchema, limit) ?? 50;

      // Find pending sources for this location
      const pendingSources = await db
        .selectFrom('web_sources')
        .select('source_id')
        .where('locid', '=', validatedLocid)
        .where('status', '=', 'pending')
        .limit(validatedLimit)
        .execute();

      let queued = 0;

      for (const source of pendingSources) {
        // Check if job already exists (duplicate prevention)
        const existing = await db
          .selectFrom('jobs')
          .select('job_id')
          .where('queue', '=', IMPORT_QUEUES.WEBSOURCE_ARCHIVE)
          .where('status', 'in', ['pending', 'processing'])
          .where('payload', 'like', `%"sourceId":"${source.source_id}"%`)
          .execute();

        if (existing.length === 0) {
          await jobQueue.addJob({
            queue: IMPORT_QUEUES.WEBSOURCE_ARCHIVE,
            payload: { sourceId: source.source_id },
            priority: 5,
          });
          queued++;
        }
      }

      console.log(`[WebSources] Queued ${queued} of ${pendingSources.length} pending sources for location ${validatedLocid}`);
      return { queued, total: pendingSources.length };
    } catch (error) {
      console.error('Error archiving pending by location:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });
}
