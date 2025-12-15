# IMPLEMENTATION GUIDE: Web Source Detail Viewer & Enhanced Metadata

**Version:** 1.0
**Date:** 2025-12-11
**Target:** Complete implementation with step-by-step code changes

---

## Overview

This guide provides exact code changes to implement enhanced web source metadata extraction and a comprehensive archive viewer modal. Follow each section in order.

---

## Prerequisites

- Existing OPT-109/OPT-110 web source infrastructure
- Migration 65 is the last migration
- exiftool-vendored already bundled

---

## Phase 1: Database Migration 66

### File: `packages/desktop/electron/main/database.ts`

**Location:** After Migration 65 (around line 2501)

**Add the following migration:**

```typescript
    // Migration 66: Enhanced web source metadata for archive viewer
    // OPT-111: Add domain, extracted_links, page_metadata_json columns
    // Create web_source_images and web_source_videos tables
    const wsHasDomain = sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM pragma_table_info('web_sources') WHERE name = 'domain'
    `).get() as { cnt: number };

    if (wsHasDomain.cnt === 0) {
      console.log('Running migration 66: Enhanced web source metadata tables');

      // Add new columns to web_sources
      sqlite.exec(`
        ALTER TABLE web_sources ADD COLUMN domain TEXT;
        ALTER TABLE web_sources ADD COLUMN extracted_links TEXT;
        ALTER TABLE web_sources ADD COLUMN page_metadata_json TEXT;
        ALTER TABLE web_sources ADD COLUMN http_headers_json TEXT;
        ALTER TABLE web_sources ADD COLUMN canonical_url TEXT;
        ALTER TABLE web_sources ADD COLUMN language TEXT;
        ALTER TABLE web_sources ADD COLUMN favicon_path TEXT;
      `);

      // Create web_source_images table for per-image metadata
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS web_source_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id TEXT NOT NULL,
          image_index INTEGER NOT NULL,

          -- Location
          url TEXT NOT NULL,
          local_path TEXT,
          hash TEXT,

          -- Dimensions
          width INTEGER,
          height INTEGER,
          size INTEGER,

          -- Metadata from page
          original_filename TEXT,
          alt TEXT,
          caption TEXT,
          credit TEXT,
          attribution TEXT,
          srcset_variants TEXT,
          context_html TEXT,
          link_url TEXT,

          -- EXIF from downloaded file
          exif_json TEXT,

          -- Flags
          is_hi_res INTEGER DEFAULT 0,
          is_hero INTEGER DEFAULT 0,

          created_at TEXT DEFAULT (datetime('now')),

          FOREIGN KEY (source_id) REFERENCES web_sources(source_id) ON DELETE CASCADE
        )
      `);
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_web_source_images_source ON web_source_images(source_id)`);

      // Create web_source_videos table for per-video metadata
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS web_source_videos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id TEXT NOT NULL,
          video_index INTEGER NOT NULL,

          -- Location
          url TEXT NOT NULL,
          local_path TEXT,
          hash TEXT,

          -- Basic info
          title TEXT,
          description TEXT,
          duration INTEGER,
          size INTEGER,
          platform TEXT,

          -- Source info
          uploader TEXT,
          uploader_url TEXT,
          upload_date TEXT,
          view_count INTEGER,
          like_count INTEGER,

          -- Extended metadata
          tags TEXT,
          categories TEXT,
          thumbnail_url TEXT,
          thumbnail_path TEXT,
          metadata_json TEXT,

          created_at TEXT DEFAULT (datetime('now')),

          FOREIGN KEY (source_id) REFERENCES web_sources(source_id) ON DELETE CASCADE
        )
      `);
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_web_source_videos_source ON web_source_videos(source_id)`);

      console.log('Migration 66 completed: Enhanced web source metadata tables created');
    }
```

---

## Phase 2: TypeScript Types

### File: `packages/desktop/electron/main/database.types.ts`

**Add after WebSourceVersionsTable (around line 826):**

```typescript
// Web Source Images table - Per-image metadata from archived pages
export interface WebSourceImagesTable {
  id: number;
  source_id: string;
  image_index: number;

  // Location
  url: string;
  local_path: string | null;
  hash: string | null;

  // Dimensions
  width: number | null;
  height: number | null;
  size: number | null;

  // Metadata from page
  original_filename: string | null;
  alt: string | null;
  caption: string | null;
  credit: string | null;
  attribution: string | null;
  srcset_variants: string | null;  // JSON array
  context_html: string | null;
  link_url: string | null;

  // EXIF from downloaded file
  exif_json: string | null;

