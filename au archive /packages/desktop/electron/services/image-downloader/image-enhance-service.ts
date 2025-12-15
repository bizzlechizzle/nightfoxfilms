/**
 * Smart Image Enhance Service
 *
 * Intelligently discovers the highest-resolution version of any image URL.
 * Uses recursive candidate generation, multi-site patterns, and validation
 * to find the TRUE original - not just one level up.
 *
 * Key capabilities:
 * 1. Recursive suffix stripping (removes -WxH, -scaled, -N variants iteratively)
 * 2. Multi-site pattern library (WordPress, Imgur, Flickr, etc.)
 * 3. Format preference (jpg/png > webp)
 * 4. Parallel candidate validation via HEAD requests
 * 5. Size-based ranking to find largest (highest res) version
 *
 * @module services/image-downloader/image-enhance-service
 */

import { getLogger } from '../logger-service';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface ImageCandidate {
  url: string;
  source: 'original' | 'pattern' | 'suffix_strip' | 'extension_swap' | 'recursive';
  patternName?: string;
  depth: number; // How many transformations from original
}

export interface ValidatedCandidate extends ImageCandidate {
  exists: boolean;
  contentLength?: number;
  contentType?: string;
  error?: string;
}

export interface EnhanceResult {
  originalUrl: string;
  bestUrl: string;
  bestSize: number;
  allCandidates: ValidatedCandidate[];
  improvement: number; // ratio vs original size
}

export interface EnhanceOptions {
  /** Maximum candidates to generate before validation */
  maxCandidates?: number;
  /** Timeout for each HEAD request in ms */
  headTimeout?: number;
  /** Prefer jpg/png over webp */
  preferTraditionalFormats?: boolean;
  /** Maximum recursion depth for suffix stripping */
  maxDepth?: number;
  /** Validate candidates (set false for dry-run) */
  validate?: boolean;
}

const DEFAULT_OPTIONS: Required<EnhanceOptions> = {
  maxCandidates: 50,
  headTimeout: 5000,
  preferTraditionalFormats: true,
  maxDepth: 5,
  validate: true,
};

// ============================================================================
// Rate Limiting & Caching
// ============================================================================

/**
 * Validation cache to avoid redundant HEAD requests
 * Key: URL, Value: { result, timestamp }
 */
interface CacheEntry {
  result: ValidatedCandidate;
  timestamp: number;
}

const VALIDATION_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Per-domain rate limiting
 * Tracks last request time per domain to enforce delays
 */
const DOMAIN_LAST_REQUEST = new Map<string, number>();
const MIN_DOMAIN_DELAY_MS = 100; // 100ms between requests to same domain
const GLOBAL_RATE_LIMIT_MS = 20; // 50 requests/second max globally

let lastGlobalRequest = 0;

/**
 * Clean old cache entries
 */
function cleanCache(): void {
  const now = Date.now();
  for (const [url, entry] of VALIDATION_CACHE.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      VALIDATION_CACHE.delete(url);
    }
  }
}

/**
 * Get cached validation result if available and fresh
 */
function getCachedResult(url: string): ValidatedCandidate | null {
  const entry = VALIDATION_CACHE.get(url);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    VALIDATION_CACHE.delete(url);
    return null;
  }

  return entry.result;
}

/**
 * Cache a validation result
 */
function cacheResult(url: string, result: ValidatedCandidate): void {
  VALIDATION_CACHE.set(url, {
    result,
    timestamp: Date.now(),
  });

  // Periodic cleanup
  if (VALIDATION_CACHE.size > 1000) {
    cleanCache();
  }
}

/**
 * Wait for rate limit (both global and per-domain)
 */
