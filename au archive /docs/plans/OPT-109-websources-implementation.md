# OPT-109 Web Sources Implementation Guide

**Feature**: Comprehensive Web Source Archiving
**Status**: Complete
**Author**: Claude Code
**Date**: 2025-12-09

---

## Overview

OPT-109 replaces the simple bookmarks feature with a comprehensive web archiving system that captures web pages in multiple formats (Screenshot, PDF, HTML, WARC), extracts content (images, videos, text), and stores everything locally for offline access.

---

## Architecture

### Data Flow

```
User adds URL → Repository creates record → Orchestrator coordinates archiving
                                              ↓
                        ┌─────────────────────┼─────────────────────┐
                        ↓                     ↓                     ↓
                   Capture Service      Extraction Service    Metadata Extraction
                   (Screenshot, PDF,    (Images, Videos,     (Title, Author, Date)
                    HTML, WARC)          Text)
                        ↓                     ↓                     ↓
                        └─────────────────────┼─────────────────────┘
                                              ↓
                                    Repository updates record
                                              ↓
                                    Version snapshot created
```

### Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `sqlite-websources-repository.ts` | Database CRUD, FTS5 search, version management | ~600 |
| `websource-orchestrator-service.ts` | Coordinates capture/extraction pipeline | ~650 |
| `websource-capture-service.ts` | Screenshot, PDF, HTML, WARC capture via Puppeteer | ~700 |
| `websource-extraction-service.ts` | Image, video, text extraction | ~850 |
| `websources.ts` (IPC handler) | IPC channels for renderer access | ~815 |
| `LocationWebSources.svelte` | UI component for location detail page | ~307 |

---

## Database Schema

### web_sources Table

```sql
CREATE TABLE web_sources (
  source_id TEXT PRIMARY KEY,      -- BLAKE3 hash (16 chars) or UUID (36 chars)
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  locid TEXT REFERENCES locs(locid),
  subid TEXT REFERENCES slocs(subid),
  source_type TEXT DEFAULT 'article',
  notes TEXT,
  status TEXT DEFAULT 'pending',   -- pending|archiving|complete|partial|failed
  component_status TEXT,           -- JSON: {screenshot, pdf, html, warc, text, images}

  -- Archive paths
  archive_path TEXT,
  screenshot_path TEXT,
  pdf_path TEXT,
  html_path TEXT,
  warc_path TEXT,

  -- Hashes (BLAKE3, 16 chars)
  screenshot_hash TEXT,
  pdf_hash TEXT,
  html_hash TEXT,
  warc_hash TEXT,
  content_hash TEXT,
  provenance_hash TEXT,

  -- Extracted metadata
  extracted_title TEXT,
  extracted_author TEXT,
  extracted_date TEXT,
  extracted_publisher TEXT,
  extracted_text TEXT,             -- Full text for FTS
  word_count INTEGER DEFAULT 0,
  image_count INTEGER DEFAULT 0,
  video_count INTEGER DEFAULT 0,

  -- Error tracking
  archive_error TEXT,
  retry_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')),
  archived_at TEXT
);
```

### web_source_versions Table

```sql
CREATE TABLE web_source_versions (
  version_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES web_sources(source_id),
  version_number INTEGER NOT NULL,
  screenshot_path TEXT,
  pdf_path TEXT,
  html_path TEXT,
  warc_path TEXT,
  screenshot_hash TEXT,
  pdf_hash TEXT,
  html_hash TEXT,
  warc_hash TEXT,
  content_hash TEXT,
  archived_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_id, version_number)
);
```

### FTS5 Full-Text Search

```sql
CREATE VIRTUAL TABLE web_sources_fts USING fts5(
  url,
  title,
  notes,
  extracted_title,
  extracted_author,
  extracted_text,
  content='web_sources',
  content_rowid='rowid'
);
```

---

## Services

### 1. Repository (`sqlite-websources-repository.ts`)

Handles all database operations:

- **CRUD**: create, findById, findByUrl, findByLocation, update, delete
- **Status Management**: markArchiving, markComplete, markPartial, markFailed
- **Version Control**: createVersion, findVersions, findLatestVersion
- **Search**: Full-text search via FTS5
- **Statistics**: getStats, getStatsByLocation
- **Migration**: migrateFromBookmarks (converts old bookmarks to web sources)

### 2. Orchestrator (`websource-orchestrator-service.ts`)

Coordinates the archiving pipeline:

