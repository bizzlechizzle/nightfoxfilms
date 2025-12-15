/**
 * Timeline Merger Service
 *
 * Handles merging duplicate timeline events from multiple sources.
 * Same event from different sources = 1 event with multiple source_refs.
 *
 * MERGE RULES:
 * 1. Events with same date + same category = candidates for merge
 * 2. Prefer higher precision dates (exact > month > year)
 * 3. Combine all source_refs into array
 * 4. Keep highest confidence
 * 5. Merge descriptions intelligently
 *
 * @version 1.0
 */

import type { Database as SqliteDatabase } from 'better-sqlite3';
import { randomUUID } from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Timeline event from database
 */
interface TimelineEvent {
  event_id: string;
  locid: string;
  event_date: string | null;
  event_date_end: string | null;
  event_type: string;
  description: string;
  confidence: number;
  source_refs: string[];
  verb_context: string | null;
  prompt_version: string | null;
  is_approximate: number;
  precision: string;
  created_at: string;
  updated_at: string | null;
}

/**
 * New event to be added
 */
interface NewTimelineEvent {
  event_date: string | null;
  event_date_end?: string | null;
  event_type: string;
  description: string;
  confidence: number;
  source_ref: string;
  verb_context?: string;
  prompt_version?: string;
  is_approximate?: boolean;
  precision?: string;
}

/**
 * Merge result
 */
interface MergeResult {
  action: 'created' | 'merged' | 'skipped';
  event_id: string;
  existing_event_id?: string;
  source_refs: string[];
  warnings?: string[];
}

/**
 * Merge configuration
 */
export interface MergeConfig {
  /** Maximum date difference (in days) to consider same event */
  maxDateDifferencesDays: number;
  /** Minimum confidence to accept event */
  minConfidence: number;
  /** Prefer newer or older dates when merging */
  datePreference: 'older' | 'newer' | 'higher_precision';
  /** Merge descriptions or keep first */
  mergeDescriptions: boolean;
}

const DEFAULT_MERGE_CONFIG: MergeConfig = {
  maxDateDifferencesDays: 365, // Same year
  minConfidence: 0.4,
  datePreference: 'higher_precision',
  mergeDescriptions: true,
};

// =============================================================================
// PRECISION HELPERS
// =============================================================================

/**
 * Precision levels ordered from lowest to highest
 */
const PRECISION_ORDER = ['decade', 'approximate', 'year', 'month', 'exact'];

/**
 * Get precision from date string
 */
function getPrecision(date: string | null): string {
  if (!date) return 'approximate';

  const parts = date.split('-');
  if (parts.length === 3) return 'exact';
  if (parts.length === 2) return 'month';
  return 'year';
}

/**
 * Compare precision levels
 * Returns: positive if a > b, negative if a < b, 0 if equal
 */
function comparePrecision(a: string, b: string): number {
  const indexA = PRECISION_ORDER.indexOf(a);
  const indexB = PRECISION_ORDER.indexOf(b);
  return indexA - indexB;
}

/**
 * Extract year from date string
 */
function getYear(date: string | null): number | null {
  if (!date) return null;
  const year = parseInt(date.split('-')[0], 10);
  return isNaN(year) ? null : year;
}

/**
 * Check if two dates are within range for merging
 */
function areDatesWithinRange(
  dateA: string | null,
  dateB: string | null,
  maxDays: number
): boolean {
  if (!dateA || !dateB) return true; // Null dates match anything

  const yearA = getYear(dateA);
  const yearB = getYear(dateB);

  if (yearA === null || yearB === null) return true;

  // Simple year-based check (365 days = 1 year)
  const yearDiff = Math.abs(yearA - yearB);
  return yearDiff <= maxDays / 365;
}

// =============================================================================
// TIMELINE MERGER SERVICE
// =============================================================================

export class TimelineMergerService {
  private db: SqliteDatabase;
  private config: MergeConfig;

  constructor(db: SqliteDatabase, config?: Partial<MergeConfig>) {
    this.db = db;
    this.config = { ...DEFAULT_MERGE_CONFIG, ...config };
  }

  /**
   * Add a new timeline event, merging if duplicate exists
   *
   * @param locid - Location ID
   * @param event - New event to add
   * @returns Merge result
   */
  addEvent(locid: string, event: NewTimelineEvent): MergeResult {
    // Check minimum confidence
    if (event.confidence < this.config.minConfidence) {
      return {
        action: 'skipped',
        event_id: '',
        source_refs: [event.source_ref],
        warnings: [`Confidence ${event.confidence} below threshold ${this.config.minConfidence}`],
      };
    }

    // Find potential duplicate
    const existing = this.findDuplicateEvent(locid, event);

    if (existing) {
      // Merge with existing event
      return this.mergeWithExisting(existing, event);
    } else {
      // Create new event
      return this.createNewEvent(locid, event);
    }
  }

