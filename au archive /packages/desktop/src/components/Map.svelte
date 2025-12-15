<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Map as LeafletMap, TileLayer, LayerGroup, DivIcon } from 'leaflet';
  import type { Location } from '@au-archive/core';
  import Supercluster from 'supercluster';
  import { MAP_CONFIG, TILE_LAYERS, THEME, GPS_CONFIG } from '@/lib/constants';

  // OPT-042: Store Leaflet module reference to avoid repeated dynamic imports
  // Dynamic imports have async overhead even when cached
  let leafletModule: typeof import('leaflet') | null = null;

  /**
   * OPT-042: Get Leaflet module - uses cached reference or imports once
   */
  async function getLeaflet(): Promise<typeof import('leaflet')> {
    if (leafletModule) return leafletModule;
    leafletModule = await import('leaflet');
    return leafletModule;
  }

  // OPT-041: Icon cache for marker reuse - prevents recreating divIcon for every marker
  // Best practice: Reuse icon instances instead of creating new ones per marker
  let iconCache: Map<string, DivIcon> = new Map();

  /**
   * OPT-041: Get or create cached icon
   * Icons are cached by key (e.g., 'confidence-verified', 'cluster-15')
   */
  function getCachedIcon(L: any, key: string, createFn: () => any): any {
    if (iconCache.has(key)) {
      return iconCache.get(key)!;
    }
    const icon = createFn();
    iconCache.set(key, icon);
    return icon;
  }

  /**
   * OPT-042: Yield to main thread to prevent blocking
   * Uses microtask scheduling for minimum latency
   */
  function yieldToMain(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  /**
   * OPT-042: Process items in chunks with yielding
   * Prevents main thread blocking during heavy operations
   */
  async function processInChunks<T>(
    items: T[],
    processor: (item: T) => void,
    chunkSize: number = 50
  ): Promise<void> {
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      chunk.forEach(processor);
      if (i + chunkSize < items.length) {
        await yieldToMain();
      }
    }
  }

  // Kanye3: US State CAPITALS for fallback positioning
  // Using capitals instead of centroids - more useful reference point
  const STATE_CAPITALS: Record<string, { lat: number; lng: number; city: string }> = {
    'AL': { lat: 32.377716, lng: -86.300568, city: 'Montgomery' },
    'AK': { lat: 58.301598, lng: -134.420212, city: 'Juneau' },
    'AZ': { lat: 33.448143, lng: -112.096962, city: 'Phoenix' },
    'AR': { lat: 34.746613, lng: -92.288986, city: 'Little Rock' },
    'CA': { lat: 38.576668, lng: -121.493629, city: 'Sacramento' },
    'CO': { lat: 39.739227, lng: -104.984856, city: 'Denver' },
    'CT': { lat: 41.764046, lng: -72.682198, city: 'Hartford' },
    'DE': { lat: 39.157307, lng: -75.519722, city: 'Dover' },
    'FL': { lat: 30.438118, lng: -84.281296, city: 'Tallahassee' },
    'GA': { lat: 33.749027, lng: -84.388229, city: 'Atlanta' },
    'HI': { lat: 21.307442, lng: -157.857376, city: 'Honolulu' },
    'ID': { lat: 43.617775, lng: -116.199722, city: 'Boise' },
    'IL': { lat: 39.798363, lng: -89.654961, city: 'Springfield' },
    'IN': { lat: 39.768623, lng: -86.162643, city: 'Indianapolis' },
    'IA': { lat: 41.591087, lng: -93.603729, city: 'Des Moines' },
    'KS': { lat: 39.048191, lng: -95.677956, city: 'Topeka' },
    'KY': { lat: 38.186722, lng: -84.875374, city: 'Frankfort' },
    'LA': { lat: 30.457069, lng: -91.187393, city: 'Baton Rouge' },
    'ME': { lat: 44.307167, lng: -69.781693, city: 'Augusta' },
    'MD': { lat: 38.978764, lng: -76.490936, city: 'Annapolis' },
    'MA': { lat: 42.358162, lng: -71.063698, city: 'Boston' },
    'MI': { lat: 42.733635, lng: -84.555328, city: 'Lansing' },
    'MN': { lat: 44.955097, lng: -93.102211, city: 'St. Paul' },
    'MS': { lat: 32.303848, lng: -90.182106, city: 'Jackson' },
    'MO': { lat: 38.579201, lng: -92.172935, city: 'Jefferson City' },
    'MT': { lat: 46.585709, lng: -112.018417, city: 'Helena' },
    'NE': { lat: 40.808075, lng: -96.699654, city: 'Lincoln' },
    'NV': { lat: 39.163914, lng: -119.766121, city: 'Carson City' },
    'NH': { lat: 43.206898, lng: -71.537994, city: 'Concord' },
    'NJ': { lat: 40.220596, lng: -74.769913, city: 'Trenton' },
    'NM': { lat: 35.682240, lng: -105.939728, city: 'Santa Fe' },
    'NY': { lat: 42.652843, lng: -73.757874, city: 'Albany' },
    'NC': { lat: 35.787743, lng: -78.644257, city: 'Raleigh' },
    'ND': { lat: 46.820850, lng: -100.783318, city: 'Bismarck' },
    'OH': { lat: 39.961346, lng: -82.999069, city: 'Columbus' },
    'OK': { lat: 35.492207, lng: -97.503342, city: 'Oklahoma City' },
    'OR': { lat: 44.938461, lng: -123.030403, city: 'Salem' },
    'PA': { lat: 40.264378, lng: -76.883598, city: 'Harrisburg' },
    'RI': { lat: 41.830914, lng: -71.414963, city: 'Providence' },
    'SC': { lat: 34.000343, lng: -81.033211, city: 'Columbia' },
    'SD': { lat: 44.367031, lng: -100.346405, city: 'Pierre' },
    'TN': { lat: 36.165810, lng: -86.784241, city: 'Nashville' },
    'TX': { lat: 30.27467, lng: -97.740349, city: 'Austin' },
    'UT': { lat: 40.777477, lng: -111.888237, city: 'Salt Lake City' },
    'VT': { lat: 44.262436, lng: -72.580536, city: 'Montpelier' },
    'VA': { lat: 37.538857, lng: -77.433640, city: 'Richmond' },
    'WA': { lat: 47.035805, lng: -122.905014, city: 'Olympia' },
    'WV': { lat: 38.336246, lng: -81.612328, city: 'Charleston' },
    'WI': { lat: 43.074684, lng: -89.384445, city: 'Madison' },
    'WY': { lat: 41.140259, lng: -104.820236, city: 'Cheyenne' },
    'DC': { lat: 38.897438, lng: -77.026817, city: 'Washington' },
  };

  // Backwards compatibility alias
  const STATE_CENTROIDS = STATE_CAPITALS;

  // DECISION-009: US center fallback for locations with no GPS and no state
  const US_CENTER = { lat: 39.8283, lng: -98.5795 }; // Geographic center of contiguous US

  /**
   * Get coordinates for a location - uses GPS if available, otherwise state centroid, otherwise US center
   * DECISION-009: Never returns null - always provides a fallback for "always show map" requirement
   */
  function getLocationCoordinates(location: Location): { lat: number; lng: number; isApproximate: boolean } {
    // Has precise GPS coordinates
    if (location.gps?.lat && location.gps?.lng) {
      return { lat: location.gps.lat, lng: location.gps.lng, isApproximate: false };
    }

    // Fallback to state centroid if we have a state
    const state = location.address?.state?.toUpperCase();
    if (state && STATE_CENTROIDS[state]) {
      return { ...STATE_CENTROIDS[state], isApproximate: true };
    }

    // DECISION-009: Ultimate fallback to US center (never return null)
    return { ...US_CENTER, isApproximate: true };
  }

  /**
   * Determine GPS confidence level based on location data
   * Per spec: verified > high > medium > low > none
   */
  function getGpsConfidence(location: Location, isApproximate: boolean = false): keyof typeof THEME.GPS_CONFIDENCE_COLORS {
    // State centroid fallback = none confidence (approximate)
    if (isApproximate) return 'none';

    if (!location.gps) return 'none';

    // Verified on map is highest confidence
    if (location.gps.verifiedOnMap) return 'verified';

    // High accuracy from device GPS
    if (location.gps.accuracy && location.gps.accuracy <= GPS_CONFIG.HIGH_ACCURACY_THRESHOLD_METERS) {
      return 'high';
    }

    // Medium accuracy
    if (location.gps.accuracy && location.gps.accuracy <= GPS_CONFIG.GPS_MISMATCH_THRESHOLD_METERS) {
      return 'medium';
    }

    // Low confidence if no accuracy data or high accuracy value
    return 'low';
  }

  // OPT-043: Single icon instance for all location pins (major perf improvement)
  // Braun design: All pins use neutral black #1C1C1A (braun-900)
  // This eliminates ~11 icon object creations per render for 11 locations
  let singlePinIcon: any = null;

  /**
   * OPT-043: Get or create the single pin icon instance
   * Reuses the same icon for all location markers
   * Braun design: Uses neutral braun-900 instead of decorative accent color
   */
  function getPinIcon(L: any): any {
    if (singlePinIcon) return singlePinIcon;
    const pinColor = '#1C1C1A'; // braun-900 - neutral black
    singlePinIcon = L.divIcon({
      html: `<div class="confidence-marker" style="background-color: ${pinColor};"></div>`,
      className: 'confidence-icon',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    return singlePinIcon;
  }

  /**
   * Create a colored circle marker icon using neutral color
   * Braun design: All pins use neutral braun-900 #1C1C1A
   * @deprecated Use getPinIcon() for better performance
   */
  function createConfidenceIcon(L: any, confidence: keyof typeof THEME.GPS_CONFIDENCE_COLORS): any {
    // OPT-043: Return cached single icon instance instead of creating new one
    return getPinIcon(L);
  }

  /**
   * Campus map: Sub-location with GPS for campus mini map
   */
  interface CampusSubLocation {
    subid: string;
    subnam: string;
    gps_lat: number;
    gps_lng: number;
  }

  /**
   * Reference map point for imported KML/GPX/GeoJSON files
   */
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

  /**
   * OPT-043: Lean location type for Atlas performance
   * Matches the backend MapLocation interface
   */
  interface MapLocation {
    locid: string;
    locnam: string;
    category?: string;
    gps_lat: number;
    gps_lng: number;
    gps_accuracy?: number;
    gps_source?: string;
    gps_verified_on_map: boolean;
    address_state?: string;
    address_city?: string;
    favorite: boolean;
  }

  /**
   * OPT-043: Type guard to check if a location is a MapLocation (lean type)
   */
  function isMapLocation(loc: Location | MapLocation): loc is MapLocation {
    return 'gps_lat' in loc && 'gps_lng' in loc;
  }

  /**
   * OPT-043: Extract coordinates from either Location or MapLocation
   * Handles both full Location objects and lean MapLocation objects
   */
  function getCoordinatesFromAny(loc: Location | MapLocation): { lat: number; lng: number; isApproximate: boolean } | null {
    if (isMapLocation(loc)) {
      // Lean MapLocation - direct access
      if (loc.gps_lat != null && loc.gps_lng != null) {
        return { lat: loc.gps_lat, lng: loc.gps_lng, isApproximate: false };
      }
      return null;
    }
    // Full Location object - use existing function
    return getLocationCoordinates(loc);
  }

  /**
   * OPT-043: Extract verified status from either Location or MapLocation
   */
  function getVerifiedStatus(loc: Location | MapLocation): boolean {
    if (isMapLocation(loc)) {
      return loc.gps_verified_on_map;
    }
    return loc.gps?.verifiedOnMap ?? false;
  }

  /**
   * OPT-043: Extract city from either Location or MapLocation
   */
  function getCity(loc: Location | MapLocation): string | undefined {
    if (isMapLocation(loc)) {
      return loc.address_city;
    }
    return loc.address?.city;
  }

  /**
   * OPT-043: Extract state from either Location or MapLocation
   */
  function getState(loc: Location | MapLocation): string | undefined {
    if (isMapLocation(loc)) {
      return loc.address_state;
    }
    return loc.address?.state;
  }

  interface Props {
    // OPT-043: Support both full Location[] and lean MapLocation[] for Atlas
    locations?: (Location | MapLocation)[];
    // OPT-043: Accept both Location and MapLocation types
    onLocationClick?: (location: Location | MapLocation) => void;
    onMapClick?: (lat: number, lng: number) => void;
    // BUG-2 FIX: Pass screen coordinates for context menu positioning
    onMapRightClick?: (lat: number, lng: number, screenX: number, screenY: number) => void;
    // FIX 6.8: Enable heat map visualization
    showHeatMap?: boolean;
    // Kanye9: Custom zoom level based on GPS confidence
    zoom?: number;
    // DECISION-016: Initial center coordinates for Atlas expand from mini-map
    center?: { lat: number; lng: number };
    // FEAT-P1: Verify Location callback - called with locid and new lat/lng
    onLocationVerify?: (locid: string, lat: number, lng: number) => void;
    // Popup display mode: 'full' shows all info, 'minimal' shows name + View Details only
    popupMode?: 'full' | 'minimal';
    // DECISION-010: Lock all map interaction (for mini map on location detail)
    readonly?: boolean;
    // DECISION-011: Limited interaction for mini map (1-2 zoom levels, slight pan)
    limitedInteraction?: boolean;
    // DECISION-011: Hide attribution for mini map (cleaner look)
    hideAttribution?: boolean;
    // DECISION-011: Default layer (satellite, street, topo, light, dark)
    defaultLayer?: 'satellite' | 'street' | 'topo' | 'light' | 'dark' | 'satellite-labels';
    // DECISION-011: Compact layer control (collapsed by default)
    compactLayerControl?: boolean;
    // Hide layer control entirely (for modal maps)
    showLayerControl?: boolean;
    // Allow extra zoom-out capability for host locations (2 levels instead of 1 for limited interaction)
    extraZoomOut?: boolean;
    // Campus map: Allow full zoom-in for detailed campus exploration
    allowFullZoomIn?: boolean;
    // Campus map: Sub-locations with GPS to render on mini map
    campusSubLocations?: CampusSubLocation[];
    // Campus map: Callback when clicking a sub-location marker
    onCampusSubLocationClick?: (subid: string) => void;
    // Reference map points to display (from imported KML/GPX/GeoJSON)
    refMapPoints?: RefMapPoint[];
    // Whether to show reference map layer
    showRefMapLayer?: boolean;
    // Callback when user clicks "Create Location" on a reference point popup
    // Migration 38: Added pointId for deletion after location creation
    onCreateFromRefPoint?: (data: { pointId: string; name: string; lat: number; lng: number; state: string | null }) => void;
    // Callback when user clicks "Link" on a reference point popup
    onLinkRefPoint?: (data: { pointId: string; name: string; lat: number; lng: number }) => void;
    // Callback when user clicks "Delete" on a reference point popup
    onDeleteRefPoint?: (pointId: string, name: string) => void;
    // Auto-fit map to show all locations on load
    fitBounds?: boolean;
    // OPT-037: Callback when map viewport changes (for viewport-based data loading)
    onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
  }

  let {
    locations = [],
    onLocationClick,
    onMapClick,
    onMapRightClick,
    showHeatMap = false,
    zoom,
    center,
    onLocationVerify,
    popupMode = 'full',
    readonly = false,
    limitedInteraction = false,
    hideAttribution = false,
    defaultLayer = 'light',
    compactLayerControl = false,
    showLayerControl = true,
    extraZoomOut = false,
    allowFullZoomIn = false,
    campusSubLocations = [],
    onCampusSubLocationClick,
    refMapPoints = [],
    showRefMapLayer = false,
    onCreateFromRefPoint,
    onLinkRefPoint,
    onDeleteRefPoint,
    fitBounds = false,
    onBoundsChange,
  }: Props = $props();

  /**
   * Escape HTML to prevent XSS attacks
   */
  function escapeHtml(unsafe: string | null | undefined): string {
    if (!unsafe) return '';
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  let mapContainer: HTMLDivElement;
  let map: LeafletMap | null = null;
  let markersLayer: LayerGroup | null = null;
  // Campus map: Layer for sub-location markers
  let campusMarkersLayer: LayerGroup | null = null;
  // Reference map layer for imported KML/GPX/GeoJSON points
  let refMapLayer: LayerGroup | null = null;
  // FIX 6.8: Heat map layer
  let heatLayer: any = null;
  let cluster: Supercluster | null = null;
  // Kanye9 FIX: Track GPS hash, not just length - triggers re-zoom when GPS updates
  let lastLocationsHash = $state('');
  // Kanye11 FIX: Prevent infinite loop - track if initial view has been set
  let initialViewSet = $state(false);
  // DECISION-016: Track if center/zoom were explicitly provided via props (e.g., URL params)
  // When true, skip auto-zoom logic to preserve the intended view
  let hasExplicitView = $state(false);
  // BUG-V1 FIX: Location lookup for event delegation
  let locationLookup = new Map<string, Location>();
  // BUG-V1 FIX: Store cleanup function for event delegation
  let viewDetailsClickHandler: ((e: MouseEvent) => void) | null = null;
  // OPT-041: Track if cluster initialization is complete (for non-blocking init)
  let clusterReady = $state(false);
  // OPT-041: Deferred init flag to prevent double initialization
  let initScheduled = false;
  // OPT-045: Track if we're using simple markers (skip clustering for small datasets)
  let usingSimpleMarkers = $state(false);

  /**
   * OPT-045: Threshold for skipping clustering - for small datasets, clustering
   * overhead causes more harm than good. Simple markers are instant.
   */
  const SIMPLE_MARKER_THRESHOLD = 100;
  // Event handler for "Create Location" button on reference point popups
  let createFromRefClickHandler: ((e: MouseEvent) => void) | null = null;
  // Event handler for "Link" button on reference point popups
  let linkRefClickHandler: ((e: MouseEvent) => void) | null = null;
  // Event handler for "Delete" button on reference point popups
  let deleteRefClickHandler: ((e: MouseEvent) => void) | null = null;

  /**
   * Kanye9: Generate hash from location IDs and GPS coordinates
   * This ensures the $effect triggers when GPS is updated via forward geocoding
   * OPT-044: Handle both Location (gps.lat) and MapLocation (gps_lat) types
   */
  function getLocationsHash(locs: (Location | MapLocation)[]): string {
    return locs.map((l) => {
      const coords = getCoordinatesFromAny(l);
      return `${l.locid}:${coords?.lat ?? 0}:${coords?.lng ?? 0}`;
    }).join(',');
  }

  /**
   * FIX 6.8: Simple canvas-based heat map implementation
   * Uses a custom Leaflet layer to render density visualization
   */
  function createHeatLayer(L: any, locations: Location[]): any {
    // Extract coordinates with weights (media count if available, else 1)
    const points = locations
      .map(loc => {
        const coords = getLocationCoordinates(loc);
        if (!coords) return null;
        return {
          lat: coords.lat,
          lng: coords.lng,
          // Weight could be based on media count or other metrics
          weight: 1,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (points.length === 0) return null;

    // Create a custom canvas layer for heat visualization
    const HeatLayer = L.Layer.extend({
      onAdd: function(map: any) {
        this._map = map;
        this._canvas = L.DomUtil.create('canvas', 'leaflet-heat-layer');
        const pane = map.getPane('overlayPane');
        pane.appendChild(this._canvas);
        map.on('moveend', this._update, this);
        map.on('zoomend', this._update, this);
        this._update();
      },

      onRemove: function(map: any) {
        L.DomUtil.remove(this._canvas);
        map.off('moveend', this._update, this);
        map.off('zoomend', this._update, this);
      },

      _update: function() {
        if (!this._map) return;

        const size = this._map.getSize();
        const bounds = this._map.getBounds();
        const zoom = this._map.getZoom();
        const topLeft = this._map.containerPointToLayerPoint([0, 0]);

        L.DomUtil.setPosition(this._canvas, topLeft);
        this._canvas.width = size.x;
        this._canvas.height = size.y;

        const ctx = this._canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, size.x, size.y);

        // Calculate radius based on zoom level
        const radius = Math.max(20, Math.min(80, zoom * 6));

        // Draw heat points
        points.forEach(point => {
          if (!bounds.contains([point.lat, point.lng])) return;

          const containerPoint = this._map.latLngToContainerPoint([point.lat, point.lng]);
          const x = containerPoint.x;
          const y = containerPoint.y;

          // Create radial gradient for each point
          const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, 'rgba(255, 100, 100, 0.6)');
          gradient.addColorStop(0.4, 'rgba(255, 200, 100, 0.4)');
          gradient.addColorStop(0.7, 'rgba(100, 200, 255, 0.2)');
          gradient.addColorStop(1, 'rgba(0, 100, 255, 0)');

          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        });
      },
    });

    return new HeatLayer();
  }

  onMount(async () => {
    // OPT-042: Use cached Leaflet module to avoid repeated import overhead
    const leaflet = await getLeaflet();
    const L = leaflet;
    await import('leaflet/dist/leaflet.css');

    if (!map && mapContainer) {
      // DECISION-010: Lock all interaction when readonly is true
      // DECISION-011: Limited interaction allows 1-2 zoom levels, slight pan
      const initialZoom = zoom ?? MAP_CONFIG.DEFAULT_ZOOM;
      // DECISION-016: Use center prop if provided (e.g., from Atlas URL params)
      const initialCenter = center ?? MAP_CONFIG.DEFAULT_CENTER;
      // DECISION-016: Track if explicit view was provided - prevents auto-zoom from overriding
      hasExplicitView = !!(center && zoom);
      map = L.map(mapContainer, {
        center: [initialCenter.lat, initialCenter.lng],
        zoom: initialZoom,
        // Interaction controls - disabled when readonly, limited when limitedInteraction
        dragging: !readonly && true,
        scrollWheelZoom: !readonly && true,
        doubleClickZoom: !readonly && !limitedInteraction,
        touchZoom: !readonly && true,
        boxZoom: !readonly && !limitedInteraction,
        keyboard: !readonly && !limitedInteraction,
        zoomControl: !readonly && !limitedInteraction,
        // DECISION-011: Limited interaction - restrict zoom range
        // extraZoomOut allows 2 levels of zoom-out for host locations to see more campus area
        // allowFullZoomIn enables zooming all the way in for campus maps
        minZoom: limitedInteraction ? Math.max(1, initialZoom - (extraZoomOut ? 2 : 1)) : undefined,
        maxZoom: limitedInteraction && !allowFullZoomIn ? Math.min(19, initialZoom + 1) : undefined,
        // DECISION-011: Hide attribution for mini map
        attributionControl: !hideAttribution,
      });

      // DECISION-011: Limited interaction - restrict panning to ~500m from center
      // We'll set maxBounds after we know the location coordinates
      // This will be handled in updateClusters when single location is rendered

      // P3c: Additional map layers per v010steps.md
      // DECISION-011: Attribution empty string when hideAttribution is true
      const attrSuffix = hideAttribution ? '' : undefined;
      const baseLayers: { [key: string]: TileLayer } = {
        'Satellite': L.tileLayer(TILE_LAYERS.SATELLITE, {
          attribution: hideAttribution ? '' : 'Tiles &copy; Esri',
          maxZoom: MAP_CONFIG.MAX_ZOOM,
        }),
        'Street': L.tileLayer(TILE_LAYERS.STREET, {
          attribution: hideAttribution ? '' : '&copy; OpenStreetMap contributors',
          maxZoom: MAP_CONFIG.MAX_ZOOM,
        }),
        'Topo': L.tileLayer(TILE_LAYERS.TOPO, {
          attribution: hideAttribution ? '' : 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap',
          maxZoom: 17,
        }),
        'Light': L.tileLayer(TILE_LAYERS.CARTO_LIGHT, {
          attribution: hideAttribution ? '' : '&copy; OpenStreetMap contributors, &copy; CartoDB',
          maxZoom: MAP_CONFIG.MAX_ZOOM,
          subdomains: 'abcd',
        }),
        'Dark': L.tileLayer(TILE_LAYERS.CARTO_DARK, {
          attribution: hideAttribution ? '' : '&copy; OpenStreetMap contributors, &copy; CartoDB',
          maxZoom: MAP_CONFIG.MAX_ZOOM,
          subdomains: 'abcd',
        }),
      };

      const overlayLayers: { [key: string]: TileLayer } = {
        'Labels': L.tileLayer(TILE_LAYERS.LABELS, {
          attribution: hideAttribution ? '' : 'Esri',
          maxZoom: MAP_CONFIG.MAX_ZOOM,
        }),
        'Roads': L.tileLayer(TILE_LAYERS.ROADS, {
          attribution: hideAttribution ? '' : 'Esri',
          maxZoom: MAP_CONFIG.MAX_ZOOM,
        }),
      };

      // DECISION-011: Default layer based on prop
      const layerMap: Record<string, string> = {
        'satellite': 'Satellite',
        'street': 'Street',
        'topo': 'Topo',
        'light': 'Light',
        'dark': 'Dark',
        'satellite-labels': 'Satellite', // Will also add labels overlay
      };
      const selectedLayer = layerMap[defaultLayer] || 'Light';
      baseLayers[selectedLayer].addTo(map);

      // DECISION-011: Add labels and roads overlay if satellite-labels is selected
      if (defaultLayer === 'satellite-labels') {
        overlayLayers['Roads'].addTo(map);
        overlayLayers['Labels'].addTo(map);
      }

      // DECISION-011: Compact layer control (collapsed, bottom-left) or standard
      // showLayerControl=false hides it entirely (for modal maps)
      if (!limitedInteraction && showLayerControl) {
        L.control.layers(baseLayers, overlayLayers, {
          collapsed: compactLayerControl,
          position: compactLayerControl ? 'bottomleft' : 'topright',
        }).addTo(map);
      }

      markersLayer = L.layerGroup().addTo(map);
      // Campus map: Layer for sub-location markers (rendered on top)
      campusMarkersLayer = L.layerGroup().addTo(map);
      // Reference map layer for imported KML/GPX/GeoJSON points (separate from location markers)
      refMapLayer = L.layerGroup();

      // DECISION-010: Skip click handlers when readonly
      if (!readonly) {
        map.on('click', (e) => {
          if (onMapClick) {
            onMapClick(e.latlng.lat, e.latlng.lng);
          }
        });

        map.on('contextmenu', (e) => {
          // BUG-V2 FIX: Prevent default browser context menu
          e.originalEvent.preventDefault();
          if (onMapRightClick) {
            // BUG-2 FIX: Pass screen coordinates for context menu positioning
            onMapRightClick(e.latlng.lat, e.latlng.lng, e.originalEvent.clientX, e.originalEvent.clientY);
          }
        });
      }

      // BUG-V1 FIX: Event delegation for View Details and Verify button clicks
      // This is more reliable than DOM manipulation in Leaflet popups
      viewDetailsClickHandler = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        // Handle View Details button
        if (target.classList.contains('view-details-btn')) {
          e.preventDefault();
          e.stopPropagation();
          const locid = target.getAttribute('data-location-id');
          if (locid && locationLookup.has(locid) && onLocationClick) {
            onLocationClick(locationLookup.get(locid)!);
          }
        }
        // FEAT-P1: Handle Verify Location button
        if (target.classList.contains('verify-location-btn')) {
          e.preventDefault();
          e.stopPropagation();
          const locid = target.getAttribute('data-verify-location-id');
          const loc = locid ? locationLookup.get(locid) : null;
          if (locid && loc && loc.gps && onLocationVerify) {
            // Verify at current position
            onLocationVerify(locid, loc.gps.lat, loc.gps.lng);
          }
        }
      };
      document.addEventListener('click', viewDetailsClickHandler);

      // Event delegation for "Create Location" button on reference point popups
      // Migration 38: Include pointId for deletion after location creation
      createFromRefClickHandler = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('create-from-ref-btn')) {
          e.preventDefault();
          e.stopPropagation();
          const pointId = target.getAttribute('data-point-id') || '';
          const name = target.getAttribute('data-name') || 'Unnamed Point';
          const lat = parseFloat(target.getAttribute('data-lat') || '0');
          const lng = parseFloat(target.getAttribute('data-lng') || '0');
          const state = target.getAttribute('data-state') || null;
          if (onCreateFromRefPoint && lat !== 0 && lng !== 0 && pointId) {
            onCreateFromRefPoint({ pointId, name, lat, lng, state: state || null });
          }
        }
      };
      document.addEventListener('click', createFromRefClickHandler);

      // Event delegation for "Link" button on reference point popups
      linkRefClickHandler = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        // Use closest() to handle clicks on SVG icon inside button
        const btn = target.closest('.link-ref-btn') as HTMLElement | null;
        if (btn) {
          e.preventDefault();
          e.stopPropagation();
          const pointId = btn.getAttribute('data-point-id');
          const name = btn.getAttribute('data-name') || 'Unnamed Point';
          const lat = parseFloat(btn.getAttribute('data-lat') || '0');
          const lng = parseFloat(btn.getAttribute('data-lng') || '0');
          if (onLinkRefPoint && pointId && lat !== 0 && lng !== 0) {
            onLinkRefPoint({ pointId, name, lat, lng });
          }
        }
      };
      document.addEventListener('click', linkRefClickHandler);

      // Event delegation for "Delete" button on reference point popups
      deleteRefClickHandler = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        // Use closest() to handle clicks on SVG icon inside button
        const btn = target.closest('.delete-ref-btn') as HTMLElement | null;
        if (btn) {
          e.preventDefault();
          e.stopPropagation();
          const pointId = btn.getAttribute('data-point-id');
          const name = btn.getAttribute('data-name') || 'Unnamed Point';
          if (onDeleteRefPoint && pointId) {
            onDeleteRefPoint(pointId, name);
          }
        }
      };
      document.addEventListener('click', deleteRefClickHandler);

      map.on('zoomend moveend', () => {
        updateClusters(L);
        // OPT-037: Notify parent of viewport bounds change
        if (onBoundsChange && map) {
          const mapBounds = map.getBounds();
          onBoundsChange({
            north: mapBounds.getNorth(),
            south: mapBounds.getSouth(),
            east: mapBounds.getEast(),
            west: mapBounds.getWest(),
          });
        }
      });

      // OPT-041: Use non-blocking cluster initialization on mount
      // This prevents the "dial-up" freeze by deferring heavy computation
      scheduleClusterInit();

      // Auto-fit map to show all location pins
      // OPT-043: Use getCoordinatesFromAny to support both Location and MapLocation
      if (fitBounds && locations.length > 0) {
        const validLocs = locations.filter(loc => {
          const coords = getCoordinatesFromAny(loc);
          return coords && !coords.isApproximate;
        });
        if (validLocs.length > 0) {
          const bounds = L.latLngBounds(
            validLocs.map(loc => {
              const coords = getCoordinatesFromAny(loc)!;
              return [coords.lat, coords.lng] as [number, number];
            })
          );
          if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
          }
        }
      }

      // OPT-037 FIX: Emit initial bounds immediately after map setup
      // This allows Atlas to load viewport-filtered data instead of waiting 3s fallback
      if (onBoundsChange) {
        const initialBounds = map.getBounds();
        onBoundsChange({
          north: initialBounds.getNorth(),
          south: initialBounds.getSouth(),
          east: initialBounds.getEast(),
          west: initialBounds.getWest(),
        });
      }
    }
  });

  /**
   * OPT-042: Non-blocking cluster initialization with chunked processing
   * Processes locations in chunks, yielding to main thread between chunks
   * This prevents the "spinning wheel of death" on large datasets
   */
  async function initClusterAsync(): Promise<void> {
    cluster = new Supercluster({
      radius: MAP_CONFIG.CLUSTER_RADIUS,
      maxZoom: MAP_CONFIG.CLUSTER_MAX_ZOOM,
      minPoints: MAP_CONFIG.CLUSTER_MIN_POINTS,
    });

    // OPT-042/043: Process locations in chunks to avoid blocking
    // Now supports both Location and MapLocation types
    const points: any[] = [];
    const CHUNK_SIZE = 100; // Process 100 locations at a time

    for (let i = 0; i < locations.length; i += CHUNK_SIZE) {
      const chunk = locations.slice(i, i + CHUNK_SIZE);

      chunk.forEach(loc => {
        // OPT-043: Use universal coordinate extractor for both types
        const coords = getCoordinatesFromAny(loc);
        if (coords) {
          points.push({
            type: 'Feature' as const,
            properties: { location: loc, isApproximate: coords.isApproximate },
            geometry: {
              type: 'Point' as const,
              coordinates: [coords.lng, coords.lat],
            },
          });
        }
      });

      // Yield to main thread between chunks to keep UI responsive
      if (i + CHUNK_SIZE < locations.length) {
        await yieldToMain();
      }
    }

    // Load all points into Supercluster (this is still synchronous but with pre-processed data)
    cluster.load(points);
    clusterReady = true;
  }

  /**
   * OPT-042: Async version of updateClusters with chunked marker processing
   * Yields to main thread between marker chunks to prevent blocking
   * IMPORTANT: Must be defined before scheduleClusterInit which calls it
   */
  async function updateClustersAsync(L: any): Promise<void> {
    if (!map || !markersLayer || !cluster) return;

    markersLayer.clearLayers();

    const bounds = map.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];
    const currentZoom = map.getZoom();

    const clusters = cluster.getClusters(bbox, Math.floor(currentZoom));

    // OPT-042: Process markers in chunks with yielding
    const MARKER_CHUNK_SIZE = 30; // Add 30 markers at a time

    for (let i = 0; i < clusters.length; i += MARKER_CHUNK_SIZE) {
      const chunk = clusters.slice(i, i + MARKER_CHUNK_SIZE);

      chunk.forEach((feature: any) => {
        const [lng, lat] = feature.geometry.coordinates;

        if (feature.properties.cluster) {
          const count = feature.properties.point_count;
          const clusterKey = `cluster-${count}`;
          const icon = getCachedIcon(L, clusterKey, () => L.divIcon({
            html: `<div class="cluster-marker">${count}</div>`,
            className: 'cluster-icon',
            iconSize: [40, 40],
          }));
          const marker = L.marker([lat, lng], { icon });

          marker.on('click', () => {
            const expansionZoom = Math.min(
              cluster!.getClusterExpansionZoom(feature.properties.cluster_id),
              MAP_CONFIG.CLUSTER_EXPANSION_MAX_ZOOM
            );
            map!.setView([lat, lng], expansionZoom);
          });

          markersLayer!.addLayer(marker);
        } else {
          // OPT-043: Support both Location and MapLocation types
          const location = feature.properties.location as Location | MapLocation;
          const isApproximate = feature.properties.isApproximate || false;
          // OPT-043: Use single cached icon for all pins
          const icon = getPinIcon(L);
          const marker = L.marker([lat, lng], { icon });

          // OPT-043: Use helper functions to extract data from either type
          const isVerified = getVerifiedStatus(location);
          const city = getCity(location);
          const state = getState(location);

          const verifyButtonHtml = popupMode === 'full' && onLocationVerify && !isVerified
            ? `<button data-verify-location-id="${location.locid}" class="verify-location-btn" style="margin-top: 4px; padding: 6px 12px; background: #4A8C5E; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; width: 100%;">Verify Location</button>`
            : popupMode === 'full' && isVerified
              ? `<div style="margin-top: 4px; padding: 6px 12px; background: #4A8C5E; color: white; border-radius: 4px; font-size: 11px; text-align: center;">Location Verified</div>`
              : '';

          const categoryHtml = popupMode === 'full'
            ? `<span style="color: #666; font-size: 12px;">${escapeHtml(location.category) || 'Unknown Category'}</span><br/>`
            : '';
          const addressHtml = popupMode === 'full'
            ? `<span style="color: #888; font-size: 11px;">${city ? `${escapeHtml(city)}, ` : ''}${escapeHtml(state) || ''}</span><br/>`
            : '';

          const popupContent = `
            <div class="location-popup" style="min-width: 180px;">
              <strong style="font-size: 14px;">${escapeHtml(location.locnam)}</strong><br/>
              ${categoryHtml}${addressHtml}<button data-location-id="${location.locid}" class="view-details-btn" style="margin-top: 8px; padding: 6px 12px; background: #1C1C1A; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; width: 100%;">View Details</button>
              ${verifyButtonHtml}
            </div>
          `;

          marker.bindPopup(popupContent);

          if (onLocationVerify && !isVerified && !readonly) {
            marker.options.draggable = true;
            marker.on('dragend', () => {
              const newPos = marker.getLatLng();
              onLocationVerify(location.locid, newPos.lat, newPos.lng);
            });
          }

          marker.on('click', () => {
            marker.openPopup();
          });

          locationLookup.set(location.locid, location);
          markersLayer!.addLayer(marker);
        }
      });

      // Yield between chunks to keep UI responsive
      if (i + MARKER_CHUNK_SIZE < clusters.length) {
        await yieldToMain();
      }
    }

    // Handle single location zoom
    // OPT-043: Use universal coordinate extractor
    if (locations.length === 1 && !initialViewSet) {
      const coords = getCoordinatesFromAny(locations[0]);
      if (coords) {
        const zoomLevel = zoom ?? (coords.isApproximate ? 10 : 17);
        initialViewSet = true;
        map.setView([coords.lat, coords.lng], zoomLevel);

        if (limitedInteraction) {
          const bounds = L.latLngBounds(
            [coords.lat - 0.005, coords.lng - 0.007],
            [coords.lat + 0.005, coords.lng + 0.007]
          );
          map.setMaxBounds(bounds);
        }
      }
    }

    // Campus markers (synchronous - usually few)
    if (campusMarkersLayer && campusSubLocations.length > 0) {
      campusMarkersLayer.clearLayers();
      const pinColor = '#1C1C1A'; // braun-900 - neutral black

      campusSubLocations.forEach((subloc) => {
        const icon = L.divIcon({
          html: `<div class="confidence-marker" style="background-color: ${pinColor};"></div>`,
          className: 'confidence-icon',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });

        const marker = L.marker([subloc.gps_lat, subloc.gps_lng], { icon });

        marker.on('click', () => {
          if (onCampusSubLocationClick) {
            onCampusSubLocationClick(subloc.subid);
          }
        });

        marker.bindTooltip(subloc.subnam, {
          permanent: false,
          direction: 'top',
          offset: [0, -8],
        });

        campusMarkersLayer!.addLayer(marker);
      });
    }
  }

  /**
   * OPT-045: Render simple markers without clustering for small datasets
   * This is MUCH faster than Supercluster for ≤100 locations
   * Runs synchronously but is trivial work for small N
   */
  function renderSimpleMarkers(L: any): void {
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();
    locationLookup.clear();

    const icon = getPinIcon(L);

    locations.forEach((loc) => {
      const coords = getCoordinatesFromAny(loc);
      if (!coords) return;

      const marker = L.marker([coords.lat, coords.lng], { icon });

      // Build popup
      const isVerified = getVerifiedStatus(loc);
      const city = getCity(loc);
      const state = getState(loc);

      const verifyButtonHtml = popupMode === 'full' && onLocationVerify && !isVerified
        ? `<button data-verify-location-id="${loc.locid}" class="verify-location-btn" style="margin-top: 4px; padding: 6px 12px; background: #4A8C5E; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; width: 100%;">Verify Location</button>`
        : popupMode === 'full' && isVerified
          ? `<div style="margin-top: 4px; padding: 6px 12px; background: #4A8C5E; color: white; border-radius: 4px; font-size: 11px; text-align: center;">Location Verified</div>`
          : '';

      const categoryHtml = popupMode === 'full'
        ? `<span style="color: #666; font-size: 12px;">${escapeHtml(loc.category) || 'Unknown Category'}</span><br/>`
        : '';
      const addressHtml = popupMode === 'full'
        ? `<span style="color: #888; font-size: 11px;">${city ? `${escapeHtml(city)}, ` : ''}${escapeHtml(state) || ''}</span><br/>`
        : '';

      const popupContent = `
        <div class="location-popup" style="min-width: 180px;">
          <strong style="font-size: 14px;">${escapeHtml(loc.locnam)}</strong><br/>
          ${categoryHtml}${addressHtml}<button data-location-id="${loc.locid}" class="view-details-btn" style="margin-top: 8px; padding: 6px 12px; background: #1C1C1A; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; width: 100%;">View Details</button>
          ${verifyButtonHtml}
        </div>
      `;

      marker.bindPopup(popupContent);

      if (onLocationVerify && !isVerified && !readonly) {
        marker.options.draggable = true;
        marker.on('dragend', () => {
          const newPos = marker.getLatLng();
          onLocationVerify(loc.locid, newPos.lat, newPos.lng);
        });
      }

      marker.on('click', () => {
        marker.openPopup();
      });

      locationLookup.set(loc.locid, loc);
      markersLayer!.addLayer(marker);
    });

    // Handle single location auto-zoom
    if (locations.length === 1 && !initialViewSet) {
      const coords = getCoordinatesFromAny(locations[0]);
      if (coords) {
        const zoomLevel = zoom ?? (coords.isApproximate ? 10 : 17);
        initialViewSet = true;
        map.setView([coords.lat, coords.lng], zoomLevel);

        if (limitedInteraction) {
          const bounds = L.latLngBounds(
            [coords.lat - 0.005, coords.lng - 0.007],
            [coords.lat + 0.005, coords.lng + 0.007]
          );
          map.setMaxBounds(bounds);
        }
      }
    }
  }

  /**
   * OPT-045: Determine whether to use simple markers or clustering
   * Returns true if we should skip clustering (small dataset)
   */
  function shouldUseSimpleMarkers(): boolean {
    return locations.length <= SIMPLE_MARKER_THRESHOLD;
  }

  /**
   * OPT-042: Schedule cluster initialization with proper async handling
   * OPT-045: Skip clustering entirely for small datasets - use simple markers
   * Uses setTimeout(0) to defer heavy work off the initial render
   */
  function scheduleClusterInit() {
    if (initScheduled) return;
    initScheduled = true;
    clusterReady = false;

    // OPT-045: For small datasets, skip clustering entirely - just render simple markers
    if (shouldUseSimpleMarkers()) {
      usingSimpleMarkers = true;
      // Use requestAnimationFrame to ensure map is painted first
      requestAnimationFrame(() => {
        if (leafletModule) {
          renderSimpleMarkers(leafletModule.default);
        }
        initScheduled = false;
        clusterReady = true;
      });
      return;
    }

    // Large dataset - use full clustering pipeline
    usingSimpleMarkers = false;

    // Use setTimeout(0) to defer to next event loop tick
    // This ensures the map renders first before we start heavy processing
    setTimeout(async () => {
      await initClusterAsync();
      initScheduled = false;
      if (map && leafletModule) {
        await updateClustersAsync(leafletModule.default);
      }
    }, 0);
  }

  function updateClusters(L: any) {
    // OPT-045: If using simple markers mode, re-render directly
    if (usingSimpleMarkers) {
      renderSimpleMarkers(L);
      return;
    }
    if (!map || !markersLayer || !cluster) return;

    markersLayer.clearLayers();

    const bounds = map.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];
    const currentZoom = map.getZoom();

    const clusters = cluster.getClusters(bbox, Math.floor(currentZoom));

    clusters.forEach((feature: any) => {
      const [lng, lat] = feature.geometry.coordinates;

      if (feature.properties.cluster) {
        const count = feature.properties.point_count;
        // OPT-041: Use cached cluster icon - clusters with same count share icons
        const clusterKey = `cluster-${count}`;
        const icon = getCachedIcon(L, clusterKey, () => L.divIcon({
          html: `<div class="cluster-marker">${count}</div>`,
          className: 'cluster-icon',
          iconSize: [40, 40],
        }));
        const marker = L.marker([lat, lng], { icon });

        marker.on('click', () => {
          const expansionZoom = Math.min(
            cluster!.getClusterExpansionZoom(feature.properties.cluster_id),
            MAP_CONFIG.CLUSTER_EXPANSION_MAX_ZOOM
          );
          map!.setView([lat, lng], expansionZoom);
        });

        markersLayer.addLayer(marker);
      } else {
        // OPT-043: Support both Location and MapLocation types
        const location = feature.properties.location as Location | MapLocation;
        const isApproximate = feature.properties.isApproximate || false;
        // OPT-043: Use single cached icon for all pins
        const icon = getPinIcon(L);
        const marker = L.marker([lat, lng], { icon });

        // OPT-043: Use helper functions to extract data from either type
        const isVerified = getVerifiedStatus(location);
        const city = getCity(location);
        const state = getState(location);

        // P3b: Mini location popup with "View Details" and optional "Verify" button
        const verifyButtonHtml = popupMode === 'full' && onLocationVerify && !isVerified
          ? `<button
              data-verify-location-id="${location.locid}"
              class="verify-location-btn"
              style="margin-top: 4px; padding: 6px 12px; background: #4A8C5E; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; width: 100%;"
            >
              Verify Location
            </button>`
          : popupMode === 'full' && isVerified
            ? `<div style="margin-top: 4px; padding: 6px 12px; background: #4A8C5E; color: white; border-radius: 4px; font-size: 11px; text-align: center;">
                Location Verified
              </div>`
            : '';

        // Build popup content based on popupMode
        const categoryHtml = popupMode === 'full'
          ? `<span style="color: #666; font-size: 12px;">${escapeHtml(location.category) || 'Unknown Category'}</span><br/>`
          : '';
        const addressHtml = popupMode === 'full'
          ? `<span style="color: #888; font-size: 11px;">${city ? `${escapeHtml(city)}, ` : ''}${escapeHtml(state) || ''}</span><br/>`
          : '';

        const popupContent = `
          <div class="location-popup" style="min-width: 180px;">
            <strong style="font-size: 14px;">${escapeHtml(location.locnam)}</strong><br/>
            ${categoryHtml}${addressHtml}<button
              data-location-id="${location.locid}"
              class="view-details-btn"
              style="margin-top: 8px; padding: 6px 12px; background: #1C1C1A; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; width: 100%;"
            >
              View Details
            </button>
            ${verifyButtonHtml}
          </div>
        `;

        marker.bindPopup(popupContent);

        // FEAT-P1: Make marker draggable if onLocationVerify is provided
        // DECISION-010: Skip marker dragging when readonly
        if (onLocationVerify && !isVerified && !readonly) {
          marker.options.draggable = true;
          marker.on('dragend', () => {
            const newPos = marker.getLatLng();
            onLocationVerify(location.locid, newPos.lat, newPos.lng);
          });
        }

        // P3b: Click on marker opens popup (not direct navigation)
        marker.on('click', () => {
          marker.openPopup();
        });

        // BUG-V1 FIX: Store location reference for event delegation
        // Event delegation handles clicks at document level - more reliable than DOM manipulation
        locationLookup.set(location.locid, location);

        markersLayer.addLayer(marker);
      }
    });

    // Kanye6/Kanye8/Kanye9: For single location view, zoom based on GPS confidence
    // Kanye11 FIX: Only set view once to prevent infinite loop
    // OPT-043: Use universal coordinate extractor
    if (locations.length === 1 && !initialViewSet) {
      const coords = getCoordinatesFromAny(locations[0]);
      if (coords) {
        // Use prop zoom if provided, otherwise fall back to calculated zoom
        // Street level zoom (17) for exact GPS, city level (10) for approximate
        const zoomLevel = zoom ?? (coords.isApproximate ? 10 : 17);
        initialViewSet = true; // MUST set BEFORE setView to prevent recursion
        map.setView([coords.lat, coords.lng], zoomLevel);

        // DECISION-011: Limited interaction - restrict panning to ~500m from center
        if (limitedInteraction) {
          const bounds = L.latLngBounds(
            [coords.lat - 0.005, coords.lng - 0.007], // ~500m south-west
            [coords.lat + 0.005, coords.lng + 0.007]  // ~500m north-east
          );
          map.setMaxBounds(bounds);
        }
      }
    }

    // Campus map: Add sub-location markers
    if (campusMarkersLayer && campusSubLocations.length > 0) {
      campusMarkersLayer.clearLayers();
      const pinColor = '#1C1C1A'; // braun-900 - neutral black

      campusSubLocations.forEach((subloc) => {
        const icon = L.divIcon({
          html: `<div class="confidence-marker" style="background-color: ${pinColor};"></div>`,
          className: 'confidence-icon',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });

        const marker = L.marker([subloc.gps_lat, subloc.gps_lng], { icon });

        marker.on('click', () => {
          if (onCampusSubLocationClick) {
            onCampusSubLocationClick(subloc.subid);
          }
        });

        marker.bindTooltip(subloc.subnam, {
          permanent: false,
          direction: 'top',
          offset: [0, -8],
        });

        campusMarkersLayer!.addLayer(marker);
      });
    }
  }

  // Track campus sub-locations hash for change detection
  let lastCampusHash = $state('');
  function getCampusHash(subs: CampusSubLocation[]): string {
    return subs.map(s => `${s.subid}:${s.gps_lat}:${s.gps_lng}`).join(',');
  }

  // OPT-057: Track ref map points hash for change detection
  // This ensures Svelte 5's fine-grained reactivity properly detects array changes
  let lastRefMapPointsHash = $state('');
  function getRefMapPointsHash(points: RefMapPoint[]): string {
    // Use pointId as the unique identifier - when a point is linked, it's removed from the array
    return points.map(p => p.pointId).join(',');
  }

  $effect(() => {
    // Kanye9 FIX: Track GPS hash, not just length
    // This triggers re-zoom when forward geocoding updates location GPS
    const currentHash = getLocationsHash(locations);

    // OPT-044: Early-exit guard to prevent re-render storms
    // If hash is empty or unchanged, skip all cluster work
    if (!currentHash || currentHash === lastLocationsHash) {
      // Still need to check campus changes when locations unchanged
      const currentCampusHash = getCampusHash(campusSubLocations);
      if (currentCampusHash !== lastCampusHash && map && markersLayer && leafletModule) {
        lastCampusHash = currentCampusHash;
        updateClustersAsync(leafletModule.default);
      }
      return;
    }

    const currentCampusHash = getCampusHash(campusSubLocations);
    const locationsChanged = currentHash !== lastLocationsHash;
    const campusChanged = currentCampusHash !== lastCampusHash;

    if (map && markersLayer && (locationsChanged || campusChanged)) {
      if (locationsChanged) {
        lastLocationsHash = currentHash;
        // Kanye11 FIX: Reset initialViewSet so map re-zooms when GPS changes
        // DECISION-016: Only reset if no explicit view was provided via props
        if (!hasExplicitView) {
          initialViewSet = false;
        }
        // OPT-042: Use non-blocking cluster initialization
        // scheduleClusterInit handles the async init + update
        scheduleClusterInit();
        return; // scheduleClusterInit will call updateClustersAsync after init
      }
      if (campusChanged) {
        lastCampusHash = currentCampusHash;
        // OPT-042: Use cached Leaflet module instead of dynamic import
        if (leafletModule) {
          updateClustersAsync(leafletModule.default);
        }
      }
    }
  });

  // FIX 6.8: Toggle heat map layer based on showHeatMap prop
  $effect(() => {
    if (!map || !leafletModule) return;

    // OPT-042: Use cached Leaflet module
    const L = leafletModule;

    // Remove existing heat layer if any
    if (heatLayer) {
      map.removeLayer(heatLayer);
      heatLayer = null;
    }

    // Add heat layer if enabled
    if (showHeatMap && locations.length > 0) {
      heatLayer = createHeatLayer(L.default, locations);
      if (heatLayer) {
        heatLayer.addTo(map);
      }
    }
  });

  // Toggle reference map layer based on showRefMapLayer prop
  // OPT-057: Uses hash-based change detection to ensure Svelte 5 reactivity works correctly
  $effect(() => {
    // Track dependencies synchronously before async code
    const shouldShow = showRefMapLayer;
    const points = refMapPoints;
    const mapRef = map;
    const layerRef = refMapLayer;

    // OPT-057: Hash-based change detection - ensures effect runs when points array changes
    // This is critical for link/unlink operations where the array reference changes
    const currentHash = getRefMapPointsHash(points);
    if (currentHash !== lastRefMapPointsHash) {
      lastRefMapPointsHash = currentHash;
    }

    if (!mapRef || !layerRef || !leafletModule) {
      return;
    }

    // OPT-042: Use cached Leaflet module
    const L = leafletModule;

    // Clear existing reference markers
    layerRef.clearLayers();

    if (shouldShow && points.length > 0) {
      // Add layer to map if not already added
      if (!mapRef.hasLayer(layerRef)) {
        layerRef.addTo(mapRef);
      }

      // OPT-041: Cache the reference map icon - all ref points share the same icon
      // OPT-102: Smaller size (10px vs 16px) differentiates from location pins per Braun principles
      const refIcon = getCachedIcon(L.default, 'ref-map-icon', () => L.default.divIcon({
        html: `<div class="ref-map-marker"></div>`,
        className: 'ref-map-icon',
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      }));

      // Create markers for each reference point
      points.forEach((point) => {
        const marker = L.default.marker([point.lat, point.lng], { icon: refIcon });

        // Build popup content
        const name = point.name || 'Unnamed Point';
        const desc = point.description ? `<br/><span style="color: #666; font-size: 11px;">${escapeHtml(point.description.substring(0, 100))}${point.description.length > 100 ? '...' : ''}</span>` : '';
        const category = point.category ? `<br/><span style="color: #888; font-size: 10px;">${escapeHtml(point.category)}</span>` : '';

        marker.bindPopup(`
          <div class="ref-map-popup" style="min-width: 200px;">
            <strong style="font-size: 13px;">${escapeHtml(name)}</strong>
            ${desc}
            ${category}
            <div style="display: flex; gap: 6px; margin-top: 8px;">
              <button class="create-from-ref-btn" data-point-id="${point.pointId}" data-name="${escapeHtml(name)}" data-lat="${point.lat}" data-lng="${point.lng}" data-state="${point.state || ''}" title="Create new location">+ Create</button>
              <button class="link-ref-btn" data-point-id="${point.pointId}" data-name="${escapeHtml(name)}" data-lat="${point.lat}" data-lng="${point.lng}" title="Link to existing location">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
              </button>
              <button class="delete-ref-btn" data-point-id="${point.pointId}" data-name="${escapeHtml(name)}" title="Delete this reference point">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
        `);

        layerRef.addLayer(marker);
      });
    } else {
      // Remove layer from map if currently added
      if (mapRef.hasLayer(layerRef)) {
        mapRef.removeLayer(layerRef);
      }
    }
  });

  onDestroy(() => {
    // BUG-V1 FIX: Clean up event delegation listener
    if (viewDetailsClickHandler) {
      document.removeEventListener('click', viewDetailsClickHandler);
      viewDetailsClickHandler = null;
    }
    // Clean up reference point button listener
    if (createFromRefClickHandler) {
      document.removeEventListener('click', createFromRefClickHandler);
      createFromRefClickHandler = null;
    }
    // Clean up link reference point button listener
    if (linkRefClickHandler) {
      document.removeEventListener('click', linkRefClickHandler);
      linkRefClickHandler = null;
    }
    // Clean up delete reference point button listener
    if (deleteRefClickHandler) {
      document.removeEventListener('click', deleteRefClickHandler);
      deleteRefClickHandler = null;
    }
    locationLookup.clear();
    // OPT-041: Clear icon cache on component destroy to prevent memory leaks
    iconCache.clear();
    if (map) {
      map.remove();
      map = null;
    }
  });
