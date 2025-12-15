/**
 * Timeline Domain Types
 * Based on archival standards: EDTF (Library of Congress), EAD, DACS
 */

import { z } from 'zod';

// Date precision types based on archival standards
export const DatePrecisionSchema = z.enum([
  'exact',    // Full date: 2024-03-15
  'month',    // Month only: 2024-03
  'year',     // Year only: 2024
  'decade',   // 1920s
  'century',  // 19th Century
  'circa',    // ca. 1950
  'range',    // 1920-1925
  'before',   // before 1950
  'after',    // after 1945
  'early',    // early 1900s
  'mid',      // mid-1950s
  'late',     // late 1980s
  'unknown',  // No date information
]);

export type DatePrecision = z.infer<typeof DatePrecisionSchema>;

// Event types
export const EventTypeSchema = z.enum([
  'established',
  'visit',
  'database_entry',
  'custom',
]);

export type EventType = z.infer<typeof EventTypeSchema>;

// Established subtypes for lifecycle tracking
export const EstablishedSubtypeSchema = z.enum([
  'built',
  'opened',
  'expanded',
  'renovated',
  'closed',
  'abandoned',
  'demolished',
]);

export type EstablishedSubtype = z.infer<typeof EstablishedSubtypeSchema>;

// Source types for tracking where date info came from
export const SourceTypeSchema = z.enum([
  'exif',
  'manual',
  'web',
  'document',
  'system',
]);

export type SourceType = z.infer<typeof SourceTypeSchema>;

// Timeline event schema (matches database table)
export const TimelineEventSchema = z.object({
  event_id: z.string().length(16),
  locid: z.string().length(16),
  subid: z.string().length(16).nullable(),
  event_type: EventTypeSchema,
  event_subtype: z.string().nullable(),
  date_start: z.string().nullable(),
  date_end: z.string().nullable(),
  date_precision: DatePrecisionSchema,
  date_display: z.string().nullable(),
  date_edtf: z.string().nullable(),
  date_sort: z.number().nullable(),
  date_override: z.string().nullable(),
  override_reason: z.string().nullable(),
  source_type: SourceTypeSchema.nullable(),
  source_ref: z.string().nullable(),
  source_device: z.string().nullable(),
  media_count: z.number().default(0),
  media_hashes: z.string().nullable(), // JSON array
  auto_approved: z.number().default(0),
  user_approved: z.number().default(0),
  approved_at: z.string().nullable(),
  approved_by: z.string().nullable(),
  notes: z.string().nullable(),
  // OPT-120: Extraction Pipeline - Smart titles and summaries
  smart_title: z.string().nullable(),
  tldr: z.string().nullable(),
  confidence: z.number().nullable(),
  needs_review: z.number().default(0),
  created_at: z.string(),
  created_by: z.string().nullable(),
  updated_at: z.string().nullable(),
  updated_by: z.string().nullable(),
});

export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

// Input schema for creating events (fewer required fields)
export const TimelineEventInputSchema = z.object({
  locid: z.string().length(16),
  subid: z.string().length(16).nullable().optional(),
  event_type: EventTypeSchema,
  event_subtype: z.string().nullable().optional(),
  date_start: z.string().nullable().optional(),
  date_end: z.string().nullable().optional(),
  date_precision: DatePrecisionSchema,
  date_display: z.string().nullable().optional(),
  date_edtf: z.string().nullable().optional(),
  date_sort: z.number().nullable().optional(),
  source_type: SourceTypeSchema.nullable().optional(),
  source_ref: z.string().nullable().optional(),
  source_device: z.string().nullable().optional(),
  media_count: z.number().optional(),
  media_hashes: z.string().nullable().optional(),
  auto_approved: z.number().optional(),
  notes: z.string().nullable().optional(),
  // OPT-120: Extraction Pipeline
  smart_title: z.string().nullable().optional(),
  tldr: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  needs_review: z.number().optional(),
});

export type TimelineEventInput = z.infer<typeof TimelineEventInputSchema>;

// Update schema (all fields optional)
export const TimelineEventUpdateSchema = TimelineEventInputSchema.partial();
export type TimelineEventUpdate = z.infer<typeof TimelineEventUpdateSchema>;

// Parsed date result from date-parser-service
export interface ParsedDate {
  precision: DatePrecision;
  dateStart: string | null;
  dateEnd: string | null;
  display: string;
  edtf: string;
  dateSort: number;
  confidence: number; // 0-1 confidence in parsing
}

// Timeline event with source building name (for combined queries)
export interface TimelineEventWithSource extends TimelineEvent {
  source_building?: string | null;
}

// Display labels for date precisions
export const DATE_PRECISION_LABELS: Record<DatePrecision, string> = {
  exact: 'Exact Date',
  month: 'Month',
  year: 'Year',
  decade: 'Decade',
  century: 'Century',
  circa: 'Circa (approx)',
  range: 'Range',
  before: 'Before',
  after: 'After',
  early: 'Early period',
  mid: 'Mid period',
  late: 'Late period',
  unknown: 'Unknown',
};

// Display labels for event types
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  established: 'Established',
  visit: 'Visit',
  database_entry: 'Database Entry',
  custom: 'Custom Event',
};

// Display labels for established subtypes
export const ESTABLISHED_SUBTYPE_LABELS: Record<EstablishedSubtype, string> = {
  built: 'Built',
  opened: 'Opened',
  expanded: 'Expanded',
  renovated: 'Renovated',
  closed: 'Closed',
  abandoned: 'Abandoned',
  demolished: 'Demolished',
};
