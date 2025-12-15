/**
 * Date Engine IPC Handlers
 * Handles dateEngine:* channels for NLP date extraction
 */

import { ipcMain } from 'electron';
import { Kysely } from 'kysely';
import { SqliteDateExtractionRepository } from '../../repositories/sqlite-date-extraction-repository';
import {
  DateExtractionProcessor,
  createDateExtractionProcessor,
} from '../../services/date-extraction-processor';
import {
  extractDates,
  testPattern,
  validatePattern,
} from '../../services/date-engine-service';
import type { Database } from '../database.types';
import type {
  DateExtractionFilters,
  DatePatternInput,
  BackfillOptions,
  ExtractFromTextInput,
  ExtractionSourceType,
} from '@au-archive/core';

let processor: DateExtractionProcessor | null = null;
let repository: SqliteDateExtractionRepository | null = null;
let dbInstance: Kysely<Database> | null = null;

/**
 * Initialize services
 */
function getServices(db: Kysely<Database>): {
  processor: DateExtractionProcessor;
  repository: SqliteDateExtractionRepository;
} {
  if (!processor || !repository) {
    repository = new SqliteDateExtractionRepository(db);
    processor = createDateExtractionProcessor(db);
    dbInstance = db;
  }
  return { processor, repository };
}

/**
 * Register all date engine IPC handlers
 */
