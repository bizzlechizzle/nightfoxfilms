/**
 * Stats and Settings IPC Handlers
 * Handles stats:* and settings:* IPC channels
 * Migration 25 - Phase 4: Per-user stats for Nerd Stats integration
 * ADR-049: Updated userId validation to unified 16-char hex
 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';
import { validate, LimitSchema, SettingKeySchema, UserIdSchema } from '../ipc-validation';
import { SQLiteLocationAuthorsRepository } from '../../repositories/sqlite-location-authors-repository';

export function registerStatsHandlers(db: Kysely<Database>) {
  // Migration 25 - Phase 4: Location authors repository for user stats
  const authorsRepo = new SQLiteLocationAuthorsRepository(db);

  ipcMain.handle('stats:topStates', async (_event, limit: unknown = 5) => {
    try {
      const validatedLimit = validate(LimitSchema, limit);
      const result = await db
        .selectFrom('locs')
        .select(['address_state as state', (eb) => eb.fn.count('locid').as('count')])
        .where('address_state', 'is not', null)
        .groupBy('address_state')
        .orderBy('count', 'desc')
        .limit(validatedLimit ?? 5)
        .execute();
      return result;
    } catch (error) {
      console.error('Error getting top states:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('stats:topCategories', async (_event, limit: unknown = 5) => {
    try {
      const validatedLimit = validate(LimitSchema, limit);
      const result = await db
        .selectFrom('locs')
        .select(['category', (eb) => eb.fn.count('locid').as('count')])
        .where('category', 'is not', null)
        .groupBy('category')
        .orderBy('count', 'desc')
        .limit(validatedLimit ?? 5)
        .execute();
      return result;
    } catch (error) {
      console.error('Error getting top categories:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Dashboard: Top categories with hero thumbnail from a representative location
   */
  ipcMain.handle('stats:topCategoriesWithHero', async (_event, limit: unknown = 5) => {
    try {
      const validatedLimit = validate(LimitSchema, limit);
      // Get top categories with count
      const categories = await db
        .selectFrom('locs')
        .select(['category', (eb) => eb.fn.count('locid').as('count')])
        .where('category', 'is not', null)
        .groupBy('category')
        .orderBy('count', 'desc')
        .limit(validatedLimit ?? 5)
        .execute();

      // For each category, get a representative location's hero image
      const results = await Promise.all(
        categories.map(async (c) => {
          // Find a location with hero image for this category
          const loc = await db
            .selectFrom('locs')
            .select(['locid', 'hero_imghash'])
            .where('category', '=', c.category)
            .where('hero_imghash', 'is not', null)
            .limit(1)
            .executeTakeFirst();

          let heroThumbPath: string | undefined;
          if (loc?.hero_imghash) {
            const img = await db
              .selectFrom('imgs')
              .select(['thumb_path_sm', 'thumb_path_lg', 'thumb_path'])
              .where('imghash', '=', loc.hero_imghash)
              .executeTakeFirst();
            heroThumbPath = img?.thumb_path_sm || img?.thumb_path_lg || img?.thumb_path || undefined;
          }

          return {
            category: c.category,
            count: Number(c.count),
            heroThumbPath,
          };
        })
      );

      return results;
    } catch (error) {
      console.error('Error getting top categories with hero:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Dashboard: Top states with hero thumbnail from a representative location
   */
  ipcMain.handle('stats:topStatesWithHero', async (_event, limit: unknown = 5) => {
    try {
      const validatedLimit = validate(LimitSchema, limit);
      // Get top states with count
      const states = await db
        .selectFrom('locs')
        .select(['address_state as state', (eb) => eb.fn.count('locid').as('count')])
        .where('address_state', 'is not', null)
        .groupBy('address_state')
        .orderBy('count', 'desc')
        .limit(validatedLimit ?? 5)
        .execute();

      // For each state, get a representative location's hero image
      const results = await Promise.all(
        states.map(async (s) => {
          // Find a location with hero image for this state
          const loc = await db
            .selectFrom('locs')
            .select(['locid', 'hero_imghash'])
            .where('address_state', '=', s.state)
            .where('hero_imghash', 'is not', null)
            .limit(1)
            .executeTakeFirst();

          let heroThumbPath: string | undefined;
          if (loc?.hero_imghash) {
            const img = await db
              .selectFrom('imgs')
              .select(['thumb_path_sm', 'thumb_path_lg', 'thumb_path'])
              .where('imghash', '=', loc.hero_imghash)
              .executeTakeFirst();
            heroThumbPath = img?.thumb_path_sm || img?.thumb_path_lg || img?.thumb_path || undefined;
          }

          return {
            state: s.state,
            count: Number(s.count),
            heroThumbPath,
          };
        })
      );

      return results;
    } catch (error) {
      console.error('Error getting top states with hero:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ==================== Migration 25 - Phase 4: Per-User Stats ====================

  /**
   * Get contribution stats for a specific user
   * Returns locations created, documented, and contributed to
   */
  ipcMain.handle('stats:userContributions', async (_event, userId: unknown) => {
    try {
      const validatedUserId = UserIdSchema.parse(userId);

      // Get role counts from location_authors
      const roleCounts = await authorsRepo.countByUserAndRole(validatedUserId);

      // Get media counts imported by this user
      const [imageCount, videoCount, docCount] = await Promise.all([
        db.selectFrom('imgs')
          .select((eb) => eb.fn.count('imghash').as('count'))
          .where('imported_by_id', '=', validatedUserId)
          .executeTakeFirst(),
        db.selectFrom('vids')
          .select((eb) => eb.fn.count('vidhash').as('count'))
          .where('imported_by_id', '=', validatedUserId)
          .executeTakeFirst(),
        db.selectFrom('docs')
          .select((eb) => eb.fn.count('dochash').as('count'))
          .where('imported_by_id', '=', validatedUserId)
          .executeTakeFirst(),
      ]);

      return {
        locationsCreated: roleCounts.creator || 0,
        locationsDocumented: roleCounts.documenter || 0,
        locationsContributed: roleCounts.contributor || 0,
        totalLocationsInvolved: (roleCounts.creator || 0) + (roleCounts.documenter || 0) + (roleCounts.contributor || 0),
        imagesImported: Number(imageCount?.count || 0),
        videosImported: Number(videoCount?.count || 0),
        documentsImported: Number(docCount?.count || 0),
        totalMediaImported: Number(imageCount?.count || 0) + Number(videoCount?.count || 0) + Number(docCount?.count || 0),
      };
    } catch (error) {
      console.error('Error getting user contributions:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get top contributors by role
   * Returns users with most contributions of each type
   */
  ipcMain.handle('stats:topContributors', async (_event, limit: unknown = 5) => {
    try {
      const validatedLimit = validate(LimitSchema, limit);

      // Get top creators
      const topCreators = await db
        .selectFrom('location_authors')
        .innerJoin('users', 'users.user_id', 'location_authors.user_id')
        .select([
          'users.user_id',
          'users.username',
          'users.display_name',
          (eb) => eb.fn.count('location_authors.locid').as('count'),
        ])
        .where('location_authors.role', '=', 'creator')
        .where('users.is_active', '=', 1)
        .groupBy(['users.user_id', 'users.username', 'users.display_name'])
        .orderBy('count', 'desc')
        .limit(validatedLimit ?? 10)
        .execute();

      // Get top documenters
      const topDocumenters = await db
        .selectFrom('location_authors')
        .innerJoin('users', 'users.user_id', 'location_authors.user_id')
        .select([
          'users.user_id',
          'users.username',
          'users.display_name',
          (eb) => eb.fn.count('location_authors.locid').as('count'),
        ])
        .where('location_authors.role', '=', 'documenter')
        .where('users.is_active', '=', 1)
        .groupBy(['users.user_id', 'users.username', 'users.display_name'])
        .orderBy('count', 'desc')
        .limit(validatedLimit ?? 10)
        .execute();

      // Get top media importers (by total media count)
      const topImporters = await db
        .selectFrom('users')
        .leftJoin('imgs', 'imgs.imported_by_id', 'users.user_id')
        .select([
          'users.user_id',
          'users.username',
          'users.display_name',
          (eb) => eb.fn.count('imgs.imghash').as('count'),
        ])
        .where('users.is_active', '=', 1)
        .groupBy(['users.user_id', 'users.username', 'users.display_name'])
        .having((eb) => eb.fn.count('imgs.imghash'), '>', 0)
        .orderBy('count', 'desc')
        .limit(validatedLimit ?? 10)
        .execute();

      return {
        topCreators: topCreators.map((r) => ({
          userId: r.user_id,
          username: r.username,
          displayName: r.display_name,
          count: Number(r.count),
        })),
        topDocumenters: topDocumenters.map((r) => ({
          userId: r.user_id,
          username: r.username,
          displayName: r.display_name,
          count: Number(r.count),
        })),
        topImporters: topImporters.map((r) => ({
          userId: r.user_id,
          username: r.username,
          displayName: r.display_name,
          count: Number(r.count),
        })),
      };
    } catch (error) {
      console.error('Error getting top contributors:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Get all users with their contribution summary
   * For displaying in Nerd Stats leaderboard
   */
  ipcMain.handle('stats:allUserStats', async () => {
    try {
      // Get all active users
      const users = await db
        .selectFrom('users')
        .selectAll()
        .where('is_active', '=', 1)
        .orderBy('username', 'asc')
        .execute();

      // Get stats for each user
      const userStats = await Promise.all(
        users.map(async (user) => {
          const roleCounts = await authorsRepo.countByUserAndRole(user.user_id);

          const [imageCount, videoCount, docCount] = await Promise.all([
            db.selectFrom('imgs')
              .select((eb) => eb.fn.count('imghash').as('count'))
              .where('imported_by_id', '=', user.user_id)
              .executeTakeFirst(),
            db.selectFrom('vids')
              .select((eb) => eb.fn.count('vidhash').as('count'))
              .where('imported_by_id', '=', user.user_id)
              .executeTakeFirst(),
            db.selectFrom('docs')
              .select((eb) => eb.fn.count('dochash').as('count'))
              .where('imported_by_id', '=', user.user_id)
              .executeTakeFirst(),
          ]);

          return {
            userId: user.user_id,
            username: user.username,
            displayName: user.display_name,
            locationsCreated: roleCounts.creator || 0,
            locationsDocumented: roleCounts.documenter || 0,
            locationsContributed: roleCounts.contributor || 0,
            mediaImported: Number(imageCount?.count || 0) + Number(videoCount?.count || 0) + Number(docCount?.count || 0),
            lastLogin: user.last_login,
          };
        })
      );

      return userStats;
    } catch (error) {
      console.error('Error getting all user stats:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });
}

export function registerSettingsHandlers(db: Kysely<Database>) {
  ipcMain.handle('settings:get', async (_event, key: unknown) => {
    try {
      const validatedKey = z.string().min(1).parse(key);
      const result = await db
        .selectFrom('settings')
        .select('value')
        .where('key', '=', validatedKey)
        .executeTakeFirst();
      return result?.value ?? null;
    } catch (error) {
      console.error('Error getting setting:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('settings:getAll', async () => {
    try {
      const results = await db
        .selectFrom('settings')
        .selectAll()
        .execute();
      return results.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {} as Record<string, string>);
    } catch (error) {
      console.error('Error getting all settings:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('settings:set', async (_event, key: unknown, value: unknown) => {
    try {
      const validatedKey = SettingKeySchema.parse(key);
      const validatedValue = z.string().parse(value);
      await db
        .insertInto('settings')
        .values({ key: validatedKey, value: validatedValue })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: validatedValue }))
        .execute();
    } catch (error) {
      console.error('Error setting value:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });
}

// Kanye11: Libpostal status handler
import { checkLibpostalStatus, parseAddressWithLibpostal } from '../../services/address-normalizer';

export function registerLibpostalHandlers() {
  // Check libpostal availability
  ipcMain.handle('address:libpostalStatus', async () => {
    return checkLibpostalStatus();
  });

  // Parse address using libpostal (or fallback)
  ipcMain.handle('address:parse', async (_event, address: unknown) => {
    try {
      const validatedAddress = z.string().min(1).parse(address);
      return parseAddressWithLibpostal(validatedAddress);
    } catch (error) {
      console.error('Error parsing address:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => e.message).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });
}
