# Image Enhance Workflow

Complete guide to the Image Enhance system for finding and archiving the highest quality images from web sources.

## System Overview

The Image Enhance system consists of four main components:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         IMAGE ENHANCE SYSTEM                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. SOURCE DISCOVERY          2. URL ENHANCEMENT        3. QUALITY ANALYSIS │
│  ┌──────────────────┐        ┌──────────────────┐      ┌──────────────────┐ │
│  │ • srcset parsing │        │ • Recursive strip│      │ • Dimensions     │ │
│  │ • <picture>      │   ──▶  │ • Site patterns  │  ──▶ │ • JPEG quality   │ │
│  │ • meta tags      │        │ • Validate HEAD  │      │ • Watermarks     │ │
│  │ • data-* attrs   │        │ • Size ranking   │      │ • Similarity     │ │
│  └──────────────────┘        └──────────────────┘      └──────────────────┘ │
│                                                                             │
│  4. BROWSER CAPTURE                                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ • Context menu integration  • Network request monitoring             │  │
│  │ • XHR/Fetch interception    • Page DOM scanning                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Services

### 1. Image Source Discovery (`image-source-discovery.ts`)

Extracts ALL possible image sources from a webpage.

**Key Features:**
- Parses `srcset` attributes for multiple resolutions
- Extracts `<picture><source>` elements
- Reads `og:image` and `twitter:image` meta tags
- Finds images in `data-src`, `data-original`, `data-lazy` attributes
- Detects background images from CSS
- Parses JSON-LD structured data
- Identifies "Download" and "View Full Size" links

**Supported Sites (13+):**
| Site | Pattern | Example |
|------|---------|---------|
| WordPress | `-WxH`, `-scaled`, `-N` | `image-2-1024x768.jpg` → `image.jpg` |
| Twitter/X | `?name=orig` | `?name=small` → `?name=orig` |
| Instagram | Size path removal | `/s640x640/` → `/` |
| Pinterest | `/originals/` path | `/236x/` → `/originals/` |
| Flickr | `_o` suffix | `_m.jpg` → `_o.jpg` |
| Imgur | Letter suffix | `abcdefgh.jpg` → `abcdefg.jpg` |
| 500px | Quality suffix | `/1.jpg` → `/5.jpg` |
| Unsplash | Raw quality | `?w=800` → `?q=100` |
| Wikimedia | Thumb path removal | `/thumb/.../800px-` → `/` |
| Google Photos | `=w0-h0` | `=w800-h600` → `=w0-h0` |
| Facebook | Size path | `/p960x960/` → `/` |
| ArtStation | `/4k/` path | `/large/` → `/4k/` |
| Shopify | Size suffix | `_800x.jpg` → `.jpg` |

### 2. Image Enhance Service (`image-enhance-service.ts`)

Recursively strips suffixes to find the TRUE original image.

**Key Insight:** The original transformer only stripped ONE level. The enhance service strips recursively:

```
EC01-2-1024x768.jpg (274KB)
  ↓ Strip -1024x768
EC01-2.jpg (1.8MB)
  ↓ Strip -2 (RECURSIVE!)
EC01.jpg (9.3MB) ← TRUE ORIGINAL (33x larger!)
```

**Suffix Patterns:**
| Pattern | Example | Regex |
|---------|---------|-------|
| wp_dimensions | `-1024x768` | `/-\d+x\d+$/` |
| wp_scaled | `-scaled` | `/-scaled$/` |
| wp_variant | `-1`, `-2` | `/-\d+$/` |
| wp_edit_hash | `-e1234567890` | `/-e\d{10,}$/` |
| retina | `@2x` | `/@[23]x$/` |
| thumb_suffix | `-thumb` | `/[-_](thumb|small)/` |

### 3. Image Quality Analyzer (`image-quality-analyzer.ts`)

Comprehensive quality analysis for ranking images.

#### Dimension Verification
- Partial download (first 64KB) for efficiency
- Reads actual pixel dimensions from image headers
- Calculates megapixels and aspect ratio

```typescript
const dims = await window.electron.downloader.getDimensions({
  url: 'https://example.com/image.jpg',
  full: false, // Partial download
});
// Returns: { width: 4000, height: 3000, megapixels: 12, aspectRatio: 1.33 }
```

