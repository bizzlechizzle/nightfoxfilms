/**
 * Timeline IPC Handlers
 * Handles timeline:* channels for location history events
 */

import { ipcMain } from 'electron';
import { Kysely } from 'kysely';
import { SqliteTimelineRepository } from '../../repositories/sqlite-timeline-repository';
import { TimelineService } from '../../services/timeline-service';
import type { Database } from '../database.types';
import type { TimelineEventInput } from '@au-archive/core';

let timelineService: TimelineService | null = null;
let timelineRepository: SqliteTimelineRepository | null = null;
let dbInstance: Kysely<Database> | null = null;

/**
 * Initialize and get the timeline service singleton
 */
function getService(db: Kysely<Database>): TimelineService {
  if (!timelineService) {
    timelineRepository = new SqliteTimelineRepository(db);
    timelineService = new TimelineService(timelineRepository);
    dbInstance = db;
  }
  return timelineService;
}

/**
 * Backfill web page timeline events for existing websources
 * Creates timeline events for websources that have extracted_date but no timeline event
 */
async function backfillWebPageTimeline(
  db: Kysely<Database>,
  service: TimelineService
): Promise<{ processed: number; created: number; skipped: number; errors: number }> {
  const stats = { processed: 0, created: 0, skipped: 0, errors: 0 };

  try {
    // Find all websources with extracted_date and locid
    const websources = await db
      .selectFrom('web_sources')
      .select(['source_id', 'locid', 'subid', 'extracted_date', 'title', 'extracted_title'])
      .where('extracted_date', 'is not', null)
      .where('locid', 'is not', null)
      .execute();

    console.log(`[Timeline Backfill] Found ${websources.length} websources with dates`);

    for (const ws of websources) {
      stats.processed++;
      try {
        // Use extracted_title if available, otherwise title
        const displayTitle = ws.extracted_title || ws.title || 'Web Page';

        const result = await service.createWebPageEvent(
          ws.locid!,
          ws.subid ?? null,
          ws.source_id,
          ws.extracted_date!,
          displayTitle
        );

        if (result) {
          stats.created++;
        } else {
          stats.skipped++;
        }
      } catch (err) {
        console.error(`[Timeline Backfill] Error for websource ${ws.source_id}:`, err);
        stats.errors++;
      }
    }

    console.log(`[Timeline Backfill] Complete: ${stats.created} created, ${stats.skipped} skipped, ${stats.errors} errors`);
  } catch (err) {
    console.error('[Timeline Backfill] Failed to run backfill:', err);
    throw err;
  }

  return stats;
}

/**
 * Register all timeline IPC handlers
 */
