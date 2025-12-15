# OPT-115: Web Source Complete Overhaul

**Status**: PLANNING - AWAITING APPROVAL
**Created**: 2025-12-12
**Scope**: Full web archiving pipeline fix - no bandaids

---

## USER REQUIREMENTS

> "Extract and log from each website: Page author, post date, publish date, domain, relevant links, list of images (original name, alt resolutions, description, caption, author, attribution, EXIF), list of videos (same), full screenshot, WARC, PDF ALWAYS EVERY TIME"
>
> "Automatically archive on bookmark save - download in background"
>
> "NO BANDAIDS - THIS IS AN ARCHIVE APP GET IT RIGHT"

---

## AUDIT SUMMARY

### What EXISTS and WORKS

| Component | Status | Notes |
|-----------|--------|-------|
| **Metadata extraction** | ✅ GOOD | Open Graph, Schema.org, Dublin Core, Twitter Cards all extracted |
| **Image metadata** | ✅ GOOD | EXIF, srcset variants, caption, credit, attribution extracted |
| **Video metadata** | ✅ GOOD | yt-dlp extracts title, description, uploader, views, tags |
| **Screenshot/PDF/HTML/WARC** | ✅ GOOD | All capture methods implemented |
| **WebSourceDetailModal** | ✅ GOOD | Shows images, videos, links, metadata |
| **Database schema** | ✅ GOOD | `web_source_images`, `web_source_videos` tables exist |
| **Auto-archive (OPT-113)** | ⚠️ EXISTS | Jobs queue but **FAIL due to profile lock** |

### What's BROKEN

| Issue | Root Cause | Impact |
|-------|------------|--------|
| **Profile lock kills auto-archive** | Browser running = profile locked = empty fallback profile | Bot detection, CAPTCHA pages |
| **Two-browser architecture** | Puppeteer launches SEPARATE browser from Research Browser | No cookie sharing when it matters |
| **Metadata not stored** | Full `PageMetadata` extracted but only partial fields stored | Lost data |
| **Domain not stored** | Extracted but not persisted to database | Missing in UI |

---

## IMPLEMENTATION PLAN

### Phase 1: Fix the Fundamental Cookie Problem

**Problem**: Auto-archive queues job when user saves bookmark, but Research Browser is RUNNING, so profile is locked, so Puppeteer uses empty profile, so bot detection triggers.

**Solution**: **Extension-First Capture**

The Research Browser extension already runs IN the user's browser session. Use it to capture page content BEFORE Puppeteer needs to touch it.

#### 1.1 Extension Content Capture

Add to `resources/extension/content.js`:

```javascript
// Capture current page state from user's actual session
function capturePageState() {
  return {
    url: window.location.href,
    title: document.title,
    html: document.documentElement.outerHTML,

    // Meta extraction (runs in page context = full access)
    meta: {
      ogTitle: document.querySelector('meta[property="og:title"]')?.content,
      ogDescription: document.querySelector('meta[property="og:description"]')?.content,
      ogImage: document.querySelector('meta[property="og:image"]')?.content,
      author: document.querySelector('meta[name="author"]')?.content,
      publishDate: document.querySelector('meta[property="article:published_time"]')?.content,
      // ... all standard meta
    },

    // Images with context
    images: Array.from(document.querySelectorAll('img')).map(img => ({
      src: img.src,
      srcset: img.srcset,
      alt: img.alt,
      width: img.naturalWidth,
      height: img.naturalHeight,
      caption: img.closest('figure')?.querySelector('figcaption')?.textContent,
      // ... full context
    })),

    // Links
    links: Array.from(document.querySelectorAll('a[href]')).map(a => ({
      url: a.href,
      text: a.textContent?.trim(),
    })),

    // Timestamp
    capturedAt: new Date().toISOString(),
  };
}
```

#### 1.2 Extension Screenshot Capture

```javascript
// Use chrome.tabs.captureVisibleTab for screenshots
async function captureScreenshot() {
  return new Promise((resolve) => {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      resolve(dataUrl);
    });
  });
}
```

#### 1.3 Extension → Main Process Flow