```typescript
class WebSourceOrchestrator {
  async archiveSource(sourceId: string, options?: ArchiveOptions): Promise<ArchiveResult> {
    // 1. Mark source as archiving
    // 2. Extract metadata (title, author, date)
    // 3. Capture page (screenshot, PDF, HTML, WARC)
    // 4. Extract content (images, videos, text)
    // 5. Link extracted media to location
    // 6. Calculate provenance hash
    // 7. Update database with results
    // 8. Create version snapshot
  }
}
```

Archive options:
- `captureScreenshot` - Full-page PNG screenshot
- `capturePdf` - PDF document
- `captureHtml` - Single-file HTML with inlined styles
- `captureWarc` - WARC archive (requires wget)
- `extractImages` - Download page images
- `extractVideos` - Download embedded videos (requires yt-dlp)
- `extractText` - Extract clean text content

### 3. Capture Service (`websource-capture-service.ts`)

Uses Puppeteer-core with bundled Ungoogled Chromium:

```typescript
// Browser discovery (platform-aware)
const executablePaths = [
  // Development path (relative to dist-electron/main)
  path.join(__dirname, '..', '..', '..', '..', 'resources', 'browsers',
            'ungoogled-chromium', platformFolder,
            'Archive Browser.app', 'Contents', 'MacOS', 'Chromium'),
  // Production path
  path.join(process.resourcesPath, 'browsers', ...),
  // System Chrome fallbacks
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
```

Capture methods:
- `captureScreenshot()` - Full-page PNG with auto-scroll for lazy images
- `capturePdf()` - A4 PDF with margins and backgrounds
- `captureHtml()` - HTML with inlined CSS
- `captureWarc()` - WARC archive via wget
- `extractMetadata()` - Open Graph, Schema.org, meta tags

### 4. Extraction Service (`websource-extraction-service.ts`)

Content extraction:
- **Images**: Finds all `<img>` elements, checks srcset for hi-res versions
- **Videos**: Detects YouTube/Vimeo embeds, uses yt-dlp for download
- **Text**: Uses Python Trafilatura (fallback: browser extraction)

---

## IPC Channels

### Core CRUD
- `websources:create` - Create new web source
- `websources:findById` - Get source by ID
- `websources:findByUrl` - Get source by URL
- `websources:findByLocation` - Get all sources for a location
- `websources:update` - Update source fields
- `websources:delete` - Delete source and archives

### Archive Operations
- `websources:archive` - Archive a single source
- `websources:archivePending` - Archive all pending sources
- `websources:rearchive` - Re-archive (creates new version)
- `websources:cancelArchive` - Cancel current operation
- `websources:archiveStatus` - Get processing status

### Status Management
- `websources:markArchiving` - Mark as in-progress
- `websources:markComplete` - Mark as successfully archived
- `websources:markPartial` - Mark as partially archived
- `websources:markFailed` - Mark as failed with error
- `websources:resetToPending` - Reset for retry

### Version Management
- `websources:createVersion` - Create version snapshot
- `websources:findVersions` - Get all versions for source
- `websources:findVersionByNumber` - Get specific version
- `websources:findLatestVersion` - Get most recent version
- `websources:countVersions` - Count versions

### Search & Stats
- `websources:search` - Full-text search
- `websources:getStats` - Overall statistics
- `websources:getStatsByLocation` - Per-location stats
- `websources:count` - Total count

---

## UI Component

`LocationWebSources.svelte` provides:

1. **Source List**: Shows all sources with status badges
2. **Add Form**: URL input, title, type selector, notes
3. **Archive Button**: Triggers archiving with progress
4. **View Archive**: Opens archived content
5. **Delete**: Removes source and all archives

Status colors:
- Green: Complete
- Yellow: Partial
- Red: Failed
- Blue: Archiving
- Gray: Pending

---

## File Organization

Archives are stored in the archive folder:

```
[archive]/
├── locations/
│   └── [locid]/
│       └── _websources/
│           └── [source_id]/
│               ├── [source_id]_screenshot.png
│               ├── [source_id].pdf
│               ├── [source_id].html
│               ├── [source_id].warc.gz
│               ├── images/
│               │   └── [source_id]_img_0.jpg
│               ├── videos/
│               │   └── [source_id]_vid_0.mp4
│               └── text/
│                   └── [source_id]_content.txt
└── _websources/          # Unlinked sources
    └── [source_id]/
```

---

## Dependencies

### Required
- `puppeteer-core` - Browser automation
- `@au-archive/core` - Domain types
- `kysely` - Database queries
- `zod` - Validation

### Optional (for full functionality)
- `wget` - WARC archive creation
- `yt-dlp` - Video download
- `python3` with `trafilatura` - Text extraction

### Browser
- Bundled Ungoogled Chromium at:
  `resources/browsers/ungoogled-chromium/[platform]/Archive Browser.app`

---

## Testing

### Manual Test Steps

