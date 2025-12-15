/**
 * Timeline Service
 * Business logic for timeline events - visit consolidation, cellphone detection, date handling
 */

import { SqliteTimelineRepository } from '../repositories/sqlite-timeline-repository';
import {
  parseDate,
  formatDateDisplay,
  calculateDateSort,
  toEdtf,
} from './date-parser-service';
import type { ParsedDate } from './date-parser-service';
import type {
  TimelineEvent,
  TimelineEventInput,
  TimelineEventWithSource,
} from '@au-archive/core';

// Cellphone manufacturers whose dates can be auto-approved
// These devices sync time automatically via network
const CELLPHONE_MAKES = [
  'apple',
  'samsung',
  'google',
  'pixel',
  'oneplus',
  'xiaomi',
  'huawei',
  'oppo',
  'vivo',
  'motorola',
  'lg',
  'sony mobile',
  'htc',
  'nokia',
  'realme',
  'poco',
  'asus rog',
];

// Models that indicate cellphone even if make isn't in list
const CELLPHONE_MODELS = [
  'iphone',
  'galaxy',
  'pixel',
];

// Film scanner makes - dates are scan dates, not capture dates
const FILM_SCANNER_MAKES = [
  'noritsu',
  'pakon',
  'frontier',
  'imacon',
  'flextight',
  'plustek',
  'pacific image',
  'reflecta',
  'dimage scan',
  'coolscan',
  'perfection',
];

export class TimelineService {
  constructor(private repository: SqliteTimelineRepository) {}

  /**
   * Check if a device is a cellphone (dates can be auto-approved)
   * Cellphones sync time automatically, so EXIF dates are reliable
   */
  isCellphone(make: string | null, model: string | null): boolean {
    if (!make && !model) return false;

    const makeLower = make?.toLowerCase() || '';
    const modelLower = model?.toLowerCase() || '';

    // Check make against known cellphone manufacturers
    if (CELLPHONE_MAKES.some(m => makeLower.includes(m))) {
      return true;
    }

    // Check model for known cellphone indicators
    if (CELLPHONE_MODELS.some(m => modelLower.includes(m))) {
      return true;
    }

    return false;
  }

  /**
   * Check if a device is a film scanner (dates should be excluded)
   * Film scanner dates are digitization dates, not capture dates
   */
  isFilmScanner(make: string | null): boolean {
    if (!make) return false;
    const makeLower = make.toLowerCase();
    return FILM_SCANNER_MAKES.some(m => makeLower.includes(m));
  }

  /**
   * Get timeline for a location (host only, excludes sub-location events)
   */
  async getTimeline(locid: string): Promise<TimelineEvent[]> {
    return this.repository.findByLocation(locid);
  }

  /**
   * Get timeline for a sub-location
   */
  async getSubLocationTimeline(
    locid: string,
    subid: string
  ): Promise<TimelineEvent[]> {
    return this.repository.findBySubLocation(locid, subid);
  }

  /**
   * Get combined timeline for host location
   * Includes all sub-location events with building names
   */
  async getCombinedTimeline(locid: string): Promise<TimelineEventWithSource[]> {
    return this.repository.findCombined(locid);
  }

  /**
   * Parse a date string and return structured date info
   */
  parseDateInput(input: string): ParsedDate {
    return parseDate(input);
  }

  /**
   * Create a new timeline event
   */
  async createEvent(
    input: TimelineEventInput,
    userId?: string
  ): Promise<TimelineEvent> {
    // Calculate derived fields if not provided
    if (input.date_sort === undefined || input.date_sort === null) {
      input.date_sort = calculateDateSort(
        input.date_precision,
        input.date_start ?? null,
        input.date_end ?? null
      );
    }

    if (!input.date_display) {
      input.date_display = formatDateDisplay(
        input.date_precision,
        input.date_start ?? null,
        input.date_end ?? null
      );
    }

    if (!input.date_edtf) {
      input.date_edtf = toEdtf(
        input.date_precision,
        input.date_start ?? null,
        input.date_end ?? null
      );
    }

    return this.repository.create(input, userId);
  }

