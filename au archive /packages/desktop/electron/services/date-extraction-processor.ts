/**
 * Date Extraction Processor Service
 * Orchestrates date extraction, duplicate detection, and conflict detection
 */

import type { Kysely } from 'kysely';
import type { Database } from '../main/database.types';
import { SqliteDateExtractionRepository } from '../repositories/sqlite-date-extraction-repository';
import { SqliteTimelineRepository } from '../repositories/sqlite-timeline-repository';
import {
  extractDates,
  shouldAutoApprove,
  getAutoApproveReason,
} from './date-engine-service';
import type {
  DateExtraction,
  ExtractionResult,
  ExtractionSourceType,
  DateCategory,
  BackfillOptions,
  BackfillProgress,
  TimelineEvent,
  TimelineEventInput,
} from '@au-archive/core';

/**
 * Map date extraction category to timeline event subtype
 */
function categoryToEventSubtype(category: DateCategory): string | null {
  const mapping: Record<DateCategory, string | null> = {
    build_date: 'built',
    opening: 'opened',
    closure: 'closed',
    demolition: 'demolished',
    site_visit: null, // Not an established event
    obituary: null,
    publication: null,
    unknown: null,
  };
  return mapping[category];
}

/**
 * Date Extraction Processor
 * Handles the full extraction pipeline from text to stored extractions
 */
export class DateExtractionProcessor {
  private extractionRepo: SqliteDateExtractionRepository;
  private timelineRepo: SqliteTimelineRepository;

  constructor(private readonly db: Kysely<Database>) {
    this.extractionRepo = new SqliteDateExtractionRepository(db);
    this.timelineRepo = new SqliteTimelineRepository(db);
  }

  // ==========================================================================
  // Main Extraction Pipeline
  // ==========================================================================

  /**
   * Process text and extract dates
   * Full pipeline: extract → deduplicate → detect conflicts → store
   */
  async processText(
    text: string,
    sourceType: ExtractionSourceType,
    sourceId: string,
    locid: string | null,
    subid: string | null = null,
    articleDate: string | null = null
  ): Promise<DateExtraction[]> {
    // Step 1: Extract dates using NLP
    const results = extractDates(text, articleDate);

    if (results.length === 0) {
      return [];
    }

    const extractions: DateExtraction[] = [];

    // Step 2: Process each result
    for (const result of results) {
      try {
        // Create extraction record
        const extraction = await this.extractionRepo.create(
          result,
          sourceType,
          sourceId,
          locid,
          subid,
          articleDate
        );

        // Step 3: Check for duplicates
        if (locid && result.date_start) {
          const duplicates = await this.extractionRepo.findDuplicates(
            locid,
            result.date_start,
            result.category
          );

          // If there are existing extractions with same date/category
          const otherPrimaries = duplicates.filter(
            d => d.extraction_id !== extraction.extraction_id
          );

          if (otherPrimaries.length > 0) {
            // Compare confidence - highest becomes/stays primary
            const highestConfidence = Math.max(
              extraction.overall_confidence,
              ...otherPrimaries.map(d => d.overall_confidence)
            );

            if (extraction.overall_confidence < highestConfidence) {
              // This extraction should be marked as duplicate
              const primary = otherPrimaries.find(
                d => d.overall_confidence === highestConfidence
              );
              if (primary) {
                await this.extractionRepo.markAsDuplicate(
                  extraction.extraction_id,
                  primary.extraction_id
                );
              }
            } else {
              // This extraction is the new primary - mark others as duplicates
              for (const other of otherPrimaries) {
                await this.extractionRepo.markAsDuplicate(
                  other.extraction_id,
                  extraction.extraction_id
                );
              }
            }
          }
        }

        // Step 4: Check for timeline conflicts
        if (locid) {
          await this.detectConflicts(extraction);
        }

        // Refresh extraction after updates
        const updated = await this.extractionRepo.findById(extraction.extraction_id);
        if (updated) {
          extractions.push(updated);
        }
      } catch (error) {
        console.error(`[DateExtractionProcessor] Error processing extraction:`, error);
        // Continue with other results
      }
    }

    return extractions;
  }