async function waitForRateLimit(domain: string): Promise<void> {
  const now = Date.now();

  // Global rate limit
  const globalWait = Math.max(0, lastGlobalRequest + GLOBAL_RATE_LIMIT_MS - now);

  // Per-domain rate limit
  const domainLast = DOMAIN_LAST_REQUEST.get(domain) || 0;
  const domainWait = Math.max(0, domainLast + MIN_DOMAIN_DELAY_MS - now);

  const waitTime = Math.max(globalWait, domainWait);

  if (waitTime > 0) {
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  // Update timestamps
  lastGlobalRequest = Date.now();
  DOMAIN_LAST_REQUEST.set(domain, Date.now());
}

/**
 * Get cache statistics for debugging
 */
export function getEnhanceCacheStats(): {
  cacheSize: number;
  domainsTracked: number;
} {
  return {
    cacheSize: VALIDATION_CACHE.size,
    domainsTracked: DOMAIN_LAST_REQUEST.size,
  };
}

/**
 * Clear the validation cache
 */
export function clearEnhanceCache(): void {
  VALIDATION_CACHE.clear();
  DOMAIN_LAST_REQUEST.clear();
}

// ============================================================================
// Suffix Patterns (for recursive stripping)
// ============================================================================

/**
 * Patterns to strip from filenames, in order of likelihood.
 * Each pattern should match at the END of the filename (before extension).
 */
const SUFFIX_PATTERNS = [
  // WordPress dimension suffix: -1024x768, -800x600, etc.
  { name: 'wp_dimensions', regex: /-\d+x\d+$/ },

  // WordPress scaled suffix
  { name: 'wp_scaled', regex: /-scaled$/ },

  // WordPress numeric variant: -1, -2, -3, etc. (uploaded duplicates)
  { name: 'wp_variant', regex: /-\d+$/ },

  // WordPress rotation/edit hash: -e1234567890
  { name: 'wp_edit_hash', regex: /-e\d{10,}$/ },

  // Retina suffix: @2x, @3x
  { name: 'retina', regex: /@[23]x$/ },

  // Generic thumbnail suffixes
  { name: 'thumb_suffix', regex: /[-_](thumb|thumbnail|small|medium|large|sm|md|lg)$/i },

  // Size indicators: _s, _m, _l (common on various hosts)
  { name: 'size_letter', regex: /[-_][smlSML]$/ },
];

/**
 * Extension preferences (lower index = higher priority)
 */
const EXTENSION_PRIORITY = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'];

// ============================================================================
// Site-Specific Candidate Generators
// ============================================================================

interface SitePattern {
  name: string;
  domainMatch: RegExp;
  generateCandidates: (url: URL) => string[];
}

const SITE_PATTERNS: SitePattern[] = [
  // WordPress - try removing all suffix combinations
  {
    name: 'WordPress',
    domainMatch: /.*/,
    generateCandidates: (url: URL) => {
      const candidates: string[] = [];
      if (!url.pathname.includes('/wp-content/uploads/')) return candidates;

      const pathMatch = url.pathname.match(
        /^(.+\/wp-content\/uploads\/\d{4}\/\d{2}\/)([^/]+)\.(\w+)$/
      );
      if (!pathMatch) return candidates;

      const [, basePath, filename, ext] = pathMatch;

      // Try progressively stripping suffixes
      let currentName = filename;
      for (let i = 0; i < 5; i++) {
        let stripped = false;
        for (const pattern of SUFFIX_PATTERNS) {
          if (pattern.regex.test(currentName)) {
            currentName = currentName.replace(pattern.regex, '');
            candidates.push(`${url.origin}${basePath}${currentName}.${ext}`);
            stripped = true;
            break;
          }
        }
        if (!stripped) break;
      }

      return candidates;
    },
  },

  // Imgur - strip size suffix letters
  {
    name: 'Imgur',
    domainMatch: /^i\.imgur\.com$/,
    generateCandidates: (url: URL) => {
      const candidates: string[] = [];
      // Imgur uses single-letter suffixes: a, b, s, t, m, l, h (small to huge)
      const match = url.pathname.match(/^(.+\/[a-zA-Z0-9]+)[abmsltlh]\.(\w+)$/);
      if (match) {
        // Try without suffix (original)
        candidates.push(`${url.origin}${match[1]}.${match[2]}`);
        // Try 'h' suffix (huge)
        candidates.push(`${url.origin}${match[1]}h.${match[2]}`);
      }
      return candidates;
    },
  },

  // Flickr - try _o (original) suffix
  {
    name: 'Flickr',
    domainMatch: /\.staticflickr\.com$/,
    generateCandidates: (url: URL) => {
      const candidates: string[] = [];
      const match = url.pathname.match(/^(.+)_[sqtmnzclkbho]\.(\w+)$/);
      if (match) {
        // _o is original, _k is large 2048, _h is 1600
        candidates.push(`${url.origin}${match[1]}_o.${match[2]}`);
        candidates.push(`${url.origin}${match[1]}_k.${match[2]}`);
        candidates.push(`${url.origin}${match[1]}_h.${match[2]}`);
        candidates.push(`${url.origin}${match[1]}_b.${match[2]}`);
      }
      return candidates;
    },
  },

  // Tumblr - try larger size paths
  {
    name: 'Tumblr',
    domainMatch: /\.media\.tumblr\.com$/,
    generateCandidates: (url: URL) => {
      const candidates: string[] = [];
      const match = url.pathname.match(/^(.+)\/s(\d+x\d+)\/(.+)$/);
      if (match) {
        // Try progressively larger sizes
        candidates.push(`${url.origin}${match[1]}/s2048x3072/${match[3]}`);
        candidates.push(`${url.origin}${match[1]}/s1280x1920/${match[3]}`);
        candidates.push(`${url.origin}${match[1]}/raw/${match[3]}`);
      }
      return candidates;
    },
  },

  // Medium - try max width
  {
    name: 'Medium',
    domainMatch: /^miro\.medium\.com$/,
    generateCandidates: (url: URL) => {
      const candidates: string[] = [];
      const match = url.pathname.match(/^(.+)\/max\/\d+\/(.+)$/);
      if (match) {
        candidates.push(`${url.origin}${match[1]}/max/4800/${match[2]}`);
        candidates.push(`${url.origin}${match[1]}/max/2400/${match[2]}`);
      }
      return candidates;
    },
  },

  // Cloudinary - try removing transformations
  {
    name: 'Cloudinary',
    domainMatch: /\.cloudinary\.com$/,
    generateCandidates: (url: URL) => {
      const candidates: string[] = [];
      // Remove transformation segments like /w_800,h_600,c_fill/
      const match = url.pathname.match(/^(.+\/image\/upload)\/[^/]+\/(.+)$/);
      if (match) {
        candidates.push(`${url.origin}${match[1]}/${match[2]}`);
      }
      return candidates;
    },
  },

  // Generic CDN query param stripping
  {
    name: 'Generic CDN',
    domainMatch: /.*/,
    generateCandidates: (url: URL) => {
      const candidates: string[] = [];
      if (url.search) {
        // Strip query params entirely
        candidates.push(`${url.origin}${url.pathname}`);
      }
      return candidates;
    },
  },
];

// ============================================================================
// Image Enhance Service
// ============================================================================

export class ImageEnhanceService {
  /**
   * Find the highest resolution version of an image URL
   */
  async enhance(
    imageUrl: string,
    options: EnhanceOptions = {}
  ): Promise<EnhanceResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    logger.debug('ImageEnhanceService', 'Starting enhance', { imageUrl });

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(imageUrl);
    } catch {
      throw new Error(`Invalid URL: ${imageUrl}`);
    }

    // Generate all candidates
    const candidates = this.generateCandidates(parsedUrl, opts);

    logger.debug('ImageEnhanceService', 'Generated candidates', {
      count: candidates.length,
      urls: candidates.slice(0, 10).map((c) => c.url),
    });

    if (!opts.validate) {
      // Dry run - return candidates without validation
      return {
        originalUrl: imageUrl,
        bestUrl: candidates[0]?.url || imageUrl,
        bestSize: 0,
        allCandidates: candidates.map((c) => ({ ...c, exists: false })),
        improvement: 1,
      };
    }

    // Validate all candidates in parallel
    const validated = await this.validateCandidates(candidates, opts);

    // Filter to existing candidates
    const existing = validated.filter((c) => c.exists && c.contentLength);

    if (existing.length === 0) {
      logger.warn('ImageEnhanceService', 'No valid candidates found', { imageUrl });
      return {
        originalUrl: imageUrl,
        bestUrl: imageUrl,
        bestSize: 0,
        allCandidates: validated,
        improvement: 1,
      };
    }

    // Sort by size (largest first), with format preference tiebreaker
    existing.sort((a, b) => {
      // Primary: size
      const sizeDiff = (b.contentLength || 0) - (a.contentLength || 0);
      if (sizeDiff !== 0) return sizeDiff;

      // Secondary: format preference
      if (opts.preferTraditionalFormats) {
        const aExt = this.getExtension(a.url);
        const bExt = this.getExtension(b.url);
        const aPriority = EXTENSION_PRIORITY.indexOf(aExt);
        const bPriority = EXTENSION_PRIORITY.indexOf(bExt);
        return aPriority - bPriority;
      }

      return 0;
    });

    const best = existing[0];
    const original = validated.find((c) => c.source === 'original');
    const originalSize = original?.contentLength || 0;

    logger.info('ImageEnhanceService', 'Found best candidate', {
      originalUrl: imageUrl,
      bestUrl: best.url,
      bestSize: best.contentLength,
      originalSize,
      improvement: originalSize > 0 ? (best.contentLength || 0) / originalSize : 0,
    });

    return {
      originalUrl: imageUrl,
      bestUrl: best.url,
      bestSize: best.contentLength || 0,
      allCandidates: validated,
      improvement: originalSize > 0 ? (best.contentLength || 0) / originalSize : 1,
    };
  }

  /**
   * Generate all possible candidate URLs for an image
   */
  private generateCandidates(url: URL, opts: Required<EnhanceOptions>): ImageCandidate[] {
    const candidates: ImageCandidate[] = [];
    const seen = new Set<string>();

    const addCandidate = (c: ImageCandidate) => {
      if (!seen.has(c.url) && candidates.length < opts.maxCandidates) {
        seen.add(c.url);
        candidates.push(c);
      }
    };

    // 1. Original URL
    addCandidate({
      url: url.href,
      source: 'original',
      depth: 0,
    });

    // 2. Apply site-specific patterns
    for (const pattern of SITE_PATTERNS) {
      if (pattern.domainMatch.test(url.hostname)) {
        const siteUrls = pattern.generateCandidates(url);
        for (const siteUrl of siteUrls) {
          addCandidate({
            url: siteUrl,
            source: 'pattern',
            patternName: pattern.name,
            depth: 1,
          });
        }
      }
    }

    // 3. Recursive suffix stripping (the key insight!)
    const recursiveStrip = (currentUrl: string, depth: number) => {
      if (depth > opts.maxDepth) return;

      let parsedCurrent: URL;
      try {
        parsedCurrent = new URL(currentUrl);
      } catch {
        return;
      }

      const pathMatch = parsedCurrent.pathname.match(/^(.+)\/([^/]+)\.(\w+)$/);
      if (!pathMatch) return;

      const [, basePath, filename, ext] = pathMatch;

      for (const pattern of SUFFIX_PATTERNS) {
        if (pattern.regex.test(filename)) {
          const strippedName = filename.replace(pattern.regex, '');
          const newUrl = `${parsedCurrent.origin}${basePath}/${strippedName}.${ext}`;

          addCandidate({
            url: newUrl,
            source: 'recursive',
            patternName: pattern.name,
            depth,
          });

          // Recurse to strip more suffixes
          recursiveStrip(newUrl, depth + 1);
        }
      }
    };

    // Start recursive stripping from original and all site-pattern candidates
    const startUrls = candidates.map((c) => c.url);
    for (const startUrl of startUrls) {
      recursiveStrip(startUrl, 1);
    }

    // 4. Extension swaps (prefer jpg/png over webp)
    if (opts.preferTraditionalFormats) {
      const baseUrls = candidates.filter((c) => c.depth <= 2).map((c) => c.url);
      for (const baseUrl of baseUrls) {
        const ext = this.getExtension(baseUrl);
        if (ext === 'webp' || ext === 'avif') {
          // Try jpg and png versions
          for (const altExt of ['jpg', 'jpeg', 'png']) {
            const altUrl = baseUrl.replace(/\.\w+$/, `.${altExt}`);
            addCandidate({
              url: altUrl,
              source: 'extension_swap',
              depth: 2,
            });
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Validate candidates with HEAD requests
   */
  private async validateCandidates(
    candidates: ImageCandidate[],
    opts: Required<EnhanceOptions>
  ): Promise<ValidatedCandidate[]> {
    const results = await Promise.all(
      candidates.map((c) => this.validateSingle(c, opts.headTimeout))
    );
    return results;
  }

  /**
   * Validate a single candidate URL with caching and rate limiting
   */
  private async validateSingle(
    candidate: ImageCandidate,
    timeout: number
  ): Promise<ValidatedCandidate> {
    // Check cache first
    const cached = getCachedResult(candidate.url);
    if (cached) {
      return { ...cached, ...candidate }; // Merge candidate metadata with cached result
    }

    try {
      // Extract domain for rate limiting
      const domain = new URL(candidate.url).hostname;

      // Wait for rate limit
      await waitForRateLimit(domain);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(candidate.url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/*,*/*;q=0.8',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const result: ValidatedCandidate = {
          ...candidate,
          exists: false,
          error: `HTTP ${response.status}`,
        };
        cacheResult(candidate.url, result);
        return result;
      }

      const contentLength = parseInt(
        response.headers.get('content-length') || '0',
        10
      );
      const contentType = response.headers.get('content-type') || undefined;

      // Verify it's actually an image
      if (contentType && !contentType.startsWith('image/')) {
        const result: ValidatedCandidate = {
          ...candidate,
          exists: false,
          error: `Not an image: ${contentType}`,
        };
        cacheResult(candidate.url, result);
        return result;
      }

      const result: ValidatedCandidate = {
        ...candidate,
        exists: true,
        contentLength,
        contentType,
      };
      cacheResult(candidate.url, result);
      return result;
    } catch (err) {
      const result: ValidatedCandidate = {
        ...candidate,
        exists: false,
        error: (err as Error).message,
      };
      // Don't cache network errors - they might be transient
      return result;
    }
  }

  /**
   * Get file extension from URL
   */
  private getExtension(url: string): string {
    const match = url.match(/\.(\w+)(?:\?|$)/);
    return match ? match[1].toLowerCase() : '';
  }

  /**
   * Batch enhance multiple URLs
   */
  async enhanceBatch(
    urls: string[],
    options: EnhanceOptions = {}
  ): Promise<EnhanceResult[]> {
    // Process in parallel with concurrency limit
    const concurrency = 5;
    const results: EnhanceResult[] = [];

    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((url) => this.enhance(url, options).catch((err) => ({
          originalUrl: url,
          bestUrl: url,
          bestSize: 0,
          allCandidates: [],
          improvement: 1,
          error: (err as Error).message,
        } as EnhanceResult)))
      );
      results.push(...batchResults);
    }

    return results;
  }
}

// Singleton instance
export const imageEnhanceService = new ImageEnhanceService();