#### JPEG Quality Detection
- Parses quantization tables (DQT markers)
- Estimates original quality (0-100)
- Detects re-compression artifacts
- Identifies chroma subsampling (4:2:0 vs 4:4:4)

```typescript
const quality = await window.electron.downloader.analyzeJpegQuality(url);
// Returns: { estimatedQuality: 85, isRecompressed: false, hasSubsampling: true }
```

#### Watermark Detection
- Analyzes corner regions for logos/text
- Detects center overlays
- Measures edge density patterns
- Returns confidence score and affected area

```typescript
const watermark = await window.electron.downloader.detectWatermark(url);
// Returns: { hasWatermark: true, confidence: 0.75, watermarkType: 'corner' }
```

#### Similarity Search
- DCT-based perceptual hashing
- Hamming distance comparison
- Finds visually similar images across candidates

```typescript
const similar = await window.electron.downloader.findSimilarByHash({
  targetUrl: 'https://example.com/image.jpg',
  candidateUrls: [...urls],
  threshold: 10,
});
// Returns: [{ url: '...', similarity: 0.95, distance: 3 }]
```

### 4. Browser Image Capture (`browser-image-capture.ts`)

Integrates with Electron browser for live image capture.

#### Context Menu Integration
Right-click on any image in the research browser:
- **Find Original Image** - Launches enhance pipeline
- **Analyze Image Quality** - Shows quality report
- **Save to Archive** - Imports to location

#### Network Request Monitoring
Automatically captures images loaded via:
- `<img>` tags
- CSS `background-image`
- XHR requests
- Fetch API calls

Filters out:
- Icons and favicons (< 5KB)
- Tracking pixels
- Sprites and spacers

```typescript
const captured = await window.electron.downloader.getCapturedImages(pageUrl);
// Returns all images loaded on the page, with size and type info
```

## API Reference

### Source Discovery

```typescript
// Discover all sources from HTML
const sources = await window.electron.downloader.discoverSources({
  html: pageHtml,
  pageUrl: 'https://example.com/article',
});

// Parse srcset attribute
const entries = await window.electron.downloader.parseSrcset({
  srcset: 'image-480w.jpg 480w, image-800w.jpg 800w',
  baseUrl: 'https://example.com/',
});

// Apply site-specific patterns
const candidates = await window.electron.downloader.applySitePatterns(imageUrl);
```

### URL Enhancement

```typescript
// Single URL enhancement
const result = await window.electron.downloader.enhanceUrl({
  url: 'https://example.com/image-1024x768.jpg',
  options: {
    preferTraditionalFormats: true,
    maxDepth: 5,
    validate: true,
  }
});
// Returns: { bestUrl: 'https://example.com/image.jpg', improvement: 10.5 }

// Batch enhancement
const results = await window.electron.downloader.enhanceUrls({
  urls: [...thumbnailUrls],
});
```

### Quality Analysis

```typescript
// Full quality report
const report = await window.electron.downloader.analyzeQuality({
  url: 'https://example.com/image.jpg',
});
// Returns comprehensive report with dimensions, JPEG quality, watermarks, score

// Rank multiple images
const ranked = await window.electron.downloader.rankByQuality({
  urls: [...imageUrls],
  concurrency: 3,
});
// Returns images sorted by quality score with recommendations
```

### Comprehensive Pipeline

```typescript
// Find best images from a page (discover + enhance + validate + rank)
const best = await window.electron.downloader.findBestImages({
  html: pageHtml,
  pageUrl: 'https://example.com/gallery',
  options: {
    maxImages: 10,
    validateAll: true,
  }
});
// Returns top 10 highest quality images with full analysis
```

## Quality Score Calculation

The composite quality score (0-100) is calculated as:

```
Base Score = 100

1. Resolution Factor (30% weight)
   - 12+ megapixels = full score
   - Scales linearly below 12MP

2. JPEG Quality Factor
   - Multiplied by estimated quality / 100
   - -15% penalty if re-compressed

3. Watermark Penalty
   - Up to -30% based on confidence

Recommendations:
- 85-100: Excellent (archive-quality)
- 70-84: Good (suitable for most uses)
- 50-69: Acceptable (usable with limitations)
- 30-49: Poor (consider alternatives)
- 0-29: Avoid (significant quality issues)
```

## Best Practices

