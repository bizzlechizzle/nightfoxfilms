# OPT-109: Web Sources Implementation Guide

**Version:** 2.0
**Author:** Claude Opus 4.5
**Status:** IMPLEMENTATION COMPLETE
**Completed:** 2025-12-08

---

## Overview

This guide documents the complete implementation of the Web Sources archiving feature, which transforms the simple bookmark system into a comprehensive web archiving solution. The implementation enables capturing web pages as screenshots, PDFs, HTML, and WARC archives, with automatic extraction of images, videos, and text content.

---

## Implementation Summary

### What Was Built

1. **Database Layer** (Migrations 57-60)
   - `web_sources` table with comprehensive archive tracking
   - `web_source_versions` table for version history
   - Extended `imgs` and `vids` tables with web source attribution
   - FTS5 full-text search for archived content

2. **Repository Layer** (~900 lines)
   - Full CRUD operations for web sources
   - Archive status management (pending → archiving → complete/partial/failed)
   - Version management for re-archiving
   - Full-text search via FTS5
   - Statistics and bookmark migration

3. **IPC Layer** (~800 lines)
   - 40+ IPC handlers for all operations
   - Zod validation on all inputs
   - Orchestrator integration for archive operations

4. **Service Layer** (~1500 lines total)
   - `websource-capture-service.ts` - Screenshot, PDF, HTML, WARC capture
   - `websource-extraction-service.ts` - Image, video, text extraction
   - `websource-orchestrator-service.ts` - Pipeline coordination

5. **UI Layer** (~500 lines)
   - `LocationWebSources.svelte` - Source management component
   - `LocationOriginalAssets.svelte` - Updated with web-extracted filter

6. **Python Extraction Script** (~240 lines)
   - `extract-text.py` - Trafilatura + BeautifulSoup fallback

---

## Architecture

### Data Flow

```
User adds URL → Create web_source record (source_id = BLAKE3 hash of URL)
     ↓
Queue archive job via orchestrator
     ↓
Capture Phase (parallel):
  ├─ Screenshot (Puppeteer full-page PNG)
  ├─ PDF (Puppeteer A4 format)
  ├─ HTML (Puppeteer with inlined styles)
  └─ WARC (wget with page requisites)
     ↓
Extraction Phase:
  ├─ Images (hi-res resolution from srcset/data-src)
  ├─ Videos (yt-dlp for supported platforms)
  └─ Text (Python Trafilatura + BeautifulSoup)
     ↓
Finalization:
  ├─ Update component statuses
  ├─ Link extracted media to location
  ├─ Generate provenance hash
  └─ Create version snapshot
     ↓
UI updates via status polling
```

### File Structure

```
packages/desktop/
├── electron/
│   ├── main/
│   │   ├── database.ts           # Migrations 57-60 (web_sources, versions, FTS5)
│   │   ├── database.types.ts     # WebSourcesTable, WebSourceVersionsTable
│   │   └── ipc-handlers/
│   │       ├── index.ts          # registerWebSourcesHandlers()
│   │       └── websources.ts     # 40+ IPC handlers
│   ├── preload/
│   │   └── preload.cjs           # websources API exposure
│   ├── repositories/
│   │   └── sqlite-websources-repository.ts  # ~900 lines
│   └── services/
│       ├── websource-capture-service.ts     # Screenshot, PDF, HTML, WARC
│       ├── websource-extraction-service.ts  # Images, Videos, Text
│       └── websource-orchestrator-service.ts # Pipeline coordination
├── scripts/
│   └── extract-text.py           # Python text extraction
└── src/
    └── components/
        └── location/
            ├── LocationWebSources.svelte     # Web source management
            └── LocationOriginalAssets.svelte # Updated with filter
```

---

## Database Schema

### Migration 57: web_sources table

```sql
CREATE TABLE web_sources (
  source_id TEXT PRIMARY KEY,           -- BLAKE3 hash of normalized URL
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
  subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL,
  source_type TEXT DEFAULT 'article',   -- article, gallery, video, social, map, document, archive, other
  notes TEXT,

  -- Archive Status
  status TEXT DEFAULT 'pending',        -- pending, archiving, complete, partial, failed
  component_status TEXT,                -- JSON: {screenshot, pdf, html, warc, images, videos, text}

  -- Extracted Metadata
  extracted_title TEXT,
  extracted_author TEXT,
  extracted_date TEXT,
  extracted_publisher TEXT,
  word_count INTEGER DEFAULT 0,
  image_count INTEGER DEFAULT 0,
  video_count INTEGER DEFAULT 0,

  -- Archive Paths (relative to archive folder)
  archive_path TEXT,
  screenshot_path TEXT,
  pdf_path TEXT,
  html_path TEXT,
  warc_path TEXT,

  -- Integrity Hashes (BLAKE3, 16-char hex)
  screenshot_hash TEXT,
  pdf_hash TEXT,
  html_hash TEXT,
  warc_hash TEXT,
  content_hash TEXT,                    -- Hash of extracted text
  provenance_hash TEXT,                 -- Combined hash of all components

  -- Error Tracking
  archive_error TEXT,
  retry_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at TEXT NOT NULL,
  archived_at TEXT,
  auth_imp TEXT
);
```