</script>

<div bind:this={mapContainer} class="w-full h-full"></div>

<style>
  :global(.leaflet-container) {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
      'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  }

  :global(.cluster-icon) {
    background: transparent;
    border: none;
  }

  :global(.cluster-marker) {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background-color: var(--color-braun-900, #1C1C1A);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 14px;
    border: 3px solid rgba(255, 255, 255, 0.8);
  }

  :global(.confidence-icon) {
    background: transparent;
    border: none;
  }

  :global(.confidence-marker) {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid white;
  }

  :global(.ref-map-icon) {
    background: transparent;
    border: none;
  }

  :global(.ref-map-marker) {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: #1C1C1A; /* braun-900 - neutral black, smaller than location pins */
    border: 2px solid white;
  }

  :global(.create-from-ref-btn) {
    padding: 4px 8px;
    background: #1C1C1A;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    flex: 1;
  }

  :global(.create-from-ref-btn:hover) {
    background: #5C5C58; /* braun-600 */
  }

  :global(.link-ref-btn) {
    padding: 4px 6px;
    background: #EEEEED;
    color: #5C5C58;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :global(.link-ref-btn:hover) {
    background: #1C1C1A;
    color: white;
  }

  :global(.delete-ref-btn) {
    padding: 4px 6px;
    background: #EEEEED;
    color: #5C5C58;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :global(.delete-ref-btn:hover) {
    background: #AE1C09; /* Oxidized Iron - danger red */
    color: white;
  }
</style>