1. Navigate to a location detail page
2. Scroll to "Web Sources" section
3. Click "+ Add Source"
4. Enter a URL (e.g., `https://example.com`)
5. Select type, add notes (optional)
6. Click "Add Web Source"
7. Click "Archive" button
8. Verify status changes: pending → archiving → complete
9. Check console for any errors
10. Verify archive files exist in location folder

### Verify Database

```sql
-- Check web sources
SELECT source_id, url, status, word_count, image_count
FROM web_sources;

-- Check FTS works
SELECT * FROM web_sources_fts WHERE web_sources_fts MATCH 'search term';

-- Check versions
SELECT * FROM web_source_versions WHERE source_id = '...';
```

---

## Troubleshooting

### "No Chrome/Chromium executable found"
Browser not found. Check:
- `resources/browsers/ungoogled-chromium/mac-arm64/Archive Browser.app` exists
- File has execute permissions

### "database disk image is malformed"
FTS5 schema mismatch. Run:
```sql
INSERT INTO web_sources_fts(web_sources_fts) VALUES('rebuild');
```

### "String must contain exactly 16 character(s)"
Source ID validation mismatch. Migration 61 fixes this by accepting both:
- 16-char BLAKE3 hashes (new sources)
- 36-char UUIDs (migrated bookmarks)

### wget not found (WARC capture fails)
Install wget: `brew install wget`

### yt-dlp not found (video extraction fails)
Install yt-dlp: `brew install yt-dlp`

---

## Migration from Bookmarks

Call `websources:migrateFromBookmarks` to convert existing bookmarks:

```typescript
// Preserves:
// - Original bookmark ID as source_id
// - URL, title, notes
// - Location/sub-location links
// - Creates 'bookmark' source_type
// - Sets status to 'pending' for archiving
```

---

## Future Enhancements

1. **Scheduled re-archiving** - Periodic snapshots for change detection
2. **Diff viewer** - Compare versions visually
3. **Bulk import** - Import URLs from file
4. **Export** - Export archives as standalone packages
5. **Archive.org integration** - Submit to Wayback Machine

---

## Files Modified (OPT-109)

### New Files
- `packages/desktop/electron/services/websource-orchestrator-service.ts`
- `packages/desktop/electron/services/websource-capture-service.ts`
- `packages/desktop/electron/services/websource-extraction-service.ts`
- `packages/desktop/electron/main/ipc-handlers/websources.ts`
- `packages/desktop/electron/repositories/sqlite-websources-repository.ts`
- `packages/desktop/src/components/location/LocationWebSources.svelte`

### Modified Files
- `packages/desktop/electron/main/database.ts` - Schema + migrations
- `packages/desktop/electron/main/database.types.ts` - Type definitions
- `packages/desktop/electron/preload/preload.cjs` - IPC bridge
- `packages/desktop/src/pages/LocationDetail.svelte` - Component integration

---

## IRS-Level Audit (2025-12-08)

### Critical Bug #1: `markPartial()` Incomplete

**Location:** `sqlite-websources-repository.ts:445-464`

**Problem:** `markPartial()` only updates 4 fields:
- `status: 'partial'`
- `archived_at`
- `archive_path`
- `component_status`

But does NOT update successful component data:
- `screenshot_path`, `pdf_path`, `html_path`, `warc_path`
- `screenshot_hash`, `pdf_hash`, `html_hash`, `warc_hash`
- `word_count`, `image_count`, `video_count`
- `extracted_title`, `extracted_author`, `extracted_date`, `extracted_publisher`
- `content_hash`, `provenance_hash`

**Impact:** Database shows `word_count=0`, `image_count=0`, all paths NULL even though:
- Files exist in archive folder (verified: screenshot, html, pdf, images/)
- Version table has correct data (802 words, 3 images)

**Fix:** Modify `markPartial()` to accept full options like `markComplete()`.

---

### Critical Bug #2: Orchestrator Passes Incomplete Data

**Location:** `websource-orchestrator-service.ts:328-330`

**Problem:** When partial success detected:
```typescript
await this.repository.markPartial(sourceId, componentStatus, archivePath);
```

Vs. `markComplete()` which passes ALL data:
```typescript
await this.repository.markComplete(sourceId, {
  archive_path, screenshot_path, pdf_path, html_path, warc_path,
  screenshot_hash, pdf_hash, html_hash, warc_hash,
  content_hash, provenance_hash,
  extracted_title, extracted_author, extracted_date, extracted_publisher,
  word_count, image_count, video_count,
});
```

**Fix:** Update orchestrator to pass all successful component data.

---

### High Bug #3: UI Missing `component_status`

**Location:** `LocationWebSources.svelte:8-23`