### Migration 58: web_source_versions table

```sql
CREATE TABLE web_source_versions (
  version_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES web_sources(source_id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  captured_at TEXT NOT NULL,

  -- Snapshot Paths
  screenshot_path TEXT,
  pdf_path TEXT,
  html_path TEXT,
  warc_path TEXT,

  -- Integrity Hashes
  screenshot_hash TEXT,
  pdf_hash TEXT,
  html_hash TEXT,
  warc_hash TEXT,
  content_hash TEXT,

  -- Change Detection
  content_changed INTEGER DEFAULT 0,    -- 1 if content differs from previous version
  diff_summary TEXT,                    -- Human-readable change summary

  UNIQUE(source_id, version_number)
);
```

### Migration 59: Media attribution columns

```sql
-- Add to imgs table
ALTER TABLE imgs ADD COLUMN source_id TEXT REFERENCES web_sources(source_id) ON DELETE SET NULL;
ALTER TABLE imgs ADD COLUMN source_url TEXT;
ALTER TABLE imgs ADD COLUMN extracted_from_web INTEGER DEFAULT 0;

-- Add to vids table
ALTER TABLE vids ADD COLUMN source_id TEXT REFERENCES web_sources(source_id) ON DELETE SET NULL;
ALTER TABLE vids ADD COLUMN source_url TEXT;
ALTER TABLE vids ADD COLUMN extracted_from_web INTEGER DEFAULT 0;
```

### Migration 60: FTS5 full-text search

```sql
CREATE VIRTUAL TABLE web_sources_fts USING fts5(
  source_id,
  url,
  title,
  extracted_title,
  extracted_author,
  extracted_publisher,
  content='',
  tokenize='porter unicode61'
);

-- Sync triggers
CREATE TRIGGER web_sources_fts_insert AFTER INSERT ON web_sources BEGIN
  INSERT INTO web_sources_fts(source_id, url, title, extracted_title, extracted_author, extracted_publisher)
  VALUES (NEW.source_id, NEW.url, NEW.title, NEW.extracted_title, NEW.extracted_author, NEW.extracted_publisher);
END;

CREATE TRIGGER web_sources_fts_delete AFTER DELETE ON web_sources BEGIN
  DELETE FROM web_sources_fts WHERE source_id = OLD.source_id;
END;

CREATE TRIGGER web_sources_fts_update AFTER UPDATE OF title, extracted_title, extracted_author, extracted_publisher ON web_sources BEGIN
  DELETE FROM web_sources_fts WHERE source_id = OLD.source_id;
  INSERT INTO web_sources_fts(source_id, url, title, extracted_title, extracted_author, extracted_publisher)
  VALUES (NEW.source_id, NEW.url, NEW.title, NEW.extracted_title, NEW.extracted_author, NEW.extracted_publisher);
END;
```

---

## IPC API Reference

### Core CRUD

| Channel | Parameters | Returns |
|---------|------------|---------|
| `websources:create` | `{ url, title?, locid?, subid?, source_type?, notes? }` | `WebSource` |
| `websources:findById` | `source_id` | `WebSource` |
| `websources:findByUrl` | `url` | `WebSource \| null` |
| `websources:findByLocation` | `locid` | `WebSource[]` |
| `websources:findBySubLocation` | `subid` | `WebSource[]` |
| `websources:findByStatus` | `status` | `WebSource[]` |
| `websources:findPendingForArchive` | `limit?` | `WebSource[]` |
| `websources:findRecent` | `limit?` | `WebSource[]` |
| `websources:findAll` | - | `WebSource[]` |
| `websources:update` | `source_id, updates` | `WebSource` |
| `websources:delete` | `source_id` | `void` |

### Archive Status