export function registerTimelineHandlers(db: Kysely<Database>): TimelineService {
  const service = getService(db);

  // Get timeline for location (host only, excludes sub-locations)
  ipcMain.handle('timeline:findByLocation', async (_, locid: string) => {
    return service.getTimeline(locid);
  });

  // Get timeline for a specific sub-location
  ipcMain.handle(
    'timeline:findBySubLocation',
    async (_, locid: string, subid: string) => {
      return service.getSubLocationTimeline(locid, subid);
    }
  );

  // Get combined timeline for host location (includes sub-location events)
  ipcMain.handle('timeline:findCombined', async (_, locid: string) => {
    return service.getCombinedTimeline(locid);
  });

  // Parse a date string (for smart date input)
  ipcMain.handle('timeline:parseDate', async (_, input: string) => {
    return service.parseDateInput(input);
  });

  // Create a new timeline event
  ipcMain.handle(
    'timeline:create',
    async (_, input: TimelineEventInput, userId?: string) => {
      return service.createEvent(input, userId);
    }
  );

  // Update an existing timeline event
  ipcMain.handle(
    'timeline:update',
    async (
      _,
      eventId: string,
      updates: Partial<TimelineEventInput>,
      userId?: string
    ) => {
      return service.updateEvent(eventId, updates, userId);
    }
  );

  // Delete a timeline event
  ipcMain.handle('timeline:delete', async (_, eventId: string) => {
    return service.deleteEvent(eventId);
  });

  // Approve a timeline event (user verification)
  ipcMain.handle(
    'timeline:approve',
    async (_, eventId: string, userId: string) => {
      return service.approveEvent(eventId, userId);
    }
  );

  // Initialize timeline for a new location
  ipcMain.handle(
    'timeline:initializeLocation',
    async (_, locid: string, locadd: string | null, userId?: string) => {
      return service.initializeLocationTimeline(locid, locadd, userId);
    }
  );

  // Initialize timeline for a new sub-location
  ipcMain.handle(
    'timeline:initializeSubLocation',
    async (_, locid: string, subid: string, userId?: string) => {
      return service.initializeSubLocationTimeline(locid, subid, userId);
    }
  );

  // Get visit count for a location
  ipcMain.handle('timeline:getVisitCount', async (_, locid: string) => {
    return service.getVisitCount(locid);
  });

  // Get the established event for a location
  ipcMain.handle(
    'timeline:getEstablished',
    async (_, locid: string, subid?: string | null) => {
      return service.getEstablishedEvent(locid, subid);
    }
  );

  // Update established date (smart date input)
  ipcMain.handle(
    'timeline:updateEstablished',
    async (
      _,
      locid: string,
      subid: string | null,
      dateInput: string,
      eventSubtype?: string,
      userId?: string
    ) => {
      return service.updateEstablishedDate(
        locid,
        subid,
        dateInput,
        eventSubtype || 'built',
        userId
      );
    }
  );

  // Create web page timeline event (from archived websource)
  ipcMain.handle(
    'timeline:createWebPageEvent',
    async (
      _,
      locid: string,
      subid: string | null,
      websourceId: string,
      publishDate: string,
      title: string | null,
      userId?: string
    ) => {
      return service.createWebPageEvent(locid, subid, websourceId, publishDate, title, userId);
    }
  );

  // Delete web page timeline event (cascade from websource deletion)
  ipcMain.handle(
    'timeline:deleteWebPageEvent',
    async (_, websourceId: string) => {
      return service.deleteWebPageEvent(websourceId);
    }
  );

  // Check if web page event exists for a websource
  ipcMain.handle(
    'timeline:hasWebPageEvent',
    async (_, websourceId: string) => {
      return service.hasWebPageEvent(websourceId);
    }
  );

  // Get media counts by hashes (for visit display)
  ipcMain.handle(
    'timeline:getMediaCounts',
    async (_, mediaHashesJson: string | null) => {
      if (!dbInstance || !mediaHashesJson) {
        return { images: 0, videos: 0 };
      }

      try {
        const hashes: string[] = JSON.parse(mediaHashesJson);
        if (!hashes.length) return { images: 0, videos: 0 };

        // Count images
        const imgResult = await dbInstance
          .selectFrom('imgs')
          .select(({ fn }) => fn.count('imghash').as('count'))
          .where('imghash', 'in', hashes)
          .executeTakeFirst();

        // Count videos
        const vidResult = await dbInstance
          .selectFrom('vids')
          .select(({ fn }) => fn.count('vidhash').as('count'))
          .where('vidhash', 'in', hashes)
          .executeTakeFirst();

        return {
          images: Number(imgResult?.count ?? 0),
          videos: Number(vidResult?.count ?? 0),
        };
      } catch (err) {
        console.error('[Timeline] Failed to count media:', err);
        return { images: 0, videos: 0 };
      }
    }
  );

  // Backfill web page timeline events for existing websources
  ipcMain.handle('timeline:backfillWebPages', async () => {
    if (!dbInstance) {
      throw new Error('Database not initialized');
    }
    return backfillWebPageTimeline(dbInstance, service);
  });

  // ==========================================================================
  // Multi-Source Timeline (LLM Tools Overhaul)
  // ==========================================================================

  /**
   * Get timeline events with all their sources for a location
   * Returns TimelineEventWithSources[] with source_refs parsed and enriched
   */
  ipcMain.handle('timeline:findByLocationWithSources', async (_, locid: string) => {
    if (!dbInstance) {
      return [];
    }

    try {
      // Get timeline events
      const events = await dbInstance
        .selectFrom('location_timeline')
        .selectAll()
        .where('locid', '=', locid)
        .orderBy('date_sort', 'asc')
        .execute();

      // Enrich each event with source details
      const enrichedEvents = await Promise.all(
        events.map(async (event) => {
          // Parse source_refs JSON array
          let sourceRefs: string[] = [];
          try {
            sourceRefs = event.source_refs ? JSON.parse(event.source_refs) : [];
          } catch {
            sourceRefs = [];
          }

          // Get source details for each reference
          const sources: Array<{
            source_id: string;
            source_type: string;
            domain: string | null;
            title: string | null;
            url: string | null;
          }> = [];

          for (const sourceId of sourceRefs) {
            const webSource = await dbInstance!
              .selectFrom('web_sources')
              .select(['source_id', 'domain', 'title', 'url'])
              .where('source_id', '=', sourceId)
              .executeTakeFirst();

            if (webSource) {
              sources.push({
                source_id: webSource.source_id,
                source_type: 'web',
                domain: webSource.domain,
                title: webSource.title,
                url: webSource.url,
              });
            }
          }

          // Check for conflicts (multiple sources with different dates)
          const hasConflicts = sources.length > 1;

          // Get image/video breakdown from media_hashes for visit events
          let image_count = 0;
          let video_count = 0;

          if (event.event_type === 'visit' && event.media_hashes) {
            try {
              const hashes: string[] = JSON.parse(event.media_hashes);
              for (const hash of hashes) {
                // Check if hash exists in imgs table
                const img = await dbInstance!
                  .selectFrom('imgs')
                  .select('imghash')
                  .where('imghash', '=', hash)
                  .executeTakeFirst();
                if (img) {
                  image_count++;
                  continue;
                }
                // Check if hash exists in vids table
                const vid = await dbInstance!
                  .selectFrom('vids')
                  .select('vidhash')
                  .where('vidhash', '=', hash)
                  .executeTakeFirst();
                if (vid) {
                  video_count++;
                }
              }
            } catch {
              // If parsing fails, fall back to total media_count as images
              image_count = event.media_count || 0;
            }
          }

          // For database_entry events, get the location author (who added it)
          let location_author: string | null = null;
          if (event.event_type === 'database_entry') {
            const loc = await dbInstance!
              .selectFrom('locs')
              .select('auth_imp')
              .where('locid', '=', event.locid)
              .executeTakeFirst();
            location_author = loc?.auth_imp || null;
          }

          return {
            ...event,
            sources,
            has_conflicts: hasConflicts,
            image_count,
            video_count,
            location_author,
          };
        })
      );

      return enrichedEvents;
    } catch (err) {
      console.error('[Timeline] Failed to get events with sources:', err);
      return [];
    }
  });

  /**
   * Get source details for a specific timeline event
   */
  ipcMain.handle('timeline:getSources', async (_, eventId: string) => {
    if (!dbInstance) {
      return { success: false, sources: [] };
    }

    try {
      // Get the event
      const event = await dbInstance
        .selectFrom('location_timeline')
        .select(['source_refs'])
        .where('event_id', '=', eventId)
        .executeTakeFirst();

      if (!event) {
        return { success: false, error: 'Event not found', sources: [] };
      }

      // Parse source_refs
      let sourceRefs: string[] = [];
      try {
        sourceRefs = event.source_refs ? JSON.parse(event.source_refs) : [];
      } catch {
        sourceRefs = [];
      }

      // Get source details
      const sources: Array<{
        source_id: string;
        source_type: string;
        domain: string | null;
        title: string | null;
        url: string | null;
        extracted_date: string | null;
        extracted_text: string | null;
      }> = [];

      for (const sourceId of sourceRefs) {
        const webSource = await dbInstance!
          .selectFrom('web_sources')
          .select(['source_id', 'domain', 'title', 'url', 'extracted_date', 'extracted_text'])
          .where('source_id', '=', sourceId)
          .executeTakeFirst();

        if (webSource) {
          sources.push({
            source_id: webSource.source_id,
            source_type: 'web',
            domain: webSource.domain,
            title: webSource.title,
            url: webSource.url,
            extracted_date: webSource.extracted_date,
            extracted_text: webSource.extracted_text,
          });
        }
      }

      return { success: true, sources };
    } catch (err) {
      console.error('[Timeline] Failed to get sources:', err);
      return { success: false, error: 'Failed to get sources', sources: [] };
    }
  });

  /**
   * Add a source reference to an existing timeline event
   */
  ipcMain.handle(
    'timeline:addSource',
    async (_, eventId: string, sourceId: string) => {
      if (!dbInstance) {
        return { success: false, error: 'Database not initialized' };
      }

      try {
        // Get current source_refs
        const event = await dbInstance
          .selectFrom('location_timeline')
          .select(['source_refs'])
          .where('event_id', '=', eventId)
          .executeTakeFirst();

        if (!event) {
          return { success: false, error: 'Event not found' };
        }

        // Parse and add new source
        let sourceRefs: string[] = [];
        try {
          sourceRefs = event.source_refs ? JSON.parse(event.source_refs) : [];
        } catch {
          sourceRefs = [];
        }

        if (!sourceRefs.includes(sourceId)) {
          sourceRefs.push(sourceId);

          await dbInstance
            .updateTable('location_timeline')
            .set({ source_refs: JSON.stringify(sourceRefs) })
            .where('event_id', '=', eventId)
            .execute();
        }

        return { success: true };
      } catch (err) {
        console.error('[Timeline] Failed to add source:', err);
        return { success: false, error: 'Failed to add source' };
      }
    }
  );

  /**
   * Reject/soft-delete a timeline event (marks it for review queue)
   */
  ipcMain.handle('timeline:reject', async (_, eventId: string, userId?: string) => {
    if (!dbInstance) {
      return { success: false, error: 'Database not initialized' };
    }

    try {
      await dbInstance
        .updateTable('location_timeline')
        .set({
          needs_review: 1,
          approved_by: null, // Clear approval if any
        })
        .where('event_id', '=', eventId)
        .execute();

      return { success: true };
    } catch (err) {
      console.error('[Timeline] Failed to reject event:', err);
      return { success: false, error: 'Failed to reject event' };
    }
  });

  /**
   * Get counts of timeline events for a location (for conditional visibility)
   */
  ipcMain.handle('timeline:getCounts', async (_, locid: string) => {
    if (!dbInstance) {
      return { total: 0, needsReview: 0, approved: 0 };
    }

    try {
      const result = await dbInstance
        .selectFrom('location_timeline')
        .select(({ fn }) => [
          fn.count('event_id').as('total'),
          fn.sum(fn.cast('needs_review', 'integer')).as('needs_review_count'),
        ])
        .where('locid', '=', locid)
        .executeTakeFirst();

      return {
        total: Number(result?.total ?? 0),
        needsReview: Number(result?.needs_review_count ?? 0),
        approved: Number(result?.total ?? 0) - Number(result?.needs_review_count ?? 0),
      };
    } catch (err) {
      console.error('[Timeline] Failed to get counts:', err);
      return { total: 0, needsReview: 0, approved: 0 };
    }
  });

  console.log('Timeline IPC handlers registered');
  return service;
}

/**
 * Get the timeline service instance (for use by other handlers)
 */
export function getTimelineService(): TimelineService | null {
  return timelineService;
}

/**
 * Get the timeline repository instance (for use by other handlers)
 */
export function getTimelineRepository(): SqliteTimelineRepository | null {
  return timelineRepository;
}
