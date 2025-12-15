<script lang="ts">
  /**
   * LocationVideos - Clean video thumbnail grid
   * Sub-accordion within Original Assets
   * Per DECISION-020: 4x2 grid, opens in MediaViewer
   * Premium UX: Accent ring hover, play overlay
   * OPT-039: Virtual scrolling for "Show All" mode with large video collections
   */
  import type { MediaVideo } from './types';
  import { formatDuration } from './types';
  import { thumbnailCache } from '../../stores/thumbnail-cache-store';
  import { createVirtualizer } from '@tanstack/svelte-virtual';

  interface Props {
    videos: MediaVideo[];
    onOpenLightbox: (index: number) => void;
    label?: string;  // Custom label, defaults to "Videos"
  }

  let { videos, onOpenLightbox, label = "Videos" }: Props = $props();

  const VIDEO_LIMIT = 8; // 4x2 grid for preview
  const COLUMNS = 4; // Grid columns for virtual mode
  const ROW_HEIGHT = 140; // Height of each row in pixels
  const VIRTUAL_THRESHOLD = 100; // Use virtual scrolling above this count

  let isOpen = $state(true); // Expanded by default
  let showAllVideos = $state(false);
  let scrollContainerRef = $state<HTMLDivElement | null>(null);

  // Determine if we should use virtual scrolling
  const useVirtual = $derived(showAllVideos && videos.length > VIRTUAL_THRESHOLD);

  // For virtual mode: calculate number of rows needed
  const rowCount = $derived(Math.ceil(videos.length / COLUMNS));

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

  const displayedVideos = $derived(showAllVideos ? videos : videos.slice(0, VIDEO_LIMIT));

  // OPT-036: Pre-compute index map for O(1) lookups
  const videoIndexMap = $derived(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < videos.length; i++) {
      map.set(videos[i].vidhash, i);
    }
    return map;
  });

  // Get videos for a specific row (for virtual mode)
  function getRowVideos(rowIndex: number): { video: MediaVideo; globalIndex: number }[] {
    const startIdx = rowIndex * COLUMNS;
    const rowVideos: { video: MediaVideo; globalIndex: number }[] = [];
    for (let col = 0; col < COLUMNS; col++) {
      const idx = startIdx + col;
      if (idx < videos.length) {
        rowVideos.push({ video: videos[idx], globalIndex: idx });
      }
    }
    return rowVideos;
  }

  // Cache-bust param to force reload after thumbnail regeneration
  const cacheVersion = $derived($thumbnailCache);
</script>

{#if videos.length > 0}
  <div class="border-b border-braun-200 last:border-b-0">
    <!-- Sub-accordion header -->
    <button
      onclick={() => isOpen = !isOpen}
      aria-expanded={isOpen}
      class="w-full py-3 flex items-center justify-between text-left hover:bg-braun-100 transition-colors"
    >
      <h3 class="text-sm font-medium text-braun-900">{label} ({videos.length})</h3>
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
                  {#each getRowVideos(virtualRow.index) as { video, globalIndex }}
                    <button
                      onclick={() => onOpenLightbox(globalIndex)}
                      class="video-card aspect-[1.618/1] bg-braun-100 rounded overflow-hidden relative group"
                    >
                      {#if video.thumb_path_sm || video.thumb_path}
                        <!-- OPT-110: Fade-in transition for smooth image loading -->
                        <img
                          src={`media://${video.thumb_path_sm || video.thumb_path}?v=${cacheVersion}`}
                          alt={video.vidnam}
                          loading="lazy"
                          class="w-full h-full object-cover opacity-0 transition-opacity duration-200"
                          onload={(e) => e.currentTarget.classList.remove('opacity-0')}
                        />
                      {:else}
                        <div class="absolute inset-0 flex items-center justify-center text-braun-400 bg-braun-200">
                          <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </div>
                      {/if}

                      <!-- Play button overlay -->
                      <div class="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                        <div class="w-12 h-12 bg-black/60 rounded-full flex items-center justify-center">
                          <svg class="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                      </div>

                      <!-- Duration badge -->
                      {#if video.meta_duration}
                        <div class="absolute bottom-2 left-2 px-2 py-0.5 bg-black/70 text-white text-xs font-medium rounded">
                          {formatDuration(video.meta_duration)}
                        </div>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/each}
            </div>
          </div>
        {:else}
          <!-- Standard grid for preview or smaller collections -->
          <!-- OPT-110: Keyed by vidhash to prevent DOM thrashing on array updates -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            {#each displayedVideos as video (video.vidhash)}
              {@const actualIndex = videoIndexMap().get(video.vidhash) ?? 0}
              <button
                onclick={() => onOpenLightbox(actualIndex)}
                class="video-card aspect-[1.618/1] bg-braun-100 rounded overflow-hidden relative group"
              >
                {#if video.thumb_path_sm || video.thumb_path}
                  <!-- OPT-110: Fade-in transition for smooth image loading -->
                  <img
                    src={`media://${video.thumb_path_sm || video.thumb_path}?v=${cacheVersion}`}
                    alt={video.vidnam}
                    loading="lazy"
                    class="w-full h-full object-cover opacity-0 transition-opacity duration-200"
                    onload={(e) => e.currentTarget.classList.remove('opacity-0')}
                  />
                {:else}
                  <div class="absolute inset-0 flex items-center justify-center text-braun-400 bg-braun-200">
                    <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                {/if}

                <!-- Play button overlay -->
                <div class="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                  <div class="w-12 h-12 bg-black/60 rounded-full flex items-center justify-center">
                    <svg class="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>

                <!-- Duration badge -->
                {#if video.meta_duration}
                  <div class="absolute bottom-2 left-2 px-2 py-0.5 bg-black/70 text-white text-xs font-medium rounded">
                    {formatDuration(video.meta_duration)}
                  </div>
                {/if}
              </button>
            {/each}
          </div>
        {/if}

        <!-- Show more -->
        {#if videos.length > VIDEO_LIMIT}
          <div class="mt-3 text-center">
            <button
              onclick={() => showAllVideos = !showAllVideos}
              class="text-sm text-braun-900 hover:underline"
            >
              {showAllVideos ? 'Show Less' : `Show All (${videos.length - VIDEO_LIMIT} more)`}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Premium hover effect - Braun design system */
  .video-card {
    transition: transform 200ms ease, border-color 200ms ease;
    border: 2px solid transparent;
  }

  .video-card:hover {
    transform: scale(1.02);
    border-color: #1C1C1A; /* braun-900 */
  }
</style>
