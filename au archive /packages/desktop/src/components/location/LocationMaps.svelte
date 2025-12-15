<script lang="ts">
  /**
   * LocationMaps - Map files list (GeoTIFF, GPX, KML, GeoJSON, etc.)
   * Sub-accordion within Original Assets
   * MAP-MEDIA-FIX-001: Opens in system viewer (GIS apps, Google Earth, etc.)
   */
  import type { MediaMap } from './types';

  interface Props {
    maps: MediaMap[];
    onOpenFile: (path: string) => void;
  }

  let { maps, onOpenFile }: Props = $props();

  const MAP_LIMIT = 5;
  let isOpen = $state(true); // Expanded by default
  let showAllMaps = $state(false);

  const displayedMaps = $derived(showAllMaps ? maps : maps.slice(0, MAP_LIMIT));

  // Get file extension for icon display
  function getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toUpperCase() || 'MAP';
  }

  // Get format-specific icon color
  function getMapTypeColor(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
      case 'gpx': return 'bg-green-200 text-green-700';
      case 'kml':
      case 'kmz': return 'bg-blue-200 text-blue-700';
      case 'geojson':
      case 'topojson': return 'bg-purple-200 text-purple-700';
      case 'shp':
      case 'shx':
      case 'dbf': return 'bg-orange-200 text-orange-700';
      case 'tif':
      case 'geotiff':
      case 'gtiff': return 'bg-amber-200 text-amber-700';
      default: return 'bg-braun-200 text-braun-600';
    }
  }
</script>

{#if maps.length > 0}
  <div class="border-b border-braun-200 last:border-b-0">
    <!-- Sub-accordion header -->
    <button
      onclick={() => isOpen = !isOpen}
      aria-expanded={isOpen}
      class="w-full py-3 flex items-center justify-between text-left hover:bg-braun-100 transition-colors"
    >
      <h3 class="text-sm font-medium text-braun-900 flex items-center gap-2">
        <!-- Map icon -->
        <svg class="w-4 h-4 text-braun-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        Maps ({maps.length})
      </h3>
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
      <div class="pb-4 space-y-2">
        {#each displayedMaps as map}
          <button
            onclick={() => onOpenFile(map.maploc)}
            class="w-full flex items-center gap-3 p-3 bg-braun-50 rounded hover:bg-braun-100 transition text-left"
          >
            <!-- File type badge with format-specific color -->
            <div class="w-10 h-10 rounded flex items-center justify-center text-xs font-medium {getMapTypeColor(map.mapnam)}">
              {getFileExtension(map.mapnam)}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-braun-900 truncate" title={map.mapnamo || map.mapnam}>
                {map.mapnamo || map.mapnam}
              </p>
              <p class="text-xs text-braun-400 font-mono truncate" title={map.mapnam}>
                {map.mapnam}
              </p>
              {#if map.meta_gps_lat && map.meta_gps_lng}
                <p class="text-xs text-green-600 mt-0.5">
                  GPS: {map.meta_gps_lat.toFixed(6)}, {map.meta_gps_lng.toFixed(6)}
                </p>
              {/if}
            </div>
            <!-- External link icon -->
            <svg class="w-4 h-4 text-braun-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        {/each}

        <!-- Show more -->
        {#if maps.length > MAP_LIMIT}
          <div class="mt-3 text-center">
            <button
              onclick={() => showAllMaps = !showAllMaps}
              class="text-sm text-braun-900 hover:underline"
            >
              {showAllMaps ? 'Show Less' : `Show All (${maps.length - MAP_LIMIT} more)`}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
