/**
 * Image Source Discovery Service
 *
 * Extracts ALL possible image sources from a webpage, not just visible <img> tags.
 * Parses srcset, picture elements, meta tags, linked originals, lazy-load attributes,
 * and site-specific patterns to find the highest quality versions.
 *
 * @module services/image-downloader/image-source-discovery
 */

import { getLogger } from '../logger-service';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface DiscoveredSource {
  url: string;
  width?: number;
  height?: number;
  descriptor?: string; // "2x", "800w", etc.
  sourceType: SourceType;
  context?: {
    alt?: string;
    caption?: string;
    parentLink?: string; // If img is inside <a href="...">
    nearbyText?: string;
  };
  confidence: number; // 0-1, higher = more likely to be high quality
}

export type SourceType =
  | 'img_src'           // Standard <img src="">
  | 'img_srcset'        // <img srcset=""> entries
  | 'picture_source'    // <picture><source> entries
  | 'meta_og'           // <meta property="og:image">
  | 'meta_twitter'      // <meta name="twitter:image">
  | 'link_original'     // <a href="original.jpg"><img src="thumb.jpg"></a>
  | 'data_attribute'    // data-src, data-full, data-original, etc.
  | 'css_background'    // background-image: url(...)
  | 'json_ld'           // Structured data
  | 'gallery_config'    // JavaScript gallery configurations
  | 'download_link';    // "Download" or "View Full Size" links

export interface PageImageSources {
  pageUrl: string;
  title?: string;
  images: DiscoveredSource[];
  // Grouped by likely same image (different sizes)
  imageGroups: ImageGroup[];
}

export interface ImageGroup {
  /** All sources that appear to be the same image */
  sources: DiscoveredSource[];
  /** Best guess at the highest quality source */
  bestSource: DiscoveredSource;
  /** Common alt text or caption */
  description?: string;
}

// ============================================================================
// Srcset Parser
// ============================================================================

interface SrcsetEntry {
  url: string;
  width?: number;
  density?: number;
  descriptor: string;
}

/**
 * Parse srcset attribute into individual entries
 * Handles both width descriptors (800w) and density descriptors (2x)
 */
export function parseSrcset(srcset: string, baseUrl: string): SrcsetEntry[] {
  const entries: SrcsetEntry[] = [];

  // Split by comma, but handle URLs with commas in query strings
  const parts = srcset.split(/,(?=\s*https?:|[^,]*\s+\d+[wx])/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Match: url [descriptor]
    const match = trimmed.match(/^(.+?)\s+(\d+(?:\.\d+)?[wx])?\s*$/);
    if (!match) continue;

    let [, url, descriptor] = match;
    url = url.trim();
    descriptor = descriptor || '1x';

    // Resolve relative URLs
    try {
      url = new URL(url, baseUrl).href;
    } catch {
      continue;
    }

    const entry: SrcsetEntry = { url, descriptor };

    if (descriptor.endsWith('w')) {
      entry.width = parseInt(descriptor);
    } else if (descriptor.endsWith('x')) {
      entry.density = parseFloat(descriptor);
    }

    entries.push(entry);
  }

  // Sort by size (largest first)
  return entries.sort((a, b) => {
    if (a.width && b.width) return b.width - a.width;
    if (a.density && b.density) return b.density - a.density;
    return 0;
  });
}

// ============================================================================
// Site-Specific URL Patterns
// ============================================================================

interface SitePattern {
  name: string;
  domainMatch: RegExp;
  /** Transform URL to original/highest quality version */
  toOriginal: (url: string) => string[];
  /** Confidence that this pattern will find original */
  confidence: number;
}

