/**
 * SQLite Date Extraction Repository
 * Handles CRUD operations for date extractions, patterns, and ML learning
 */

import { Kysely, sql } from 'kysely';
import { generateId } from '../main/ipc-validation';
import type { Database, DateExtractionsTable, DateEngineLearningTable, DatePatternsTable } from '../main/database.types';
import type {
  DateExtraction,
  DateExtractionFilters,
  DateCategory,
  ExtractionStatus,
  DatePattern,
  DatePatternInput,
  DateEngineLearning,
  DateEngineStats,
  ExtractionResult,
  ExtractionSourceType,
} from '@au-archive/core';

/**
 * Repository for managing date extractions
 */
export class SqliteDateExtractionRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // ==========================================================================
  // Extractions - CRUD
  // ==========================================================================

  /**
   * Create a new date extraction from an extraction result
   */
  async create(
    result: ExtractionResult,
    sourceType: ExtractionSourceType,
    sourceId: string,
    locid: string | null,
    subid: string | null = null,
    articleDate: string | null = null
  ): Promise<DateExtraction> {
    const extractionId = generateId();
    const now = new Date().toISOString();

    // Determine auto-approval
    const { shouldAutoApprove, getAutoApproveReason } = await import('../services/date-engine-service');
    const isAutoApproved = shouldAutoApprove(result.category, result.overall_confidence);

    const extraction: DateExtractionsTable = {
      extraction_id: extractionId,
      source_type: sourceType,
      source_id: sourceId,
      locid,
      subid,
      raw_text: result.raw_text,
      parsed_date: result.parsed_date,
      date_start: result.date_start,
      date_end: result.date_end,
      date_precision: result.date_precision,
      date_display: result.date_display,
      date_edtf: result.date_edtf,
      date_sort: result.date_sort,
      sentence: result.sentence,
      sentence_position: result.sentence_position,
      category: result.category,
      category_confidence: result.category_confidence,
      category_keywords: JSON.stringify(result.category_keywords),
      keyword_distance: result.keyword_distance,
      sentence_position_type: result.sentence_position_type,
      source_age_days: null,
      overall_confidence: result.overall_confidence,
      article_date: articleDate,
      relative_date_anchor: result.relative_date_anchor,
      was_relative_date: result.was_relative_date ? 1 : 0,
      parser_name: 'chrono',
      parser_confidence: result.parser_confidence,
      century_bias_applied: result.century_bias_applied ? 1 : 0,
      original_year_ambiguous: result.original_year_ambiguous ? 1 : 0,
      is_primary: 1,
      merged_from_ids: null,
      duplicate_of_id: null,
      conflict_event_id: null,
      conflict_type: null,
      conflict_resolved: 0,
      status: isAutoApproved ? 'auto_approved' : 'pending',
      auto_approve_reason: isAutoApproved ? getAutoApproveReason(result.category, result.overall_confidence) : null,
      reviewed_at: null,
      reviewed_by: null,
      rejection_reason: null,
      timeline_event_id: null,
      converted_at: null,
      reverted_at: null,
      reverted_by: null,
      created_at: now,
      updated_at: null,
    };

    await this.db.insertInto('date_extractions').values(extraction).execute();

    return extraction as unknown as DateExtraction;
  }

  /**
   * Find a single extraction by ID
   */
  async findById(extractionId: string): Promise<DateExtraction | undefined> {
    const result = await this.db
      .selectFrom('date_extractions')
      .selectAll()
      .where('extraction_id', '=', extractionId)
      .executeTakeFirst();

    return result as DateExtraction | undefined;
  }

  /**
   * Find extractions with optional filters
   */
  async find(filters: DateExtractionFilters = {}): Promise<DateExtraction[]> {
    let query = this.db.selectFrom('date_extractions').selectAll();

    if (filters.locid) {
      query = query.where('locid', '=', filters.locid);
    }

    if (filters.subid) {
      query = query.where('subid', '=', filters.subid);
    }

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        query = query.where('status', 'in', filters.status);
      } else {
        query = query.where('status', '=', filters.status);
      }
    }

    if (filters.category) {
      if (Array.isArray(filters.category)) {
        query = query.where('category', 'in', filters.category);
      } else {
        query = query.where('category', '=', filters.category);
      }
    }

    if (filters.has_conflict !== undefined) {
      if (filters.has_conflict) {
        query = query.where('conflict_event_id', 'is not', null);
      } else {
        query = query.where('conflict_event_id', 'is', null);
      }
    }

    if (filters.min_confidence !== undefined) {
      query = query.where('overall_confidence', '>=', filters.min_confidence);
    }

    if (filters.max_confidence !== undefined) {
      query = query.where('overall_confidence', '<=', filters.max_confidence);
    }

    if (filters.is_primary !== undefined) {
      query = query.where('is_primary', '=', filters.is_primary ? 1 : 0);
    }

    query = query.orderBy('created_at', 'desc');

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    if (filters.offset) {
      query = query.offset(filters.offset);
    }

    const results = await query.execute();
    return results as DateExtraction[];
  }

  /**
   * Get pending extractions for review (global queue)
   */
  async getPendingReview(limit = 100, offset = 0): Promise<DateExtraction[]> {
    return this.find({
      status: 'pending',
      is_primary: true,
      limit,
      offset,
    });
  }

  /**
   * Get pending extractions for a specific location
   */
  async getPendingByLocation(locid: string): Promise<DateExtraction[]> {
    return this.find({
      locid,
      status: 'pending',
      is_primary: true,
    });
  }

  /**
   * Get extractions with timeline conflicts
   */
  async getConflicts(): Promise<DateExtraction[]> {
    return this.find({
      has_conflict: true,
    });
  }

  /**
   * Approve an extraction
   */
  async approve(extractionId: string, userId: string): Promise<DateExtraction | undefined> {
    const now = new Date().toISOString();

    await this.db
      .updateTable('date_extractions')
      .set({
        status: 'user_approved',
        reviewed_at: now,
        reviewed_by: userId,
        updated_at: now,
      })
      .where('extraction_id', '=', extractionId)
      .execute();

    return this.findById(extractionId);
  }

  /**
   * Reject an extraction
   */
  async reject(extractionId: string, userId: string, reason?: string): Promise<DateExtraction | undefined> {
    const now = new Date().toISOString();

    await this.db
      .updateTable('date_extractions')
      .set({
        status: 'rejected',
        reviewed_at: now,
        reviewed_by: userId,
        rejection_reason: reason ?? null,
        updated_at: now,
      })
      .where('extraction_id', '=', extractionId)
      .execute();

    return this.findById(extractionId);
  }

  /**
   * Mark extraction as converted to timeline event
   */
  async markConverted(extractionId: string, timelineEventId: string): Promise<DateExtraction | undefined> {
    const now = new Date().toISOString();

    await this.db
      .updateTable('date_extractions')
      .set({
        status: 'converted',
        timeline_event_id: timelineEventId,
        converted_at: now,
        updated_at: now,
      })
      .where('extraction_id', '=', extractionId)
      .execute();

    return this.findById(extractionId);
  }

  /**
   * Revert a converted extraction (delete timeline event)
   */
  async markReverted(extractionId: string, userId: string): Promise<DateExtraction | undefined> {
    const now = new Date().toISOString();

    await this.db
      .updateTable('date_extractions')
      .set({
        status: 'reverted',
        reverted_at: now,
        reverted_by: userId,
        updated_at: now,
      })
      .where('extraction_id', '=', extractionId)
      .execute();

    return this.findById(extractionId);
  }

  /**
   * Delete an extraction
   */
  async delete(extractionId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('date_extractions')
      .where('extraction_id', '=', extractionId)
      .execute();

    return result.length > 0 && Number(result[0].numDeletedRows) > 0;
  }

  // ==========================================================================
  // Duplicate Detection
  // ==========================================================================

  /**
   * Find potential duplicates for a date extraction
   * Duplicates are same (locid, date_start, category)
   */
  async findDuplicates(
    locid: string,
    dateStart: string | null,
    category: DateCategory
  ): Promise<DateExtraction[]> {
    if (!dateStart) return [];

    const results = await this.db
      .selectFrom('date_extractions')
      .selectAll()
      .where('locid', '=', locid)
      .where('date_start', '=', dateStart)
      .where('category', '=', category)
      .where('is_primary', '=', 1)
      .execute();

    return results as DateExtraction[];
  }

  /**
   * Mark an extraction as duplicate of another
   */
  async markAsDuplicate(extractionId: string, primaryId: string): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .updateTable('date_extractions')
      .set({
        is_primary: 0,
        duplicate_of_id: primaryId,
        updated_at: now,
      })
      .where('extraction_id', '=', extractionId)
      .execute();

    // Update merged_from_ids on primary
    const primary = await this.findById(primaryId);
    if (primary) {
      const mergedIds: string[] = primary.merged_from_ids
        ? JSON.parse(primary.merged_from_ids)
        : [];
      if (!mergedIds.includes(extractionId)) {
        mergedIds.push(extractionId);
        await this.db
          .updateTable('date_extractions')
          .set({
            merged_from_ids: JSON.stringify(mergedIds),
            updated_at: now,
          })
          .where('extraction_id', '=', primaryId)
          .execute();
      }
    }
  }

  // ==========================================================================
  // Conflict Detection
  // ==========================================================================

  /**
   * Set conflict on an extraction
   */
  async setConflict(
    extractionId: string,
    conflictEventId: string,
    conflictType: 'date_mismatch' | 'category_mismatch' | 'duplicate'
  ): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .updateTable('date_extractions')
      .set({
        conflict_event_id: conflictEventId,
        conflict_type: conflictType,
        updated_at: now,
      })
      .where('extraction_id', '=', extractionId)
      .execute();
  }

  /**
   * Mark conflict as resolved
   */
  async resolveConflict(extractionId: string): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .updateTable('date_extractions')
      .set({
        conflict_resolved: 1,
        updated_at: now,
      })
      .where('extraction_id', '=', extractionId)
      .execute();
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get date engine statistics
   */
  async getStats(): Promise<DateEngineStats> {
    // Total count
    const totalResult = await this.db
      .selectFrom('date_extractions')
      .select(({ fn }) => fn.count('extraction_id').as('count'))
      .executeTakeFirst();
    const total = Number(totalResult?.count ?? 0);

    // Count by status
    const statusCounts = await this.db
      .selectFrom('date_extractions')
      .select(['status', ({ fn }) => fn.count('extraction_id').as('count')])
      .groupBy('status')
      .execute();

    const byStatus: Record<ExtractionStatus, number> = {
      pending: 0,
      auto_approved: 0,
      user_approved: 0,
      rejected: 0,
      converted: 0,
      reverted: 0,
    };

    for (const row of statusCounts) {
      byStatus[row.status as ExtractionStatus] = Number(row.count);
    }

    // Count by category
    const categoryCounts = await this.db
      .selectFrom('date_extractions')
      .select(['category', ({ fn }) => fn.count('extraction_id').as('count')])
      .groupBy('category')
      .execute();

    const byCategory: Record<DateCategory, number> = {
      build_date: 0,
      site_visit: 0,
      obituary: 0,
      publication: 0,
      closure: 0,
      opening: 0,
      demolition: 0,
      unknown: 0,
    };

    for (const row of categoryCounts) {
      byCategory[row.category as DateCategory] = Number(row.count);
    }

    // Conflicts count
    const conflictsResult = await this.db
      .selectFrom('date_extractions')
      .select(({ fn }) => fn.count('extraction_id').as('count'))
      .where('conflict_event_id', 'is not', null)
      .where('conflict_resolved', '=', 0)
      .executeTakeFirst();
    const conflicts = Number(conflictsResult?.count ?? 0);

    // Duplicates count
    const duplicatesResult = await this.db
      .selectFrom('date_extractions')
      .select(({ fn }) => fn.count('extraction_id').as('count'))
      .where('is_primary', '=', 0)
      .executeTakeFirst();
    const duplicates = Number(duplicatesResult?.count ?? 0);

    // Average confidence
    const avgResult = await this.db
      .selectFrom('date_extractions')
      .select(({ fn }) => fn.avg('overall_confidence').as('avg'))
      .executeTakeFirst();
    const avgConfidence = Number(avgResult?.avg ?? 0);

    return {
      total_extractions: total,
      pending_count: byStatus.pending,
      approved_count: byStatus.auto_approved + byStatus.user_approved,
      rejected_count: byStatus.rejected,
      converted_count: byStatus.converted,
      by_category: byCategory,
      by_status: byStatus,
      conflicts_count: conflicts,
      duplicates_count: duplicates,
      avg_confidence: Math.round(avgConfidence * 100) / 100,
    };
  }

  // ==========================================================================
  // ML Learning
  // ==========================================================================

  /**
   * Record an approval for ML learning
   */
  async recordApproval(category: DateCategory, keywords: string[]): Promise<void> {
    const now = new Date().toISOString();

    for (const keyword of keywords) {
      await this.db
        .insertInto('date_engine_learning')
        .values({
          category,
          keyword,
          approval_count: 1,
          rejection_count: 0,
          weight_modifier: 1.0,
          last_updated: now,
        })
        .onConflict(oc =>
          oc.columns(['category', 'keyword']).doUpdateSet({
            approval_count: sql`approval_count + 1`,
            weight_modifier: sql`CASE
              WHEN rejection_count > 0
              THEN (approval_count + 1.0) / (approval_count + rejection_count + 1.0)
              ELSE 1.0
            END`,
            last_updated: now,
          })
        )
        .execute();
    }
  }

  /**
   * Record a rejection for ML learning
   */
  async recordRejection(category: DateCategory, keywords: string[]): Promise<void> {
    const now = new Date().toISOString();

    for (const keyword of keywords) {
      await this.db
        .insertInto('date_engine_learning')
        .values({
          category,
          keyword,
          approval_count: 0,
          rejection_count: 1,
          weight_modifier: 0.5,
          last_updated: now,
        })
        .onConflict(oc =>
          oc.columns(['category', 'keyword']).doUpdateSet({
            rejection_count: sql`rejection_count + 1`,
            weight_modifier: sql`CASE
              WHEN approval_count > 0
              THEN approval_count * 1.0 / (approval_count + rejection_count + 1.0)
              ELSE 0.5
            END`,
            last_updated: now,
          })
        )
        .execute();
    }
  }

  /**
   * Get weight modifier for a category/keyword pair
   */
  async getWeightModifier(category: DateCategory, keyword: string): Promise<number> {
    const result = await this.db
      .selectFrom('date_engine_learning')
      .select('weight_modifier')
      .where('category', '=', category)
      .where('keyword', '=', keyword)
      .executeTakeFirst();

    return result?.weight_modifier ?? 1.0;
  }

  /**
   * Get all learning stats
   */
  async getLearningStats(): Promise<DateEngineLearning[]> {
    const results = await this.db
      .selectFrom('date_engine_learning')
      .selectAll()
      .orderBy('category')
      .orderBy('approval_count', 'desc')
      .execute();

    return results as unknown as DateEngineLearning[];
  }

  // ==========================================================================
  // Custom Patterns
  // ==========================================================================

  /**
   * Create a new custom pattern
   */
  async createPattern(input: DatePatternInput): Promise<DatePattern> {
    const patternId = generateId();
    const now = new Date().toISOString();

    const pattern: DatePatternsTable = {
      pattern_id: patternId,
      name: input.name,
      regex: input.regex,
      category: input.category ?? null,
      priority: input.priority ?? 0,
      enabled: input.enabled ?? 1,
      test_cases: input.test_cases ?? null,
      created_at: now,
    };

    await this.db.insertInto('date_patterns').values(pattern).execute();

    return pattern as DatePattern;
  }

  /**
   * Get all patterns
   */
  async getPatterns(enabledOnly = true): Promise<DatePattern[]> {
    let query = this.db
      .selectFrom('date_patterns')
      .selectAll()
      .orderBy('priority', 'desc')
      .orderBy('created_at', 'desc');

    if (enabledOnly) {
      query = query.where('enabled', '=', 1);
    }

    const results = await query.execute();
    return results as DatePattern[];
  }

  /**
   * Get a pattern by ID
   */
  async getPattern(patternId: string): Promise<DatePattern | undefined> {
    const result = await this.db
      .selectFrom('date_patterns')
      .selectAll()
      .where('pattern_id', '=', patternId)
      .executeTakeFirst();

    return result as DatePattern | undefined;
  }

  /**
   * Update a pattern
   */
  async updatePattern(patternId: string, input: Partial<DatePatternInput>): Promise<DatePattern | undefined> {
    const updateObj: Partial<DatePatternsTable> = {};

    if (input.name !== undefined) updateObj.name = input.name;
    if (input.regex !== undefined) updateObj.regex = input.regex;
    if (input.category !== undefined) updateObj.category = input.category;
    if (input.priority !== undefined) updateObj.priority = input.priority;
    if (input.enabled !== undefined) updateObj.enabled = input.enabled;
    if (input.test_cases !== undefined) updateObj.test_cases = input.test_cases;

    if (Object.keys(updateObj).length > 0) {
      await this.db
        .updateTable('date_patterns')
        .set(updateObj)
        .where('pattern_id', '=', patternId)
        .execute();
    }

    return this.getPattern(patternId);
  }

  /**
   * Delete a pattern
   */
  async deletePattern(patternId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('date_patterns')
      .where('pattern_id', '=', patternId)
      .execute();

    return result.length > 0 && Number(result[0].numDeletedRows) > 0;
  }

  // ==========================================================================
  // Source Tracking
  // ==========================================================================

  /**
   * Check if a source has already been processed
   */
  async isSourceProcessed(sourceType: ExtractionSourceType, sourceId: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('date_extractions')
      .select(({ fn }) => fn.count('extraction_id').as('count'))
      .where('source_type', '=', sourceType)
      .where('source_id', '=', sourceId)
      .executeTakeFirst();

    return Number(result?.count ?? 0) > 0;
  }

  /**
   * Get extractions for a specific source
   */
  async getBySource(sourceType: ExtractionSourceType, sourceId: string): Promise<DateExtraction[]> {
    const results = await this.db
      .selectFrom('date_extractions')
      .selectAll()
      .where('source_type', '=', sourceType)
      .where('source_id', '=', sourceId)
      .orderBy('sentence_position', 'asc')
      .execute();

    return results as DateExtraction[];
  }
}