  /**
   * Detect conflicts with existing timeline events
   */
  private async detectConflicts(extraction: DateExtraction): Promise<void> {
    if (!extraction.locid) return;

    // Only check for established-type categories
    const eventSubtype = categoryToEventSubtype(extraction.category as DateCategory);
    if (!eventSubtype) return;

    // Look for existing established event with same subtype
    const existingEvents = await this.db
      .selectFrom('location_timeline')
      .selectAll()
      .where('locid', '=', extraction.locid)
      .where('event_type', '=', 'established')
      .where('event_subtype', '=', eventSubtype)
      .execute();

    for (const event of existingEvents) {
      // Check for date mismatch
      if (event.date_start && extraction.date_start) {
        if (event.date_start !== extraction.date_start) {
          await this.extractionRepo.setConflict(
            extraction.extraction_id,
            event.event_id,
            'date_mismatch'
          );
          return;
        }

        // Exact duplicate - same date and subtype
        await this.extractionRepo.setConflict(
          extraction.extraction_id,
          event.event_id,
          'duplicate'
        );
        return;
      }
    }
  }

  // ==========================================================================
  // Conversion to Timeline
  // ==========================================================================

  /**
   * Convert an approved extraction to a timeline event
   */
  async convertToTimeline(extractionId: string, userId?: string): Promise<TimelineEvent | null> {
    const extraction = await this.extractionRepo.findById(extractionId);
    if (!extraction) {
      throw new Error(`Extraction ${extractionId} not found`);
    }

    if (!extraction.locid) {
      throw new Error('Cannot convert extraction without locid');
    }

    // Check if already converted
    if (extraction.status === 'converted') {
      throw new Error('Extraction already converted to timeline');
    }

    // Map category to event type
    const eventSubtype = categoryToEventSubtype(extraction.category as DateCategory);

    // Determine event type
    let eventType: 'established' | 'visit' | 'custom';
    if (eventSubtype) {
      eventType = 'established';
    } else if (extraction.category === 'site_visit') {
      eventType = 'visit';
    } else {
      eventType = 'custom';
    }

    // Create timeline event
    const eventInput: TimelineEventInput = {
      locid: extraction.locid,
      subid: extraction.subid,
      event_type: eventType,
      event_subtype: eventSubtype,
      date_start: extraction.date_start,
      date_end: extraction.date_end,
      date_precision: extraction.date_precision as any,
      date_display: extraction.date_display,
      date_edtf: extraction.date_edtf,
      date_sort: extraction.date_sort,
      source_type: 'web',
      source_ref: extraction.source_id,
      auto_approved: extraction.status === 'auto_approved' ? 1 : 0,
      notes: `Extracted from: "${extraction.sentence.substring(0, 100)}${extraction.sentence.length > 100 ? '...' : ''}"`,
    };

    const event = await this.timelineRepo.create(eventInput, userId);

    // Mark extraction as converted
    await this.extractionRepo.markConverted(extractionId, event.event_id);

    return event;
  }

  /**
   * Revert a converted extraction (delete timeline event)
   */
  async revert(extractionId: string, userId: string): Promise<DateExtraction | null> {
    const extraction = await this.extractionRepo.findById(extractionId);
    if (!extraction) {
      throw new Error(`Extraction ${extractionId} not found`);
    }

    if (extraction.status !== 'converted') {
      throw new Error('Extraction is not converted');
    }

    if (!extraction.timeline_event_id) {
      throw new Error('No timeline event linked');
    }

    // Delete the timeline event
    await this.timelineRepo.delete(extraction.timeline_event_id);

    // Mark extraction as reverted
    return this.extractionRepo.markReverted(extractionId, userId);
  }

