/**
 * source-type-detector.ts
 *
 * Detects the type of web source from URL patterns.
 * Used by bookmark-api-server to auto-categorize saved URLs.
 *
 * Types: article, gallery, video, social, map, document, archive, other
 */

import type { WebSourceType } from '../repositories/sqlite-websources-repository';

/**
 * Domain patterns for each source type
 */
const VIDEO_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'dailymotion.com',
  'twitch.tv',
  'streamable.com',
  'rumble.com',
  'bitchute.com',
  'odysee.com',
  'tiktok.com',
];

const SOCIAL_DOMAINS = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'threads.net',
  'linkedin.com',
  'reddit.com',
  'pinterest.com',
  'tumblr.com',
  'mastodon.social',
  'bsky.app',
  'flickr.com',
];

const MAP_DOMAINS = [
  'google.com/maps',
  'maps.google.com',
  'bing.com/maps',
  'openstreetmap.org',
  'mapquest.com',
  'earth.google.com',
  'historicaerials.com',
  'historicmapworks.com',
  'davidrumsey.com',
  'loc.gov/maps',
  'usgs.gov',
];

const ARCHIVE_DOMAINS = [
  'archive.org',
  'web.archive.org',
  'archive.is',
  'archive.ph',
  'archive.today',
  'ghostarchive.org',
  'perma.cc',
  'newspapers.com',
  'chroniclingamerica.loc.gov',
  'ancestry.com',
  'findagrave.com',
  'familysearch.org',
];

const GALLERY_DOMAINS = [
  'imgur.com',
  'giphy.com',
  'unsplash.com',
  'pexels.com',
  '500px.com',
  'deviantart.com',
  'artstation.com',
  'behance.net',
  'dribbble.com',
];

const DOCUMENT_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.rtf',
  '.odt',
  '.ods',
  '.odp',
];

/**
 * Detect source type from URL
 *
 * @param url - The URL to analyze
 * @returns The detected source type
 */
export function detectSourceType(url: string): WebSourceType {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();
    const fullUrl = url.toLowerCase();

    // Check for document extensions first (most specific)
    for (const ext of DOCUMENT_EXTENSIONS) {
      if (pathname.endsWith(ext)) {
        return 'document';
      }
    }

    // Check video domains
    for (const domain of VIDEO_DOMAINS) {
      if (hostname.includes(domain) || hostname.endsWith(domain)) {
        return 'video';
      }
    }

    // Check social domains
    for (const domain of SOCIAL_DOMAINS) {
      if (hostname.includes(domain) || hostname.endsWith(domain)) {
        return 'social';
      }
    }

    // Check map domains (need to check full URL for some)
    for (const domain of MAP_DOMAINS) {
      if (fullUrl.includes(domain)) {
        return 'map';
      }
    }

    // Check archive domains
    for (const domain of ARCHIVE_DOMAINS) {
      if (hostname.includes(domain) || hostname.endsWith(domain)) {
        return 'archive';
      }
    }

    // Check gallery domains
    for (const domain of GALLERY_DOMAINS) {
      if (hostname.includes(domain) || hostname.endsWith(domain)) {
        return 'gallery';
      }
    }

    // Default to article for general web pages
    return 'article';
  } catch {
    // If URL parsing fails, default to 'other'
    return 'other';
  }
}

/**
 * Get a human-readable label for a source type
 *
 * @param type - The source type
 * @returns Human-readable label
 */
export function getSourceTypeLabel(type: WebSourceType): string {
  const labels: Record<WebSourceType, string> = {
    article: 'Article',
    gallery: 'Image Gallery',
    video: 'Video',
    social: 'Social Media',
    map: 'Map',
    document: 'Document',
    archive: 'Archive',
    other: 'Other',
  };
  return labels[type] || 'Other';
}

/**
 * Get an icon name for a source type (for UI usage)
 *
 * @param type - The source type
 * @returns Icon identifier
 */
export function getSourceTypeIcon(type: WebSourceType): string {
  const icons: Record<WebSourceType, string> = {
    article: 'document-text',
    gallery: 'photo',
    video: 'film',
    social: 'users',
    map: 'map',
    document: 'document',
    archive: 'archive-box',
    other: 'link',
  };
  return icons[type] || 'link';
}
