# Media Viewer & Archive Metadata System

Version: 0.1.0
Created: 2025-11-23
Status: **Implementation Complete**

---

## Implementation Summary

All Phase 1-8 services and components have been implemented:

### Backend Services Created
| Service | Lines | Purpose |
|---------|-------|---------|
| media-path-service.ts | ~90 | Path utilities with hash bucketing |
| thumbnail-service.ts | ~100 | Sharp-based 256px JPEG generation |
| preview-extractor-service.ts | ~120 | ExifTool RAW preview extraction |
| poster-frame-service.ts | ~85 | FFmpeg video frame extraction |
| media-cache-service.ts | ~140 | LRU memory cache (100MB default) |
| preload-service.ts | ~100 | Adjacent image preloading |
| xmp-service.ts | ~190 | XMP sidecar read/write (source of truth) |

### Frontend Components Created
| Component | Lines | Purpose |
|-----------|-------|---------|
| MediaViewer.svelte | ~250 | Full-screen lightbox with keyboard nav |
| MediaGrid.svelte | ~100 | Thumbnail grid with lazy loading |
| ExifPanel.svelte | ~100 | EXIF metadata display |

### Database Changes
- Migration 8: Add thumb_path, preview_path, xmp_synced columns to imgs/vids
- New indexes for finding media without thumbnails

### Modified Files
- ipc-handlers.ts: Added media IPC handlers
- preload/index.ts: Added media API
- sqlite-media-repository.ts: Added thumbnail/preview methods
- LocationDetail.svelte: Integrated MediaViewer component
- exiftool-service.ts: Added extractBinaryTag method
- ffmpeg-service.ts: Added extractFrame method

---

## Overview

Implementation plan for:
1. Built-in media viewer (images, RAW photos, videos)
2. Performance optimizations (PhotoMechanic-level speed)
3. Metadata architecture (XMP sidecars as source of truth)

### Core Principle: True Archive

```
┌─────────────────────────────────────────┐
│           SOURCE OF TRUTH               │
│   Files + XMP Sidecars (portable)       │
│   - Ratings, labels, keywords           │
│   - All user metadata                   │
└─────────────────┬───────────────────────┘
                  │ read/index
                  ▼
┌─────────────────────────────────────────┐
│           SPEED LAYER                   │
│   SQLite Database (cache/index)         │
│   - Fast queries                        │
│   - Rebuildable from XMP                │
└─────────────────────────────────────────┘
```

### Strategy: Hybrid Approach

| Format Type | Viewer Strategy | Tool |
|-------------|-----------------|------|
| Standard Images (JPG, PNG, WebP, GIF, BMP) | Native `<img>` tag | Browser |
| HEIC/HEIF | Convert to JPEG on import | Sharp |
| RAW Files (NEF, CR2, ARW, DNG, etc.) | Extract embedded JPEG preview | ExifTool |
| Video (H.264, WebM, VP8/VP9) | Native `<video>` tag | Browser |
| Unsupported Video | Poster frame + external | FFmpeg |

---

## Do Not Change

These architectural decisions are final. Do not modify without explicit approval:

### 1. XMP Sidecars as Source of Truth
**Decision:** XMP sidecar files are the source of truth for all user metadata (ratings, labels, keywords). SQLite is a rebuildable cache.

**Why:**
- Portability: Files can be moved, app can die, metadata survives
- Industry standard: PhotoMechanic, Lightroom, Bridge all use XMP
- Disaster recovery: Can rebuild SQLite from XMP sidecars
- True archive: The files ARE the archive, not the database

**Never:** Store user metadata only in SQLite

### 2. Extract RAW Previews, Don't Convert
**Decision:** Use ExifTool to extract embedded JPEG previews from RAW files. Do not add LibRaw, dcraw, or WASM decoders.

**Why:**
- Speed: Preview extraction is <1 second vs 2-5 seconds for full RAW conversion
- Dependencies: No 50MB LibRaw library needed
- Quality: Camera-generated previews are high quality
- BPL: ExifTool has been stable for 20+ years, updates for new cameras within weeks

**Never:** Add LibRaw, dcraw, rawloader-wasm, or any RAW conversion library