  /**
   * Update an existing event
   */
  async updateEvent(
    eventId: string,
    updates: Partial<TimelineEventInput>,
    userId?: string
  ): Promise<TimelineEvent | undefined> {
    // Recalculate derived fields if date fields changed
    if (
      updates.date_precision !== undefined ||
      updates.date_start !== undefined ||
      updates.date_end !== undefined
    ) {
      const existing = await this.repository.findById(eventId);
      if (existing) {
        const precision = updates.date_precision ?? existing.date_precision;
        const dateStart = updates.date_start !== undefined ? updates.date_start : existing.date_start;
        const dateEnd = updates.date_end !== undefined ? updates.date_end : existing.date_end;

        updates.date_sort = calculateDateSort(
          precision as any,
          dateStart,
          dateEnd
        );
        updates.date_display = formatDateDisplay(
          precision as any,
          dateStart,
          dateEnd
        );
        updates.date_edtf = toEdtf(precision as any, dateStart, dateEnd);
      }
    }

    return this.repository.update(eventId, updates, userId);
  }

  /**
   * Delete an event
   */
  async deleteEvent(eventId: string): Promise<boolean> {
    return this.repository.delete(eventId);
  }

  /**
   * Approve an event (user verification)
   */
  async approveEvent(
    eventId: string,
    userId: string
  ): Promise<TimelineEvent | undefined> {
    return this.repository.approve(eventId, userId);
  }

  /**
   * Handle media import - create or update visit event
   * Consolidates multiple photos from the same day into one visit
   */
  async handleMediaImport(
    locid: string,
    subid: string | null,
    mediaHash: string,
    dateTaken: string | null,
    cameraMake: string | null,
    cameraModel: string | null,
    userId?: string
  ): Promise<TimelineEvent | undefined> {
    if (!dateTaken) return undefined;

    // Skip film scanner dates (scan dates, not capture dates)
    if (this.isFilmScanner(cameraMake)) return undefined;

    // Extract just the date part (YYYY-MM-DD) from ISO timestamp
    const dateOnly = dateTaken.split('T')[0];
    if (!dateOnly || dateOnly.length < 10) return undefined;

    // Check for existing visit on this date
    const existingVisit = await this.repository.findVisitByDate(
      locid,
      subid,
      dateOnly
    );

    if (existingVisit) {
      // Add media to existing visit
      return this.repository.addMediaToVisit(existingVisit.event_id, mediaHash, userId);
    }

    // Create new visit event
    const isCellphoneDate = this.isCellphone(cameraMake, cameraModel);
    const device = cameraMake && cameraModel
      ? `${cameraMake} ${cameraModel}`.trim()
      : (cameraMake || cameraModel || null);

    return this.createEvent(
      {
        locid,
        subid: subid ?? undefined,
        event_type: 'visit',
        date_start: dateOnly,
        date_precision: 'exact',
        source_type: 'exif',
        source_ref: mediaHash,
        source_device: device,
        media_count: 1,
        media_hashes: JSON.stringify([mediaHash]),
        auto_approved: isCellphoneDate ? 1 : 0,
      },
      userId
    );
  }

  /**
   * Handle media deletion - update or remove visit
   */
  async handleMediaDelete(
    mediaHash: string,
    userId?: string
  ): Promise<void> {
    const visit = await this.repository.findVisitByMediaHash(mediaHash);
    if (visit) {
      await this.repository.removeMediaFromVisit(visit.event_id, mediaHash, userId);
    }
  }

  /**
   * Initialize timeline for a new location
   * Creates database_entry event only (established event created on-demand when user sets date)
   */
  async initializeLocationTimeline(
    locid: string,
    locadd: string | null,
    userId?: string
  ): Promise<void> {
    // Create database_entry event
    if (locadd) {
      // Check if already has database_entry
      const events = await this.repository.findByLocation(locid);
      const hasDbEntry = events.some(e => e.event_type === 'database_entry');
      if (hasDbEntry) return;

      const dateOnly = locadd.split('T')[0]; // YYYY-MM-DD
      const dateSort = parseInt(dateOnly.replace(/-/g, '')); // YYYYMMDD as number
      await this.createEvent(
        {
          locid,
          event_type: 'database_entry',
          date_start: dateOnly,
          date_precision: 'exact',
          date_display: dateOnly, // ISO 8601: YYYY-MM-DD (archival standard)
          date_sort: dateSort,
          source_type: 'system',
        },
        userId
      );
    }
  }

