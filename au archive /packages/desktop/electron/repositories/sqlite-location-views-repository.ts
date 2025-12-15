/**
 * Location Views Repository
 * Migration 34: Per-user view tracking
 *
 * Tracks who viewed what location and when, for analytics and future features.
 * Each view creates a new record (no deduplication by default).
 */

import { Kysely } from 'kysely';
import { generateId } from '../main/ipc-validation';
import type { Database } from '../main/database.types';

export interface LocationView {
  view_id: string;
  locid: string;
  user_id: string;
  username?: string;        // Denormalized for display
  display_name?: string;    // Denormalized for display
  viewed_at: string;
}

export interface ViewStats {
  totalViews: number;
  uniqueViewers: number;
  lastViewedAt: string | null;
  recentViewers: Array<{
    user_id: string;
    username: string;
    display_name: string | null;
    view_count: number;
    last_viewed_at: string;
  }>;
}

/**
 * Repository for tracking location views
 */
export class SQLiteLocationViewsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Record a view of a location by a user
   * Also updates the denormalized view_count and last_viewed_at on the locs table
   */
  async trackView(locid: string, user_id: string): Promise<number> {
    const now = new Date().toISOString();
    const view_id = generateId();

    // Insert the view record
    await this.db
      .insertInto('location_views')
      .values({
        view_id,
        locid,
        user_id,
        viewed_at: now,
      })
      .execute();

    // Update denormalized fields on locs table
    await this.db
      .updateTable('locs')
      .set((eb) => ({
        view_count: eb('view_count', '+', 1),
        last_viewed_at: now,
      }))
      .where('locid', '=', locid)
      .execute();

    // Return updated count
    const result = await this.db
      .selectFrom('locs')
      .select('view_count')
      .where('locid', '=', locid)
      .executeTakeFirst();

    return result?.view_count ?? 0;
  }

  /**
   * Get total view count for a location
   */
  async getViewCount(locid: string): Promise<number> {
    const result = await this.db
      .selectFrom('location_views')
      .select((eb) => eb.fn.count('view_id').as('count'))
      .where('locid', '=', locid)
      .executeTakeFirst();

    return Number(result?.count || 0);
  }

  /**
   * Get number of unique viewers for a location
   */
  async getUniqueViewerCount(locid: string): Promise<number> {
    const result = await this.db
      .selectFrom('location_views')
      .select((eb) => eb.fn.count('user_id').distinct().as('count'))
      .where('locid', '=', locid)
      .executeTakeFirst();

    return Number(result?.count || 0);
  }

  /**
   * Get view statistics for a location
   */
  async getViewStats(locid: string): Promise<ViewStats> {
    // Get total views
    const totalResult = await this.db
      .selectFrom('location_views')
      .select((eb) => eb.fn.count('view_id').as('count'))
      .where('locid', '=', locid)
      .executeTakeFirst();

    // Get unique viewers
    const uniqueResult = await this.db
      .selectFrom('location_views')
      .select((eb) => eb.fn.count('user_id').distinct().as('count'))
      .where('locid', '=', locid)
      .executeTakeFirst();

    // Get last viewed
    const lastResult = await this.db
      .selectFrom('location_views')
      .select('viewed_at')
      .where('locid', '=', locid)
      .orderBy('viewed_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    // Get recent viewers with their view counts
    const recentViewers = await this.db
      .selectFrom('location_views')
      .innerJoin('users', 'users.user_id', 'location_views.user_id')
      .select([
        'location_views.user_id',
        'users.username',
        'users.display_name',
      ])
      .select((eb) => eb.fn.count('location_views.view_id').as('view_count'))
      .select((eb) => eb.fn.max('location_views.viewed_at').as('last_viewed_at'))
      .where('location_views.locid', '=', locid)
      .where('users.is_active', '=', 1)
      .groupBy(['location_views.user_id', 'users.username', 'users.display_name'])
      .orderBy('last_viewed_at', 'desc')
      .limit(10)
      .execute();

    return {
      totalViews: Number(totalResult?.count || 0),
      uniqueViewers: Number(uniqueResult?.count || 0),
      lastViewedAt: lastResult?.viewed_at ?? null,
      recentViewers: recentViewers.map((r) => ({
        user_id: r.user_id,
        username: r.username,
        display_name: r.display_name,
        view_count: Number(r.view_count),
        last_viewed_at: r.last_viewed_at as string,
      })),
    };
  }

  /**
   * Get view history for a location (most recent first)
   */
  async getViewHistory(locid: string, limit: number = 50): Promise<LocationView[]> {
    const rows = await this.db
      .selectFrom('location_views')
      .innerJoin('users', 'users.user_id', 'location_views.user_id')
      .select([
        'location_views.view_id',
        'location_views.locid',
        'location_views.user_id',
        'location_views.viewed_at',
        'users.username',
        'users.display_name',
      ])
      .where('location_views.locid', '=', locid)
      .where('users.is_active', '=', 1)
      .orderBy('location_views.viewed_at', 'desc')
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      view_id: row.view_id,
      locid: row.locid,
      user_id: row.user_id,
      username: row.username,
      display_name: row.display_name ?? undefined,
      viewed_at: row.viewed_at,
    }));
  }

  /**
   * Get all locations viewed by a user (most recent first)
   */
  async getViewsByUser(user_id: string, limit: number = 50): Promise<LocationView[]> {
    const rows = await this.db
      .selectFrom('location_views')
      .selectAll()
      .where('user_id', '=', user_id)
      .orderBy('viewed_at', 'desc')
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      view_id: row.view_id,
      locid: row.locid,
      user_id: row.user_id,
      viewed_at: row.viewed_at,
    }));
  }

  /**
   * Get total view count for a user (across all locations)
   */
  async getUserTotalViews(user_id: string): Promise<number> {
    const result = await this.db
      .selectFrom('location_views')
      .select((eb) => eb.fn.count('view_id').as('count'))
      .where('user_id', '=', user_id)
      .executeTakeFirst();

    return Number(result?.count || 0);
  }

  /**
   * Check if user has viewed a location today (for potential deduplication)
   */
  async hasViewedToday(locid: string, user_id: string): Promise<boolean> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const result = await this.db
      .selectFrom('location_views')
      .select('view_id')
      .where('locid', '=', locid)
      .where('user_id', '=', user_id)
      .where('viewed_at', '>=', today)
      .limit(1)
      .executeTakeFirst();

    return !!result;
  }
}
