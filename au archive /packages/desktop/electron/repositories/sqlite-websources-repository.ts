import { Kysely, sql, Selectable } from 'kysely';
import path from 'path';
import fs from 'fs/promises';
import { generateId } from '../main/ipc-validation';
import type { Database, WebSourcesTable, WebSourceVersionsTable, WebSourceImagesTable, WebSourceVideosTable } from '../main/database.types';
import { getLogger } from '../services/logger-service';

// Type aliases for selected rows (strips Generated<> wrapper)
export type WebSourceImageRow = Selectable<WebSourceImagesTable>;
export type WebSourceVideoRow = Selectable<WebSourceVideosTable>;
import { calculateHashBuffer } from '../services/crypto-service';

// =============================================================================
// Types and Interfaces
// =============================================================================

export type WebSourceStatus = 'pending' | 'archiving' | 'complete' | 'partial' | 'failed';
export type WebSourceType = 'article' | 'gallery' | 'video' | 'social' | 'map' | 'document' | 'archive' | 'other';

export interface ComponentStatus {
  screenshot?: 'pending' | 'done' | 'failed' | 'skipped';
  pdf?: 'pending' | 'done' | 'failed' | 'skipped';
  html?: 'pending' | 'done' | 'failed' | 'skipped';
  warc?: 'pending' | 'done' | 'failed' | 'skipped';
  images?: 'pending' | 'done' | 'failed' | 'skipped';
  videos?: 'pending' | 'done' | 'failed' | 'skipped';
  text?: 'pending' | 'done' | 'failed' | 'skipped';
}

export interface WebSourceInput {
  url: string;
  title?: string | null;
  locid?: string | null;
  subid?: string | null;
  source_type?: WebSourceType;
  notes?: string | null;
  auth_imp?: string | null;
}

export interface WebSourceUpdate {
  title?: string | null;
  locid?: string | null;
  subid?: string | null;
  source_type?: WebSourceType;
  notes?: string | null;
  status?: WebSourceStatus;
  component_status?: ComponentStatus;
  extracted_title?: string | null;
  extracted_author?: string | null;
  extracted_date?: string | null;
  extracted_publisher?: string | null;
  extracted_text?: string | null;
  word_count?: number;
  image_count?: number;
  video_count?: number;
  archive_path?: string | null;
  screenshot_path?: string | null;
  pdf_path?: string | null;
  html_path?: string | null;
  warc_path?: string | null;
  screenshot_hash?: string | null;
  pdf_hash?: string | null;
  html_hash?: string | null;
  warc_hash?: string | null;
  content_hash?: string | null;
  provenance_hash?: string | null;
  archive_error?: string | null;
  retry_count?: number;
  archived_at?: string | null;
  // OPT-111: Enhanced metadata (Migration 66)
  domain?: string | null;
  extracted_links?: string | null;
  page_metadata_json?: string | null;
  http_headers_json?: string | null;
  canonical_url?: string | null;
  language?: string | null;
  favicon_path?: string | null;
  // OPT-115: Enhanced capture tracking (Migration 71)
  capture_method?: string | null;
  extension_captured_at?: string | null;
  puppeteer_captured_at?: string | null;
  extension_screenshot_path?: string | null;
  extension_html_path?: string | null;
  og_title?: string | null;
  og_description?: string | null;
  og_image?: string | null;
  twitter_card_json?: string | null;
  schema_org_json?: string | null;
  http_status?: number | null;
}

export interface WebSource {
  source_id: string;
  url: string;
  title: string | null;
  locid: string | null;
  subid: string | null;
  source_type: WebSourceType;
  notes: string | null;
  status: WebSourceStatus;
  component_status: ComponentStatus | null;
  extracted_title: string | null;
  extracted_author: string | null;
  extracted_date: string | null;
  extracted_publisher: string | null;
  extracted_text: string | null;
  word_count: number;
  image_count: number;
  video_count: number;
  archive_path: string | null;
  screenshot_path: string | null;
  pdf_path: string | null;
  html_path: string | null;
  warc_path: string | null;
  screenshot_hash: string | null;
  pdf_hash: string | null;
  html_hash: string | null;
  warc_hash: string | null;
  content_hash: string | null;
  provenance_hash: string | null;
  archive_error: string | null;
  retry_count: number;
  created_at: string;
  archived_at: string | null;
  auth_imp: string | null;
  // OPT-111: Enhanced metadata (Migration 66)
  domain: string | null;
  extracted_links: string | null;
  page_metadata_json: string | null;
  http_headers_json: string | null;
  canonical_url: string | null;
  language: string | null;
  favicon_path: string | null;
  // OPT-115: Enhanced capture tracking (Migration 71)
  capture_method: string | null;
  extension_captured_at: string | null;
  puppeteer_captured_at: string | null;
  extension_screenshot_path: string | null;
  extension_html_path: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
  twitter_card_json: string | null;
  schema_org_json: string | null;
  http_status: number | null;
  // Joined fields
  locnam?: string;
  subnam?: string;
}