### 3. Native Browser Rendering
**Decision:** Use native `<img>` and `<video>` tags for display. Do not add canvas-based viewers, WebGL renderers, or PDF.js.

**Why:**
- Performance: Browser rendering is GPU-accelerated
- Simplicity: Zero maintenance burden
- Compatibility: Works on all platforms
- BPL: Browser APIs are stable and well-tested

**Never:** Add canvas-based image viewers, WebGL renderers, or custom video players

### 4. Thumbnails on Import, Not On-Demand
**Decision:** Generate thumbnails when files are imported, not when they're first viewed.

**Why:**
- UX: Grid browsing is instant, no loading spinners
- Offline: Works without regenerating on every view
- Consistency: PhotoMechanic pattern, proven approach

**Never:** Generate thumbnails on-demand or lazily

### 5. Full Performance System in v0.1.0
**Decision:** Build the complete caching, preloading, and (future) virtualization system now, not later.

**Why:**
- "Code once, cry once" - retrofitting performance is harder than building it in
- User expectations: If images load slowly, users won't trust the app
- PhotoMechanic comparison: We're competing with professional tools

**Never:** Defer performance features to "optimize later"

### 6. Separate Cache and Preload Services
**Decision:** Keep MediaCacheService and PreloadService as separate modules.

**Why:**
- Single responsibility: Cache manages storage, preload predicts what to cache
- LILBITS compliance: Each under 300 lines
- Testability: Each can be tested independently

**Never:** Merge cache and preload into one service

---

## Script Documentation Standard

**Update for claude.md:** Every script in this project MUST have a corresponding `.md` documentation file.

### Purpose

Prevent AI drift and enable any developer (regardless of skill level) to:
1. Understand exactly what the script does
2. Understand WHY it does it that way
3. Recreate the script from scratch if needed
4. Track all changes with full reasoning

### Location

```
docs/scripts/
├── services/
│   ├── thumbnail-service.md
│   ├── preview-extractor-service.md
│   └── ...
└── components/
    ├── MediaViewer.md
    └── ...
```

### Required Sections

```markdown
# [Script Name]

## Overview
Brief description of what this script does and why it exists.

## File Location
`packages/desktop/electron/services/[script-name].ts`

## Dependencies
List every import with WHY it's used:
- `sharp`: Image processing - chosen over ImageMagick for speed and Node.js native binding

## Consumers (What Uses This)
- file-import-service.ts: Calls on import
- MediaGrid.svelte: Displays thumbnails

## Core Rules (DO NOT BREAK)
1. [Rule]: [Why this rule exists]
2. [Rule]: [Why this rule exists]

## Function-by-Function Breakdown

### `functionName(params)`
**Purpose:** What it does
**Parameters:**
- `param1` (type): What it's for
**Returns:** What and why
**Logic Flow:**
1. Step one
2. Step two
**Edge Cases:**
- If X happens, we do Y because Z

## Error Handling
How errors are handled and why

## Performance Considerations
Why certain choices were made for performance

## Testing
How to test this script manually or with automated tests

## Changelog
| Date | Who | Why | What Changed | Logic |
|------|-----|-----|--------------|-------|
| 2025-11-23 | Claude | Initial implementation | Created service | Per kanye.md Phase 1 |
```

### Enforcement

- No merge without documentation file
- No modification without changelog update
- AI must read script's .md before editing
- Code review verifies changelog was updated

---

## ULTRATHINK AUDIT - 2025-11-23

**Status: CRITICAL BUGS FOUND**
**Audit Scope:** Thumbnail display, GPS/Address handling, Map integration, User Experience

This audit identifies why the archive app is not functioning as a premium user experience and provides a detailed implementation roadmap.

---

### ISSUE #1: THUMBNAILS NOT DISPLAYING (CRITICAL)

**Symptom:** User sees gray placeholder icons instead of actual thumbnail images in the location detail grid.

**Root Cause Analysis:**

