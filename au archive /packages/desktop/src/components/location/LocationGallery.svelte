<script lang="ts">
  /**
   * LocationGallery - Clean image grid with hero badge
   * Sub-accordion within Original Assets
   * Per DECISION-020: 4x2 grid, opens in MediaViewer
   * Premium UX: Accent ring hover, hero badge
   * OPT-039: Virtual scrolling for "Show All" mode with 10K+ images
   */
  import type { MediaImage } from './types';
  import { thumbnailCache } from '../../stores/thumbnail-cache-store';
  import { createVirtualizer } from '@tanstack/svelte-virtual';

  interface Props {
    images: MediaImage[];
    heroImghash: string | null;
    onOpenLightbox: (index: number) => void;
    label?: string;  // Custom label, defaults to "Images"
  }

  let { images, heroImghash, onOpenLightbox, label = "Images" }: Props = $props();

  const IMAGE_LIMIT = 8; // 4x2 grid for preview
  const COLUMNS = 4; // Grid columns for virtual mode
  const ROW_HEIGHT = 140; // Height of each row in pixels (aspect ratio ~1.618:1)
  const VIRTUAL_THRESHOLD = 100; // Use virtual scrolling above this count

  let isOpen = $state(true); // Expanded by default when parent opens
  let showAllImages = $state(false);
  let scrollContainerRef = $state<HTMLDivElement | null>(null);

  // Determine if we should use virtual scrolling
  const useVirtual = $derived(showAllImages && images.length > VIRTUAL_THRESHOLD);

  // For virtual mode: calculate number of rows needed
  const rowCount = $derived(Math.ceil(images.length / COLUMNS));

  // Reactive state for virtual scrolling
  let virtualItems = $state<{ index: number; start: number; size: number }[]>([]);
  let totalSize = $state(0);

  // Create and subscribe to virtualizer when dependencies change
  $effect(() => {
    if (!useVirtual) {
      virtualItems = [];
      totalSize = 0;
      return;
    }

    const container = scrollContainerRef;
    // Guard: Don't create virtualizer until scroll container is mounted
    if (!container) {
      virtualItems = [];
      totalSize = 0;
      return;
    }

    const store = createVirtualizer({
      count: rowCount,
      getScrollElement: () => container,
      estimateSize: () => ROW_HEIGHT,
      overscan: 3,
    });

    const unsub = store.subscribe((v) => {
      virtualItems = v.getVirtualItems();
      totalSize = v.getTotalSize();
    });

    return unsub;
  });

  // For non-virtual mode: display limited images
  const displayedImages = $derived(showAllImages ? images : images.slice(0, IMAGE_LIMIT));

  // OPT-036: Pre-compute index map for O(1) lookups
  const imageIndexMap = $derived(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < images.length; i++) {
      map.set(images[i].imghash, i);
    }
    return map;
  });

  // Get images for a specific row (for virtual mode)
  function getRowImages(rowIndex: number): { image: MediaImage; globalIndex: number }[] {
    const startIdx = rowIndex * COLUMNS;
    const rowImages: { image: MediaImage; globalIndex: number }[] = [];
    for (let col = 0; col < COLUMNS; col++) {
      const idx = startIdx + col;
      if (idx < images.length) {
        rowImages.push({ image: images[idx], globalIndex: idx });
      }
    }
    return rowImages;
  }

  // Cache-bust param to force reload after thumbnail regeneration
  const cacheVersion = $derived($thumbnailCache);
</script>

