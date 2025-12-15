/**
 * User Service
 * OPT-031: Consolidated user lookup to avoid code duplication
 * Provides cached access to current user settings
 */

import type { Kysely } from 'kysely';
import type { Database } from '../main/database.types';

export interface CurrentUser {
  userId: string;
  username: string;
}

// OPT-031: Cache the current user to avoid repeated DB queries
let cachedUser: CurrentUser | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Get the current user from settings
 * @param db Database connection
 * @param skipCache Force fresh lookup (default: false)
 * @returns Current user info or null if not set
 */
export async function getCurrentUser(
  db: Kysely<Database>,
  skipCache = false
): Promise<CurrentUser | null> {
  // Return cached value if still valid
  const now = Date.now();
  if (!skipCache && cachedUser && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedUser;
  }

  try {
    const userIdRow = await db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'current_user_id')
      .executeTakeFirst();

    const usernameRow = await db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'current_user')
      .executeTakeFirst();

    if (userIdRow?.value && usernameRow?.value) {
      cachedUser = { userId: userIdRow.value, username: usernameRow.value };
      cacheTimestamp = now;
      return cachedUser;
    }

    // Clear cache if no user found
    cachedUser = null;
    return null;
  } catch (error) {
    console.warn('[UserService] Failed to get current user:', error);
    return null;
  }
}

/**
 * Clear the user cache (call when user changes)
 */
export function clearUserCache(): void {
  cachedUser = null;
  cacheTimestamp = 0;
}