When user saves bookmark via extension:

```
1. Extension captures page state (DOM, meta, images list)
2. Extension captures screenshot (visible viewport)
3. Extension sends to main process via WebSocket
4. Main process:
   a. Saves HTML snapshot immediately (user's rendered view)
   b. Saves screenshot immediately
   c. Queues Puppeteer job for PDF/WARC (can wait for browser close)
   d. Stores all metadata NOW (not dependent on Puppeteer)
```

**Result**: User gets immediate HTML + screenshot capture from THEIR session. PDF/WARC can be background tasks.

---

### Phase 2: Store ALL Extracted Metadata

Currently `websource-metadata-service.ts` extracts comprehensive `PageMetadata` but only partial fields are stored.

#### 2.1 New Database Columns

Add to `web_sources` table (Migration 70+):

```sql
-- Full metadata storage
ALTER TABLE web_sources ADD COLUMN domain TEXT;
ALTER TABLE web_sources ADD COLUMN page_metadata_json TEXT;  -- Full PageMetadata as JSON
ALTER TABLE web_sources ADD COLUMN og_image TEXT;
ALTER TABLE web_sources ADD COLUMN og_description TEXT;
ALTER TABLE web_sources ADD COLUMN schema_org_json TEXT;     -- Full Schema.org JSON-LD
ALTER TABLE web_sources ADD COLUMN dublin_core_json TEXT;    -- Full Dublin Core
ALTER TABLE web_sources ADD COLUMN twitter_card_json TEXT;   -- Full Twitter Cards
ALTER TABLE web_sources ADD COLUMN canonical_url TEXT;
ALTER TABLE web_sources ADD COLUMN language TEXT;
ALTER TABLE web_sources ADD COLUMN favicon_url TEXT;
ALTER TABLE web_sources ADD COLUMN http_status INTEGER;
ALTER TABLE web_sources ADD COLUMN extracted_links_json TEXT; -- Full links array

-- Capture method tracking
ALTER TABLE web_sources ADD COLUMN capture_method TEXT;      -- 'extension' | 'puppeteer' | 'hybrid'
ALTER TABLE web_sources ADD COLUMN extension_captured_at TEXT;
ALTER TABLE web_sources ADD COLUMN puppeteer_captured_at TEXT;
```

#### 2.2 Update Orchestrator to Store Full Metadata

In `websource-orchestrator-service.ts`, after metadata extraction:

```typescript
// Store EVERYTHING, not just summary fields
await this.repository.update(sourceId, {
  domain: new URL(source.url).hostname.replace(/^www\./, ''),
  page_metadata_json: JSON.stringify(pageMetadata),
  og_image: pageMetadata.openGraph.image,
  og_description: pageMetadata.openGraph.description,
  schema_org_json: pageMetadata.schemaOrg.raw,
  dublin_core_json: JSON.stringify(pageMetadata.dublinCore),
  twitter_card_json: JSON.stringify(pageMetadata.twitterCards),
  canonical_url: pageMetadata.canonicalUrl,
  language: pageMetadata.language,
  favicon_url: pageMetadata.faviconUrl,
  http_status: pageMetadata.httpStatus,
  extracted_links_json: JSON.stringify(pageMetadata.links),
  // Existing fields
  extracted_title: consolidated.title,
  extracted_author: consolidated.author,
  extracted_date: consolidated.publishDate,
  extracted_publisher: consolidated.publisher,
});
```

---

### Phase 3: Always Capture Everything

User requirement: "full screenshot, WARC, PDF ALWAYS EVERY TIME"

#### 3.1 Remove Optional Flags from Auto-Archive

In `websources.ts` IPC handler, auto-archive with ALL captures:

```typescript
// OPT-113: Auto-queue archive job with FULL capture
await jobQueue.addJob({
  queue: IMPORT_QUEUES.WEBSOURCE_ARCHIVE,
  payload: {
    sourceId: source.source_id,
    options: {
      captureScreenshot: true,  // ALWAYS
      capturePdf: true,         // ALWAYS
      captureHtml: true,        // ALWAYS
      captureWarc: true,        // ALWAYS
      extractImages: true,      // ALWAYS
      extractVideos: true,      // ALWAYS
      extractText: true,        // ALWAYS
    },
  },
  priority: 5,
});
```