  // Flags
  is_hi_res: number;
  is_hero: number;

  created_at: string;
}

// Web Source Videos table - Per-video metadata from archived pages
export interface WebSourceVideosTable {
  id: number;
  source_id: string;
  video_index: number;

  // Location
  url: string;
  local_path: string | null;
  hash: string | null;

  // Basic info
  title: string | null;
  description: string | null;
  duration: number | null;
  size: number | null;
  platform: string | null;

  // Source info
  uploader: string | null;
  uploader_url: string | null;
  upload_date: string | null;
  view_count: number | null;
  like_count: number | null;

  // Extended metadata
  tags: string | null;  // JSON array
  categories: string | null;  // JSON array
  thumbnail_url: string | null;
  thumbnail_path: string | null;
  metadata_json: string | null;

  created_at: string;
}
```

**Update WebSourcesTable to add new columns (around line 746):**

Add these fields after `provenance_hash`:

```typescript
  // OPT-111: Enhanced metadata
  domain: string | null;
  extracted_links: string | null;     // JSON array of {url, text, rel} objects
  page_metadata_json: string | null;  // Full OpenGraph, Schema.org, meta tags
  http_headers_json: string | null;   // HTTP response headers
  canonical_url: string | null;
  language: string | null;
  favicon_path: string | null;
```

**Update Database interface to include new tables:**

Find the `export interface Database` section and add:

```typescript
  web_source_images: WebSourceImagesTable;
  web_source_videos: WebSourceVideosTable;
```

---

## Phase 3: Enhanced Extraction Service

### File: `packages/desktop/electron/services/websource-extraction-service.ts`

**Update ExtractedImage interface (around line 32):**

```typescript
export interface ExtractedImage {
  url: string;
  localPath: string;
  hash: string;
  width: number;
  height: number;
  size: number;
  alt: string | null;
  isHiRes: boolean;

  // OPT-111: Enhanced metadata
  originalFilename: string | null;
  srcsetVariants: string[] | null;
  caption: string | null;
  credit: string | null;
  attribution: string | null;
  contextHtml: string | null;
  linkUrl: string | null;
  exif: Record<string, unknown> | null;
  isHero: boolean;
}
```

**Update ExtractedVideo interface (around line 43):**

```typescript
export interface ExtractedVideo {
  url: string;
  localPath: string;
  hash: string;
  title: string | null;
  duration: number | null;
  size: number;
  platform: string;

  // OPT-111: Enhanced metadata
  description: string | null;
  uploader: string | null;
  uploaderUrl: string | null;
  uploadDate: string | null;
  viewCount: number | null;
  likeCount: number | null;
  tags: string[] | null;
  categories: string[] | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  metadata: Record<string, unknown> | null;
}
```

**Add new PageMetadata interface:**

```typescript
export interface PageMetadata {
  domain: string;
  canonicalUrl: string | null;
  language: string | null;
  faviconUrl: string | null;
  openGraph: Record<string, string>;
  twitterCard: Record<string, string>;
  schemaOrg: unknown[];
  metaTags: Record<string, string>;
  links: Array<{ url: string; text: string; rel: string | null }>;
  httpHeaders: Record<string, string>;
}

export interface PageMetadataResult {
  success: boolean;
  metadata: PageMetadata | null;
  error?: string;
  duration: number;
}
```

**Add extractPageMetadata function:**

```typescript
/**
 * Extract comprehensive page metadata
 * OPT-111: Captures OpenGraph, Schema.org, meta tags, links, etc.
 */
