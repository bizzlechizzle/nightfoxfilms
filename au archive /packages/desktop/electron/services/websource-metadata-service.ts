/**
 * Web Source Metadata Extraction Service
 * OPT-112: Extracts comprehensive page-level metadata from web pages
 *
 * Extracts:
 * - Open Graph meta tags (og:title, og:image, og:type, etc.)
 * - Schema.org JSON-LD structured data
 * - Dublin Core metadata
 * - Twitter Cards
 * - HTTP response headers
 * - Page structure (canonical, language, favicon, links)
 *
 * Per CLAUDE.md: Offline-first, no external API calls, graceful degradation.
 */

import { Page } from 'puppeteer-core';

// =============================================================================
// Types
// =============================================================================

export interface OpenGraphMetadata {
  title: string | null;
  description: string | null;
  image: string | null;
  url: string | null;
  type: string | null;
  siteName: string | null;
  locale: string | null;
  articleAuthor: string | null;
  articlePublishedTime: string | null;
  articleModifiedTime: string | null;
}

export interface SchemaOrgMetadata {
  raw: string | null; // Full JSON-LD as string
  type: string | null;
  name: string | null;
  author: string | null;
  datePublished: string | null;
  dateModified: string | null;
  publisher: string | null;
  description: string | null;
  image: string | null;
  mainEntityOfPage: string | null;
}

export interface DublinCoreMetadata {
  title: string | null;
  creator: string | null;
  subject: string | null;
  description: string | null;
  publisher: string | null;
  date: string | null;
  type: string | null;
  format: string | null;
  identifier: string | null;
  source: string | null;
  language: string | null;
  rights: string | null;
}

export interface TwitterCardMetadata {
  card: string | null;
  site: string | null;
  creator: string | null;
  title: string | null;
  description: string | null;
  image: string | null;
}

export interface ExtractedLink {
  url: string;
  text: string;
  rel: string | null;
  isExternal: boolean;
}

export interface ImageDomContext {
  src: string;
  srcset: string | null;
  dataSrc: string | null;
  alt: string | null;
  title: string | null;
  width: number;
  height: number;
  caption: string | null;
  credit: string | null;
  attribution: string | null;
  contextHtml: string | null;
  linkUrl: string | null;
  isHero: boolean;
  figureClasses: string | null;
  lazyLoadAttrs: Record<string, string>;
}

export interface PageMetadata {
  // Open Graph
  openGraph: OpenGraphMetadata;

  // Schema.org JSON-LD
  schemaOrg: SchemaOrgMetadata;

  // Dublin Core
  dublinCore: DublinCoreMetadata;

  // Twitter Cards
  twitterCards: TwitterCardMetadata;

  // Standard meta tags
  metaDescription: string | null;
  metaKeywords: string | null;
  metaRobots: string | null;
  metaAuthor: string | null;

  // Page structure
  canonicalUrl: string | null;
  language: string | null;
  charset: string | null;
  faviconUrl: string | null;
  themeColor: string | null;

  // HTTP (populated separately from response)
  httpHeaders: Record<string, string>;
  httpStatus: number | null;
  httpContentType: string | null;

  // Links
  links: ExtractedLink[];

  // Images with DOM context
  images: ImageDomContext[];

  // Extraction metadata
  extractedAt: string;
  extractionMethod: string;
}

// =============================================================================
// Main Extraction Function
// =============================================================================

/**
 * Extract all page metadata from a loaded Puppeteer page
 * Call this after page.goto() has completed
 */
