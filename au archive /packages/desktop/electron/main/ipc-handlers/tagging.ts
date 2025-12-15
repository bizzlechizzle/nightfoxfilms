/**
 * Image Auto-Tagging IPC Handlers
 *
 * Exposes image tagging system to the renderer:
 * - Get/edit image tags
 * - Location tag summaries
 * - Queue status and management
 * - Service health checks
 *
 * IPC Channel Pattern: `tagging:action`
 *
 * Per CLAUDE.md Rule 9: Local LLMs for background tasks only
 *
 * @module ipc-handlers/tagging
 */

import { ipcMain } from 'electron';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';
import { Blake3IdSchema } from '../ipc-validation';
import { getImageTaggingService } from '../../services/tagging/image-tagging-service';
import { getLocationTagAggregator } from '../../services/tagging/location-tag-aggregator';
import { JobQueue, IMPORT_QUEUES, JOB_PRIORITY } from '../../services/job-queue';
import {
  getTaggingQueueStats,
  queueImageForTagging,
} from '../../services/import/tagging-job-handler';

// ============================================================================
// Schemas
// ============================================================================

const ImageHashSchema = z.string().length(16).regex(/^[a-f0-9]+$/);

const EditTagsInputSchema = z.object({
  imghash: ImageHashSchema,
  tags: z.array(z.string().min(1).max(100)),
});

const LocationIdSchema = Blake3IdSchema;

// ============================================================================
// Handler Registration
// ============================================================================

