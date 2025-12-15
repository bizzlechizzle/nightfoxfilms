<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { router } from '../stores/router';
  import { openImportModal } from '../stores/import-modal-store';
  import { toasts } from '../stores/toast-store';
  import Map from '../components/Map.svelte';
  import LinkLocationModal from '../components/LinkLocationModal.svelte';
  import type { Location } from '@au-archive/core';
  import type { MapLocation } from '../types/electron';

  // OPT-041: Track map initialization state for skeleton loader
  let mapReady = $state(false);

  // OPT-045: Atlas load performance tracking
  const ATLAS_LOAD_BUDGET_MS = 3000; // 3 second budget for Atlas load
  let atlasLoadStartTime: number | null = null;
  let atlasLoadComplete = $state(false);

  // Reference map point interface
  interface RefMapPoint {
    pointId: string;
    mapId: string;
    name: string | null;
    description: string | null;
    lat: number;
    lng: number;
    state: string | null;
    category: string | null;
  }

  // OPT-037: Viewport bounds type for spatial queries
  interface ViewportBounds {
    north: number;
    south: number;
    east: number;
    west: number;
  }

  // OPT-043: Use lean MapLocation type for 10x faster Atlas loading
  let locations = $state<MapLocation[]>([]);
  let loading = $state(false); // OPT-038: Start false, set true only during actual fetch
  let showFilters = $state(false);
  let filterState = $state('');
  let filterCategory = $state('');
  // Reference map layer toggle
  let showRefMapLayer = $state(false);
  let refMapPoints = $state<RefMapPoint[]>([]);
  // OPT-037: Current viewport bounds for spatial queries
  let currentBounds = $state<ViewportBounds | null>(null);
  let boundsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const BOUNDS_DEBOUNCE_MS = 300; // Debounce viewport changes to avoid spam
  // Link modal state
  let showLinkModal = $state(false);
  let linkingPoint = $state<{ pointId: string; name: string; lat: number; lng: number } | null>(null);

  // DECISION-016: Read URL params from router store (hash-based routing)
  let routeQuery = $state<Record<string, string>>({});

  // OPT-016: Subscribe to router and store unsubscribe for cleanup
  const unsubscribeRouter = router.subscribe(route => {
    routeQuery = route.query || {};
  });

  // OPT-087: Handle gps-enriched events to update map markers
  function handleAssetReady(event: CustomEvent<{ type: string; locid?: string; lat?: number; lng?: number }>) {
    const { type, locid, lat, lng } = event.detail;
    if (type === 'gps-enriched' && locid && lat != null && lng != null) {
      // Find existing location and update its GPS, or reload bounds to show new pin
      const idx = locations.findIndex(loc => loc.locid === locid);
      if (idx >= 0) {
        // Update existing location's GPS
        locations[idx] = {
          ...locations[idx],
          gps_lat: lat,
          gps_lng: lng,
          gps_source: 'media_gps',
        };
        locations = [...locations]; // Trigger reactivity
      } else if (currentBounds) {
        // Location wasn't in view, reload bounds to potentially show new pin
        loadLocationsInBounds(currentBounds);
      }
    }
  }

  // OPT-016: Clean up router subscription on component destroy
  // OPT-037: Clean up bounds debounce timer
  // OPT-087: Clean up asset-ready event listener
  onDestroy(() => {
    unsubscribeRouter();
    if (boundsDebounceTimer) {
      clearTimeout(boundsDebounceTimer);
    }
    window.removeEventListener('asset-ready', handleAssetReady as EventListener);
  });

  const highlightLocid = $derived(routeQuery.locid || null);

  // OPT-107: Parse URL parameters for center/zoom from mini-map expand
  const urlLat = $derived(routeQuery.lat ? parseFloat(routeQuery.lat) : null);
  const urlLng = $derived(routeQuery.lng ? parseFloat(routeQuery.lng) : null);
  const urlZoom = $derived(routeQuery.zoom ? parseInt(routeQuery.zoom, 10) : null);

  // Build center object if both lat/lng are valid numbers
  const urlCenter = $derived(
    urlLat !== null && urlLng !== null && !isNaN(urlLat) && !isNaN(urlLng)
      ? { lat: urlLat, lng: urlLng }
      : null
  );

  // OPT-107: Only fitBounds when NO explicit view is provided via URL
  // When expanding from mini-map, we want to center on the specific location
  const shouldFitBounds = $derived(!urlCenter);

  const urlLayer = $derived.by(() => {
    const layer = routeQuery.layer;
    const validLayers = ['satellite', 'street', 'topo', 'light', 'dark', 'satellite-labels'];
    if (layer && validLayers.includes(layer)) {
      return layer as 'satellite' | 'street' | 'topo' | 'light' | 'dark' | 'satellite-labels';
    }
    return null;
  });

  // P3d: Context menu state for right-click options
  let contextMenu = $state<{ show: boolean; x: number; y: number; lat: number; lng: number }>({
    show: false,
    x: 0,
    y: 0,
    lat: 0,
    lng: 0,
  });

  // DECISION-015: KISS - Only show locations with actual GPS coordinates
  // OPT-043: Updated to work with MapLocation type (has gps_lat/gps_lng directly)
  function isMappable(loc: MapLocation): boolean {
    return loc.gps_lat != null && loc.gps_lng != null;
  }

  // OPT-043: Updated to work with MapLocation type
  let filteredLocations = $derived(() => {
    return locations.filter((loc) => {
      const matchesState = !filterState || loc.address_state === filterState;
      const matchesCategory = !filterCategory || loc.category === filterCategory;
      return matchesState && matchesCategory && isMappable(loc);
    });
  });

  // OPT-043: Updated to work with MapLocation type
  let uniqueStates = $derived(() => {
    const states = new Set(locations.filter(isMappable).map(l => l.address_state).filter(Boolean));
    return Array.from(states).sort();
  });

  // OPT-043: Updated to work with MapLocation type
  let uniqueCategories = $derived(() => {
    const categories = new Set(locations.filter(isMappable).map(l => l.category).filter(Boolean));
    return Array.from(categories).sort();
  });

  /**
   * OPT-043: Load locations within viewport using ultra-fast lean query
   * Uses findInBoundsForMap (10x faster than findInBounds)
   * - SELECT 11 columns instead of 60+ (90% less data)
   * - No JSON.parse for gps_leaflet_data, sublocs, regions
   * - Direct row mapping (no mapRowToLocation transformation)
   */
  async function loadLocationsInBounds(bounds: ViewportBounds) {
    const startTime = performance.now();
    try {
      loading = true;
      // OPT-043: Use the ultra-fast lean query
      if (!window.electronAPI?.locations?.findInBoundsForMap) {
        // OPT-044: In dev mode, throw error instead of silent fallback
        // This ensures regressions where fast API is missing get caught immediately
        if (import.meta.env.MODE === 'development') {
          throw new Error(
            '[Atlas] findInBoundsForMap API not available! ' +
            'This is a regression - check preload.cjs exposes locations.findInBoundsForMap'
          );
        }
        // Production fallback to slow path (should never happen if properly configured)
        console.warn('[Atlas] findInBoundsForMap API not available, falling back to findInBounds');
        if (window.electronAPI?.locations?.findInBounds) {
          const boundsLocations = await window.electronAPI.locations.findInBounds(bounds);
          // Convert Location to MapLocation for compatibility
          locations = boundsLocations.map(loc => ({
            locid: loc.locid,
            locnam: loc.locnam,
            category: loc.category,
            gps_lat: loc.gps?.lat ?? 0,
            gps_lng: loc.gps?.lng ?? 0,
            gps_accuracy: loc.gps?.accuracy,
            gps_source: loc.gps?.source,
            gps_verified_on_map: loc.gps?.verifiedOnMap ?? false,
            address_state: loc.address?.state,
            address_city: loc.address?.city,
            favorite: loc.favorite ?? false,
          }));
        }
        return;
      }
      // Primary path: Use the ultra-fast lean query
      const mapLocations = await window.electronAPI.locations.findInBoundsForMap(bounds);
      locations = mapLocations;

      // OPT-044: Performance monitoring in dev mode
      if (import.meta.env.MODE === 'development') {
        const elapsed = performance.now() - startTime;
        console.log(`[Atlas] loadLocationsInBounds: ${mapLocations.length} locations in ${elapsed.toFixed(0)}ms`);
      }
    } catch (error) {
      console.error('Error loading locations in bounds:', error);
    } finally {
      loading = false;
    }
  }

  /**
   * OPT-037: Load reference points within current viewport bounds
   */
  async function loadRefPointsInBounds(bounds: ViewportBounds) {
    if (!window.electronAPI?.refMaps?.getPointsInBounds) {
      // Fallback to old behavior
      await loadRefMapPoints();
      return;
    }
    try {
      const points = await window.electronAPI.refMaps.getPointsInBounds(bounds);
      refMapPoints = points;
    } catch (err) {
      console.error('Error loading reference points in bounds:', err);
    }
  }

  /**
   * OPT-037: Handle viewport bounds change from Map component
   * Debounced to avoid excessive queries during pan/zoom
   * OPT-038: First load happens immediately (no debounce)
   * OPT-041: Marks map as ready for skeleton loader
   */
  let isFirstBoundsLoad = true;
  function handleBoundsChange(bounds: ViewportBounds) {
    currentBounds = bounds;

    // OPT-041: Map is ready once we receive bounds (Leaflet initialized)
    if (!mapReady) {
      mapReady = true;
    }

    // Clear existing debounce timer
    if (boundsDebounceTimer) {
      clearTimeout(boundsDebounceTimer);
    }

    // OPT-038: First load happens immediately for fast initial render
    if (isFirstBoundsLoad) {
      isFirstBoundsLoad = false;
      loadLocationsInBounds(bounds);
      if (showRefMapLayer) {
        loadRefPointsInBounds(bounds);
      }
      return;
    }

    // Debounce subsequent loads during pan/zoom
    boundsDebounceTimer = setTimeout(() => {
      loadLocationsInBounds(bounds);
      if (showRefMapLayer) {
        loadRefPointsInBounds(bounds);
      }
    }, BOUNDS_DEBOUNCE_MS);
  }

  // Legacy function for initial load (before bounds are known)
  // OPT-043: Unused since we now use viewport-based loading with lean MapLocation type
  // Kept for compatibility but not recommended
  async function loadLocations() {
    try {
      loading = true;
      if (!window.electronAPI?.locations) {
        console.error('Electron API not available - preload script may have failed to load');
        return;
      }
      // Initial load - will be replaced by viewport query once bounds are available
      const allLocations = await window.electronAPI.locations.findAll();
      // OPT-043: Convert Location[] to MapLocation[] for type compatibility
      locations = allLocations.map(loc => ({
        locid: loc.locid,
        locnam: loc.locnam,
        category: loc.category,
        gps_lat: loc.gps?.lat ?? 0,
        gps_lng: loc.gps?.lng ?? 0,
        gps_accuracy: loc.gps?.accuracy,
        gps_source: loc.gps?.source,
        gps_verified_on_map: loc.gps?.verifiedOnMap ?? false,
        address_state: loc.address?.state,
        address_city: loc.address?.city,
        favorite: loc.favorite ?? false,
      }));
    } catch (error) {
      console.error('Error loading locations:', error);
    } finally {
      loading = false;
    }
  }

  // OPT-043: Accept both Location and MapLocation types (both have locid)
  function handleLocationClick(location: Location | MapLocation) {
    router.navigate(`/location/${location.locid}`);
  }

  function handleMapClick(lat: number, lng: number) {
    // Left-click closes context menu if open
    closeContextMenu();
  }

  function handleMapRightClick(lat: number, lng: number, screenX: number, screenY: number) {
    // BUG-2 FIX: Position context menu at actual click location
    contextMenu = {
      show: true,
      x: screenX,
      y: screenY,
      lat,
      lng,
    };
  }

  function closeContextMenu() {
    contextMenu = { ...contextMenu, show: false };
  }

  function handleAddLocation() {
    openImportModal({
      gps_lat: contextMenu.lat,
      gps_lng: contextMenu.lng,
    });
    closeContextMenu();
  }

  async function handleCopyGps() {
    const gpsText = `${contextMenu.lat.toFixed(6)}, ${contextMenu.lng.toFixed(6)}`;
    try {
      await navigator.clipboard.writeText(gpsText);
      toasts.success(`GPS copied: ${gpsText}`);
    } catch (err) {
      console.error('Failed to copy GPS:', err);
      toasts.error('Failed to copy GPS to clipboard');
    }
    closeContextMenu();
  }

  // Load reference map points from imported maps
  async function loadRefMapPoints() {
    if (!window.electronAPI?.refMaps) return;
    try {
      const points = await window.electronAPI.refMaps.getAllPoints();
      refMapPoints = points;
    } catch (err) {
      console.error('Error loading reference map points:', err);
    }
  }

  // Handle creating a new location from a reference point popup
  // Migration 38: Include refPointId for deletion after location creation
  function handleCreateFromRefPoint(data: { pointId: string; name: string; lat: number; lng: number; state: string | null }) {
    openImportModal({
      name: data.name,
      gps_lat: data.lat,
      gps_lng: data.lng,
      state: data.state || undefined,
      refPointId: data.pointId,
    });
  }

  // Handle deleting a reference point from popup
  async function handleDeleteRefPoint(pointId: string, name: string) {
    // Show confirmation dialog
    const confirmed = confirm(`Delete reference point "${name}"?\n\nThis cannot be undone.`);
    if (!confirmed) return;

    try {
      const result = await window.electronAPI.refMaps.deletePoint(pointId);
      if (result.success) {
        toasts.success(`Deleted "${name}"`);
        // OPT-049: Refresh reference points using viewport bounds if available
        if (currentBounds) {
          await loadRefPointsInBounds(currentBounds);
        } else {
          await loadRefMapPoints();
        }
      } else {
        toasts.error(result.error || 'Failed to delete point');
      }
    } catch (err) {
      console.error('Error deleting reference point:', err);
      toasts.error('Failed to delete reference point');
    }
  }

  // Handle clicking the Link button on a reference point popup
  function handleLinkRefPoint(data: { pointId: string; name: string; lat: number; lng: number }) {
    linkingPoint = data;
    showLinkModal = true;
  }

  // Handle confirming the link to a location
  async function handleConfirmLink(locationId: string) {
    if (!linkingPoint) return;

    try {
      const result = await window.electronAPI.refMaps.linkToLocation(linkingPoint.pointId, locationId);

      if (result.success) {
        // OPT-049: Refresh reference points using viewport bounds if available
        // Linked points are filtered out by the query
        // OPT-057: Hash-based change detection in Map.svelte ensures the marker disappears
        if (currentBounds) {
          await loadRefPointsInBounds(currentBounds);
        } else {
          await loadRefMapPoints();
        }

        toasts.success(`Linked "${linkingPoint.name}" to location`);
      } else {
        toasts.error(result.error || 'Failed to link');
      }
    } catch (err) {
      console.error('[Atlas] Link error:', err);
      toasts.error('Failed to link reference point');
    } finally {
      showLinkModal = false;
      linkingPoint = null;
    }
  }

  // Close the link modal
  function closeLinkModal() {
    showLinkModal = false;
    linkingPoint = null;
  }

  onMount(() => {
    // OPT-045: Start Atlas load timer for health check
    atlasLoadStartTime = performance.now();
    if (import.meta.env.MODE === 'development') {
      console.log('[Atlas][HEALTH] Navigation started');
    }

    // OPT-038: Viewport-based loading - Map emits onBoundsChange when ready
    // DO NOT load all locations here - that causes beach ball freezing
    // The Map component will emit bounds after leaflet initializes

    // OPT-049: Reference points loaded on-demand when checkbox toggled, not on mount
    // This prevents loading 10k+ points before user even wants to see them
    // See $effect below that triggers on showRefMapLayer change

    // Close context menu on click outside
    const handleClickOutside = () => closeContextMenu();
    document.addEventListener('click', handleClickOutside);

    // OPT-087: Listen for GPS enrichment events to update map markers
    window.addEventListener('asset-ready', handleAssetReady as EventListener);

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  });

  // OPT-045: Health check - log warning if Atlas load exceeds budget
  $effect(() => {
    // Trigger when mapReady becomes true and we have locations loaded
    if (mapReady && locations.length > 0 && !atlasLoadComplete && atlasLoadStartTime) {
      atlasLoadComplete = true;
      const loadTime = performance.now() - atlasLoadStartTime;

      if (import.meta.env.MODE === 'development') {
        console.log(`[Atlas][HEALTH] Load complete: ${loadTime.toFixed(0)}ms for ${locations.length} locations`);

        if (loadTime > ATLAS_LOAD_BUDGET_MS) {
          console.warn(
            `%c[Atlas][HEALTH] LOAD TOO SLOW: ${loadTime.toFixed(0)}ms for ${locations.length} locations. ` +
            `This exceeds the ${ATLAS_LOAD_BUDGET_MS}ms performance budget!`,
            'color: red; font-weight: bold; font-size: 14px;'
          );
        } else {
          console.log(
            `%c[Atlas][HEALTH] Load within budget ✓`,
            'color: green; font-weight: bold;'
          );
        }
      }
    }
  });

  // OPT-049: Load reference points on-demand when checkbox toggled ON
  // Only loads if we have bounds available and data hasn't been loaded yet
  $effect(() => {
    if (showRefMapLayer && refMapPoints.length === 0 && currentBounds) {
      loadRefPointsInBounds(currentBounds);
    }
  });
