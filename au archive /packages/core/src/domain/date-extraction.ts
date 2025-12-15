/**
 * Date Extraction Domain Types
 * NLP-based date extraction for archival research
 * Uses chrono-node with historical bias for urbex context
 */

import { z } from 'zod';
import type { DatePrecision } from './timeline';
import { DatePrecisionSchema } from './timeline';

// =============================================================================
// Date Categories
// =============================================================================

/**
 * Categories for extracted dates based on context
 */
export const DateCategorySchema = z.enum([
  'build_date',   // Built, constructed, erected, established, founded, completed
  'site_visit',   // Visited, explored, trip, photographed, toured
  'obituary',     // Died, passed away, obituary, death, funeral, memorial
  'publication',  // Published, posted, article, written, reported, news
  'closure',      // Closed, shut down, abandoned, ceased operations, shuttered
  'opening',      // Opened, inaugurated, grand opening, ribbon cutting, launch
  'demolition',   // Demolished, torn down, razed, destroyed, wrecking ball
  'unknown',      // No clear category detected
]);

export type DateCategory = z.infer<typeof DateCategorySchema>;

/**
 * Keywords for category detection (proximity-based)
 */
export const CATEGORY_KEYWORDS: Record<DateCategory, string[]> = {
  build_date: [
    'built', 'constructed', 'erected', 'established', 'founded', 'completed',
    'construction', 'building', 'built in', 'was built', 'constructed in',
  ],
  site_visit: [
    'visited', 'explored', 'trip', 'photographed', 'toured', 'expedition',
    'went to', 'stopped by', 'checked out', 'explored on', 'visit',
  ],
  obituary: [
    'died', 'passed away', 'obituary', 'death', 'funeral', 'memorial',
    'rip', 'passed on', 'in memory', 'deceased',
  ],
  publication: [
    'published', 'posted', 'article', 'written', 'reported', 'news',
    'updated', 'written on', 'posted on', 'last updated',
  ],
  closure: [
    'closed', 'shut down', 'abandoned', 'ceased operations', 'shuttered',
    'closing', 'closure', 'went out of business', 'shut its doors',
  ],
  opening: [
    'opened', 'inaugurated', 'grand opening', 'ribbon cutting', 'launch',
    'opening', 'first opened', 'doors opened', 'began operations',
  ],
  demolition: [
    'demolished', 'torn down', 'razed', 'destroyed', 'wrecking ball',
    'demolition', 'knocked down', 'bulldozed', 'leveled',
  ],
  unknown: [],
};

/**
 * Display labels for categories
 */
export const CATEGORY_LABELS: Record<DateCategory, string> = {
  build_date: 'Build Date',
  site_visit: 'Site Visit',
  obituary: 'Obituary',
  publication: 'Publication',
  closure: 'Closure',
  opening: 'Opening',
  demolition: 'Demolition',
  unknown: 'Unknown',
};

// =============================================================================
// Source Types
// =============================================================================

/**
 * Source types for date extractions
 */
export const ExtractionSourceTypeSchema = z.enum([
  'web_source',     // From archived web page text
  'image_caption',  // From web_source_images alt/caption/credit
  'document',       // From OCR'd document
  'manual',         // User-entered extraction
]);

export type ExtractionSourceType = z.infer<typeof ExtractionSourceTypeSchema>;

// =============================================================================
// Verification Status
// =============================================================================

/**
 * Verification status for extractions
 */
export const ExtractionStatusSchema = z.enum([
  'pending',        // Awaiting review
  'auto_approved',  // Automatically approved (high confidence)
  'user_approved',  // User approved the extraction
  'rejected',       // User rejected the extraction
  'converted',      // Converted to timeline event
  'reverted',       // Timeline event reverted/deleted
]);

export type ExtractionStatus = z.infer<typeof ExtractionStatusSchema>;

// =============================================================================
// Conflict Types
// =============================================================================

/**
 * Types of timeline conflicts
 */
export const ConflictTypeSchema = z.enum([
  'date_mismatch',    // Existing event has different date
  'category_mismatch', // Existing event has different category/subtype
  'duplicate',        // Extraction matches existing event exactly
]);

export type ConflictType = z.infer<typeof ConflictTypeSchema>;

// =============================================================================
// Sentence Position
// =============================================================================

/**
 * Where in the sentence the date was found
 */
