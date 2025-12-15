# OPT-109: Web Sources Archiving Integration Plan

**Status:** DRAFT - Awaiting User Approval
**Created:** 2025-12-08
**Author:** Claude Opus 4.5
**Scope:** Major Feature - Web Archiving Overhaul

---

## Executive Summary

Transform the simple bookmark system into a comprehensive **research-grade web archive** that historians can trust for 35+ years. When a user adds a URL, we don't just save a link - we capture everything: the page, the text, the images, the videos. We extract that media into the main archive. We generate proper academic citations. We build a searchable knowledge base of sources.

**Core Principle:** The source may go offline tomorrow - we don't care, we have it all.

---

## Total Scope Overview

### What This Feature Does

1. **Archives Web Pages** - Screenshot, PDF, HTML, WARC for every URL
2. **Extracts Media** - Hi-res images, videos, with smart upgrade logic
3. **Extracts Text** - Clean article text + full DOM parsing
4. **Imports to Location** - Extracted images become part of location's media library
5. **Generates Citations** - MLA, APA, Chicago, BibTeX export
6. **Enables Search** - Full-text search across all archived content
7. **Tracks Provenance** - Cryptographic proof of when/what was archived
8. **Handles Forums** - Understands post structure, multiple authors
9. **Supports Login Walls** - Import from saved HTML files
10. **Detects Changes** - Diff between archive versions
11. **Exports Research** - Complete research packages with bibliography

### What Success Looks Like (Year 2060)

A historian opens AU Archive and:
- Sees a location with 500 photos from 50 sources
- Clicks any photo → sees "Source: Albany Times Union, March 1987"
- Clicks the source → sees the full original article offline
- Generates proper academic citation with one click
- Searches "asbestos" → finds all sources mentioning it
- Verifies archive authenticity via cryptographic chain
- Exports everything as a self-contained research package

---

## Scope: 12 Key Features

### Feature 1: Extracted Images → Main Media Library (P0)

**Problem:** Extracted images stay orphaned in web source folders.

**Solution:** After extraction, prompt user to import images to location. Imported images:
- Added to `imgs` table (first-class media)
- Linked back to source URL for attribution
- Appear in location gallery
- Can be set as hero image
- Searchable, taggable, exportable

**Database:**
```sql
ALTER TABLE imgs ADD COLUMN source_id TEXT REFERENCES web_sources(source_id);
ALTER TABLE imgs ADD COLUMN source_url TEXT;
ALTER TABLE imgs ADD COLUMN extracted_from_web INTEGER DEFAULT 0;
```

### Feature 2: Citation Generation (P1)

**Problem:** No way to cite archived sources properly.

**Solution:** Generate academic citations in all major formats:
- MLA
- APA
- Chicago
- BibTeX

Store `citation.txt` in each archive folder. UI button: "Copy Citation".

### Feature 3: Forum Structure Awareness (P1)

**Problem:** Forums have multiple authors, posts, dates - not just one article.

**Solution:** Detect forum structure and extract:
```json
{
  "type": "forum_thread",
  "posts": [
    { "author": "user1", "date": "2019-03-15", "content": "...", "images": [...] },
    { "author": "user2", "date": "2019-03-16", "content": "...", "images": [...] }
  ]
}
```

Attribute images to specific post authors, not just "the thread".

### Feature 4: Duplicate Media Detection (P2)

**Problem:** Same YouTube video in 5 sources = downloaded 5 times.

**Solution:** Before downloading, check if URL/hash already exists. Link to existing file instead of re-downloading.

### Feature 5: Import from Saved HTML (P1)

**Problem:** Can't archive login-walled content (private forums, paywalled articles).

**Solution:** Add "Import from HTML File" option:
1. User saves page in browser (Ctrl+S)
2. We process the saved HTML
3. Extract text, re-download images from embedded URLs
4. Full archive from local file

### Feature 6: Full-Text Search (P1)

**Problem:** With 10,000 sources, how do you find "that article about asbestos"?

**Solution:** SQLite FTS5 index on all extracted content:
```sql
CREATE VIRTUAL TABLE web_sources_fts USING fts5(
  source_id, url, title, extracted_text
);
```

UI: Search bar across all archived source content.

### Feature 7: Link Graph / Related Sources (P2)

**Problem:** Sources reference each other but we don't track relationships.

**Solution:** Extract outbound links, detect if we've archived them:
- "Source A cites Source B"
- "Source A cited by Source C"
- Show related sources in UI
- Suggest: "Archive linked sources?"

### Feature 8: Per-Component Status + Retry (P1)

**Problem:** Binary success/fail doesn't reflect partial archives.

**Solution:** Track each component separately:
```json
{
  "screenshot": "complete",
  "html": "complete",
  "warc": "complete",
  "images": { "status": "partial", "completed": 8, "failed": 4 },
  "videos": { "status": "failed", "error": "blocked" },
  "text": "complete"
}
```

UI shows per-component status with individual retry buttons.

### Feature 9: Change Detection Between Versions (P2)

**Problem:** Re-archiving creates new version but no diff.

**Solution:** Compare text hashes between versions:
- "No content changes"
- "3 new paragraphs added"
- "2 images added since last archive"
- Show changelog in detail modal

### Feature 10: Export as Research Package (P1)

**Problem:** No way to share/backup web source research.

**Solution:** Export includes:
- All archived web sources (screenshots, PDFs, text)
- Extracted media
- Generated bibliography
- Offline-browsable index.html
- BagIt manifest (RFC 8493)

### Feature 11: Quick Cite vs Full Import (P2)

**Problem:** Sometimes you just need a quick reference, not full extraction.

**Solution:** Two modes:
- **Quick Archive:** Screenshot + PDF + metadata (5 seconds)
- **Full Archive:** Everything - images, videos, text, WARC (30-120 seconds)

Default: Full Archive

### Feature 12: Provenance Chain / Authenticity (P1)

**Problem:** In 35 years, how prove archive is authentic?

**Solution:** Cryptographic chain:
```json
{
  "url": "...",
  "fetched_at": "2025-12-08T14:32:00Z",
  "http_headers": { ... },
  "raw_html_hash": "abc123...",
  "extracted_files": {
    "screenshot.png": "def456...",
    "content.txt": "ghi789..."
  }
}
```

