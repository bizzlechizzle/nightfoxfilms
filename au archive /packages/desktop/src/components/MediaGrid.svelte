<script lang="ts">
  /**
   * MediaGrid - Thumbnail grid display for images and videos
   *
   * Features:
   * - Responsive grid layout
   * - Click to open in MediaViewer
   * - Lazy loading for performance
   * - Shows poster frames for videos
   */

  import { thumbnailCache } from '../stores/thumbnail-cache-store';

  interface MediaItem {
    hash: string;
    path: string;
    name: string;
    type: 'image' | 'video';
    thumbPath?: string | null;
    previewPath?: string | null;
    width?: number | null;
    height?: number | null;
  }

  interface Props {
    items: MediaItem[];
    onSelect: (index: number) => void;
  }

  let { items, onSelect }: Props = $props();

  // Cache-bust param to force reload after thumbnail regeneration
  const cacheVersion = $derived($thumbnailCache);

  // Get thumbnail source for an item
  // Uses custom media:// protocol registered in main process to bypass file:// restrictions
  function getThumbnailSrc(item: MediaItem): string {
    if (item.thumbPath) {
      return `media://${item.thumbPath}?v=${cacheVersion}`;
    }
    // Fallback to original file for standard formats
    return `media://${item.path}?v=${cacheVersion}`;
  }

  // Check if file is a supported browser format
  function isBrowserSupported(path: string): boolean {
    const ext = path.toLowerCase().split('.').pop() || '';
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
  }
</script>

<!-- OPT-110: Keyed by hash to prevent DOM thrashing on array updates -->
<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
  {#each items as item, index (item.hash)}
    <button
      class="aspect-square relative group overflow-hidden rounded bg-braun-800 hover:ring-2 hover:ring-braun-500 transition"
      onclick={() => onSelect(index)}
    >
      {#if item.thumbPath || isBrowserSupported(item.path)}
        <!-- OPT-110: Fade-in transition for smooth image loading -->
        <img
          src={getThumbnailSrc(item)}
          alt={item.name}
          loading="lazy"
          decoding="async"
          class="w-full h-full object-cover opacity-0 transition-opacity duration-200"
          onload={(e) => e.currentTarget.classList.remove('opacity-0')}
        />
      {:else}
        <!-- Placeholder for unsupported formats without thumbnails -->
        <div class="w-full h-full flex items-center justify-center bg-braun-700">
          <div class="text-center text-braun-400">
            <svg class="w-8 h-8 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span class="text-xs">{item.path.split('.').pop()?.toUpperCase()}</span>
          </div>
        </div>
      {/if}

      <!-- Video indicator -->
      {#if item.type === 'video'}
        <div class="absolute top-2 right-2 bg-black bg-opacity-60 rounded-full p-1">
          <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      {/if}

      <!-- Hover overlay with name - solid background, no gradient -->
      <div class="absolute inset-x-0 bottom-0 bg-black/70 p-2 opacity-0 group-hover:opacity-100 transition">
        <p class="text-white text-xs truncate">{item.name}</p>
        {#if item.width && item.height}
          <p class="text-braun-400 text-xs">{item.width}×{item.height}</p>
        {/if}
      </div>
    </button>
  {/each}
</div>
