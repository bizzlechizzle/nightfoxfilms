# Implementation Guide: Original Assets Accordion

This guide walks through implementing the Original Assets accordion feature for the Abandoned Archive desktop app. Follow each step in order.

## Prerequisites

- Familiarity with Svelte 5 ($state, $derived, $props)
- Understanding of Tailwind CSS
- Access to the codebase at `packages/desktop/src/`

## Overview

We're converting the flat media display into a nested accordion structure:

```
Original Assets [collapsed by default]
├── Images (N)     [accordion, 4x2 grid]
├── Videos (N)     [accordion, 4x2 grid, opens in MediaViewer]
└── Documents (N)  [accordion, list format]
```

---

## Step 1: Test Video Format Support

Before coding, test what formats Electron 28 plays natively.

**Create test file:** `packages/desktop/src/components/VideoFormatTest.svelte`

```svelte
<script lang="ts">
  // Quick test component - DELETE after testing
  const testVideos = [
    { format: 'MP4', path: '/path/to/test.mp4' },
    { format: 'MKV', path: '/path/to/test.mkv' },
    { format: 'AVI', path: '/path/to/test.avi' },
    { format: 'MOV', path: '/path/to/test.mov' },
  ];
</script>

<div class="p-8 space-y-4">
  <h1 class="text-xl font-bold">Video Format Test</h1>
  {#each testVideos as video}
    <div class="border p-4">
      <h2>{video.format}</h2>
      <video src={`media://${video.path}`} controls class="w-64" />
    </div>
  {/each}
</div>
```

**Result:** Note which formats play. This determines if we need mpv.js later.

---

## Step 2: Create LocationOriginalAssets.svelte

**File:** `packages/desktop/src/components/location/LocationOriginalAssets.svelte`

This is the outer wrapper with the "Original Assets" accordion.

```svelte
<script lang="ts">
  /**
   * LocationOriginalAssets - Accordion wrapper for all media types
   * Contains Images, Videos, Documents sub-accordions
   */
  import LocationGallery from './LocationGallery.svelte';
  import LocationVideos from './LocationVideos.svelte';
  import LocationDocuments from './LocationDocuments.svelte';
  import type { MediaImage, MediaVideo, MediaDocument } from './types';

  interface Props {
    images: MediaImage[];
    videos: MediaVideo[];
    documents: MediaDocument[];
    heroImgsha: string | null;
    onOpenImageLightbox: (index: number) => void;
    onOpenVideoLightbox: (index: number) => void;
    onSetHeroImage: (imgsha: string) => void;
    onOpenDocument: (path: string) => void;
  }

  let {
    images,
    videos,
    documents,
    heroImgsha,
    onOpenImageLightbox,
    onOpenVideoLightbox,
    onSetHeroImage,
    onOpenDocument,
  }: Props = $props();

  // Outer accordion - collapsed by default (user can expand if wanted)
  let isOpen = $state(false);

  // Calculate total media count
  const totalCount = $derived(images.length + videos.length + documents.length);
</script>

<div class="mt-6 bg-white rounded-lg shadow">
  <!-- Outer accordion header -->
  <button
    onclick={() => isOpen = !isOpen}
    aria-expanded={isOpen}
    class="w-full p-6 flex items-center justify-between text-left hover:bg-gray-50 transition-colors rounded-lg"
  >
    <h2 class="text-xl font-semibold text-foreground">
      Original Assets
      <span class="text-base font-normal text-gray-400 ml-2">({totalCount})</span>
    </h2>
    <svg
      class="w-5 h-5 text-gray-400 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if isOpen}
    <div class="px-6 pb-6 space-y-2">
      <LocationGallery
        {images}
        {heroImgsha}
        onOpenLightbox={onOpenImageLightbox}
        onSetHeroImage={onSetHeroImage}
      />
      <LocationVideos
        {videos}
        onOpenLightbox={onOpenVideoLightbox}
      />
      <LocationDocuments
        {documents}
        onOpenFile={onOpenDocument}
      />
    </div>
  {/if}