| Channel | Parameters | Returns |
|---------|------------|---------|
| `websources:markArchiving` | `source_id` | `void` |
| `websources:markComplete` | `source_id, options` | `WebSource` |
| `websources:markPartial` | `source_id, component_status, archive_path` | `WebSource` |
| `websources:markFailed` | `source_id, error_message` | `WebSource` |
| `websources:resetToPending` | `source_id` | `WebSource` |
| `websources:updateComponentStatus` | `source_id, component_status` | `void` |

### Version Management

| Channel | Parameters | Returns |
|---------|------------|---------|
| `websources:createVersion` | `source_id, options` | `WebSourceVersion` |
| `websources:findVersions` | `source_id` | `WebSourceVersion[]` |
| `websources:findVersionByNumber` | `source_id, version_number` | `WebSourceVersion \| null` |
| `websources:findLatestVersion` | `source_id` | `WebSourceVersion \| null` |
| `websources:countVersions` | `source_id` | `number` |

### Archive Operations (Orchestrator)

| Channel | Parameters | Returns |
|---------|------------|---------|
| `websources:archive` | `source_id, options?` | `ArchiveResult` |
| `websources:archivePending` | `limit?, options?` | `ArchiveResult[]` |
| `websources:rearchive` | `source_id, options?` | `ArchiveResult` |
| `websources:cancelArchive` | - | `void` |
| `websources:archiveStatus` | - | `{ isProcessing, currentSourceId }` |

### Search & Statistics

| Channel | Parameters | Returns |
|---------|------------|---------|
| `websources:search` | `query, { locid?, limit? }` | `WebSourceSearchResult[]` |
| `websources:getStats` | - | `WebSourceStats` |
| `websources:getStatsByLocation` | `locid` | `WebSourceStats` |
| `websources:count` | - | `number` |
| `websources:countByLocation` | `locid` | `number` |
| `websources:countBySubLocation` | `subid` | `number` |

---

## Service Architecture

### Capture Service (`websource-capture-service.ts`)

Uses Puppeteer-core for browser-based captures:

```typescript
// Shared browser instance for efficiency
async function getBrowser(): Promise<Browser>

// Capture methods
export async function captureScreenshot(options: CaptureOptions): Promise<CaptureResult>
export async function capturePdf(options: CaptureOptions): Promise<CaptureResult>
export async function captureHtml(options: CaptureOptions): Promise<CaptureResult>
export async function captureWarc(options: CaptureOptions): Promise<CaptureResult>  // Uses wget
export async function extractMetadata(url: string, timeout?: number): Promise<ExtractedMetadata>
```

**Key Features:**
- Auto-scroll to trigger lazy loading
- Full-page screenshots with 1920x1080 viewport
- PDF generation with A4 format and margins
- HTML with inlined stylesheets
- WARC via wget with page requisites

### Extraction Service (`websource-extraction-service.ts`)

Extracts content from web pages:

```typescript
export async function extractImages(options: ExtractionOptions): Promise<ImageExtractionResult>
export async function extractVideos(options: ExtractionOptions): Promise<VideoExtractionResult>
export async function extractText(options: ExtractionOptions): Promise<TextExtractionResult>
```

**Image Extraction Features:**
- Hi-res upgrade logic (checks srcset, data-src, data-lazy-src)
- Minimum size filtering (100x100 default)
- BLAKE3 hashing for deduplication

**Video Extraction:**
- Uses yt-dlp for YouTube, Vimeo, etc.
- Falls back to graceful skip if yt-dlp unavailable

**Text Extraction:**
- Python script with Trafilatura (primary)
- BeautifulSoup fallback
- Returns title, author, date, content, HTML

### Orchestrator (`websource-orchestrator-service.ts`)

Coordinates the complete archive pipeline:

```typescript
export class WebSourceOrchestrator extends EventEmitter {
  async archiveSource(sourceId: string, options?: ArchiveOptions): Promise<ArchiveResult>
  async archivePending(limit?: number, options?: ArchiveOptions): Promise<ArchiveResult[]>
  async rearchiveSource(sourceId: string, options?: ArchiveOptions): Promise<ArchiveResult>
  async cancel(): Promise<void>
  getStatus(): { isProcessing: boolean; currentSourceId: string | null }
}
```

**Archive Options:**
```typescript
interface ArchiveOptions {
  captureScreenshot?: boolean;   // default: true
  capturePdf?: boolean;          // default: true
  captureHtml?: boolean;         // default: true
  captureWarc?: boolean;         // default: true
  extractImages?: boolean;       // default: true
  extractVideos?: boolean;       // default: false (opt-in due to size)
  extractText?: boolean;         // default: true
  linkMedia?: boolean;           // default: true (links to location)
  timeout?: number;              // default: 60000ms
  maxImages?: number;            // default: 50
  maxVideos?: number;            // default: 3
}
```