Proves: "We fetched this URL on this date and extracted this content."

---

## Priority Matrix

| Feature | Priority | Effort | Phase |
|---------|----------|--------|-------|
| F1: Images → Media Library | P0 | Medium | 1 |
| F8: Per-Component Status | P1 | Low | 1 |
| F12: Provenance Chain | P1 | Low | 1 |
| F2: Citation Generation | P1 | Low | 2 |
| F5: Import from HTML | P1 | Medium | 2 |
| F6: Full-Text Search | P1 | Medium | 2 |
| F3: Forum Awareness | P1 | Medium | 3 |
| F10: Research Export | P1 | Medium | 3 |
| F4: Duplicate Detection | P2 | Low | 3 |
| F7: Link Graph | P2 | Medium | 4 |
| F9: Change Detection | P2 | Medium | 4 |
| F11: Quick vs Full Mode | P2 | Low | 4 |

---

## Current State Analysis

### Existing Bookmark System

**Database Schema** (Migration 5 + 35):
```sql
CREATE TABLE bookmarks (
  bookmark_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT,
  locid TEXT REFERENCES locs(locid),
  subid TEXT REFERENCES slocs(subid),  -- Migration 35
  bookmark_date TEXT NOT NULL,
  auth_imp TEXT,
  thumbnail_path TEXT
);
```

**Current Capabilities:**
- Store URL + title
- Link to location or sub-location
- Display in list format
- Open in external browser
- Basic CRUD operations

**Limitations:**
- No content preservation (link rot risk)
- No offline access
- No visual capture
- No metadata extraction
- No archive verification

### Existing Components

| Component | Purpose | Lines |
|-----------|---------|-------|
| `sqlite-bookmarks-repository.ts` | CRUD operations | ~205 |
| `LocationBookmarks.svelte` | Location page bookmark UI | ~173 |
| `Bookmarks.svelte` | Global bookmarks page | ~232 |
| `bookmarks.ts` (IPC handlers) | IPC channel handlers | ~135 |

---

## Terminology Change

| Old Term | New Term | Rationale |
|----------|----------|-----------|
| Bookmarks | **Web Sources** | Researcher mental model: "sources for this location" |
| bookmark_id | source_id | Consistency |
| LocationBookmarks | LocationWebSources | Component rename |

---

## Archive Output Formats

All formats captured automatically on source creation:

### Page Capture

| Format | Purpose | File | Tool |
|--------|---------|------|------|
| Screenshot | Visual reference, thumbnail | `screenshot.png` | Puppeteer |
| WARC | RFC 8493 compliant archive | `*.warc.gz` | wget |
| Full HTML | Complete page with assets | `full.html` | Puppeteer |
| PDF | Print-ready snapshot | `output.pdf` | Puppeteer |

### Text Extraction (Dual Pipeline)

| Format | Purpose | File | Tool |
|--------|---------|------|------|
| Extracted Text (clean) | Main article content | `content.txt` | Trafilatura |
| Extracted Markdown | Formatted content | `content.md` | Trafilatura |
| Raw HTML Parse | Full DOM extraction | `raw_text.txt` | BeautifulSoup |
| Metadata | Author, date, title | `metadata.json` | Trafilatura + BeautifulSoup |

**Why both Trafilatura AND BeautifulSoup?**
- Trafilatura: Best for articles, removes boilerplate (F1=0.945)
- BeautifulSoup: Full DOM access for structured data, comments, captions

### Media Extraction

| Format | Purpose | Location | Tool |
|--------|---------|----------|------|
| Images (full-res) | Extracted photos | `images/` | Custom + Puppeteer |
| Videos | Embedded video content | `videos/` | yt-dlp |
| Carousel/Gallery | Multi-image sets | `images/` | Custom scraper |

---

## Image Extraction: Hi-Res Download Logic

### Goal

Extract the **highest resolution version** of every image on a page, not just the displayed thumbnail.

### Extraction Pipeline

```
Page Load
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  1. DISCOVER ALL IMAGES                                     │
│     - <img> tags (src, srcset, data-src)                   │
│     - CSS background-image                                  │
│     - <picture> sources                                     │
│     - Carousel/slider items (data attributes)              │
│     - Lightbox/gallery links                               │
│     - Open Graph / Twitter Card images                     │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  2. FIND HI-RES VERSION                                     │
│                                                             │
│  For each image URL, try resolution upgrade patterns:       │
│                                                             │
│  URL Patterns:                                              │
│  • /thumb/ → /full/, /large/, /original/                   │
│  • _thumb → _large, _full, _orig                           │
│  • -300x200 → remove dimensions                            │
│  • ?w=400 → ?w=2000 or remove param                        │
│  • /resize/400x/ → remove resize path                      │
│                                                             │
│  File Patterns:                                             │
│  • image_s.jpg → image_l.jpg, image_o.jpg                  │
│  • image-small.png → image-large.png                       │
│                                                             │
│  Resolution Patterns (srcset parsing):                      │
│  • Parse srcset, select highest resolution                 │
│  • Check for 2x, 3x variants                               │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  3. SITE-SPECIFIC HANDLERS                                  │
│                                                             │
│  Known patterns for common hosts:                           │
│                                                             │
│  Image Hosts:                                               │
│  • Flickr: /_b.jpg → /_o.jpg (original)                    │
│  • Imgur: /s.jpg → /.jpg (full)                            │
│  • Photobucket: patterns TBD                               │
│  • SmugMug: size params → original                         │
│                                                             │
│  Web Hosts:                                                 │
│  • WordPress: -150x150.jpg → .jpg                          │
│  • Squarespace: ?format=500w → original                    │
│  • Wix: /v1/fill/w_300 → remove transforms                 │
│                                                             │
│  Forum/UE Sites:                                            │
│  • UER.ca: thumbnail → attachment                          │
│  • Opacity.us: patterns TBD                                │
│  • 28DaysLater: attachment handling                        │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  4. VERIFY & DOWNLOAD                                       │
│     - HEAD request to check if hi-res exists               │
│     - Fall back to original if upgrade fails               │
│     - Download with proper headers                         │
│     - BLAKE3 hash each image                               │
│     - Store in images/ folder                              │
└─────────────────────────────────────────────────────────────┘
```

### Carousel/Gallery Detection