</div>
```

**Key points:**
- `isOpen = $state(false)` - collapsed by default
- Passes separate callbacks for images vs videos (both open lightbox but at different indices)
- Documents keep `onOpenFile` for system viewer

---

## Step 3: Update LocationGallery.svelte

**File:** `packages/desktop/src/components/location/LocationGallery.svelte`

Changes:
1. Add sub-accordion toggle
2. Change IMAGE_LIMIT from 6 to 8
3. Remove outer margin/container (parent handles it)

**Find and replace the entire file with:**

```svelte
<script lang="ts">
  /**
   * LocationGallery - Image grid with hero selection
   * Sub-accordion within Original Assets
   */
  import type { MediaImage } from './types';
  import { formatResolution } from './types';

  interface Props {
    images: MediaImage[];
    heroImgsha: string | null;
    onOpenLightbox: (index: number) => void;
    onSetHeroImage: (imgsha: string) => void;
  }

  let { images, heroImgsha, onOpenLightbox, onSetHeroImage }: Props = $props();

  const IMAGE_LIMIT = 8; // 4x2 grid
  let isOpen = $state(true); // Expanded by default when parent opens
  let showAllImages = $state(false);

  const displayedImages = $derived(showAllImages ? images : images.slice(0, IMAGE_LIMIT));
</script>