  /**
   * Approve extraction and resolve conflict by updating timeline event
   */
  async approveAndResolveConflict(
    extractionId: string,
    userId: string,
    updateTimeline: boolean = false
  ): Promise<{ extraction: DateExtraction; event?: TimelineEvent }> {
    const extraction = await this.extractionRepo.findById(extractionId);
    if (!extraction) {
      throw new Error(`Extraction ${extractionId} not found`);
    }

    if (!extraction.conflict_event_id) {
      throw new Error('No conflict to resolve');
    }

    // Approve the extraction
    await this.extractionRepo.approve(extractionId, userId);

    let event: TimelineEvent | undefined;

    if (updateTimeline) {
      // Update the existing timeline event with the new date
      const updated = await this.timelineRepo.update(
        extraction.conflict_event_id,
        {
          date_start: extraction.date_start,
          date_end: extraction.date_end,
          date_precision: extraction.date_precision as any,
          date_display: extraction.date_display,
          date_edtf: extraction.date_edtf,
          date_sort: extraction.date_sort,
        },
        userId
      );

      event = updated ?? undefined;

      // Mark as converted with the existing event
      await this.extractionRepo.markConverted(extractionId, extraction.conflict_event_id);
    }

    // Mark conflict as resolved
    await this.extractionRepo.resolveConflict(extractionId);

    const updatedExtraction = await this.extractionRepo.findById(extractionId);

    return {
      extraction: updatedExtraction!,
      event,
    };
  }

  // ==========================================================================
  // ML Learning Integration
  // ==========================================================================

  /**
   * Record approval and update ML weights
   * OPT-120: Auto-create timeline events for historical date categories
   */
  async approveWithLearning(extractionId: string, userId: string): Promise<DateExtraction | null> {
    const extraction = await this.extractionRepo.findById(extractionId);
    if (!extraction) return null;

    // Record approval for ML
    const keywords = extraction.category_keywords
      ? JSON.parse(extraction.category_keywords)
      : [];

    await this.extractionRepo.recordApproval(
      extraction.category as DateCategory,
      keywords
    );

    // Approve the extraction
    const approved = await this.extractionRepo.approve(extractionId, userId);

    // OPT-120: Auto-create timeline event for historical categories
    // These categories represent important historical facts that should be on the timeline
    const historicalCategories = ['build_date', 'opening', 'closure', 'demolition', 'renovation'];
    if (approved && extraction.locid && historicalCategories.includes(extraction.category || '')) {
      try {
        await this.convertToTimeline(extractionId, userId);
        console.log(`[DateEngine] Auto-created timeline event for ${extraction.category}: ${extractionId}`);
      } catch (timelineError) {
        // Don't fail approval if timeline creation fails
        console.error(`[DateEngine] Failed to create timeline event for ${extractionId}:`, timelineError);
      }
    }

    return approved;
  }

  /**
   * Record rejection and update ML weights
   */
  async rejectWithLearning(
    extractionId: string,
    userId: string,
    reason?: string
  ): Promise<DateExtraction | null> {
    const extraction = await this.extractionRepo.findById(extractionId);
    if (!extraction) return null;

    // Record rejection for ML
    const keywords = extraction.category_keywords
      ? JSON.parse(extraction.category_keywords)
      : [];

    await this.extractionRepo.recordRejection(
      extraction.category as DateCategory,
      keywords
    );

    // Reject the extraction
    return this.extractionRepo.reject(extractionId, userId, reason);
  }

  // ==========================================================================
  // Backfill Operations
  // ==========================================================================