Common carousel patterns to detect:

| Library | Detection | Image Source |
|---------|-----------|--------------|
| Slick | `.slick-slide` | `data-lazy`, `img src` |
| Swiper | `.swiper-slide` | `data-src`, `img src` |
| Lightbox | `[data-lightbox]` | `href` attribute |
| Fancybox | `[data-fancybox]` | `href`, `data-src` |
| PhotoSwipe | `.pswp` gallery | `data-pswp-src` |
| Bootstrap | `.carousel-item` | `img src` |
| Custom | `data-full`, `data-large` | Various data attrs |

### Right-Click Download Support

Intercept context menu to offer:
- "Download Original" (attempts hi-res upgrade)
- "Download as Displayed" (current resolution)
- Queue for batch download

### Image Metadata Preservation

For each extracted image:
```json
{
  "original_url": "https://example.com/thumb/image.jpg",
  "downloaded_url": "https://example.com/full/image.jpg",
  "resolution_upgraded": true,
  "width": 2400,
  "height": 1600,
  "format": "jpeg",
  "blake3_hash": "a7f3b2c1e9d4f086",
  "extracted_from": "carousel",
  "alt_text": "Abandoned factory interior",
  "caption": "Main hall, 2019"
}
```

---

## Video Extraction: yt-dlp

### Supported Sites

yt-dlp supports 1000+ sites including:
- YouTube, Vimeo, Dailymotion
- Facebook, Instagram, Twitter
- Reddit, TikTok
- News sites (CNN, BBC, etc.)
- Many more

### Extraction Options

```bash
# Best quality video + audio
yt-dlp -f "bestvideo+bestaudio/best" [URL]

# Metadata extraction
yt-dlp --write-info-json --write-thumbnail [URL]

# Subtitles if available
yt-dlp --write-subs --sub-langs all [URL]
```

### Integration

```typescript
// Call yt-dlp from Node.js
const { execFile } = require('child_process');
execFile('yt-dlp', [
  '-f', 'bestvideo+bestaudio/best',
  '--write-info-json',
  '--write-thumbnail',
  '-o', `${archivePath}/videos/%(title)s.%(ext)s`,
  url
], callback);
```

### Video Metadata

```json
{
  "title": "Urbex Tour of Abandoned Factory",
  "uploader": "ExplorerChannel",
  "upload_date": "2019-03-15",
  "duration": 845,
  "view_count": 12500,
  "original_url": "https://youtube.com/watch?v=xxx",
  "blake3_hash": "b8e4c3d2f1a5b097",
  "format": "mp4",
  "resolution": "1080p"
}
```

---

## Content Extraction: Dual Pipeline

Use **both** Trafilatura AND BeautifulSoup - they complement each other:

| Aspect | Trafilatura | BeautifulSoup |
|--------|-------------|---------------|
| Strength | Clean article extraction | Full DOM access |
| Best for | News, blogs, articles | Forums, comments, structured data |
| Removes boilerplate | Yes (automatic) | No (manual) |
| Metadata extraction | Built-in | Manual |
| F1 Score | 0.945 | 0.665 |

### Pipeline

```
HTML Source
    │
    ├──► Trafilatura ──► content.txt (clean article)
    │                 ──► content.md (markdown)
    │                 ──► metadata.json (author, date, title)
    │
    └──► BeautifulSoup ──► raw_text.txt (full text)
                       ──► comments.json (if forum)
                       ──► image_captions.json
                       ──► structured_data.json
```

### Benchmark Comparison

| Metric | Trafilatura | BeautifulSoup |
|--------|-------------|---------------|
| F1 Score | **0.945** | 0.665 |
| Precision | 0.925 | 0.499 |
| Purpose | Content extraction | HTML parsing |
| Boilerplate removal | Automatic | Manual |
| Metadata extraction | Built-in | Manual |
| License | MIT | MIT |

**Trafilatura extracts:**
- Main article text (removes ads, nav, footers)
- Author/byline
- Publication date
- Title
- Article categories/tags
- Comments (optional)

**Output formats:** TXT, JSON, HTML, Markdown, XML

**Used by:** HuggingFace, IBM, Microsoft Research, Stanford, University of Munich

---

## Storage Structure

Following BLAKE3 hashing contract (16-char hex):

```
[archive]/.websources/
├── [2-char-prefix]/
│   └── [source_hash]/
│       │
│       ├── index.json           # Master manifest
│       │
│       ├── page/                # Page captures
│       │   ├── screenshot.png   # Full-page screenshot
│       │   ├── full.html        # Complete HTML
│       │   ├── output.pdf       # PDF snapshot
│       │   └── warc/
│       │       └── [timestamp].warc.gz
│       │
│       ├── text/                # Extracted text
│       │   ├── content.txt      # Trafilatura clean text
│       │   ├── content.md       # Trafilatura markdown
│       │   ├── raw_text.txt     # BeautifulSoup full text
│       │   └── metadata.json    # Combined metadata
│       │
│       ├── images/              # Extracted images (hi-res)
│       │   ├── img_001.jpg      # BLAKE3-named
│       │   ├── img_002.png
│       │   └── images.json      # Image manifest
│       │
│       └── videos/              # Extracted videos (yt-dlp)
│           ├── video_001.mp4
│           ├── video_001.info.json
│           └── videos.json      # Video manifest
```

### Index.json (Master Manifest)

```json
{
  "source_id": "a7f3b2c1e9d4f086",
  "url": "https://example.com/article",
  "archived_at": "2025-12-08T14:32:00Z",
  "status": "complete",

  "page": {
    "screenshot": "page/screenshot.png",
    "html": "page/full.html",
    "pdf": "page/output.pdf",
    "warc": "page/warc/1733683200.warc.gz"
  },

  "text": {
    "title": "Historic Factory Fire",
    "author": "John Smith",
    "published": "1987-03-15",
    "word_count": 1247,
    "content": "text/content.txt",
    "markdown": "text/content.md"
  },

  "images": {
    "count": 12,
    "manifest": "images/images.json",
    "total_bytes": 45678901
  },

  "videos": {
    "count": 1,
    "manifest": "videos/videos.json",
    "total_bytes": 123456789
  },

  "hashes": {
    "screenshot": "b8e4c3d2f1a5b097",
    "html": "c9f5d4e3a2b6c108",
    "warc": "d0a6e5f4b3c7d219"
  }
}
```

