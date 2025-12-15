/**
 * URL Validator
 *
 * Validates image URLs by making HEAD requests to check existence,
 * content type, and file size before downloading.
 *
 * @module services/image-downloader/url-validator
 */

import { getLogger } from '../logger-service';

const logger = getLogger();

export interface UrlValidation {
  url: string;
  exists: boolean;
  contentType: string | null;
  contentLength: number | null;
  status: number;
  isImage: boolean;
  headers: Record<string, string>;
  error?: string;
}

export interface ValidatedCandidate {
  url: string;
  validation: UrlValidation;
  confidence: number;
  patternId: string | null;
}

// Common image MIME types
const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/bmp',
  'image/svg+xml',
]);

/**
 * Validate an image URL by making a HEAD request
 *
 * @param url - URL to validate
 * @param timeout - Request timeout in ms (default: 10000)
 * @returns Validation result
 */
export async function validateImageUrl(
  url: string,
  timeout = 10000
): Promise<UrlValidation> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'image/*,*/*',
      },
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type')?.toLowerCase() || null;
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10) || null;

    // Collect relevant headers
    const headers: Record<string, string> = {};
    for (const [key, value] of response.headers.entries()) {
      if (
        [
          'content-type',
          'content-length',
          'last-modified',
          'etag',
          'cache-control',
          'x-amz-meta-width',
          'x-amz-meta-height',
        ].includes(key.toLowerCase())
      ) {
        headers[key.toLowerCase()] = value;
      }
    }

    // Check if content type indicates an image
    const isImage = contentType
      ? IMAGE_MIME_TYPES.has(contentType.split(';')[0].trim())
      : false;

    return {
      url,
      exists: response.ok,
      contentType,
      contentLength,
      status: response.status,
      isImage,
      headers,
    };
  } catch (err) {
    clearTimeout(timeoutId);

    const error = err as Error;
    const isTimeout = error.name === 'AbortError';

    logger.warn('UrlValidator', `Validation failed for ${url}`, {
      error: error.message,
      isTimeout,
    });

    return {
      url,
      exists: false,
      contentType: null,
      contentLength: null,
      status: 0,
      isImage: false,
      headers: {},
      error: isTimeout ? 'Request timeout' : error.message,
    };
  }
}

/**
 * Validate multiple URLs in parallel
 *
 * @param urls - URLs to validate
 * @param concurrency - Max concurrent requests (default: 5)
 * @param timeout - Request timeout per URL in ms (default: 10000)
 * @returns Array of validation results
 */
export async function validateImageUrls(
  urls: string[],
  concurrency = 5,
  timeout = 10000
): Promise<UrlValidation[]> {
  const results: UrlValidation[] = [];
  const queue = [...urls];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const url = queue.shift()!;
      const result = await validateImageUrl(url, timeout);
      results.push(result);
    }
  }

  // Start concurrent workers
  const workers = Array(Math.min(concurrency, urls.length))
    .fill(null)
    .map(() => processNext());

  await Promise.all(workers);

  // Return in original order
  return urls.map((url) => results.find((r) => r.url === url)!);
}

/**
 * Find the best valid URL from a list of candidates
 *
 * @param candidates - Candidate URLs with confidence scores
 * @param timeout - Request timeout per URL in ms
 * @returns Best valid candidate or null if none found
 */
export async function findBestUrl(
  candidates: Array<{ url: string; confidence: number; patternId: string | null }>,
  timeout = 10000
): Promise<ValidatedCandidate | null> {
  // Sort by confidence (highest first)
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);

  // Validate in order of confidence, return first valid
  for (const candidate of sorted) {
    const validation = await validateImageUrl(candidate.url, timeout);

    if (validation.exists && validation.isImage) {
      return {
        url: candidate.url,
        validation,
        confidence: candidate.confidence,
        patternId: candidate.patternId,
      };
    }
  }

  return null;
}

/**
 * Compare two images by their validation results
 * Returns the "better" URL based on file size and format
 *
 * @param a - First validation
 * @param b - Second validation
 * @returns Comparison result: -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareByQuality(a: UrlValidation, b: UrlValidation): number {
  // If one doesn't exist or isn't an image, prefer the other
  if (!a.exists || !a.isImage) return -1;
  if (!b.exists || !b.isImage) return 1;

  // Prefer larger files (usually higher quality)
  const sizeA = a.contentLength || 0;
  const sizeB = b.contentLength || 0;

  if (sizeA !== sizeB) {
    return sizeA > sizeB ? 1 : -1;
  }

  // If same size, prefer native formats over WebP/AVIF
  const formatPriority: Record<string, number> = {
    'image/tiff': 1,
    'image/png': 2,
    'image/jpeg': 3,
    'image/jpg': 3,
    'image/webp': 4,
    'image/avif': 5,
    'image/heic': 6,
    'image/gif': 7,
  };

  const priorityA = formatPriority[a.contentType || ''] || 10;
  const priorityB = formatPriority[b.contentType || ''] || 10;

  return priorityA < priorityB ? 1 : priorityA > priorityB ? -1 : 0;
}

/**
 * Get image format from content type
 */
export function getFormatFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;

  const type = contentType.split(';')[0].trim().toLowerCase();
  const mapping: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/tiff': 'tiff',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
  };

  return mapping[type] || null;
}

/**
 * Extract filename from URL
 */
export function getFilenameFromUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname;
    const segments = path.split('/');
    const filename = segments[segments.length - 1];

    // Remove query string and decode
    const clean = decodeURIComponent(filename.split('?')[0]);

    // Check if it looks like a filename with extension
    if (/\.\w{2,5}$/.test(clean)) {
      return clean;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if URL is likely a thumbnail based on common patterns
 */
export function isLikelyThumbnail(url: string): boolean {
  const thumbnailPatterns = [
    /[-_](thumb|thumbnail|small|preview|resize[ds]?)/i,
    /[-_]\d+x\d+\./i, // -800x600.jpg
    /\/thumb(s|nail)?s?\//i,
    /\/small\//i,
    /\/preview\//i,
    /\?.*(?:w|width|h|height|resize|size|fit)=\d+/i,
    /-scaled\./i,
  ];

  return thumbnailPatterns.some((pattern) => pattern.test(url));
}