**Problem:** `WebSource` interface doesn't include:
```typescript
component_status: {
  screenshot?: 'done' | 'failed' | 'skipped';
  pdf?: 'done' | 'failed' | 'skipped';
  html?: 'done' | 'failed' | 'skipped';
  warc?: 'done' | 'failed' | 'skipped';
  images?: 'done' | 'failed' | 'skipped';
  videos?: 'done' | 'failed' | 'skipped';
  text?: 'done' | 'failed' | 'skipped';
} | null;
```

**Impact:** UI can't show breakdown of what succeeded/failed.

---

### Medium Bug #4: No Component Breakdown in UI

**Location:** `LocationWebSources.svelte:247-261`

**Problem:** For partial status, shows:
- A yellow "Partial" badge
- Word/image/video counts (which are 0 due to Bug #1)
- No way to see WHAT is partial

**Fix:** Add expandable panel showing component status breakdown.

---

### Low Bug #5: No "Retry Failed" for Partial

**Location:** `LocationWebSources.svelte:268-276`

**Problem:** Archive button only shows for `pending` or `failed`, not `partial`.

**Fix:** Show "Re-archive" button for partial status too.

---

## Fixes Applied

### Fix 1: `markPartial()` Signature Update

```typescript
async markPartial(
  source_id: string,
  component_status: ComponentStatus,
  options: {
    archive_path: string;
    screenshot_path?: string | null;
    pdf_path?: string | null;
    html_path?: string | null;
    warc_path?: string | null;
    screenshot_hash?: string | null;
    pdf_hash?: string | null;
    html_hash?: string | null;
    warc_hash?: string | null;
    content_hash?: string | null;
    provenance_hash?: string | null;
    extracted_title?: string | null;
    extracted_author?: string | null;
    extracted_date?: string | null;
    extracted_publisher?: string | null;
    word_count?: number;
    image_count?: number;
    video_count?: number;
  }
): Promise<WebSource>
```

### Fix 2: Orchestrator Call Update

```typescript
await this.repository.markPartial(sourceId, componentStatus, {
  archive_path: archivePath,
  screenshot_path: screenshotPath,
  pdf_path: pdfPath,
  html_path: htmlPath,
  warc_path: warcPath,
  screenshot_hash: screenshotHash,
  pdf_hash: pdfHash,
  html_hash: htmlHash,
  warc_hash: warcHash,
  content_hash: contentHash,
  provenance_hash: provenanceHash,
  extracted_title: metadata.title,
  extracted_author: metadata.author,
  extracted_date: metadata.date,
  extracted_publisher: metadata.publisher,
  word_count: wordCount,
  image_count: extractedImages.length,
  video_count: extractedVideos.length,
});
```

### Fix 3: UI Interface Update

```typescript
interface WebSource {
  // ... existing fields
  component_status: {
    screenshot?: 'done' | 'failed' | 'skipped';
    pdf?: 'done' | 'failed' | 'skipped';
    html?: 'done' | 'failed' | 'skipped';
    warc?: 'done' | 'failed' | 'skipped';
    images?: 'done' | 'failed' | 'skipped';
    videos?: 'done' | 'failed' | 'skipped';
    text?: 'done' | 'failed' | 'skipped';
  } | null;
  archive_error: string | null;
}
```

### Fix 4: Component Breakdown Panel

Clickable "Partial" badge expands to show:
- ✓ Screenshot (done)
- ✓ PDF (done)
- ✓ HTML (done)
- ✗ WARC (failed)
- ✓ Images (done) - 3 extracted
- ○ Videos (skipped)
- ✓ Text (done) - 802 words

---

## Completion Score: 100%

### Completed
- Database schema and migrations (Migrations 57-62)
- Repository with full CRUD
- Orchestrator service
- Capture service (screenshot, PDF, HTML, WARC)
- Extraction service (images, videos, text)
- IPC handlers
- Preload bridge
- UI component
- Bookmark migration
- Browser path discovery fix
- ES module __dirname compatibility fix
- Schema mismatch fix (captured_at → archived_at)
- Missing web_source_versions columns (Migration 62)
- Source ID validation for both BLAKE3 and UUID formats
- **[NEW] markPartial() now updates all successful component data**
- **[NEW] Orchestrator passes full data to markPartial()**
- **[NEW] UI shows component_status breakdown for partial archives**
- **[NEW] Re-archive button available for partial archives**

### Testing Checklist
- [ ] Archive a URL where WARC fails (no wget) - verify partial status shows breakdown
- [ ] Check database: word_count, image_count, paths should be populated
- [ ] Click partial badge to see component status
- [ ] Use "Re-archive" button to retry