---

## Proposed Architecture

### 1. Database Schema Changes (Migration 52)

```sql
-- Rename bookmarks to web_sources (keeps existing data)
ALTER TABLE bookmarks RENAME TO web_sources;

-- Add new columns to web_sources
ALTER TABLE web_sources ADD COLUMN source_type TEXT;  -- article, news, forum, photo, video, map, government, other
ALTER TABLE web_sources ADD COLUMN archive_status TEXT DEFAULT 'pending';  -- pending, archiving, complete, failed
ALTER TABLE web_sources ADD COLUMN archive_date TEXT;  -- When archive completed
ALTER TABLE web_sources ADD COLUMN archive_path TEXT;  -- Relative path to archive folder

-- Trafilatura-extracted metadata
ALTER TABLE web_sources ADD COLUMN extracted_title TEXT;
ALTER TABLE web_sources ADD COLUMN extracted_author TEXT;
ALTER TABLE web_sources ADD COLUMN extracted_date TEXT;  -- Publication date from page
ALTER TABLE web_sources ADD COLUMN extracted_description TEXT;
ALTER TABLE web_sources ADD COLUMN word_count INTEGER;

-- Archive file hashes (BLAKE3 for integrity verification)
ALTER TABLE web_sources ADD COLUMN screenshot_hash TEXT;
ALTER TABLE web_sources ADD COLUMN warc_hash TEXT;
ALTER TABLE web_sources ADD COLUMN html_hash TEXT;
ALTER TABLE web_sources ADD COLUMN pdf_hash TEXT;

-- Error tracking
ALTER TABLE web_sources ADD COLUMN archive_error TEXT;
ALTER TABLE web_sources ADD COLUMN retry_count INTEGER DEFAULT 0;

-- Indexes
CREATE INDEX idx_web_sources_status ON web_sources(archive_status);
CREATE INDEX idx_web_sources_archive_date ON web_sources(archive_date DESC);
CREATE INDEX idx_web_sources_type ON web_sources(source_type);

-- Archive versions table (for re-archiving same URL over time)
CREATE TABLE web_source_versions (
  version_id TEXT PRIMARY KEY,      -- BLAKE3 hash
  source_id TEXT NOT NULL REFERENCES web_sources(bookmark_id) ON DELETE CASCADE,
  archive_date TEXT NOT NULL,
  archive_path TEXT NOT NULL,

  -- Per-version hashes
  screenshot_hash TEXT,
  warc_hash TEXT,
  html_hash TEXT,
  pdf_hash TEXT,
  content_hash TEXT,  -- Hash of extracted text (detect content changes)

  -- Metadata snapshot
  extracted_title TEXT,
  extracted_author TEXT,
  extracted_date TEXT,
  word_count INTEGER,

  created_at TEXT NOT NULL
);

CREATE INDEX idx_versions_source ON web_source_versions(source_id);
CREATE INDEX idx_versions_date ON web_source_versions(archive_date DESC);
```

### 2. Service Architecture

#### New Services

| Service | Purpose | Dependencies |
|---------|---------|--------------|
| `web-source-service.ts` | Orchestrates full archive pipeline | All below |
| `screenshot-service.ts` | Full-page screenshots | Puppeteer |
| `warc-service.ts` | WARC file generation | wget binary |
| `pdf-service.ts` | PDF generation | Puppeteer |
| `html-capture-service.ts` | Full HTML with inlined assets | Puppeteer |
| `image-extractor-service.ts` | Hi-res image extraction | Puppeteer + custom |
| `video-extractor-service.ts` | Video download | yt-dlp |
| `trafilatura-service.ts` | Clean content extraction | Python subprocess |
| `beautifulsoup-service.ts` | Full DOM parsing | Python subprocess |
| `hires-resolver-service.ts` | URL pattern matching for hi-res | Custom |

#### Python Services Integration

Both Trafilatura and BeautifulSoup are Python-based:

```typescript
// Unified Python extraction script
execFile('python3', [
  'scripts/extract_content.py',
  '--url', url,
  '--html-file', htmlPath,
  '--output-dir', outputDir
], callback);

// extract_content.py handles both:
// - trafilatura for clean article text
// - BeautifulSoup for full DOM parsing
```

#### Image Extractor Pipeline

```typescript
class ImageExtractorService {
  async extractImages(page: Page, outputDir: string): Promise<ImageInfo[]> {
    // 1. Discover all image sources
    const imageSources = await this.discoverImages(page);

    // 2. Attempt hi-res upgrade for each
    const hiResUrls = await Promise.all(
      imageSources.map(src => this.resolveHiRes(src))
    );

    // 3. Download and hash
    return await this.downloadAll(hiResUrls, outputDir);
  }

  private async resolveHiRes(url: string): Promise<string> {
    // Try site-specific handlers first
    const handler = this.getSiteHandler(url);
    if (handler) return handler.getOriginal(url);

    // Try generic patterns
    return this.tryGenericPatterns(url);
  }
}
```

#### Binary Dependencies

Per CLAUDE.md: "Binary Dependencies Welcome - App size is not a concern"

| Binary | Purpose | License |
|--------|---------|---------|
| Chromium (via Puppeteer) | Screenshots, PDF, HTML, image discovery | BSD |
| wget | WARC generation | GPL-3.0 |
| Python 3 | Trafilatura + BeautifulSoup runtime | PSF |
| trafilatura | Clean content extraction | MIT |
| beautifulsoup4 | Full DOM parsing | MIT |
| yt-dlp | Video extraction (1000+ sites) | Unlicense |
| ffmpeg | Video processing (yt-dlp dependency) | LGPL |

### 3. Archive Pipeline Flow

