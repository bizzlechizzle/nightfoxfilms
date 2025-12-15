<script lang="ts">
  /**
   * ExifPanel - Display EXIF metadata for selected media
   *
   * Features:
   * - Shows camera info (make, model)
   * - Shows image dimensions
   * - Shows date taken
   * - Shows GPS coordinates with map link
   * - Expandable raw EXIF view
   */

  interface Props {
    exif: {
      width?: number | null;
      height?: number | null;
      dateTaken?: string | null;
      cameraMake?: string | null;
      cameraModel?: string | null;
      gpsLat?: number | null;
      gpsLng?: number | null;
      rawExif?: string | null;
    };
  }

  let { exif }: Props = $props();
  let showRaw = $state(false);

  const hasGps = $derived(exif.gpsLat != null && exif.gpsLng != null);
  const hasCamera = $derived(exif.cameraMake || exif.cameraModel);
</script>

<div class="bg-braun-900 text-white p-4 rounded">
  <h3 class="text-lg font-semibold mb-4 border-b border-braun-700 pb-2">Metadata</h3>

  <div class="space-y-3 text-sm">
    <!-- Dimensions -->
    {#if exif.width && exif.height}
      <div class="flex justify-between">
        <span class="text-braun-400">Dimensions</span>
        <span>{exif.width} × {exif.height}</span>
      </div>
    {/if}

    <!-- Date Taken -->
    {#if exif.dateTaken}
      <div class="flex justify-between">
        <span class="text-braun-400">Date Taken</span>
        <span>{new Date(exif.dateTaken).toLocaleDateString()} {new Date(exif.dateTaken).toLocaleTimeString()}</span>
      </div>
    {/if}

    <!-- Camera -->
    {#if hasCamera}
      <div class="flex justify-between">
        <span class="text-braun-400">Camera</span>
        <span>{[exif.cameraMake, exif.cameraModel].filter(Boolean).join(' ')}</span>
      </div>
    {/if}

    <!-- GPS -->
    {#if hasGps}
      <div class="flex justify-between items-start">
        <span class="text-braun-400">Location</span>
        <div class="text-right">
          <div>{exif.gpsLat?.toFixed(6)}, {exif.gpsLng?.toFixed(6)}</div>
          <a
            href={`https://www.openstreetmap.org/?mlat=${exif.gpsLat}&mlon=${exif.gpsLng}&zoom=15`}
            target="_blank"
            rel="noopener noreferrer"
            class="text-braun-300 hover:underline text-xs"
          >
            View on Map →
          </a>
        </div>
      </div>
    {/if}

    <!-- Raw EXIF Toggle -->
    {#if exif.rawExif}
      <div class="pt-2 border-t border-braun-700">
        <button
          onclick={() => showRaw = !showRaw}
          class="text-braun-300 hover:underline text-sm"
        >
          {showRaw ? 'Hide' : 'Show'} Raw EXIF Data
        </button>

        {#if showRaw}
          <pre class="mt-2 text-xs bg-braun-800 p-2 rounded overflow-auto max-h-60">
{exif.rawExif}
          </pre>
        {/if}
      </div>
    {/if}
  </div>
</div>