export async function extractPageMetadata(
  page: Page,
  baseUrl: string,
  responseHeaders?: Record<string, string>,
  responseStatus?: number
): Promise<PageMetadata> {
  const extractedAt = new Date().toISOString();

  // Run all extractions in the page context
  const domData = await page.evaluate((baseUrlParam: string) => {
    // Helper to safely get meta content
    const getMeta = (selectors: string[]): string | null => {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
          const content = el.getAttribute('content') || el.getAttribute('value');
          if (content) return content.trim();
        }
      }
      return null;
    };

    // Helper to get all matching meta values
    const getMetaAll = (namePattern: RegExp): Record<string, string> => {
      const result: Record<string, string> = {};
      document.querySelectorAll('meta').forEach((meta) => {
        const name = meta.getAttribute('name') || meta.getAttribute('property') || '';
        const content = meta.getAttribute('content');
        if (namePattern.test(name) && content) {
          result[name] = content.trim();
        }
      });
      return result;
    };

    // -------------------------------------------------------------------------
    // Open Graph
    // -------------------------------------------------------------------------
    const openGraph = {
      title: getMeta(['meta[property="og:title"]']),
      description: getMeta(['meta[property="og:description"]']),
      image: getMeta(['meta[property="og:image"]']),
      url: getMeta(['meta[property="og:url"]']),
      type: getMeta(['meta[property="og:type"]']),
      siteName: getMeta(['meta[property="og:site_name"]']),
      locale: getMeta(['meta[property="og:locale"]']),
      articleAuthor: getMeta(['meta[property="article:author"]']),
      articlePublishedTime: getMeta(['meta[property="article:published_time"]']),
      articleModifiedTime: getMeta(['meta[property="article:modified_time"]']),
    };

    // -------------------------------------------------------------------------
    // Schema.org JSON-LD
    // -------------------------------------------------------------------------
    let schemaOrg = {
      raw: null as string | null,
      type: null as string | null,
      name: null as string | null,
      author: null as string | null,
      datePublished: null as string | null,
      dateModified: null as string | null,
      publisher: null as string | null,
      description: null as string | null,
      image: null as string | null,
      mainEntityOfPage: null as string | null,
    };

    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent || '');
        // Handle @graph array or single object
        const items = data['@graph'] || [data];
        for (const item of items) {
          if (item['@type'] && ['Article', 'NewsArticle', 'BlogPosting', 'WebPage', 'Product'].includes(item['@type'])) {
            schemaOrg = {
              raw: JSON.stringify(item),
              type: item['@type'] || null,
              name: item.name || item.headline || null,
              author: typeof item.author === 'string' ? item.author :
                      item.author?.name || item.author?.[0]?.name || null,
              datePublished: item.datePublished || null,
              dateModified: item.dateModified || null,
              publisher: typeof item.publisher === 'string' ? item.publisher :
                         item.publisher?.name || null,
              description: item.description || null,
              image: typeof item.image === 'string' ? item.image :
                     item.image?.url || item.image?.[0]?.url || item.image?.[0] || null,
              mainEntityOfPage: typeof item.mainEntityOfPage === 'string' ? item.mainEntityOfPage :
                                item.mainEntityOfPage?.['@id'] || null,
            };
            break;
          }
        }
      } catch {
        // Invalid JSON-LD, continue
      }
    }

    // -------------------------------------------------------------------------
    // Dublin Core
    // -------------------------------------------------------------------------
    const dublinCore = {
      title: getMeta(['meta[name="DC.title"]', 'meta[name="dc.title"]']),
      creator: getMeta(['meta[name="DC.creator"]', 'meta[name="dc.creator"]']),
      subject: getMeta(['meta[name="DC.subject"]', 'meta[name="dc.subject"]']),
      description: getMeta(['meta[name="DC.description"]', 'meta[name="dc.description"]']),
      publisher: getMeta(['meta[name="DC.publisher"]', 'meta[name="dc.publisher"]']),
      date: getMeta(['meta[name="DC.date"]', 'meta[name="dc.date"]']),
      type: getMeta(['meta[name="DC.type"]', 'meta[name="dc.type"]']),
      format: getMeta(['meta[name="DC.format"]', 'meta[name="dc.format"]']),
      identifier: getMeta(['meta[name="DC.identifier"]', 'meta[name="dc.identifier"]']),
      source: getMeta(['meta[name="DC.source"]', 'meta[name="dc.source"]']),
      language: getMeta(['meta[name="DC.language"]', 'meta[name="dc.language"]']),
      rights: getMeta(['meta[name="DC.rights"]', 'meta[name="dc.rights"]']),
    };

    // -------------------------------------------------------------------------
    // Twitter Cards
    // -------------------------------------------------------------------------
    const twitterCards = {
      card: getMeta(['meta[name="twitter:card"]']),
      site: getMeta(['meta[name="twitter:site"]']),
      creator: getMeta(['meta[name="twitter:creator"]']),
      title: getMeta(['meta[name="twitter:title"]']),
      description: getMeta(['meta[name="twitter:description"]']),
      image: getMeta(['meta[name="twitter:image"]']),
    };

    // -------------------------------------------------------------------------
    // Standard Meta
    // -------------------------------------------------------------------------
    const metaDescription = getMeta(['meta[name="description"]']);
    const metaKeywords = getMeta(['meta[name="keywords"]']);
    const metaRobots = getMeta(['meta[name="robots"]']);
    const metaAuthor = getMeta(['meta[name="author"]']);

    // -------------------------------------------------------------------------
    // Page Structure
    // -------------------------------------------------------------------------
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    const canonicalUrl = canonicalEl?.getAttribute('href') || null;

    const language = document.documentElement.lang || getMeta(['meta[http-equiv="content-language"]']) || null;

    const charsetEl = document.querySelector('meta[charset]');
    const charset = charsetEl?.getAttribute('charset') ||
                    getMeta(['meta[http-equiv="Content-Type"]'])?.match(/charset=([^;]+)/)?.[1] || null;

    const faviconEl = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
    const faviconUrl = faviconEl?.getAttribute('href') || null;

    const themeColor = getMeta(['meta[name="theme-color"]']);

    // -------------------------------------------------------------------------
    // Links Extraction (limit to 200 most relevant)
    // -------------------------------------------------------------------------
    const links: Array<{ url: string; text: string; rel: string | null; isExternal: boolean }> = [];
    const seenUrls = new Set<string>();

    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }

      try {
        const resolvedUrl = new URL(href, baseUrlParam).href;
        if (seenUrls.has(resolvedUrl)) return;
        seenUrls.add(resolvedUrl);

        const isExternal = new URL(resolvedUrl).hostname !== new URL(baseUrlParam).hostname;
        links.push({
          url: resolvedUrl,
          text: (a.textContent || '').trim().substring(0, 200),
          rel: a.getAttribute('rel'),
          isExternal,
        });
      } catch {
        // Invalid URL
      }
    });

    // -------------------------------------------------------------------------
    // Images with DOM Context
    // -------------------------------------------------------------------------
    const images: ImageDomContext[] = [];

    document.querySelectorAll('img').forEach((img, index) => {
      const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
      if (!src || src.startsWith('data:')) return;

      // Find caption - check figcaption, then common class patterns
      let caption: string | null = null;
      const figure = img.closest('figure');
      if (figure) {
        const figcaption = figure.querySelector('figcaption');
        if (figcaption) caption = figcaption.textContent?.trim() || null;
      }
      if (!caption) {
        const parent = img.parentElement?.parentElement;
        const captionEl = parent?.querySelector('[class*="caption"], [class*="Caption"]');
        if (captionEl) caption = captionEl.textContent?.trim() || null;
      }

      // Find credit/byline
      let credit: string | null = null;
      const creditEl = figure?.querySelector('[class*="credit"], [class*="Credit"], [class*="byline"], [class*="Byline"]') ||
                       img.parentElement?.querySelector('[class*="credit"], [class*="Credit"]');
      if (creditEl) credit = creditEl.textContent?.trim() || null;

      // Find attribution
      let attribution: string | null = null;
      attribution = img.getAttribute('data-credit') || img.getAttribute('data-attribution') ||
                    img.getAttribute('data-source') || img.parentElement?.getAttribute('data-credit') || null;

      // Get context HTML (parent figure/picture)
      let contextHtml: string | null = null;
      const contextEl = img.closest('figure, picture');
      if (contextEl) {
        contextHtml = contextEl.outerHTML.substring(0, 2000); // Limit size
      }

      // Check if wrapped in link
      const linkWrapper = img.closest('a');
      const linkUrl = linkWrapper?.getAttribute('href') || null;

      // Determine if hero image (first large image, or has hero class)
      const isHero = index === 0 ||
                     img.classList.toString().toLowerCase().includes('hero') ||
                     img.closest('[class*="hero"], [class*="Hero"]') !== null;

      // Collect lazy-load attributes
      const lazyLoadAttrs: Record<string, string> = {};
      ['data-src', 'data-original', 'data-lazy', 'data-srcset', 'loading'].forEach((attr) => {
        const val = img.getAttribute(attr);
        if (val) lazyLoadAttrs[attr] = val;
      });

      images.push({
        src,
        srcset: img.srcset || null,
        dataSrc: img.getAttribute('data-src') || img.getAttribute('data-original') || null,
        alt: img.alt || null,
        title: img.title || null,
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
        caption,
        credit,
        attribution,
        contextHtml,
        linkUrl,
        isHero,
        figureClasses: figure?.className || null,
        lazyLoadAttrs,
      });
    });

    return {
      openGraph,
      schemaOrg,
      dublinCore,
      twitterCards,
      metaDescription,
      metaKeywords,
      metaRobots,
      metaAuthor,
      canonicalUrl,
      language,
      charset,
      faviconUrl,
      themeColor,
      links: links.slice(0, 200),
      images: images.slice(0, 100),
    };
  }, baseUrl);

  return {
    ...domData,
    httpHeaders: responseHeaders || {},
    httpStatus: responseStatus || null,
    httpContentType: responseHeaders?.['content-type'] || null,
    extractedAt,
    extractionMethod: 'puppeteer-dom',
  };
}