export function registerTaggingHandlers(db: Kysely<Database>) {
  // ============================================================================
  // Image Tag Operations
  // ============================================================================

  /**
   * Get tags for an image
   */
  ipcMain.handle('tagging:getImageTags', async (_event, imghash: unknown) => {
    try {
      const validHash = ImageHashSchema.parse(imghash);

      const img = await db
        .selectFrom('imgs')
        .select([
          'imghash',
          'auto_tags',
          'auto_tags_source',
          'auto_tags_confidence',
          'auto_tags_at',
          'quality_score',
          'view_type',
        ])
        .where('imghash', '=', validHash)
        .executeTakeFirst();

      if (!img) {
        return { success: false, error: 'Image not found' };
      }

      return {
        success: true,
        imghash: img.imghash,
        tags: img.auto_tags ? JSON.parse(img.auto_tags) : [],
        source: img.auto_tags_source,
        confidence: img.auto_tags_confidence ? JSON.parse(img.auto_tags_confidence) : null,
        taggedAt: img.auto_tags_at,
        qualityScore: img.quality_score,
        viewType: img.view_type,
      };
    } catch (error) {
      console.error('Error getting image tags:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Manually edit tags for an image
   * User-edited tags are stored with source='manual'
   */
  ipcMain.handle('tagging:editImageTags', async (_event, input: unknown) => {
    try {
      const { imghash, tags } = EditTagsInputSchema.parse(input);

      const now = new Date().toISOString();
      await db
        .updateTable('imgs')
        .set({
          auto_tags: JSON.stringify(tags),
          auto_tags_source: 'manual',
          auto_tags_at: now,
        })
        .where('imghash', '=', imghash)
        .execute();

      return { success: true, imghash, tags };
    } catch (error) {
      console.error('Error editing image tags:', error);
      if (error instanceof z.ZodError) {
        return { success: false, error: `Validation error: ${error.errors.map(e => e.message).join(', ')}` };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Re-tag an image (queue for processing)
   */
  ipcMain.handle('tagging:retagImage', async (_event, imghash: unknown) => {
    try {
      const validHash = ImageHashSchema.parse(imghash);

      // Get image info for queueing
      const img = await db
        .selectFrom('imgs')
        .select(['imghash', 'imgloc', 'locid'])
        .where('imghash', '=', validHash)
        .executeTakeFirst();

      if (!img) {
        return { success: false, error: 'Image not found' };
      }

      if (!img.imgloc) {
        return { success: false, error: 'Image has no archive path' };
      }

      if (!img.locid) {
        return { success: false, error: 'Image has no location' };
      }

      // Queue for re-tagging with high priority
      await queueImageForTagging(db, img.imghash, img.imgloc, img.locid, 100);

      return { success: true, imghash: img.imghash, message: 'Queued for re-tagging' };
    } catch (error) {
      console.error('Error queueing image for re-tagging:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Clear tags from an image
   */
  ipcMain.handle('tagging:clearImageTags', async (_event, imghash: unknown) => {
    try {
      const validHash = ImageHashSchema.parse(imghash);

      await db
        .updateTable('imgs')
        .set({
          auto_tags: null,
          auto_tags_source: null,
          auto_tags_confidence: null,
          auto_tags_at: null,
          quality_score: null,
          view_type: null,
        })
        .where('imghash', '=', validHash)
        .execute();

      return { success: true, imghash: validHash };
    } catch (error) {
      console.error('Error clearing image tags:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // Location Tag Summary Operations
  // ============================================================================

  /**
   * Get tag summary for a location
   */
  ipcMain.handle('tagging:getLocationSummary', async (_event, locid: unknown) => {
    try {
      const validLocid = LocationIdSchema.parse(locid);

      const aggregator = getLocationTagAggregator(db);
      const summary = await aggregator.getSummary(validLocid);

      if (!summary) {
        return { success: true, summary: null };
      }

      return { success: true, summary };
    } catch (error) {
      console.error('Error getting location tag summary:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Re-aggregate tags for a location
   */
  ipcMain.handle('tagging:reaggregateLocation', async (_event, locid: unknown) => {
    try {
      const validLocid = LocationIdSchema.parse(locid);

      const aggregator = getLocationTagAggregator(db);
      const result = await aggregator.aggregateLocation(validLocid);

      return {
        success: result.success,
        summary: result.summary,
        error: result.error,
      };
    } catch (error) {
      console.error('Error re-aggregating location tags:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Apply suggested type/era to a location
   */
  ipcMain.handle('tagging:applySuggestions', async (_event, input: unknown) => {
    try {
      const validInput = z.object({
        locid: LocationIdSchema,
        typeThreshold: z.number().min(0).max(1).optional(),
        eraThreshold: z.number().min(0).max(1).optional(),
        overwrite: z.boolean().optional(),
      }).parse(input);

      const aggregator = getLocationTagAggregator(db);
      const result = await aggregator.applySuggestions(validInput.locid, {
        typeThreshold: validInput.typeThreshold,
        eraThreshold: validInput.eraThreshold,
        overwrite: validInput.overwrite,
      });

      return { success: true, ...result };
    } catch (error) {
      console.error('Error applying location suggestions:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // Queue Management
  // ============================================================================

  /**
   * Get tagging queue statistics
   */
  ipcMain.handle('tagging:getQueueStats', async () => {
    try {
      const stats = await getTaggingQueueStats(db);
      return { success: true, stats };
    } catch (error) {
      console.error('Error getting tagging queue stats:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Queue all untagged images for a location
   */
  ipcMain.handle('tagging:queueUntaggedImages', async (_event, locid: unknown) => {
    try {
      const validLocid = LocationIdSchema.parse(locid);

      // Find all untagged images for this location
      const untagged = await db
        .selectFrom('imgs')
        .select(['imghash', 'imgloc', 'locid'])
        .where('locid', '=', validLocid)
        .where('hidden', '=', 0)
        .where(eb => eb.or([
          eb('auto_tags', 'is', null),
          eb('auto_tags', '=', ''),
        ]))
        .execute();

      let queued = 0;
      for (const img of untagged) {
        if (img.imgloc && img.locid) {
          await queueImageForTagging(db, img.imghash, img.imgloc, img.locid, 0);
          queued++;
        }
      }

      return { success: true, queued, total: untagged.length };
    } catch (error) {
      console.error('Error queueing untagged images:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // Service Status
  // ============================================================================

  /**
   * Get image tagging service status
   */
  ipcMain.handle('tagging:getServiceStatus', async () => {
    try {
      const service = getImageTaggingService();
      const status = await service.getStatus();

      return {
        success: true,
        status: {
          available: status.available,
          model: status.model,
          sceneClassifier: status.sceneClassifier,
          lastCheck: status.lastCheck,
          error: status.error,
        },
      };
    } catch (error) {
      console.error('Error getting tagging service status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: { available: false, model: 'none', sceneClassifier: false, error: 'Service unavailable' },
      };
    }
  });

  /**
   * Test tagging service connection
   */
  ipcMain.handle('tagging:testConnection', async () => {
    try {
      const service = getImageTaggingService();
      await service.initialize();
      const status = await service.getStatus();

      return {
        success: status.available,
        model: status.model,
        sceneClassifier: status.sceneClassifier,
        message: status.available
          ? `Connected to image tagging (${status.model})`
          : 'Image tagging service not available',
        error: status.error,
      };
    } catch (error) {
      console.error('Error testing tagging connection:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  console.log('[IPC] Tagging handlers registered');
}