  /**
   * Initialize timeline for a new sub-location
   * No-op: established event created on-demand when user sets date
   */
  async initializeSubLocationTimeline(
    _locid: string,
    _subid: string,
    _userId?: string
  ): Promise<void> {
    // Established event created on-demand via updateEstablishedDate
    // No default "Built" placeholder
  }

  /**
   * Get visit count for a location
   */
  async getVisitCount(locid: string): Promise<number> {
    return this.repository.getVisitCount(locid);
  }

  /**
   * Get the established event for a location
   */
  async getEstablishedEvent(locid: string, subid?: string | null): Promise<TimelineEvent | undefined> {
    return this.repository.getEstablishedEvent(locid, subid ?? undefined);
  }

  /**
   * Update established date for a location
   * Parses natural language input and updates the event
   */
  async updateEstablishedDate(
    locid: string,
    subid: string | null,
    dateInput: string,
    eventSubtype: string = 'built',
    userId?: string
  ): Promise<TimelineEvent | undefined> {
    const parsed = parseDate(dateInput);
    const event = await this.repository.getEstablishedEvent(locid, subid ?? undefined);

    if (!event) {
      // Create if doesn't exist
      return this.createEvent(
        {
          locid,
          subid: subid ?? undefined,
          event_type: 'established',
          event_subtype: eventSubtype,
          date_start: parsed.dateStart,
          date_end: parsed.dateEnd,
          date_precision: parsed.precision,
          date_display: parsed.display,
          date_edtf: parsed.edtf,
          date_sort: parsed.dateSort,
          source_type: 'manual',
        },
        userId
      );
    }

    // Update existing
    return this.repository.update(
      event.event_id,
      {
        event_subtype: eventSubtype,
        date_start: parsed.dateStart,
        date_end: parsed.dateEnd,
        date_precision: parsed.precision,
        date_display: parsed.display,
        date_edtf: parsed.edtf,
        date_sort: parsed.dateSort,
        source_type: 'manual',
      },
      userId
    );
  }

  /**
   * Create a web page timeline event from an archived websource
   * Used when archiving a web page with a publish date
   *
   * @param locid - Location ID
   * @param subid - Sub-location ID (optional)
   * @param websourceId - WebSource ID (for linking/deduplication)
   * @param publishDate - Extracted publish date from the page
   * @param title - Page title for display
   * @param userId - User ID for audit trail
   * @returns Created timeline event or undefined if duplicate/invalid
   */
  async createWebPageEvent(
    locid: string,
    subid: string | null,
    websourceId: string,
    publishDate: string,
    title: string | null,
    userId?: string
  ): Promise<TimelineEvent | undefined> {
    // Skip if no publish date
    if (!publishDate) return undefined;

    // Duplicate prevention: check if event already exists for this websource
    const existing = await this.repository.findBySourceRef(
      websourceId,
      'custom',
      'web_page'
    );
    if (existing) {
      console.log(`[Timeline] Web page event already exists for websource ${websourceId}`);
      return existing;
    }

    // Parse the publish date
    const parsed = parseDate(publishDate);
    if (parsed.precision === 'unknown') {
      console.log(`[Timeline] Could not parse publish date: ${publishDate}`);
      return undefined;
    }

    // Create the web page event
    return this.createEvent(
      {
        locid,
        subid: subid ?? undefined,
        event_type: 'custom',
        event_subtype: 'web_page',
        date_start: parsed.dateStart,
        date_end: parsed.dateEnd,
        date_precision: parsed.precision,
        date_display: parsed.display,
        date_edtf: parsed.edtf,
        date_sort: parsed.dateSort,
        source_type: 'web',
        source_ref: websourceId,
        notes: title || 'Web Page', // Store title in notes field
      },
      userId
    );
  }

  /**
   * Delete web page timeline event when websource is deleted
   * Cascade deletion to keep timeline in sync
   *
   * @param websourceId - WebSource ID to delete events for
   * @returns Number of deleted events
   */
  async deleteWebPageEvent(websourceId: string): Promise<number> {
    return this.repository.deleteBySourceRef(websourceId, 'custom', 'web_page');
  }

  /**
   * Check if a web page event exists for a websource
   * Used to prevent duplicates
   */
  async hasWebPageEvent(websourceId: string): Promise<boolean> {
    const existing = await this.repository.findBySourceRef(
      websourceId,
      'custom',
      'web_page'
    );
    return !!existing;
  }
}
