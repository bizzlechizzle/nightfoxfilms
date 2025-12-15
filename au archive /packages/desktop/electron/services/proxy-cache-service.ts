/**
 * ProxyCacheService - Manage video proxy statistics
 *
 * OPT-053 Immich Model:
 * - Proxies are now permanent (no purge)
 * - Proxies stored alongside originals (not in cache directory)
 * - Most functions deprecated but kept for backwards compatibility
 */
import type { Kysely } from 'kysely';
import type { Database } from '../main/database.types';

export interface CacheStats {
  totalCount: number;
  totalSizeBytes: number;
  totalSizeMB: number;
  oldestAccess: string | null;  // Deprecated but kept for type compat
  newestAccess: string | null;  // Deprecated but kept for type compat
}

export interface PurgeResult {
  deleted: number;
  freedBytes: number;
  freedMB: number;
}

/**
 * Get proxy statistics from database.
 * Still useful for displaying proxy count and total size.
 */
export async function getCacheStats(db: Kysely<Database>): Promise<CacheStats> {
  const result = await db
    .selectFrom('video_proxies')
    .select(({ fn }) => [
      fn.count<number>('vidhash').as('count'),
      fn.sum<number>('file_size_bytes').as('size'),
      fn.min<string>('generated_at').as('oldest'),
      fn.max<string>('generated_at').as('newest')
    ])
    .executeTakeFirst();

  const totalCount = Number(result?.count || 0);
  const totalSizeBytes = Number(result?.size || 0);

  return {
    totalCount,
    totalSizeBytes,
    totalSizeMB: Math.round(totalSizeBytes / 1024 / 1024 * 10) / 10,
    // OPT-053: Using generated_at instead of deprecated last_accessed
    oldestAccess: result?.oldest || null,
    newestAccess: result?.newest || null
  };
}

/**
 * Get videos in a location that don't have proxies yet.
 * Still useful for migration/repair of old imports.
 */
export async function getVideosNeedingProxies(
  db: Kysely<Database>,
  locid: string
): Promise<Array<{
  vidhash: string;
  vidloc: string;
  meta_width: number | null;
  meta_height: number | null;
}>> {
  // Use subquery to find videos without proxy records
  const videos = await db
    .selectFrom('vids')
    .leftJoin('video_proxies', 'vids.vidhash', 'video_proxies.vidhash')
    .select(['vids.vidhash', 'vids.vidloc', 'vids.meta_width', 'vids.meta_height'])
    .where('vids.locid', '=', locid)
    .where('video_proxies.vidhash', 'is', null)
    .execute();

  return videos;
}

// ============================================================
// DEPRECATED FUNCTIONS - OPT-053
// Kept for backwards compatibility but now no-ops
// ============================================================

/**
 * @deprecated OPT-053: Proxies are permanent, purge no longer needed
 */
export async function purgeOldProxies(): Promise<PurgeResult> {
  console.log('[ProxyCache] purgeOldProxies is DEPRECATED per OPT-053');
  return { deleted: 0, freedBytes: 0, freedMB: 0 };
}

/**
 * @deprecated OPT-053: Proxies are permanent, clear no longer needed
 */
export async function clearAllProxies(): Promise<PurgeResult> {
  console.log('[ProxyCache] clearAllProxies is DEPRECATED per OPT-053');
  return { deleted: 0, freedBytes: 0, freedMB: 0 };
}

/**
 * @deprecated OPT-053: No last_accessed tracking, touch no longer needed
 */
export async function touchLocationProxies(): Promise<number> {
  console.log('[ProxyCache] touchLocationProxies is DEPRECATED per OPT-053');
  return 0;
}