const SITE_PATTERNS: SitePattern[] = [
  // Twitter/X - use orig or 4096x4096
  {
    name: 'Twitter/X',
    domainMatch: /pbs\.twimg\.com/,
    toOriginal: (url) => {
      const candidates: string[] = [];
      // Try orig format
      candidates.push(url.replace(/[?&]name=\w+/, '?name=orig'));
      candidates.push(url.replace(/[?&]name=\w+/, '?name=4096x4096'));
      // Try format=png for highest quality
      if (url.includes('format=jpg')) {
        candidates.push(url.replace('format=jpg', 'format=png').replace(/name=\w+/, 'name=orig'));
      }
      return candidates;
    },
    confidence: 0.95,
  },

  // Instagram - try original size
  {
    name: 'Instagram',
    domainMatch: /cdninstagram\.com|fbcdn\.net.*instagram/,
    toOriginal: (url) => {
      const candidates: string[] = [];
      // Remove size constraints
      candidates.push(url.replace(/\/s\d+x\d+\//, '/'));
      candidates.push(url.replace(/\/p\d+x\d+\//, '/'));
      // Try e35 (original) instead of e15/e25 (compressed)
      candidates.push(url.replace(/\/e\d+\//, '/e35/'));
      return candidates;
    },
    confidence: 0.7, // Instagram makes this hard
  },

  // Pinterest - use originals path
  {
    name: 'Pinterest',
    domainMatch: /pinimg\.com/,
    toOriginal: (url) => {
      // Replace size path with originals
      return [
        url.replace(/\/\d+x\//, '/originals/'),
        url.replace(/\/\d+x\d+\//, '/originals/'),
      ];
    },
    confidence: 0.9,
  },

  // 500px - highest quality suffix
  {
    name: '500px',
    domainMatch: /500px\.(org|com)|drscdn\.500px\.org/,
    toOriginal: (url) => {
      // /1.jpg = small, /5.jpg = original, /2048.jpg = 2048px
      return [
        url.replace(/\/\d+\.jpg/, '/5.jpg'),
        url.replace(/\/\d+\.jpg/, '/2048.jpg'),
      ];
    },
    confidence: 0.85,
  },

  // DeviantArt - construct download URL
  {
    name: 'DeviantArt',
    domainMatch: /deviantart\.(net|com)|wixmp\.com/,
    toOriginal: (url) => {
      const candidates: string[] = [];
      // Remove size constraints from wixmp CDN
      candidates.push(url.replace(/\/v1\/fill\/[^/]+\//, '/'));
      candidates.push(url.replace(/\/intermediary\//, '/'));
      return candidates;
    },
    confidence: 0.75,
  },

  // Unsplash - remove size params for raw
  {
    name: 'Unsplash',
    domainMatch: /unsplash\.com|images\.unsplash\.com/,
    toOriginal: (url) => {
      // Remove w, h, q params; add raw quality
      const base = url.split('?')[0];
      return [
        `${base}?q=100`,
        base,
      ];
    },
    confidence: 0.95,
  },

  // Wikimedia Commons - remove thumb path
  {
    name: 'Wikimedia',
    domainMatch: /upload\.wikimedia\.org|commons\.wikimedia\.org/,
    toOriginal: (url) => {
      // /thumb/.../800px-File.jpg → /.../File.jpg
      const match = url.match(/\/thumb\/(.+?)\/\d+px-[^/]+$/);
      if (match) {
        const basePath = match[1];
        const filename = url.split('/').pop()?.replace(/^\d+px-/, '');
        return [`https://upload.wikimedia.org/wikipedia/commons/${basePath}/${filename}`];
      }
      return [url.replace(/\/thumb\//, '/').replace(/\/\d+px-([^/]+)$/, '/$1')];
    },
    confidence: 0.95,
  },

  // Google Photos/Drive
  {
    name: 'Google Photos',
    domainMatch: /googleusercontent\.com|lh\d\.google/,
    toOriginal: (url) => {
      // Remove size constraints
      return [
        url.replace(/=w\d+-h\d+.*$/, '=w0-h0'), // Original size
        url.replace(/=s\d+.*$/, '=s0'), // Original size
        url.replace(/\/s\d+\//, '/s0/'),
      ];
    },
    confidence: 0.9,
  },

  // Facebook CDN
  {
    name: 'Facebook',
    domainMatch: /fbcdn\.net|facebook\.com.*photo/,
    toOriginal: (url) => {
      const candidates: string[] = [];
      // Try removing size constraints
      candidates.push(url.replace(/\/[ps]\d+x\d+\//, '/'));
      candidates.push(url.replace(/_[sn]\./, '_o.')); // _s = small, _o = original
      return candidates;
    },
    confidence: 0.7,
  },

  // Flickr - use _o suffix for original
  {
    name: 'Flickr',
    domainMatch: /staticflickr\.com|flickr\.com/,
    toOriginal: (url) => {
      // _s, _m, _z, _c, _l, _k → _o (original)
      return [
        url.replace(/_[smzclkbht]\./, '_o.'),
        url.replace(/_[smzclkbht]\./, '_k.'), // k = 2048px, often available when o isn't
      ];
    },
    confidence: 0.85,
  },

  // Imgur - remove suffix for original
  {
    name: 'Imgur',
    domainMatch: /imgur\.com/,
    toOriginal: (url) => {
      // abcdefg[s|m|l|h].jpg → abcdefg.jpg
      return [
        url.replace(/([a-zA-Z0-9]+)[smlhtb]\.(\w+)$/, '$1.$2'),
        url.replace(/([a-zA-Z0-9]+)[smlhtb]\.(\w+)$/, '$1h.$2'), // h = huge
      ];
    },
    confidence: 0.95,
  },

  // ArtStation
  {
    name: 'ArtStation',
    domainMatch: /artstation\.com|cdna\.artstation\.com/,
    toOriginal: (url) => {
      return [
        url.replace(/\/large\//, '/4k/'),
        url.replace(/\/large\//, '/original/'),
        url.replace(/\/medium\//, '/4k/'),
        url.replace(/\/small\//, '/4k/'),
      ];
    },
    confidence: 0.85,
  },

  // Shopify CDN
  {
    name: 'Shopify',
    domainMatch: /cdn\.shopify\.com/,
    toOriginal: (url) => {
      // Remove size suffix
      return [
        url.replace(/_\d+x\d*\./, '.'),
        url.replace(/_\d+x\./, '.'),
        url.replace(/_x\d+\./, '.'),
      ];
    },
    confidence: 0.9,
  },

  // Generic CDN query param removal
  {
    name: 'Generic Query Params',
    domainMatch: /.*/,
    toOriginal: (url) => {
      const parsed = new URL(url);
      // Common resize params to remove
      const paramsToRemove = ['w', 'h', 'width', 'height', 'resize', 'size', 'fit', 'crop', 'quality', 'q'];
      let modified = false;
      for (const param of paramsToRemove) {
        if (parsed.searchParams.has(param)) {
          parsed.searchParams.delete(param);
          modified = true;
        }
      }
      return modified ? [parsed.href] : [];
    },
    confidence: 0.6,
  },
];

/**
 * Apply site-specific patterns to find original URLs
 */
export function applySitePatterns(url: string): DiscoveredSource[] {
  const sources: DiscoveredSource[] = [];

  for (const pattern of SITE_PATTERNS) {
    if (pattern.domainMatch.test(url)) {
      try {
        const originals = pattern.toOriginal(url);
        for (const originalUrl of originals) {
          if (originalUrl && originalUrl !== url) {
            sources.push({
              url: originalUrl,
              sourceType: 'img_src',
              confidence: pattern.confidence,
              context: { nearbyText: `Via ${pattern.name} pattern` },
            });
          }
        }
      } catch (e) {
        logger.debug('ImageSourceDiscovery', `Pattern ${pattern.name} failed`, { url, error: e });
      }
    }
  }

  return sources;
}

// ============================================================================
// HTML Parsing Helpers
// ============================================================================

/**
 * Common data attributes that contain original/full image URLs
 */
const DATA_ATTRIBUTES = [
  'data-src',
  'data-original',
  'data-full',
  'data-fullsize',
  'data-full-src',
  'data-large',
  'data-large-src',
  'data-hires',
  'data-hi-res',
  'data-highres',
  'data-zoom',
  'data-zoom-src',
  'data-lazy',
  'data-lazy-src',
  'data-srcset',
  'data-original-src',
  'data-image',
  'data-bg',
  'data-background',
];

/**
 * Extract images from HTML content
 * This is a simplified parser - for full accuracy, use a proper DOM parser
 */
export function extractImagesFromHtml(html: string, pageUrl: string): DiscoveredSource[] {
  const sources: DiscoveredSource[] = [];
  const baseUrl = pageUrl;

  // 1. Meta tags (og:image, twitter:image)
  const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (ogImageMatch) {
    sources.push({
      url: resolveUrl(ogImageMatch[1], baseUrl),
      sourceType: 'meta_og',
      confidence: 0.9, // OG images are usually high quality
    });
  }

  const twitterImageMatch = html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i);
  if (twitterImageMatch) {
    sources.push({
      url: resolveUrl(twitterImageMatch[1], baseUrl),
      sourceType: 'meta_twitter',
      confidence: 0.85,
    });
  }

  // 2. <img> tags with srcset
  const imgSrcsetRegex = /<img[^>]+srcset=["']([^"']+)["'][^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgSrcsetRegex.exec(html)) !== null) {
    const srcsetEntries = parseSrcset(imgMatch[1], baseUrl);
    for (const entry of srcsetEntries) {
      sources.push({
        url: entry.url,
        width: entry.width,
        descriptor: entry.descriptor,
        sourceType: 'img_srcset',
        confidence: entry.width ? Math.min(0.5 + (entry.width / 4000), 0.95) : 0.7,
      });
    }
  }

  // 3. <picture> elements
  const pictureRegex = /<picture[^>]*>([\s\S]*?)<\/picture>/gi;
  let pictureMatch;
  while ((pictureMatch = pictureRegex.exec(html)) !== null) {
    const pictureContent = pictureMatch[1];

    // Extract <source> elements
    const sourceRegex = /<source[^>]+srcset=["']([^"']+)["'][^>]*>/gi;
    let sourceMatch;
    while ((sourceMatch = sourceRegex.exec(pictureContent)) !== null) {
      const srcsetEntries = parseSrcset(sourceMatch[1], baseUrl);
      for (const entry of srcsetEntries) {
        sources.push({
          url: entry.url,
          width: entry.width,
          descriptor: entry.descriptor,
          sourceType: 'picture_source',
          confidence: entry.width ? Math.min(0.5 + (entry.width / 4000), 0.95) : 0.75,
        });
      }
    }
  }

  // 4. <a href="image"><img></a> patterns (linked originals)
  const linkedImgRegex = /<a[^>]+href=["']([^"']+\.(?:jpg|jpeg|png|gif|webp|tiff?|bmp)[^"']*)["'][^>]*>\s*<img/gi;
  let linkedMatch;
  while ((linkedMatch = linkedImgRegex.exec(html)) !== null) {
    sources.push({
      url: resolveUrl(linkedMatch[1], baseUrl),
      sourceType: 'link_original',
      confidence: 0.85, // Links usually point to originals
    });
  }

  // 5. Data attributes
  for (const attr of DATA_ATTRIBUTES) {
    const dataAttrRegex = new RegExp(`${attr}=["']([^"']+)["']`, 'gi');
    let dataMatch;
    while ((dataMatch = dataAttrRegex.exec(html)) !== null) {
      const url = dataMatch[1];
      if (isImageUrl(url)) {
        sources.push({
          url: resolveUrl(url, baseUrl),
          sourceType: 'data_attribute',
          confidence: 0.8,
          context: { nearbyText: `From ${attr}` },
        });
      }
    }
  }

  // 6. JSON-LD structured data
  const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonMatch;
  while ((jsonMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      const jsonData = JSON.parse(jsonMatch[1]);
      extractImagesFromJsonLd(jsonData, sources, baseUrl);
    } catch {
      // Invalid JSON, skip
    }
  }

  // 7. "View Full Size" / "Download" links
  const downloadLinkRegex = /<a[^>]+href=["']([^"']+\.(?:jpg|jpeg|png|gif|webp|tiff?)[^"']*)["'][^>]*>[^<]*(?:download|full.?size|original|high.?res|view.?large)[^<]*<\/a>/gi;
  let downloadMatch;
  while ((downloadMatch = downloadLinkRegex.exec(html)) !== null) {
    sources.push({
      url: resolveUrl(downloadMatch[1], baseUrl),
      sourceType: 'download_link',
      confidence: 0.9, // Explicit download links are usually originals
    });
  }

  // 8. Background images in inline styles
  const bgImageRegex = /background(?:-image)?:\s*url\(["']?([^)"']+)["']?\)/gi;
  let bgMatch;
  while ((bgMatch = bgImageRegex.exec(html)) !== null) {
    if (isImageUrl(bgMatch[1])) {
      sources.push({
        url: resolveUrl(bgMatch[1], baseUrl),
        sourceType: 'css_background',
        confidence: 0.6,
      });
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  return sources.filter(s => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

/**
 * Extract images from JSON-LD structured data
 */
function extractImagesFromJsonLd(
  data: unknown,
  sources: DiscoveredSource[],
  baseUrl: string
): void {
  if (!data || typeof data !== 'object') return;

  const obj = data as Record<string, unknown>;

  // Check for image properties
  const imageProps = ['image', 'photo', 'thumbnail', 'primaryImageOfPage', 'contentUrl'];
  for (const prop of imageProps) {
    if (obj[prop]) {
      const urls = extractUrlsFromValue(obj[prop]);
      for (const url of urls) {
        sources.push({
          url: resolveUrl(url, baseUrl),
          sourceType: 'json_ld',
          confidence: 0.85,
        });
      }
    }
  }

  // Recurse into nested objects
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        extractImagesFromJsonLd(item, sources, baseUrl);
      }
    } else if (typeof value === 'object') {
      extractImagesFromJsonLd(value, sources, baseUrl);
    }
  }
}

function extractUrlsFromValue(value: unknown): string[] {
  if (typeof value === 'string' && isImageUrl(value)) {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(v => extractUrlsFromValue(v));
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.url === 'string') return [obj.url];
    if (typeof obj.contentUrl === 'string') return [obj.contentUrl];
  }
  return [];
}

function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|tiff?|bmp|avif|svg)(\?|$)/i.test(url);
}

// ============================================================================
// Main Discovery Service
// ============================================================================

export class ImageSourceDiscoveryService {
  /**
   * Discover all image sources from HTML content
   */
  discoverFromHtml(html: string, pageUrl: string): PageImageSources {
    const sources = extractImagesFromHtml(html, pageUrl);

    // Apply site-specific patterns to each source
    const enhancedSources: DiscoveredSource[] = [...sources];
    for (const source of sources) {
      const sitePatternSources = applySitePatterns(source.url);
      enhancedSources.push(...sitePatternSources);
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniqueSources = enhancedSources.filter(s => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

    // Group by likely same image
    const groups = this.groupSources(uniqueSources);

    // Extract page title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);

    return {
      pageUrl,
      title: titleMatch?.[1]?.trim(),
      images: uniqueSources,
      imageGroups: groups,
    };
  }

  /**
   * Group sources that are likely the same image at different sizes
   */
  private groupSources(sources: DiscoveredSource[]): ImageGroup[] {
    // Simple grouping by filename base
    const groups = new Map<string, DiscoveredSource[]>();

    for (const source of sources) {
      try {
        const url = new URL(source.url);
        const pathParts = url.pathname.split('/');
        const filename = pathParts[pathParts.length - 1] || '';

        // Extract base name (remove size suffixes, extensions)
        const baseName = filename
          .replace(/\.\w+$/, '') // Remove extension
          .replace(/-\d+x\d+/, '') // Remove dimensions
          .replace(/_[smlhotbkz]$/, '') // Remove size suffix
          .replace(/-(?:thumb|small|medium|large|preview)$/i, '')
          .substring(0, 20); // Truncate for grouping

        const key = `${url.hostname}:${baseName}`;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(source);
      } catch {
        // Invalid URL, create single-item group
        groups.set(source.url, [source]);
      }
    }

    // Convert to ImageGroup array
    return Array.from(groups.values())
      .filter(g => g.length > 0)
      .map(sources => {
        // Sort by confidence and estimated size
        sources.sort((a, b) => {
          // First by confidence
          if (b.confidence !== a.confidence) {
            return b.confidence - a.confidence;
          }
          // Then by width if available
          if (a.width && b.width) {
            return b.width - a.width;
          }
          return 0;
        });

        return {
          sources,
          bestSource: sources[0],
          description: sources[0].context?.alt || sources[0].context?.caption,
        };
      });
  }
}

// Singleton export
export const imageSourceDiscovery = new ImageSourceDiscoveryService();
