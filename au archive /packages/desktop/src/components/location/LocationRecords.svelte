<script lang="ts">
  /**
   * LocationRecords - "Records" accordion wrapper for all media types
   * Contains: Images, Web Images, Videos, Web Videos, Websites, Documents
   * Per DECISION-020: Original Assets Accordion Refactor (renamed to "Records")
   * Migration 23: Hidden media filtering with "Show All" toggle
   * FIX: Auto-expand when web sources saved from browser extension (Rule 9)
   */
  import { onMount } from 'svelte';
  import LocationGallery from './LocationGallery.svelte';
  import LocationVideos from './LocationVideos.svelte';
  import LocationDocuments from './LocationDocuments.svelte';
  import LocationWebSources from './LocationWebSources.svelte';
  import type { MediaImage, MediaVideo, MediaDocument } from './types';

  interface Props {
    images: MediaImage[];
    videos: MediaVideo[];
    documents: MediaDocument[];
    heroImgsha: string | null;
    locid: string;
    onOpenImageLightbox: (index: number) => void;
    onOpenVideoLightbox: (index: number) => void;
    onOpenDocument: (path: string) => void;
    onOpenSource: (url: string) => void;
  }

  let {
    images,
    videos,
    documents,
    heroImgsha,
    locid,
    onOpenImageLightbox,
    onOpenVideoLightbox,
    onOpenDocument,
    onOpenSource,
  }: Props = $props();

  // Outer accordion - collapsed by default (user can expand if wanted)
  let isOpen = $state(false);

  // Hidden media toggle - show all vs visible only
  let showHidden = $state(false);

  // FIX: Track new web sources for visual indicator
  let hasNewWebSources = $state(false);

  // FIX: Export function to expand and scroll to websites section
  export function expandAndScrollToWebsources() {
    isOpen = true;
    hasNewWebSources = false;
    // Scroll to websources section after DOM update
    setTimeout(() => {
      document.getElementById('websources-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  // FIX: Listen for web sources saved from browser extension (Rule 9)
  onMount(() => {
    const unsubscribe = window.electronAPI?.websources?.onWebSourceSaved?.((payload) => {
      if (payload.locid === locid) {
        // Auto-expand and show indicator
        hasNewWebSources = true;
        isOpen = true;
        // Scroll to websources section
        setTimeout(() => {
          document.getElementById('websources-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  });

  // Split images by source: user-uploaded vs web-extracted
  const userImages = $derived(images.filter(i => i.extracted_from_web !== 1));
  const webImages = $derived(images.filter(i => i.extracted_from_web === 1));

  // Split videos by source: user-uploaded vs web-extracted
  const userVideos = $derived(videos.filter(v => v.extracted_from_web !== 1));
  const webVideos = $derived(videos.filter(v => v.extracted_from_web === 1));

  // Calculate hidden counts (user media only)
  const hiddenUserImageCount = $derived(userImages.filter(i => i.hidden === 1).length);
  const hiddenUserVideoCount = $derived(userVideos.filter(v => v.hidden === 1).length);
  const hiddenWebImageCount = $derived(webImages.filter(i => i.hidden === 1).length);
  const hiddenWebVideoCount = $derived(webVideos.filter(v => v.hidden === 1).length);
  const hiddenDocCount = $derived(documents.filter(d => d.hidden === 1).length);
  const totalHiddenCount = $derived(
    hiddenUserImageCount + hiddenUserVideoCount +
    hiddenWebImageCount + hiddenWebVideoCount +
    hiddenDocCount
  );

  // Filtered user media respecting hidden toggle
  const visibleUserImages = $derived(
    showHidden ? userImages : userImages.filter(i => i.hidden !== 1)
  );
  const visibleWebImages = $derived(
    showHidden ? webImages : webImages.filter(i => i.hidden !== 1)
  );
  const visibleUserVideos = $derived(
    showHidden ? userVideos : userVideos.filter(v => v.hidden !== 1)
  );
  const visibleWebVideos = $derived(
    showHidden ? webVideos : webVideos.filter(v => v.hidden !== 1)
  );
  const visibleDocuments = $derived(
    showHidden ? documents : documents.filter(d => d.hidden !== 1)
  );

  // Calculate total visible media count
  const visibleCount = $derived(
    visibleUserImages.length + visibleWebImages.length +
    visibleUserVideos.length + visibleWebVideos.length +
    visibleDocuments.length
  );
  const totalCount = $derived(
    userImages.length + webImages.length +
    userVideos.length + webVideos.length +
    documents.length
  );

  // OPT-036: Pre-compute index maps for O(1) lookups instead of O(n) findIndex
  const userImageIndexMap = $derived(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < userImages.length; i++) {
      map.set(userImages[i].imghash, i);
    }
    return map;
  });

  const webImageIndexMap = $derived(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < webImages.length; i++) {
      map.set(webImages[i].imghash, i);
    }
    return map;
  });

  const userVideoIndexMap = $derived(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < userVideos.length; i++) {
      map.set(userVideos[i].vidhash, i);
    }
    return map;
  });

  const webVideoIndexMap = $derived(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < webVideos.length; i++) {
      map.set(webVideos[i].vidhash, i);
    }
    return map;
  });

  // Map visible index to original index for lightbox callback
  function getUserImageOriginalIndex(visibleIndex: number): number {
    if (showHidden) return visibleIndex;
    const visibleItem = visibleUserImages[visibleIndex];
    return userImageIndexMap().get(visibleItem.imghash) ?? visibleIndex;
  }

  function getWebImageOriginalIndex(visibleIndex: number): number {
    if (showHidden) return visibleIndex;
    const visibleItem = visibleWebImages[visibleIndex];
    // Offset by user images length for combined lightbox
    return userImages.length + (webImageIndexMap().get(visibleItem.imghash) ?? visibleIndex);
  }

  function getUserVideoOriginalIndex(visibleIndex: number): number {
    if (showHidden) return visibleIndex;
    const visibleItem = visibleUserVideos[visibleIndex];
    return userVideoIndexMap().get(visibleItem.vidhash) ?? visibleIndex;
  }

  function getWebVideoOriginalIndex(visibleIndex: number): number {
    if (showHidden) return visibleIndex;
    const visibleItem = visibleWebVideos[visibleIndex];
    // Offset by user videos length for combined lightbox
    return userVideos.length + (webVideoIndexMap().get(visibleItem.vidhash) ?? visibleIndex);
  }
</script>

<div class="mt-6 bg-white rounded border border-braun-300">
  <!-- Outer accordion header -->
  <button
    onclick={() => isOpen = !isOpen}
    aria-expanded={isOpen}
    class="w-full p-6 flex items-center justify-between text-left hover:bg-braun-100 transition-colors"
  >
    <h2 class="text-xl font-semibold text-braun-900 flex items-center gap-2">
      Records
      <span class="text-base font-normal text-braun-400">
        ({visibleCount}{totalHiddenCount > 0 && !showHidden ? ` of ${totalCount}` : ''})
      </span>
      {#if hasNewWebSources}
        <span class="px-2 py-0.5 text-xs bg-green-500 text-white rounded-full animate-pulse">
          New
        </span>
      {/if}
    </h2>
    <svg
      class="w-5 h-5 text-braun-400 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if isOpen}
    <div class="px-6 pb-6 space-y-2">
      <!-- Filter toggles -->
      {#if totalHiddenCount > 0}
        <div class="flex items-center justify-end gap-2 mb-2 flex-wrap">
          <!-- Show All toggle when there are hidden items -->
            <button
              onclick={() => showHidden = !showHidden}
              class="text-sm flex items-center gap-2 px-3 py-1.5 rounded transition-colors {showHidden ? 'bg-braun-200 text-braun-900' : 'bg-braun-100 text-braun-600 hover:bg-braun-200'}"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {#if showHidden}
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                {:else}
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                {/if}
              </svg>
              {showHidden ? 'Showing All' : `Show All (${totalHiddenCount} hidden)`}
            </button>
        </div>
      {/if}

      <!-- 1. Images (user only) -->
      <LocationGallery
        images={visibleUserImages}
        {heroImgsha}
        onOpenLightbox={(i) => onOpenImageLightbox(getUserImageOriginalIndex(i))}
      />

      <!-- 2. Web Images -->
      <LocationGallery
        images={visibleWebImages}
        heroImgsha={null}
        label="Web Images"
        onOpenLightbox={(i) => onOpenImageLightbox(getWebImageOriginalIndex(i))}
      />

      <!-- 3. Videos (user only) -->
      <LocationVideos
        videos={visibleUserVideos}
        onOpenLightbox={(i) => onOpenVideoLightbox(getUserVideoOriginalIndex(i))}
      />

      <!-- 4. Web Videos -->
      <LocationVideos
        videos={visibleWebVideos}
        label="Web Videos"
        onOpenLightbox={(i) => onOpenVideoLightbox(getWebVideoOriginalIndex(i))}
      />

      <!-- 5. Websites (archived web sources) -->
      <div id="websources-section">
        <LocationWebSources
          {locid}
          {onOpenSource}
        />
      </div>

      <!-- 6. Documents -->
      <LocationDocuments
        documents={visibleDocuments}
        onOpenFile={onOpenDocument}
      />
    </div>
  {/if}
</div>
