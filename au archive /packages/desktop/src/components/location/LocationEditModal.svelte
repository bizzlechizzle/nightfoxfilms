<script lang="ts">
  /**
   * LocationEditModal - Popup modal for editing location address, GPS, and cultural region
   * Per DECISION-011: Edit button opens popup modal with map for GPS marker dragging
   * Per DECISION-012: Cultural region is predefined dropdown only (no custom entry)
   * Per DECISION-017: Country Cultural Region and geographic hierarchy with verify checkboxes
   */
  import { onMount } from 'svelte';
  import type { Location, LocationInput } from '@au-archive/core';
  import Map from '../Map.svelte';
  // DECISION-012: Use census-regions for local cultural region options
  import { getCulturalRegionsForState, getCulturalRegionFromCounty, STATE_ADJACENCY } from '../../lib/census-regions';
  // DECISION-017: Use country-cultural-regions for national-level regions with proximity filtering
  import {
    getNearbyCountryCulturalRegions,
    getCountryCulturalRegion,
    COUNTRY_CULTURAL_REGIONS,
    type CountryCulturalRegionWithDistance,
  } from '../../lib/country-cultural-regions';

  /**
   * Region data for saving
   */
  export interface RegionSaveData {
    culturalRegion: string | null;
    localCulturalRegionVerified: boolean;
    countryCulturalRegion: string | null;
    countryCulturalRegionVerified: boolean;
  }

  interface Props {
    location: Location;
    onSave: (updates: Partial<LocationInput>, addressVerified: boolean, gpsVerified: boolean, regionData: RegionSaveData) => Promise<void>;
    onClose: () => void;
  }

  let { location, onSave, onClose }: Props = $props();

  // Form state
  let formData = $state({
    // Address
    address_street: location.address?.street || '',
    address_city: location.address?.city || '',
    address_county: location.address?.county || '',
    address_state: location.address?.state || '',
    address_zipcode: location.address?.zipcode || '',
    // GPS
    gps_lat: location.gps?.lat?.toString() || '',
    gps_lng: location.gps?.lng?.toString() || '',
    // Verification
    address_verified: location.address?.verified || false,
    gps_verified: location.gps?.verifiedOnMap || false,
    // Local Cultural Region (DECISION-012: predefined options only, no custom entry)
    cultural_region: (location as any).culturalRegion || '',
    local_cultural_region_verified: (location as any).localCulturalRegionVerified || false,
    // Country Cultural Region (DECISION-017: national-level regions)
    country_cultural_region: (location as any).countryCulturalRegion || '',
    country_cultural_region_verified: (location as any).countryCulturalRegionVerified || false,
  });

  let saving = $state(false);
  let error = $state<string | null>(null);
  let activeTab = $state<'gps' | 'address' | 'cultural'>('gps');

  // DECISION-017: Proximity-filtered local cultural regions based on state and adjacent states
  const localCulturalRegions = $derived(() => {
    const state = formData.address_state?.toUpperCase();
    if (!state) return getCulturalRegionsForState(null);

    // Get regions for current state and all adjacent states
    const adjacentStates = STATE_ADJACENCY[state] || [];
    const allStates = [state, ...adjacentStates];

    // Collect unique regions from all relevant states
    const regionSet = new Set<string>();
    for (const s of allStates) {
      const regions = getCulturalRegionsForState(s);
      regions.forEach(r => regionSet.add(r));
    }

    return Array.from(regionSet).sort();
  });

  const suggestedCulturalRegion = $derived(
    getCulturalRegionFromCounty(formData.address_state, formData.address_county)
  );

  // DECISION-017: Proximity-filtered country cultural regions based on GPS (~50 miles)
  const nearbyCountryCulturalRegions = $derived(() => {
    const lat = parseFloat(formData.gps_lat);
    const lng = parseFloat(formData.gps_lng);

    if (!isNaN(lat) && !isNaN(lng)) {
      // Get regions within 100 miles (wider for dropdown options)
      const nearby = getNearbyCountryCulturalRegions(lat, lng, 100);
      if (nearby.length > 0) {
        return nearby;
      }
    }

    // Fallback: return all regions sorted by name if no GPS
    return COUNTRY_CULTURAL_REGIONS.map(r => ({
      ...r,
      distance: Infinity,
    })).sort((a, b) => a.name.localeCompare(b.name)) as CountryCulturalRegionWithDistance[];
  });

  // Suggested country cultural region from point-in-polygon
  const suggestedCountryCulturalRegion = $derived(() => {
    const lat = parseFloat(formData.gps_lat);
    const lng = parseFloat(formData.gps_lng);

    if (!isNaN(lat) && !isNaN(lng)) {
      return getCountryCulturalRegion(lat, lng);
    }
    return null;
  });

  // Handle GPS marker drag on map
  function handleGpsUpdate(locid: string, lat: number, lng: number) {
    formData.gps_lat = lat.toFixed(6);
    formData.gps_lng = lng.toFixed(6);
    formData.gps_verified = true;
  }

  // Create a temporary location for map display
  const mapLocation = $derived({
    ...location,
    gps: formData.gps_lat && formData.gps_lng
      ? {
          lat: parseFloat(formData.gps_lat),
          lng: parseFloat(formData.gps_lng),
          source: 'user_map_click' as const,
          verifiedOnMap: formData.gps_verified,
        }
      : undefined,
  });

  async function handleSubmit() {
    try {
      saving = true;
      error = null;

      const updates: Partial<LocationInput> = {};

      // Address updates - include if any field has data OR if verification changed
      const hasAnyAddressData = formData.address_street || formData.address_city ||
        formData.address_county || formData.address_state || formData.address_zipcode;
      const addressVerificationChanged = formData.address_verified !== (location.address?.verified || false);

      if (hasAnyAddressData || addressVerificationChanged) {
        updates.address = {
          street: formData.address_street || undefined,
          city: formData.address_city || undefined,
          county: formData.address_county || undefined,
          state: formData.address_state || undefined,
          zipcode: formData.address_zipcode || undefined,
          verified: formData.address_verified,
        };
      }

      // GPS updates - include if coords exist OR if verification changed
      const hasGpsData = formData.gps_lat && formData.gps_lng;
      const gpsVerificationChanged = formData.gps_verified !== (location.gps?.verifiedOnMap || false);

      if (hasGpsData || (gpsVerificationChanged && location.gps?.lat && location.gps?.lng)) {
        updates.gps = {
          lat: parseFloat(formData.gps_lat) || location.gps?.lat || 0,
          lng: parseFloat(formData.gps_lng) || location.gps?.lng || 0,
          source: 'user_map_click',
          verifiedOnMap: formData.gps_verified,
        };
      }

      // Region data (DECISION-012 & DECISION-017: cultural regions with verification)
      const regionData: RegionSaveData = {
        culturalRegion: formData.cultural_region || null,
        localCulturalRegionVerified: formData.local_cultural_region_verified,
        countryCulturalRegion: formData.country_cultural_region || null,
        countryCulturalRegionVerified: formData.country_cultural_region_verified,
      };

      await onSave(updates, formData.address_verified, formData.gps_verified, regionData);
      onClose();
    } catch (err) {
      console.error('Error saving location:', err);
      error = 'Failed to save changes';
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

<!-- Modal backdrop (DECISION-013: z-[99999] ensures modal appears above all map layers) -->
<div
  class="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50"
  onclick={onClose}
  role="button"
  tabindex="-1"
>
  <!-- Modal content -->
  <div
    class="bg-white rounded border border-braun-300 w-full max-w-2xl max-h-[90vh] overflow-hidden relative z-[100000]"
    onclick={(e) => e.stopPropagation()}
    role="dialog"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-braun-200">
      <h2 class="text-lg font-semibold text-braun-900">Edit Location</h2>
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

    <!-- Tabs (order: GPS → Address → Cultural Region) -->
    <div class="flex border-b border-braun-200">
      <button
        onclick={() => activeTab = 'gps'}
        class="flex-1 px-4 py-3 text-sm font-medium transition
          {activeTab === 'gps'
            ? 'text-braun-900 border-b-2 border-braun-900 bg-braun-50'
            : 'text-braun-500 hover:text-braun-700'}"
      >
        GPS & Map
      </button>
      <button
        onclick={() => activeTab = 'address'}
        class="flex-1 px-4 py-3 text-sm font-medium transition
          {activeTab === 'address'
            ? 'text-braun-900 border-b-2 border-braun-900 bg-braun-50'
            : 'text-braun-500 hover:text-braun-700'}"
      >
        Mailing Address
      </button>
      <button
        onclick={() => activeTab = 'cultural'}
        class="flex-1 px-4 py-3 text-sm font-medium transition
          {activeTab === 'cultural'
            ? 'text-braun-900 border-b-2 border-braun-900 bg-braun-50'
            : 'text-braun-500 hover:text-braun-700'}"
      >
        Cultural Region
      </button>
    </div>

    <!-- Content -->
    <div class="p-6 overflow-y-auto max-h-[60vh]">
      {#if error}
        <div class="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          {error}
        </div>
      {/if}

      {#if activeTab === 'gps'}
        <!-- GPS Tab -->
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="gps_lat" class="block text-sm font-medium text-braun-700 mb-1">Latitude</label>
              <input
                id="gps_lat"
                type="text"
                bind:value={formData.gps_lat}
                placeholder="42.123456"
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 font-mono text-sm"
              />
            </div>
            <div>
              <label for="gps_lng" class="block text-sm font-medium text-braun-700 mb-1">Longitude</label>
              <input
                id="gps_lng"
                type="text"
                bind:value={formData.gps_lng}
                placeholder="-73.123456"
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 font-mono text-sm"
              />
            </div>
          </div>

          <!-- Map for GPS verification -->
          <div>
            <p class="text-sm text-braun-600 mb-2">
              Drag the marker to the exact location, or click on the map to set GPS
            </p>
            <div class="h-64 rounded border border-braun-200 overflow-hidden">
              <Map
                locations={mapLocation.gps ? [mapLocation] : []}
                onLocationVerify={handleGpsUpdate}
                onMapClick={(lat, lng) => {
                  formData.gps_lat = lat.toFixed(6);
                  formData.gps_lng = lng.toFixed(6);
                }}
                zoom={mapLocation.gps ? 17 : 10}
                defaultLayer="satellite-labels"
                hideAttribution={true}
                showLayerControl={false}
              />
            </div>
          </div>

          <!-- GPS Verification -->
          <div class="pt-4 border-t border-braun-200">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                bind:checked={formData.gps_verified}
                class="w-4 h-4 text-gps-verified rounded border-braun-300 focus:ring-gps-verified accent-gps-verified"
              />
              <span class="text-sm font-medium text-braun-700">
                Verify GPS Location
              </span>
            </label>
          </div>
        </div>
      {:else if activeTab === 'address'}
        <!-- Address Tab -->
        <div class="space-y-4">
          <div>
            <label for="street" class="block text-sm font-medium text-braun-700 mb-1">Street</label>
            <input
              id="street"
              type="text"
              bind:value={formData.address_street}
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="city" class="block text-sm font-medium text-braun-700 mb-1">City</label>
              <input
                id="city"
                type="text"
                bind:value={formData.address_city}
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              />
            </div>
            <div>
              <label for="county" class="block text-sm font-medium text-braun-700 mb-1">County</label>
              <input
                id="county"
                type="text"
                bind:value={formData.address_county}
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="state" class="block text-sm font-medium text-braun-700 mb-1">State</label>
              <input
                id="state"
                type="text"
                bind:value={formData.address_state}
                maxlength="2"
                placeholder="NY"
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 uppercase"
              />
            </div>
            <div>
              <label for="zipcode" class="block text-sm font-medium text-braun-700 mb-1">Zipcode</label>
              <input
                id="zipcode"
                type="text"
                bind:value={formData.address_zipcode}
                placeholder="12345"
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              />
            </div>
          </div>

          <!-- Address Verification -->
          <div class="pt-4 border-t border-braun-200">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                bind:checked={formData.address_verified}
                class="w-4 h-4 text-gps-verified rounded border-braun-300 focus:ring-gps-verified accent-gps-verified"
              />
              <span class="text-sm font-medium text-braun-700">
                Verify Mailing Address
              </span>
            </label>
          </div>
        </div>
      {:else if activeTab === 'cultural'}
        <!-- Cultural Region Tab -->
        <div class="space-y-4">
          <!-- Local Cultural Region -->
          <div>
            <label for="cultural_region" class="block text-sm font-medium text-braun-700 mb-1">
              Local Cultural Region
            </label>
            <select
              id="cultural_region"
              bind:value={formData.cultural_region}
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
            >
              <option value="">Not specified</option>
              {#each localCulturalRegions() as region}
                <option value={region}>{region}</option>
              {/each}
            </select>
            {#if suggestedCulturalRegion && !formData.cultural_region}
              <p class="text-xs text-braun-900 mt-1">
                Suggestion based on county: <button
                  type="button"
                  onclick={() => formData.cultural_region = suggestedCulturalRegion}
                  class="font-medium underline hover:no-underline"
                >{suggestedCulturalRegion}</button>
              </p>
            {/if}
          </div>

          <!-- Country Cultural Region -->
          <div class="pt-4 border-t border-braun-200">
            <label for="country_cultural_region" class="block text-sm font-medium text-braun-700 mb-1">
              Country Cultural Region
            </label>
            <select
              id="country_cultural_region"
              bind:value={formData.country_cultural_region}
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
            >
              <option value="">Not specified</option>
              {#each nearbyCountryCulturalRegions() as region}
                <option value={region.name}>
                  {region.name}
                  {#if region.distance !== Infinity}
                    ({Math.round(region.distance)} mi)
                  {/if}
                </option>
              {/each}
            </select>
            {#if suggestedCountryCulturalRegion() && !formData.country_cultural_region}
              <p class="text-xs text-braun-900 mt-1">
                Detected from GPS: <button
                  type="button"
                  onclick={() => formData.country_cultural_region = suggestedCountryCulturalRegion()!}
                  class="font-medium underline hover:no-underline"
                >{suggestedCountryCulturalRegion()}</button>
              </p>
            {/if}
          </div>
        </div>
      {/if}
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
        disabled={saving}
        class="px-4 py-2 text-sm font-medium text-white bg-braun-900 rounded hover:bg-braun-600 transition disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  </div>
</div>