```
User adds URL
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  1. CREATE SOURCE RECORD                                    │
│     - Generate source_id (BLAKE3 of URL + timestamp)        │
│     - Insert into web_sources with status='pending'         │
│     - Create archive folder structure                       │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  2. QUEUE ARCHIVE JOB (Immediate, automatic)                │
│     - Add to existing job queue (Import v2 infrastructure)  │
│     - Set status='archiving'                                │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  3. PAGE CAPTURE (Puppeteer)                                │
│     - Load page in headless browser                         │
│     - Wait for dynamic content                              │
│     - Screenshot (full page)                                │
│     - PDF export                                            │
│     - HTML capture (with inlined assets)                    │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  4. WARC ARCHIVE (wget)                                     │
│     - Full page with all assets                             │
│     - Timestamped WARC file                                 │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  5. IMAGE EXTRACTION (Parallel)                             │
│     - Discover all images on page                           │
│     - Detect carousels/galleries                            │
│     - Resolve hi-res versions (URL patterns)                │
│     - Download and hash each image                          │
│     - Store with metadata in images/                        │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  6. VIDEO EXTRACTION (yt-dlp)                               │
│     - Detect embedded videos                                │
│     - Download best quality via yt-dlp                      │
│     - Extract thumbnails and metadata                       │
│     - Store in videos/                                      │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  7. TEXT EXTRACTION (Python)                                │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │   Trafilatura   │  │  BeautifulSoup  │                  │
│  │                 │  │                 │                  │
│  │ • Clean article │  │ • Full DOM text │                  │
│  │ • Markdown      │  │ • Comments      │                  │
│  │ • Author/date   │  │ • Captions      │                  │
│  └─────────────────┘  └─────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  8. HASH & VERIFY                                           │
│     - BLAKE3 hash each output file                          │
│     - Write index.json manifest                             │
│     - Verify all files exist                                │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  9. UPDATE DATABASE                                         │
│     - Set status='complete' (or 'failed')                   │
│     - Store counts (images, videos, word_count)             │
│     - Store extracted metadata                              │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  10. NOTIFY UI                                              │
│      - Emit 'websource:archived' event                      │
│      - UI updates with thumbnail + stats                    │
└─────────────────────────────────────────────────────────────┘
```

### 4. Job Queue Integration

Integrate with existing Import v2 job queue:

```typescript
// Job types for web archiving
type WebSourceArchiveJob = {
  type: 'websource-archive';
  source_id: string;
  url: string;
  locid: string | null;
  subid: string | null;
  priority: number;  // Higher = process first
};
```

### 5. IPC Channels

New channels following `domain:action` convention:

| Channel | Purpose |
|---------|---------|
| `websource:create` | Add URL + queue archive (atomic) |
| `websource:findAll` | Get all sources |
| `websource:findByLocation` | Get sources for location |
| `websource:findBySubLocation` | Get sources for sub-location |
| `websource:findById` | Get single source with archive status |
| `websource:update` | Update source metadata |
| `websource:delete` | Delete source + archive files |
| `websource:rearchive` | Queue new archive version |
| `websource:getArchivePath` | Get path to archived files |
| `websource:openOffline` | Open archived HTML in default browser |
| `websource:openPdf` | Open archived PDF |
| `websource:verify` | Verify archive integrity via hashes |
| `websource:getVersions` | Get all archive versions for source |

---

## UI Changes

### Summary

The UI design follows these principles:
1. **Media lives in Original Assets** — Extracted images/videos appear in the existing media grid with a "Web Sources" filter
2. **Web Sources section is collapsible** — Clean, minimal list of sources with expand/collapse
3. **Unified media experience** — Users see all media (imported + extracted) in one place, differentiated by 🔗 badge

### 1. Component Rename

| Old | New |
|-----|-----|
| `LocationBookmarks.svelte` | `LocationWebSources.svelte` |
| `Bookmarks.svelte` | `WebSources.svelte` |
| `sqlite-bookmarks-repository.ts` | `sqlite-websources-repository.ts` |
| `bookmarks.ts` (IPC) | `websources.ts` |

### 2. UI Architecture

**Key Insight:** Extracted images/videos flow into the **Original Assets** section with a new "Web Source" category filter. The Web Sources section itself is **collapsible** and shows only the source list (clean, minimal).

#### 2.1 Location Page Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  LOCATION DETAIL PAGE                                                       │
│                                                                             │
│  [Hero Image]                                                               │
│  Location Name                                                              │
│  Type • State • GPS Confidence                                              │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ORIGINAL ASSETS                                                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐                   │
│  │   All    │ │  Images  │ │  Videos  │ │ Web Sources  │  ← NEW FILTER     │
│  │  (147)   │ │  (120)   │ │   (15)   │ │    (12)      │                   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘                   │
│                                                                             │
│  [Media Grid - filtered by selected category]                               │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ▼ WEB SOURCES (5)                                        [+ Add] [+ File] │
│    Collapsible section - click to expand/collapse                          │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  [Compact source list when expanded]                                        │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  DOCUMENTS (8)                                                              │
│  [Document list]                                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

#### 2.2 Original Assets: Web Sources Filter

When user clicks "Web Sources" filter in Original Assets, they see images/videos extracted from web sources only.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ORIGINAL ASSETS                                                            │
│                                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐                   │
│  │   All    │ │  Images  │ │  Videos  │ │ Web Sources  │                   │
│  │  (147)   │ │  (120)   │ │   (15)   │ │    (12)      │                   │
│  └──────────┘ └──────────┘ └──────────┘ └──────▼───────┘                   │
│                                          ──────────────                     │
│                                                                             │
│  12 media from 5 web sources                              [View Sources]   │
│                                                                             │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │
│  │        │ │        │ │        │ │        │ │        │ │        │        │
│  │  img   │ │  img   │ │  img   │ │  vid   │ │  img   │ │  img   │        │
│  │        │ │        │ │        │ │   ▶    │ │        │ │        │        │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘        │
│  1987 Fire   1987 Fire   UER Forum  UER Forum  UER Forum  UER Forum       │
│                                                                             │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │
│  │        │ │        │ │        │ │        │ │        │ │        │        │
│  │  img   │ │  vid   │ │  img   │ │  img   │ │  img   │ │  img   │        │
│  │        │ │   ▶    │ │        │ │        │ │        │ │        │        │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Media Card Hover (Web Source):**
Shows source attribution on hover: "From: Albany Times Union (Mar 1987)"

**Badge Indicator:**
Small link icon (🔗) in corner of media cards from web sources to distinguish from user-imported.

---

#### 2.3 Web Sources Section (Collapsible, Clean)

Minimal, collapsible section showing just the source list. No tabs - media lives in Original Assets.

