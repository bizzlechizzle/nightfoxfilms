<script lang="ts">
  /**
   * LocationDetail - Master orchestrator for location detail page
   * Per LILBITS: ~250 lines (orchestrator coordinating child components)
   * Per PUEA: Show only sections with data
   * Per AAA: Import shows results immediately
   * DECISION-014: Removed auto-geocoding from onMount (GPS from EXIF/user action only)
   */
  import { onMount, onDestroy } from 'svelte';
  import { router } from '../stores/router';
  import { importStore, isImporting } from '../stores/import-store';
  import { toasts } from '../stores/toast-store';
  import LocationEditForm from '../components/LocationEditForm.svelte';
  import NotesSection from '../components/NotesSection.svelte';
  import MediaViewer from '../components/MediaViewer.svelte';
  import {
    LocationInfo, LocationTimeline, LocationInfoHorizontal,
    LocationMapSection, LocationRecords, LocationResearch,
    LocationImportZone, LocationBookmarks, LocationNerdStats,
    LocationSettings, SubLocationGrid,
    type MediaImage, type MediaVideo, type MediaDocument, type MediaMap, type Bookmark,
    type GpsWarning, type FailedFile
  } from '../components/location';
  import WebSourceDetailModal from '../components/location/WebSourceDetailModal.svelte';
  import DateExtractionReview from '../components/location/DateExtractionReview.svelte';
  import type { Location, LocationInput } from '@au-archive/core';
  import { ACCESS_OPTIONS } from '../constants/location-enums';

  interface Props {
    locationId: string;
    subId?: string | null; // If provided, viewing a sub-location
  }
  let { locationId, subId = null }: Props = $props();

  // Sub-location type (Migration 28 + Migration 31 GPS + Migration 32 AKA/Historical)
  interface SubLocation {
    subid: string;
    sub12: string;
    locid: string;
    subnam: string;
    ssubname: string | null;
    category: string | null;
    status: string | null;
    hero_imghash: string | null;
    hero_focal_x?: number;  // OPT-095: Hero focal point X (0-1)
    hero_focal_y?: number;  // OPT-095: Hero focal point Y (0-1)
    is_primary: boolean;
    hero_thumb_path?: string;
    // Migration 31: Sub-location GPS (separate from host location)
    gps_lat: number | null;
    gps_lng: number | null;
    gps_accuracy: number | null;
    gps_source: string | null;
    gps_verified_on_map: boolean;
    gps_captured_at: string | null;
    // Migration 32: AKA name (historicalName removed)
    akanam: string | null;
  }

  // State
  let location = $state<Location | null>(null);
  let sublocations = $state<SubLocation[]>([]);
  let currentSubLocation = $state<SubLocation | null>(null); // When viewing a sub-location
  let images = $state<MediaImage[]>([]);
  let videos = $state<MediaVideo[]>([]);
  let documents = $state<MediaDocument[]>([]);
  let maps = $state<MediaMap[]>([]); // MAP-MEDIA-FIX-001: Map media support
  // Issue 3: All media for author extraction (includes sub-location media on host view)
  let allImagesForAuthors = $state<MediaImage[]>([]);
  let allVideosForAuthors = $state<MediaVideo[]>([]);
  let allDocumentsForAuthors = $state<MediaDocument[]>([]);
  let bookmarks = $state<Bookmark[]>([]);
  let failedFiles = $state<FailedFile[]>([]);
  let gpsWarnings = $state<GpsWarning[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let isEditing = $state(false);
  let selectedMediaIndex = $state<number | null>(null);
  let currentUser = $state('default');
  let isDragging = $state(false);
  let verifyingGps = $state(false);
  let togglingFavorite = $state(false);

  // Verify Location modal state (one-off modal for new imports)
  let showVerifyModal = $state(false);
  let verifyForm = $state({
    locnam: '',
    category: '',
    class: '',
    access: '',
  });
  let verifyCategoryOptions = $state<string[]>([]);
  let verifyClassOptions = $state<string[]>([]);
  let savingVerify = $state(false);

  // OPT-119: Timeline web page detail modal state
  let showWebSourceModal = $state(false);
  let webSourceModalId = $state<string | null>(null);

  // Timeline highlight box - reference to Research section for expand on click
  let researchRef: { expand: () => void } | undefined;

  // Handle timeline expand - scroll to Research section and auto-expand
  function handleTimelineExpand() {
    const researchEl = document.getElementById('research-section');
    if (researchEl) {
      researchEl.scrollIntoView({ behavior: 'smooth' });
    }
    researchRef?.expand();
  }

  // Derived: Are we viewing a sub-location?
  const isViewingSubLocation = $derived(!!subId && !!currentSubLocation);

  // Campus map: sub-locations with GPS coordinates
  const subLocationsWithGps = $derived(
    sublocations.filter(s => s.gps_lat !== null && s.gps_lng !== null)
  );

  // Verification status for status line (green/yellow/red)
  // MASTER VERIFICATION LOGIC - Weighted scoring:
  //   Information (65%) + Location (25%) + Hero Image (10%)
  // Colors: 0-80% = red, 80-100% = yellow, 100% = green
  const verificationStatus = $derived.by((): 'green' | 'yellow' | 'red' => {
    if (!location) return 'red';

    // Information score (65% weight) - ALWAYS from host location
    const infoComplete = !!(location.category && location.class && location.access);
    const infoScore = infoComplete ? 100 : 0;

    // Location score (25% weight) - GPS from sub-location when viewing building
    let hasGps: boolean;
    let gpsVerified: boolean;

    if (isViewingSubLocation && currentSubLocation) {
      hasGps = currentSubLocation.gps_lat != null && currentSubLocation.gps_lng != null;
      gpsVerified = currentSubLocation.gps_verified_on_map === true;
    } else {
      hasGps = location.gps?.lat != null && location.gps?.lng != null;
      gpsVerified = location.gps?.verifiedOnMap === true;
    }

    const hasAddress = !!(location.address?.city || location.address?.state);
    const addressVerified = location.address?.verified === true;

    // Location: 0% if missing data, 80% if has data but unverified, 100% if verified
    const locationScore = (!hasGps || !hasAddress) ? 0
      : (!gpsVerified || !addressVerified) ? 80
      : 100;

    // Hero Image score (10% weight) - from sub-location when viewing building, else host
    const heroHash = isViewingSubLocation && currentSubLocation
      ? currentSubLocation.hero_imghash
      : location.hero_imghash;
    const heroScore = heroHash ? 100 : 0;

    // Weighted total: Information (65%) + Location (25%) + Hero (10%)
    const total = (infoScore * 0.65) + (locationScore * 0.25) + (heroScore * 0.10);

    if (total >= 100) return 'green';
    if (total >= 80) return 'yellow';
    return 'red';
  });

  // Migration 26: Import attribution modal
  let showAttributionModal = $state(false);
  let pendingImportPaths = $state<string[]>([]);
  let isSomeoneElse = $state(false); // false = current user, true = someone else
  let selectedAuthor = $state(''); // username of selected author (or 'external')
  let contributionSource = $state(''); // for external contributors
  let users = $state<Array<{user_id: string, username: string, display_name: string | null}>>([]);

  // Migration 28: Add Building modal
  // Migration 65: Added category/class for sub-location taxonomy
  let showAddBuildingModal = $state(false);
  let newBuildingName = $state('');
  let newBuildingCategory = $state('');
  let newBuildingClass = $state('');
  let newBuildingIsPrimary = $state(false);
  let addingBuilding = $state(false);
  // Migration 65: Autocomplete options for sub-location categories (separate from host)
  let sublocCategoryOptions = $state<string[]>([]);
  let sublocClassOptions = $state<string[]>([]);

  // OPT-066: Track if sub-locations tagline wraps to multiple lines
  let sublocTaglineEl = $state<HTMLElement | null>(null);
  let sublocTaglineWraps = $state(false);

  // Auto-shrink title to fit single line
  let titleEl = $state<HTMLHeadingElement | null>(null);
  const TITLE_BASE_FONT_SIZE = 48; // text-5xl = 3rem = 48px
  const TITLE_MIN_FONT_SIZE = 24;  // Don't go smaller than this

  // OPT-092: Trailing debounce for background job notifications
  // Accumulate events, show ONE toast per category after 3s of quiet
  const pendingNotifications = { images: false, videos: false, gps: false };
  let notificationTimer: ReturnType<typeof setTimeout> | null = null;
  const NOTIFICATION_DELAY_MS = 3000;

  function notifyRefresh(type: 'images' | 'videos' | 'gps') {
    pendingNotifications[type] = true;

    // Reset timer on each event (trailing debounce)
    if (notificationTimer) clearTimeout(notificationTimer);

    notificationTimer = setTimeout(() => {
      if (pendingNotifications.images) {
        toasts.info('Images updated', 3000);
        pendingNotifications.images = false;
      }
      if (pendingNotifications.videos) {
        toasts.info('Videos updated', 3000);
        pendingNotifications.videos = false;
      }
      if (pendingNotifications.gps) {
        toasts.info('GPS location updated', 4000);
        pendingNotifications.gps = false;
      }
      notificationTimer = null;
    }, NOTIFICATION_DELAY_MS);
  }

  // OPT-110: Debounced loadLocation to prevent page flash from rapid asset-ready events
  // When multiple background jobs complete (thumbnails, metadata, proxies), coalesce into single refresh
  let loadLocationDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const LOAD_LOCATION_DEBOUNCE_MS = 300;

  function debouncedLoadLocation() {
    if (loadLocationDebounceTimer) {
      clearTimeout(loadLocationDebounceTimer);
    }
    loadLocationDebounceTimer = setTimeout(async () => {
      loadLocationDebounceTimer = null;
      await loadLocation();
    }, LOAD_LOCATION_DEBOUNCE_MS);
  }

  // Derived: Combined media list for MediaViewer (images first, then videos)
  // OPT-105: Added thumbPathLg for fallback chain (RAW files without extracted preview)
  const imageMediaList = $derived(images.map(img => ({
    hash: img.imghash, path: img.imgloc,
    thumbPath: img.thumb_path_sm || img.thumb_path || null,
    thumbPathLg: img.thumb_path_lg || null,
    previewPath: img.preview_path || null, type: 'image' as const,
    name: img.imgnam, width: img.meta_width, height: img.meta_height,
    dateTaken: img.meta_date_taken, cameraMake: img.meta_camera_make || null,
    cameraModel: img.meta_camera_model || null,
    gpsLat: img.meta_gps_lat || null, gpsLng: img.meta_gps_lng || null,
    // Hidden status (Migration 23)
    hidden: img.hidden ?? 0,
    hidden_reason: img.hidden_reason ?? null,
    is_live_photo: img.is_live_photo ?? 0,
    // Author tracking (Migration 25/26)
    auth_imp: img.auth_imp ?? null,
    imported_by: img.imported_by ?? null,
    is_contributed: img.is_contributed ?? 0,
    contribution_source: img.contribution_source ?? null,
  })));

  const videoMediaList = $derived(videos.map(vid => ({
    hash: vid.vidhash, path: vid.vidloc,
    thumbPath: vid.thumb_path_sm || vid.thumb_path || null,
    thumbPathLg: vid.thumb_path_lg || null,
    previewPath: vid.preview_path || null, type: 'video' as const,
    name: vid.vidnam, width: vid.meta_width, height: vid.meta_height,
    dateTaken: null, cameraMake: null, cameraModel: null,
    gpsLat: vid.meta_gps_lat || null, gpsLng: vid.meta_gps_lng || null,
    // Hidden status (Migration 23)
    hidden: vid.hidden ?? 0,
    hidden_reason: vid.hidden_reason ?? null,
    is_live_photo: vid.is_live_photo ?? 0,
    // Author tracking (Migration 25/26)
    auth_imp: vid.auth_imp ?? null,
    imported_by: vid.imported_by ?? null,
    is_contributed: vid.is_contributed ?? 0,
    contribution_source: vid.contribution_source ?? null,
  })));

  // Combined list: images first, then videos
  const mediaViewerList = $derived([...imageMediaList, ...videoMediaList]);

  // Hero image thumbnail path for LocationInfo hero box
  // OPT-095: Search ALL images (including sublocation images) since host location hero
  // may be set from a sublocation's image, not just campus-level media
  const heroThumbPath = $derived.by(() => {
    const heroHash = currentSubLocation?.hero_imghash || location?.hero_imghash;
    if (!heroHash) return null;
    // Search allImagesForAuthors which contains ALL images regardless of subid filtering
    const heroImg = allImagesForAuthors.find(img => img.imghash === heroHash);
    return heroImg?.thumb_path_lg || heroImg?.thumb_path || null;
  });

  // Handle hero image click - open MediaViewer at hero image
  // OPT-095: Note - this only works if hero is in current view's images array.
  // If host hero is from a sublocation, clicking won't open MediaViewer (user must navigate to sublocation).
  // This is acceptable behavior since we at least DISPLAY the hero thumbnail now.
  function handleHeroClick() {
    const heroHash = currentSubLocation?.hero_imghash || location?.hero_imghash;
    if (!heroHash) return;
    const index = images.findIndex(img => img.imghash === heroHash);
    if (index >= 0) selectedMediaIndex = index;
  }

  // OPT-066: Detect if sub-locations tagline wraps to multiple lines
  function checkTaglineWrap() {
    const el = sublocTaglineEl;
    if (!el) { sublocTaglineWraps = false; return; }
    // Compare scroll height to single line height (font-size 18px * ~1.5 line-height ≈ 27px)
    // If taller than ~32px, it's wrapping
    sublocTaglineWraps = el.scrollHeight > 32;
  }

  $effect(() => {
    const el = sublocTaglineEl;
    const subs = sublocations; // Track dependency
    if (!el) return;

    requestAnimationFrame(checkTaglineWrap);

    const resizeObserver = new ResizeObserver(checkTaglineWrap);
    resizeObserver.observe(el);

    return () => resizeObserver.disconnect();
  });

  // Auto-shrink title effect: reduce font size until title fits on single line
  $effect(() => {
    const el = titleEl;
    // Track dependencies to re-run when location/sublocation changes
    const _loc = location?.locnam;
    const _sub = currentSubLocation?.subnam;
    if (!el) return;

    // Use rAF to ensure DOM has updated
    requestAnimationFrame(() => {
      // Reset to base size first
      el.style.fontSize = `${TITLE_BASE_FONT_SIZE}px`;
      el.style.whiteSpace = 'nowrap';

      // Shrink until it fits (or hit minimum)
      let fontSize = TITLE_BASE_FONT_SIZE;
      while (el.scrollWidth > el.clientWidth && fontSize > TITLE_MIN_FONT_SIZE) {
        fontSize -= 2;
        el.style.fontSize = `${fontSize}px`;
      }
    });
  });

  // Load functions
  // Migration 28 + OPT-062: Check if this is a host location
  // Use database flag OR existing sub-locations (flag allows host-only without sub-locations yet)
  const isHostLocation = $derived(location?.isHostOnly || sublocations.length > 0);

  // OPT-119: Timeline web page modal handlers
  function handleOpenWebSource(websourceId: string) {
    webSourceModalId = websourceId;
    showWebSourceModal = true;
  }

  function handleCloseWebSourceModal() {
    showWebSourceModal = false;
    webSourceModalId = null;
  }

  async function loadLocation() {
    try {
      loading = true; error = null;

      // OPT-094: Server-side filtering for sub-location media
      // - subId provided (viewing sub-location): pass subid to get that sub's media
      // - subId null (viewing host/regular): pass null to get host-level media (subid IS NULL)
      // This works for both host locations (returns campus-level) and regular locations (all media has subid=null)
      const querySubid = subId || null;

      const [loc, media, allMedia, sublocs] = await Promise.all([
        window.electronAPI.locations.findById(locationId),
        // Filtered media for display (server-side filtering)
        window.electronAPI.media.findByLocation({ locid: locationId, subid: querySubid }),
        // All media for author extraction (Issue 3 - needs ALL media including sub-location)
        window.electronAPI.media.findByLocation(locationId),
        window.electronAPI.sublocations.findWithHeroImages(locationId),
      ]);
      location = loc;
      if (!location) { error = 'Location not found'; return; }

      // Migration 28: Load sub-locations
      sublocations = sublocs || [];

      // If subId is provided, load the specific sub-location
      if (subId) {
        currentSubLocation = await window.electronAPI.sublocations.findById(subId);
        if (!currentSubLocation) {
          error = 'Sub-location not found';
          return;
        }
      } else {
        currentSubLocation = null;
      }

      // Issue 3: Store all media for author extraction (used by LocationInfo)
      if (allMedia) {
        allImagesForAuthors = (allMedia.images as MediaImage[]) || [];
        allVideosForAuthors = (allMedia.videos as MediaVideo[]) || [];
        allDocumentsForAuthors = (allMedia.documents as MediaDocument[]) || [];
      }

      // OPT-094: Server-side filtering - no client-side filtering needed
      // Server returns exact data based on subid parameter:
      // ADR-046: subid is 16-char BLAKE3 hex ID
      // - subid = '<blake3-id>' → returns only that sub-location's media
      // - subid = null → returns only host-level media (subid IS NULL in DB)
      // MAP-MEDIA-FIX-001: Added maps support
      if (media) {
        images = (media.images as MediaImage[]) || [];
        videos = (media.videos as MediaVideo[]) || [];
        documents = (media.documents as MediaDocument[]) || [];
        maps = (media.maps as MediaMap[]) || [];
      }
    } catch (err) {
      console.error('Error loading location:', err);
      error = 'Failed to load location';
    } finally { loading = false; }
  }

  async function loadBookmarks() {
    if (!window.electronAPI?.bookmarks) return;
    try {
      bookmarks = await window.electronAPI.bookmarks.findByLocation(locationId) || [];
    } catch (err) { console.error('Error loading bookmarks:', err); }
  }

  /**
   * Kanye9: Auto forward geocode using cascade strategy
   * Tries: full address → city+state → zipcode → county+state → state only
   */
  async function ensureGpsFromAddress(): Promise<void> {
    if (!location) return;
    if (location.gps?.lat && location.gps?.lng) return;

    const addr = location.address;
    // Need at least one geocodable field
    const hasGeocodeData = addr?.street || addr?.city || addr?.zipcode || addr?.county || addr?.state;
    if (!hasGeocodeData) return;

    try {
      // Use cascade geocoding - tries multiple strategies until one succeeds
      const result = await window.electronAPI.geocode.forwardCascade({
        street: addr?.street || null,
        city: addr?.city || null,
        county: addr?.county || null,
        state: addr?.state || null,
        zipcode: addr?.zipcode || null,
      });

      if (result?.lat && result?.lng) {
        // Kanye11 FIX: Use nested gps object per LocationInputSchema, NOT flat gps_lat/gps_lng fields
        await window.electronAPI.locations.update(location.locid, {
          gps: {
            lat: result.lat,
            lng: result.lng,
            source: 'geocoded_address',
            verifiedOnMap: false,
            // Kanye9: Store tier for accurate map zoom
            geocodeTier: result.cascadeTier,
            geocodeQuery: result.cascadeQuery,
          }
        });
        await loadLocation();
      }
    } catch (err) {
      console.error('Cascade geocoding failed:', err);
    }
  }

  // Action handlers
  async function handleSave(updates: Partial<LocationInput>) {
    if (!location) return;
    await window.electronAPI.locations.update(location.locid, updates);
    await loadLocation();
    isEditing = false;
  }

  // Migration 32: Dual save handler for sub-location edit (saves to both subloc and host location)
  interface SubLocationUpdates {
    subnam?: string;
    ssubname?: string | null;
    type?: string | null;
    status?: string | null;
    is_primary?: boolean;
    akanam?: string | null;
  }

  async function handleSubLocationSave(subUpdates: SubLocationUpdates, locUpdates: Partial<LocationInput>) {
    if (!currentSubLocation || !location) return;
    try {
      // Save sub-location fields
      await window.electronAPI.sublocations.update(currentSubLocation.subid, subUpdates);
      // Save host location fields (campus-level info)
      if (Object.keys(locUpdates).length > 0) {
        await window.electronAPI.locations.update(location.locid, locUpdates);
      }
      // Reload to get updated data
      await loadLocation();
    } catch (err) {
      console.error('Error saving sub-location:', err);
      throw err;
    }
  }

  // Verify Location modal handlers
  async function openVerifyModal() {
    if (!location) return;
    // Populate form with current values
    verifyForm = {
      locnam: location.locnam || '',
      category: location.category || '',
      class: location.class || '',
      access: location.access || '',
    };
    // Load category/class options
    try {
      const [categories, classes] = await Promise.all([
        window.electronAPI?.locations?.getDistinctCategories?.() || [],
        window.electronAPI?.locations?.getDistinctClasses?.() || [],
      ]);
      verifyCategoryOptions = categories;
      verifyClassOptions = classes;
    } catch (err) {
      console.error('Error loading category options:', err);
    }
    showVerifyModal = true;
  }

  async function handleVerifySave() {
    if (!location || savingVerify) return;
    savingVerify = true;
    try {
      await window.electronAPI.locations.update(location.locid, {
        locnam: verifyForm.locnam,
        category: verifyForm.category || undefined,
        class: verifyForm.class || undefined,
        access: verifyForm.access || undefined,
      });
      await loadLocation();
      showVerifyModal = false;
    } catch (err) {
      console.error('Error saving verification:', err);
    } finally {
      savingVerify = false;
    }
  }

  async function toggleFavorite() {
    if (!location || togglingFavorite) return;
    try {
      togglingFavorite = true;
      await window.electronAPI.locations.toggleFavorite(location.locid);
      await loadLocation();
    } catch (err) { console.error('Error toggling favorite:', err); }
    finally { togglingFavorite = false; }
  }

  async function markGpsVerified() {
    if (!location) return;
    try {
      verifyingGps = true;
      // Migration 31: If viewing sub-location, verify sub-location GPS (separate from host)
      if (isViewingSubLocation && currentSubLocation) {
        await window.electronAPI.sublocations.verifyGps(currentSubLocation.subid);
        // Refresh sub-location data
        currentSubLocation = await window.electronAPI.sublocations.findById(currentSubLocation.subid);
      } else {
        // Host location GPS
        await window.electronAPI.locations.update(locationId, { gps: { ...location.gps, verifiedOnMap: true } });
        await loadLocation();
      }
    } catch (err) { console.error('Error marking GPS verified:', err); }
    finally { verifyingGps = false; }
  }

  /**
   * Migration 31: Save GPS from map click for sub-location
   * Updates sub-location's own GPS (not the host location)
   */
  async function saveSubLocationGps(lat: number, lng: number) {
    if (!currentSubLocation) return;
    try {
      await window.electronAPI.sublocations.updateGps(currentSubLocation.subid, {
        lat, lng, source: 'user_map_click',
      });
      // Refresh sub-location data
      currentSubLocation = await window.electronAPI.sublocations.findById(currentSubLocation.subid);
      toasts.success('Building GPS updated');
    } catch (err) {
      console.error('Error saving sub-location GPS:', err);
      toasts.error('Failed to save GPS');
    }
  }

  /**
   * DECISION-011 & DECISION-017: Handle location save from edit modal
   * Saves address, GPS, verification status, and cultural regions
   */
  interface RegionSaveData {
    culturalRegion: string | null;
    localCulturalRegionVerified: boolean;
    countryCulturalRegion: string | null;
    countryCulturalRegionVerified: boolean;
  }

  async function handleLocationSave(
    updates: Partial<LocationInput>,
    addressVerified: boolean,
    gpsVerified: boolean,
    regionData: RegionSaveData
  ) {
    if (!location) return;

    // Build full update object
    const fullUpdates: any = { ...updates };

    // Set address verification
    if (updates.address) {
      fullUpdates.address = {
        ...updates.address,
        verified: addressVerified,
      };
    }

    // Set GPS verification
    if (updates.gps) {
      fullUpdates.gps = {
        ...updates.gps,
        verifiedOnMap: gpsVerified,
      };
    }

    // Update location via API
    await window.electronAPI.locations.update(location.locid, fullUpdates);

    // DECISION-017: Update cultural regions and verification status
    if (window.electronAPI.locations.updateRegionData) {
      await window.electronAPI.locations.updateRegionData(location.locid, regionData);
    } else if (window.electronAPI.locations.updateCulturalRegion) {
      // Fallback: use legacy API for local cultural region only
      await window.electronAPI.locations.updateCulturalRegion(location.locid, regionData.culturalRegion);
    }

    await loadLocation();
  }

  /** Set hero image for card thumbnails */
  async function setHeroImage(imghash: string) {
    if (!location) return;
    try {
      await window.electronAPI.locations.update(locationId, { hero_imghash: imghash });
      await loadLocation();
    } catch (err) { console.error('Error setting hero image:', err); }
  }

  /** Migration 23: Handle hidden status changes from MediaViewer */
  function handleHiddenChanged(hash: string, hidden: boolean) {
    // Update local state immediately for responsive UI
    const imgIndex = images.findIndex(i => i.imghash === hash);
    if (imgIndex >= 0) {
      images[imgIndex] = { ...images[imgIndex], hidden: hidden ? 1 : 0, hidden_reason: hidden ? 'user' : null };
      images = [...images]; // Trigger reactivity
      return;
    }
    const vidIndex = videos.findIndex(v => v.vidhash === hash);
    if (vidIndex >= 0) {
      videos[vidIndex] = { ...videos[vidIndex], hidden: hidden ? 1 : 0, hidden_reason: hidden ? 'user' : null };
      videos = [...videos]; // Trigger reactivity
    }
  }

  /** Handle media deletion from MediaViewer */
  function handleMediaDeleted(hash: string, type: 'image' | 'video' | 'document') {
    // Remove from local state immediately for responsive UI
    if (type === 'image') {
      images = images.filter(i => i.imghash !== hash);
    } else if (type === 'video') {
      videos = videos.filter(v => v.vidhash !== hash);
    } else {
      documents = documents.filter(d => d.dochash !== hash);
    }
  }

  /** Handle media moved to sub-location from MediaViewer */
  async function handleMediaMoved(hash: string, type: 'image' | 'video' | 'document', subid: string | null) {
    // Reload to get fresh data
    await loadLocation();
  }

  function navigateToFilter(type: string, value: string, additionalFilters?: Record<string, string>) {
    // DECISION-013: Support multiple filters (e.g., county + state to avoid duplicates)
    const filters: Record<string, string> = { [type]: value, ...additionalFilters };
    router.navigate('/locations', undefined, filters);
  }

  async function openMediaFile(filePath: string) {
    try { await window.electronAPI.media.openFile(filePath); }
    catch (err) { console.error('Error opening file:', err); }
  }

  // Import handlers
  function handleDragOver(e: DragEvent) { e.preventDefault(); isDragging = true; }
  function handleDragLeave() { isDragging = false; }

  async function handleDrop(e: DragEvent) {
    e.preventDefault(); isDragging = false;
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0 || !location) return;
    await new Promise(r => setTimeout(r, 10));
    const droppedPaths = window.getDroppedFilePaths?.() || [];
    if (droppedPaths.length === 0) { toasts.warning('No valid files found'); return; }
    if (!window.electronAPI?.media?.expandPaths) { toasts.error('API not available'); return; }
    const expandedPaths = await window.electronAPI.media.expandPaths(droppedPaths);
    if (expandedPaths.length > 0) {
      // Show attribution modal instead of importing directly
      pendingImportPaths = expandedPaths;
      isSomeoneElse = false;
      selectedAuthor = '';
      contributionSource = '';
      showAttributionModal = true;
    }
    else { toasts.warning('No supported media files found'); }
  }

  async function handleSelectFiles() {
    if (!location || !window.electronAPI?.media?.selectFiles) return;
    try {
      const filePaths = await window.electronAPI.media.selectFiles();
      if (!filePaths || filePaths.length === 0) return;
      if (window.electronAPI.media.expandPaths) {
        const expandedPaths = await window.electronAPI.media.expandPaths(filePaths);
        if (expandedPaths.length > 0) {
          // Show attribution modal instead of importing directly
          pendingImportPaths = expandedPaths;
          isSomeoneElse = false;
          selectedAuthor = '';
          contributionSource = '';
          showAttributionModal = true;
        }
        else { toasts.warning('No supported media files found'); }
      } else {
        pendingImportPaths = filePaths;
        isSomeoneElse = false;
        selectedAuthor = '';
        contributionSource = '';
        showAttributionModal = true;
      }
    } catch (err) { console.error('Error selecting files:', err); toasts.error('Error selecting files'); }
  }

  // Called when user confirms attribution in modal
  function confirmImport() {
    showAttributionModal = false;
    if (pendingImportPaths.length > 0) {
      // Determine author and contribution status
      let author = currentUser;
      let isContributed = 0;
      let source = '';

      if (isSomeoneElse) {
        if (selectedAuthor === 'external') {
          // External contributor
          isContributed = 1;
          source = contributionSource;
          author = currentUser; // Current user is importing on behalf of external
        } else {
          // Another registered user is the author
          author = selectedAuthor;
          isContributed = 0;
        }
      }

      importFilePaths(pendingImportPaths, author, isContributed, source);
      pendingImportPaths = [];
    }
  }

  function cancelImport() {
    showAttributionModal = false;
    pendingImportPaths = [];
    isSomeoneElse = false;
    selectedAuthor = '';
    contributionSource = '';
  }

  /**
   * Import files using v2 pipeline
   * Per Import Spec v2.0: 5-step pipeline with background jobs
   * - No chunking needed (v2 handles streaming internally)
   * - Progress via IPC events
   * - Background jobs for thumbnails/metadata
   */
  async function importFilePaths(filePaths: string[], author: string, contributed: number = 0, source: string = '') {
    if (!location || $isImporting) return;

    // Import job label varies based on whether viewing sub-location
    const jobLabel = currentSubLocation
      ? `${location.locnam} / ${currentSubLocation.subnam}`
      : location.locnam;
    importStore.startJob(location.locid, jobLabel, filePaths.length);

    // Set up progress listener for real-time updates
    const unsubscribeProgress = window.electronAPI.importV2.onProgress((progress) => {
      // OPT-088: Update store with v2 progress including weighted percent
      // OPT-091: Pass currentFile for activity indicator display
      // Progress display handled by store + LocationImportZone clean progress bar
      importStore.updateProgress(progress.filesProcessed, progress.filesTotal, progress.percent, progress.currentFile, progress.sessionId);
    });

    try {
      // Use v2 import - no chunking needed, handles streaming internally
      // OPT-080: Force plain object to avoid Svelte $state() proxy serialization issues
      const importInput = JSON.parse(JSON.stringify({
        paths: filePaths,
        locid: location.locid,
        loc12: location.loc12,
        address_state: location.address?.state || null,
        category: location.category || null,
        slocnam: currentSubLocation?.subnam || null,
        subid: subId || null,
        auth_imp: author,
        is_contributed: contributed,
        contribution_source: source || null,
      }));
      console.log('[LocationDetail] Calling importV2.start with:', importInput);
      const result = await window.electronAPI.importV2.start(importInput);

      // Extract results
      const totalImported = result.finalizationResult?.totalFinalized ?? 0;
      const totalDuplicates = result.hashResult?.totalDuplicates ?? 0;
      const totalErrors = result.finalizationResult?.totalErrors ?? 0;
      const jobsQueued = result.finalizationResult?.jobsQueued ?? 0;

      // Handle result status
      if (result.status === 'failed' && result.error) {
        const errorMsg = `Import failed: ${result.error}`;
        importStore.completeJob(undefined, errorMsg);
        toasts.error(errorMsg);
      } else if (result.status === 'cancelled') {
        importStore.completeJob(undefined, 'Import cancelled');
        toasts.info('Import was cancelled');
      } else {
        // Success or partial success
        importStore.completeJob({ imported: totalImported, duplicates: totalDuplicates, errors: totalErrors });

        if (totalErrors > 0) {
          toasts.warning(`Imported ${totalImported} files. ${totalErrors} failed.`);
        } else if (totalImported > 0) {
          toasts.success(`Successfully imported ${totalImported} files`);
          failedFiles = [];
        } else if (totalDuplicates > 0) {
          toasts.info(`${totalDuplicates} files were already in archive`);
        }
      }

      await loadLocation();
      const mediaSection = document.getElementById('media-gallery');
      if (mediaSection) {
        mediaSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      importStore.completeJob(undefined, msg);
      toasts.error(`Import error: ${msg}`);
    } finally {
      // Clean up progress listener
      unsubscribeProgress();
    }
  }

  async function retryFailedImports() {
    if (failedFiles.length === 0) return;
    const paths = failedFiles.map(f => f.filePath);
    failedFiles = [];
    // Retry with current user as author
    await importFilePaths(paths, currentUser, 0, '');
  }

  // Bookmark handlers
  // Migration 28: Add Building handlers
  async function openAddBuildingModal() {
    newBuildingName = '';
    newBuildingCategory = '';
    newBuildingClass = '';
    newBuildingIsPrimary = sublocations.length === 0; // First building is primary by default
    showAddBuildingModal = true;

    // Migration 65: Load sub-location category options (separate from host locations)
    try {
      const [categories, classes] = await Promise.all([
        window.electronAPI?.sublocations?.getDistinctCategories?.() || [],
        window.electronAPI?.sublocations?.getDistinctClasses?.() || [],
      ]);
      sublocCategoryOptions = categories;
      sublocClassOptions = classes;
    } catch (err) {
      console.error('Error loading sub-location category options:', err);
    }
  }

  // Convert to Host Location - opens Add Building modal (adding first building makes it a host)
  async function handleConvertToHost() {
    openAddBuildingModal();
  }

  function closeAddBuildingModal() {
    showAddBuildingModal = false;
    newBuildingName = '';
    newBuildingCategory = '';
    newBuildingClass = '';
    newBuildingIsPrimary = false;
    addingBuilding = false;
  }

  async function handleAddBuilding() {
    if (!newBuildingName.trim() || !location) return;

    try {
      addingBuilding = true;
      await window.electronAPI.sublocations.create({
        locid: location.locid,
        subnam: newBuildingName.trim(),
        // Migration 65: Use sub-location specific category/class (not host's category)
        category: newBuildingCategory.trim() || null,
        class: newBuildingClass.trim() || null,
        status: null,
        is_primary: newBuildingIsPrimary,
        created_by: currentUser || null,
      });

      closeAddBuildingModal();
      toasts.success(`Building "${newBuildingName.trim()}" added`);

      // Reload sub-locations
      sublocations = await window.electronAPI.sublocations.findWithHeroImages(location.locid);
    } catch (err) {
      console.error('Error adding building:', err);
      toasts.error('Failed to add building');
    } finally {
      addingBuilding = false;
    }
  }

  async function handleAddBookmark(data: { url: string; title: string; description: string; type: string }) {
    if (!window.electronAPI?.bookmarks) return;
    await window.electronAPI.bookmarks.create({ locid: locationId, url: data.url, url_title: data.title || null, url_description: data.description || null, url_type: data.type || null, auth_imp: currentUser });
    await loadBookmarks();
  }

  async function handleDeleteBookmark(urlid: string) {
    if (!window.electronAPI?.bookmarks) return;
    await window.electronAPI.bookmarks.delete(urlid);
    await loadBookmarks();
  }

  function handleOpenBookmark(url: string) { window.electronAPI?.shell?.openExternal(url); }

  // OPT-087 + OPT-090 + OPT-105: Handle asset-ready events for surgical refresh + notifications
  function handleAssetReady(event: CustomEvent<{
    type: string;
    hash?: string;
    locid?: string;
    lat?: number;
    lng?: number;
    paths?: { sm?: string; lg?: string; preview?: string };
    proxyPath?: string;
  }>) {
    const { type, hash, paths, locid, lat, lng } = event.detail;

    // OPT-105: Debug logging for asset-ready events
    console.log('[LocationDetail] asset-ready event:', { type, hash, locid, hasPath: !!paths });

    // OPT-090: Handle GPS enrichment for current location
    // OPT-110: Use debounced reload to prevent page flash
    if (type === 'gps-enriched' && locid === locationId && lat != null && lng != null) {
      console.log('[LocationDetail] GPS enriched, scheduling debounced reload');
      debouncedLoadLocation();
      notifyRefresh('gps');
      return;
    }

    // Handle thumbnail ready (images and videos)
    if (type === 'thumbnail' && paths && hash) {
      // Update image thumbnail paths
      const imgIndex = images.findIndex(img => img.imghash === hash);
      if (imgIndex >= 0) {
        console.log('[LocationDetail] Updating image thumbnail:', hash);
        images[imgIndex] = {
          ...images[imgIndex],
          thumb_path_sm: paths.sm || images[imgIndex].thumb_path_sm,
          thumb_path_lg: paths.lg || images[imgIndex].thumb_path_lg,
          preview_path: paths.preview || images[imgIndex].preview_path,
        };
        images = [...images]; // Trigger reactivity
        notifyRefresh('images'); // OPT-090
        return;
      }

      // Update video thumbnail paths
      const vidIndex = videos.findIndex(vid => vid.vidhash === hash);
      if (vidIndex >= 0) {
        console.log('[LocationDetail] Updating video thumbnail:', hash);
        videos[vidIndex] = {
          ...videos[vidIndex],
          thumb_path_sm: paths.sm || videos[vidIndex].thumb_path_sm,
          thumb_path_lg: paths.lg || videos[vidIndex].thumb_path_lg,
          preview_path: paths.preview || videos[vidIndex].preview_path,
        };
        videos = [...videos]; // Trigger reactivity
        notifyRefresh('videos'); // OPT-090
        return;
      }
    }

    // OPT-090: Handle video proxy ready
    // OPT-105: Reload video data to get updated proxy path
    // OPT-110: Use debounced reload to prevent page flash
    if (type === 'proxy' && hash) {
      const vidIndex = videos.findIndex(vid => vid.vidhash === hash);
      if (vidIndex >= 0) {
        console.log('[LocationDetail] Video proxy ready, scheduling debounced reload:', hash);
        // Debounced reload to get updated proxy_path from database
        debouncedLoadLocation();
        notifyRefresh('videos');
      }
    }

    // OPT-105: Handle metadata complete - reload to get updated metadata
    // OPT-110: Use debounced reload to prevent page flash
    if (type === 'metadata' && hash) {
      const imgIndex = images.findIndex(img => img.imghash === hash);
      const vidIndex = videos.findIndex(vid => vid.vidhash === hash);
      if (imgIndex >= 0 || vidIndex >= 0) {
        console.log('[LocationDetail] Metadata complete, scheduling debounced reload:', hash);
        debouncedLoadLocation();
        notifyRefresh(imgIndex >= 0 ? 'images' : 'videos');
      }
    }
  }

  // FIX: Cleanup function for websource listener
  let websourceUnsubscribe: (() => void) | null = null;

  onMount(async () => {
    // OPT-087: Listen for asset-ready events from App.svelte
    window.addEventListener('asset-ready', handleAssetReady as EventListener);

    await loadLocation();
    loadBookmarks();

    // FIX (Rule 9): Listen for web sources saved from browser extension
    websourceUnsubscribe = window.electronAPI?.websources?.onWebSourceSaved?.((payload) => {
      if (payload.locid === locationId) {
        toasts.success('Bookmark saved');
      }
    }) || null;

    // DECISION-014: Removed ensureGpsFromAddress() - GPS should only come from EXIF or user action

    // Migration 33: Track view for Nerd Stats (only for host locations, not sub-locations)
    if (!subId && locationId) {
      window.electronAPI?.locations?.trackView(locationId).catch((err: unknown) => {
        console.warn('[LocationDetail] Failed to track view:', err);
      });
    }

    // OPT-053: Removed video proxy pre-generation
    // Proxies are now generated at import time (Immich model)
    // touchLocationProxies and generateProxiesForLocation are deprecated

    try {
      const settings = await window.electronAPI.settings.getAll();
      currentUser = settings.current_user || 'default';
      // Load users for attribution modal
      if (window.electronAPI?.users) {
        users = await window.electronAPI.users.findAll();
      }
    }
    catch (err) { console.error('Error loading user settings:', err); }

    // Auto-scroll to import zone if navigated from new location creation
    const hash = window.location.hash;
    if (hash.includes('autoImport=true')) {
      // Small delay to ensure UI is ready, then scroll to import zone
      setTimeout(() => {
        const importZone = document.querySelector('[data-import-zone]');
        if (importZone) {
          importZone.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      // Clear the query param to prevent re-triggering on refresh
      router.navigate(`/location/${locationId}`);
    }
  });

  // OPT-087: Cleanup asset-ready event listener to prevent memory leaks
  // OPT-092: Also cleanup notification timer
  // OPT-110: Also cleanup loadLocation debounce timer
  // FIX: Also cleanup websource listener
  onDestroy(() => {
    window.removeEventListener('asset-ready', handleAssetReady as EventListener);
    if (notificationTimer) clearTimeout(notificationTimer);
    if (loadLocationDebounceTimer) clearTimeout(loadLocationDebounceTimer);
    if (websourceUnsubscribe) websourceUnsubscribe();
  });
</script>

<div class="h-full overflow-auto">
  {#if loading}
    <div class="flex items-center justify-center h-full"><p class="text-braun-500">Loading location...</p></div>
  {:else if error || !location}
    <div class="flex items-center justify-center h-full">
      <div class="text-center">
        <p class="text-error text-lg">{error || 'Location not found'}</p>
        <button onclick={() => router.navigate('/locations')} class="mt-4 px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition-colors">Back to Locations</button>
      </div>
    </div>
  {:else}
    <div class="max-w-6xl mx-auto px-8 pt-12 pb-8">
      <!-- Index Card Header -->
      <div class="mb-8">
        <div class="index-card bg-white border border-braun-300 rounded p-6">
          <div class="flex gap-6">
            <!-- Left: Thumbnail (2:1 ratio) -->
            {#if heroThumbPath}
              {@const focalX = currentSubLocation?.hero_focal_x ?? location?.hero_focal_x ?? 0.5}
              {@const focalY = currentSubLocation?.hero_focal_y ?? location?.hero_focal_y ?? 0.5}
              <button
                onclick={handleHeroClick}
                class="flex-shrink-0 w-72 rounded overflow-hidden group"
                title="View hero image"
              >
                <!-- OPT-110: Fade-in transition for smooth hero image loading -->
                <img
                  src={`media://${heroThumbPath}`}
                  alt="Hero thumbnail"
                  class="w-full h-full object-cover scale-110 opacity-0 transition-opacity duration-200"
                  style="aspect-ratio: 2 / 1; object-position: {focalX * 100}% {focalY * 100}%;"
                  onload={(e) => e.currentTarget.classList.remove('opacity-0')}
                />
              </button>
            {/if}

            <!-- Right: Location Info (right-justified) -->
            <div class="flex-1 min-w-0 space-y-3 text-right">
              <!-- Title Row -->
              {#if isViewingSubLocation && currentSubLocation}
                <!-- Sub-location: Show host name above -->
                <div>
                  <button
                    onclick={() => router.navigate(`/location/${locationId}`)}
                    class="text-sm text-braun-500 hover:text-braun-900 hover:underline"
                  >
                    {location.locnam}
                  </button>
                  <h1 bind:this={titleEl} class="font-bold text-braun-900 leading-tight">
                    {currentSubLocation.subnam}
                  </h1>
                </div>
              {:else}
                <h1 bind:this={titleEl} class="font-bold text-braun-900 leading-tight">
                  {location.locnam}
                </h1>
              {/if}

              <!-- Status + Class -->
              <p class="text-base text-braun-700">
                {#if location.access}{location.access}{/if}
                {#if location.access && location.class} {/if}
                {#if location.class}{location.class}{/if}
                {#if !location.access && !location.class && !location.category}<button onclick={openVerifyModal} class="text-error hover:underline cursor-pointer">verify</button>{/if}
              </p>

              <!-- Built / Abandoned -->
              {#if location.builtYear || location.abandonedYear}
                <p class="text-base text-braun-700">
                  {#if location.builtYear}Est. {location.builtYear}{/if}
                  {#if location.builtYear && location.abandonedYear}<span class="text-braun-400"> · </span>{/if}
                  {#if location.abandonedYear}Closed {location.abandonedYear}{/if}
                </p>
              {/if}

              <!-- Buildings (Host Location) or Siblings (Sub-Location) -->
              {#if isViewingSubLocation && sublocations.length > 1}
                <p class="text-sm text-braun-500">
                  {#each sublocations.filter(s => s.subid !== currentSubLocation?.subid) as subloc, i}
                    {#if i > 0}<span class="text-braun-400"> · </span>{/if}
                    <button
                      onclick={() => router.navigate(`/location/${locationId}/sub/${subloc.subid}`)}
                      class="hover:text-braun-900 hover:underline"
                    >{subloc.subnam}</button>
                  {/each}
                </p>
              {:else if !isViewingSubLocation && isHostLocation && sublocations.length > 0}
                <p class="text-sm text-braun-500" bind:this={sublocTaglineEl}>
                  {#each sublocations as subloc, i}
                    {#if i > 0}<span class="text-braun-400"> · </span>{/if}
                    <button
                      onclick={() => router.navigate(`/location/${locationId}/sub/${subloc.subid}`)}
                      class="hover:text-braun-900 hover:underline"
                    >{subloc.subnam}</button>
                  {/each}
                </p>
              {/if}
            </div>
          </div>
        </div>
      </div>

      <!-- Verification Status Line -->
      <div
        class="h-1 rounded mx-4 mb-8"
        style="background-color: {verificationStatus === 'green' ? '#4A8C5E' : verificationStatus === 'yellow' ? '#C9A227' : '#B85C4A'};"
        title={verificationStatus === 'green' ? 'Complete: Info, Location, and Hero Image' :
               verificationStatus === 'yellow' ? 'Partial: Missing some verification or hero image' :
               'Incomplete: Missing info, location data, or hero image'}
      ></div>

      {#if isEditing}
        <LocationEditForm {location} onSave={handleSave} onCancel={() => isEditing = false} />
      {:else}
        <!-- Side-by-side: Timeline on LEFT (55%), Map on RIGHT (45%) - equal height -->
        <div class="flex gap-6 mb-8 items-stretch">
          <!-- Left: Timeline (55% width) - PLAN: replaces LocationInfo position -->
          <div class="w-[55%] flex flex-col">
            <LocationTimeline
              locid={location.locid}
              subid={isViewingSubLocation && currentSubLocation ? currentSubLocation.subid : null}
              isHostLocation={isHostLocation && !isViewingSubLocation}
              onUpdate={loadLocation}
              onOpenWebSource={handleOpenWebSource}
              onExpandClick={handleTimelineExpand}
            />
            <!-- Date Extraction Review: Pending dates feed into Timeline -->
            <DateExtractionReview
              locid={location.locid}
              subid={isViewingSubLocation && currentSubLocation ? currentSubLocation.subid : null}
              onUpdate={loadLocation}
            />
          </div>

          <!-- Right: Map Section (45% width) -->
          <div class="w-[45%] flex flex-col">
            <!-- DECISION-011: Unified location box with verification checkmarks, edit modal -->
            <!-- Migration 31: Pass sub-location GPS props when viewing a sub-location -->
            <LocationMapSection
              {location}
              onSave={handleLocationSave}
              onNavigateFilter={navigateToFilter}
              isHostLocation={isHostLocation && !isViewingSubLocation}
              subLocation={isViewingSubLocation && currentSubLocation ? {
                subid: currentSubLocation.subid,
                subnam: currentSubLocation.subnam,
                gps_lat: currentSubLocation.gps_lat,
                gps_lng: currentSubLocation.gps_lng,
                gps_verified_on_map: currentSubLocation.gps_verified_on_map,
                gps_source: currentSubLocation.gps_source,
              } : null}
              onSubLocationGpsSave={isViewingSubLocation ? saveSubLocationGps : undefined}
              campusSubLocations={!isViewingSubLocation && isHostLocation ? subLocationsWithGps : []}
              onCampusSubLocationClick={(subid) => router.navigate(`/location/${locationId}/sub/${subid}`)}
            />
          </div>
        </div>

        <!-- PLAN: Horizontal Info Strip (below Timeline/Map row) -->
        <div class="mb-8">
          <LocationInfoHorizontal
            {location}
            onNavigateFilter={navigateToFilter}
            onSave={handleSave}
            currentSubLocation={isViewingSubLocation ? currentSubLocation : null}
            onSubLocationSave={isViewingSubLocation ? handleSubLocationSave : undefined}
          />
        </div>

        <!-- Sub-Location Grid (only for host locations, hide when viewing a sub-location) -->
        {#if !isViewingSubLocation && isHostLocation}
          <div id="buildings-section">
            <SubLocationGrid
              locid={location.locid}
              {sublocations}
              onAddSubLocation={openAddBuildingModal}
            />
          </div>
        {/if}

        <!-- Notes scoped to sub-location when viewing one -->
        <NotesSection locid={isViewingSubLocation && currentSubLocation ? currentSubLocation.subid : location.locid} {currentUser} />

        <!-- Import zone - host locations get campus-level media, buildings get building media -->
        <LocationImportZone
          isImporting={$isImporting}
          {isDragging}
          {gpsWarnings}
          {failedFiles}
          scopeLabel={isViewingSubLocation ? currentSubLocation?.subnam : (isHostLocation ? 'Campus-Level' : null)}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onSelectFiles={handleSelectFiles}
          onRetryFailed={retryFailedImports}
          onDismissWarning={(i) => gpsWarnings = gpsWarnings.filter((_, idx) => idx !== i)}
          onDismissAllWarnings={() => gpsWarnings = []}
        />

        <div id="media-gallery">
          <LocationRecords
            {images}
            {videos}
            {documents}
            heroImgsha={currentSubLocation?.hero_imghash || location.hero_imghash || null}
            locid={location.locid}
            onOpenImageLightbox={(i) => selectedMediaIndex = i}
            onOpenVideoLightbox={(i) => selectedMediaIndex = images.length + i}
            onOpenDocument={openMediaFile}
            onOpenSource={(url) => window.electronAPI.shell.openExternal(url)}
          />
        </div>

        <!-- Research section: Timeline (detailed), People, Companies -->
        <LocationResearch
          bind:this={researchRef}
          locid={location.locid}
          subid={isViewingSubLocation && currentSubLocation ? currentSubLocation.subid : null}
          isHostLocation={isHostLocation && !isViewingSubLocation}
          onOpenWebSource={handleOpenWebSource}
        />

        <LocationSettings {location} onLocationUpdated={loadLocation} />
        <LocationNerdStats {location} imageCount={images.length} videoCount={videos.length} documentCount={documents.length} mapCount={maps.length} onLocationUpdated={loadLocation} />
      {/if}
    </div>
  {/if}

  {#if selectedMediaIndex !== null && mediaViewerList.length > 0}
    <MediaViewer
      mediaList={mediaViewerList}
      startIndex={selectedMediaIndex}
      onClose={() => selectedMediaIndex = null}
      heroImghash={currentSubLocation?.hero_imghash || location?.hero_imghash || null}
      focalX={currentSubLocation?.hero_focal_x ?? location?.hero_focal_x ?? 0.5}
      focalY={currentSubLocation?.hero_focal_y ?? location?.hero_focal_y ?? 0.5}
      onSetHeroImage={currentSubLocation
        ? async (imghash, focalX, focalY) => {
            await window.electronAPI.sublocations.update(currentSubLocation.subid, { hero_imghash: imghash, hero_focal_x: focalX, hero_focal_y: focalY });
            await loadLocation();
          }
        : async (imghash, focalX, focalY) => {
            await window.electronAPI.locations.update(locationId, { hero_imghash: imghash, hero_focal_x: focalX, hero_focal_y: focalY });
            await loadLocation();
          }}
      onSetHostHeroImage={currentSubLocation
        ? async (imghash, focalX, focalY) => {
            await window.electronAPI.locations.update(locationId, { hero_imghash: imghash, hero_focal_x: focalX, hero_focal_y: focalY });
            await loadLocation();
          }
        : undefined}
      onHiddenChanged={handleHiddenChanged}
      onDeleted={handleMediaDeleted}
      onMoved={handleMediaMoved}
      sublocations={sublocations.map(s => ({ subid: s.subid, subnam: s.subnam }))}
      currentSubid={currentSubLocation?.subid || null}
      locid={locationId}
    />
  {/if}

  <!-- Migration 26: Import Attribution Modal -->
  {#if showAttributionModal}
    <div
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999]"
      onclick={cancelImport}
      role="dialog"
      aria-modal="true"
      aria-labelledby="attribution-title"
    >
      <div
        class="bg-white border border-braun-300 rounded w-full max-w-md mx-4"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="p-5 border-b border-braun-200 flex justify-between items-center">
          <h2 id="attribution-title" class="text-lg font-medium text-braun-900">
            Import Author
          </h2>
          <button
            onclick={cancelImport}
            class="text-braun-400 hover:text-braun-600 transition p-1 rounded hover:bg-braun-100"
            aria-label="Close"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="p-5 space-y-4">
          <!-- Current user or Someone Else -->
          <div class="space-y-3">
            <label class="flex items-center gap-3 p-3 border rounded cursor-pointer hover:bg-braun-50 transition bg-white {!isSomeoneElse ? 'border-braun-900' : 'border-braun-300'}">
              <input
                type="radio"
                name="attribution"
                checked={!isSomeoneElse}
                onchange={() => { isSomeoneElse = false; selectedAuthor = ''; contributionSource = ''; }}
                class="w-4 h-4 text-braun-900"
              />
              <span class="font-medium text-braun-900">{users.find(u => u.username === currentUser)?.display_name || currentUser}</span>
            </label>

            <label class="flex items-center gap-3 p-3 border rounded cursor-pointer hover:bg-braun-50 transition bg-white {isSomeoneElse ? 'border-braun-900' : 'border-braun-300'}">
              <input
                type="radio"
                name="attribution"
                checked={isSomeoneElse}
                onchange={() => isSomeoneElse = true}
                class="w-4 h-4 text-braun-900"
              />
              <span class="font-medium text-braun-900">Someone Else</span>
            </label>
          </div>

          <!-- If Someone Else: show author dropdown -->
          {#if isSomeoneElse}
            <div class="pt-2 space-y-3">
              <div>
                <label for="author-select" class="form-label">
                  Who shot these?
                </label>
                <select
                  id="author-select"
                  bind:value={selectedAuthor}
                  class="w-full px-4 py-3 bg-white border border-braun-400 rounded text-sm text-braun-900 focus:outline-none focus:border-braun-600 transition-colors"
                >
                  <option value="">Select...</option>
                  {#each users.filter(u => u.username !== currentUser) as user}
                    <option value={user.username}>{user.display_name || user.username}</option>
                  {/each}
                  <option value="external">External Contributor</option>
                </select>
              </div>

              <!-- If External: show source field -->
              {#if selectedAuthor === 'external'}
                <div>
                  <label for="contribution-source" class="form-label">
                    Source
                  </label>
                  <input
                    id="contribution-source"
                    type="text"
                    bind:value={contributionSource}
                    placeholder="e.g., John Smith via text"
                    class="w-full px-4 py-3 bg-white border border-braun-400 rounded text-sm text-braun-900 placeholder:text-braun-400 focus:outline-none focus:border-braun-600 transition-colors"
                  />
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div class="p-5 border-t border-braun-200 flex justify-end gap-3">
          <button
            onclick={cancelImport}
            class="px-4 py-2 text-sm text-braun-600 bg-white border border-braun-400 rounded hover:border-braun-500 transition font-medium"
          >
            Cancel
          </button>
          <button
            onclick={confirmImport}
            disabled={isSomeoneElse && !selectedAuthor || (selectedAuthor === 'external' && !contributionSource.trim())}
            class="px-4 py-2 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Migration 28: Add Building Modal -->
  {#if showAddBuildingModal}
    <div
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999]"
      onclick={closeAddBuildingModal}
      role="dialog"
      aria-modal="true"
    >
      <div
        class="bg-white border border-braun-300 rounded w-full max-w-md mx-4"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="p-4 border-b border-braun-200">
          <h2 class="text-lg font-medium text-braun-900">Add Building</h2>
          <p class="text-sm text-braun-500 mt-1">
            Add a building to {location?.locnam || 'this location'}
          </p>
        </div>

        <div class="p-4 space-y-4">
          <div>
            <label for="building-name" class="form-label">
              Building Name <span class="text-error">*</span>
            </label>
            <input
              id="building-name"
              type="text"
              bind:value={newBuildingName}
              disabled={addingBuilding}
              placeholder="e.g., Main Building, Powerhouse"
              class="w-full px-4 py-3 bg-white border border-braun-400 rounded text-sm text-braun-900 placeholder:text-braun-400 focus:outline-none focus:border-braun-600 transition-colors disabled:opacity-50"
            />
          </div>

          <!-- Migration 65: Category and Class fields for sub-locations (separate taxonomy) -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="building-category" class="form-label">Category</label>
              <input
                id="building-category"
                type="text"
                list="building-category-options"
                bind:value={newBuildingCategory}
                disabled={addingBuilding}
                placeholder="e.g., Administration"
                class="w-full px-4 py-3 bg-white border border-braun-400 rounded text-sm text-braun-900 placeholder:text-braun-400 focus:outline-none focus:border-braun-600 transition-colors disabled:opacity-50"
              />
              <datalist id="building-category-options">
                {#each sublocCategoryOptions as option}
                  <option value={option} />
                {/each}
              </datalist>
            </div>
            <div>
              <label for="building-class" class="form-label">Class</label>
              <input
                id="building-class"
                type="text"
                list="building-class-options"
                bind:value={newBuildingClass}
                disabled={addingBuilding}
                placeholder="e.g., Office Wing"
                class="w-full px-4 py-3 bg-white border border-braun-400 rounded text-sm text-braun-900 placeholder:text-braun-400 focus:outline-none focus:border-braun-600 transition-colors disabled:opacity-50"
              />
              <datalist id="building-class-options">
                {#each sublocClassOptions as option}
                  <option value={option} />
                {/each}
              </datalist>
            </div>
          </div>

          <label class="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              bind:checked={newBuildingIsPrimary}
              disabled={addingBuilding}
              class="h-5 w-5 rounded border-braun-400 text-braun-900 focus:ring-braun-600"
            />
            <div>
              <span class="text-sm font-medium text-braun-900">Primary Building</span>
              <p class="text-xs text-braun-500">Set as main structure of this campus</p>
            </div>
          </label>
        </div>

        <div class="p-4 border-t border-braun-200 flex justify-end gap-2">
          <button
            onclick={closeAddBuildingModal}
            disabled={addingBuilding}
            class="px-4 py-2 text-braun-600 bg-braun-100 rounded hover:bg-braun-200 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onclick={handleAddBuilding}
            disabled={addingBuilding || !newBuildingName.trim()}
            class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {addingBuilding ? 'Adding...' : 'Add Building'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Verify Location Modal (Braun: 8pt grid, 4px radius, functional minimalism) -->
  {#if showVerifyModal}
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-[99999]"
      onclick={() => showVerifyModal = false}
      role="dialog"
      aria-modal="true"
      aria-labelledby="verify-modal-title"
    >
      <div
        class="bg-white rounded border border-braun-300 w-full max-w-md mx-4"
        onclick={(e) => e.stopPropagation()}
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-braun-200">
          <h2 id="verify-modal-title" class="text-xl font-semibold text-braun-900">Verify Location</h2>
          <button
            onclick={() => showVerifyModal = false}
            class="p-1 text-braun-400 hover:text-braun-600 transition"
            aria-label="Close"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Form: 2x2 Grid -->
        <div class="p-6">
          <div class="grid grid-cols-2 gap-4">
            <!-- Row 1: Name | Type -->
            <div>
              <label for="verify-name" class="block text-xs font-semibold text-braun-500 uppercase tracking-wider mb-1">Name</label>
              <input
                id="verify-name"
                type="text"
                bind:value={verifyForm.locnam}
                class="w-full px-3 py-2 border border-braun-300 rounded text-sm focus:outline-none focus:border-braun-600"
                placeholder="Location name"
              />
            </div>
            <div>
              <label for="verify-category" class="block text-xs font-semibold text-braun-500 uppercase tracking-wider mb-1">Category</label>
              <input
                id="verify-category"
                type="text"
                list="verify-category-options"
                bind:value={verifyForm.category}
                class="w-full px-3 py-2 border border-braun-300 rounded text-sm focus:outline-none focus:border-braun-600"
                placeholder="e.g., Hospital"
              />
              <datalist id="verify-category-options">
                {#each verifyCategoryOptions as option}
                  <option value={option} />
                {/each}
              </datalist>
            </div>

            <!-- Row 2: Status | Class -->
            <div>
              <label for="verify-status" class="block text-xs font-semibold text-braun-500 uppercase tracking-wider mb-1">Status</label>
              <select
                id="verify-status"
                bind:value={verifyForm.access}
                class="w-full px-3 py-2 border border-braun-300 rounded text-sm focus:outline-none focus:border-braun-600"
              >
                <option value="">Select status...</option>
                {#each ACCESS_OPTIONS as option}
                  <option value={option}>{option}</option>
                {/each}
              </select>
            </div>
            <div>
              <label for="verify-class" class="block text-xs font-semibold text-braun-500 uppercase tracking-wider mb-1">Class</label>
              <input
                id="verify-class"
                type="text"
                list="verify-class-options"
                bind:value={verifyForm.class}
                class="w-full px-3 py-2 border border-braun-300 rounded text-sm focus:outline-none focus:border-braun-600"
                placeholder="e.g., Psychiatric"
              />
              <datalist id="verify-class-options">
                {#each verifyClassOptions as option}
                  <option value={option} />
                {/each}
              </datalist>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 border-t border-braun-200 flex justify-end gap-3">
          <button
            onclick={() => showVerifyModal = false}
            disabled={savingVerify}
            class="px-4 py-2 text-braun-600 bg-braun-100 rounded hover:bg-braun-200 transition text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onclick={handleVerifySave}
            disabled={savingVerify || !verifyForm.locnam.trim()}
            class="px-6 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {savingVerify ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- OPT-119: Web Source Detail Modal (from Timeline web page clicks) -->
  {#if showWebSourceModal && webSourceModalId}
    <WebSourceDetailModal
      sourceId={webSourceModalId}
      onClose={handleCloseWebSourceModal}
      onOpenUrl={(url) => window.electronAPI.shell.openExternal(url)}
    />
  {/if}
</div>

<style>
  /* Component styles - Braun design system */
</style>