/**
 * Consolidate metadata into canonical values with fallback chain
 * Returns the "best" value for common fields
 */
export function consolidateMetadata(metadata: PageMetadata): {
  title: string | null;
  author: string | null;
  publishDate: string | null;
  modifiedDate: string | null;
  description: string | null;
  publisher: string | null;
  image: string | null;
  language: string | null;
} {
  return {
    title: metadata.openGraph.title ||
           metadata.schemaOrg.name ||
           metadata.twitterCards.title ||
           metadata.dublinCore.title ||
           null,

    author: metadata.schemaOrg.author ||
            metadata.openGraph.articleAuthor ||
            metadata.dublinCore.creator ||
            metadata.twitterCards.creator ||
            metadata.metaAuthor ||
            null,

    publishDate: metadata.schemaOrg.datePublished ||
                 metadata.openGraph.articlePublishedTime ||
                 metadata.dublinCore.date ||
                 null,

    modifiedDate: metadata.schemaOrg.dateModified ||
                  metadata.openGraph.articleModifiedTime ||
                  null,

    description: metadata.openGraph.description ||
                 metadata.schemaOrg.description ||
                 metadata.twitterCards.description ||
                 metadata.metaDescription ||
                 metadata.dublinCore.description ||
                 null,

    publisher: metadata.schemaOrg.publisher ||
               metadata.openGraph.siteName ||
               metadata.dublinCore.publisher ||
               null,

    image: metadata.openGraph.image ||
           metadata.schemaOrg.image ||
           metadata.twitterCards.image ||
           null,

    language: metadata.language ||
              metadata.dublinCore.language ||
              metadata.openGraph.locale?.split('_')[0] ||
              null,
  };
}