**Collapsed State:**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ▶ WEB SOURCES (5)                                        [+ Add] [+ File] │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Expanded State:**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ▼ WEB SOURCES (5)                                        [+ Add] [+ File] │
│    Research sources archived for this location                              │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ┌──────┐  Historic Factory Fire Kills 12 Workers        ✓ Complete │   │
│  │ │thumb │  timesunion.com • John Smith • Mar 15, 1987               │   │
│  │ │64x48 │  12 images • 1,247 words                                  │   │
│  │ └──────┘                                    [View] [PDF] [Cite]    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ┌──────┐  Urban Exploration Forum Thread                ✓ Complete │   │
│  │ │thumb │  uer.ca • 8 authors • 23 posts • Dec 2019                 │   │
│  │ │64x48 │  47 images • 2 videos • 8,432 words                       │   │
│  │ └──────┘                                    [View] [PDF] [Cite]    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ┌──────┐  https://example.com/new-article               ◐ Archiving│   │
│  │ │  ◐   │  Screenshot ✓  PDF ✓  HTML ◐  Images ◐                   │   │
│  │ │spin  │                                                           │   │
│  │ └──────┘                                                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Source Row Specs:**
- Row height: 64px
- Thumbnail: 64x48px, 4px radius
- Title: 14px Regular, `#1C1C1A`, truncated
- Meta: 12px Regular, `#5C5C58`
- Stats: 12px Regular, `#8A8A86`
- Action buttons: Ghost style, 12px
- Status: Right-aligned, 11px Semi

**Spacing:**
- Section padding: 16px
- Row gap: 8px
- Collapsed header height: 48px

---

#### 2.4 Empty State (Web Sources)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ▼ WEB SOURCES (0)                                        [+ Add] [+ File] │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│                    No web sources archived yet                              │
│                                                                             │
│            Add URLs to articles, forums, and photo galleries               │
│            Images and videos will appear in Original Assets                │
│                                                                             │
│                         [+ Add Web Source]                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

#### 2.5 Add Source Modal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Add Web Source                                                        ✕   │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ○ Enter URL                           ○ Import from HTML file      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  URL                                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ https://                                                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Type                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Article                                                          ▼ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  Article, News, Forum, Photo Gallery, Video, Map, Government, Other       │
│                                                                             │
│  Notes (optional)                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│                                           ┌──────────┐ ┌─────────────────┐ │
│                                           │  Cancel  │ │ Add & Archive   │ │
│                                           └──────────┘ └─────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Modal Specs:**
- Width: 480px max
- Background: `#FFFFFF`
- Border: `#E2E1DE`
- Border radius: 4px
- Padding: 24px

---

#### 2.6 Source Detail Modal

Click a source row to open full details:

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                                                                                   │
│  Source Details                                                              ✕   │
│                                                                                   │
│  ─────────────────────────────────────────────────────────────────────────────── │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                             │ │
│  │                         FULL SCREENSHOT                                     │ │
│  │                          (scrollable)                                       │ │
│  │                                                                             │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  Historic Factory Fire Kills 12 Workers                                          │
│  https://timesunion.com/archive/1987/factory-fire                               │
│                                                                                   │
│  ─────────────────────────────────────────────────────────────────────────────── │
│                                                                                   │
│  METADATA                                              ARCHIVE STATUS            │
│  Author         John Smith                             Screenshot    ✓           │
│  Published      March 15, 1987                         PDF           ✓           │
│  Word Count     1,247                                  HTML          ✓           │
│  Images         12 extracted                           WARC          ✓           │
│  Videos         0                                      Text          ✓           │
│                                                        Provenance    ✓           │
│                                                                                   │
│  ─────────────────────────────────────────────────────────────────────────────── │
│                                                                                   │
│  CITATION                                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ Smith, John. "Historic Factory Fire Kills 12 Workers." Albany Times        │ │
│  │ Union, 15 Mar. 1987. Archived 8 Dec. 2025.                                  │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                                    │
│  │  MLA   │ │  APA   │ │Chicago │ │ BibTeX │                         [Copy]    │
│  └────────┘ └────────┘ └────────┘ └────────┘                                    │
│                                                                                   │
│  ─────────────────────────────────────────────────────────────────────────────── │
│                                                                                   │
│  EXTRACTED MEDIA                                                                 │
│  12 images • 0 videos                                   [View in Assets]        │
│                                                                                   │
│  ─────────────────────────────────────────────────────────────────────────────── │
│                                                                                   │
│  ARCHIVE VERSIONS                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  Dec 8, 2025 14:32    1,247 words   12 images   ✓ Current                  │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  ─────────────────────────────────────────────────────────────────────────────── │
│                                                                                   │
│  ┌────────────┐ ┌────────────┐ ┌──────────────┐ ┌────────────┐                  │
│  │ View HTML  │ │  Open PDF  │ │  Re-Archive  │ │   Delete   │                  │
│  └────────────┘ └────────────┘ └──────────────┘ └────────────┘                  │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Modal Specs:**
- Width: 640px max
- Max height: 90vh (scrollable)
- Screenshot area: 100% width, max 300px height, scrollable

---

### States Summary

| State | Indicator | Color |
|-------|-----------|-------|
| Pending | ◐ spinner | `#8A8A86` |
| Archiving | ◐ spinner + progress | `#5A7A94` |
| Complete | ✓ | `#4A8C5E` |
| Partial | ✓ with count | `#C9A227` |
| Failed | ✗ | `#B85C4A` |

**Section Chevron:**
- ▶ Collapsed
- ▼ Expanded

**Web Source Media Badge:**
- 🔗 Small link icon in bottom-left corner of media thumbnails from web sources

### 3. Global Web Sources Page (Optional)

Replace `Bookmarks.svelte` with comprehensive source browser across all locations:

```
┌─────────────────────────────────────────────────────────────────┐
│  WEB SOURCES                                                    │
│  Research sources archived across all locations                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Search sources...                                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Filters: [All Types ▼] [All Locations ▼] [Status ▼]          │
│                                                                 │
│  ────────────────────────────────────────────────────────────  │
│                                                                 │
│  147 sources • 143 archived • 2 pending • 2 failed             │
│                                                                 │
│  [Grid view showing compact source cards]                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4. SubLocation Support

Same functionality, using existing `subid` foreign key. Sources can be linked to:
- Host location only (`locid` set, `subid` null)
- Specific sub-location (`locid` set, `subid` set)

---

## Braun Design Verification Checklist

### Color Usage
- [ ] Background: `#FAFAF8` (canvas)
- [ ] Cards: `#FFFFFF` with `#E2E1DE` border
- [ ] Archive status: `#4A8C5E` (verified), `#C9A227` (pending), `#B85C4A` (failed)
- [ ] No decorative colors