export interface WebSourceVersion {
  version_id: string;
  source_id: string;
  version_number: number;
  archived_at: string;
  archive_path: string | null;
  screenshot_path: string | null;
  pdf_path: string | null;
  html_path: string | null;
  warc_path: string | null;
  word_count: number | null;
  image_count: number | null;
  video_count: number | null;
  screenshot_hash: string | null;
  pdf_hash: string | null;
  html_hash: string | null;
  warc_hash: string | null;
  content_hash: string | null;
  content_changed: boolean;
  diff_summary: string | null;
}

export interface WebSourceSearchResult {
  source_id: string;
  url: string;
  title: string | null;
  locid: string | null;
  snippet: string;
  rank: number;
}

export interface WebSourceStats {
  total: number;
  pending: number;
  archiving: number;
  complete: number;
  partial: number;
  failed: number;
  total_images: number;
  total_videos: number;
  total_words: number;
}

// =============================================================================
// Repository Implementation
// =============================================================================

/**
 * Repository for managing web sources and their archives
 * Replaces the simple bookmarks system with comprehensive web archiving
 */
export class SQLiteWebSourcesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // ===========================================================================
  // Core CRUD Operations
  // ===========================================================================

  /**
   * Create a new web source
   * Source ID is derived from BLAKE3 hash of URL for deduplication
   */
  async create(input: WebSourceInput): Promise<WebSource> {
    // Generate source_id from URL hash for deduplication
    const source_id = this.generateSourceId(input.url);
    const created_at = new Date().toISOString();

    // Check if source already exists
    const existing = await this.findById(source_id).catch(() => null);
    if (existing) {
      throw new Error(`Web source already exists for URL: ${input.url}`);
    }

    const source: WebSourcesTable = {
      source_id,
      url: input.url,
      title: input.title || null,
      locid: input.locid || null,
      subid: input.subid || null,
      source_type: input.source_type || 'article',
      notes: input.notes || null,
      status: 'pending',
      component_status: null,
      extracted_title: null,
      extracted_author: null,
      extracted_date: null,
      extracted_publisher: null,
      extracted_text: null,
      word_count: 0,
      image_count: 0,
      video_count: 0,
      archive_path: null,
      screenshot_path: null,
      pdf_path: null,
      html_path: null,
      warc_path: null,
      screenshot_hash: null,
      pdf_hash: null,
      html_hash: null,
      warc_hash: null,
      content_hash: null,
      provenance_hash: null,
      archive_error: null,
      retry_count: 0,
      created_at,
      archived_at: null,
      auth_imp: input.auth_imp || null,
      // OPT-111: Enhanced metadata fields
      domain: null,
      extracted_links: null,
      page_metadata_json: null,
      http_headers_json: null,
      canonical_url: null,
      language: null,
      favicon_path: null,
    };

    await this.db.insertInto('web_sources').values(source).execute();

    return this.findById(source_id);
  }

  /**
   * Find a web source by ID
   */
  async findById(source_id: string): Promise<WebSource> {
    const result = await this.db
      .selectFrom('web_sources')
      .leftJoin('locs', 'web_sources.locid', 'locs.locid')
      .leftJoin('slocs', 'web_sources.subid', 'slocs.subid')
      .selectAll('web_sources')
      .select(['locs.locnam', 'slocs.subnam'])
      .where('web_sources.source_id', '=', source_id)
      .executeTakeFirstOrThrow();

    return this.mapToWebSource(result);
  }

  /**
   * Find a web source by URL
   */
  async findByUrl(url: string): Promise<WebSource | null> {
    const source_id = this.generateSourceId(url);
    try {
      return await this.findById(source_id);
    } catch {
      return null;
    }
  }

  /**
   * Find all web sources for a specific location
   */
  async findByLocation(locid: string): Promise<WebSource[]> {
    const results = await this.db
      .selectFrom('web_sources')
      .leftJoin('locs', 'web_sources.locid', 'locs.locid')
      .leftJoin('slocs', 'web_sources.subid', 'slocs.subid')
      .selectAll('web_sources')
      .select(['locs.locnam', 'slocs.subnam'])
      .where('web_sources.locid', '=', locid)
      .orderBy('web_sources.created_at', 'desc')
      .execute();

    return results.map((r) => this.mapToWebSource(r));
  }

  /**
   * Find all web sources for a specific sub-location
   */
  async findBySubLocation(subid: string): Promise<WebSource[]> {
    const results = await this.db
      .selectFrom('web_sources')
      .leftJoin('locs', 'web_sources.locid', 'locs.locid')
      .leftJoin('slocs', 'web_sources.subid', 'slocs.subid')
      .selectAll('web_sources')
      .select(['locs.locnam', 'slocs.subnam'])
      .where('web_sources.subid', '=', subid)
      .orderBy('web_sources.created_at', 'desc')
      .execute();

    return results.map((r) => this.mapToWebSource(r));
  }

  /**
   * Find web sources by status
   */
  async findByStatus(status: WebSourceStatus): Promise<WebSource[]> {
    const results = await this.db
      .selectFrom('web_sources')
      .leftJoin('locs', 'web_sources.locid', 'locs.locid')
      .leftJoin('slocs', 'web_sources.subid', 'slocs.subid')
      .selectAll('web_sources')
      .select(['locs.locnam', 'slocs.subnam'])
      .where('web_sources.status', '=', status)
      .orderBy('web_sources.created_at', 'desc')
      .execute();

    return results.map((r) => this.mapToWebSource(r));
  }

  /**
   * Find pending sources ready for archiving
   */
  async findPendingForArchive(limit: number = 10): Promise<WebSource[]> {
    const results = await this.db
      .selectFrom('web_sources')
      .leftJoin('locs', 'web_sources.locid', 'locs.locid')
      .leftJoin('slocs', 'web_sources.subid', 'slocs.subid')
      .selectAll('web_sources')
      .select(['locs.locnam', 'slocs.subnam'])
      .where('web_sources.status', '=', 'pending')
      .orderBy('web_sources.created_at', 'asc')
      .limit(limit)
      .execute();

    return results.map((r) => this.mapToWebSource(r));
  }

  /**
   * Find recently added sources
   */
  async findRecent(limit: number = 10): Promise<WebSource[]> {
    const results = await this.db
      .selectFrom('web_sources')
      .leftJoin('locs', 'web_sources.locid', 'locs.locid')
      .leftJoin('slocs', 'web_sources.subid', 'slocs.subid')
      .selectAll('web_sources')
      .select(['locs.locnam', 'slocs.subnam'])
      .orderBy('web_sources.created_at', 'desc')
      .limit(limit)
      .execute();

    return results.map((r) => this.mapToWebSource(r));
  }

  /**
   * Find all web sources
   */
  async findAll(): Promise<WebSource[]> {
    const results = await this.db
      .selectFrom('web_sources')
      .leftJoin('locs', 'web_sources.locid', 'locs.locid')
      .leftJoin('slocs', 'web_sources.subid', 'slocs.subid')
      .selectAll('web_sources')
      .select(['locs.locnam', 'slocs.subnam'])
      .orderBy('web_sources.created_at', 'desc')
      .execute();

    return results.map((r) => this.mapToWebSource(r));
  }

  /**
   * Update a web source
   */
  async update(source_id: string, updates: WebSourceUpdate): Promise<WebSource> {
    // Convert component_status to JSON string if present
    const dbUpdates: Partial<WebSourcesTable> = {
      ...updates,
      component_status: updates.component_status
        ? JSON.stringify(updates.component_status)
        : undefined,
    };

    // Remove undefined values
    Object.keys(dbUpdates).forEach((key) => {
      if (dbUpdates[key as keyof typeof dbUpdates] === undefined) {
        delete dbUpdates[key as keyof typeof dbUpdates];
      }
    });

    await this.db
      .updateTable('web_sources')
      .set(dbUpdates)
      .where('source_id', '=', source_id)
      .execute();

    return this.findById(source_id);
  }

  /**
   * Delete a web source with full archive file cleanup
   * OPT-116: Now deletes archive files in addition to DB records
   *
   * 1. Query source data for paths
   * 2. Audit log before deletion
   * 3. Delete DB records (CASCADE handles images/videos/versions)
   * 4. Background file cleanup (non-blocking)
   */
  async delete(source_id: string): Promise<void> {
    const logger = getLogger();

    // 1. Get source data for audit and file cleanup
    const source = await this.db
      .selectFrom('web_sources')
      .select([
        'source_id',
        'url',
        'title',
        'locid',
        'archive_path',
        'screenshot_path',
        'pdf_path',
        'html_path',
        'warc_path',
      ])
      .where('source_id', '=', source_id)
      .executeTakeFirst();

    if (!source) {
      throw new Error(`Web source not found: ${source_id}`);
    }

    // 2. Audit log BEFORE deletion
    logger.info('WebSourcesRepository', `DELETION AUDIT: Deleting web source with files`, {
      source_id,
      url: source.url,
      title: source.title,
      locid: source.locid,
      archive_path: source.archive_path,
      deleted_at: new Date().toISOString(),
    });

    // 3. Delete DB records (web_source_images/videos/versions cascade)
    await this.db.deleteFrom('web_source_versions').where('source_id', '=', source_id).execute();
    await this.db.deleteFrom('web_source_images').where('source_id', '=', source_id).execute();
    await this.db.deleteFrom('web_source_videos').where('source_id', '=', source_id).execute();

    // OPT-119: Delete associated timeline events (web page publish dates)
    await this.db
      .deleteFrom('location_timeline')
      .where('source_ref', '=', source_id)
      .where('event_type', '=', 'custom')
      .where('event_subtype', '=', 'web_page')
      .execute();

    await this.db.deleteFrom('web_sources').where('source_id', '=', source_id).execute();

    // 4. Background file cleanup (non-blocking for instant UI response)
    if (source.archive_path) {
      setImmediate(async () => {
        try {
          // Delete the entire archive folder (contains all files)
          await fs.rm(source.archive_path!, { recursive: true, force: true });
          logger.info('WebSourcesRepository', `Deleted archive folder: ${source.archive_path}`);
        } catch (err) {
          // Folder might not exist if archive failed
          logger.warn('WebSourcesRepository', `Could not delete archive folder (may not exist): ${source.archive_path}`, {
            error: err instanceof Error ? err.message : String(err)
          });
        }
      });
    }
  }

  // ===========================================================================
  // Archive Status Management
  // ===========================================================================

  /**
   * Mark a source as archiving in progress
   */
  async markArchiving(source_id: string): Promise<void> {
    await this.db
      .updateTable('web_sources')
      .set({ status: 'archiving' })
      .where('source_id', '=', source_id)
      .execute();
  }

  /**
   * Mark a source as archive complete
   * OPT-110: Now accepts extracted_text for FTS5 full-text search
   */
  async markComplete(
    source_id: string,
    options: {
      archive_path: string;
      screenshot_path?: string | null;
      pdf_path?: string | null;
      html_path?: string | null;
      warc_path?: string | null;
      screenshot_hash?: string | null;
      pdf_hash?: string | null;
      html_hash?: string | null;
      warc_hash?: string | null;
      content_hash?: string | null;
      provenance_hash?: string | null;
      extracted_title?: string | null;
      extracted_author?: string | null;
      extracted_date?: string | null;
      extracted_publisher?: string | null;
      extracted_text?: string | null; // OPT-110: Full text for FTS5 search
      word_count?: number;
      image_count?: number;
      video_count?: number;
    }
  ): Promise<WebSource> {
    const archived_at = new Date().toISOString();

    await this.db
      .updateTable('web_sources')
      .set({
        status: 'complete',
        archived_at,
        archive_error: null,
        ...options,
      })
      .where('source_id', '=', source_id)
      .execute();

    return this.findById(source_id);
  }

  /**
   * Mark a source as partially archived (some components failed)
   * OPT-109 Fix: Now accepts all successful component data, not just archive_path
   * OPT-110: Now accepts extracted_text for FTS5 full-text search
   */
  async markPartial(
    source_id: string,
    component_status: ComponentStatus,
    options: {
      archive_path: string;
      screenshot_path?: string | null;
      pdf_path?: string | null;
      html_path?: string | null;
      warc_path?: string | null;
      screenshot_hash?: string | null;
      pdf_hash?: string | null;
      html_hash?: string | null;
      warc_hash?: string | null;
      content_hash?: string | null;
      provenance_hash?: string | null;
      extracted_title?: string | null;
      extracted_author?: string | null;
      extracted_date?: string | null;
      extracted_publisher?: string | null;
      extracted_text?: string | null; // OPT-110: Full text for FTS5 search
      word_count?: number;
      image_count?: number;
      video_count?: number;
    }
  ): Promise<WebSource> {
    const archived_at = new Date().toISOString();

    await this.db
      .updateTable('web_sources')
      .set({
        status: 'partial',
        archived_at,
        archive_error: null,
        component_status: JSON.stringify(component_status),
        ...options,
      })
      .where('source_id', '=', source_id)
      .execute();

    return this.findById(source_id);
  }

  /**
   * Mark a source as failed
   */
  async markFailed(source_id: string, error: string): Promise<WebSource> {
    const source = await this.findById(source_id);

    await this.db
      .updateTable('web_sources')
      .set({
        status: 'failed',
        archive_error: error,
        retry_count: source.retry_count + 1,
      })
      .where('source_id', '=', source_id)
      .execute();

    return this.findById(source_id);
  }

  /**
   * Reset a failed source to pending for retry
   */
  async resetToPending(source_id: string): Promise<WebSource> {
    await this.db
      .updateTable('web_sources')
      .set({
        status: 'pending',
        archive_error: null,
      })
      .where('source_id', '=', source_id)
      .execute();

    return this.findById(source_id);
  }

  /**
   * Update component status during archiving
   */
  async updateComponentStatus(source_id: string, component_status: ComponentStatus): Promise<void> {
    await this.db
      .updateTable('web_sources')
      .set({ component_status: JSON.stringify(component_status) })
      .where('source_id', '=', source_id)
      .execute();
  }

  // ===========================================================================
  // Version Management
  // ===========================================================================

  /**
   * Create a new version snapshot of a web source
   */
  async createVersion(
    source_id: string,
    options: {
      archive_path: string;
      screenshot_path?: string | null;
      pdf_path?: string | null;
      html_path?: string | null;
      warc_path?: string | null;
      screenshot_hash?: string | null;
      pdf_hash?: string | null;
      html_hash?: string | null;
      warc_hash?: string | null;
      content_hash?: string | null;
      word_count?: number;
      image_count?: number;
      video_count?: number;
    }
  ): Promise<WebSourceVersion> {
    const version_id = generateId();
    const archived_at = new Date().toISOString();

    // Get next version number
    const lastVersion = await this.db
      .selectFrom('web_source_versions')
      .select('version_number')
      .where('source_id', '=', source_id)
      .orderBy('version_number', 'desc')
      .limit(1)
      .executeTakeFirst();

    const version_number = lastVersion ? lastVersion.version_number + 1 : 1;

    // Check if content changed from previous version
    let content_changed = 0;
    let diff_summary: string | null = null;

    if (lastVersion && options.content_hash) {
      const previousVersion = await this.findVersionByNumber(source_id, lastVersion.version_number);
      if (previousVersion && previousVersion.content_hash !== options.content_hash) {
        content_changed = 1;
        diff_summary = `Content changed from version ${lastVersion.version_number}`;
      }
    }

    const version: WebSourceVersionsTable = {
      version_id,
      source_id,
      version_number,
      archived_at,
      archive_path: options.archive_path,
      screenshot_path: options.screenshot_path || null,
      pdf_path: options.pdf_path || null,
      html_path: options.html_path || null,
      warc_path: options.warc_path || null,
      word_count: options.word_count || null,
      image_count: options.image_count || null,
      video_count: options.video_count || null,
      screenshot_hash: options.screenshot_hash || null,
      pdf_hash: options.pdf_hash || null,
      html_hash: options.html_hash || null,
      warc_hash: options.warc_hash || null,
      content_hash: options.content_hash || null,
      content_changed,
      diff_summary,
    };

    await this.db.insertInto('web_source_versions').values(version).execute();

    return this.mapToWebSourceVersion(version);
  }

  /**
   * Find all versions for a web source
   */
  async findVersions(source_id: string): Promise<WebSourceVersion[]> {
    const results = await this.db
      .selectFrom('web_source_versions')
      .selectAll()
      .where('source_id', '=', source_id)
      .orderBy('version_number', 'desc')
      .execute();

    return results.map((r) => this.mapToWebSourceVersion(r));
  }

  /**
   * Find a specific version by number
   */
  async findVersionByNumber(source_id: string, version_number: number): Promise<WebSourceVersion | null> {
    const result = await this.db
      .selectFrom('web_source_versions')
      .selectAll()
      .where('source_id', '=', source_id)
      .where('version_number', '=', version_number)
      .executeTakeFirst();

    return result ? this.mapToWebSourceVersion(result) : null;
  }

  /**
   * Get latest version for a web source
   */
  async findLatestVersion(source_id: string): Promise<WebSourceVersion | null> {
    const result = await this.db
      .selectFrom('web_source_versions')
      .selectAll()
      .where('source_id', '=', source_id)
      .orderBy('version_number', 'desc')
      .limit(1)
      .executeTakeFirst();

    return result ? this.mapToWebSourceVersion(result) : null;
  }

  /**
   * Get version count for a web source
   */
  async countVersions(source_id: string): Promise<number> {
    const result = await this.db
      .selectFrom('web_source_versions')
      .select((eb) => eb.fn.count<number>('version_id').as('count'))
      .where('source_id', '=', source_id)
      .executeTakeFirstOrThrow();

    return result.count;
  }

  // ===========================================================================
  // Full-Text Search
  // ===========================================================================

  /**
   * Search web sources using full-text search
   * Searches URL, title, extracted text, author, publisher
   */
  async search(query: string, options?: { locid?: string; limit?: number }): Promise<WebSourceSearchResult[]> {
    const limit = options?.limit || 50;

    // Use FTS5 search on web_sources_fts table
    let queryBuilder = this.db
      .selectFrom('web_sources_fts' as any)
      .innerJoin('web_sources', 'web_sources_fts.source_id' as any, 'web_sources.source_id')
      .select([
        'web_sources.source_id',
        'web_sources.url',
        'web_sources.title',
        'web_sources.locid',
        sql<string>`snippet(web_sources_fts, 0, '<mark>', '</mark>', '...', 32)`.as('snippet'),
        sql<number>`rank`.as('rank'),
      ])
      .where(sql`web_sources_fts MATCH ${query}` as any);

    if (options?.locid) {
      queryBuilder = queryBuilder.where('web_sources.locid', '=', options.locid);
    }

    const results = await queryBuilder.orderBy('rank').limit(limit).execute();

    return results as WebSourceSearchResult[];
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get overall statistics for web sources
   */
  async getStats(): Promise<WebSourceStats> {
    const counts = await this.db
      .selectFrom('web_sources')
      .select([
        sql<number>`COUNT(*)`.as('total'),
        sql<number>`SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)`.as('pending'),
        sql<number>`SUM(CASE WHEN status = 'archiving' THEN 1 ELSE 0 END)`.as('archiving'),
        sql<number>`SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END)`.as('complete'),
        sql<number>`SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END)`.as('partial'),
        sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`.as('failed'),
        sql<number>`SUM(image_count)`.as('total_images'),
        sql<number>`SUM(video_count)`.as('total_videos'),
        sql<number>`SUM(word_count)`.as('total_words'),
      ])
      .executeTakeFirstOrThrow();

    return {
      total: counts.total || 0,
      pending: counts.pending || 0,
      archiving: counts.archiving || 0,
      complete: counts.complete || 0,
      partial: counts.partial || 0,
      failed: counts.failed || 0,
      total_images: counts.total_images || 0,
      total_videos: counts.total_videos || 0,
      total_words: counts.total_words || 0,
    };
  }

  /**
   * Get statistics for a specific location
   */
  async getStatsByLocation(locid: string): Promise<WebSourceStats> {
    const counts = await this.db
      .selectFrom('web_sources')
      .select([
        sql<number>`COUNT(*)`.as('total'),
        sql<number>`SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)`.as('pending'),
        sql<number>`SUM(CASE WHEN status = 'archiving' THEN 1 ELSE 0 END)`.as('archiving'),
        sql<number>`SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END)`.as('complete'),
        sql<number>`SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END)`.as('partial'),
        sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`.as('failed'),
        sql<number>`SUM(image_count)`.as('total_images'),
        sql<number>`SUM(video_count)`.as('total_videos'),
        sql<number>`SUM(word_count)`.as('total_words'),
      ])
      .where('locid', '=', locid)
      .executeTakeFirstOrThrow();

    return {
      total: counts.total || 0,
      pending: counts.pending || 0,
      archiving: counts.archiving || 0,
      complete: counts.complete || 0,
      partial: counts.partial || 0,
      failed: counts.failed || 0,
      total_images: counts.total_images || 0,
      total_videos: counts.total_videos || 0,
      total_words: counts.total_words || 0,
    };
  }

  /**
   * Get total count
   */
  async count(): Promise<number> {
    const result = await this.db
      .selectFrom('web_sources')
      .select((eb) => eb.fn.count<number>('source_id').as('count'))
      .executeTakeFirstOrThrow();

    return result.count;
  }

  /**
   * Get count by location
   */
  async countByLocation(locid: string): Promise<number> {
    const result = await this.db
      .selectFrom('web_sources')
      .select((eb) => eb.fn.count<number>('source_id').as('count'))
      .where('locid', '=', locid)
      .executeTakeFirstOrThrow();

    return result.count;
  }

  /**
   * Get count by sub-location
   */
  async countBySubLocation(subid: string): Promise<number> {
    const result = await this.db
      .selectFrom('web_sources')
      .select((eb) => eb.fn.count<number>('source_id').as('count'))
      .where('subid', '=', subid)
      .executeTakeFirstOrThrow();

    return result.count;
  }

  // ===========================================================================
  // Bookmark Migration (Deprecated)
  // ===========================================================================

  /**
   * Migrate existing bookmarks to web sources
   * @deprecated Migration 57 already performed this migration and dropped the bookmarks table.
   * This method is preserved for API compatibility but is a no-op.
   */
  async migrateFromBookmarks(): Promise<{ migrated: number; failed: number }> {
    // Migration already completed in database migration 57.
    // The bookmarks table no longer exists, so this is a no-op.
    console.log('migrateFromBookmarks: Migration already complete (bookmarks table dropped in migration 57)');
    return { migrated: 0, failed: 0 };
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Generate source ID from URL using BLAKE3 hash
   */
  private generateSourceId(url: string): string {
    // Normalize URL before hashing (remove trailing slash, lowercase host)
    const normalizedUrl = this.normalizeUrl(url);
    return calculateHashBuffer(Buffer.from(normalizedUrl, 'utf-8'));
  }

  /**
   * Normalize URL for consistent hashing
   */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Lowercase the host
      parsed.hostname = parsed.hostname.toLowerCase();
      // Remove trailing slash from path
      if (parsed.pathname.endsWith('/') && parsed.pathname.length > 1) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }
      // Remove default ports
      if (
        (parsed.protocol === 'https:' && parsed.port === '443') ||
        (parsed.protocol === 'http:' && parsed.port === '80')
      ) {
        parsed.port = '';
      }
      return parsed.toString();
    } catch {
      // If URL parsing fails, return as-is
      return url;
    }
  }

  /**
   * Map database row to WebSource type
   */
  private mapToWebSource(row: any): WebSource {
    return {
      ...row,
      source_type: row.source_type as WebSourceType,
      status: row.status as WebSourceStatus,
      component_status: row.component_status ? JSON.parse(row.component_status) : null,
    };
  }

  /**
   * Map database row to WebSourceVersion type
   */
  private mapToWebSourceVersion(row: WebSourceVersionsTable): WebSourceVersion {
    return {
      ...row,
      content_changed: row.content_changed === 1,
    };
  }

  // =============================================================================
  // OPT-111: Per-Image and Per-Video Metadata Methods
  // =============================================================================

  /**
   * Get all images for a web source
   */
  async findImages(sourceId: string): Promise<WebSourceImageRow[]> {
    return await this.db
      .selectFrom('web_source_images')
      .selectAll()
      .where('source_id', '=', sourceId)
      .orderBy('image_index', 'asc')
      .execute();
  }

  /**
   * Get all videos for a web source
   */
  async findVideos(sourceId: string): Promise<WebSourceVideoRow[]> {
    return await this.db
      .selectFrom('web_source_videos')
      .selectAll()
      .where('source_id', '=', sourceId)
      .orderBy('video_index', 'asc')
      .execute();
  }

  /**
   * Insert image metadata for a web source
   */
  async insertImage(sourceId: string, imageIndex: number, data: {
    url: string;
    localPath?: string;
    hash?: string;
    width?: number;
    height?: number;
    size?: number;
    originalFilename?: string;
    alt?: string;
    caption?: string;
    credit?: string;
    attribution?: string;
    srcsetVariants?: string[];
    contextHtml?: string;
    linkUrl?: string;
    exif?: Record<string, unknown>;
    isHiRes?: boolean;
    isHero?: boolean;
  }): Promise<void> {
    await this.db.insertInto('web_source_images').values({
      source_id: sourceId,
      image_index: imageIndex,
      url: data.url,
      local_path: data.localPath || null,
      hash: data.hash || null,
      width: data.width || null,
      height: data.height || null,
      size: data.size || null,
      original_filename: data.originalFilename || null,
      alt: data.alt || null,
      caption: data.caption || null,
      credit: data.credit || null,
      attribution: data.attribution || null,
      srcset_variants: data.srcsetVariants ? JSON.stringify(data.srcsetVariants) : null,
      context_html: data.contextHtml || null,
      link_url: data.linkUrl || null,
      exif_json: data.exif ? JSON.stringify(data.exif) : null,
      is_hi_res: data.isHiRes ? 1 : 0,
      is_hero: data.isHero ? 1 : 0,
    }).execute();
  }

  /**
   * Insert video metadata for a web source
   */
  async insertVideo(sourceId: string, videoIndex: number, data: {
    url: string;
    localPath?: string;
    hash?: string;
    title?: string;
    description?: string;
    duration?: number;
    size?: number;
    platform?: string;
    uploader?: string;
    uploaderUrl?: string;
    uploadDate?: string;
    viewCount?: number;
    likeCount?: number;
    tags?: string[];
    categories?: string[];
    thumbnailUrl?: string;
    thumbnailPath?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insertInto('web_source_videos').values({
      source_id: sourceId,
      video_index: videoIndex,
      url: data.url,
      local_path: data.localPath || null,
      hash: data.hash || null,
      title: data.title || null,
      description: data.description || null,
      duration: data.duration || null,
      size: data.size || null,
      platform: data.platform || null,
      uploader: data.uploader || null,
      uploader_url: data.uploaderUrl || null,
      upload_date: data.uploadDate || null,
      view_count: data.viewCount || null,
      like_count: data.likeCount || null,
      tags: data.tags ? JSON.stringify(data.tags) : null,
      categories: data.categories ? JSON.stringify(data.categories) : null,
      thumbnail_url: data.thumbnailUrl || null,
      thumbnail_path: data.thumbnailPath || null,
      metadata_json: data.metadata ? JSON.stringify(data.metadata) : null,
    }).execute();
  }

  /**
   * Delete all images for a source (used during re-archive)
   */
  async deleteImages(sourceId: string): Promise<void> {
    await this.db
      .deleteFrom('web_source_images')
      .where('source_id', '=', sourceId)
      .execute();
  }

  /**
   * Delete all videos for a source (used during re-archive)
   */
  async deleteVideos(sourceId: string): Promise<void> {
    await this.db
      .deleteFrom('web_source_videos')
      .where('source_id', '=', sourceId)
      .execute();
  }

  /**
   * OPT-112: Batch insert images with full metadata
   * Clears existing images first, then inserts all new ones
   */
  async insertSourceImages(sourceId: string, images: Array<{
    url: string;
    localPath?: string;
    hash?: string;
    width?: number;
    height?: number;
    size?: number;
    originalFilename?: string;
    alt?: string;
    caption?: string;
    credit?: string;
    attribution?: string;
    srcsetVariants?: string[];
    contextHtml?: string;
    linkUrl?: string;
    exifData?: Record<string, unknown>;
    isHiRes?: boolean;
    isHero?: boolean;
  }>): Promise<void> {
    if (images.length === 0) return;

    // Clear existing images for this source
    await this.deleteImages(sourceId);

    // Insert all images
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      await this.insertImage(sourceId, i, {
        url: img.url,
        localPath: img.localPath,
        hash: img.hash,
        width: img.width,
        height: img.height,
        size: img.size,
        originalFilename: img.originalFilename,
        alt: img.alt,
        caption: img.caption,
        credit: img.credit,
        attribution: img.attribution,
        srcsetVariants: img.srcsetVariants,
        contextHtml: img.contextHtml,
        linkUrl: img.linkUrl,
        exif: img.exifData,
        isHiRes: img.isHiRes,
        isHero: img.isHero,
      });
    }
  }

  /**
   * OPT-112: Batch insert videos with full metadata
   * Clears existing videos first, then inserts all new ones
   */
  async insertSourceVideos(sourceId: string, videos: Array<{
    url: string;
    localPath?: string;
    hash?: string;
    title?: string;
    description?: string;
    duration?: number;
    size?: number;
    platform?: string;
    uploader?: string;
    uploaderUrl?: string;
    uploadDate?: string;
    viewCount?: number;
    likeCount?: number;
    tags?: string[];
    categories?: string[];
    thumbnailUrl?: string;
    thumbnailPath?: string;
    metadataJson?: string;
  }>): Promise<void> {
    if (videos.length === 0) return;

    // Clear existing videos for this source
    await this.deleteVideos(sourceId);

    // Insert all videos
    for (let i = 0; i < videos.length; i++) {
      const vid = videos[i];
      await this.insertVideo(sourceId, i, {
        url: vid.url,
        localPath: vid.localPath,
        hash: vid.hash,
        title: vid.title,
        description: vid.description,
        duration: vid.duration,
        size: vid.size,
        platform: vid.platform,
        uploader: vid.uploader,
        uploaderUrl: vid.uploaderUrl,
        uploadDate: vid.uploadDate,
        viewCount: vid.viewCount,
        likeCount: vid.likeCount,
        tags: vid.tags,
        categories: vid.categories,
        thumbnailUrl: vid.thumbnailUrl,
        thumbnailPath: vid.thumbnailPath,
        metadata: vid.metadataJson ? JSON.parse(vid.metadataJson) : undefined,
      });
    }
  }

  /**
   * OPT-112: Clear all media for a source (images + videos)
   * Used before re-archiving
   */
  async clearSourceMedia(sourceId: string): Promise<void> {
    await this.deleteImages(sourceId);
    await this.deleteVideos(sourceId);
  }

  /**
   * Update page-level metadata fields
   */
  async updatePageMetadata(sourceId: string, data: {
    domain?: string;
    extractedLinks?: Array<{ url: string; text: string; rel: string | null }>;
    pageMetadata?: Record<string, unknown>;
    httpHeaders?: Record<string, string>;
    canonicalUrl?: string;
    language?: string;
    faviconPath?: string;
    // OPT-115: Enhanced structured metadata
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    twitterCardJson?: string;
    schemaOrgJson?: string;
    captureMethod?: string;
    puppeteerCapturedAt?: string;
  }): Promise<void> {
    // Extract OG data from pageMetadata if not provided directly
    const pageMetadataObj = data.pageMetadata as Record<string, unknown> | undefined;
    const ogData = pageMetadataObj?.openGraph as Record<string, unknown> | undefined;
    const twitterData = pageMetadataObj?.twitterCards as Record<string, unknown> | undefined;
    const schemaData = pageMetadataObj?.schemaOrg as unknown;

    await this.db
      .updateTable('web_sources')
      .set({
        domain: data.domain || null,
        extracted_links: data.extractedLinks ? JSON.stringify(data.extractedLinks) : null,
        page_metadata_json: data.pageMetadata ? JSON.stringify(data.pageMetadata) : null,
        http_headers_json: data.httpHeaders ? JSON.stringify(data.httpHeaders) : null,
        canonical_url: data.canonicalUrl || null,
        language: data.language || null,
        favicon_path: data.faviconPath || null,
        // OPT-115: Store structured metadata in dedicated columns for queryability
        og_title: data.ogTitle || (ogData?.title as string) || null,
        og_description: data.ogDescription || (ogData?.description as string) || null,
        og_image: data.ogImage || (ogData?.image as string) || null,
        twitter_card_json: data.twitterCardJson || (twitterData ? JSON.stringify(twitterData) : null),
        schema_org_json: data.schemaOrgJson || (schemaData ? JSON.stringify(schemaData) : null),
        // Track capture method (puppeteer for orchestrator-based archiving)
        capture_method: data.captureMethod || 'puppeteer',
        puppeteer_captured_at: data.puppeteerCapturedAt || new Date().toISOString(),
      })
      .where('source_id', '=', sourceId)
      .execute();
  }
}