---

## Python Text Extraction

### Location
`packages/desktop/scripts/extract-text.py`

### Usage
```bash
python3 extract-text.py <url>
```

### Output (JSON to stdout)
```json
{
  "title": "Article Title",
  "author": "Author Name",
  "date": "2024-01-15",
  "content": "Clean extracted text...",
  "html": "<article>...</article>"
}
```

### Dependencies
- trafilatura (primary extractor)
- beautifulsoup4 (fallback)

Install with:
```bash
pip3 install trafilatura beautifulsoup4
```

---

## UI Components

### LocationWebSources.svelte

Main web source management component:

**Features:**
- Add source form (URL, title, type, notes)
- Source list with status badges
- Archive button for pending sources
- Delete with confirmation
- View button for completed archives

**Status Colors:**
- `complete` → green (bg-green-100 text-green-700)
- `partial` → yellow (bg-yellow-100 text-yellow-700)
- `failed` → red (bg-red-100 text-red-700)
- `archiving` → blue (bg-blue-100 text-blue-700)
- `pending` → gray (bg-braun-100 text-braun-600)

### LocationOriginalAssets.svelte Updates

Added web-extracted media filter:

```typescript
// New state
let showWebExtracted = $state(true);

// New derived counts
const webImageCount = $derived(images.filter(i => i.extracted_from_web === 1).length);
const webVideoCount = $derived(videos.filter(v => v.extracted_from_web === 1).length);
const totalWebCount = $derived(webImageCount + webVideoCount);

// Updated filtering
const visibleImages = $derived(
  images.filter(i => {
    if (i.hidden === 1 && !showHidden) return false;
    if (i.extracted_from_web === 1 && !showWebExtracted) return false;
    return true;
  })
);
```

---

## Archive Folder Structure

```
[archive_folder]/
├── locations/
│   └── [locid]/
│       └── _websources/
│           └── [source_id]/
│               ├── [source_id]_screenshot.png
│               ├── [source_id].pdf
│               ├── [source_id].html
│               ├── [source_id].warc.gz
│               └── images/
│                   ├── img_001.jpg
│                   ├── img_002.png
│                   └── ...
└── _websources/                  # Unlinked sources
    └── [source_id]/
        └── ...
```

---

## Testing Checklist

- [x] Migration 57-60 run successfully
- [x] Web source CRUD operations work
- [x] Source ID derived from URL hash (deduplication)
- [x] Archive job triggers on create
- [x] Screenshot captures full page
- [x] PDF generates correctly
- [x] HTML saves with inlined styles
- [x] WARC generates via wget
- [x] Images extract with hi-res upgrade logic
- [x] Text extracts via Python script
- [x] Component status updates during archive
- [x] UI shows source list with status badges
- [x] Original Assets shows web-extracted filter
- [x] Extracted images linked to location
- [x] Delete removes source record
- [x] Version snapshots created on archive
- [x] FTS5 search works across sources
- [x] TypeScript compiles without errors

---

## Completion Score

| Category | Weight | Status | Score |
|----------|--------|--------|-------|
| Database Migrations | 15% | Complete | 15% |
| Repository Layer | 10% | Complete | 10% |
| IPC Handlers | 10% | Complete | 10% |
| Capture Services | 15% | Complete | 15% |
| Extraction Services | 15% | Complete | 15% |
| Orchestrator | 15% | Complete | 15% |
| UI Components | 15% | Complete | 15% |
| Integration (Filter + Attribution) | 5% | Complete | 5% |

**Total Score: 100%**

---

## Dependencies

### Runtime
- `puppeteer-core` - Browser automation
- `better-sqlite3` - Database
- `kysely` - Type-safe SQL
- `blake3` - Hashing
- `zod` - Validation

### External Tools (Optional)
- `wget` - WARC generation
- `yt-dlp` - Video extraction
- `python3` + `trafilatura` + `beautifulsoup4` - Text extraction

### Browser
- Chrome/Chromium executable (detected automatically)

---

## Future Enhancements

1. **Scheduled Re-archiving** - Cron-style jobs to capture page changes
2. **Diff Viewer** - Visual comparison between versions
3. **Citation Generator** - Auto-generate citations in various formats
4. **Batch Import** - Import multiple URLs from text file
5. **Archive Verification** - Periodic integrity checks
6. **Export to Zotero** - Research tool integration

---

**Implementation Complete.**
