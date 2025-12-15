/**
 * SQLite Timeline Repository
 * Handles CRUD operations for location timeline events
 */

import { Kysely } from 'kysely';
import { generateId } from '../main/ipc-validation';
import type { Database, LocationTimelineTable } from '../main/database.types';

// Re-export types from core for convenience
export type {
  TimelineEvent,
  TimelineEventInput,
  TimelineEventUpdate,
  TimelineEventWithSource,
  DatePrecision,
  EventType,
  EstablishedSubtype,
  SourceType,
} from '@au-archive/core';

// Import types for internal use
import type {
  TimelineEvent,
  TimelineEventInput,
  TimelineEventUpdate,
  TimelineEventWithSource,
} from '@au-archive/core';

/**
 * Repository for managing location timeline events
 */
export class SqliteTimelineRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Find all timeline events for a location (excluding sub-location events)
   */
  async findByLocation(locid: string): Promise<TimelineEvent[]> {
    const results = await this.db
      .selectFrom('location_timeline')
      .selectAll()
      .where('locid', '=', locid)
      .where('subid', 'is', null)
      .orderBy('date_sort', 'desc')
      .execute();

    return results as TimelineEvent[];
  }

  /**
   * Find timeline events for a specific sub-location
   */
  async findBySubLocation(locid: string, subid: string): Promise<TimelineEvent[]> {
    const results = await this.db
      .selectFrom('location_timeline')
      .selectAll()
      .where('locid', '=', locid)
      .where('subid', '=', subid)
      .orderBy('date_sort', 'desc')
      .execute();

    return results as TimelineEvent[];
  }

  /**
   * Find combined timeline for host location (includes sub-location events)
   * Returns all events for the location and its sub-locations, with building names
   */
  async findCombined(locid: string): Promise<TimelineEventWithSource[]> {
    // Get host events (no subid)
    const hostEvents = await this.db
      .selectFrom('location_timeline')
      .selectAll()
      .where('locid', '=', locid)
      .where('subid', 'is', null)
      .execute();

    // Get sub-location events with building names
    const subEvents = await this.db
      .selectFrom('location_timeline as t')
      .innerJoin('slocs as s', 's.subid', 't.subid')
      .select([
        't.event_id',
        't.locid',
        't.subid',
        't.event_type',
        't.event_subtype',
        't.date_start',
        't.date_end',
        't.date_precision',
        't.date_display',
        't.date_edtf',
        't.date_sort',
        't.date_override',
        't.override_reason',
        't.source_type',
        't.source_ref',
        't.source_device',
        't.media_count',
        't.media_hashes',
        't.auto_approved',
        't.user_approved',
        't.approved_at',
        't.approved_by',
        't.notes',
        // OPT-120: Extraction Pipeline - Smart titles and summaries
        't.smart_title',
        't.tldr',
        't.confidence',
        't.needs_review',
        't.created_at',
        't.created_by',
        't.updated_at',
        't.updated_by',
        's.subnam as source_building',
      ])
      .where('t.locid', '=', locid)
      .where('t.subid', 'is not', null)
      .execute();

    // Combine and sort by date_sort descending (newest first)
    const combined: TimelineEventWithSource[] = [
      ...hostEvents.map(e => ({ ...e, source_building: null } as TimelineEventWithSource)),
      ...(subEvents as TimelineEventWithSource[]),
    ];

    return combined.sort((a, b) => {
      const sortA = a.date_sort ?? 99999999;
      const sortB = b.date_sort ?? 99999999;
      return sortB - sortA; // Descending (newest first)
    });
  }

  /**
   * Find a single event by ID
   */
  async findById(eventId: string): Promise<TimelineEvent | undefined> {
    const result = await this.db
      .selectFrom('location_timeline')
      .selectAll()
      .where('event_id', '=', eventId)
      .executeTakeFirst();

    return result as TimelineEvent | undefined;
  }

  /**
   * Find existing visit for a specific date (for consolidation)
   * Used to add media to an existing visit instead of creating duplicates
   */
  async findVisitByDate(
    locid: string,
    subid: string | null,
    dateStart: string
  ): Promise<TimelineEvent | undefined> {
    let query = this.db
      .selectFrom('location_timeline')
      .selectAll()
      .where('locid', '=', locid)
      .where('event_type', '=', 'visit')
      .where('date_start', '=', dateStart);

    if (subid) {
      query = query.where('subid', '=', subid);
    } else {
      query = query.where('subid', 'is', null);
    }

    const result = await query.executeTakeFirst();
    return result as TimelineEvent | undefined;
  }

  /**
   * Create a new timeline event
   */
  async create(input: TimelineEventInput, userId?: string): Promise<TimelineEvent> {
    const eventId = generateId();
    const now = new Date().toISOString();

    const event: LocationTimelineTable = {
      event_id: eventId,
      locid: input.locid,
      subid: input.subid ?? null,
      event_type: input.event_type,
      event_subtype: input.event_subtype ?? null,
      date_start: input.date_start ?? null,
      date_end: input.date_end ?? null,
      date_precision: input.date_precision,
      date_display: input.date_display ?? null,
      date_edtf: input.date_edtf ?? null,
      date_sort: input.date_sort ?? null,
      date_override: null,
      override_reason: null,
      source_type: input.source_type ?? null,
      source_ref: input.source_ref ?? null,
      source_device: input.source_device ?? null,
      media_count: input.media_count ?? 0,
      media_hashes: input.media_hashes ?? null,
      auto_approved: input.auto_approved ?? 0,
      user_approved: 0,
      approved_at: null,
      approved_by: null,
      notes: input.notes ?? null,
      created_at: now,
      created_by: userId ?? null,
      updated_at: null,
      updated_by: null,
    };

    await this.db.insertInto('location_timeline').values(event).execute();

    return event as TimelineEvent;
  }

  /**
   * Update a timeline event
   */
  async update(
    eventId: string,
    updates: TimelineEventUpdate,
    userId?: string
  ): Promise<TimelineEvent | undefined> {
    const now = new Date().toISOString();

    // Build update object, excluding undefined values
    const updateObj: Partial<LocationTimelineTable> = {
      updated_at: now,
      updated_by: userId ?? null,
    };

    // Only include fields that are actually being updated
    if (updates.event_type !== undefined) updateObj.event_type = updates.event_type;
    if (updates.event_subtype !== undefined) updateObj.event_subtype = updates.event_subtype;
    if (updates.date_start !== undefined) updateObj.date_start = updates.date_start;
    if (updates.date_end !== undefined) updateObj.date_end = updates.date_end;
    if (updates.date_precision !== undefined) updateObj.date_precision = updates.date_precision;
    if (updates.date_display !== undefined) updateObj.date_display = updates.date_display;
    if (updates.date_edtf !== undefined) updateObj.date_edtf = updates.date_edtf;
    if (updates.date_sort !== undefined) updateObj.date_sort = updates.date_sort;
    if (updates.source_type !== undefined) updateObj.source_type = updates.source_type;
    if (updates.source_ref !== undefined) updateObj.source_ref = updates.source_ref;
    if (updates.source_device !== undefined) updateObj.source_device = updates.source_device;
    if (updates.media_count !== undefined) updateObj.media_count = updates.media_count;
    if (updates.media_hashes !== undefined) updateObj.media_hashes = updates.media_hashes;
    if (updates.auto_approved !== undefined) updateObj.auto_approved = updates.auto_approved;
    if (updates.notes !== undefined) updateObj.notes = updates.notes;

    await this.db
      .updateTable('location_timeline')
      .set(updateObj)
      .where('event_id', '=', eventId)
      .execute();

    return this.findById(eventId);
  }

  /**
   * Delete a timeline event
   */
  async delete(eventId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('location_timeline')
      .where('event_id', '=', eventId)
      .execute();

    return result.length > 0 && Number(result[0].numDeletedRows) > 0;
  }

  /**
   * Approve a timeline event (mark as user verified)
   */
  async approve(eventId: string, userId: string): Promise<TimelineEvent | undefined> {
    const now = new Date().toISOString();

    await this.db
      .updateTable('location_timeline')
      .set({
        user_approved: 1,
        approved_at: now,
        approved_by: userId,
        updated_at: now,
        updated_by: userId,
      })
      .where('event_id', '=', eventId)
      .execute();

    return this.findById(eventId);
  }

  /**
   * Add media to an existing visit event
   * Used when importing additional photos from the same day
   */
  async addMediaToVisit(
    eventId: string,
    mediaHash: string,
    userId?: string
  ): Promise<TimelineEvent | undefined> {
    const event = await this.findById(eventId);
    if (!event || event.event_type !== 'visit') return undefined;

    const hashes: string[] = event.media_hashes
      ? JSON.parse(event.media_hashes)
      : [];

    // Don't add duplicates
    if (hashes.includes(mediaHash)) return event;

    hashes.push(mediaHash);

    return this.update(
      eventId,
      {
        media_count: hashes.length,
        media_hashes: JSON.stringify(hashes),
      },
      userId
    );
  }

  /**
   * Remove media from a visit event
   * If no media left, deletes the visit event entirely
   */
  async removeMediaFromVisit(
    eventId: string,
    mediaHash: string,
    userId?: string
  ): Promise<TimelineEvent | undefined> {
    const event = await this.findById(eventId);
    if (!event || event.event_type !== 'visit') return undefined;

    const hashes: string[] = event.media_hashes
      ? JSON.parse(event.media_hashes)
      : [];

    const filtered = hashes.filter(h => h !== mediaHash);

    // If no media left, delete the visit event
    if (filtered.length === 0) {
      await this.delete(eventId);
      return undefined;
    }

    return this.update(
      eventId,
      {
        media_count: filtered.length,
        media_hashes: JSON.stringify(filtered),
      },
      userId
    );
  }

  /**
   * Find visit event containing a specific media hash
   * Used when deleting media to update the corresponding visit
   */
  async findVisitByMediaHash(mediaHash: string): Promise<TimelineEvent | undefined> {
    // SQLite JSON search using LIKE (not ideal but works)
    const events = await this.db
      .selectFrom('location_timeline')
      .selectAll()
      .where('event_type', '=', 'visit')
      .where('media_hashes', 'like', `%${mediaHash}%`)
      .execute();

    // Verify the hash is actually in the array (LIKE can have false positives)
    for (const event of events) {
      if (event.media_hashes) {
        const hashes: string[] = JSON.parse(event.media_hashes);
        if (hashes.includes(mediaHash)) {
          return event as TimelineEvent;
        }
      }
    }

    return undefined;
  }

  /**
   * Get count of visits for a location
   */
  async getVisitCount(locid: string): Promise<number> {
    const result = await this.db
      .selectFrom('location_timeline')
      .select(({ fn }) => fn.count('event_id').as('count'))
      .where('locid', '=', locid)
      .where('event_type', '=', 'visit')
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }

  /**
   * Get the established event for a location (there should only be one)
   */
  async getEstablishedEvent(locid: string, subid?: string | null): Promise<TimelineEvent | undefined> {
    let query = this.db
      .selectFrom('location_timeline')
      .selectAll()
      .where('locid', '=', locid)
      .where('event_type', '=', 'established');

    if (subid) {
      query = query.where('subid', '=', subid);
    } else {
      query = query.where('subid', 'is', null);
    }

    const result = await query.executeTakeFirst();
    return result as TimelineEvent | undefined;
  }

  /**
   * Get the database entry event for a location
   */
  async getDatabaseEntryEvent(locid: string): Promise<TimelineEvent | undefined> {
    const result = await this.db
      .selectFrom('location_timeline')
      .selectAll()
      .where('locid', '=', locid)
      .where('event_type', '=', 'database_entry')
      .where('subid', 'is', null)
      .executeTakeFirst();

    return result as TimelineEvent | undefined;
  }

  /**
   * Find a timeline event by source_ref (for duplicate prevention)
   * Used to check if a web page event already exists for a websource
   */
  async findBySourceRef(
    sourceRef: string,
    eventType: string,
    eventSubtype?: string
  ): Promise<TimelineEvent | undefined> {
    let query = this.db
      .selectFrom('location_timeline')
      .selectAll()
      .where('source_ref', '=', sourceRef)
      .where('event_type', '=', eventType);

    if (eventSubtype) {
      query = query.where('event_subtype', '=', eventSubtype);
    }

    const result = await query.executeTakeFirst();
    return result as TimelineEvent | undefined;
  }

  /**
   * Delete timeline events by source_ref (for cascade deletion)
   * Used when a websource is deleted
   */
  async deleteBySourceRef(
    sourceRef: string,
    eventType: string,
    eventSubtype?: string
  ): Promise<number> {
    let query = this.db
      .deleteFrom('location_timeline')
      .where('source_ref', '=', sourceRef)
      .where('event_type', '=', eventType);

    if (eventSubtype) {
      query = query.where('event_subtype', '=', eventSubtype);
    }

    const result = await query.execute();
    return result.length > 0 ? Number(result[0].numDeletedRows) : 0;
  }
}
