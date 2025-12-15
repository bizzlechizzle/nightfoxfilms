<script lang="ts">
  /**
   * SubLocationGpsModal - Simple GPS-only modal for sub-location (building) GPS editing
   * Migration 31: Sub-locations have their own GPS, separate from host location
   *
   * This modal ONLY edits GPS coordinates - address/region are inherited from host location.
   */
  import Map from '../Map.svelte';

  interface Props {
    subLocationName: string;
    initialLat: number | null;
    initialLng: number | null;
    initialVerified: boolean;
    onSave: (lat: number, lng: number) => Promise<void>;
    onClose: () => void;
  }

  let { subLocationName, initialLat, initialLng, initialVerified, onSave, onClose }: Props = $props();

  // Form state
  let gpsLat = $state(initialLat?.toFixed(6) || '');
  let gpsLng = $state(initialLng?.toFixed(6) || '');
  let gpsVerified = $state(initialVerified);
  let saving = $state(false);
  let error = $state<string | null>(null);

  // Create temporary location for map display
  const mapLocation = $derived({
    locid: 'temp-subloc',
    locnam: subLocationName,
    gps: gpsLat && gpsLng
      ? {
          lat: parseFloat(gpsLat),
          lng: parseFloat(gpsLng),
          source: 'user_map_click' as const,
          verifiedOnMap: gpsVerified,
        }
      : undefined,
  });

  // Handle GPS marker drag on map
  function handleGpsUpdate(locid: string, lat: number, lng: number) {
    gpsLat = lat.toFixed(6);
    gpsLng = lng.toFixed(6);
    gpsVerified = true;
  }

  // Handle map click to set GPS
  function handleMapClick(lat: number, lng: number) {
    gpsLat = lat.toFixed(6);
    gpsLng = lng.toFixed(6);
    gpsVerified = true;
  }

  async function handleSubmit() {
    try {
      saving = true;
      error = null;

      const lat = parseFloat(gpsLat);
      const lng = parseFloat(gpsLng);

      if (isNaN(lat) || isNaN(lng)) {
        error = 'Please enter valid GPS coordinates or click on the map';
        saving = false;
        return;
      }

      if (lat < -90 || lat > 90) {
        error = 'Latitude must be between -90 and 90';
        saving = false;
        return;
      }

      if (lng < -180 || lng > 180) {
        error = 'Longitude must be between -180 and 180';
        saving = false;
        return;
      }

      await onSave(lat, lng);
      onClose();
    } catch (err) {
      console.error('Error saving sub-location GPS:', err);
      error = 'Failed to save GPS coordinates';
    } finally {
      saving = false;
    }
  }

  // Close modal on Escape key
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Modal backdrop -->
<div
  class="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50"
  onclick={onClose}
  role="button"
  tabindex="-1"
>
  <!-- Modal content -->
  <div
    class="bg-white rounded border border-braun-300 w-full max-w-xl max-h-[90vh] overflow-hidden relative z-[100000]"
    onclick={(e) => e.stopPropagation()}
    role="dialog"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-braun-200">
      <div>
        <h2 class="text-lg font-semibold text-braun-900">Building GPS</h2>
        <p class="text-sm text-braun-500 mt-0.5">{subLocationName}</p>
      </div>
      <button
        onclick={onClose}
        class="p-1 text-braun-400 hover:text-braun-600 transition"
        aria-label="Close"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Content -->
    <div class="p-6 space-y-4">
      {#if error}
        <div class="p-3 bg-red-100 text-red-700 rounded text-sm">
          {error}
        </div>
      {/if}

      <p class="text-sm text-braun-600">
        Set GPS coordinates for this building. This is separate from the host location's GPS.
      </p>

      <!-- GPS inputs -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="gps_lat" class="block text-sm font-medium text-braun-700 mb-1">Latitude</label>
          <input
            id="gps_lat"
            type="text"
            bind:value={gpsLat}
            placeholder="42.123456"
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 font-mono text-sm"
          />
        </div>
        <div>
          <label for="gps_lng" class="block text-sm font-medium text-braun-700 mb-1">Longitude</label>
          <input
            id="gps_lng"
            type="text"
            bind:value={gpsLng}
            placeholder="-73.123456"
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 font-mono text-sm"
          />
        </div>
      </div>

      <!-- Map for GPS verification -->
      <div>
        <p class="text-sm text-braun-600 mb-2">
          Click on the map or drag the marker to set the building's exact location
        </p>
        <div class="h-64 rounded border border-braun-200 overflow-hidden">
          <Map
            locations={mapLocation.gps ? [mapLocation] : []}
            onLocationVerify={handleGpsUpdate}
            onMapClick={handleMapClick}
            zoom={mapLocation.gps ? 18 : 15}
            defaultLayer="satellite-labels"
            hideAttribution={true}
            showLayerControl={false}
          />
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-braun-200 bg-braun-50">
      <button
        type="button"
        onclick={onClose}
        class="px-4 py-2 text-sm font-medium text-braun-700 bg-white border border-braun-300 rounded hover:bg-braun-50 transition"
      >
        Cancel
      </button>
      <button
        type="button"
        onclick={handleSubmit}
        disabled={saving || !gpsLat || !gpsLng}
        class="px-4 py-2 text-sm font-medium text-white bg-braun-900 rounded hover:bg-braun-600 transition disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save GPS'}
      </button>
    </div>
  </div>
</div>