#### 3.2 Extension Pre-Capture (Immediate)

Even before Puppeteer job runs, extension captures what it can:

```typescript
// When extension sends bookmark
interface ExtensionCapture {
  url: string;
  html: string;           // Full DOM snapshot
  screenshot: string;     // Base64 PNG (viewport)
  metadata: PageMetadata; // Full meta extraction
  images: ImageInfo[];    // All images found
  links: LinkInfo[];      // All links found
  capturedAt: string;
}

// Save immediately - no waiting for Puppeteer
async function handleExtensionCapture(capture: ExtensionCapture) {
  // 1. Create source record
  const source = await webSourcesRepo.create({
    url: capture.url,
    title: capture.metadata.openGraph.title || document.title,
    // ... metadata
  });

  // 2. Save HTML snapshot NOW
  const htmlPath = path.join(archiveDir, `${source.source_id}_extension.html`);
  await fs.promises.writeFile(htmlPath, capture.html);

  // 3. Save screenshot NOW
  const screenshotPath = path.join(archiveDir, `${source.source_id}_extension_screenshot.png`);
  const buffer = Buffer.from(capture.screenshot.split(',')[1], 'base64');
  await fs.promises.writeFile(screenshotPath, buffer);

  // 4. Store full metadata NOW
  await webSourcesRepo.update(source.source_id, {
    html_path: htmlPath,
    screenshot_path: screenshotPath,
    page_metadata_json: JSON.stringify(capture.metadata),
    extracted_links_json: JSON.stringify(capture.links),
    capture_method: 'extension',
    extension_captured_at: capture.capturedAt,
  });

  // 5. Queue Puppeteer for PDF/WARC (can wait, non-critical path)
  await jobQueue.addJob({
    queue: IMPORT_QUEUES.WEBSOURCE_ARCHIVE,
    payload: { sourceId: source.source_id, mode: 'puppeteer-only' },
    priority: 3, // Lower priority - background task
  });
}
```

---

### Phase 4: Enhanced UI Display

Update `WebSourceDetailModal.svelte` to show ALL metadata.

#### 4.1 Add New Sections

```svelte
<!-- Domain & Basic Info -->
<section>
  <h3>PAGE INFO</h3>
  <dl>
    <dt>Domain</dt>
    <dd>{source.domain}</dd>
    <dt>Author</dt>
    <dd>{source.extracted_author}</dd>
    <dt>Published</dt>
    <dd>{formatDate(source.extracted_date)}</dd>
    <dt>Publisher</dt>
    <dd>{source.extracted_publisher}</dd>
    <dt>Language</dt>
    <dd>{source.language}</dd>
    <dt>HTTP Status</dt>
    <dd>{source.http_status}</dd>
  </dl>
</section>

<!-- Open Graph -->
{#if source.og_image || source.og_description}
<section>
  <h3>OPEN GRAPH</h3>
  {#if source.og_image}
    <img src={source.og_image} alt="OG Image" class="max-h-32" />
  {/if}
  <p>{source.og_description}</p>
</section>
{/if}

<!-- Schema.org -->
{#if source.schema_org_json}
<section>
  <h3>SCHEMA.ORG DATA</h3>
  <pre class="text-xs overflow-auto max-h-48">{JSON.stringify(JSON.parse(source.schema_org_json), null, 2)}</pre>
</section>
{/if}

<!-- Capture Status -->
<section>
  <h3>CAPTURE INFO</h3>
  <dl>
    <dt>Method</dt>
    <dd>{source.capture_method}</dd>
    <dt>Extension Captured</dt>
    <dd>{source.extension_captured_at}</dd>
    <dt>Puppeteer Captured</dt>
    <dd>{source.puppeteer_captured_at}</dd>
  </dl>
</section>
```

---

### Phase 5: Trafilatura + BeautifulSoup Text Extraction

The extraction service already has Python support but it may not be installed.

#### 5.1 Ensure Python Dependencies

Add to `scripts/setup.sh`:

```bash
# Install Python extraction dependencies
pip3 install trafilatura beautifulsoup4 lxml
```

#### 5.2 Create Python Extraction Script

`packages/desktop/electron/scripts/extract-text.py`:

```python
#!/usr/bin/env python3
"""
Comprehensive text extraction using multiple methods
OPT-115: Redundant extraction with Trafilatura + BeautifulSoup
"""
import sys
import json
import trafilatura
from bs4 import BeautifulSoup
import urllib.request

def extract(url):
    # Method 1: Trafilatura (best for articles)
    downloaded = trafilatura.fetch_url(url)
    traf_result = trafilatura.extract(
        downloaded,
        include_comments=False,
        include_tables=True,
        no_fallback=False,
        favor_precision=True,
        output_format='json'
    )

    # Method 2: BeautifulSoup (fallback, raw extraction)
    soup = BeautifulSoup(downloaded, 'lxml')

    # Remove scripts, styles
    for tag in soup(['script', 'style', 'nav', 'footer', 'header']):
        tag.decompose()

    bs_text = soup.get_text(separator=' ', strip=True)

    # Combine results
    result = {
        'trafilatura': json.loads(traf_result) if traf_result else None,
        'beautifulsoup_text': bs_text,
        'title': soup.title.string if soup.title else None,
        'meta_author': soup.find('meta', {'name': 'author'})['content'] if soup.find('meta', {'name': 'author'}) else None,
    }

    print(json.dumps(result))

if __name__ == '__main__':
    extract(sys.argv[1])
```

---

## FILE CHANGES SUMMARY

| File | Changes |
|------|---------|
| `resources/extension/content.js` | Add page capture functions |
| `resources/extension/background.js` | Add screenshot capture, send to main |
| `electron/services/extension-bridge-service.ts` | Handle extension capture data |
| `electron/services/websource-orchestrator-service.ts` | Store full metadata |
| `electron/main/ipc-handlers/websources.ts` | Always capture everything |
| `electron/main/database.ts` | Migration 70: new columns |
| `electron/repositories/sqlite-websources-repository.ts` | Update methods for new fields |
| `src/components/location/WebSourceDetailModal.svelte` | Display all metadata |
| `electron/scripts/extract-text.py` | NEW: Python extraction script |

---

## TESTING PLAN

### Test 1: Extension Capture
1. Open Research Browser
2. Navigate to article (e.g., NY Times)
3. Save bookmark via extension
4. **VERIFY**: HTML + Screenshot saved immediately
5. **VERIFY**: Full metadata stored in database

### Test 2: Background Puppeteer
1. Close Research Browser
2. **VERIFY**: PDF/WARC jobs process successfully
3. **VERIFY**: Archive files created

### Test 3: Bot Detection Site
1. Open Research Browser
2. Log into Zillow
3. Navigate to property listing
4. Save bookmark
5. **VERIFY**: Content captured from user's session (no CAPTCHA)

### Test 4: Full Metadata Display
1. Open location detail
2. Click on archived web source
3. **VERIFY**: Domain, author, date, publisher visible
4. **VERIFY**: Open Graph, Schema.org sections visible
5. **VERIFY**: All images with EXIF visible
6. **VERIFY**: All videos with metadata visible

---

## MIGRATION STRATEGY

1. **Migration 70**: Add new columns (non-breaking)
2. **Deploy extension update**: Users get new content.js
3. **Update orchestrator**: Store full metadata
4. **Re-archive existing**: Optional job to re-process pending sources

---

## RISKS

| Risk | Mitigation |
|------|------------|
| Extension permissions | Already has `<all_urls>`, `tabs` permissions |
| Screenshot size | Compress PNG, limit to viewport |
| Metadata JSON size | Gzip in DB or truncate large arrays |
| Python not installed | Fallback to browser extraction |

---

## APPROVAL REQUIRED

This plan requires approval before implementation:

1. **Extension-first approach** - OK to capture from extension?
2. **Full metadata storage** - OK to store JSON blobs in DB?
3. **Phase order** - Start with extension capture or metadata storage first?

**Ready for review.**