export async function extractPageMetadata(options: ExtractionOptions): Promise<PageMetadataResult> {
  const startTime = Date.now();
  let page: Page | null = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // Capture HTTP headers
    let httpHeaders: Record<string, string> = {};
    page.on('response', async (response) => {
      if (response.url() === options.url) {
        httpHeaders = response.headers();
      }
    });

    await page.goto(options.url, {
      waitUntil: 'networkidle2',
      timeout: options.timeout || 30000,
    });

    // Extract all metadata from the page
    const metadata = await page.evaluate((pageUrl: string) => {
      const url = new URL(pageUrl);
      const domain = url.hostname.replace(/^www\./, '');

      // Get canonical URL
      const canonicalEl = document.querySelector('link[rel="canonical"]');
      const canonicalUrl = canonicalEl?.getAttribute('href') || null;

      // Get language
      const language = document.documentElement.lang || null;

      // Get favicon
      const faviconEl = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
      const faviconUrl = faviconEl?.getAttribute('href') || '/favicon.ico';

      // Extract OpenGraph tags
      const openGraph: Record<string, string> = {};
      document.querySelectorAll('meta[property^="og:"]').forEach((el) => {
        const prop = el.getAttribute('property')?.replace('og:', '') || '';
        const content = el.getAttribute('content') || '';
        if (prop && content) openGraph[prop] = content;
      });

      // Extract Twitter Card tags
      const twitterCard: Record<string, string> = {};
      document.querySelectorAll('meta[name^="twitter:"]').forEach((el) => {
        const name = el.getAttribute('name')?.replace('twitter:', '') || '';
        const content = el.getAttribute('content') || '';
        if (name && content) twitterCard[name] = content;
      });

      // Extract Schema.org JSON-LD
      const schemaOrg: unknown[] = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
        try {
          const parsed = JSON.parse(el.textContent || '');
          schemaOrg.push(parsed);
        } catch {}
      });

      // Extract meta tags
      const metaTags: Record<string, string> = {};
      document.querySelectorAll('meta[name], meta[property]').forEach((el) => {
        const name = el.getAttribute('name') || el.getAttribute('property') || '';
        const content = el.getAttribute('content') || '';
        if (name && content && !name.startsWith('og:') && !name.startsWith('twitter:')) {
          metaTags[name] = content;
        }
      });

      // Extract relevant links (deduplicated, filtered)
      const seenUrls = new Set<string>();
      const links: Array<{ url: string; text: string; rel: string | null }> = [];

      document.querySelectorAll('a[href]').forEach((el) => {
        const href = el.getAttribute('href');
        if (!href) return;

        try {
          const linkUrl = new URL(href, pageUrl);
          // Skip anchors, javascript, mailto, etc.
          if (!linkUrl.protocol.startsWith('http')) return;
          // Skip if already seen
          if (seenUrls.has(linkUrl.href)) return;
          seenUrls.add(linkUrl.href);

          links.push({
            url: linkUrl.href,
            text: el.textContent?.trim().slice(0, 200) || '',
            rel: el.getAttribute('rel'),
          });
        } catch {}
      });

      return {
        domain,
        canonicalUrl,
        language,
        faviconUrl,
        openGraph,
        twitterCard,
        schemaOrg,
        metaTags,
        links: links.slice(0, 200), // Limit to 200 links
      };
    }, options.url);

    return {
      success: true,
      metadata: {
        ...metadata,
        httpHeaders,
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      metadata: null,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}
```

**Update extractImages to capture enhanced metadata:**

In the `page.evaluate` section, update to capture more data:

```typescript
// Inside page.evaluate for images
document.querySelectorAll('img').forEach((img) => {
  const width = img.naturalWidth || img.width || 0;
  const height = img.naturalHeight || img.height || 0;

  if (width < minWidth || height < minHeight) return;

  // Get parent figure/figcaption if exists
  const figure = img.closest('figure');
  const figcaption = figure?.querySelector('figcaption');
  const caption = figcaption?.textContent?.trim() || null;

  // Get credit/attribution
  const credit = img.getAttribute('data-credit') ||
    img.getAttribute('data-photographer') ||
    img.getAttribute('data-author') ||
    figure?.querySelector('.credit, .photographer, [class*="credit"]')?.textContent?.trim() ||
    null;

  const attribution = img.getAttribute('data-attribution') ||
    figure?.querySelector('[rel="license"], .license, .attribution')?.textContent?.trim() ||
    null;

  // Get link wrapper
  const linkParent = img.closest('a');
  const linkUrl = linkParent?.getAttribute('href') || null;

  // Get context HTML (figure or immediate parent)
  const contextHtml = figure?.outerHTML?.slice(0, 2000) ||
    img.parentElement?.outerHTML?.slice(0, 1000) ||
    null;

  // Parse srcset for all variants
  const srcsetVariants: string[] = [];
  if (img.srcset) {
    img.srcset.split(',').forEach((part) => {
      const [url] = part.trim().split(/\s+/);
      if (url) srcsetVariants.push(url);
    });
  }

  // Parse original filename from URL
  let originalFilename: string | null = null;
  try {
    const imgUrl = new URL(img.src);
    const pathParts = imgUrl.pathname.split('/');
    originalFilename = pathParts[pathParts.length - 1] || null;
  } catch {}

  images.push({
    src: img.src,
    srcset: img.srcset || null,
    dataSrc: img.getAttribute('data-src') || img.getAttribute('data-original') || null,
    width,
    height,
    alt: img.alt || null,
    caption,
    credit,
    attribution,
    linkUrl,
    contextHtml,
    srcsetVariants,
    originalFilename,
    isHero: img.closest('header, .hero, [class*="hero"]') !== null,
  });
});
```

---

## Phase 4: Repository Updates

### File: `packages/desktop/electron/repositories/sqlite-websources-repository.ts`

**Add new methods for image/video CRUD:**

```typescript
/**
 * Insert image metadata for a web source
 */
async insertImages(sourceId: string, images: ExtractedImage[]): Promise<void> {
  const db = getDatabase();

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    await db.insertInto('web_source_images').values({
      source_id: sourceId,
      image_index: i,
      url: img.url,
      local_path: img.localPath,
      hash: img.hash,
      width: img.width,
      height: img.height,
      size: img.size,
      original_filename: img.originalFilename,
      alt: img.alt,
      caption: img.caption,
      credit: img.credit,
      attribution: img.attribution,
      srcset_variants: img.srcsetVariants ? JSON.stringify(img.srcsetVariants) : null,
      context_html: img.contextHtml,
      link_url: img.linkUrl,
      exif_json: img.exif ? JSON.stringify(img.exif) : null,
      is_hi_res: img.isHiRes ? 1 : 0,
      is_hero: img.isHero ? 1 : 0,
    }).execute();
  }
}

