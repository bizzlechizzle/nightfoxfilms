import { Kysely } from 'kysely';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Database, SlocsTable } from '../main/database.types';
import { MediaPathService } from '../services/media-path-service';
import { getLogger } from '../services/logger-service';
import { generateSubLocationId } from '../services/crypto-service';

/**
 * SubLocation entity for application use
 * ADR-046: subid is now BLAKE3 16-char hash (no separate sub12)
 */
export interface SubLocation {
  subid: string;
  locid: string;
  subnam: string;
  ssubname: string | null;
  category: string | null;
  // Migration 65: Sub-location class (separate taxonomy from host locations)
  class: string | null;
  status: string | null;
  hero_imghash: string | null;
  hero_focal_x: number;
  hero_focal_y: number;
  is_primary: boolean;
  created_date: string;
  created_by: string | null;
  modified_date: string | null;
  modified_by: string | null;
  // Migration 31: Sub-location GPS (separate from host location)
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  gps_source: string | null;
  gps_verified_on_map: boolean;
  gps_captured_at: string | null;
  // Migration 32: AKA name (historicalName removed)
  akanam: string | null;
}

/**
 * GPS data for updating sub-location coordinates
 */
export interface SubLocationGpsInput {
  lat: number;
  lng: number;
  accuracy?: number | null;
  source: string;  // 'user_map_click', 'photo_exif', 'manual_entry'
}

/**
 * Input for creating a new sub-location
 */
export interface CreateSubLocationInput {
  locid: string;
  subnam: string;
  ssubname?: string | null;
  category?: string | null;
  // Migration 65: Sub-location class
  class?: string | null;
  status?: string | null;
  is_primary?: boolean;
  created_by?: string | null;
}

/**
 * Input for updating a sub-location
 */
export interface UpdateSubLocationInput {
  subnam?: string;
  ssubname?: string | null;
  category?: string | null;
  // Migration 65: Sub-location class
  class?: string | null;
  status?: string | null;
  hero_imghash?: string | null;
  hero_focal_x?: number;
  hero_focal_y?: number;
  is_primary?: boolean;
  modified_by?: string | null;
  // Migration 32: AKA name (historicalName removed)
  akanam?: string | null;
}

/**
 * Generate short sub-location name (12 chars max)
 */
function generateShortName(name: string): string {
  // Remove common prefixes/suffixes and truncate
  const shortened = name
    .replace(/^(The|A|An)\s+/i, '')
    .replace(/\s+(Building|House|Hall|Center|Centre)$/i, '')
    .substring(0, 12)
    .trim();
  return shortened || name.substring(0, 12);
}

/**
 * SQLite repository for sub-locations
 */
