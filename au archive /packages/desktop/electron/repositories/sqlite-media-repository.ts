import { Kysely } from 'kysely';
import type { Database, ImgsTable, VidsTable, DocsTable } from '../main/database.types';

/**
 * OPT-094: Options for filtering media queries by sub-location
 * - undefined: Return all media (backward compatible)
 * - null: Return only host location media (subid IS NULL)
 * - string: Return only that sub-location's media (subid = value)
 */
export interface MediaQueryOptions {
  subid?: string | null;
}

export interface MediaImage {
  imghash: string;
  imgnam: string;
  imgnamo: string;
  imgloc: string;
  imgloco: string;
  locid: string | null;
  subid: string | null;
  auth_imp: string | null;
  imgadd: string | null;
  meta_exiftool: string | null;
  meta_width: number | null;
  meta_height: number | null;
  meta_date_taken: string | null;
  meta_camera_make: string | null;
  meta_camera_model: string | null;
  meta_gps_lat: number | null;
  meta_gps_lng: number | null;
  // Thumbnail/Preview fields (Migration 8 & 9 - Premium Archive)
  thumb_path: string | null;
  thumb_path_sm: string | null;
  thumb_path_lg: string | null;
  preview_path: string | null;
  preview_extracted: number;
  xmp_synced: number;
  xmp_modified_at: string | null;
  // Hidden/Live Photo fields (Migration 23)
  hidden: number;
  hidden_reason: string | null;
  is_live_photo: number;
  // Activity Tracking (Migration 25)
  imported_by_id: string | null;
  imported_by: string | null;
  media_source: string | null;
  // OPT-047: File size for archive size tracking
  file_size_bytes: number | null;
  // NOTE: darktable columns exist in DB but are deprecated/unused
}

export interface MediaVideo {
  vidhash: string;
  vidnam: string;
  vidnamo: string;
  vidloc: string;
  vidloco: string;
  locid: string | null;
  subid: string | null;
  auth_imp: string | null;
  vidadd: string | null;
  meta_ffmpeg: string | null;
  meta_exiftool: string | null;
  meta_duration: number | null;
  meta_width: number | null;
  meta_height: number | null;
  meta_codec: string | null;
  meta_fps: number | null;
  meta_date_taken: string | null;
  // GPS fields (FIX 3.2 - dashcams, phones)
  meta_gps_lat: number | null;
  meta_gps_lng: number | null;
  // Thumbnail/Poster fields (Migration 8 & 9 - Premium Archive)
  thumb_path: string | null;
  thumb_path_sm: string | null;
  thumb_path_lg: string | null;
  preview_path: string | null;
  poster_extracted: number;
  xmp_synced: number;
  xmp_modified_at: string | null;
  // Hidden/Live Photo fields (Migration 23)
  hidden: number;
  hidden_reason: string | null;
  is_live_photo: number;
  // Activity Tracking (Migration 25)
  imported_by_id: string | null;
  imported_by: string | null;
  media_source: string | null;
  // OPT-047: File size for archive size tracking
  file_size_bytes: number | null;
}

export interface MediaDocument {
  dochash: string;
  docnam: string;
  docnamo: string;
  docloc: string;
  docloco: string;
  locid: string | null;
  subid: string | null;
  auth_imp: string | null;
  docadd: string | null;
  meta_exiftool: string | null;
  meta_page_count: number | null;
  meta_author: string | null;
  meta_title: string | null;
  // Hidden fields (Migration 23)
  hidden: number;
  hidden_reason: string | null;
  // Activity Tracking (Migration 25)
  imported_by_id: string | null;
  imported_by: string | null;
  media_source: string | null;
  // OPT-047: File size for archive size tracking
  file_size_bytes: number | null;
}

/**
 * MAP-MEDIA-FIX-001: Map media interface for GeoTIFF, GPX, KML, GeoJSON, etc.
 */