/**
 * Insert video metadata for a web source
 */
async insertVideos(sourceId: string, videos: ExtractedVideo[]): Promise<void> {
  const db = getDatabase();

  for (let i = 0; i < videos.length; i++) {
    const vid = videos[i];
    await db.insertInto('web_source_videos').values({
      source_id: sourceId,
      video_index: i,
      url: vid.url,
      local_path: vid.localPath,
      hash: vid.hash,
      title: vid.title,
      description: vid.description,
      duration: vid.duration,
      size: vid.size,
      platform: vid.platform,
      uploader: vid.uploader,
      uploader_url: vid.uploaderUrl,
      upload_date: vid.uploadDate,
      view_count: vid.viewCount,
      like_count: vid.likeCount,
      tags: vid.tags ? JSON.stringify(vid.tags) : null,
      categories: vid.categories ? JSON.stringify(vid.categories) : null,
      thumbnail_url: vid.thumbnailUrl,
      thumbnail_path: vid.thumbnailPath,
      metadata_json: vid.metadata ? JSON.stringify(vid.metadata) : null,
    }).execute();
  }
}

/**
 * Get all images for a web source
 */
async findImages(sourceId: string): Promise<WebSourceImagesTable[]> {
  const db = getDatabase();
  return await db
    .selectFrom('web_source_images')
    .selectAll()
    .where('source_id', '=', sourceId)
    .orderBy('image_index', 'asc')
    .execute();
}

/**
 * Get all videos for a web source
 */
async findVideos(sourceId: string): Promise<WebSourceVideosTable[]> {
  const db = getDatabase();
  return await db
    .selectFrom('web_source_videos')
    .selectAll()
    .where('source_id', '=', sourceId)
    .orderBy('video_index', 'asc')
    .execute();
}

/**
 * Delete all images for a source (used during re-archive)
 */
async deleteImages(sourceId: string): Promise<void> {
  const db = getDatabase();
  await db
    .deleteFrom('web_source_images')
    .where('source_id', '=', sourceId)
    .execute();
}

/**
 * Delete all videos for a source (used during re-archive)
 */
async deleteVideos(sourceId: string): Promise<void> {
  const db = getDatabase();
  await db
    .deleteFrom('web_source_videos')
    .where('source_id', '=', sourceId)
    .execute();
}
```

---

## Phase 5: IPC Handlers

### File: `packages/desktop/electron/main/ipc-handlers/websources.ts`

**Add new handlers:**

```typescript
// Get images for a web source
ipcMain.handle('websources:getImages', async (_event, sourceId: string) => {
  try {
    const validatedId = SourceIdSchema.parse(sourceId);
    const repo = new SQLiteWebSourcesRepository();
    return await repo.findImages(validatedId);
  } catch (error) {
    console.error('Error getting web source images:', error);
    throw error;
  }
});

// Get videos for a web source
ipcMain.handle('websources:getVideos', async (_event, sourceId: string) => {
  try {
    const validatedId = SourceIdSchema.parse(sourceId);
    const repo = new SQLiteWebSourcesRepository();
    return await repo.findVideos(validatedId);
  } catch (error) {
    console.error('Error getting web source videos:', error);
    throw error;
  }
});