export function registerDateEngineHandlers(db: Kysely<Database>): void {
  const { processor, repository } = getServices(db);

  // ==========================================================================
  // Extraction
  // ==========================================================================

  /**
   * Extract dates from a web source
   */
  ipcMain.handle(
    'dateEngine:extractFromWebSource',
    async (_, sourceId: string) => {
      // Get the web source
      const source = await db
        .selectFrom('web_sources')
        .select(['source_id', 'extracted_text', 'locid', 'subid', 'extracted_date'])
        .where('source_id', '=', sourceId)
        .executeTakeFirst();

      if (!source || !source.extracted_text) {
        return [];
      }

      const extractions = await processor.processText(
        source.extracted_text,
        'web_source',
        sourceId,
        source.locid,
        source.subid,
        source.extracted_date
      );

      // Update tracking on web_sources
      await db
        .updateTable('web_sources')
        .set({
          dates_extracted_at: new Date().toISOString(),
          dates_extraction_count: extractions.length,
        })
        .where('source_id', '=', sourceId)
        .execute();

      return extractions;
    }
  );

  /**
   * Extract dates from arbitrary text
   */
  ipcMain.handle(
    'dateEngine:extractFromText',
    async (_, input: ExtractFromTextInput) => {
      const sourceId = input.source_id || `manual:${Date.now()}`;
      const sourceType = input.source_type || 'manual';

      return processor.processText(
        input.text,
        sourceType,
        sourceId,
        input.locid ?? null,
        input.subid ?? null,
        input.article_date ?? null
      );
    }
  );

  /**
   * Parse text without storing (preview mode)
   */
  ipcMain.handle(
    'dateEngine:preview',
    async (_, text: string, articleDate?: string) => {
      return extractDates(text, articleDate);
    }
  );

  // ==========================================================================
  // Backfill
  // ==========================================================================

  /**
   * Backfill all existing web sources
   */
  ipcMain.handle(
    'dateEngine:backfillWebSources',
    async (_, options?: BackfillOptions) => {
      const results: Array<{
        processed: number;
        total: number;
        extractions_found: number;
        errors: number;
      }> = [];

      for await (const progress of processor.backfillWebSources(options)) {
        results.push({
          processed: progress.processed,
          total: progress.total,
          extractions_found: progress.extractions_found,
          errors: progress.errors,
        });
      }

      // Return final result
      return results[results.length - 1] || {
        processed: 0,
        total: 0,
        extractions_found: 0,
        errors: 0,
      };
    }
  );

  /**
   * Backfill image captions
   */
  ipcMain.handle(
    'dateEngine:backfillImageCaptions',
    async (_, options?: BackfillOptions) => {
      const results: Array<{
        processed: number;
        total: number;
        extractions_found: number;
        errors: number;
      }> = [];

      for await (const progress of processor.backfillImageCaptions(options)) {
        results.push({
          processed: progress.processed,
          total: progress.total,
          extractions_found: progress.extractions_found,
          errors: progress.errors,
        });
      }

      // Return final result
      return results[results.length - 1] || {
        processed: 0,
        total: 0,
        extractions_found: 0,
        errors: 0,
      };
    }
  );

  // ==========================================================================
  // Query
  // ==========================================================================

  /**
   * Get pending extractions for review (global queue)
   */
  ipcMain.handle(
    'dateEngine:getPendingReview',
    async (_, limit?: number, offset?: number) => {
      return repository.getPendingReview(limit, offset);
    }
  );

  /**
   * Get pending extractions for a specific location
   */
  ipcMain.handle('dateEngine:getPendingByLocation', async (_, locid: string) => {
    return repository.getPendingByLocation(locid);
  });

  /**
   * Get all extractions for a location
   */
  ipcMain.handle(
    'dateEngine:getByLocation',
    async (_, locid: string, filters?: Partial<DateExtractionFilters>) => {
      return repository.find({ ...filters, locid });
    }
  );

  /**
   * Get extractions with timeline conflicts
   */
  ipcMain.handle('dateEngine:getConflicts', async () => {
    return repository.getConflicts();
  });

  /**
   * Get a single extraction by ID
   */
  ipcMain.handle('dateEngine:getById', async (_, extractionId: string) => {
    return repository.findById(extractionId);
  });

  /**
   * Search extractions with filters
   */
  ipcMain.handle(
    'dateEngine:find',
    async (_, filters: DateExtractionFilters) => {
      return repository.find(filters);
    }
  );

  // ==========================================================================
  // Review Actions
  // ==========================================================================

  /**
   * Approve an extraction
   */
  ipcMain.handle(
    'dateEngine:approve',
    async (_, extractionId: string, userId: string) => {
      return processor.approveWithLearning(extractionId, userId);
    }
  );

  /**
   * Reject an extraction
   */
  ipcMain.handle(
    'dateEngine:reject',
    async (_, extractionId: string, userId: string, reason?: string) => {
      return processor.rejectWithLearning(extractionId, userId, reason);
    }
  );

  /**
   * Approve and resolve timeline conflict
   */
  ipcMain.handle(
    'dateEngine:approveAndResolveConflict',
    async (
      _,
      extractionId: string,
      userId: string,
      updateTimeline: boolean
    ) => {
      return processor.approveAndResolveConflict(
        extractionId,
        userId,
        updateTimeline
      );
    }
  );

  /**
   * Convert approved extraction to timeline event
   */
  ipcMain.handle(
    'dateEngine:convertToTimeline',
    async (_, extractionId: string, userId?: string) => {
      return processor.convertToTimeline(extractionId, userId);
    }
  );

  /**
   * Revert a converted extraction
   */
  ipcMain.handle(
    'dateEngine:revert',
    async (_, extractionId: string, userId: string) => {
      return processor.revert(extractionId, userId);
    }
  );

  /**
   * Merge duplicate extractions
   */
  ipcMain.handle(
    'dateEngine:mergeDuplicates',
    async (_, primaryId: string, duplicateId: string) => {
      await repository.markAsDuplicate(duplicateId, primaryId);
      return repository.findById(primaryId);
    }
  );

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get extraction statistics
   */
  ipcMain.handle('dateEngine:getStats', async () => {
    return repository.getStats();
  });

  /**
   * Get ML learning statistics
   */
  ipcMain.handle('dateEngine:getLearningStats', async () => {
    return repository.getLearningStats();
  });

  // ==========================================================================
  // CSV Export/Import
  // ==========================================================================

  /**
   * Export pending extractions to CSV
   */
  ipcMain.handle('dateEngine:exportPending', async () => {
    return processor.exportPending();
  });

  /**
   * Import reviewed CSV
   */
  ipcMain.handle(
    'dateEngine:importReviewed',
    async (_, csvContent: string, userId: string) => {
      return processor.importReviewed(csvContent, userId);
    }
  );

  // ==========================================================================
  // Custom Patterns
  // ==========================================================================

  /**
   * Get all custom patterns
   */
  ipcMain.handle('dateEngine:getPatterns', async (_, enabledOnly?: boolean) => {
    return repository.getPatterns(enabledOnly ?? true);
  });

  /**
   * Get a single pattern
   */
  ipcMain.handle('dateEngine:getPattern', async (_, patternId: string) => {
    return repository.getPattern(patternId);
  });

  /**
   * Save (create or update) a pattern
   */
  ipcMain.handle(
    'dateEngine:savePattern',
    async (_, patternId: string | null, input: DatePatternInput) => {
      // Validate the regex
      const validation = validatePattern(input.regex);
      if (!validation.valid) {
        throw new Error(`Invalid pattern: ${validation.error}`);
      }

      if (patternId) {
        return repository.updatePattern(patternId, input);
      } else {
        return repository.createPattern(input);
      }
    }
  );

  /**
   * Delete a pattern
   */
  ipcMain.handle('dateEngine:deletePattern', async (_, patternId: string) => {
    return repository.deletePattern(patternId);
  });

  /**
   * Test a pattern against sample text
   */
  ipcMain.handle(
    'dateEngine:testPattern',
    async (_, pattern: string, testText: string) => {
      return testPattern(pattern, testText);
    }
  );

  // ==========================================================================
  // OCR Document Extraction
  // ==========================================================================

  /**
   * Extract dates from a document image using OCR
   */
  ipcMain.handle(
    'dateEngine:extractFromDocument',
    async (
      _,
      input: {
        imagePath: string;
        locid?: string | null;
        subid?: string | null;
        language?: string;
      }
    ) => {
      const { getOcrService } = await import('../../services/ocr-service');
      const ocrService = getOcrService();

      // Extract text from image using OCR
      const ocrResult = await ocrService.extractText(input.imagePath, {
        language: input.language || 'eng',
        minConfidence: 30,
      });

      if (!ocrResult.text || ocrResult.wordCount === 0) {
        return {
          success: false,
          error: 'No text extracted from image',
          ocrConfidence: ocrResult.confidence,
        };
      }

      // Extract dates from OCR text
      const sourceId = `ocr:${Date.now()}:${input.imagePath.split('/').pop()}`;
      const extractions = await processor.processText(
        ocrResult.text,
        'document',
        sourceId,
        input.locid ?? null,
        input.subid ?? null,
        null // No article date for documents
      );

      return {
        success: true,
        ocrText: ocrResult.text,
        ocrConfidence: ocrResult.confidence,
        ocrWordCount: ocrResult.wordCount,
        ocrProcessingTimeMs: ocrResult.processingTimeMs,
        extractionsFound: extractions.length,
        extractions,
      };
    }
  );

  console.log('Date Engine IPC handlers registered');
}

/**
 * Get the processor instance (for use by other handlers)
 */
export function getDateExtractionProcessor(): DateExtractionProcessor | null {
  return processor;
}

/**
 * Get the repository instance (for use by other handlers)
 */
export function getDateExtractionRepository(): SqliteDateExtractionRepository | null {
  return repository;
}