  /**
   * Backfill date extractions from existing web sources
   */
  async *backfillWebSources(
    options: BackfillOptions = {}
  ): AsyncGenerator<BackfillProgress> {
    const batchSize = options.batch_size ?? 50;
    const batchDelay = options.batch_delay_ms ?? 100;
    const skipProcessed = options.skip_processed ?? true;

    // Build query for web sources with text
    let query = this.db
      .selectFrom('web_sources')
      .select(['source_id', 'extracted_text', 'locid', 'subid', 'extracted_date', 'dates_extracted_at'])
      .where('extracted_text', 'is not', null)
      .where('extracted_text', '!=', '');

    if (skipProcessed) {
      query = query.where('dates_extracted_at', 'is', null);
    }

    if (options.locid) {
      query = query.where('locid', '=', options.locid);
    }

    // Get total count
    const countResult = await this.db
      .selectFrom('web_sources')
      .select(({ fn }) => fn.count('source_id').as('count'))
      .where('extracted_text', 'is not', null)
      .where('extracted_text', '!=', '')
      .where(skipProcessed ? eb => eb('dates_extracted_at', 'is', null) : eb => eb.val(1).eq(1))
      .executeTakeFirst();

    const total = Number(countResult?.count ?? 0);

    let processed = 0;
    let extractionsFound = 0;
    let errors = 0;
    let offset = 0;

    while (true) {
      const sources = await query.limit(batchSize).offset(offset).execute();

      if (sources.length === 0) break;

      for (const source of sources) {
        try {
          if (!source.extracted_text) continue;

          const extractions = await this.processText(
            source.extracted_text,
            'web_source',
            source.source_id,
            source.locid,
            source.subid,
            source.extracted_date
          );

          extractionsFound += extractions.length;

          // Update web source tracking
          await this.db
            .updateTable('web_sources')
            .set({
              dates_extracted_at: new Date().toISOString(),
              dates_extraction_count: extractions.length,
            })
            .where('source_id', '=', source.source_id)
            .execute();

          processed++;

          yield {
            processed,
            total,
            current_source_id: source.source_id,
            extractions_found: extractionsFound,
            errors,
          };
        } catch (error) {
          console.error(`[Backfill] Error processing source ${source.source_id}:`, error);
          errors++;
          processed++;

          yield {
            processed,
            total,
            current_source_id: source.source_id,
            extractions_found: extractionsFound,
            errors,
          };
        }
      }

      offset += batchSize;

      // Delay between batches
      if (batchDelay > 0 && sources.length === batchSize) {
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
    }

    // Final progress
    yield {
      processed,
      total,
      current_source_id: null,
      extractions_found: extractionsFound,
      errors,
    };
  }

  /**
   * Backfill date extractions from image captions
   */
  async *backfillImageCaptions(
    options: BackfillOptions = {}
  ): AsyncGenerator<BackfillProgress> {
    const batchSize = options.batch_size ?? 50;
    const batchDelay = options.batch_delay_ms ?? 100;

    // Get image captions with text
    const query = this.db
      .selectFrom('web_source_images')
      .select(['id', 'source_id', 'alt', 'caption', 'credit'])
      .where(eb => eb.or([
        eb('alt', 'is not', null),
        eb('caption', 'is not', null),
        eb('credit', 'is not', null),
      ]));

    // Get total count
    const countResult = await this.db
      .selectFrom('web_source_images')
      .select(({ fn }) => fn.count('id').as('count'))
      .where(eb => eb.or([
        eb('alt', 'is not', null),
        eb('caption', 'is not', null),
        eb('credit', 'is not', null),
      ]))
      .executeTakeFirst();

    const total = Number(countResult?.count ?? 0);

    let processed = 0;
    let extractionsFound = 0;
    let errors = 0;
    let offset = 0;

    while (true) {
      const images = await query.limit(batchSize).offset(offset).execute();

      if (images.length === 0) break;

      for (const image of images) {
        try {
          // Combine text fields
          const textParts: string[] = [];
          if (image.alt) textParts.push(image.alt);
          if (image.caption) textParts.push(image.caption);
          if (image.credit) textParts.push(image.credit);

          const text = textParts.join(' ');
          if (!text.trim()) continue;

          // Check if already processed
          const alreadyProcessed = await this.extractionRepo.isSourceProcessed(
            'image_caption',
            `${image.source_id}:${image.id}`
          );

          if (alreadyProcessed) {
            processed++;
            continue;
          }

          // Get the web source to get locid
          const webSource = await this.db
            .selectFrom('web_sources')
            .select(['locid', 'subid', 'extracted_date'])
            .where('source_id', '=', image.source_id)
            .executeTakeFirst();

          if (!webSource) {
            processed++;
            continue;
          }

          const extractions = await this.processText(
            text,
            'image_caption',
            `${image.source_id}:${image.id}`,
            webSource.locid,
            webSource.subid,
            webSource.extracted_date
          );

          extractionsFound += extractions.length;
          processed++;

          yield {
            processed,
            total,
            current_source_id: `${image.source_id}:${image.id}`,
            extractions_found: extractionsFound,
            errors,
          };
        } catch (error) {
          console.error(`[Backfill] Error processing image ${image.id}:`, error);
          errors++;
          processed++;

          yield {
            processed,
            total,
            current_source_id: `${image.source_id}:${image.id}`,
            extractions_found: extractionsFound,
            errors,
          };
        }
      }

      offset += batchSize;

      // Delay between batches
      if (batchDelay > 0 && images.length === batchSize) {
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
    }

    // Final progress
    yield {
      processed,
      total,
      current_source_id: null,
      extractions_found: extractionsFound,
      errors,
    };
  }

  // ==========================================================================
  // CSV Export/Import
  // ==========================================================================

  /**
   * Export pending extractions to CSV format
   */
  async exportPending(): Promise<string> {
    const extractions = await this.extractionRepo.getPendingReview(10000);

    const headers = [
      'extraction_id',
      'raw_text',
      'sentence',
      'category',
      'confidence',
      'date_start',
      'date_display',
      'source_type',
      'source_id',
      'locid',
      'decision', // For user to fill in: approve/reject
      'rejection_reason', // Optional reason
    ];

    const rows = extractions.map(e => [
      e.extraction_id,
      `"${e.raw_text.replace(/"/g, '""')}"`,
      `"${e.sentence.substring(0, 200).replace(/"/g, '""')}"`,
      e.category,
      e.overall_confidence.toFixed(2),
      e.date_start ?? '',
      e.date_display ?? '',
      e.source_type,
      e.source_id,
      e.locid ?? '',
      '', // decision
      '', // rejection_reason
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  /**
   * Import reviewed CSV and apply decisions
   */
  async importReviewed(
    csvContent: string,
    userId: string
  ): Promise<{ approved: number; rejected: number; errors: number }> {
    const lines = csvContent.split('\n');
    if (lines.length < 2) {
      throw new Error('CSV must have header row and at least one data row');
    }

    // Skip header
    const dataLines = lines.slice(1);

    let approved = 0;
    let rejected = 0;
    let errors = 0;

    for (const line of dataLines) {
      if (!line.trim()) continue;

      try {
        // Parse CSV line (simple parser, handles quoted strings)
        const values = this.parseCSVLine(line);

        const extractionId = values[0];
        const decision = values[10]?.toLowerCase().trim();
        const rejectionReason = values[11]?.trim();

        if (!extractionId || !decision) continue;

        if (decision === 'approve' || decision === 'a') {
          await this.approveWithLearning(extractionId, userId);
          approved++;
        } else if (decision === 'reject' || decision === 'r') {
          await this.rejectWithLearning(extractionId, userId, rejectionReason);
          rejected++;
        }
      } catch (error) {
        console.error(`[ImportReviewed] Error processing line:`, error);
        errors++;
      }
    }

    return { approved, rejected, errors };
  }

  /**
   * Simple CSV line parser
   */
  private parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    values.push(current);
    return values;
  }
}

/**
 * Factory function to create processor instance
 */
export function createDateExtractionProcessor(db: Kysely<Database>): DateExtractionProcessor {
  return new DateExtractionProcessor(db);
}