export const SentencePositionTypeSchema = z.enum([
  'beginning', // First third of sentence (best)
  'middle',    // Middle third
  'end',       // Last third
]);

export type SentencePositionType = z.infer<typeof SentencePositionTypeSchema>;

// =============================================================================
// Date Extraction Schema
// =============================================================================

/**
 * Full date extraction record (matches database table)
 */
export const DateExtractionSchema = z.object({
  extraction_id: z.string(),

  // Source reference
  source_type: ExtractionSourceTypeSchema,
  source_id: z.string(),
  locid: z.string().nullable(),
  subid: z.string().nullable(),

  // Parsed date
  raw_text: z.string(),
  parsed_date: z.string().nullable(),
  date_start: z.string().nullable(),
  date_end: z.string().nullable(),
  date_precision: DatePrecisionSchema,
  date_display: z.string().nullable(),
  date_edtf: z.string().nullable(),
  date_sort: z.number().nullable(),

  // Context
  sentence: z.string(),
  sentence_position: z.number().nullable(),
  category: DateCategorySchema,
  category_confidence: z.number().default(0),
  category_keywords: z.string().nullable(), // JSON array

  // Rich confidence scoring
  keyword_distance: z.number().nullable(),
  sentence_position_type: SentencePositionTypeSchema.nullable(),
  source_age_days: z.number().nullable(),
  overall_confidence: z.number().default(0),

  // Article date context (for relative dates)
  article_date: z.string().nullable(),
  relative_date_anchor: z.string().nullable(),
  was_relative_date: z.number().default(0),

  // Parsing metadata
  parser_name: z.string().default('chrono'),
  parser_confidence: z.number().default(0),
  century_bias_applied: z.number().default(0),
  original_year_ambiguous: z.number().default(0),

  // Duplicate detection & merging
  is_primary: z.number().default(1),
  merged_from_ids: z.string().nullable(), // JSON array
  duplicate_of_id: z.string().nullable(),

  // Timeline conflict detection
  conflict_event_id: z.string().nullable(),
  conflict_type: ConflictTypeSchema.nullable(),
  conflict_resolved: z.number().default(0),

  // Verification
  status: ExtractionStatusSchema.default('pending'),
  auto_approve_reason: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  reviewed_by: z.string().nullable(),
  rejection_reason: z.string().nullable(),

  // Timeline linkage & undo
  timeline_event_id: z.string().nullable(),
  converted_at: z.string().nullable(),
  reverted_at: z.string().nullable(),
  reverted_by: z.string().nullable(),

  // Timestamps
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

export type DateExtraction = z.infer<typeof DateExtractionSchema>;

// =============================================================================
// Input Schemas
// =============================================================================

/**
 * Input for creating a date extraction
 */
export const DateExtractionInputSchema = z.object({
  source_type: ExtractionSourceTypeSchema,
  source_id: z.string(),
  locid: z.string().nullable().optional(),
  subid: z.string().nullable().optional(),
  raw_text: z.string(),
  sentence: z.string(),
  article_date: z.string().nullable().optional(),
});

export type DateExtractionInput = z.infer<typeof DateExtractionInputSchema>;

/**
 * Input for extracting dates from arbitrary text
 */
export const ExtractFromTextInputSchema = z.object({
  text: z.string(),
  locid: z.string().nullable().optional(),
  subid: z.string().nullable().optional(),
  source_type: ExtractionSourceTypeSchema.optional(),
  source_id: z.string().optional(),
  article_date: z.string().nullable().optional(),
});

export type ExtractFromTextInput = z.infer<typeof ExtractFromTextInputSchema>;

// =============================================================================
// ML Learning
// =============================================================================

/**
 * ML learning record for category/keyword weights
 */
export const DateEngineLearningSchema = z.object({
  id: z.number().optional(),
  category: DateCategorySchema,
  keyword: z.string(),
  approval_count: z.number().default(0),
  rejection_count: z.number().default(0),
  weight_modifier: z.number().default(1.0),
  last_updated: z.string().nullable(),
});

export type DateEngineLearning = z.infer<typeof DateEngineLearningSchema>;

// =============================================================================
// Custom Patterns
// =============================================================================

/**
 * Custom regex pattern for domain-specific date formats
 */
export const DatePatternSchema = z.object({
  pattern_id: z.string(),
  name: z.string(),
  regex: z.string(),
  category: DateCategorySchema.nullable(),
  priority: z.number().default(0),
  enabled: z.number().default(1),
  test_cases: z.string().nullable(), // JSON array of {input, expected}
  created_at: z.string(),
});

export type DatePattern = z.infer<typeof DatePatternSchema>;

/**
 * Input for creating/updating a pattern
 */
export const DatePatternInputSchema = z.object({
  name: z.string().min(1),
  regex: z.string().min(1).max(500), // Max 500 chars per audit
  category: DateCategorySchema.nullable().optional(),
  priority: z.number().optional(),
  enabled: z.number().optional(),
  test_cases: z.string().nullable().optional(),
});

export type DatePatternInput = z.infer<typeof DatePatternInputSchema>;

// =============================================================================
// Extraction Results
// =============================================================================

/**
 * Result from chrono-node parsing
 */
export interface ChronoParseResult {
  text: string;
  start: {
    year: number | null;
    month: number | null;
    day: number | null;
  };
  end?: {
    year: number | null;
    month: number | null;
    day: number | null;
  };
  index: number;
  certainty: number;
  centuryBiasApplied?: boolean;
  wasRelativeDate?: boolean;
}

/**
 * Extraction result from the date engine service
 */
export interface ExtractionResult {
  raw_text: string;
  parsed_date: string | null;
  date_start: string | null;
  date_end: string | null;
  date_precision: DatePrecision;
  date_display: string | null;
  date_edtf: string | null;
  date_sort: number | null;
  sentence: string;
  sentence_position: number;
  category: DateCategory;
  category_confidence: number;
  category_keywords: string[];
  keyword_distance: number | null;
  sentence_position_type: SentencePositionType;
  parser_confidence: number;
  century_bias_applied: boolean;
  original_year_ambiguous: boolean;
  was_relative_date: boolean;
  relative_date_anchor: string | null;
  overall_confidence: number;
}

// =============================================================================
// Statistics
// =============================================================================

/**
 * Date engine statistics
 */
export interface DateEngineStats {
  total_extractions: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  converted_count: number;
  by_category: Record<DateCategory, number>;
  by_status: Record<ExtractionStatus, number>;
  conflicts_count: number;
  duplicates_count: number;
  avg_confidence: number;
}

/**
 * Type alias for extraction statistics (used in IPC)
 */
export type DateExtractionStats = DateEngineStats;

/**
 * ML learning statistics
 */
export interface DateEngineLearningStats {
  total_entries: number;
  by_category: Record<string, {
    approval_count: number;
    rejection_count: number;
    weight_modifier: number;
  }>;
  top_keywords: Array<{
    keyword: string;
    category: string;
    approval_count: number;
    rejection_count: number;
  }>;
}

// =============================================================================
// Filter/Query Types
// =============================================================================

/**
 * Filters for querying extractions
 */
export interface DateExtractionFilters {
  locid?: string;
  subid?: string;
  status?: ExtractionStatus | ExtractionStatus[];
  category?: DateCategory | DateCategory[];
  has_conflict?: boolean;
  min_confidence?: number;
  max_confidence?: number;
  is_primary?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Backfill options
 */
export interface BackfillOptions {
  batch_size?: number;      // Default: 50
  batch_delay_ms?: number;  // Default: 100
  skip_processed?: boolean; // Default: true
  locid?: string;           // Filter to specific location
}

/**
 * Backfill progress event
 */
export interface BackfillProgress {
  processed: number;
  total: number;
  current_source_id: string | null;
  extractions_found: number;
  errors: number;
}

// =============================================================================
// Auto-Approval Rules
// =============================================================================

/**
 * Categories that can be auto-approved
 */
export const AUTO_APPROVE_CATEGORIES: DateCategory[] = [
  'build_date',
  'opening',
  'demolition',
];

/**
 * Minimum confidence for auto-approval
 */
export const AUTO_APPROVE_MIN_CONFIDENCE = 0.6;

/**
 * Check if an extraction should be auto-approved
 */
export function shouldAutoApprove(
  category: DateCategory,
  overall_confidence: number
): boolean {
  return (
    AUTO_APPROVE_CATEGORIES.includes(category) &&
    overall_confidence >= AUTO_APPROVE_MIN_CONFIDENCE
  );
}