```
WHAT WE HAVE:
thumbnail-service.ts     --> Generates 256x256 thumbnails on import --> WORKS
file-import-service.ts   --> Calls thumbnail generation, saves thumb_path to DB --> WORKS
MediaGrid.svelte         --> Has proper <img> tag with media:// protocol --> WORKS
MediaViewer.svelte       --> Has proper <img> tag with media:// protocol --> WORKS

WHAT'S BROKEN:
LocationDetail.svelte    --> Does NOT use MediaGrid.svelte!
                         --> Has its own grid with ONLY SVG placeholder!
                         --> thumb_path is collected but NEVER RENDERED as <img>!
```

**Evidence from LocationDetail.svelte (lines 986-1007):**
```svelte
<!-- THIS IS THE BUG - Only shows SVG, never actual thumbnail -->
<button onclick={() => openLightbox(actualIndex)} class="aspect-square bg-gray-100...">
  <div class="absolute inset-0 flex items-center justify-center text-gray-400">
    <svg class="w-12 h-12" ...>  <!-- <-- ONLY THIS SVG SHOWS! -->
      <path ... d="M4 16l4.586-4.586..." />
    </svg>
  </div>
</button>
```

**What SHOULD happen (from MediaGrid.svelte lines 53-60):**
```svelte
{#if item.thumbPath || isBrowserSupported(item.path)}
  <img
    src={getThumbnailSrc(item)}   <!-- Uses media:// protocol -->
    alt={item.name}
    loading="lazy"
    class="w-full h-full object-cover"
  />
{:else}
  <!-- Placeholder only for unsupported formats -->
{/if}
```

**Why This Happened:**
1. MediaGrid.svelte was created as the proper component
2. LocationDetail.svelte was NOT updated to use MediaGrid.svelte
3. LocationDetail.svelte has dead code - collects thumb_path but never renders it

**Secondary Issue - Thumbnail Quality:**
- Current: 256px at 80% JPEG quality
- Problem: On HiDPI displays (2x, 3x scaling), 256px thumbnails look blurry
- A "premium archive" needs crisp thumbnails at all display sizes

**FIX REQUIRED:**
1. Replace LocationDetail.svelte image grid with MediaGrid.svelte component
2. OR add proper `<img>` tags that use thumb_path with media:// protocol
3. Consider multi-resolution thumbnails (256px, 512px) for HiDPI support

---

### ISSUE #2: NO GPS FROM ADDRESS / MAP NOT SHOWING (CRITICAL)

**Symptom:** Mary McAllen shots imported with address "99 Myrtle Avenue Village Of Cambridge, NY 12816" but:
- No GPS coordinates shown
- Map says "No GPS coordinates available"
- User cannot see location on map despite having full address

**Root Cause Analysis:**

```
CURRENT FLOW:
1. Import files with address (no EXIF GPS)
2. file-import-service.ts checks: does file have GPS?
3. NO - so no GPS to compare/use
4. Location has address but address_street/city is set
5. LocationDetail.svelte checks: location.gps exists?
6. NO - shows "No GPS coordinates available"
7. Map component NEVER CALLED

WHAT'S MISSING:
- Forward geocoding: Address --> GPS coordinates
- If location has address but no GPS, we should GEOCODE IT!
```

**Evidence from LocationDetail.svelte (lines 785-853):**
```svelte
{#if location.gps}
  <!-- Map only shows if GPS exists -->
  <Map locations={[location]} />
{:else}
  <!-- This is what user sees -->
  <div class="text-center py-4">
    <p class="text-gray-500 mb-3">No GPS coordinates available</p>
  </div>
{/if}
```

**Evidence from Map.svelte - HAS FALLBACK BUT NOT USED:**
```typescript
// Map.svelte has state centroid fallback!
function getLocationCoordinates(location: Location) {
  if (location.gps?.lat && location.gps?.lng) {
    return { lat: location.gps.lat, lng: location.gps.lng, isApproximate: false };
  }
  // Fallback to state centroid if we have a state
  const state = location.address?.state?.toUpperCase();
  if (state && STATE_CENTROIDS[state]) {
    return { ...STATE_CENTROIDS[state], isApproximate: true };
  }
  return null;
}
```

**The Disconnect:**
1. Map.svelte CAN show locations with only state (uses centroid)
2. BUT LocationDetail.svelte only passes location to Map IF gps exists
3. This means the fallback in Map.svelte is NEVER REACHED for single-location views