{#if images.length > 0}
  <div class="border-b border-braun-200 last:border-b-0">
    <!-- Sub-accordion header -->
    <button
      onclick={() => isOpen = !isOpen}
      aria-expanded={isOpen}
      class="w-full py-3 flex items-center justify-between text-left hover:bg-braun-100 transition-colors"
    >
      <h3 class="text-sm font-medium text-braun-900">{label} ({images.length})</h3>
      <svg
        class="w-4 h-4 text-braun-400 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    {#if isOpen}
      <div class="pb-4">
        {#if useVirtual && virtualItems.length > 0}
          <!-- OPT-039: Virtual scrolling grid for large collections -->
          <div
            bind:this={scrollContainerRef}
            class="overflow-auto rounded"
            style="height: 500px; max-height: 60vh;"
          >
            <div
              style="height: {totalSize}px; width: 100%; position: relative;"
            >
              {#each virtualItems as virtualRow (virtualRow.index)}
                <div
                  class="grid grid-cols-2 md:grid-cols-4 gap-3 absolute top-0 left-0 w-full px-0.5"
                  style="height: {virtualRow.size}px; transform: translateY({virtualRow.start}px);"
                >
                  {#each getRowImages(virtualRow.index) as { image, globalIndex }}
                    {@const isHero = heroImghash === image.imghash}
                    <button
                      onclick={() => onOpenLightbox(globalIndex)}
                      class="image-card aspect-[1.618/1] bg-braun-100 rounded overflow-hidden relative group"
                    >
                      {#if image.thumb_path_sm || image.thumb_path}
                        <!-- OPT-110: Fade-in transition for smooth image loading -->
                        <img
                          src={`media://${image.thumb_path_sm || image.thumb_path}?v=${cacheVersion}`}
                          srcset={`
                            media://${image.thumb_path_sm || image.thumb_path}?v=${cacheVersion} 1x
                            ${image.thumb_path_lg ? `, media://${image.thumb_path_lg}?v=${cacheVersion} 2x` : ''}
                          `}
                          alt={image.imgnam}
                          loading="lazy"
                          class="w-full h-full object-cover opacity-0 transition-opacity duration-200"
                          onload={(e) => e.currentTarget.classList.remove('opacity-0')}
                        />
                      {:else}
                        <div class="absolute inset-0 flex items-center justify-center text-braun-400">
                          <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      {/if}

                      <!-- Hero badge -->
                      {#if isHero}
                        <div class="absolute top-2 left-2 px-2 py-0.5 bg-braun-900 text-white text-xs font-medium rounded">
                          Hero
                        </div>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/each}
            </div>
          </div>
        {:else}
          <!-- Standard grid (non-virtual) for preview or smaller collections -->
          <!-- OPT-110: Keyed by imghash to prevent DOM thrashing on array updates -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            {#each displayedImages as image (image.imghash)}
              {@const actualIndex = imageIndexMap().get(image.imghash) ?? 0}
              {@const isHero = heroImghash === image.imghash}
              <button
                onclick={() => onOpenLightbox(actualIndex)}
                class="image-card aspect-[1.618/1] bg-braun-100 rounded overflow-hidden relative group"
              >
                {#if image.thumb_path_sm || image.thumb_path}
                  <!-- OPT-110: Fade-in transition for smooth image loading -->
                  <img
                    src={`media://${image.thumb_path_sm || image.thumb_path}?v=${cacheVersion}`}
                    srcset={`
                      media://${image.thumb_path_sm || image.thumb_path}?v=${cacheVersion} 1x
                      ${image.thumb_path_lg ? `, media://${image.thumb_path_lg}?v=${cacheVersion} 2x` : ''}
                    `}
                    alt={image.imgnam}
                    loading="lazy"
                    class="w-full h-full object-cover opacity-0 transition-opacity duration-200"
                    onload={(e) => e.currentTarget.classList.remove('opacity-0')}
                  />
                {:else}
                  <div class="absolute inset-0 flex items-center justify-center text-braun-400">
                    <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                {/if}

                <!-- Hero badge -->
                {#if isHero}
                  <div class="absolute top-2 left-2 px-2 py-0.5 bg-braun-900 text-white text-xs font-medium rounded">
                    Hero
                  </div>
                {/if}
              </button>
            {/each}
          </div>
        {/if}

        <!-- Show more/less toggle -->
        {#if images.length > IMAGE_LIMIT}
          <div class="mt-3 text-center">
            <button
              onclick={() => showAllImages = !showAllImages}
              class="text-sm text-braun-900 hover:underline"
            >
              {showAllImages ? 'Show Less' : `Show All (${images.length - IMAGE_LIMIT} more)`}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Premium hover effect - Braun design system */
  .image-card {
    transition: transform 200ms ease, border-color 200ms ease;
    border: 2px solid transparent;
  }

  .image-card:hover {
    transform: scale(1.02);
    border-color: #1C1C1A; /* braun-900 */
  }
</style>