### Typography
- [ ] Section headers: 17px Medium
- [ ] Titles: 15px Regular
- [ ] Meta text: 13px Regular, `#8A8A86`
- [ ] Labels: 11px Semi, uppercase, 0.1em spacing

### Spacing (8pt Grid)
- [ ] Card padding: 16px
- [ ] Section gap: 24px
- [ ] Button padding: 12px vertical, 24px horizontal

### Geometry
- [ ] Border radius: 4px (all components)
- [ ] No gradients or shadows (except elevation)
- [ ] Screenshot thumbnails: rectangular, no rounded corners

### Anti-Pattern Check
- [ ] No colored accent buttons
- [ ] No decorative shadows
- [ ] No animated loaders (use simple spinners)
- [ ] No expressive shapes

---

## Implementation Phases (Revised)

### Phase 1: Core Infrastructure + P0 Features
**Goal:** Basic archiving works, images flow to media library

| Task | Feature |
|------|---------|
| Migration 52: Rename bookmarks → web_sources, add columns | Core |
| Migration 53: web_source_versions table | Core |
| Migration 54: Add source_id/source_url to imgs table | F1 |
| Migration 55: FTS5 virtual table for search | F6 |
| Create `.websources/` folder structure | Core |
| Create `provenance.json` generation | F12 |
| Per-component status tracking | F8 |

### Phase 2: Capture Services
**Goal:** All page capture methods working

| Task | Feature |
|------|---------|
| `screenshot-service.ts` - Puppeteer full-page | Core |
| `pdf-service.ts` - Puppeteer PDF export | Core |
| `html-capture-service.ts` - Puppeteer DOM + inline | Core |
| `warc-service.ts` - wget subprocess | Core |
| `provenance-service.ts` - Cryptographic chain | F12 |
| Component-level status/retry | F8 |

### Phase 3: Extraction Services
**Goal:** All content/media extraction working

| Task | Feature |
|------|---------|
| `trafilatura-service.ts` - Clean text | Core |
| `beautifulsoup-service.ts` - Full DOM | Core |
| `image-extractor-service.ts` - Hi-res images | Core |
| `video-extractor-service.ts` - yt-dlp | Core |
| `hires-resolver-service.ts` - URL patterns | Core |
| `citation-service.ts` - MLA/APA/Chicago/BibTeX | F2 |

### Phase 4: Orchestration + Media Import
**Goal:** Full pipeline works, images import to location

| Task | Feature |
|------|---------|
| `web-source-service.ts` - Main orchestrator | Core |
| Integrate with Import v2 job queue | Core |
| Auto-archive on source creation | Core |
| Extracted image → media library flow | F1 |
| Import confirmation modal | F1 |
| Image attribution (source_id on imgs) | F1 |

### Phase 5: IPC & Repository
**Goal:** All backend wired up

| Task | Feature |
|------|---------|
| `websources.ts` IPC handlers | Core |
| `sqlite-websources-repository.ts` | Core |
| Preload bridge updates | Core |
| TypeScript types | Core |
| Full-text search IPC | F6 |

### Phase 6: UI - Location Pages
**Goal:** Location web sources component complete

| Task | Feature |
|------|---------|
| `LocationWebSources.svelte` | Core |
| Screenshot thumbnails (lazy load) | Core |
| Archive status indicators | F8 |
| Per-component retry buttons | F8 |
| Add Source modal (URL + HTML file) | F5 |
| Source Detail modal | Core |
| Citation copy button | F2 |
| "Import Images" confirmation | F1 |

### Phase 7: UI - Global Page + Search
**Goal:** Global sources page with search

| Task | Feature |
|------|---------|
| `WebSources.svelte` | Core |
| Grid view with thumbnails | Core |
| Filters (type, location, status) | Core |
| Full-text search bar | F6 |
| Statistics summary | Core |

### Phase 8: Forum + HTML Import
**Goal:** Handle complex sources

| Task | Feature |
|------|---------|
| Forum structure detection | F3 |
| Post-level author/date extraction | F3 |
| Import from saved HTML file | F5 |
| Process local HTML with image re-download | F5 |

### Phase 9: Export + Polish
**Goal:** Research packages, duplicate detection

| Task | Feature |
|------|---------|
| Research package export | F10 |
| Bibliography generation | F10 |
| Offline index.html | F10 |
| BagIt integration | F10 |
| Duplicate media detection | F4 |

### Phase 10: Advanced Features
**Goal:** Link graph, change detection, modes

| Task | Feature |
|------|---------|
| Extract outbound links | F7 |
| Detect archived references | F7 |
| Related sources UI | F7 |
| Change detection between versions | F9 |
| Version diff display | F9 |
| Quick cite vs full import modes | F11 |

---

## Dependencies to Add

### Node.js Packages

| Package | Purpose | License |
|---------|---------|---------|
| `puppeteer` | Screenshots, PDF, HTML, image discovery | Apache-2.0 |

### Python Packages

| Package | Purpose | License |
|---------|---------|---------|
| `trafilatura` | Clean content extraction | MIT |
| `beautifulsoup4` | Full DOM parsing | MIT |
| `lxml` | HTML/XML parser (BS4 backend) | BSD |

### Binary Dependencies

| Binary | Purpose | License | Notes |
|--------|---------|---------|-------|
| Chromium | Puppeteer backend | BSD | Bundled with puppeteer |
| wget | WARC generation | GPL-3.0 | Bundle binary |
| yt-dlp | Video extraction | Unlicense | Bundle binary |
| ffmpeg | Video processing | LGPL-2.1 | Bundle binary |
| Python 3 | Script runtime | PSF | System or bundle |

**All licenses are open source and compatible with distribution.**

---

## Offline Support (Dual Edition)

Both editions support full archiving:

### Light Edition
- Puppeteer with bundled Chromium
- trafilatura via Python subprocess
- wget via bundled binary
- Full functionality, no external servers