### For Archival Quality

1. **Always enhance first** - Never download thumbnails directly
2. **Check quality scores** - Prefer "excellent" or "good" ratings
3. **Verify dimensions** - Ensure adequate resolution for archival
4. **Detect watermarks** - Avoid watermarked versions when originals exist
5. **Prefer traditional formats** - JPG/PNG over WebP for long-term storage

### Performance Tips

1. **Use partial downloads** - `getDimensions({ full: false })` for initial filtering
2. **Batch operations** - Use `enhanceUrls` and `rankByQuality` for multiple images
3. **Set concurrency limits** - Default is 3-5 parallel requests
4. **Clear captured images** - Periodically clean old network captures

## Rate Limiting & Caching

The enhance service includes built-in protections to be a good network citizen:

### Rate Limiting
- **Global limit**: 50 requests/second maximum
- **Per-domain limit**: 100ms minimum between requests to same domain
- Prevents server overload and potential IP bans

### Validation Cache
- **TTL**: 15 minutes
- **Auto-cleanup**: Triggers when cache exceeds 1000 entries
- Avoids redundant HEAD requests for recently checked URLs

```typescript
// Get cache statistics
const stats = window.electron.downloader.getEnhanceCacheStats();
// Returns: { cacheSize: 150, domainsTracked: 25 }

// Clear cache manually
window.electron.downloader.clearEnhanceCache();
```

## Context Menu Integration

Right-click on any image in the research browser to access:

### Available Actions

| Action | Description | Event |
|--------|-------------|-------|
| **Find Original Image** | Launches enhance pipeline to find highest-res version | `image-capture:findOriginal` |
| **Analyze Image Quality** | Shows quality report (dimensions, JPEG quality, watermarks) | `image-capture:analyzeQuality` |
| **Save to Archive** | Imports image to selected location | `image-capture:saveToArchive` |

### Listening for Context Menu Events

```typescript
// In your Svelte component
import { onMount, onDestroy } from 'svelte';

let unsubscribeFindOriginal: () => void;
let unsubscribeAnalyzeQuality: () => void;
let unsubscribeSaveToArchive: () => void;

onMount(() => {
  unsubscribeFindOriginal = window.electron.downloader.onFindOriginal(async (data) => {
    const { imageUrl, pageUrl, timestamp } = data;

    // Enhance the image to find original
    const result = await window.electron.downloader.enhanceUrl({
      url: imageUrl,
      options: { validate: true }
    });

    console.log('Found best URL:', result.bestUrl);
    console.log('Size improvement:', result.improvement + 'x');
  });

  unsubscribeAnalyzeQuality = window.electron.downloader.onAnalyzeQuality(async (data) => {
    const { imageUrl } = data;

    const report = await window.electron.downloader.analyzeQuality({ url: imageUrl });
    console.log('Quality score:', report.report?.qualityScore);
    console.log('Recommendation:', report.report?.recommendation);
  });

  unsubscribeSaveToArchive = window.electron.downloader.onSaveToArchive(async (data) => {
    const { imageUrl, pageUrl } = data;
    // Trigger import flow...
  });
});

onDestroy(() => {
  unsubscribeFindOriginal?.();
  unsubscribeAnalyzeQuality?.();
  unsubscribeSaveToArchive?.();
});
```

## Integration with Import Pipeline

The Image Enhance system integrates with the standard import pipeline:

1. **Discovery Phase** - Find all images on a page
2. **Enhancement Phase** - Find highest quality versions
3. **Quality Phase** - Analyze and rank candidates
4. **Selection Phase** - User selects images to import
5. **Import Phase** - Standard BLAKE3 hashing and organization

Images imported via enhance system receive:
- pHash for duplicate detection
- Quality score metadata
- Source URL tracking
- Enhancement history

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No originals found | Site may not keep originals; check for alternative sources |
| Low quality scores | Original may be poor quality; check source reliability |
| Watermark false positives | Complex images can trigger detection; verify visually |
| Network capture empty | Check filter settings; ensure minimum size is appropriate |
| Enhancement timeout | Increase timeout or check network connectivity |

## Related Documentation

- @docs/contracts/hashing.md - BLAKE3 hashing contract
- @docs/workflows/import.md - Standard import workflow
- @docs/contracts/data-ownership.md - Archive ownership guarantees