  /**
   * Find a duplicate event for merging
   */
  private findDuplicateEvent(
    locid: string,
    newEvent: NewTimelineEvent
  ): TimelineEvent | null {
    // Get all events of same type for this location
    const events = this.db.prepare(`
      SELECT
        event_id,
        locid,
        event_date,
        event_date_end,
        event_type,
        description,
        confidence,
        source_refs,
        verb_context,
        prompt_version,
        is_approximate,
        precision,
        created_at,
        updated_at
      FROM location_timeline
      WHERE locid = ? AND event_type = ?
    `).all(locid, newEvent.event_type) as Array<Record<string, unknown>>;

    for (const row of events) {
      const existing = this.rowToEvent(row);

      // Check if dates are within merge range
      if (
        areDatesWithinRange(
          existing.event_date,
          newEvent.event_date,
          this.config.maxDateDifferencesDays
        )
      ) {
        return existing;
      }
    }

    return null;
  }

  /**
   * Merge new event with existing
   */
  private mergeWithExisting(
    existing: TimelineEvent,
    newEvent: NewTimelineEvent
  ): MergeResult {
    const warnings: string[] = [];

    // Merge source refs
    const sourceRefs = [...new Set([...existing.source_refs, newEvent.source_ref])];

    // Determine best date based on preference
    let bestDate = existing.event_date;
    let bestPrecision = existing.precision;

    if (this.config.datePreference === 'higher_precision') {
      const newPrecision = newEvent.precision || getPrecision(newEvent.event_date);
      if (comparePrecision(newPrecision, existing.precision) > 0) {
        bestDate = newEvent.event_date;
        bestPrecision = newPrecision;
        warnings.push(`Updated date to higher precision: ${newEvent.event_date} (${newPrecision})`);
      }
    } else if (this.config.datePreference === 'newer') {
      const existingYear = getYear(existing.event_date);
      const newYear = getYear(newEvent.event_date);
      if (newYear && existingYear && newYear > existingYear) {
        bestDate = newEvent.event_date;
        bestPrecision = newEvent.precision || getPrecision(newEvent.event_date);
      }
    } else if (this.config.datePreference === 'older') {
      const existingYear = getYear(existing.event_date);
      const newYear = getYear(newEvent.event_date);
      if (newYear && existingYear && newYear < existingYear) {
        bestDate = newEvent.event_date;
        bestPrecision = newEvent.precision || getPrecision(newEvent.event_date);
      }
    }

    // Merge descriptions
    let description = existing.description;
    if (
      this.config.mergeDescriptions &&
      newEvent.description &&
      newEvent.description !== existing.description
    ) {
      // Only add if substantially different
      if (!existing.description.includes(newEvent.description.substring(0, 50))) {
        description = `${existing.description} | ${newEvent.description}`;
        warnings.push('Merged descriptions from multiple sources');
      }
    }

    // Take higher confidence
    const confidence = Math.max(existing.confidence, newEvent.confidence);

    // Merge verb context
    const verbContext = existing.verb_context || newEvent.verb_context;

    // Update in database
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE location_timeline SET
        event_date = ?,
        precision = ?,
        description = ?,
        confidence = ?,
        source_refs = ?,
        verb_context = ?,
        updated_at = ?
      WHERE event_id = ?
    `).run(
      bestDate,
      bestPrecision,
      description,
      confidence,
      JSON.stringify(sourceRefs),
      verbContext,
      now,
      existing.event_id
    );

    return {
      action: 'merged',
      event_id: existing.event_id,
      existing_event_id: existing.event_id,
      source_refs: sourceRefs,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Create a new timeline event
   */
  private createNewEvent(locid: string, event: NewTimelineEvent): MergeResult {
    const event_id = randomUUID();
    const now = new Date().toISOString();
    const precision = event.precision || getPrecision(event.event_date);

    this.db.prepare(`
      INSERT INTO location_timeline (
        event_id, locid, event_date, event_date_end, event_type,
        description, confidence, source_refs, verb_context,
        prompt_version, is_approximate, precision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event_id,
      locid,
      event.event_date,
      event.event_date_end || null,
      event.event_type,
      event.description,
      event.confidence,
      JSON.stringify([event.source_ref]),
      event.verb_context || null,
      event.prompt_version || null,
      event.is_approximate ? 1 : 0,
      precision,
      now
    );

    return {
      action: 'created',
      event_id,
      source_refs: [event.source_ref],
    };
  }

  /**
   * Batch add events with automatic merging
   */
  addEventsBatch(
    locid: string,
    events: NewTimelineEvent[]
  ): {
    created: number;
    merged: number;
    skipped: number;
    results: MergeResult[];
  } {
    const results: MergeResult[] = [];
    let created = 0;
    let merged = 0;
    let skipped = 0;

    // Use transaction for batch
    const transaction = this.db.transaction(() => {
      for (const event of events) {
        const result = this.addEvent(locid, event);
        results.push(result);

        switch (result.action) {
          case 'created':
            created++;
            break;
          case 'merged':
            merged++;
            break;
          case 'skipped':
            skipped++;
            break;
        }
      }
    });

    transaction();

    return { created, merged, skipped, results };
  }