{#if images.length > 0}
  <div class="border-b border-gray-100 last:border-b-0">
    <!-- Sub-accordion header -->
    <button
      onclick={() => isOpen = !isOpen}
      aria-expanded={isOpen}
      class="w-full py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
    >
      <h3 class="text-sm font-medium text-gray-700">Images ({images.length})</h3>
      <svg
        class="w-4 h-4 text-gray-400 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    {#if isOpen}
      <div class="pb-4">
        <!-- Hero hint -->
        <p class="text-xs text-gray-400 mb-3">Hover any image to set as hero</p>

        <!-- 4x2 Grid -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          {#each displayedImages as image, displayIndex}
            {@const actualIndex = images.findIndex(img => img.imgsha === image.imgsha)}
            {@const isHero = heroImgsha === image.imgsha}
            <div class="aspect-square bg-gray-100 rounded overflow-hidden relative group">
              <button
                onclick={() => onOpenLightbox(actualIndex)}
                class="w-full h-full hover:opacity-90 transition"
              >
                {#if image.thumb_path_sm || image.thumb_path}
                  <img
                    src={`media://${image.thumb_path_sm || image.thumb_path}`}
                    srcset={`
                      media://${image.thumb_path_sm || image.thumb_path} 1x
                      ${image.thumb_path_lg ? `, media://${image.thumb_path_lg} 2x` : ''}
                    `}
                    alt={image.imgnam}
                    loading="lazy"
                    class="w-full h-full object-cover"
                  />
                {:else}
                  <div class="absolute inset-0 flex items-center justify-center text-gray-400">
                    <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                {/if}
              </button>
              <!-- Hero badge/button -->
              <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition">
                {#if isHero}
                  <span class="px-2 py-1 bg-accent text-white text-xs rounded shadow">Hero</span>
                {:else}
                  <button
                    onclick={(e) => { e.stopPropagation(); onSetHeroImage(image.imgsha); }}
                    class="px-2 py-1 bg-black/60 text-white text-xs rounded hover:bg-black/80 shadow"
                  >
                    Set Hero
                  </button>
                {/if}
              </div>
              <!-- Resolution overlay -->
              <div class="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1.5 opacity-0 group-hover:opacity-100 transition">
                {#if image.meta_width && image.meta_height}
                  {formatResolution(image.meta_width, image.meta_height)}
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <!-- Show more -->
        {#if images.length > IMAGE_LIMIT}
          <div class="mt-3 text-center">
            <button
              onclick={() => showAllImages = !showAllImages}
              class="text-sm text-accent hover:underline"
            >
              {showAllImages ? 'Show Less' : `Show All (${images.length - IMAGE_LIMIT} more)`}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
```

---

## Step 4: Update LocationVideos.svelte

**File:** `packages/desktop/src/components/location/LocationVideos.svelte`

Major changes:
1. Add sub-accordion toggle
2. Change from list to 4x2 thumbnail grid
3. Change `onOpenFile` to `onOpenLightbox`
4. Change VIDEO_LIMIT from 3 to 8

```svelte
<script lang="ts">
  /**
   * LocationVideos - Video thumbnail grid
   * Sub-accordion within Original Assets
   * Opens in MediaViewer (not system viewer)
   */
  import type { MediaVideo } from './types';
  import { formatDuration, formatResolution } from './types';

  interface Props {
    videos: MediaVideo[];
    onOpenLightbox: (index: number) => void;
  }

  let { videos, onOpenLightbox }: Props = $props();

  const VIDEO_LIMIT = 8; // 4x2 grid
  let isOpen = $state(true); // Expanded by default
  let showAllVideos = $state(false);

  const displayedVideos = $derived(showAllVideos ? videos : videos.slice(0, VIDEO_LIMIT));
</script>

{#if videos.length > 0}
  <div class="border-b border-gray-100 last:border-b-0">
    <!-- Sub-accordion header -->
    <button
      onclick={() => isOpen = !isOpen}
      aria-expanded={isOpen}
      class="w-full py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
    >
      <h3 class="text-sm font-medium text-gray-700">Videos ({videos.length})</h3>
      <svg
        class="w-4 h-4 text-gray-400 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    {#if isOpen}
      <div class="pb-4">
        <!-- 4x2 Grid -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          {#each displayedVideos as video, displayIndex}
            {@const actualIndex = videos.findIndex(v => v.vidsha === video.vidsha)}
            <div class="aspect-video bg-gray-100 rounded overflow-hidden relative group">
              <button
                onclick={() => onOpenLightbox(actualIndex)}
                class="w-full h-full hover:opacity-90 transition"
              >
                {#if video.thumb_path_sm || video.thumb_path}
                  <img
                    src={`media://${video.thumb_path_sm || video.thumb_path}`}
                    alt={video.vidnam}
                    loading="lazy"
                    class="w-full h-full object-cover"
                  />
                {:else}
                  <!-- Fallback: video icon -->
                  <div class="absolute inset-0 flex items-center justify-center text-gray-400 bg-gray-200">
                    <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                {/if}
                <!-- Play button overlay -->
                <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                  <div class="w-12 h-12 bg-black/60 rounded-full flex items-center justify-center">
                    <svg class="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              </button>
              <!-- Duration/resolution overlay -->
              <div class="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1.5">
                <span>{formatDuration(video.meta_duration)}</span>
                {#if video.meta_width && video.meta_height}
                  <span class="ml-2">{formatResolution(video.meta_width, video.meta_height)}</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <!-- Show more -->
        {#if videos.length > VIDEO_LIMIT}
          <div class="mt-3 text-center">
            <button
              onclick={() => showAllVideos = !showAllVideos}
              class="text-sm text-accent hover:underline"
            >
              {showAllVideos ? 'Show Less' : `Show All (${videos.length - VIDEO_LIMIT} more)`}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
```

---

## Step 5: Update LocationDocuments.svelte

**File:** `packages/desktop/src/components/location/LocationDocuments.svelte`

Changes:
1. Add sub-accordion toggle
2. Keep list format
3. Keep system viewer opening

```svelte
<script lang="ts">
  /**
   * LocationDocuments - Document list
   * Sub-accordion within Original Assets
   * Opens in system viewer (best tool for job)
   */
  import type { MediaDocument } from './types';

  interface Props {
    documents: MediaDocument[];
    onOpenFile: (path: string) => void;
  }

  let { documents, onOpenFile }: Props = $props();

  const DOCUMENT_LIMIT = 5;
  let isOpen = $state(true); // Expanded by default
  let showAllDocuments = $state(false);

  const displayedDocuments = $derived(showAllDocuments ? documents : documents.slice(0, DOCUMENT_LIMIT));

  // Get file extension for icon display
  function getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toUpperCase() || 'DOC';
  }
</script>

{#if documents.length > 0}
  <div class="border-b border-gray-100 last:border-b-0">
    <!-- Sub-accordion header -->
    <button
      onclick={() => isOpen = !isOpen}
      aria-expanded={isOpen}
      class="w-full py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
    >
      <h3 class="text-sm font-medium text-gray-700">Documents ({documents.length})</h3>
      <svg
        class="w-4 h-4 text-gray-400 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    {#if isOpen}
      <div class="pb-4 space-y-2">
        {#each displayedDocuments as doc}
          <button
            onclick={() => onOpenFile(doc.docloc)}
            class="w-full flex items-center gap-3 p-3 bg-gray-50 rounded hover:bg-gray-100 transition text-left"
          >
            <!-- File type badge -->
            <div class="w-10 h-10 bg-gray-200 rounded flex items-center justify-center text-xs font-medium text-gray-600">
              {getFileExtension(doc.docnam)}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-900 truncate">{doc.docnam}</p>
            </div>
            <!-- External link icon -->
            <svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        {/each}

        <!-- Show more -->
        {#if documents.length > DOCUMENT_LIMIT}
          <div class="mt-3 text-center">
            <button
              onclick={() => showAllDocuments = !showAllDocuments}
              class="text-sm text-accent hover:underline"
            >
              {showAllDocuments ? 'Show Less' : `Show All (${documents.length - DOCUMENT_LIMIT} more)`}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
```

---

## Step 6: Update Export Barrel

**File:** `packages/desktop/src/components/location/index.ts`

Add the new component:

```typescript
export { default as LocationOriginalAssets } from './LocationOriginalAssets.svelte';
```

---

## Step 7: Update LocationDetail.svelte

**File:** `packages/desktop/src/pages/LocationDetail.svelte`

### 7.1 Update imports

Find:
```typescript
import {
  LocationHero, LocationInfo,
  LocationMapSection, LocationGallery, LocationVideos, LocationDocuments,
```

Replace with:
```typescript
import {
  LocationHero, LocationInfo,
  LocationMapSection, LocationOriginalAssets,
```

### 7.2 Update mediaViewerList to include videos

Find:
```typescript
const mediaViewerList = $derived(images.map(img => ({
  hash: img.imgsha, path: img.imgloc,
  thumbPath: img.thumb_path_sm || img.thumb_path || null,
  previewPath: img.preview_path || null, type: 'image' as const,
  name: img.imgnam, width: img.meta_width, height: img.meta_height,
  dateTaken: img.meta_date_taken, cameraMake: img.meta_camera_make || null,
  cameraModel: img.meta_camera_model || null,
  gpsLat: img.meta_gps_lat || null, gpsLng: img.meta_gps_lng || null,
})));
```

Replace with:
```typescript
// Combined media list for viewer (images first, then videos)
const imageMediaList = $derived(images.map(img => ({
  hash: img.imgsha, path: img.imgloc,
  thumbPath: img.thumb_path_sm || img.thumb_path || null,
  previewPath: img.preview_path || null, type: 'image' as const,
  name: img.imgnam, width: img.meta_width, height: img.meta_height,
  dateTaken: img.meta_date_taken, cameraMake: img.meta_camera_make || null,
  cameraModel: img.meta_camera_model || null,
  gpsLat: img.meta_gps_lat || null, gpsLng: img.meta_gps_lng || null,
})));

const videoMediaList = $derived(videos.map(vid => ({
  hash: vid.vidsha, path: vid.vidloc,
  thumbPath: vid.thumb_path_sm || vid.thumb_path || null,
  previewPath: null, type: 'video' as const,
  name: vid.vidnam, width: vid.meta_width, height: vid.meta_height,
  dateTaken: vid.meta_date_taken, cameraMake: null, cameraModel: null,
  gpsLat: vid.meta_gps_lat || null, gpsLng: vid.meta_gps_lng || null,
})));

const mediaViewerList = $derived([...imageMediaList, ...videoMediaList]);
```

### 7.3 Rename selectedImageIndex

Find all occurrences of `selectedImageIndex` and replace with `selectedMediaIndex`.

### 7.4 Add video lightbox handler

Add this function:
```typescript
function openVideoLightbox(videoIndex: number) {
  // Videos come after images in mediaViewerList
  selectedMediaIndex = images.length + videoIndex;
}
```

### 7.5 Replace media components section

Find:
```svelte
<div class="mt-6 bg-white rounded-lg shadow-md p-6">
  <LocationGallery {images} heroImgsha={location.hero_imgsha || null}
    onOpenLightbox={(i) => selectedImageIndex = i} onSetHeroImage={setHeroImage} />
  <LocationVideos {videos} onOpenFile={openMediaFile} />
  <LocationDocuments {documents} onOpenFile={openMediaFile} />
</div>
```

Replace with:
```svelte
<LocationOriginalAssets
  {images}
  {videos}
  {documents}
  heroImgsha={location.hero_imgsha || null}
  onOpenImageLightbox={(i) => selectedMediaIndex = i}
  onOpenVideoLightbox={openVideoLightbox}
  onSetHeroImage={setHeroImage}
  onOpenDocument={openMediaFile}
/>
```

### 7.6 Update MediaViewer condition

Find:
```svelte
{#if selectedImageIndex !== null && mediaViewerList.length > 0}
  <MediaViewer mediaList={mediaViewerList} startIndex={selectedImageIndex} onClose={() => selectedImageIndex = null} />
{/if}
```

Replace with:
```svelte
{#if selectedMediaIndex !== null && mediaViewerList.length > 0}
  <MediaViewer mediaList={mediaViewerList} startIndex={selectedMediaIndex} onClose={() => selectedMediaIndex = null} />
{/if}
```

---

## Step 8: Test

1. Run `pnpm dev`
2. Navigate to a location with images, videos, and documents
3. Verify:
   - [ ] "Original Assets" accordion collapses/expands
   - [ ] Sub-accordions work independently
   - [ ] Image grid displays 4x2
   - [ ] Video grid displays 4x2 with poster thumbnails
   - [ ] Document list displays
   - [ ] Clicking image opens MediaViewer
   - [ ] Clicking video opens MediaViewer and plays
   - [ ] Clicking document opens in system viewer
   - [ ] "Show More" works for each section
   - [ ] Hero selection still works

---

## Troubleshooting

### Video doesn't play in MediaViewer
- Check format (MP4/WebM should work)
- Use "Open in System Viewer" button for unsupported formats
- Check console for errors

### Thumbnails not showing for videos
- Ensure poster frames were generated during import
- Check `thumb_path_sm` field in database for video records

### Accordion state issues
- Verify `$state()` is used correctly
- Check that `aria-expanded` matches `isOpen` state

---

## Files Changed Summary

| File | Action |
|------|--------|
| `LocationOriginalAssets.svelte` | Created |
| `LocationGallery.svelte` | Modified (accordion + 8 limit) |
| `LocationVideos.svelte` | Modified (accordion + grid + MediaViewer) |
| `LocationDocuments.svelte` | Modified (accordion) |
| `location/index.ts` | Modified (export) |
| `LocationDetail.svelte` | Modified (integration) |
