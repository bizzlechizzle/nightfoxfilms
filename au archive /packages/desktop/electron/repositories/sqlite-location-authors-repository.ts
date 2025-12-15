/**
 * Location Authors Repository
 * Migration 25 - Phase 3: Author Attribution
 *
 * Manages the many-to-many relationship between locations and users,
 * tracking who has contributed to documenting each location.
 *
 * Roles:
 * - 'creator': User who created the location entry
 * - 'documenter': User who has imported media to this location
 * - 'contributor': User who has edited/improved the location metadata
 */

import { Kysely } from 'kysely';
import type { Database, LocationAuthorsTable } from '../main/database.types';

export interface LocationAuthor {
  locid: string;
  user_id: string;
  username?: string;        // Denormalized for display
  display_name?: string;    // Denormalized for display
  role: 'creator' | 'documenter' | 'contributor';
  added_at: string;
}

export interface AddAuthorInput {
  locid: string;
  user_id: string;
  role: 'creator' | 'documenter' | 'contributor';
}

/**
 * Repository for managing location authors (many-to-many relationship)
 */
export class SQLiteLocationAuthorsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Add an author to a location
   * If the user is already an author with a different role, update their role
   * If already an author with same role, no-op (idempotent)
   */
  async addAuthor(input: AddAuthorInput): Promise<void> {
    const now = new Date().toISOString();

    // Check if user is already an author for this location
    const existing = await this.db
      .selectFrom('location_authors')
      .select(['locid', 'user_id', 'role'])
      .where('locid', '=', input.locid)
      .where('user_id', '=', input.user_id)
      .executeTakeFirst();

    if (existing) {
      // If role is different and new role has higher priority, update
      // Priority: creator > documenter > contributor
      const rolePriority: Record<string, number> = {
        'creator': 3,
        'documenter': 2,
        'contributor': 1,
      };

      if (rolePriority[input.role] > rolePriority[existing.role]) {
        await this.db
          .updateTable('location_authors')
          .set({ role: input.role, added_at: now })
          .where('locid', '=', input.locid)
          .where('user_id', '=', input.user_id)
          .execute();
      }
      // If same or lower priority role, do nothing (idempotent)
      return;
    }

    // Insert new author
    await this.db
      .insertInto('location_authors')
      .values({
        locid: input.locid,
        user_id: input.user_id,
        role: input.role,
        added_at: now,
      })
      .execute();
  }

  /**
   * Remove an author from a location
   */
  async removeAuthor(locid: string, user_id: string): Promise<void> {
    await this.db
      .deleteFrom('location_authors')
      .where('locid', '=', locid)
      .where('user_id', '=', user_id)
      .execute();
  }

  /**
   * Get all authors for a location (with user details)
   */
  async findByLocation(locid: string): Promise<LocationAuthor[]> {
    const rows = await this.db
      .selectFrom('location_authors')
      .innerJoin('users', 'users.user_id', 'location_authors.user_id')
      .select([
        'location_authors.locid',
        'location_authors.user_id',
        'location_authors.role',
        'location_authors.added_at',
        'users.username',
        'users.display_name',
      ])
      .where('location_authors.locid', '=', locid)
      .where('users.is_active', '=', 1)
      .orderBy('location_authors.added_at', 'asc')
      .execute();

    return rows.map((row) => ({
      locid: row.locid,
      user_id: row.user_id,
      username: row.username,
      display_name: row.display_name ?? undefined,
      role: row.role as 'creator' | 'documenter' | 'contributor',
      added_at: row.added_at,
    }));
  }

  /**
   * Get all locations a user has contributed to
   */
  async findByUser(user_id: string): Promise<LocationAuthor[]> {
    const rows = await this.db
      .selectFrom('location_authors')
      .selectAll()
      .where('user_id', '=', user_id)
      .orderBy('added_at', 'desc')
      .execute();

    return rows.map((row) => ({
      locid: row.locid,
      user_id: row.user_id,
      role: row.role as 'creator' | 'documenter' | 'contributor',
      added_at: row.added_at,
    }));
  }

  /**
   * Get the creator of a location (if any)
   */
  async findCreator(locid: string): Promise<LocationAuthor | null> {
    const row = await this.db
      .selectFrom('location_authors')
      .innerJoin('users', 'users.user_id', 'location_authors.user_id')
      .select([
        'location_authors.locid',
        'location_authors.user_id',
        'location_authors.role',
        'location_authors.added_at',
        'users.username',
        'users.display_name',
      ])
      .where('location_authors.locid', '=', locid)
      .where('location_authors.role', '=', 'creator')
      .where('users.is_active', '=', 1)
      .executeTakeFirst();

    if (!row) return null;

    return {
      locid: row.locid,
      user_id: row.user_id,
      username: row.username,
      display_name: row.display_name ?? undefined,
      role: 'creator',
      added_at: row.added_at,
    };
  }

  /**
   * Get count of locations a user has contributed to, by role
   */
  async countByUserAndRole(user_id: string): Promise<Record<string, number>> {
    const rows = await this.db
      .selectFrom('location_authors')
      .select(['role'])
      .select((eb) => eb.fn.count('locid').as('count'))
      .where('user_id', '=', user_id)
      .groupBy('role')
      .execute();

    const counts: Record<string, number> = {
      creator: 0,
      documenter: 0,
      contributor: 0,
    };

    for (const row of rows) {
      counts[row.role] = Number(row.count);
    }

    return counts;
  }

  /**
   * Get count of unique contributors to a location
   */
  async countByLocation(locid: string): Promise<number> {
    const result = await this.db
      .selectFrom('location_authors')
      .select((eb) => eb.fn.count('user_id').as('count'))
      .where('locid', '=', locid)
      .executeTakeFirst();

    return Number(result?.count || 0);
  }

  /**
   * Automatically add/upgrade author role when user performs an action
   * Call this from IPC handlers when creating/importing/editing
   */
  async trackUserContribution(
    locid: string,
    user_id: string,
    action: 'create' | 'import' | 'edit'
  ): Promise<void> {
    const roleMap: Record<string, 'creator' | 'documenter' | 'contributor'> = {
      create: 'creator',
      import: 'documenter',
      edit: 'contributor',
    };

    await this.addAuthor({
      locid,
      user_id,
      role: roleMap[action],
    });
  }
}