  /**
   * Deduplicate existing timeline events for a location
   */
  deduplicateLocation(locid: string): {
    merged: number;
    events_remaining: number;
  } {
    // Get all events grouped by type
    const events = this.db.prepare(`
      SELECT
        event_id, locid, event_date, event_date_end, event_type,
        description, confidence, source_refs, verb_context,
        prompt_version, is_approximate, precision, created_at, updated_at
      FROM location_timeline
      WHERE locid = ?
      ORDER BY event_type, event_date
    `).all(locid) as Array<Record<string, unknown>>;

    const eventsByType = new Map<string, TimelineEvent[]>();

    for (const row of events) {
      const event = this.rowToEvent(row);
      const existing = eventsByType.get(event.event_type) || [];
      existing.push(event);
      eventsByType.set(event.event_type, existing);
    }

    let mergedCount = 0;
    const toDelete: string[] = [];

    // Process each type
    for (const [, typeEvents] of eventsByType) {
      if (typeEvents.length < 2) continue;

      // Sort by precision (highest first) then confidence
      typeEvents.sort((a, b) => {
        const precDiff = comparePrecision(b.precision, a.precision);
        if (precDiff !== 0) return precDiff;
        return b.confidence - a.confidence;
      });

      // Keep first, merge others if within range
      const primary = typeEvents[0];
      const primarySourceRefs = [...primary.source_refs];
      let primaryDescription = primary.description;

      for (let i = 1; i < typeEvents.length; i++) {
        const other = typeEvents[i];

        if (
          areDatesWithinRange(
            primary.event_date,
            other.event_date,
            this.config.maxDateDifferencesDays
          )
        ) {
          // Merge into primary
          primarySourceRefs.push(...other.source_refs);

          if (this.config.mergeDescriptions && other.description !== primary.description) {
            if (!primaryDescription.includes(other.description.substring(0, 50))) {
              primaryDescription = `${primaryDescription} | ${other.description}`;
            }
          }

          toDelete.push(other.event_id);
          mergedCount++;
        }
      }

      // Update primary with merged data
      if (toDelete.length > 0) {
        const uniqueRefs = [...new Set(primarySourceRefs)];
        const now = new Date().toISOString();

        this.db.prepare(`
          UPDATE location_timeline SET
            source_refs = ?,
            description = ?,
            updated_at = ?
          WHERE event_id = ?
        `).run(JSON.stringify(uniqueRefs), primaryDescription, now, primary.event_id);
      }
    }

    // Delete merged events
    if (toDelete.length > 0) {
      const placeholders = toDelete.map(() => '?').join(',');
      this.db.prepare(`
        DELETE FROM location_timeline WHERE event_id IN (${placeholders})
      `).run(...toDelete);
    }

    // Get remaining count
    const remaining = this.db.prepare(`
      SELECT COUNT(*) as count FROM location_timeline WHERE locid = ?
    `).get(locid) as { count: number };

    return {
      merged: mergedCount,
      events_remaining: remaining.count,
    };
  }

  /**
   * Get timeline events for a location
   */
  getTimelineEvents(locid: string): TimelineEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM location_timeline
      WHERE locid = ?
      ORDER BY event_date ASC NULLS LAST, event_type ASC
    `).all(locid) as Array<Record<string, unknown>>;

    return rows.map((row) => this.rowToEvent(row));
  }

  /**
   * Convert database row to TimelineEvent
   */
  private rowToEvent(row: Record<string, unknown>): TimelineEvent {
    let sourceRefs: string[] = [];
    if (row.source_refs) {
      try {
        sourceRefs = JSON.parse(row.source_refs as string);
      } catch {
        sourceRefs = [row.source_refs as string];
      }
    }

    return {
      event_id: row.event_id as string,
      locid: row.locid as string,
      event_date: row.event_date as string | null,
      event_date_end: row.event_date_end as string | null,
      event_type: row.event_type as string,
      description: row.description as string,
      confidence: row.confidence as number,
      source_refs: sourceRefs,
      verb_context: row.verb_context as string | null,
      prompt_version: row.prompt_version as string | null,
      is_approximate: row.is_approximate as number,
      precision: row.precision as string || getPrecision(row.event_date as string | null),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string | null,
    };
  }

  /**
   * Update merge configuration
   */
  updateConfig(config: Partial<MergeConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): MergeConfig {
    return { ...this.config };
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let serviceInstance: TimelineMergerService | null = null;

/**
 * Get the timeline merger service singleton
 */
export function getTimelineMergerService(
  db: SqliteDatabase,
  config?: Partial<MergeConfig>
): TimelineMergerService {
  if (!serviceInstance) {
    serviceInstance = new TimelineMergerService(db, config);
  }
  return serviceInstance;
}
