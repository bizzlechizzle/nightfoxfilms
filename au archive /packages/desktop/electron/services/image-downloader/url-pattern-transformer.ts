/**
 * URL Pattern Transformer
 *
 * Transforms thumbnail/resized image URLs into original full-resolution URLs.
 * Patterns are stored in database and can be trained over time.
 *
 * Built-in patterns cover:
 * - WordPress (thumbnail suffixes, scaled images)
 * - CDNs (Jetpack, Cloudflare, imgix)
 * - Image hosts (Imgur, Flickr, Tumblr, Medium)
 * - Generic query string resize parameters
 *
 * @module services/image-downloader/url-pattern-transformer
 */

import type Database from 'better-sqlite3';
import { getLogger } from '../logger-service';

const logger = getLogger();

export type SiteType = 'wordpress' | 'cdn' | 'hosting' | 'generic';

export interface UrlPattern {
  patternId: string;
  name: string;
  siteType: SiteType;
  domainRegex: RegExp;
  pathRegex: RegExp;
  transform: (url: string, match: RegExpMatchArray) => string;
  confidence: number;
}

export interface TransformResult {
  originalUrl: string;
  transformedUrl: string;
  patternId: string;
  patternName: string;
  confidence: number;
}

export interface DbUrlPattern {
  pattern_id: string;
  name: string;
  site_type: string;
  domain_regex: string;
  path_regex: string;
  transform_js: string;
  confidence: number;
  success_count: number;
  fail_count: number;
  is_enabled: number;
  is_builtin: number;
}

// ============================================================================
// Built-in Patterns
// ============================================================================