**What a Premium Archive Should Do:**
1. If location has address but no GPS --> FORWARD GEOCODE to get GPS
2. If geocoding fails --> Show map with state centroid (approximate marker)
3. NEVER hide the map - always show SOMETHING
4. Show confidence indicator: "GPS from geocoding" vs "Verified GPS"

**FIX REQUIRED:**
1. Add forward geocoding when location has address but no GPS
2. Update LocationDetail.svelte to ALWAYS show map (pass location regardless of GPS)
3. Let Map.svelte's fallback logic handle approximate positioning
4. Auto-geocode addresses that have no GPS on location save/update

---

### ISSUE #3: ADDRESS DISPLAY IS SLOPPY (UX)

**Symptom:** Address displays as:
```
Address
99 Myrtle Avenue Village Of Cambridge, NY 12816
Washington County
```

Problems:
- Street not clickable (city/state ARE clickable)
- No visual hierarchy - text blob
- "Village Of Cambridge" appears to be city but may be in wrong field
- Inconsistent capitalization
- No "View on Map" link for street

**Root Cause Analysis:**

```
CURRENT DISPLAY CODE (LocationDetail.svelte lines 752-783):
- street: Plain text, no link
- city: Clickable button (filters locations)
- state: Clickable button (filters locations)
- zipcode: Plain text, no link
- county: Clickable button (filters locations)

INCONSISTENCY:
- Some elements are interactive (city, state, county)
- Some are not (street, zipcode)
- No clear visual distinction between clickable/non-clickable
```

**Geocoding Data Quality Issue:**
When Nominatim returns data, sometimes:
- Street gets full address: "99 Myrtle Avenue Village Of Cambridge"
- City gets: "Cambridge"
- This creates duplicate/weird display

**What a Premium Archive Should Do:**
```
Address
┌────────────────────────────────────────────┐
│ 99 Myrtle Avenue                    [Map]  │
│ Village of Cambridge, NY 12816             │
│ Washington County                          │
└────────────────────────────────────────────┘
```

- Street: Clean, with "View on Map" action
- City, State, Zip: Single line, properly formatted
- County: Subtle, secondary info
- All clickable elements should be visually consistent (underline or button style)

**FIX REQUIRED:**
1. Normalize address display to consistent format
2. Make street clickable (opens map centered on address)
3. Add "Copy Address" button for full address
4. Better visual hierarchy with consistent styling

---

### ISSUE #4: ARCHIVE PHILOSOPHY VIOLATION

**Core Problem:** The app generates thumbnails and extracts GPS but doesn't USE the data effectively.

```
WHAT WE BUILD:          WHAT ACTUALLY DISPLAYS:
├── thumbnails/          --> Gray SVG placeholders
├── GPS extraction       --> "No GPS" message
├── Address geocoding    --> One-way only (GPS→Address, not Address→GPS)
└── Map component        --> Hidden when no GPS
```

**Premium Archive Principles:**
1. **ALWAYS SHOW SOMETHING** - Never blank/placeholder when data exists
2. **USE WHAT YOU HAVE** - Address exists? Show on map via geocoding
3. **GRACEFUL DEGRADATION** - No exact GPS? Show approximate. No city? Show state centroid
4. **VISUAL QUALITY** - If user can't see the images clearly, archive is useless

---

## IMPLEMENTATION PLAN (For Inexperienced Coder)

### Priority Order

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| P0 | Thumbnails not displaying | Users can't browse archive | LOW |
| P1 | Map not showing with address | Lost location context | MEDIUM |
| P2 | Address display sloppy | Poor UX | LOW |
| P3 | Thumbnail quality (HiDPI) | Blurry on modern displays | MEDIUM |

---

### FIX #1: Display Thumbnails in LocationDetail (P0)

**File:** `packages/desktop/src/pages/LocationDetail.svelte`

**Current Code (BROKEN):**
```svelte
<!-- Around line 990-1007 -->
<button onclick={() => openLightbox(actualIndex)} class="aspect-square bg-gray-100...">
  <div class="absolute inset-0 flex items-center justify-center text-gray-400">
    <svg class="w-12 h-12" ...></svg>  <!-- Only placeholder! -->
  </div>
</button>
```