export class SQLiteSubLocationRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Create a new sub-location
   * OPT-001: Wrapped in transaction to ensure atomicity
   * ADR-046: Uses BLAKE3 16-char hash for subid (no separate sub12)
   */
  async create(input: CreateSubLocationInput): Promise<SubLocation> {
    const subid = generateSubLocationId();
    const ssubname = input.ssubname || generateShortName(input.subnam);
    const created_date = new Date().toISOString();

    // Use transaction to ensure all operations succeed or all fail
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('slocs')
        .values({
          subid,
          locid: input.locid,
          subnam: input.subnam,
          ssubname,
          category: input.category || null,
          // Migration 65: Sub-location class
          class: input.class || null,
          status: input.status || null,
          hero_imghash: null,
          hero_focal_x: 0.5,
          hero_focal_y: 0.5,
          is_primary: input.is_primary ? 1 : 0,
          created_date,
          created_by: input.created_by || null,
          modified_date: null,
          modified_by: null,
          // Migration 31: GPS fields (all null on creation)
          gps_lat: null,
          gps_lng: null,
          gps_accuracy: null,
          gps_source: null,
          gps_verified_on_map: 0,
          gps_captured_at: null,
          // Migration 32: AKA name (historicalName removed)
          akanam: null,
          // Migration 56 (OPT-093): Sub-location stats (all start at 0)
          img_count: 0,
          vid_count: 0,
          doc_count: 0,
          map_count: 0,
          total_size_bytes: 0,
          earliest_media_date: null,
          latest_media_date: null,
          stats_updated_at: null,
          // Migration 56 (OPT-093): Sub-location BagIt
          bag_status: null,
          bag_last_verified: null,
          bag_last_error: null,
        })
        .execute();

      // Update parent location's sublocs JSON array
      const parent = await trx
        .selectFrom('locs')
        .select('sublocs')
        .where('locid', '=', input.locid)
        .executeTakeFirst();

      const currentSublocs: string[] = parent?.sublocs ? JSON.parse(parent.sublocs) : [];
      if (!currentSublocs.includes(subid)) {
        currentSublocs.push(subid);
        await trx
          .updateTable('locs')
          .set({ sublocs: JSON.stringify(currentSublocs) })
          .where('locid', '=', input.locid)
          .execute();
      }
    });

    return {
      subid,
      locid: input.locid,
      subnam: input.subnam,
      ssubname,
      category: input.category || null,
      // Migration 65: Sub-location class
      class: input.class || null,
      status: input.status || null,
      hero_imghash: null,
      hero_focal_x: 0.5,
      hero_focal_y: 0.5,
      is_primary: input.is_primary || false,
      created_date,
      created_by: input.created_by || null,
      modified_date: null,
      modified_by: null,
      // Migration 31: GPS fields (all null on creation)
      gps_lat: null,
      gps_lng: null,
      gps_accuracy: null,
      gps_source: null,
      gps_verified_on_map: false,
      gps_captured_at: null,
      // Migration 32: AKA name (historicalName removed)
      akanam: null,
    };
  }

  /**
   * Find sub-location by ID
   */
  async findById(subid: string): Promise<SubLocation | null> {
    const row = await this.db
      .selectFrom('slocs')
      .selectAll()
      .where('subid', '=', subid)
      .executeTakeFirst();

    return row ? this.mapRowToSubLocation(row) : null;
  }

  /**
   * Find all sub-locations for a parent location
   */
  async findByLocationId(locid: string): Promise<SubLocation[]> {
    const rows = await this.db
      .selectFrom('slocs')
      .selectAll()
      .where('locid', '=', locid)
      .orderBy('is_primary', 'desc')
      .orderBy('subnam', 'asc')
      .execute();

    return rows.map(row => this.mapRowToSubLocation(row));
  }

  /**
   * Update a sub-location
   */
  async update(subid: string, input: UpdateSubLocationInput): Promise<SubLocation | null> {
    const existing = await this.findById(subid);
    if (!existing) return null;

    const modified_date = new Date().toISOString();

    const updateValues: Record<string, unknown> = {
      modified_date,
      modified_by: input.modified_by || null,
    };

    if (input.subnam !== undefined) updateValues.subnam = input.subnam;
    if (input.ssubname !== undefined) updateValues.ssubname = input.ssubname;
    if (input.category !== undefined) updateValues.category = input.category;
    // Migration 65: Sub-location class
    if (input.class !== undefined) updateValues.class = input.class;
    if (input.status !== undefined) updateValues.status = input.status;
    if (input.hero_imghash !== undefined) updateValues.hero_imghash = input.hero_imghash;
    if (input.hero_focal_x !== undefined) updateValues.hero_focal_x = input.hero_focal_x;
    if (input.hero_focal_y !== undefined) updateValues.hero_focal_y = input.hero_focal_y;
    if (input.is_primary !== undefined) updateValues.is_primary = input.is_primary ? 1 : 0;
    if (input.akanam !== undefined) updateValues.akanam = input.akanam;
    // historicalName removed

    await this.db
      .updateTable('slocs')
      .set(updateValues)
      .where('subid', '=', subid)
      .execute();

    // If setting as primary, update parent and clear other primaries
    if (input.is_primary) {
      await this.setPrimary(existing.locid, subid);
    }

    return this.findById(subid);
  }

  /**
   * Delete a sub-location with cascade delete of all associated media
   * OPT-093: Full cascade delete mirroring location delete behavior
   * ADR-046: Updated folder paths for new structure (locations/[STATE]/[LOCID]/data/sloc-[SUBID]/)
   *
   * Cascade deletes:
   * - All images with this subid
   * - All videos with this subid
   * - All documents with this subid
   * - All maps with this subid
   * - Physical media files from disk
   * - Thumbnails, previews, posters, video proxies
   */
  async delete(subid: string): Promise<void> {
    const logger = getLogger();
    const existing = await this.findById(subid);
    if (!existing) return;

    // 1. Get parent location for folder path construction
    // ADR-046: Only need locid and address_state for new folder structure
    const parentLocation = await this.db
      .selectFrom('locs')
      .select(['locid', 'locnam', 'address_state'])
      .where('locid', '=', existing.locid)
      .executeTakeFirst();

    // 2. Collect all media hashes for this sub-location
    const imgHashes = await this.db
      .selectFrom('imgs')
      .select(['imghash as hash', 'imgloc as path'])
      .where('subid', '=', subid)
      .execute();

    const vidHashes = await this.db
      .selectFrom('vids')
      .select(['vidhash as hash', 'vidloc as path'])
      .where('subid', '=', subid)
      .execute();

    const docHashes = await this.db
      .selectFrom('docs')
      .select(['dochash as hash', 'docloc as path'])
      .where('subid', '=', subid)
      .execute();

    const mapHashes = await this.db
      .selectFrom('maps')
      .select(['maphash as hash', 'maploc as path'])
      .where('subid', '=', subid)
      .execute();

    // Combine with type annotations
    const mediaHashes: Array<{ hash: string; type: 'img' | 'vid' | 'doc' | 'map'; path?: string }> = [
      ...imgHashes.map(r => ({ hash: r.hash, type: 'img' as const, path: r.path ?? undefined })),
      ...vidHashes.map(r => ({ hash: r.hash, type: 'vid' as const, path: r.path ?? undefined })),
      ...docHashes.map(r => ({ hash: r.hash, type: 'doc' as const, path: r.path ?? undefined })),
      ...mapHashes.map(r => ({ hash: r.hash, type: 'map' as const, path: r.path ?? undefined })),
    ];

    // 3. Get video proxy paths
    const videoHashes = mediaHashes.filter(m => m.type === 'vid').map(m => m.hash);
    const proxyPaths: string[] = [];
    if (videoHashes.length > 0) {
      const proxies = await this.db
        .selectFrom('video_proxies')
        .select('proxy_path')
        .where('vidhash', 'in', videoHashes)
        .execute();
      proxyPaths.push(...proxies.map(p => p.proxy_path).filter((p): p is string => !!p));
    }

    // 4. Audit log BEFORE deletion
    // ADR-046: Removed sub12 from audit log (subid is the only ID now)
    logger.info('SubLocationRepository', 'DELETION AUDIT: Deleting sub-location with files', {
      subid,
      locid: existing.locid,
      subnam: existing.subnam,
      is_primary: existing.is_primary,
      media_count: mediaHashes.length,
      video_proxies: proxyPaths.length,
      deleted_at: new Date().toISOString(),
    });

    // 5. Delete DB records (cascade will handle video_proxies via trigger)
    // Delete media records first (they reference slocs)
    await this.db.deleteFrom('imgs').where('subid', '=', subid).execute();
    await this.db.deleteFrom('vids').where('subid', '=', subid).execute();
    await this.db.deleteFrom('docs').where('subid', '=', subid).execute();
    await this.db.deleteFrom('maps').where('subid', '=', subid).execute();

    // Delete the sub-location record
    await this.db.deleteFrom('slocs').where('subid', '=', subid).execute();

    // Remove from parent location's sublocs array
    await this.removeFromParentSublocs(existing.locid, subid);

    // ADR-046: No need to clear parent's sub12 - that field no longer exists

    // 6. Background file cleanup (non-blocking for instant UI response)
    const archivePath = await this.getArchivePath();

    setImmediate(async () => {
      try {
        // 6a. Delete sub-location folder if it exists
        // ADR-046 Folder structure: [archive]/locations/[STATE]/[LOCID]/data/sloc-[SUBID]/
        if (archivePath && parentLocation) {
          const state = parentLocation.address_state?.toUpperCase() || 'XX';

          // Sub-location folder: sloc-[SUBID]/ inside parent's data folder
          const subLocationFolder = path.join(
            archivePath,
            'locations',
            state,
            parentLocation.locid,
            'data',
            `sloc-${subid}`
          );

          try {
            await fs.rm(subLocationFolder, { recursive: true, force: true });
            logger.info('SubLocationRepository', `Deleted sub-location folder: ${subLocationFolder}`);
          } catch {
            // Folder might not exist
          }
        }

        // 6b. Delete thumbnails/previews/posters by hash
        if (archivePath && mediaHashes.length > 0) {
          const mediaPathService = new MediaPathService(archivePath);

          for (const { hash, type } of mediaHashes) {
            // Thumbnails (all sizes including legacy)
            for (const size of [400, 800, 1920, undefined] as const) {
              const thumbPath = mediaPathService.getThumbnailPath(hash, size as 400 | 800 | 1920 | undefined);
              await fs.unlink(thumbPath).catch(() => {});
            }

            // Previews (images/RAW only)
            if (type === 'img') {
              const previewPath = mediaPathService.getPreviewPath(hash);
              await fs.unlink(previewPath).catch(() => {});
            }

            // Posters (videos only)
            if (type === 'vid') {
              const posterPath = mediaPathService.getPosterPath(hash);
              await fs.unlink(posterPath).catch(() => {});
            }
          }
        }

        // 6c. Delete video proxies
        for (const proxyPath of proxyPaths) {
          await fs.unlink(proxyPath).catch(() => {});
        }

        logger.info('SubLocationRepository', `File cleanup complete for sub-location ${subid}`);
      } catch (err) {
        logger.warn('SubLocationRepository', `Background file cleanup error for ${subid}`, {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    });
  }

  /**
   * Get archive path from settings
   */
  private async getArchivePath(): Promise<string | null> {
    const result = await this.db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'archive_path')
      .executeTakeFirst();

    // Try both keys (archive_path and archive_folder)
    if (result?.value) return result.value;

    const altResult = await this.db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'archive_folder')
      .executeTakeFirst();

    return altResult?.value || null;
  }

  /**
   * Set a sub-location as primary for its parent
   * ADR-046: Removed sub12 tracking on parent - no longer needed
   */
  async setPrimary(locid: string, subid: string): Promise<void> {
    // Clear existing primary
    await this.db
      .updateTable('slocs')
      .set({ is_primary: 0 })
      .where('locid', '=', locid)
      .execute();

    // Set new primary
    const subloc = await this.findById(subid);
    if (subloc) {
      await this.db
        .updateTable('slocs')
        .set({ is_primary: 1 })
        .where('subid', '=', subid)
        .execute();
    }
  }

  /**
   * Check if a sub-location name already exists for a location
   */
  async checkNameExists(locid: string, subnam: string, excludeSubid?: string): Promise<boolean> {
    let query = this.db
      .selectFrom('slocs')
      .select('subid')
      .where('locid', '=', locid)
      .where('subnam', '=', subnam);

    if (excludeSubid) {
      query = query.where('subid', '!=', excludeSubid);
    }

    const row = await query.executeTakeFirst();
    return !!row;
  }

  /**
   * Count sub-locations for a parent location
   */
  async countByLocationId(locid: string): Promise<number> {
    const result = await this.db
      .selectFrom('slocs')
      .select(eb => eb.fn.countAll<number>().as('count'))
      .where('locid', '=', locid)
      .executeTakeFirst();

    return result?.count || 0;
  }

  /**
   * Get sub-locations with their hero images for display
   * Checks all thumbnail columns: preview_path > thumb_path_lg > thumb_path_sm > thumb_path
   * Sorts by: is_primary DESC, then by asset count (imgs + vids + docs) DESC
   */
  async findWithHeroImages(locid: string): Promise<Array<SubLocation & { hero_thumb_path?: string; asset_count?: number }>> {
    // Query sublocations with asset counts using subqueries
    const rows = await this.db
      .selectFrom('slocs')
      .selectAll('slocs')
      .select(eb => [
        eb.selectFrom('imgs')
          .select(eb.fn.countAll<number>().as('cnt'))
          .whereRef('imgs.subid', '=', 'slocs.subid')
          .as('img_count'),
        eb.selectFrom('vids')
          .select(eb.fn.countAll<number>().as('cnt'))
          .whereRef('vids.subid', '=', 'slocs.subid')
          .as('vid_count'),
        eb.selectFrom('docs')
          .select(eb.fn.countAll<number>().as('cnt'))
          .whereRef('docs.subid', '=', 'slocs.subid')
          .as('doc_count'),
      ])
      .where('locid', '=', locid)
      .execute();

    // Map to SubLocation with hero paths and calculate total asset count
    const sublocsWithAssets = await Promise.all(
      rows.map(async (row) => {
        const subloc = this.mapRowToSubLocation(row);
        const assetCount = (row.img_count || 0) + (row.vid_count || 0) + (row.doc_count || 0);

        let heroPath: string | undefined;
        if (subloc.hero_imghash) {
          const img = await this.db
            .selectFrom('imgs')
            .select(['preview_path', 'thumb_path_lg', 'thumb_path_sm', 'thumb_path'])
            .where('imghash', '=', subloc.hero_imghash)
            .executeTakeFirst();
          heroPath = img?.preview_path || img?.thumb_path_lg || img?.thumb_path_sm || img?.thumb_path || undefined;
        }

        return {
          ...subloc,
          hero_thumb_path: heroPath,
          asset_count: assetCount,
        };
      })
    );

    // Sort: primary first, then by asset count descending
    return sublocsWithAssets.sort((a, b) => {
      // Primary always first
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      // Then by asset count descending
      return (b.asset_count || 0) - (a.asset_count || 0);
    });
  }

  /**
   * Update GPS coordinates for a sub-location
   * This is SEPARATE from the host location's GPS
   */
  async updateGps(subid: string, gps: SubLocationGpsInput): Promise<SubLocation | null> {
    const existing = await this.findById(subid);
    if (!existing) return null;

    const gps_captured_at = new Date().toISOString();
    const gps_verified = gps.source === 'user_map_click' ? 1 : 0;

    await this.db
      .updateTable('slocs')
      .set({
        gps_lat: gps.lat,
        gps_lng: gps.lng,
        gps_accuracy: gps.accuracy || null,
        gps_source: gps.source,
        gps_verified_on_map: gps_verified,
        gps_captured_at,
        modified_date: gps_captured_at,
      })
      .where('subid', '=', subid)
      .execute();

    console.log(`[SubLocationRepo] Updated GPS for ${subid}: ${gps.lat}, ${gps.lng} (source: ${gps.source})`);

    return this.findById(subid);
  }

  /**
   * Clear GPS coordinates for a sub-location
   */
  async clearGps(subid: string): Promise<SubLocation | null> {
    const existing = await this.findById(subid);
    if (!existing) return null;

    await this.db
      .updateTable('slocs')
      .set({
        gps_lat: null,
        gps_lng: null,
        gps_accuracy: null,
        gps_source: null,
        gps_verified_on_map: 0,
        gps_captured_at: null,
        modified_date: new Date().toISOString(),
      })
      .where('subid', '=', subid)
      .execute();

    console.log(`[SubLocationRepo] Cleared GPS for ${subid}`);

    return this.findById(subid);
  }

  /**
   * Verify GPS on map for a sub-location
   */
  async verifyGpsOnMap(subid: string): Promise<SubLocation | null> {
    const existing = await this.findById(subid);
    if (!existing) return null;

    await this.db
      .updateTable('slocs')
      .set({
        gps_verified_on_map: 1,
        gps_source: 'user_map_click',
        modified_date: new Date().toISOString(),
      })
      .where('subid', '=', subid)
      .execute();

    console.log(`[SubLocationRepo] Verified GPS on map for ${subid}`);

    return this.findById(subid);
  }

  /**
   * Get all sub-locations with GPS for a location (for map display)
   */
  async findWithGpsByLocationId(locid: string): Promise<SubLocation[]> {
    const rows = await this.db
      .selectFrom('slocs')
      .selectAll()
      .where('locid', '=', locid)
      .where('gps_lat', 'is not', null)
      .where('gps_lng', 'is not', null)
      .execute();

    return rows.map(row => this.mapRowToSubLocation(row));
  }

  /**
   * Migration 65: Get distinct categories used in sub-locations
   * Returns categories from slocs table (separate from host location categories)
   */
  async getDistinctCategories(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('slocs')
      .select('category')
      .distinct()
      .where('category', 'is not', null)
      .orderBy('category')
      .execute();

    return rows.map(r => r.category).filter((t): t is string => !!t);
  }

  /**
   * Migration 65: Get distinct classes used in sub-locations
   * Returns classes from slocs table (separate from host location classes)
   */
  async getDistinctClasses(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('slocs')
      .select('class')
      .distinct()
      .where('class', 'is not', null)
      .orderBy('class')
      .execute();

    return rows.map(r => r.class).filter((t): t is string => !!t);
  }

  // Private helper methods

  /**
   * Map database row to SubLocation entity
   * ADR-046: sub12 removed - subid is the only ID now
   */
  private mapRowToSubLocation(row: SlocsTable): SubLocation {
    return {
      subid: row.subid,
      locid: row.locid,
      subnam: row.subnam,
      ssubname: row.ssubname,
      category: row.category || null,
      // Migration 65: Sub-location class
      class: row.class || null,
      status: row.status || null,
      hero_imghash: row.hero_imghash || null,
      hero_focal_x: row.hero_focal_x ?? 0.5,
      hero_focal_y: row.hero_focal_y ?? 0.5,
      is_primary: row.is_primary === 1,
      created_date: row.created_date || new Date().toISOString(),
      created_by: row.created_by || null,
      modified_date: row.modified_date || null,
      modified_by: row.modified_by || null,
      // Migration 31: GPS fields
      gps_lat: row.gps_lat || null,
      gps_lng: row.gps_lng || null,
      gps_accuracy: row.gps_accuracy || null,
      gps_source: row.gps_source || null,
      gps_verified_on_map: row.gps_verified_on_map === 1,
      gps_captured_at: row.gps_captured_at || null,
      // Migration 32: AKA name (historicalName removed)
      akanam: row.akanam || null,
    };
  }

  // ADR-046: Removed setPrimaryOnParent and clearPrimaryOnParent
  // Parent no longer tracks sub12 - the sublocs array tracks sub-locations

  private async addToParentSublocs(locid: string, subid: string): Promise<void> {
    const parent = await this.db
      .selectFrom('locs')
      .select('sublocs')
      .where('locid', '=', locid)
      .executeTakeFirst();

    const currentSublocs: string[] = parent?.sublocs ? JSON.parse(parent.sublocs) : [];
    if (!currentSublocs.includes(subid)) {
      currentSublocs.push(subid);
      await this.db
        .updateTable('locs')
        .set({ sublocs: JSON.stringify(currentSublocs) })
        .where('locid', '=', locid)
        .execute();
    }
  }

  private async removeFromParentSublocs(locid: string, subid: string): Promise<void> {
    const parent = await this.db
      .selectFrom('locs')
      .select('sublocs')
      .where('locid', '=', locid)
      .executeTakeFirst();

    const currentSublocs: string[] = parent?.sublocs ? JSON.parse(parent.sublocs) : [];
    const filteredSublocs = currentSublocs.filter(id => id !== subid);

    await this.db
      .updateTable('locs')
      .set({ sublocs: JSON.stringify(filteredSublocs) })
      .where('locid', '=', locid)
      .execute();
  }
}