### Offline Beast
- Same as Light, plus:
- Pre-warmed archive cache for known sources
- Larger Chromium binary with full codec support

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Large storage | No limit per user decision; monitor disk usage |
| Slow archive | Background queue, progress UI, parallel captures |
| Site blocking | Retry with delays, user-agent rotation, manual fallback |
| Python dependency | Bundle Python or require system install |
| Resource consumption | Limit concurrent Puppeteer instances (2-3 max) |

---

## Success Metrics

- [ ] Archive 100 URLs without failure
- [ ] Verify archived content matches original via hash
- [ ] Access all archives fully offline
- [ ] Load 1000+ sources in <1s
- [ ] Average archive complete in <30s per URL

---

## Decisions Confirmed

### Core Decisions

| Decision | Answer |
|----------|--------|
| Terminology | "Web Sources" (not Bookmarks) |
| Auto-archive | Yes, immediate on URL add |
| Storage limit | No limit |

### Archive Outputs

| Decision | Answer |
|----------|--------|
| Screenshot | Yes |
| PDF | Yes |
| HTML | Yes, with inlined assets |
| WARC | Yes, essential for archive mission |
| Text extraction | **Both** Trafilatura AND BeautifulSoup |

### Media Extraction

| Decision | Answer |
|----------|--------|
| Image extraction | Yes, with hi-res upgrade logic |
| Video extraction | Yes, via yt-dlp |
| Carousel support | Yes, detect and extract all images |
| Site-specific handlers | Yes, for known image/web hosts |

### New Features (12)

| Feature | Included |
|---------|----------|
| F1: Images → Media Library | Yes |
| F2: Citation Generation | Yes |
| F3: Forum Structure | Yes |
| F4: Duplicate Detection | Yes |
| F5: Import from HTML | Yes |
| F6: Full-Text Search | Yes |
| F7: Link Graph | Yes |
| F8: Per-Component Status | Yes |
| F9: Change Detection | Yes |
| F10: Research Export | Yes |
| F11: Quick/Full Modes | Yes |
| F12: Provenance Chain | Yes |

---

## References

- [Trafilatura Documentation](https://trafilatura.readthedocs.io/)
- [Trafilatura GitHub](https://github.com/adbar/trafilatura)
- [BeautifulSoup Documentation](https://www.crummy.com/software/BeautifulSoup/bs4/doc/)
- [Puppeteer Documentation](https://pptr.dev/)
- [yt-dlp GitHub](https://github.com/yt-dlp/yt-dlp)
- [yt-dlp Supported Sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)
- [WARC Specification](https://iipc.github.io/warc-specifications/)
- [RFC 8493 - BagIt](https://datatracker.ietf.org/doc/html/rfc8493)

---

## Approval Checklist

- [x] Terminology: "Web Sources"
- [x] Auto-archive on URL add
- [x] WARC required
- [x] PDF included
- [x] No storage limit
- [x] Trafilatura for extraction
- [ ] **User approves overall approach**
- [ ] **User approves UI mockups**

---

## Files to Create/Modify

### New Services (13)

| File | Purpose | Phase |
|------|---------|-------|
| `electron/services/web-source-service.ts` | Main orchestrator | 4 |
| `electron/services/screenshot-service.ts` | Puppeteer screenshots | 2 |
| `electron/services/pdf-service.ts` | Puppeteer PDF | 2 |
| `electron/services/html-capture-service.ts` | Full HTML capture | 2 |
| `electron/services/warc-service.ts` | wget WARC generation | 2 |
| `electron/services/provenance-service.ts` | Cryptographic chain | 2 |
| `electron/services/image-extractor-service.ts` | Hi-res image extraction | 3 |
| `electron/services/video-extractor-service.ts` | yt-dlp video download | 3 |
| `electron/services/trafilatura-service.ts` | Clean content extraction | 3 |
| `electron/services/beautifulsoup-service.ts` | Full DOM parsing | 3 |
| `electron/services/hires-resolver-service.ts` | URL pattern matching | 3 |
| `electron/services/citation-service.ts` | MLA/APA/Chicago/BibTeX | 3 |
| `electron/services/forum-parser-service.ts` | Forum structure detection | 8 |

### Python Scripts

| File | Purpose | Phase |
|------|---------|-------|
| `scripts/extract_content.py` | Unified Python extraction | 3 |
| `scripts/requirements.txt` | Python dependencies | 3 |

### New Components

| File | Purpose | Phase |
|------|---------|-------|
| `electron/main/ipc-handlers/websources.ts` | IPC handlers | 5 |
| `electron/repositories/sqlite-websources-repository.ts` | Repository | 5 |
| `src/components/location/LocationWebSources.svelte` | Location component | 6 |
| `src/pages/WebSources.svelte` | Global page | 7 |
| `src/components/WebSourceCard.svelte` | Source card | 6 |
| `src/components/AddSourceModal.svelte` | Add source (URL + HTML) | 6 |
| `src/components/SourceDetailModal.svelte` | Detail with citations | 6 |
| `src/components/ImportImagesModal.svelte` | Confirm image import | 6 |
| `src/components/SourceSearchBar.svelte` | FTS5 search | 7 |
| `src/components/RelatedSources.svelte` | Link graph display | 10 |
| `src/components/VersionDiff.svelte` | Change detection | 10 |

### Files to Modify

| File | Changes |
|------|---------|
| `electron/main/database.ts` | Add migrations 52-53 |
| `electron/main/database.types.ts` | Add WebSource types |
| `electron/preload/preload.cjs` | Add websource channels |
| `src/types/electron.d.ts` | Add WebSource API types |
| `src/pages/LocationDetail.svelte` | Replace LocationBookmarks |
| `src/components/location/index.ts` | Export new component |
| `electron/main/ipc-handlers/index.ts` | Register websource handlers |

### Files to Delete

| File | Reason |
|------|--------|
| `electron/main/ipc-handlers/bookmarks.ts` | Replaced by websources.ts |
| `electron/repositories/sqlite-bookmarks-repository.ts` | Replaced |
| `src/components/location/LocationBookmarks.svelte` | Replaced |
| `src/pages/Bookmarks.svelte` | Replaced by WebSources.svelte |

---

**Document Version:** 1.0
**Last Updated:** 2025-12-08
