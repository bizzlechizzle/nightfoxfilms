# PLAN: Web Source Detail Viewer & Enhanced Metadata Extraction

**Status:** DRAFT - Awaiting Approval
**Author:** Claude
**Date:** 2025-12-11
**Scope:** Enhanced web source metadata extraction and comprehensive archive viewer
**Philosophy:** "Know everything about the webpage" - redundant extraction is OK

---

## Problem Statement

The current web source archiving system (OPT-109/110) captures page screenshots, PDFs, HTML, WARC archives, images, videos, and text. However:

1. **Limited metadata visibility** - The UI only shows: title, author, word count, image/video counts
2. **No image-level metadata** - We capture images but don't persist: original filename, srcset variants, captions, credits, EXIF
3. **No video-level metadata** - yt-dlp captures rich metadata (uploader, description, tags) but we discard it
4. **No archive viewer** - The "View" button exists but has no destination
5. **Missing page metadata** - Domain, publish date parsing, relevant outbound links

**User Goal:** "Know everything about the webpage" - this is an archive tool.

---

## Proposed Solution

### A. Enhanced Metadata Extraction

Expand extraction services to capture:

**Page-Level:**
| Field | Source | Storage |
|-------|--------|---------|
| Domain | Parsed from URL | `web_sources.domain` |
| Publish Date | Schema.org, JSON-LD, OpenGraph, meta tags | `web_sources.extracted_date` (improved parsing) |
| Relevant Links | All `<a href>` with dedup and filtering | `web_sources.extracted_links` (JSON) |

**Per-Image (NEW TABLE):**
| Field | Source | Storage |
|-------|--------|---------|
| Original Filename | URL path parsing | `original_filename` |
| Alternate Resolutions | srcset attribute | `srcset_variants` (JSON) |
| Description | alt attribute | `alt` |
| Caption | `<figcaption>` parent | `caption` |
| Author/Photographer | data-credit, data-photographer, meta tags | `credit` |
| Attribution | data-attribution, rel="license" link | `attribution` |
| EXIF Dump | ExifTool on downloaded file | `exif_json` (JSON) |

**Per-Video (NEW TABLE):**
| Field | Source | Storage |
|-------|--------|---------|
| Title | yt-dlp info.json | `title` |
| Description | yt-dlp info.json | `description` |
| Uploader/Channel | yt-dlp info.json | `uploader` |
| Upload Date | yt-dlp info.json | `upload_date` |
| Duration | yt-dlp info.json | `duration` |
| View Count | yt-dlp info.json | `view_count` |
| Tags | yt-dlp info.json | `tags` (JSON) |
| Thumbnail URL | yt-dlp info.json | `thumbnail_url` |
| Full Metadata | yt-dlp info.json | `metadata_json` (JSON) |

### B. New Database Tables (Migration 67)

```sql
-- Add domain extraction to web_sources
ALTER TABLE web_sources ADD COLUMN domain TEXT;
ALTER TABLE web_sources ADD COLUMN extracted_links TEXT;  -- JSON array

-- Per-image metadata table
CREATE TABLE web_source_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  image_index INTEGER NOT NULL,

  -- Location
  url TEXT NOT NULL,
  local_path TEXT,
  hash TEXT,  -- BLAKE3

  -- Dimensions
  width INTEGER,
  height INTEGER,
  size INTEGER,

  -- Metadata
  original_filename TEXT,
  alt TEXT,
  caption TEXT,
  credit TEXT,
  attribution TEXT,
  srcset_variants TEXT,  -- JSON array
  exif_json TEXT,        -- JSON object

  -- Flags
  is_hi_res INTEGER DEFAULT 0,

  FOREIGN KEY (source_id) REFERENCES web_sources(source_id) ON DELETE CASCADE
);

CREATE INDEX idx_web_source_images_source ON web_source_images(source_id);

-- Per-video metadata table
CREATE TABLE web_source_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  video_index INTEGER NOT NULL,

  -- Location
  url TEXT NOT NULL,
  local_path TEXT,
  hash TEXT,  -- BLAKE3

  -- Basic info
  title TEXT,
  description TEXT,
  duration INTEGER,  -- seconds
  size INTEGER,      -- bytes
  platform TEXT,

  -- Source info
  uploader TEXT,
  upload_date TEXT,
  view_count INTEGER,

  -- Extended metadata
  tags TEXT,           -- JSON array
  thumbnail_url TEXT,
  metadata_json TEXT,  -- Full yt-dlp info.json

  FOREIGN KEY (source_id) REFERENCES web_sources(source_id) ON DELETE CASCADE
);

CREATE INDEX idx_web_source_videos_source ON web_source_videos(source_id);
```

### C. Web Source Detail Modal

**Component:** `WebSourceDetailModal.svelte`

**Layout (Braun-compliant):**

```
+----------------------------------------------------------+
| [X]  Archive: Example Article Title                       |
|      example.com  |  article  |  Archived 2025-12-11     |
+----------------------------------------------------------+
|                                                          |
| PAGE INFO                                                |
| -------------------------------------------------------- |
| Author      John Smith                                   |
| Published   December 10, 2025                            |
| Words       2,847                                        |
| Domain      example.com                                  |
|                                                          |
| ARCHIVE FILES                                            |
| -------------------------------------------------------- |
| [Screenshot] [PDF] [HTML] [WARC]                         |
|                                                          |
| EXTRACTED LINKS (12)                                ▾    |
| -------------------------------------------------------- |
| example.com/related-article                              |
| wikipedia.org/wiki/Topic                                 |
| ...                                                      |
|                                                          |
| IMAGES (24)                                         ▾    |
| -------------------------------------------------------- |
| +--------+ +--------+ +--------+ +--------+              |
| |  img   | |  img   | |  img   | |  img   |              |
| +--------+ +--------+ +--------+ +--------+              |
|                                                          |
| [Click image for full metadata]                          |
|                                                          |
| VIDEOS (2)                                          ▾    |
| -------------------------------------------------------- |
| 1. "Building Tour" - YouTube - 12:34                     |
|    by UrbanExplorer | 45,231 views                       |
|                                                          |
+----------------------------------------------------------+
```