export interface MediaMap {
  maphash: string;
  mapnam: string;
  mapnamo: string;
  maploc: string;
  maploco: string;
  locid: string | null;
  subid: string | null;
  auth_imp: string | null;
  mapadd: string | null;
  meta_exiftool: string | null;
  meta_map: string | null;
  meta_gps_lat: number | null;
  meta_gps_lng: number | null;
  reference: string | null;
  map_states: string | null;
  map_verified: number;
  // Multi-tier thumbnails (Migration 9 - Premium Archive)
  thumb_path_sm: string | null;
  thumb_path_lg: string | null;
  preview_path: string | null;
  // Activity Tracking (Migration 25)
  imported_by_id: string | null;
  imported_by: string | null;
  media_source: string | null;
  // OPT-047: File size for archive size tracking
  file_size_bytes: number | null;
}

/**
 * Repository for media files (images, videos, documents, maps)
 */
export class SQLiteMediaRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // ==================== IMAGES ====================

  async createImage(image: Omit<ImgsTable, 'imgadd'>): Promise<MediaImage> {
    const imgadd = new Date().toISOString();
    await this.db
      .insertInto('imgs')
      .values({ ...image, imgadd })
      .execute();
    return this.findImageByHash(image.imghash);
  }

  async findImageByHash(imghash: string): Promise<MediaImage> {
    const row = await this.db
      .selectFrom('imgs')
      .selectAll()
      .where('imghash', '=', imghash)
      .executeTakeFirstOrThrow();
    return row;
  }

  /**
   * OPT-094: Find images by location with optional sub-location filtering
   * @param locid - Location ID
   * @param options - Optional filtering: undefined=all, null=host only, string=specific sub-location
   */
  async findImagesByLocation(locid: string, options?: MediaQueryOptions): Promise<MediaImage[]> {
    let query = this.db
      .selectFrom('imgs')
      .selectAll()
      .where('locid', '=', locid);

    // OPT-094: Apply subid filtering
    if (options?.subid === null) {
      // Host location: only media with no sub-location
      query = query.where('subid', 'is', null);
    } else if (options?.subid !== undefined) {
      // Specific sub-location
      query = query.where('subid', '=', options.subid);
    }
    // If options.subid is undefined, return all (backward compatible)

    const rows = await query.orderBy('imgadd', 'desc').execute();
    return rows;
  }

  /**
   * OPT-037: Find images by location with pagination
   * OPT-094: Added subid filtering support
   * For infinite scroll / lazy loading in galleries
   */
  async findImagesByLocationPaginated(locid: string, limit: number, offset: number, options?: MediaQueryOptions): Promise<{
    images: MediaImage[];
    total: number;
    hasMore: boolean;
  }> {
    // Build base queries
    let dataQuery = this.db
      .selectFrom('imgs')
      .selectAll()
      .where('locid', '=', locid);

    let countQuery = this.db
      .selectFrom('imgs')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('locid', '=', locid);

    // OPT-094: Apply subid filtering to both queries
    if (options?.subid === null) {
      dataQuery = dataQuery.where('subid', 'is', null);
      countQuery = countQuery.where('subid', 'is', null);
    } else if (options?.subid !== undefined) {
      dataQuery = dataQuery.where('subid', '=', options.subid);
      countQuery = countQuery.where('subid', '=', options.subid);
    }

    const [rows, countResult] = await Promise.all([
      dataQuery.orderBy('imgadd', 'desc').limit(limit).offset(offset).execute(),
      countQuery.executeTakeFirst(),
    ]);

    const total = Number(countResult?.count || 0);
    return {
      images: rows,
      total,
      hasMore: offset + rows.length < total,
    };
  }

  async imageExists(imghash: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('imgs')
      .select('imghash')
      .where('imghash', '=', imghash)
      .executeTakeFirst();
    return !!result;
  }

  // ==================== VIDEOS ====================

  async createVideo(video: Omit<VidsTable, 'vidadd'>): Promise<MediaVideo> {
    const vidadd = new Date().toISOString();
    await this.db
      .insertInto('vids')
      .values({ ...video, vidadd })
      .execute();
    return this.findVideoByHash(video.vidhash);
  }

  async findVideoByHash(vidhash: string): Promise<MediaVideo> {
    const row = await this.db
      .selectFrom('vids')
      .selectAll()
      .where('vidhash', '=', vidhash)
      .executeTakeFirstOrThrow();
    return row;
  }

  /**
   * OPT-094: Find videos by location with optional sub-location filtering
   */
  async findVideosByLocation(locid: string, options?: MediaQueryOptions): Promise<MediaVideo[]> {
    let query = this.db
      .selectFrom('vids')
      .selectAll()
      .where('locid', '=', locid);

    // OPT-094: Apply subid filtering
    if (options?.subid === null) {
      query = query.where('subid', 'is', null);
    } else if (options?.subid !== undefined) {
      query = query.where('subid', '=', options.subid);
    }

    const rows = await query.orderBy('vidadd', 'desc').execute();
    return rows;
  }

  async videoExists(vidhash: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('vids')
      .select('vidhash')
      .where('vidhash', '=', vidhash)
      .executeTakeFirst();
    return !!result;
  }

  // ==================== DOCUMENTS ====================

  async createDocument(doc: Omit<DocsTable, 'docadd'>): Promise<MediaDocument> {
    const docadd = new Date().toISOString();
    await this.db
      .insertInto('docs')
      .values({ ...doc, docadd })
      .execute();
    return this.findDocumentByHash(doc.dochash);
  }

  async findDocumentByHash(dochash: string): Promise<MediaDocument> {
    const row = await this.db
      .selectFrom('docs')
      .selectAll()
      .where('dochash', '=', dochash)
      .executeTakeFirstOrThrow();
    return row;
  }

  /**
   * OPT-094: Find documents by location with optional sub-location filtering
   */
  async findDocumentsByLocation(locid: string, options?: MediaQueryOptions): Promise<MediaDocument[]> {
    let query = this.db
      .selectFrom('docs')
      .selectAll()
      .where('locid', '=', locid);

    // OPT-094: Apply subid filtering
    if (options?.subid === null) {
      query = query.where('subid', 'is', null);
    } else if (options?.subid !== undefined) {
      query = query.where('subid', '=', options.subid);
    }

    const rows = await query.orderBy('docadd', 'desc').execute();
    return rows;
  }

  async documentExists(dochash: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('docs')
      .select('dochash')
      .where('dochash', '=', dochash)
      .executeTakeFirst();
    return !!result;
  }

  // ==================== MAPS (MAP-MEDIA-FIX-001) ====================

  /**
   * MAP-MEDIA-FIX-001: Find map by hash
   */
  async findMapByHash(maphash: string): Promise<MediaMap> {
    const row = await this.db
      .selectFrom('maps')
      .selectAll()
      .where('maphash', '=', maphash)
      .executeTakeFirstOrThrow();
    return row;
  }

  /**
   * MAP-MEDIA-FIX-001: Find maps by location with optional sub-location filtering
   * Supports GeoTIFF, GPX, KML, GeoJSON, and other map file types
   */
  async findMapsByLocation(locid: string, options?: MediaQueryOptions): Promise<MediaMap[]> {
    let query = this.db
      .selectFrom('maps')
      .selectAll()
      .where('locid', '=', locid);

    // Apply subid filtering (same pattern as images/videos/documents)
    if (options?.subid === null) {
      query = query.where('subid', 'is', null);
    } else if (options?.subid !== undefined) {
      query = query.where('subid', '=', options.subid);
    }

    const rows = await query.orderBy('mapadd', 'desc').execute();
    return rows;
  }

  /**
   * MAP-MEDIA-FIX-001: Check if map exists by hash
   */
  async mapExists(maphash: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('maps')
      .select('maphash')
      .where('maphash', '=', maphash)
      .executeTakeFirst();
    return !!result;
  }

  /**
   * MAP-MEDIA-FIX-001: Delete a map by hash
   */
  async deleteMap(maphash: string): Promise<void> {
    await this.db
      .deleteFrom('maps')
      .where('maphash', '=', maphash)
      .execute();
  }

  /**
   * MAP-MEDIA-FIX-001: Move a map to a different sub-location
   */
  async moveMapToSubLocation(maphash: string, subid: string | null): Promise<void> {
    await this.db
      .updateTable('maps')
      .set({ subid })
      .where('maphash', '=', maphash)
      .execute();
  }

  // ==================== GENERAL ====================

  /**
   * OPT-094: Find all media by location with optional sub-location filtering
   * MAP-MEDIA-FIX-001: Added maps to the response
   * @param locid - Location ID
   * @param options - Optional filtering: undefined=all, null=host only, string=specific sub-location
   */
  async findAllMediaByLocation(locid: string, options?: MediaQueryOptions): Promise<{
    images: MediaImage[];
    videos: MediaVideo[];
    documents: MediaDocument[];
    maps: MediaMap[];
  }> {
    const [images, videos, documents, maps] = await Promise.all([
      this.findImagesByLocation(locid, options),
      this.findVideosByLocation(locid, options),
      this.findDocumentsByLocation(locid, options),
      this.findMapsByLocation(locid, options),
    ]);

    return { images, videos, documents, maps };
  }

  // ==================== THUMBNAIL/PREVIEW OPERATIONS ====================

  /**
   * Get images without multi-tier thumbnails for batch generation
   * Kanye8 FIX: Check thumb_path_sm (400px) not thumb_path (legacy 256px)
   * This catches images imported before multi-tier system
   */
  async getImagesWithoutThumbnails(): Promise<Array<{ imghash: string; imgloc: string; preview_path: string | null }>> {
    const rows = await this.db
      .selectFrom('imgs')
      .select(['imghash', 'imgloc', 'preview_path'])
      .where('thumb_path_sm', 'is', null)
      .execute();
    return rows;
  }

  /**
   * Get ALL images for force regeneration
   */
  async getAllImages(): Promise<Array<{ imghash: string; imgloc: string; preview_path: string | null }>> {
    const rows = await this.db
      .selectFrom('imgs')
      .select(['imghash', 'imgloc', 'preview_path'])
      .execute();
    return rows;
  }

  /**
   * Get images for a specific location (for location-specific fixes)
   * OPT-094: Added subid filtering support
   */
  async getImagesByLocation(locid: string, options?: MediaQueryOptions): Promise<Array<{ imghash: string; imgloc: string; preview_path: string | null }>> {
    let query = this.db
      .selectFrom('imgs')
      .select(['imghash', 'imgloc', 'preview_path'])
      .where('locid', '=', locid);

    // OPT-094: Apply subid filtering
    if (options?.subid === null) {
      query = query.where('subid', 'is', null);
    } else if (options?.subid !== undefined) {
      query = query.where('subid', '=', options.subid);
    }

    const rows = await query.execute();
    return rows;
  }

  /**
   * Kanye9: Get RAW images that are missing preview extraction
   * These are files that have thumbnails but no preview (browser can't display RAW)
   */
  async getImagesWithoutPreviews(): Promise<Array<{ imghash: string; imgloc: string }>> {
    // RAW file extensions that need preview extraction
    const rawPattern = '%.nef';  // Start with NEF, most common
    const rows = await this.db
      .selectFrom('imgs')
      .select(['imghash', 'imgloc'])
      .where('preview_path', 'is', null)
      .where((eb) =>
        eb.or([
          eb('imgloc', 'like', '%.nef'),
          eb('imgloc', 'like', '%.NEF'),
          eb('imgloc', 'like', '%.cr2'),
          eb('imgloc', 'like', '%.CR2'),
          eb('imgloc', 'like', '%.cr3'),
          eb('imgloc', 'like', '%.CR3'),
          eb('imgloc', 'like', '%.arw'),
          eb('imgloc', 'like', '%.ARW'),
          eb('imgloc', 'like', '%.dng'),
          eb('imgloc', 'like', '%.DNG'),
          eb('imgloc', 'like', '%.orf'),
          eb('imgloc', 'like', '%.ORF'),
          eb('imgloc', 'like', '%.raf'),
          eb('imgloc', 'like', '%.RAF'),
          eb('imgloc', 'like', '%.rw2'),
          eb('imgloc', 'like', '%.RW2'),
        ])
      )
      .execute();
    return rows;
  }

  /**
   * Update thumbnail path for an image
   */
  async updateImageThumbnailPath(imghash: string, thumbPath: string): Promise<void> {
    await this.db
      .updateTable('imgs')
      .set({ thumb_path: thumbPath })
      .where('imghash', '=', imghash)
      .execute();
  }

  /**
   * Update preview path for a RAW image
   */
  async updateImagePreviewPath(imghash: string, previewPath: string): Promise<void> {
    await this.db
      .updateTable('imgs')
      .set({ preview_path: previewPath, preview_extracted: 1 })
      .where('imghash', '=', imghash)
      .execute();
  }

  /**
   * Update preview path with quality level (Migration 30)
   */
  async updateImagePreviewWithQuality(imghash: string, previewPath: string, quality: 'full' | 'embedded' | 'low'): Promise<void> {
    await this.db
      .updateTable('imgs')
      .set({ preview_path: previewPath, preview_extracted: 1, preview_quality: quality })
      .where('imghash', '=', imghash)
      .execute();
  }

  /**
   * Get DNG images that need LibRaw re-rendering (have low-quality embedded previews)
   * Returns DNGs where preview_quality is 'low' or 'embedded' (not yet rendered via LibRaw)
   */
  async getDngImagesNeedingLibraw(): Promise<Array<{ imghash: string; imgloc: string; meta_width: number | null; meta_height: number | null }>> {
    const rows = await this.db
      .selectFrom('imgs')
      .select(['imghash', 'imgloc', 'meta_width', 'meta_height'])
      .where((eb) =>
        eb.or([
          eb('imgloc', 'like', '%.dng'),
          eb('imgloc', 'like', '%.DNG'),
        ])
      )
      .where((eb) =>
        eb.or([
          eb('preview_quality', 'is', null),
          eb('preview_quality', '=', 'low'),
          eb('preview_quality', '=', 'embedded'),
        ])
      )
      .execute();
    return rows;
  }

  /**
   * Get videos without poster frames (legacy - checks thumb_path)
   */
  async getVideosWithoutPosters(): Promise<Array<{ vidhash: string; vidloc: string }>> {
    const rows = await this.db
      .selectFrom('vids')
      .select(['vidhash', 'vidloc'])
      .where('thumb_path', 'is', null)
      .execute();
    return rows;
  }

  /**
   * DECISION-020: Get videos without multi-tier thumbnails
   */
  async getVideosWithoutThumbnails(): Promise<Array<{ vidhash: string; vidloc: string }>> {
    const rows = await this.db
      .selectFrom('vids')
      .select(['vidhash', 'vidloc'])
      .where('thumb_path_sm', 'is', null)
      .execute();
    return rows;
  }

  /**
   * DECISION-020: Get ALL videos for force regeneration
   */
  async getAllVideos(): Promise<Array<{ vidhash: string; vidloc: string }>> {
    const rows = await this.db
      .selectFrom('vids')
      .select(['vidhash', 'vidloc'])
      .execute();
    return rows;
  }

  /**
   * Get videos for a specific location (for location-specific fixes)
   * OPT-094: Added subid filtering support
   */
  async getVideosByLocation(locid: string, options?: MediaQueryOptions): Promise<Array<{ vidhash: string; vidloc: string }>> {
    let query = this.db
      .selectFrom('vids')
      .select(['vidhash', 'vidloc'])
      .where('locid', '=', locid);

    // OPT-094: Apply subid filtering
    if (options?.subid === null) {
      query = query.where('subid', 'is', null);
    } else if (options?.subid !== undefined) {
      query = query.where('subid', '=', options.subid);
    }

    const rows = await query.execute();
    return rows;
  }

  /**
   * Update poster frame path for a video
   */
  async updateVideoPosterPath(vidhash: string, posterPath: string): Promise<void> {
    await this.db
      .updateTable('vids')
      .set({ thumb_path: posterPath, poster_extracted: 1 })
      .where('vidhash', '=', vidhash)
      .execute();
  }

  /**
   * Update XMP sync status for an image
   */
  async updateImageXmpStatus(imghash: string, synced: boolean): Promise<void> {
    await this.db
      .updateTable('imgs')
      .set({
        xmp_synced: synced ? 1 : 0,
        xmp_modified_at: new Date().toISOString()
      })
      .where('imghash', '=', imghash)
      .execute();
  }

  // ==================== HIDDEN/LIVE PHOTO OPERATIONS ====================

  /**
   * Set hidden status for an image
   */
  async setImageHidden(imghash: string, hidden: boolean, reason: string | null = 'user'): Promise<void> {
    await this.db
      .updateTable('imgs')
      .set({
        hidden: hidden ? 1 : 0,
        hidden_reason: hidden ? reason : null
      })
      .where('imghash', '=', imghash)
      .execute();
  }

  /**
   * Set hidden status for a video
   */
  async setVideoHidden(vidhash: string, hidden: boolean, reason: string | null = 'user'): Promise<void> {
    await this.db
      .updateTable('vids')
      .set({
        hidden: hidden ? 1 : 0,
        hidden_reason: hidden ? reason : null
      })
      .where('vidhash', '=', vidhash)
      .execute();
  }

  /**
   * Set hidden status for a document
   */
  async setDocumentHidden(dochash: string, hidden: boolean, reason: string | null = 'user'): Promise<void> {
    await this.db
      .updateTable('docs')
      .set({
        hidden: hidden ? 1 : 0,
        hidden_reason: hidden ? reason : null
      })
      .where('dochash', '=', dochash)
      .execute();
  }

  /**
   * Mark image as Live Photo
   */
  async setImageLivePhoto(imghash: string, isLivePhoto: boolean): Promise<void> {
    await this.db
      .updateTable('imgs')
      .set({ is_live_photo: isLivePhoto ? 1 : 0 })
      .where('imghash', '=', imghash)
      .execute();
  }

  /**
   * Mark video as Live Photo (the video component)
   */
  async setVideoLivePhoto(vidhash: string, isLivePhoto: boolean): Promise<void> {
    await this.db
      .updateTable('vids')
      .set({ is_live_photo: isLivePhoto ? 1 : 0 })
      .where('vidhash', '=', vidhash)
      .execute();
  }

  /**
   * Get all images by location with their original filenames (for Live Photo matching)
   * OPT-094: Added subid filtering support
   */
  async getImageFilenamesByLocation(locid: string, options?: MediaQueryOptions): Promise<Array<{ imghash: string; imgnamo: string }>> {
    let query = this.db
      .selectFrom('imgs')
      .select(['imghash', 'imgnamo'])
      .where('locid', '=', locid);

    // OPT-094: Apply subid filtering
    if (options?.subid === null) {
      query = query.where('subid', 'is', null);
    } else if (options?.subid !== undefined) {
      query = query.where('subid', '=', options.subid);
    }

    const rows = await query.execute();
    return rows;
  }

  /**
   * Get all videos by location with their original filenames (for Live Photo matching)
   * OPT-094: Added subid filtering support
   */
  async getVideoFilenamesByLocation(locid: string, options?: MediaQueryOptions): Promise<Array<{ vidhash: string; vidnamo: string }>> {
    let query = this.db
      .selectFrom('vids')
      .select(['vidhash', 'vidnamo'])
      .where('locid', '=', locid);

    // OPT-094: Apply subid filtering
    if (options?.subid === null) {
      query = query.where('subid', 'is', null);
    } else if (options?.subid !== undefined) {
      query = query.where('subid', '=', options.subid);
    }

    const rows = await query.execute();
    return rows;
  }

  // ==================== DELETE OPERATIONS ====================

  /**
   * Delete an image by hash (removes DB record only, file deletion handled by caller)
   */
  async deleteImage(imghash: string): Promise<void> {
    await this.db
      .deleteFrom('imgs')
      .where('imghash', '=', imghash)
      .execute();
  }

  /**
   * Delete a video by hash (removes DB record only, file deletion handled by caller)
   */
  async deleteVideo(vidhash: string): Promise<void> {
    await this.db
      .deleteFrom('vids')
      .where('vidhash', '=', vidhash)
      .execute();
  }

  /**
   * Delete a document by hash (removes DB record only, file deletion handled by caller)
   */
  async deleteDocument(dochash: string): Promise<void> {
    await this.db
      .deleteFrom('docs')
      .where('dochash', '=', dochash)
      .execute();
  }

  // ==================== MOVE OPERATIONS ====================

  /**
   * Move an image to a different sub-location
   */
  async moveImageToSubLocation(imghash: string, subid: string | null): Promise<void> {
    await this.db
      .updateTable('imgs')
      .set({ subid })
      .where('imghash', '=', imghash)
      .execute();
  }

  /**
   * Move a video to a different sub-location
   */
  async moveVideoToSubLocation(vidhash: string, subid: string | null): Promise<void> {
    await this.db
      .updateTable('vids')
      .set({ subid })
      .where('vidhash', '=', vidhash)
      .execute();
  }

  /**
   * Move a document to a different sub-location
   */
  async moveDocumentToSubLocation(dochash: string, subid: string | null): Promise<void> {
    await this.db
      .updateTable('docs')
      .set({ subid })
      .where('dochash', '=', dochash)
      .execute();
  }

}