// Get full detail for archive viewer
ipcMain.handle('websources:getDetail', async (_event, sourceId: string) => {
  try {
    const validatedId = SourceIdSchema.parse(sourceId);
    const repo = new SQLiteWebSourcesRepository();

    const source = await repo.findById(validatedId);
    if (!source) {
      throw new Error('Web source not found');
    }

    const images = await repo.findImages(validatedId);
    const videos = await repo.findVideos(validatedId);

    return {
      source,
      images,
      videos,
    };
  } catch (error) {
    console.error('Error getting web source detail:', error);
    throw error;
  }
});
```

---

## Phase 6: Preload Bridge

### File: `packages/desktop/electron/preload/index.cjs`

**Add to websources section:**

```javascript
getImages: (sourceId) => ipcRenderer.invoke('websources:getImages', sourceId),
getVideos: (sourceId) => ipcRenderer.invoke('websources:getVideos', sourceId),
getDetail: (sourceId) => ipcRenderer.invoke('websources:getDetail', sourceId),
```

---

## Phase 7: Renderer Types

### File: `packages/desktop/src/types/electron.d.ts`

**Add interfaces:**

```typescript
interface WebSourceImage {
  id: number;
  source_id: string;
  image_index: number;
  url: string;
  local_path: string | null;
  hash: string | null;
  width: number | null;
  height: number | null;
  size: number | null;
  original_filename: string | null;
  alt: string | null;
  caption: string | null;
  credit: string | null;
  attribution: string | null;
  srcset_variants: string | null;
  context_html: string | null;
  link_url: string | null;
  exif_json: string | null;
  is_hi_res: number;
  is_hero: number;
  created_at: string;
}

interface WebSourceVideo {
  id: number;
  source_id: string;
  video_index: number;
  url: string;
  local_path: string | null;
  hash: string | null;
  title: string | null;
  description: string | null;
  duration: number | null;
  size: number | null;
  platform: string | null;
  uploader: string | null;
  uploader_url: string | null;
  upload_date: string | null;
  view_count: number | null;
  like_count: number | null;
  tags: string | null;
  categories: string | null;
  thumbnail_url: string | null;
  thumbnail_path: string | null;
  metadata_json: string | null;
  created_at: string;
}

interface WebSourceDetail {
  source: WebSource;
  images: WebSourceImage[];
  videos: WebSourceVideo[];
}
```

**Add to websources interface:**

```typescript
getImages(sourceId: string): Promise<WebSourceImage[]>;
getVideos(sourceId: string): Promise<WebSourceVideo[]>;
getDetail(sourceId: string): Promise<WebSourceDetail>;
```

---

## Phase 8: Web Source Detail Modal Component

### File: `packages/desktop/src/components/location/WebSourceDetailModal.svelte`

Create new file with Braun-compliant design:

```svelte
<script lang="ts">
  /**
   * WebSourceDetailModal - Comprehensive archive viewer
   * OPT-111: Shows all extracted metadata from archived web pages
   * Braun Design: Functional minimalism, data-dense but readable
   */

  interface WebSource {
    source_id: string;
    url: string;
    title: string | null;
    source_type: string;
    status: string;
    notes: string | null;
    extracted_title: string | null;
    extracted_author: string | null;
    extracted_date: string | null;
    extracted_publisher: string | null;
    word_count: number;
    image_count: number;
    video_count: number;
    screenshot_path: string | null;
    pdf_path: string | null;
    html_path: string | null;
    warc_path: string | null;
    domain: string | null;
    extracted_links: string | null;
    page_metadata_json: string | null;
    archived_at: string | null;
    created_at: string;
  }

  interface WebSourceImage {
    id: number;
    url: string;
    local_path: string | null;
    hash: string | null;
    width: number | null;
    height: number | null;
    size: number | null;
    original_filename: string | null;
    alt: string | null;
    caption: string | null;
    credit: string | null;
    attribution: string | null;
    srcset_variants: string | null;
    exif_json: string | null;
    is_hi_res: number;
    is_hero: number;
  }

  interface WebSourceVideo {
    id: number;
    url: string;
    local_path: string | null;
    title: string | null;
    description: string | null;
    duration: number | null;
    platform: string | null;
    uploader: string | null;
    upload_date: string | null;
    view_count: number | null;
    metadata_json: string | null;
  }

  interface Props {
    sourceId: string;
    onClose: () => void;
    onOpenFile?: (path: string) => void;
  }

  let { sourceId, onClose, onOpenFile }: Props = $props();

  // State
  let loading = $state(true);
  let source = $state<WebSource | null>(null);
  let images = $state<WebSourceImage[]>([]);
  let videos = $state<WebSourceVideo[]>([]);
  let selectedImage = $state<WebSourceImage | null>(null);

  // Collapsible sections
  let showLinks = $state(false);
  let showImages = $state(true);
  let showVideos = $state(true);

  // Load data on mount
  $effect(() => {
    if (sourceId) {
      loadDetail();
    }
  });

  async function loadDetail() {
    loading = true;
    try {
      const detail = await window.electronAPI.websources.getDetail(sourceId);
      source = detail.source;
      images = detail.images;
      videos = detail.videos;
    } catch (err) {
      console.error('Failed to load web source detail:', err);
    } finally {
      loading = false;
    }
  }

  function formatBytes(bytes: number | null): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDuration(seconds: number | null): string {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }

  function parseLinks(): Array<{ url: string; text: string }> {
    if (!source?.extracted_links) return [];
    try {
      return JSON.parse(source.extracted_links).slice(0, 50);
    } catch {
      return [];
    }
  }

  function parseExif(exifJson: string | null): Record<string, unknown> | null {
    if (!exifJson) return null;
    try {
      return JSON.parse(exifJson);
    } catch {
      return null;
    }
  }

  function parseSrcset(srcsetJson: string | null): string[] {
    if (!srcsetJson) return [];
    try {
      return JSON.parse(srcsetJson);
    } catch {
      return [];
    }
  }

  function handleOpenFile(path: string | null) {
    if (path && onOpenFile) {
      onOpenFile(path);
    }
  }