**Image Detail Drawer (on click):**

```
+----------------------------------------------------------+
| < Back to Images                                          |
+----------------------------------------------------------+
|                                                          |
|  [================== IMAGE ====================]          |
|                                                          |
| METADATA                                                 |
| -------------------------------------------------------- |
| Filename     IMG_2847.jpg                                |
| Dimensions   1920 x 1080                                 |
| Size         2.4 MB                                      |
| Hash         a7f3b2c1e9d4f086                            |
|                                                          |
| Alt Text     Abandoned factory interior                  |
| Caption      The main hall showing decay                 |
| Credit       Photo by John Smith                         |
| Attribution  CC BY-SA 4.0                                |
|                                                          |
| AVAILABLE RESOLUTIONS                                    |
| -------------------------------------------------------- |
| 320w | 640w | 1024w | 1920w (downloaded)                 |
|                                                          |
| EXIF DATA                                                |
| -------------------------------------------------------- |
| Camera       Canon EOS 5D Mark IV                        |
| Date         2025-12-01 14:32:17                         |
| Aperture     f/2.8                                       |
| ISO          800                                         |
| GPS          43.0731, -89.4012                           |
| ...                                                      |
+----------------------------------------------------------+
```

### D. Implementation Files

| File | Type | Purpose |
|------|------|---------|
| `database.ts` | Migration 67 | Add tables and columns |
| `database.types.ts` | Types | Add interfaces |
| `websource-extraction-service.ts` | Service | Enhanced extraction |
| `sqlite-websources-repository.ts` | Repository | CRUD for new tables |
| `websources.ts` | IPC handlers | Expose new data |
| `WebSourceDetailModal.svelte` | Component | Archive viewer modal |
| `LocationWebSources.svelte` | Component | Wire up "View" button |

---

## Implementation Plan

### Phase 1: Database Schema (Migration 67)
1. Add `domain` and `extracted_links` columns to `web_sources`
2. Create `web_source_images` table
3. Create `web_source_videos` table
4. Add indexes

### Phase 2: Extraction Enhancements
1. Update `extractImages()` to capture:
   - Original filename from URL
   - All srcset variants
   - Caption from figcaption
   - Credit/attribution from data attributes
2. Update `extractText()` to capture:
   - Domain from URL
   - All outbound links (filtered/deduped)
3. Add EXIF extraction for downloaded images (via exiftool-vendored)
4. Update `extractVideos()` to parse full yt-dlp info.json

### Phase 3: Repository & IPC
1. Add repository methods for `web_source_images` and `web_source_videos`
2. Update `markComplete()` to store per-image/video metadata
3. Add IPC handlers:
   - `websources:getImages(sourceId)`
   - `websources:getVideos(sourceId)`
   - `websources:getImageDetail(sourceId, index)`

### Phase 4: UI Component
1. Create `WebSourceDetailModal.svelte`
2. Implement collapsible sections (Links, Images, Videos)
3. Implement image detail drawer
4. Wire up "View" button in `LocationWebSources.svelte`

### Phase 5: Testing & Polish
1. Test with various page types (article, gallery, video page)
2. Verify EXIF extraction works
3. Performance test with large archives (50+ images)

---

## Braun Design Compliance

### Colors
- Background: `#FAFAF8`
- Surface/cards: `#FFFFFF` with `#E2E1DE` border
- Primary text: `#1C1C1A`
- Secondary text: `#5C5C58`
- Status badges: Functional colors only (green/yellow/red for status)

### Typography
- Modal title: 24px / 600 weight
- Section headers: 11px / 600 weight / UPPERCASE / 0.1em spacing
- Body: 15px / 400 weight
- Metadata labels: 13px / 400 weight / `#5C5C58`

### Spacing
- Modal padding: 24px
- Section gap: 24px
- Grid gap: 16px
- Card padding: 16px

### Geometry
- Modal: 4px border-radius
- Image thumbnails: 4px border-radius
- No decorative shadows (elevation only)

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| EXIF extraction adds latency | Run async after initial archive completes |
| Large metadata JSON bloats DB | Store in separate tables, query on-demand |
| Modal overwhelms with data | Collapsible sections, progressive disclosure |
| yt-dlp metadata varies by platform | Normalize to common fields, store raw in metadata_json |

---

## Dependencies

| Dependency | License | Already Bundled? |
|------------|---------|------------------|
| exiftool-vendored | MIT | Yes |
| yt-dlp | Unlicense | External (user-installed) |
| Puppeteer | Apache-2.0 | Yes |

---

## Questions for User

1. **EXIF priority:** Should we extract EXIF from ALL downloaded images, or only those that look like photographs (skip icons/logos)?

2. **Link filtering:** Should we filter extracted links to only include same-domain or related links, or capture ALL outbound links?

3. **Video metadata:** The yt-dlp info.json can be 10-50KB per video. Store full JSON, or extract only key fields?

---

## Approval

- [ ] User approves plan
- [ ] Ready for implementation