const BUILTIN_PATTERNS: UrlPattern[] = [
  // WordPress default thumbnail suffix (-800x600, -1024x768, etc.)
  {
    patternId: 'wp_thumbnail_suffix',
    name: 'WordPress Thumbnail Suffix',
    siteType: 'wordpress',
    domainRegex: /.*/,
    pathRegex: /^(.*\/wp-content\/uploads\/.*)-(\d+x\d+)\.(jpg|jpeg|png|gif|webp)$/i,
    transform: (_url, match) => `${match[1]}.${match[3]}`,
    confidence: 0.95,
  },

  // WordPress scaled suffix (-scaled)
  {
    patternId: 'wp_scaled_suffix',
    name: 'WordPress Scaled Suffix',
    siteType: 'wordpress',
    domainRegex: /.*/,
    pathRegex: /^(.*\/wp-content\/uploads\/.*)-scaled\.(jpg|jpeg|png|gif|webp)$/i,
    transform: (_url, match) => `${match[1]}.${match[2]}`,
    confidence: 0.9,
  },

  // WordPress rotated suffix (-e1234567890123-scaled, rotation hash)
  {
    patternId: 'wp_rotated_suffix',
    name: 'WordPress Rotated Suffix',
    siteType: 'wordpress',
    domainRegex: /.*/,
    pathRegex: /^(.*\/wp-content\/uploads\/.*)-e\d+(-scaled)?\.(jpg|jpeg|png|gif|webp)$/i,
    transform: (_url, match) => `${match[1]}.${match[3]}`,
    confidence: 0.85,
  },

  // Jetpack/WordPress.com CDN (?resize=, ?fit=, ?w=, ?h=)
  {
    patternId: 'jetpack_cdn',
    name: 'Jetpack CDN Resize',
    siteType: 'cdn',
    domainRegex: /^i\d\.wp\.com$/,
    pathRegex: /^(.+)\?(?:resize|fit|w|h)=[\d,]+.*$/i,
    transform: (_url, match) => match[1],
    confidence: 0.92,
  },

  // Cloudflare Image Resizing (/cdn-cgi/image/...)
  {
    patternId: 'cloudflare_resize',
    name: 'Cloudflare Image Resizing',
    siteType: 'cdn',
    domainRegex: /.*/,
    pathRegex: /^(.*)\/cdn-cgi\/image\/[^/]+\/(.+)$/,
    transform: (_url, match) => `${match[1]}/${match[2]}`,
    confidence: 0.93,
  },

  // imgix CDN (query parameters)
  {
    patternId: 'imgix_cdn',
    name: 'imgix CDN Parameters',
    siteType: 'cdn',
    domainRegex: /\.imgix\.net$/,
    pathRegex: /^(.+)\?.*$/,
    transform: (_url, match) => match[1],
    confidence: 0.9,
  },

  // Photon CDN (WordPress.com image proxy)
  {
    patternId: 'photon_cdn',
    name: 'Photon CDN',
    siteType: 'cdn',
    domainRegex: /^i\d\.wp\.com$/,
    pathRegex: /^\/(.+\.(?:jpg|jpeg|png|gif|webp))(?:\?.*)?$/i,
    transform: (url, match) => {
      // Extract original domain from path
      const parsedUrl = new URL(url.startsWith('http') ? url : `https://i0.wp.com${url}`);
      const originalPath = parsedUrl.pathname.replace(/^\//, '');
      return `https://${originalPath}`;
    },
    confidence: 0.88,
  },

  // Imgur thumbnails (suffix before extension: s, b, t, m, l, h)
  {
    patternId: 'imgur_thumbnail',
    name: 'Imgur Thumbnail Suffix',
    siteType: 'hosting',
    domainRegex: /^i\.imgur\.com$/,
    pathRegex: /^(.+\/[a-zA-Z0-9]+)[sbtmlh]\.(jpg|jpeg|png|gif|webp)$/i,
    transform: (_url, match) => `${match[1]}.${match[2]}`,
    confidence: 0.95,
  },

  // Flickr size suffixes (_s, _q, _t, _m, _n, _z, _c, _l, _k, _h, _o)
  {
    patternId: 'flickr_size',
    name: 'Flickr Size Suffix',
    siteType: 'hosting',
    domainRegex: /\.staticflickr\.com$/,
    pathRegex: /^(.+)_[sqtmnzclkoh]\.(jpg|jpeg|png|gif)$/i,
    transform: (_url, match) => `${match[1]}_o.${match[2]}`,
    confidence: 0.85, // Lower - original might not be public
  },

  // Flickr farm URLs
  {
    patternId: 'flickr_farm',
    name: 'Flickr Farm URLs',
    siteType: 'hosting',
    domainRegex: /^farm\d+\.staticflickr\.com$/,
    pathRegex: /^(.+)_[sqtmnzclkho]\.(jpg|jpeg|png|gif)$/i,
    transform: (_url, match) => `${match[1]}_o.${match[2]}`,
    confidence: 0.85,
  },

  // Tumblr size variants (/s1280x1920/, /s640x960/, etc.)
  {
    patternId: 'tumblr_size',
    name: 'Tumblr Size Path',
    siteType: 'hosting',
    domainRegex: /\.media\.tumblr\.com$/,
    pathRegex: /^(.+)\/s(\d+x\d+)\/(.+)$/,
    transform: (_url, match) => `${match[1]}/s2048x3072/${match[3]}`,
    confidence: 0.88,
  },

  // Medium max width (/max/800/, /max/1200/)
  {
    patternId: 'medium_maxwidth',
    name: 'Medium Max Width',
    siteType: 'hosting',
    domainRegex: /^miro\.medium\.com$/,
    pathRegex: /^(.+)\/max\/\d+\/(.+)$/,
    transform: (_url, match) => `${match[1]}/max/4800/${match[2]}`,
    confidence: 0.9,
  },

  // DeviantArt thumbnails (/200H/, /300W/, etc.)
  {
    patternId: 'deviantart_thumb',
    name: 'DeviantArt Thumbnails',
    siteType: 'hosting',
    domainRegex: /\.deviantart\.net$/,
    pathRegex: /^(.+)\/\d+[HW]\/(.+)$/i,
    transform: (_url, match) => `${match[1]}/${match[2]}`,
    confidence: 0.82,
  },

  // Generic query string resize parameters
  {
    patternId: 'generic_query_resize',
    name: 'Generic Query Resize Params',
    siteType: 'generic',
    domainRegex: /.*/,
    pathRegex: /^(.+\.(jpg|jpeg|png|gif|webp))\?.*(?:w|width|h|height|resize|size|fit|crop|scale)=\d+.*$/i,
    transform: (_url, match) => match[1],
    confidence: 0.7,
  },

  // Generic thumbnail path patterns (/thumb/, /thumbnails/, /small/)
  {
    patternId: 'generic_thumb_path',
    name: 'Generic Thumbnail Path',
    siteType: 'generic',
    domainRegex: /.*/,
    pathRegex: /^(.+)\/(thumb|thumbnails?|small|preview|resize[ds]?)\/(.+\.(jpg|jpeg|png|gif|webp))$/i,
    transform: (_url, match) => `${match[1]}/${match[3]}`,
    confidence: 0.6,
  },
];

/**
 * URL Pattern Transformer
 *
 * Transforms thumbnail URLs to full-resolution URLs using pattern matching.
 */
export class UrlPatternTransformer {
  private patterns: UrlPattern[] = [...BUILTIN_PATTERNS];
  private db: Database.Database | null = null;

  constructor(db?: Database.Database) {
    if (db) {
      this.db = db;
      this.loadCustomPatterns();
    }
  }

  /**
   * Load custom patterns from database
   */
  private loadCustomPatterns(): void {
    if (!this.db) return;

    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM url_patterns WHERE is_enabled = 1 AND is_builtin = 0`
        )
        .all() as DbUrlPattern[];

      for (const row of rows) {
        try {
          // Create transform function from stored JS code
          // eslint-disable-next-line @typescript-eslint/no-implied-eval
          const transformFn = new Function(
            'url',
            'match',
            row.transform_js
          ) as UrlPattern['transform'];

          this.patterns.push({
            patternId: row.pattern_id,
            name: row.name,
            siteType: row.site_type as SiteType,
            domainRegex: new RegExp(row.domain_regex),
            pathRegex: new RegExp(row.path_regex),
            transform: transformFn,
            confidence: row.confidence,
          });
        } catch (err) {
          logger.error(
            'UrlPatternTransformer',
            `Failed to load pattern ${row.pattern_id}`,
            err as Error
          );
        }
      }

      logger.debug('UrlPatternTransformer', 'Loaded custom patterns', {
        count: rows.length,
      });
    } catch (err) {
      logger.error(
        'UrlPatternTransformer',
        'Failed to load custom patterns',
        err as Error
      );
    }
  }

  /**
   * Transform a URL to its potential full-resolution versions
   * Returns all matching transformations sorted by confidence
   *
   * @param url - URL to transform
   * @returns Array of transformation results sorted by confidence (highest first)
   */
  transform(url: string): TransformResult[] {
    const results: TransformResult[] = [];

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      logger.warn('UrlPatternTransformer', 'Invalid URL', { url });
      return results;
    }

    const pathAndQuery = parsedUrl.pathname + parsedUrl.search;

    for (const pattern of this.patterns) {
      // Check domain match
      if (!pattern.domainRegex.test(parsedUrl.hostname)) continue;

      // Check path match
      const match = pathAndQuery.match(pattern.pathRegex);
      if (!match) continue;

      try {
        const transformedPath = pattern.transform(pathAndQuery, match);

        // Reconstruct full URL
        let transformedUrl: string;
        if (transformedPath.startsWith('http')) {
          // Transform returned absolute URL
          transformedUrl = transformedPath;
        } else {
          // Transform returned path, reconstruct URL
          transformedUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${transformedPath}`;
        }

        // Don't include if no change
        if (transformedUrl === url) continue;

        results.push({
          originalUrl: url,
          transformedUrl,
          patternId: pattern.patternId,
          patternName: pattern.name,
          confidence: pattern.confidence,
        });
      } catch (err) {
        logger.error(
          'UrlPatternTransformer',
          `Pattern ${pattern.patternId} transform failed`,
          err as Error,
          { url }
        );
      }
    }

    // Sort by confidence (highest first)
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get the best transformation for a URL
   * @param url - URL to transform
   * @returns Best transformation or null if none found
   */
  transformBest(url: string): TransformResult | null {
    const results = this.transform(url);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Record pattern success/failure for learning
   * Updates confidence based on success rate
   *
   * @param patternId - Pattern that was used
   * @param success - Whether the transformed URL was valid
   */
  recordOutcome(patternId: string, success: boolean): void {
    if (!this.db) return;

    try {
      const column = success ? 'success_count' : 'fail_count';
      this.db
        .prepare(
          `
        UPDATE url_patterns
        SET ${column} = ${column} + 1,
            confidence = CAST(success_count AS REAL) / NULLIF(success_count + fail_count + 1, 0),
            updated_at = datetime('now')
        WHERE pattern_id = ?
      `
        )
        .run(patternId);

      logger.debug('UrlPatternTransformer', 'Recorded pattern outcome', {
        patternId,
        success,
      });
    } catch (err) {
      logger.error(
        'UrlPatternTransformer',
        'Failed to record outcome',
        err as Error,
        { patternId }
      );
    }
  }

  /**
   * Seed database with built-in patterns
   * Should be called on first run or after migrations
   */
  seedBuiltinPatterns(): void {
    if (!this.db) return;

    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO url_patterns
      (pattern_id, name, site_type, domain_regex, path_regex, transform_js, confidence, is_builtin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
    `);

    const transaction = this.db.transaction(() => {
      for (const p of BUILTIN_PATTERNS) {
        // Convert function to returnable JS code
        const fnBody = p.transform.toString();
        // Extract the function body for storage
        const transformJs = fnBody.includes('=>')
          ? `return (${fnBody})(url, match);`
          : fnBody;

        insert.run(
          p.patternId,
          p.name,
          p.siteType,
          p.domainRegex.source,
          p.pathRegex.source,
          transformJs,
          p.confidence
        );
      }
    });

    try {
      transaction();
      logger.info('UrlPatternTransformer', 'Seeded built-in patterns', {
        count: BUILTIN_PATTERNS.length,
      });
    } catch (err) {
      logger.error(
        'UrlPatternTransformer',
        'Failed to seed patterns',
        err as Error
      );
    }
  }

  /**
   * Add a custom pattern
   */
  addPattern(pattern: {
    patternId: string;
    name: string;
    siteType: SiteType;
    domainRegex: string;
    pathRegex: string;
    transformJs: string;
    testInput?: string;
    testExpected?: string;
  }): void {
    if (!this.db) return;

    this.db
      .prepare(
        `
      INSERT INTO url_patterns
      (pattern_id, name, site_type, domain_regex, path_regex, transform_js, test_input, test_expected, is_builtin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `
      )
      .run(
        pattern.patternId,
        pattern.name,
        pattern.siteType,
        pattern.domainRegex,
        pattern.pathRegex,
        pattern.transformJs,
        pattern.testInput || null,
        pattern.testExpected || null
      );

    // Reload patterns
    this.loadCustomPatterns();
  }

  /**
   * Get all patterns (for UI display)
   */
  getAllPatterns(): Array<DbUrlPattern & { isBuiltin: boolean }> {
    if (!this.db) {
      return BUILTIN_PATTERNS.map((p) => ({
        pattern_id: p.patternId,
        name: p.name,
        site_type: p.siteType,
        domain_regex: p.domainRegex.source,
        path_regex: p.pathRegex.source,
        transform_js: p.transform.toString(),
        confidence: p.confidence,
        success_count: 0,
        fail_count: 0,
        is_enabled: 1,
        is_builtin: 1,
        isBuiltin: true,
      }));
    }

    return this.db
      .prepare(`SELECT * FROM url_patterns ORDER BY confidence DESC`)
      .all() as Array<DbUrlPattern & { isBuiltin: boolean }>;
  }

  /**
   * Test a pattern against a URL
   */
  testPattern(
    patternId: string,
    url: string
  ): { matched: boolean; result?: string; error?: string } {
    const pattern = this.patterns.find((p) => p.patternId === patternId);
    if (!pattern) {
      return { matched: false, error: 'Pattern not found' };
    }

    try {
      const results = this.transform(url);
      const match = results.find((r) => r.patternId === patternId);
      if (match) {
        return { matched: true, result: match.transformedUrl };
      }
      return { matched: false };
    } catch (err) {
      return { matched: false, error: (err as Error).message };
    }
  }
}

/**
 * Default instance (without database)
 */
export const urlPatternTransformer = new UrlPatternTransformer();

/**
 * Create instance with database connection
 */
export function createUrlPatternTransformer(
  db: Database.Database
): UrlPatternTransformer {
  return new UrlPatternTransformer(db);
}