</script>

<!-- Modal Backdrop -->
<div
  class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
  onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
  onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
  role="dialog"
  aria-modal="true"
>
  <!-- Modal Content -->
  <div class="bg-braun-50 w-full max-w-4xl max-h-[90vh] rounded overflow-hidden flex flex-col">
    {#if loading}
      <div class="p-8 text-center text-braun-400">Loading archive...</div>
    {:else if !source}
      <div class="p-8 text-center text-braun-400">Archive not found</div>
    {:else if selectedImage}
      <!-- Image Detail View -->
      <div class="flex-1 overflow-y-auto">
        <div class="p-6">
          <button
            onclick={() => selectedImage = null}
            class="text-sm text-braun-600 hover:text-braun-900 mb-4 flex items-center gap-1"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Images
          </button>

          <!-- Image Preview -->
          {#if selectedImage.local_path}
            <div class="mb-6 bg-braun-200 rounded overflow-hidden">
              <img
                src="file://{selectedImage.local_path}"
                alt={selectedImage.alt || 'Archived image'}
                class="max-w-full max-h-96 mx-auto object-contain"
              />
            </div>
          {/if}

          <!-- Image Metadata -->
          <div class="space-y-6">
            <section>
              <h3 class="text-xs font-semibold text-braun-500 uppercase tracking-wider mb-3">FILE INFO</h3>
              <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt class="text-braun-500">Filename</dt>
                <dd class="text-braun-900">{selectedImage.original_filename || '—'}</dd>
                <dt class="text-braun-500">Dimensions</dt>
                <dd class="text-braun-900">{selectedImage.width || '?'} x {selectedImage.height || '?'}</dd>
                <dt class="text-braun-500">Size</dt>
                <dd class="text-braun-900">{formatBytes(selectedImage.size)}</dd>
                <dt class="text-braun-500">Hash</dt>
                <dd class="text-braun-900 font-mono text-xs">{selectedImage.hash || '—'}</dd>
                <dt class="text-braun-500">Hi-Res</dt>
                <dd class="text-braun-900">{selectedImage.is_hi_res ? 'Yes' : 'No'}</dd>
              </dl>
            </section>

            <section>
              <h3 class="text-xs font-semibold text-braun-500 uppercase tracking-wider mb-3">PAGE METADATA</h3>
              <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt class="text-braun-500">Alt Text</dt>
                <dd class="text-braun-900">{selectedImage.alt || '—'}</dd>
                <dt class="text-braun-500">Caption</dt>
                <dd class="text-braun-900">{selectedImage.caption || '—'}</dd>
                <dt class="text-braun-500">Credit</dt>
                <dd class="text-braun-900">{selectedImage.credit || '—'}</dd>
                <dt class="text-braun-500">Attribution</dt>
                <dd class="text-braun-900">{selectedImage.attribution || '—'}</dd>
              </dl>
            </section>

            {#if parseSrcset(selectedImage.srcset_variants).length > 0}
              <section>
                <h3 class="text-xs font-semibold text-braun-500 uppercase tracking-wider mb-3">AVAILABLE RESOLUTIONS</h3>
                <div class="flex flex-wrap gap-2">
                  {#each parseSrcset(selectedImage.srcset_variants) as variant}
                    <span class="px-2 py-1 bg-braun-200 text-braun-600 text-xs rounded">{variant}</span>
                  {/each}
                </div>
              </section>
            {/if}

            {#if parseExif(selectedImage.exif_json)}
              <section>
                <h3 class="text-xs font-semibold text-braun-500 uppercase tracking-wider mb-3">EXIF DATA</h3>
                <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {#each Object.entries(parseExif(selectedImage.exif_json) || {}).slice(0, 20) as [key, value]}
                    <dt class="text-braun-500 truncate">{key}</dt>
                    <dd class="text-braun-900 truncate">{String(value)}</dd>
                  {/each}
                </dl>
              </section>
            {/if}
          </div>
        </div>
      </div>
    {:else}
      <!-- Main Archive View -->
      <header class="p-6 border-b border-braun-300 flex items-start justify-between">
        <div class="flex-1 min-w-0">
          <h2 class="text-xl font-semibold text-braun-900 truncate">
            {source.title || source.extracted_title || 'Archived Page'}
          </h2>
          <div class="flex items-center gap-2 mt-1 text-sm text-braun-500">
            <span>{source.domain || new URL(source.url).hostname}</span>
            <span class="text-braun-300">|</span>
            <span class="capitalize">{source.source_type}</span>
            <span class="text-braun-300">|</span>
            <span>Archived {formatDate(source.archived_at)}</span>
          </div>
        </div>
        <button
          onclick={onClose}
          class="p-2 text-braun-400 hover:text-braun-900 transition"
          aria-label="Close"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div class="flex-1 overflow-y-auto p-6 space-y-6">
        <!-- Page Info -->
        <section>
          <h3 class="text-xs font-semibold text-braun-500 uppercase tracking-wider mb-3">PAGE INFO</h3>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {#if source.extracted_author}
              <dt class="text-braun-500">Author</dt>
              <dd class="text-braun-900">{source.extracted_author}</dd>
            {/if}
            {#if source.extracted_date}
              <dt class="text-braun-500">Published</dt>
              <dd class="text-braun-900">{formatDate(source.extracted_date)}</dd>
            {/if}
            {#if source.extracted_publisher}
              <dt class="text-braun-500">Publisher</dt>
              <dd class="text-braun-900">{source.extracted_publisher}</dd>
            {/if}
            <dt class="text-braun-500">Words</dt>
            <dd class="text-braun-900">{source.word_count.toLocaleString()}</dd>
            <dt class="text-braun-500">Images</dt>
            <dd class="text-braun-900">{source.image_count}</dd>
            <dt class="text-braun-500">Videos</dt>
            <dd class="text-braun-900">{source.video_count}</dd>
          </dl>
        </section>

        <!-- Archive Files -->
        <section>
          <h3 class="text-xs font-semibold text-braun-500 uppercase tracking-wider mb-3">ARCHIVE FILES</h3>
          <div class="flex flex-wrap gap-2">
            {#if source.screenshot_path}
              <button
                onclick={() => handleOpenFile(source.screenshot_path)}
                class="px-3 py-2 bg-braun-200 text-braun-700 text-sm rounded hover:bg-braun-300 transition"
              >
                Screenshot
              </button>
            {/if}
            {#if source.pdf_path}
              <button
                onclick={() => handleOpenFile(source.pdf_path)}
                class="px-3 py-2 bg-braun-200 text-braun-700 text-sm rounded hover:bg-braun-300 transition"
              >
                PDF
              </button>
            {/if}
            {#if source.html_path}
              <button
                onclick={() => handleOpenFile(source.html_path)}
                class="px-3 py-2 bg-braun-200 text-braun-700 text-sm rounded hover:bg-braun-300 transition"
              >
                HTML
              </button>
            {/if}
            {#if source.warc_path}
              <button
                onclick={() => handleOpenFile(source.warc_path)}
                class="px-3 py-2 bg-braun-200 text-braun-700 text-sm rounded hover:bg-braun-300 transition"
              >
                WARC
              </button>
            {/if}
          </div>
        </section>

        <!-- Extracted Links -->
        {#if parseLinks().length > 0}
          <section>
            <button
              onclick={() => showLinks = !showLinks}
              class="w-full flex items-center justify-between text-xs font-semibold text-braun-500 uppercase tracking-wider mb-3"
            >
              <span>EXTRACTED LINKS ({parseLinks().length})</span>
              <span class="text-braun-400">{showLinks ? '▲' : '▼'}</span>
            </button>
            {#if showLinks}
              <ul class="space-y-1 max-h-48 overflow-y-auto text-sm">
                {#each parseLinks() as link}
                  <li class="truncate">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener"
                      class="text-braun-600 hover:text-braun-900 hover:underline"
                    >
                      {link.text || link.url}
                    </a>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}

        <!-- Images -->
        {#if images.length > 0}
          <section>
            <button
              onclick={() => showImages = !showImages}
              class="w-full flex items-center justify-between text-xs font-semibold text-braun-500 uppercase tracking-wider mb-3"
            >
              <span>IMAGES ({images.length})</span>
              <span class="text-braun-400">{showImages ? '▲' : '▼'}</span>
            </button>
            {#if showImages}
              <div class="grid grid-cols-4 gap-2">
                {#each images as img}
                  <button
                    onclick={() => selectedImage = img}
                    class="aspect-square bg-braun-200 rounded overflow-hidden hover:ring-2 hover:ring-braun-400 transition"
                  >
                    {#if img.local_path}
                      <img
                        src="file://{img.local_path}"
                        alt={img.alt || 'Archived image'}
                        class="w-full h-full object-cover"
                      />
                    {:else}
                      <div class="w-full h-full flex items-center justify-center text-braun-400 text-xs">
                        No file
                      </div>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </section>
        {/if}

        <!-- Videos -->
        {#if videos.length > 0}
          <section>
            <button
              onclick={() => showVideos = !showVideos}
              class="w-full flex items-center justify-between text-xs font-semibold text-braun-500 uppercase tracking-wider mb-3"
            >
              <span>VIDEOS ({videos.length})</span>
              <span class="text-braun-400">{showVideos ? '▲' : '▼'}</span>
            </button>
            {#if showVideos}
              <ul class="space-y-3">
                {#each videos as vid}
                  <li class="p-3 bg-white border border-braun-200 rounded">
                    <div class="font-medium text-braun-900">{vid.title || 'Untitled Video'}</div>
                    <div class="text-sm text-braun-500 mt-1">
                      {vid.platform || 'Unknown'} • {formatDuration(vid.duration)}
                      {#if vid.uploader} • by {vid.uploader}{/if}
                      {#if vid.view_count} • {vid.view_count.toLocaleString()} views{/if}
                    </div>
                    {#if vid.description}
                      <p class="text-sm text-braun-600 mt-2 line-clamp-2">{vid.description}</p>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}

        <!-- Notes -->
        {#if source.notes}
          <section>
            <h3 class="text-xs font-semibold text-braun-500 uppercase tracking-wider mb-3">NOTES</h3>
            <p class="text-sm text-braun-700 whitespace-pre-wrap">{source.notes}</p>
          </section>
        {/if}
      </div>
    {/if}
  </div>
</div>
```

---

## Phase 9: Integration with LocationWebSources

### File: `packages/desktop/src/components/location/LocationWebSources.svelte`

**Add modal state and import:**

At the top of the script:
```typescript
import WebSourceDetailModal from './WebSourceDetailModal.svelte';

let showDetailModal = $state(false);
let detailSourceId = $state<string | null>(null);

function handleViewArchive(sourceId: string) {
  detailSourceId = sourceId;
  showDetailModal = true;
}

function handleCloseDetail() {
  showDetailModal = false;
  detailSourceId = null;
}

function handleOpenFile(path: string) {
  window.electronAPI.shell.openPath(path);
}
```

**Add modal at the end of the template:**

```svelte
{#if showDetailModal && detailSourceId}
  <WebSourceDetailModal
    sourceId={detailSourceId}
    onClose={handleCloseDetail}
    onOpenFile={handleOpenFile}
  />
{/if}
```

**Update the "View" button to use the modal:**

Replace the existing `onViewArchive` prop usage with `handleViewArchive`.

---

## Verification Checklist

After implementation, verify:

1. [ ] Migration 66 runs without errors
2. [ ] New tables `web_source_images` and `web_source_videos` exist
3. [ ] New columns in `web_sources` exist
4. [ ] TypeScript compilation passes
5. [ ] IPC handlers respond correctly
6. [ ] Modal opens and displays source data
7. [ ] Image detail view shows metadata
8. [ ] Archive files buttons work
9. [ ] Extracted links display correctly
10. [ ] Videos list with metadata

---

## CLAUDE.md Compliance

- [ ] No new dependencies without license logging
- [ ] Schema changes via migration only
- [ ] IPC naming follows `domain:action` pattern
- [ ] Preload uses CommonJS
- [ ] No telemetry or external calls
- [ ] Offline-first (all data local)
- [ ] Braun design system colors and spacing