**Fix Option A - Use MediaGrid component:**
```svelte
<script>
  import MediaGrid from '../components/MediaGrid.svelte';
</script>

<!-- Replace the manual grid with -->
<MediaGrid items={displayedImages.map(img => ({
  hash: img.imgsha,
  path: img.imgloc,
  name: img.imgnam,
  type: 'image',
  thumbPath: img.thumb_path,
  width: img.meta_width,
  height: img.meta_height,
}))} onSelect={openLightbox} />
```

**Fix Option B - Add img tag to existing grid:**
```svelte
<button onclick={() => openLightbox(actualIndex)} class="aspect-square bg-gray-100...">
  {#if image.thumb_path}
    <img
      src={`media://${image.thumb_path}`}
      alt={image.imgnam}
      class="w-full h-full object-cover"
      loading="lazy"
    />
  {:else}
    <div class="absolute inset-0 flex items-center justify-center text-gray-400">
      <svg class="w-12 h-12" ...></svg>
    </div>
  {/if}
</button>
```

**Verification:**
1. Import some images to a location
2. Go to location detail page
3. Images section should show actual thumbnails, not gray placeholders

---

### FIX #2: Forward Geocode Address to GPS (P1)

**Problem:** Location has address but no GPS, map doesn't show.

**Step 1: Add forward geocoding trigger**

**File:** `packages/desktop/electron/services/file-import-service.ts`
OR create new location update handler

When a location is created/updated with address but no GPS:
```typescript
// Pseudo-code for the logic
async function ensureLocationHasGPS(location: Location): Promise<void> {
  // Already has GPS? Done
  if (location.gps?.lat && location.gps?.lng) return;

  // No address? Can't geocode
  if (!location.address_city && !location.address_street) return;

  // Build address string
  const addressParts = [
    location.address_street,
    location.address_city,
    location.address_state,
    location.address_zipcode
  ].filter(Boolean);

  if (addressParts.length === 0) return;

  const addressString = addressParts.join(', ');

  // Forward geocode
  const result = await geocodingService.forwardGeocode(addressString);

  if (result?.lat && result?.lng) {
    // Update location with geocoded GPS
    await locationRepo.update(location.locid, {
      gps_lat: result.lat,
      gps_lng: result.lng,
      gps_source: 'geocoded_address',
      gps_accuracy: null,  // Unknown accuracy
    });
  }
}
```

**Step 2: Update LocationDetail to always show map**

**File:** `packages/desktop/src/pages/LocationDetail.svelte`

**Current (BROKEN):**
```svelte
{#if location.gps}
  <Map locations={[location]} />
{:else}
  <p>No GPS coordinates available</p>
{/if}
```

**Fixed:**
```svelte
<!-- Always show map - Map.svelte handles fallback to state centroid -->
{#if location.gps || location.address?.state}
  <Map locations={[location]} />
  {#if !location.gps && location.address?.state}
    <p class="text-xs text-yellow-600 mt-2">
      Showing approximate location based on state. Click "Add GPS" for exact position.
    </p>
  {/if}
{:else}
  <p>No location data available</p>
{/if}
```

**Verification:**
1. Create location with address "123 Main St, Albany, NY 12207"
2. Don't set any GPS
3. Location detail should show map (either geocoded or state centroid)

---

### FIX #3: Clean Up Address Display (P2)

**File:** `packages/desktop/src/pages/LocationDetail.svelte`

**Current mess around lines 752-783**

**Proposed clean display:**
```svelte
{#if location.address}
  <div class="mb-4">
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-medium text-gray-500">Address</h3>
      <button
        onclick={() => copyAddressToClipboard()}
        class="text-xs text-accent hover:underline"
      >
        Copy
      </button>
    </div>

    <div class="text-base text-gray-900 space-y-1">
      <!-- Street -->
      {#if location.address.street}
        <p>{location.address.street}</p>
      {/if}

      <!-- City, State ZIP - all on one line -->
      <p>
        {#if location.address.city}
          <button onclick={() => navigateToFilter('city', location.address.city)}
                  class="text-accent hover:underline">{location.address.city}</button>,{' '}
        {/if}
        {#if location.address.state}
          <button onclick={() => navigateToFilter('state', location.address.state)}
                  class="text-accent hover:underline">{location.address.state}</button>{' '}
        {/if}
        {#if location.address.zipcode}
          <span>{location.address.zipcode}</span>
        {/if}
      </p>

      <!-- County - subtle secondary info -->
      {#if location.address.county}
        <p class="text-sm text-gray-500">
          <button onclick={() => navigateToFilter('county', location.address.county)}
                  class="text-accent hover:underline">{location.address.county} County</button>
        </p>
      {/if}
    </div>
  </div>
{/if}
```

---

### FIX #4: Multi-Resolution Thumbnails (P3)

**For HiDPI displays, generate multiple sizes:**

**File:** `packages/desktop/electron/services/thumbnail-service.ts`

**Current:**
```typescript
private readonly DEFAULT_SIZE = 256;
```

**Proposed:**
```typescript
private readonly THUMBNAIL_SIZES = {
  small: 256,   // For grid view, 1x displays
  medium: 512,  // For grid view, 2x HiDPI displays
  large: 1024,  // For hero images, previews
};

async generateThumbnails(sourcePath: string, hash: string): Promise<{
  small: string | null;
  medium: string | null;
  large: string | null;
}> {
  // Generate all three sizes
  // Store paths in DB: thumb_path_256, thumb_path_512, thumb_path_1024
}
```

**Frontend update - serve appropriate size:**
```svelte
<img
  src={`media://${image.thumb_path_256}`}
  srcset={`
    media://${image.thumb_path_256} 1x,
    media://${image.thumb_path_512} 2x
  `}
  alt={image.imgnam}
/>
```

---

## Logic Flow Diagram

```
USER IMPORTS FILE
       │
       ▼
┌──────────────────────────┐
│ file-import-service.ts   │
│ 1. Hash file (SHA256)    │
│ 2. Extract EXIF metadata │
│ 3. Generate thumbnail    │◄─── thumbnail-service.ts (256px)
│ 4. Extract RAW preview   │◄─── preview-extractor-service.ts
│ 5. Copy to archive       │
│ 6. Save to database      │
│    - thumb_path          │
│    - preview_path        │
│    - meta_gps_lat/lng    │
└──────────────────────────┘
       │
       ▼
┌──────────────────────────┐
│ LocationDetail.svelte    │
│ 1. Load location         │
│ 2. Load media list       │
│ 3. Display thumbnail     │◄─── BROKEN: shows SVG, not thumb_path!
│ 4. Display map           │◄─── BROKEN: hidden if no GPS!
└──────────────────────────┘
       │
       ▼
┌──────────────────────────┐
│ MediaViewer.svelte       │
│ - Opens on thumbnail     │
│   click                  │
│ - Shows full image via   │
│   media:// protocol      │
│ - THIS PART WORKS        │
└──────────────────────────┘
```

---

## Verification Checklist

After implementing fixes, verify:

- [ ] Import 3 JPG images to a location
- [ ] Location detail shows actual thumbnail images (not gray SVGs)
- [ ] Thumbnails are crisp, not blurry
- [ ] Click thumbnail opens MediaViewer with full image
- [ ] Create location with address only (no GPS)
- [ ] Location detail shows map (even if approximate)
- [ ] Address displays cleanly with proper formatting
- [ ] City/State/County are clickable and filter correctly

---

## Changelog

| Date | Issue | Fix | Status |
|------|-------|-----|--------|
| 2025-11-23 | Thumbnails not displaying | Identified: LocationDetail doesn't render thumb_path | DOCUMENTED |
| 2025-11-23 | Map hidden when no GPS | Identified: Need forward geocode, map fallback | DOCUMENTED |
| 2025-11-23 | Address display sloppy | Identified: Inconsistent styling/interactivity | DOCUMENTED |
| 2025-11-23 | Thumbnail quality | Identified: 256px too small for HiDPI | DOCUMENTED |