</script>

<div class="h-full flex flex-col">
  <div class="bg-white border-b border-braun-200 px-6 py-4 flex items-center justify-between">
    <h1 class="text-xl font-semibold text-foreground">Atlas</h1>
    <button
      onclick={() => showFilters = !showFilters}
      class="px-4 py-2 bg-braun-100 text-foreground rounded hover:bg-braun-200 transition text-sm"
    >
      {showFilters ? 'Hide' : 'Show'} Filters
    </button>
  </div>

  {#if showFilters}
    <div class="bg-braun-50 border-b border-braun-200 px-6 py-4">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="atlas-state" class="block text-xs font-medium text-braun-700 mb-1">State</label>
          <select
            id="atlas-state"
            bind:value={filterState}
            class="w-full px-3 py-1.5 text-sm border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          >
            <option value="">All States</option>
            {#each uniqueStates() as state}
              <option value={state}>{state}</option>
            {/each}
          </select>
        </div>

        <div>
          <label for="atlas-category" class="block text-xs font-medium text-braun-700 mb-1">Category</label>
          <select
            id="atlas-category"
            bind:value={filterCategory}
            class="w-full px-3 py-1.5 text-sm border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          >
            <option value="">All Categories</option>
            {#each uniqueCategories() as category}
              <option value={category}>{category}</option>
            {/each}
          </select>
        </div>
      </div>
      <!-- Reference Pins checkbox for reference map points -->
      <div class="flex items-center gap-2 pt-3 mt-3 border-t border-braun-200">
        <input
          type="checkbox"
          id="ref-pins"
          bind:checked={showRefMapLayer}
          class="w-4 h-4 accent-braun-900 rounded"
        />
        <label for="ref-pins" class="text-sm text-braun-700 cursor-pointer">
          Reference Pins
          {#if refMapPoints.length > 0}
            <span class="text-braun-400">({refMapPoints.length})</span>
          {/if}
        </label>
      </div>
    </div>
  {/if}

  <div class="flex-1 relative">
    <!-- OPT-041: Static skeleton loader for perceived performance (Braun: no animation) -->
    {#if !mapReady}
      <div class="absolute inset-0 bg-braun-100 z-20 flex flex-col">
        <!-- Static skeleton map area -->
        <div class="flex-1 relative overflow-hidden">
          <div class="absolute inset-0 bg-braun-200">
            <!-- Simulated map grid pattern -->
            <div class="absolute inset-0 opacity-10">
              {#each Array(8) as _, i}
                <div class="absolute border-b border-braun-400" style="top: {12.5 * i}%; width: 100%;"></div>
                <div class="absolute border-r border-braun-400" style="left: {12.5 * i}%; height: 100%;"></div>
              {/each}
            </div>
          </div>
          <!-- Center marker placeholder (static) -->
          <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <div class="w-12 h-12 rounded-full bg-braun-900/30 flex items-center justify-center">
              <div class="w-4 h-4 rounded-full bg-braun-900"></div>
            </div>
          </div>
          <!-- Loading text -->
          <div class="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/90 px-4 py-2 rounded border border-braun-200">
            <p class="text-braun-600 text-sm font-medium">Initializing Atlas...</p>
          </div>
        </div>
      </div>
    {/if}

    <!-- ALWAYS show the map - it's an atlas, not a placeholder -->
    <!-- OPT-107: Pass center/zoom from URL params for mini-map expand navigation -->
    <Map
      locations={filteredLocations()}
      onLocationClick={handleLocationClick}
      onMapClick={handleMapClick}
      onMapRightClick={handleMapRightClick}
      popupMode="minimal"
      defaultLayer={urlLayer ?? 'satellite-labels'}
      center={urlCenter}
      zoom={urlZoom}
      refMapPoints={refMapPoints}
      showRefMapLayer={showRefMapLayer}
      onCreateFromRefPoint={handleCreateFromRefPoint}
      onLinkRefPoint={handleLinkRefPoint}
      onDeleteRefPoint={handleDeleteRefPoint}
      hideAttribution={true}
      fitBounds={shouldFitBounds}
      onBoundsChange={handleBoundsChange}
    />
    {#if loading && mapReady}
      <div class="absolute top-2 left-1/2 -translate-x-1/2 bg-white px-4 py-2 rounded border border-braun-300 z-10">
        <p class="text-braun-500 text-sm">Loading locations...</p>
      </div>
    {/if}

    <!-- BUG-2 FIX: Right-click context menu positioned at click location -->
    {#if contextMenu.show}
      <div
        class="fixed bg-white rounded border border-braun-300 py-1 z-50 min-w-[160px]"
        style="left: {Math.min(contextMenu.x, window.innerWidth - 180)}px; top: {Math.min(contextMenu.y, window.innerHeight - 150)}px;"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="px-3 py-2 border-b border-braun-100">
          <p class="text-xs text-braun-500 font-mono">
            {contextMenu.lat.toFixed(6)}, {contextMenu.lng.toFixed(6)}
          </p>
        </div>
        <button
          onclick={handleAddLocation}
          class="w-full text-left px-3 py-2 text-sm hover:bg-braun-100 transition flex items-center gap-2"
        >
          <svg class="w-4 h-4 text-braun-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          Add Location
        </button>
        <button
          onclick={handleCopyGps}
          class="w-full text-left px-3 py-2 text-sm hover:bg-braun-100 transition flex items-center gap-2"
        >
          <svg class="w-4 h-4 text-braun-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
          Copy GPS
        </button>
        <button
          onclick={closeContextMenu}
          class="w-full text-left px-3 py-2 text-sm text-braun-400 hover:bg-braun-100 transition"
        >
          Cancel
        </button>
      </div>
    {/if}
  </div>
</div>

<!-- Link Location Modal -->
{#if showLinkModal && linkingPoint}
  <LinkLocationModal
    pointName={linkingPoint.name}
    onClose={closeLinkModal}
    onLink={handleConfirmLink}
  />
{/if}

<!-- Braun/Ulm: No shimmer animation - static loading states only -->
