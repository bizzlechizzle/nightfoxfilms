<script lang="ts">
  import { onMount } from 'svelte';
  import { thumbnailCache } from '../stores/thumbnail-cache-store';
  import DataEngineSettings from '../components/data-engine/DataEngineSettings.svelte';

  interface User {
    user_id: string;
    username: string;
    display_name: string | null;
    has_pin: boolean;
    is_active: boolean;
    last_login: string | null;
  }

  let archivePath = $state('');
  let currentUserId = $state<string | null>(null);
  let currentUsername = $state('default');
  let importMap = $state(true);
  let mapImport = $state(true);
  let loading = $state(true);
  let saveMessage = $state('');

  // Migration 24: User management state
  let appMode = $state<'single' | 'multi'>('single');
  let requireLogin = $state(false);
  let users = $state<User[]>([]);
  let showAddUser = $state(false);
  let editingUserId = $state<string | null>(null);
  let changingPinUserId = $state<string | null>(null);

  // New user form
  let newUsername = $state('');
  let newDisplayName = $state('');
  let newPin = $state('');
  let newConfirmPin = $state('');
  let newUserError = $state('');

  // Edit user form
  let editUsername = $state('');
  let editDisplayName = $state('');
  let editError = $state('');

  // Change PIN form
  let changePin = $state('');
  let changeConfirmPin = $state('');
  let changePinError = $state('');

  // Users accordion state (collapsed by default)
  let usersExpanded = $state(false);

  // Archive accordion state (all closed by default)
  let archiveExpanded = $state(false);
  let mapsExpanded = $state(false);
  let maintenanceExpanded = $state(false);
  let databaseExpanded = $state(false);
  let healthExpanded = $state(false);

  // Data Engine accordion state (consolidates Date Engine, Image Auto-Tagging, AI & Cloud Providers)
  let dataEngineExpanded = $state(false);

  // Storage bar state - OPT-047: Enhanced with database-backed tracking
  let storageStats = $state<{
    totalBytes: number;
    availableBytes: number;
    archiveBytes: number;
    drivePath: string;
    // OPT-047: New fields for detailed breakdown
    mediaBytes?: number;
    thumbnailBytes?: number;
    previewBytes?: number;
    proxyBytes?: number;
    unmeasuredCount?: number;
    lastVerifiedAt?: string | null;
  } | null>(null);
  let loadingStorage = $state(false);
  let verifyingStorage = $state(false);
  let verifyProgress = $state<{ processed: number; currentFile: string } | null>(null);
  let verifyResult = $state<{
    newMeasurements: number;
    sizeMismatches: number;
    missingFiles: number;
  } | null>(null);

  // Database health state
  let dbHealthy = $state(true);
  let backupCount = $state(0);
  let internalBackups = $state<Array<{ id: string; date: string; size: string; path: string }>>([]);
  let showRestoreModal = $state(false);
  let userExporting = $state(false);

  // PIN verification modal state
  let showPinModal = $state(false);
  let pinAction = $state<'archive' | 'startupPin' | null>(null);
  let pinInput = $state('');
  let pinError = $state('');
  let pinVerifying = $state(false);

  // Location picker modal state
  interface LocationBasic {
    locid: string;
    locnam: string;
    state?: string;
  }
  let showLocationPicker = $state(false);
  let pickerMode = $state<'purge' | 'addresses' | 'images' | 'videos' | null>(null);
  let pickerSearchQuery = $state('');
  let pickerSearchResults = $state<LocationBasic[]>([]);
  let pickerSelectedLocation = $state<LocationBasic | null>(null);
  let pickerLoading = $state(false);
  let pickerMessage = $state('');

  // Kanye6: Thumbnail regeneration state
  let regenerating = $state(false);
  let regenProgress = $state(0);
  let regenTotal = $state(0);
  let regenMessage = $state('');

  // Kanye9: Address normalization state
  let normalizing = $state(false);
  let normalizeMessage = $state('');

  // DECISION-012: Region backfill state
  let backfillingRegions = $state(false);
  let backfillMessage = $state('');

  // Migration 23: Live Photo detection state
  let detectingLivePhotos = $state(false);
  let livePhotoMessage = $state('');

  // Migration 36: Video Proxy state
  // OPT-053: Proxies are now permanent (Immich model), purge/clear no longer used
  let proxyCacheStats = $state<{
    totalCount: number;
    totalSizeBytes: number;
    totalSizeMB: number;
    oldestAccess: string | null;
    newestAccess: string | null;
  } | null>(null);
  // OPT-053: DEPRECATED - kept for backwards compatibility but unused
  let purgingProxies = $state(false);
  let clearingProxies = $state(false);
  let proxyMessage = $state('');

  // P6: Darktable state removed per v010steps.md

  // Reference Maps state
  interface RefMap {
    mapId: string;
    mapName: string;
    filePath: string;
    fileType: string;
    pointCount: number;
    importedAt: string;
    importedBy: string | null;
  }

  interface DuplicateMatchPreview {
    type: 'catalogued' | 'reference';
    matchType?: 'gps' | 'name_gps' | 'name_state' | 'exact_name';
    newPointName: string;
    newPointLat?: number;
    newPointLng?: number;
    newPointState?: string | null;
    existingName: string;
    existingId: string;
    existingState?: string;
    existingHasGps?: boolean;
    nameSimilarity: number;
    distanceMeters: number;
    mapName?: string;
    needsConfirmation?: boolean;
    pointIndex?: number; // Migration 42: index in parsed points array
  }

  interface ImportPreview {
    fileName: string;
    filePath: string;
    fileType: string;
    totalPoints: number;
    newPoints: number;
    newPointsStateBreakdown: Array<{ state: string; count: number }>;
    // Migration 42: Enrichment opportunities (existing location lacks GPS)
    enrichmentCount: number;
    enrichmentOpportunities: DuplicateMatchPreview[];
    // Already catalogued (existing location has GPS)
    cataloguedCount: number;
    cataloguedMatches: DuplicateMatchPreview[];
    referenceCount: number;
    referenceMatches: DuplicateMatchPreview[];
  }

  let refMaps = $state<RefMap[]>([]);
  let refMapStats = $state<{ mapCount: number; pointCount: number } | null>(null);
  let importingRefMap = $state(false);
  let refMapMessage = $state('');

  // Phase 3: Import preview modal state
  let showImportPreview = $state(false);
  let importPreview = $state<ImportPreview | null>(null);
  let previewLoading = $state(false);
  let skipDuplicates = $state(true);
  // Migration 42: Track which enrichments to apply (locationId -> pointIndex)
  let selectedEnrichments = $state<Map<string, number>>(new Map());
  let applyingEnrichment = $state<string | null>(null); // Track which one is being applied

  // Phase 4: Purge catalogued points state
  let cataloguedCount = $state<number | null>(null);  // null = not calculated yet
  let loadingCatalogued = $state(false);  // OPT-048: Loading state for on-demand calculation
  let purgingPoints = $state(false);
  let purgeMessage = $state('');

  // BagIt Integrity state
  let integrityExpanded = $state(false);
  let bagSummary = $state<{ valid: number; complete: number; incomplete: number; invalid: number; none: number } | null>(null);
  let lastValidation = $state<string | null>(null);
  let validatingAllBags = $state(false);
  let validationProgress = $state<{ current: number; total: number; currentLocation: string } | null>(null);
  let bagValidationMessage = $state('');

  // Database Archive Export state
  let archiveExportStatus = $state<{
    configured: boolean;
    exported: boolean;
    verified: boolean;
    lastExport: {
      exportedAt: string;
      appVersion: string;
      locationCount: number;
      imageCount: number;
      videoCount: number;
      documentCount: number;
      mapCount: number;
      checksum: string;
    } | null;
  } | null>(null);
  let archiveExporting = $state(false);
  let archiveExportMessage = $state('');

  // OPT-113: Web Source Archive state
  let webSourcesExpanded = $state(false);
  let pendingWebSourceCount = $state(0);
  let archivingWebSources = $state(false);
  let webSourceArchiveMessage = $state('');

  async function loadSettings() {
    try {
      loading = true;
      if (!window.electronAPI?.settings) {
        console.error('Electron API not available - preload script may have failed to load');
        return;
      }
      const settings = await window.electronAPI.settings.getAll();

      archivePath = settings.archive_folder || '';
      currentUserId = settings.current_user_id || null;
      currentUsername = settings.current_user || 'default';
      appMode = (settings.app_mode as 'single' | 'multi') || 'single';
      requireLogin = settings.require_login === 'true';
      importMap = settings.import_map !== 'false'; // Default true
      mapImport = settings.map_import !== 'false'; // Default true

      // Load users for multi-user mode
      await loadUsers();
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      loading = false;
    }
  }

  async function loadUsers() {
    if (!window.electronAPI?.users) return;
    try {
      users = await window.electronAPI.users.findAll();
    } catch (error) {
      console.error('Error loading users:', error);
    }
  }

  async function switchToMultiUser() {
    if (!window.electronAPI?.settings) return;
    try {
      await window.electronAPI.settings.set('app_mode', 'multi');
      appMode = 'multi';
      saveMessage = 'Switched to multi-user mode';
      setTimeout(() => saveMessage = '', 3000);
    } catch (error) {
      console.error('Error switching mode:', error);
    }
  }

  async function switchToSingleUser() {
    if (!window.electronAPI?.settings) return;
    try {
      await window.electronAPI.settings.set('app_mode', 'single');
      appMode = 'single';
      saveMessage = 'Switched to single-user mode';
      setTimeout(() => saveMessage = '', 3000);
    } catch (error) {
      console.error('Error switching mode:', error);
    }
  }

  async function toggleRequireLogin() {
    if (!window.electronAPI?.settings) return;
    try {
      const newValue = !requireLogin;
      await window.electronAPI.settings.set('require_login', newValue.toString());
      requireLogin = newValue;
      saveMessage = newValue ? 'Login will be required at startup' : 'Login no longer required at startup';
      setTimeout(() => saveMessage = '', 3000);
    } catch (error) {
      console.error('Error toggling require login:', error);
    }
  }

  function openAddUser() {
    newUsername = '';
    newDisplayName = '';
    newPin = '';
    newConfirmPin = '';
    newUserError = '';
    showAddUser = true;
  }

  function cancelAddUser() {
    showAddUser = false;
    newUserError = '';
  }

  async function createUser() {
    if (!window.electronAPI?.users) return;

    newUserError = '';

    if (!newUsername.trim()) {
      newUserError = 'Username is required';
      return;
    }

    if (!newPin) {
      newUserError = 'PIN is required';
      return;
    }

    if (newPin.length < 4) {
      newUserError = 'PIN must be at least 4 digits';
      return;
    }

    if (!/^\d+$/.test(newPin)) {
      newUserError = 'PIN must contain only numbers';
      return;
    }

    if (newPin !== newConfirmPin) {
      newUserError = 'PINs do not match';
      return;
    }

    try {
      await window.electronAPI.users.create({
        username: newUsername.trim(),
        display_name: newDisplayName.trim() || null,
        pin: newPin,
      });

      showAddUser = false;
      await loadUsers();
      saveMessage = `User "${newUsername}" created`;
      setTimeout(() => saveMessage = '', 3000);
    } catch (error) {
      console.error('Error creating user:', error);
      newUserError = 'Failed to create user';
    }
  }

  function startEditUser(user: User) {
    editingUserId = user.user_id;
    editUsername = user.username;
    editDisplayName = user.display_name || '';
    editError = '';
  }

  function cancelEditUser() {
    editingUserId = null;
    editError = '';
  }

  async function saveEditUser() {
    if (!window.electronAPI?.users || !editingUserId) return;

    editError = '';

    if (!editUsername.trim()) {
      editError = 'Username is required';
      return;
    }

    try {
      await window.electronAPI.users.update(editingUserId, {
        username: editUsername.trim(),
        display_name: editDisplayName.trim() || null,
      });

      editingUserId = null;
      await loadUsers();
      saveMessage = 'User updated';
      setTimeout(() => saveMessage = '', 3000);
    } catch (error) {
      console.error('Error updating user:', error);
      editError = 'Failed to update user';
    }
  }

  function startChangePin(user: User) {
    changingPinUserId = user.user_id;
    changePin = '';
    changeConfirmPin = '';
    changePinError = '';
  }

  function cancelChangePin() {
    changingPinUserId = null;
    changePinError = '';
  }

  async function saveChangePin() {
    if (!window.electronAPI?.users || !changingPinUserId) return;

    changePinError = '';

    if (!changePin) {
      changePinError = 'PIN is required';
      return;
    }

    if (changePin.length < 4) {
      changePinError = 'PIN must be at least 4 digits';
      return;
    }

    if (!/^\d+$/.test(changePin)) {
      changePinError = 'PIN must contain only numbers';
      return;
    }

    if (changePin !== changeConfirmPin) {
      changePinError = 'PINs do not match';
      return;
    }

    try {
      await window.electronAPI.users.setPin(changingPinUserId, changePin);
      saveMessage = 'PIN changed successfully';

      changingPinUserId = null;
      await loadUsers();
      setTimeout(() => saveMessage = '', 3000);
    } catch (error) {
      console.error('Error changing PIN:', error);
      changePinError = 'Failed to change PIN';
    }
  }

  async function deleteUser(user: User) {
    if (!window.electronAPI?.users) return;

    if (users.length <= 1) {
      alert('Cannot delete the last user');
      return;
    }

    if (!confirm(`Are you sure you want to delete user "${user.display_name || user.username}"?`)) {
      return;
    }

    try {
      await window.electronAPI.users.delete(user.user_id);
      await loadUsers();
      saveMessage = 'User deleted';
      setTimeout(() => saveMessage = '', 3000);
    } catch (error) {
      console.error('Error deleting user:', error);
    }
  }

  async function selectArchiveFolder() {
    if (!window.electronAPI?.dialog) return;
    try {
      const folder = await window.electronAPI.dialog.selectFolder();
      if (folder) {
        archivePath = folder;
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
    }
  }


  /**
   * Kanye6: Regenerate thumbnails for all images missing multi-tier thumbnails
   * This repairs old imports that only have 256px thumbnails
   * @param force - If true, regenerate ALL thumbnails/previews (fixes rotation issues)
   */
  async function regenerateThumbnails(force: boolean = false) {
    if (!window.electronAPI?.media?.regenerateAllThumbnails) {
      regenMessage = 'Thumbnail regeneration not available';
      return;
    }

    try {
      regenerating = true;
      regenProgress = 0;
      regenTotal = 0;
      regenMessage = force ? 'Regenerating ALL thumbnails and previews...' : 'Starting thumbnail regeneration...';

      const result = await window.electronAPI.media.regenerateAllThumbnails({ force });

      if (result.total === 0 && result.rawTotal === 0) {
        regenMessage = 'All images already have thumbnails and previews';
      } else {
        // Kanye9: Show both thumbnail and preview extraction stats
        const thumbMsg = result.total > 0 ? `${result.generated}/${result.total} thumbnails` : '';
        const previewMsg = result.rawTotal > 0 ? `${result.previewsExtracted}/${result.rawTotal} RAW previews` : '';
        const failMsg = (result.failed + (result.previewsFailed || 0)) > 0 ? `(${result.failed + (result.previewsFailed || 0)} failed)` : '';
        regenMessage = `Processed: ${[thumbMsg, previewMsg].filter(Boolean).join(', ')} ${failMsg}`.trim();

        // Bust the cache to force all images to reload with new thumbnails
        thumbnailCache.bust();
      }

      setTimeout(() => {
        regenMessage = '';
      }, 5000);
    } catch (error) {
      console.error('Thumbnail regeneration failed:', error);
      regenMessage = 'Thumbnail regeneration failed';
    } finally {
      regenerating = false;
    }
  }

  // Migration 30: DNG LibRaw rendering state
  let renderingDng = $state(false);
  let dngMessage = $state('');

  // Video fix state
  let fixingVideos = $state(false);
  let videoFixMessage = $state('');

  /**
   * Migration 30: Regenerate DNG previews using LibRaw for full-quality rendering
   * This fixes "potato quality" drone shots where embedded preview is tiny (960x720 for 5376x3956)
   */
  async function regenerateDngPreviews() {
    if (!window.electronAPI?.media?.regenerateDngPreviews) {
      dngMessage = 'DNG rendering not available';
      return;
    }

    try {
      renderingDng = true;
      dngMessage = 'Rendering DNG files with LibRaw...';

      const result = await window.electronAPI.media.regenerateDngPreviews();

      if (result.total === 0) {
        dngMessage = 'No DNG files need re-rendering';
      } else {
        dngMessage = `Rendered ${result.rendered}/${result.total} DNG files${result.failed > 0 ? ` (${result.failed} failed)` : ''}`;
        // Bust cache to force reload
        thumbnailCache.bust();
      }

      setTimeout(() => {
        dngMessage = '';
      }, 5000);
    } catch (error) {
      console.error('DNG rendering failed:', error);
      dngMessage = 'DNG rendering failed';
    } finally {
      renderingDng = false;
    }
  }

  /**
   * Fix Images: Combined operation that runs all image repair operations sequentially
   * 1. Regenerate missing thumbnails
   * 2. Fix rotations (force regenerate)
   * 3. Fix DNG quality (LibRaw)
   */
  async function fixAllImages() {
    if (!window.electronAPI?.media?.regenerateAllThumbnails) {
      regenMessage = 'Image fix not available';
      return;
    }

    try {
      regenerating = true;
      regenMessage = 'Step 1/3: Regenerating missing thumbnails...';

      // Step 1: Regenerate missing thumbnails
      const step1 = await window.electronAPI.media.regenerateAllThumbnails({ force: false });

      regenMessage = 'Step 2/3: Fixing rotations...';

      // Step 2: Fix all rotations (force regenerate)
      const step2 = await window.electronAPI.media.regenerateAllThumbnails({ force: true });

      regenerating = false;
      renderingDng = true;
      regenMessage = '';
      dngMessage = 'Step 3/3: Fixing DNG quality...';

      // Step 3: Fix DNG quality
      const step3 = await window.electronAPI.media.regenerateDngPreviews?.() ?? { rendered: 0, failed: 0 };

      // Show combined results
      const totalProcessed = step1.total + step2.total + (step3.total || 0);
      const totalFailed = step1.failed + step2.failed + (step3.failed || 0);

      dngMessage = totalProcessed > 0
        ? `Done! Processed ${totalProcessed} images${totalFailed > 0 ? ` (${totalFailed} failed)` : ''}`
        : 'All images already up to date';

      thumbnailCache.bust();

      setTimeout(() => {
        dngMessage = '';
      }, 5000);
    } catch (error) {
      console.error('Fix images failed:', error);
      regenMessage = '';
      dngMessage = 'Image fix failed';
    } finally {
      regenerating = false;
      renderingDng = false;
    }
  }

  /**
   * Fix Videos: Regenerate poster frames and thumbnails for all videos
   */
  async function fixAllVideos() {
    if (!window.electronAPI?.media?.regenerateVideoThumbnails) {
      videoFixMessage = 'Video fix not available';
      return;
    }

    try {
      fixingVideos = true;
      videoFixMessage = 'Regenerating video thumbnails...';

      const result = await window.electronAPI.media.regenerateVideoThumbnails({ force: true });

      if (result.total === 0) {
        videoFixMessage = 'No videos to process';
      } else {
        videoFixMessage = `Done! Processed ${result.generated}/${result.total} videos${result.failed > 0 ? ` (${result.failed} failed)` : ''}`;
        thumbnailCache.bust();
      }

      setTimeout(() => {
        videoFixMessage = '';
      }, 5000);
    } catch (error) {
      console.error('Fix videos failed:', error);
      videoFixMessage = 'Video fix failed';
    } finally {
      fixingVideos = false;
    }
  }

  /**
   * Kanye9: Normalize all addresses using AddressService
   * This backfills address_raw, address_normalized, address_parsed_json for existing locations
   */
  async function normalizeAllAddresses() {
    if (!window.electronAPI?.locations) {
      normalizeMessage = 'Location API not available';
      return;
    }

    try {
      normalizing = true;
      normalizeMessage = 'Normalizing addresses...';

      // Get all locations
      const locations = await window.electronAPI.locations.findAll();
      let processed = 0;
      let updated = 0;

      for (const loc of locations) {
        // Skip if no address data
        if (!loc.address?.street && !loc.address?.city && !loc.address?.zipcode) {
          processed++;
          continue;
        }

        // Update location to trigger address normalization
        await window.electronAPI.locations.update(loc.locid, {
          address: loc.address
        });

        processed++;
        updated++;
        normalizeMessage = `Normalized ${processed} of ${locations.length} locations...`;
      }

      normalizeMessage = `Done! Normalized ${updated} locations with address data.`;
      setTimeout(() => {
        normalizeMessage = '';
      }, 5000);
    } catch (error) {
      console.error('Address normalization failed:', error);
      normalizeMessage = 'Normalization failed';
    } finally {
      normalizing = false;
    }
  }

  // P6: Darktable functions removed per v010steps.md

  /**
   * DECISION-012: Backfill region fields for existing locations
   * Populates Census region, division, state direction, and cultural region
   */
  async function backfillRegions() {
    if (!window.electronAPI?.locations?.backfillRegions) {
      backfillMessage = 'Region backfill not available';
      return;
    }

    try {
      backfillingRegions = true;
      backfillMessage = 'Calculating regions for all locations...';

      const result = await window.electronAPI.locations.backfillRegions();

      if (result.updated === 0) {
        backfillMessage = `All ${result.total} locations already have region data`;
      } else {
        backfillMessage = `Updated ${result.updated} of ${result.total} locations with region data`;
      }

      setTimeout(() => {
        backfillMessage = '';
      }, 5000);
    } catch (error) {
      console.error('Region backfill failed:', error);
      backfillMessage = 'Region backfill failed';
    } finally {
      backfillingRegions = false;
    }
  }

  /**
   * Migration 23: Detect and hide Live Photo videos and SDR duplicates
   * Scans all locations and auto-hides companion files
   */
  async function detectAllLivePhotos() {
    if (!window.electronAPI?.media?.detectLivePhotosAndSDR || !window.electronAPI?.locations) {
      livePhotoMessage = 'Live Photo detection not available';
      return;
    }

    try {
      detectingLivePhotos = true;
      livePhotoMessage = 'Scanning locations...';

      // Get all locations
      const locations = await window.electronAPI.locations.findAll();
      let processed = 0;
      let totalHidden = 0;

      for (const loc of locations) {
        processed++;
        livePhotoMessage = `Scanning ${processed} of ${locations.length} locations...`;

        const result = await window.electronAPI.media.detectLivePhotosAndSDR(loc.locid);
        if (result?.livePhotosHidden) {
          totalHidden += result.livePhotosHidden;
        }
        if (result?.sdrHidden) {
          totalHidden += result.sdrHidden;
        }
      }

      if (totalHidden === 0) {
        livePhotoMessage = `Scanned ${locations.length} locations. No new Live Photos or SDR duplicates found.`;
      } else {
        livePhotoMessage = `Done! Found and hid ${totalHidden} Live Photo videos and SDR duplicates across ${locations.length} locations.`;
      }

      setTimeout(() => {
        livePhotoMessage = '';
      }, 8000);
    } catch (error) {
      console.error('Live Photo detection failed:', error);
      livePhotoMessage = 'Detection failed';
    } finally {
      detectingLivePhotos = false;
    }
  }

  /**
   * Migration 36: Load video proxy cache statistics
   */
  async function loadProxyCacheStats() {
    if (!window.electronAPI?.media?.getProxyCacheStats) return;
    try {
      proxyCacheStats = await window.electronAPI.media.getProxyCacheStats();
    } catch (error) {
      console.error('Failed to load proxy cache stats:', error);
    }
  }

  /**
   * OPT-053: DEPRECATED - Proxies are now permanent (Immich model)
   * This function calls a no-op handler for backwards compatibility
   */
  async function purgeOldProxies() {
    if (!window.electronAPI?.media?.purgeOldProxies) {
      proxyMessage = 'Proxy purge not available';
      return;
    }

    try {
      purgingProxies = true;
      proxyMessage = 'Purging old proxies...';

      const result = await window.electronAPI.media.purgeOldProxies(30);

      if (result.deleted === 0) {
        proxyMessage = 'No proxies older than 30 days found';
      } else {
        proxyMessage = `Purged ${result.deleted} old proxies (freed ${result.freedMB} MB)`;
      }

      await loadProxyCacheStats();

      setTimeout(() => {
        proxyMessage = '';
      }, 5000);
    } catch (error) {
      console.error('Proxy purge failed:', error);
      proxyMessage = 'Purge failed';
    } finally {
      purgingProxies = false;
    }
  }

  /**
   * OPT-053: DEPRECATED - Proxies are now permanent (Immich model)
   * This function calls a no-op handler for backwards compatibility
   */
  async function clearAllProxies() {
    if (!window.electronAPI?.media?.clearAllProxies) {
      proxyMessage = 'Proxy clear not available';
      return;
    }

    if (!confirm('Are you sure you want to clear all video proxies? They will be regenerated as needed.')) {
      return;
    }

    try {
      clearingProxies = true;
      proxyMessage = 'Clearing all proxies...';

      const result = await window.electronAPI.media.clearAllProxies();
      proxyMessage = `Cleared ${result.deleted} proxies (freed ${result.freedMB} MB)`;

      await loadProxyCacheStats();

      setTimeout(() => {
        proxyMessage = '';
      }, 5000);
    } catch (error) {
      console.error('Proxy clear failed:', error);
      proxyMessage = 'Clear failed';
    } finally {
      clearingProxies = false;
    }
  }

  /**
   * Load reference maps list
   * OPT-048: Removed findCataloguedPoints() call - was O(N×M) blocking operation
   */
  async function loadRefMaps() {
    if (!window.electronAPI?.refMaps) return;
    try {
      refMaps = await window.electronAPI.refMaps.findAll();
      const stats = await window.electronAPI.refMaps.getStats();
      refMapStats = { mapCount: stats.mapCount, pointCount: stats.pointCount };
      // OPT-048: cataloguedCount is now calculated on-demand via loadCataloguedCount()
    } catch (error) {
      console.error('Failed to load reference maps:', error);
    }
  }

  /**
   * OPT-048: Load catalogued count on-demand (expensive O(N×M) operation)
   * Called when user clicks "Calculate" button, not on page load
   */
  async function loadCataloguedCount() {
    if (!window.electronAPI?.refMaps?.findCataloguedPoints || loadingCatalogued) return;
    try {
      loadingCatalogued = true;
      const cataloguedResult = await window.electronAPI.refMaps.findCataloguedPoints();
      if (cataloguedResult.success) {
        cataloguedCount = cataloguedResult.count;
      }
    } catch (error) {
      console.error('Failed to load catalogued count:', error);
    } finally {
      loadingCatalogued = false;
    }
  }

  /**
   * Purge reference points that are already catalogued
   */
  async function purgeCataloguedPoints() {
    if (!window.electronAPI?.refMaps?.purgeCataloguedPoints) {
      purgeMessage = 'Purge not available';
      return;
    }

    try {
      purgingPoints = true;
      purgeMessage = 'Purging catalogued points...';

      const result = await window.electronAPI.refMaps.purgeCataloguedPoints();

      if (!result.success) {
        purgeMessage = result.error || 'Purge failed';
      } else {
        purgeMessage = result.message || `Purged ${result.deleted} points`;
        await loadRefMaps(); // Refresh stats
      }

      setTimeout(() => { purgeMessage = ''; }, 5000);
    } catch (error) {
      console.error('Purge failed:', error);
      purgeMessage = 'Purge failed';
      setTimeout(() => { purgeMessage = ''; }, 5000);
    } finally {
      purgingPoints = false;
    }
  }

  /**
   * Import reference map file(s)
   * ADR-048: Now supports multi-select
   * - 1 file → existing preview/dedup flow
   * - Multiple files → batch import with auto-skip duplicates
   */
  async function importRefMap() {
    if (!window.electronAPI?.refMaps) {
      refMapMessage = 'Reference maps not available';
      return;
    }

    try {
      importingRefMap = true;
      refMapMessage = 'Selecting files...';

      // Open file dialog (now returns string[])
      const files = await window.electronAPI.refMaps.selectFile();

      if (!files || files.length === 0) {
        refMapMessage = '';
        importingRefMap = false;
        return;
      }

      // ADR-048: Multiple files → batch import
      if (files.length > 1) {
        refMapMessage = `Importing ${files.length} maps...`;
        const batchResult = await window.electronAPI.refMaps.importBatch(files, currentUserId || undefined);

        if (batchResult.totalPoints > 0) {
          refMapMessage = `Imported ${batchResult.totalPoints} points from ${batchResult.successCount} map${batchResult.successCount > 1 ? 's' : ''}`;
          if (batchResult.skippedCount > 0) {
            refMapMessage += ` (${batchResult.skippedCount} skipped as duplicates)`;
          }
        } else if (batchResult.skippedCount > 0) {
          refMapMessage = `All ${batchResult.skippedCount} maps were duplicates`;
        } else {
          refMapMessage = 'No points imported';
        }

        await loadRefMaps();
        importingRefMap = false;
        setTimeout(() => { refMapMessage = ''; }, 5000);
        return;
      }

      // Single file → existing preview flow
      const result = files[0];

      // Show preview with deduplication check
      previewLoading = true;
      refMapMessage = 'Analyzing file...';

      const preview = await window.electronAPI.refMaps.previewImport(result);

      if (!preview.success) {
        refMapMessage = preview.error || 'Failed to analyze file';
        previewLoading = false;
        importingRefMap = false;
        setTimeout(() => { refMapMessage = ''; }, 5000);
        return;
      }

      // Show preview modal
      importPreview = {
        fileName: preview.fileName || '',
        filePath: preview.filePath || '',
        fileType: preview.fileType || '',
        totalPoints: preview.totalPoints || 0,
        newPoints: preview.newPoints || 0,
        newPointsStateBreakdown: preview.newPointsStateBreakdown || [],
        // Migration 42: Enrichment opportunities
        enrichmentCount: preview.enrichmentCount || 0,
        enrichmentOpportunities: preview.enrichmentOpportunities || [],
        // Already catalogued (have GPS)
        cataloguedCount: preview.cataloguedCount || 0,
        cataloguedMatches: preview.cataloguedMatches || [],
        referenceCount: preview.referenceCount || 0,
        referenceMatches: preview.referenceMatches || [],
      };
      skipDuplicates = true;
      // Migration 42: Reset enrichment selections and auto-select 90%+ matches
      selectedEnrichments = new Map();
      // Auto-check enrichments with 90%+ similarity
      // CRITICAL: Must store pointIndex (number), NOT boolean - IPC handler needs index to find GPS coords
      for (const opp of preview.enrichmentOpportunities || []) {
        if (opp.nameSimilarity >= 90 && opp.pointIndex !== undefined) {
          selectedEnrichments.set(opp.existingId, opp.pointIndex);
        }
      }
      showImportPreview = true;
      previewLoading = false;
      refMapMessage = '';
    } catch (error) {
      console.error('Reference map import failed:', error);
      refMapMessage = 'Import failed';
      setTimeout(() => { refMapMessage = ''; }, 5000);
      previewLoading = false;
    } finally {
      importingRefMap = false;
    }
  }

  /**
   * Confirm import with deduplication options
   * Migration 42: Also passes selected enrichments to apply GPS to existing locations
   */
  async function confirmImport() {
    if (!window.electronAPI?.refMaps || !importPreview) return;

    try {
      importingRefMap = true;
      refMapMessage = 'Importing...';

      // Migration 42: Convert selected enrichments map to array format
      const enrichments = Array.from(selectedEnrichments.entries()).map(([existingLocId, pointIndex]) => ({
        existingLocId,
        pointIndex,
      }));

      const result = await window.electronAPI.refMaps.importWithOptions(importPreview.filePath, {
        skipDuplicates,
        importedBy: currentUserId || undefined,
        enrichments: enrichments.length > 0 ? enrichments : undefined,
      });

      showImportPreview = false;
      importPreview = null;
      selectedEnrichments = new Map();

      if (result.skippedAll) {
        refMapMessage = result.message || 'All points were duplicates';
      } else if (!result.success) {
        refMapMessage = result.error || 'Import failed';
      } else {
        const skippedMsg = result.skippedCount ? ` (${result.skippedCount} duplicates skipped)` : '';
        const enrichedMsg = result.enrichedCount ? ` (${result.enrichedCount} locations enriched with GPS)` : '';
        refMapMessage = `Imported "${result.map?.mapName}" with ${result.pointCount} points${skippedMsg}${enrichedMsg}`;
        await loadRefMaps();
      }

      setTimeout(() => { refMapMessage = ''; }, 5000);
    } catch (error) {
      console.error('Reference map import failed:', error);
      refMapMessage = 'Import failed';
      setTimeout(() => { refMapMessage = ''; }, 5000);
    } finally {
      importingRefMap = false;
    }
  }

  /**
   * Migration 42: Toggle enrichment selection for a match
   */
  function toggleEnrichment(match: DuplicateMatchPreview) {
    if (match.pointIndex === undefined) return;

    const newMap = new Map(selectedEnrichments);
    if (newMap.has(match.existingId)) {
      newMap.delete(match.existingId);
    } else {
      newMap.set(match.existingId, match.pointIndex);
    }
    selectedEnrichments = newMap;
  }

  /**
   * Migration 42: Select ALL enrichments (check all button)
   */
  function selectAllEnrichments() {
    if (!importPreview) return;

    const newMap = new Map<string, number>();
    for (const match of importPreview.enrichmentOpportunities) {
      if (match.pointIndex !== undefined) {
        newMap.set(match.existingId, match.pointIndex);
      }
    }
    selectedEnrichments = newMap;
  }

  /**
   * Migration 42: Deselect all enrichments
   */
  function deselectAllEnrichments() {
    selectedEnrichments = new Map();
  }

  /**
   * Get color class for similarity percentage pill
   * 100% = black (primary), 90%+ = success, 72%+ = warning, <72% = error
   * Uses functional colors per Braun design (color = information)
   */
  function getSimilarityPillClass(similarity: number): string {
    if (similarity === 100) return 'bg-braun-900 text-white';
    if (similarity >= 90) return 'bg-success text-white';
    if (similarity >= 72) return 'bg-warning text-white';
    return 'bg-error text-white';
  }


  /**
   * Cancel import preview
   */
  function cancelImportPreview() {
    showImportPreview = false;
    importPreview = null;
    refMapMessage = '';
  }

  /**
   * Delete a reference map
   */
  async function deleteRefMap(mapId: string) {
    if (!window.electronAPI?.refMaps) return;

    const map = refMaps.find(m => m.mapId === mapId);
    if (!confirm(`Delete "${map?.mapName}"? This will remove all ${map?.pointCount || 0} points.`)) {
      return;
    }

    try {
      await window.electronAPI.refMaps.delete(mapId);
      await loadRefMaps();
      refMapMessage = 'Map deleted';
      setTimeout(() => { refMapMessage = ''; }, 3000);
    } catch (error) {
      console.error('Failed to delete reference map:', error);
      refMapMessage = 'Delete failed';
      setTimeout(() => { refMapMessage = ''; }, 5000);
    }
  }

  // PIN verification helpers
  async function requestPinForAction(action: 'archive' | 'deleteOnImport' | 'startupPin') {
    // Check if current user has a PIN set
    if (!currentUserId) {
      // No user logged in, proceed directly
      executePinAction(action);
      return;
    }

    try {
      const hasPin = await window.electronAPI.users.hasPin(currentUserId);
      if (!hasPin) {
        // User doesn't have a PIN, proceed directly
        executePinAction(action);
        return;
      }

      // User has a PIN, show modal
      pinAction = action;
      pinInput = '';
      pinError = '';
      showPinModal = true;
    } catch (error) {
      console.error('Error checking PIN status:', error);
      // On error, proceed without PIN (fail open for usability)
      executePinAction(action);
    }
  }

  function closePinModal() {
    showPinModal = false;
    pinAction = null;
    pinInput = '';
    pinError = '';
    pinVerifying = false;
  }

  async function verifyAndExecutePinAction() {
    if (!currentUserId || !pinAction) return;

    pinVerifying = true;
    pinError = '';

    try {
      const result = await window.electronAPI.users.verifyPin(currentUserId, pinInput);
      if (result.success) {
        const action = pinAction;
        closePinModal();
        executePinAction(action);
      } else {
        pinError = 'Incorrect PIN';
        pinInput = '';
      }
    } catch (error) {
      console.error('Error verifying PIN:', error);
      pinError = 'Verification failed';
    } finally {
      pinVerifying = false;
    }
  }

  function executePinAction(action: 'archive' | 'startupPin') {
    if (action === 'archive') {
      selectArchiveFolder();
    } else if (action === 'startupPin') {
      toggleRequireLogin();
    }
  }

  // Location picker modal helpers
  function openLocationPicker(mode: 'purge' | 'addresses' | 'images' | 'videos') {
    pickerMode = mode;
    pickerSearchQuery = '';
    pickerSearchResults = [];
    pickerSelectedLocation = null;
    pickerMessage = '';
    showLocationPicker = true;
  }

  function closeLocationPicker() {
    showLocationPicker = false;
    pickerMode = null;
    pickerSearchQuery = '';
    pickerSearchResults = [];
    pickerSelectedLocation = null;
  }

  let searchDebounceTimer: ReturnType<typeof setTimeout>;
  async function handlePickerSearch() {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

    if (!pickerSearchQuery.trim()) {
      pickerSearchResults = [];
      return;
    }

    searchDebounceTimer = setTimeout(async () => {
      if (!window.electronAPI?.locations) return;
      try {
        const locations = await window.electronAPI.locations.findAll();
        const query = pickerSearchQuery.toLowerCase();
        pickerSearchResults = locations
          .filter((loc: { locnam: string; address?: { state?: string } }) =>
            loc.locnam.toLowerCase().includes(query)
          )
          .slice(0, 10)
          .map((loc: { locid: string; locnam: string; address?: { state?: string } }) => ({
            locid: loc.locid,
            locnam: loc.locnam,
            state: loc.address?.state
          }));
      } catch (error) {
        console.error('Search failed:', error);
      }
    }, 200);
  }

  function selectPickerLocation(loc: LocationBasic) {
    pickerSelectedLocation = loc;
    pickerSearchQuery = loc.locnam;
    pickerSearchResults = [];
  }

  function clearPickerLocation() {
    pickerSelectedLocation = null;
    pickerSearchQuery = '';
    pickerSearchResults = [];
  }

  function getPickerTitle(): string {
    switch (pickerMode) {
      case 'purge': return 'Purge Cache';
      case 'addresses': return 'Fix Addresses';
      case 'images': return 'Fix Images';
      case 'videos': return 'Fix Videos';
      default: return '';
    }
  }

  function getPickerButtonText(): string {
    const hasLocation = pickerSelectedLocation !== null;
    switch (pickerMode) {
      case 'purge': return hasLocation ? 'Purge' : 'Purge All';
      case 'addresses': return hasLocation ? 'Fix Addresses' : 'Fix All Addresses';
      case 'images': return hasLocation ? 'Fix Images' : 'Fix All Images';
      case 'videos': return hasLocation ? 'Fix Videos' : 'Fix All Videos';
      default: return 'Run';
    }
  }

  async function runPickerAction() {
    if (!pickerMode) return;

    pickerLoading = true;
    const locationId = pickerSelectedLocation?.locid;

    try {
      switch (pickerMode) {
        case 'purge':
          await runPurgeCache(locationId);
          break;
        case 'addresses':
          await runFixAddresses(locationId);
          break;
        case 'images':
          await runFixImagesWithLivePhoto(locationId);
          break;
        case 'videos':
          await runFixVideosWithLivePhoto(locationId);
          break;
      }
      closeLocationPicker();
    } catch (error) {
      console.error('Action failed:', error);
      pickerMessage = 'Operation failed';
    } finally {
      pickerLoading = false;
    }
  }

  // Combined fix functions with location targeting
  async function runPurgeCache(locationId?: string) {
    if (!window.electronAPI?.media?.clearAllProxies) {
      proxyMessage = 'Proxy clear not available';
      return;
    }

    try {
      proxyMessage = locationId ? 'Clearing proxies for location...' : 'Clearing all proxies...';
      // Note: Current API doesn't support per-location purge, so this clears all
      // In future, could add location-specific purge
      const result = await window.electronAPI.media.clearAllProxies();
      proxyMessage = `Cleared ${result.deleted} proxies (freed ${result.freedMB} MB)`;
      await loadProxyCacheStats();
      setTimeout(() => { proxyMessage = ''; }, 5000);
    } catch (error) {
      console.error('Proxy clear failed:', error);
      proxyMessage = 'Clear failed';
    }
  }

  async function runFixAddresses(locationId?: string) {
    if (!window.electronAPI?.locations) {
      normalizeMessage = 'Location API not available';
      return;
    }

    try {
      normalizing = true;
      backfillingRegions = true;

      // Step 1: Normalize addresses
      normalizeMessage = 'Step 1/2: Normalizing addresses...';
      const locations = locationId
        ? [await window.electronAPI.locations.findById(locationId)].filter(Boolean)
        : await window.electronAPI.locations.findAll();

      let processed = 0;
      for (const loc of locations) {
        if (loc.address?.street || loc.address?.city || loc.address?.zipcode) {
          await window.electronAPI.locations.update(loc.locid, { address: loc.address });
        }
        processed++;
        normalizeMessage = `Step 1/2: Normalized ${processed} of ${locations.length}...`;
      }

      // Step 2: Backfill regions
      normalizeMessage = 'Step 2/2: Backfilling regions...';
      if (window.electronAPI.locations.backfillRegions) {
        await window.electronAPI.locations.backfillRegions();
      }

      normalizeMessage = `Done! Processed ${locations.length} location${locations.length !== 1 ? 's' : ''}`;
      setTimeout(() => { normalizeMessage = ''; }, 5000);
    } catch (error) {
      console.error('Fix addresses failed:', error);
      normalizeMessage = 'Fix addresses failed';
    } finally {
      normalizing = false;
      backfillingRegions = false;
    }
  }

  async function runFixImagesWithLivePhoto(locationId?: string) {
    if (!window.electronAPI?.media?.regenerateAllThumbnails) {
      regenMessage = 'Image fix not available';
      return;
    }

    try {
      regenerating = true;

      // Step 1: Fix images (thumbnails + DNG)
      regenMessage = 'Step 1/2: Fixing images...';
      const step1 = await window.electronAPI.media.regenerateAllThumbnails({ force: true });

      if (window.electronAPI.media.regenerateDngPreviews) {
        await window.electronAPI.media.regenerateDngPreviews();
      }

      // Step 2: Detect Live Photos
      regenMessage = 'Step 2/2: Detecting Live Photos...';
      if (window.electronAPI.media.detectLivePhotosAndSDR && window.electronAPI.locations) {
        const locations = locationId
          ? [await window.electronAPI.locations.findById(locationId)].filter(Boolean)
          : await window.electronAPI.locations.findAll();

        for (const loc of locations) {
          await window.electronAPI.media.detectLivePhotosAndSDR(loc.locid);
        }
      }

      thumbnailCache.bust();
      regenMessage = 'Done! Images fixed and Live Photos detected';
      setTimeout(() => { regenMessage = ''; }, 5000);
    } catch (error) {
      console.error('Fix images failed:', error);
      regenMessage = 'Fix images failed';
    } finally {
      regenerating = false;
    }
  }

  async function runFixVideosWithLivePhoto(locationId?: string) {
    if (!window.electronAPI?.media?.regenerateVideoThumbnails) {
      videoFixMessage = 'Video fix not available';
      return;
    }

    try {
      fixingVideos = true;

      // Step 1: Fix videos
      videoFixMessage = 'Step 1/2: Fixing videos...';
      await window.electronAPI.media.regenerateVideoThumbnails({ force: true });

      // Step 2: Detect Live Photos
      videoFixMessage = 'Step 2/2: Detecting Live Photos...';
      if (window.electronAPI.media.detectLivePhotosAndSDR && window.electronAPI.locations) {
        const locations = locationId
          ? [await window.electronAPI.locations.findById(locationId)].filter(Boolean)
          : await window.electronAPI.locations.findAll();

        for (const loc of locations) {
          await window.electronAPI.media.detectLivePhotosAndSDR(loc.locid);
        }
      }

      thumbnailCache.bust();
      videoFixMessage = 'Done! Videos fixed and Live Photos detected';
      setTimeout(() => { videoFixMessage = ''; }, 5000);
    } catch (error) {
      console.error('Fix videos failed:', error);
      videoFixMessage = 'Fix videos failed';
    } finally {
      fixingVideos = false;
    }
  }

  // Database functions (moved from DatabaseSettings component)
  let backingUp = $state(false);
  let backupMessage = $state('');
  let restoring = $state(false);
  let restoreMessage = $state('');

  async function backupDatabase() {
    try {
      backingUp = true;
      backupMessage = '';

      const result = await window.electronAPI.database.backup();

      if (result.success) {
        backupMessage = `Backed up to: ${result.path}`;
      } else {
        backupMessage = result.message || 'Backup canceled';
      }

      setTimeout(() => { backupMessage = ''; }, 5000);
    } catch (error) {
      console.error('Error backing up database:', error);
      backupMessage = 'Error backing up database';
      setTimeout(() => { backupMessage = ''; }, 5000);
    } finally {
      backingUp = false;
    }
  }

  async function restoreDatabase() {
    try {
      restoring = true;
      restoreMessage = '';

      const result = await window.electronAPI.database.restore();

      if (result.success) {
        restoreMessage = result.message;
      } else {
        restoreMessage = result.message || 'Restore canceled';
        setTimeout(() => { restoreMessage = ''; }, 5000);
      }
    } catch (error) {
      console.error('Error restoring database:', error);
      restoreMessage = 'Error restoring database';
      setTimeout(() => { restoreMessage = ''; }, 5000);
    } finally {
      restoring = false;
    }
  }

  // User Backup: Export database to user-selected location
  async function userBackupDatabase() {
    if (!window.electronAPI?.database?.exportBackup) {
      backupMessage = 'User backup not available';
      setTimeout(() => { backupMessage = ''; }, 5000);
      return;
    }

    try {
      userExporting = true;
      backupMessage = '';

      const result = await window.electronAPI.database.exportBackup();

      if (result.success) {
        backupMessage = `Exported to: ${result.path}`;
        await loadDatabaseHealth(); // Refresh stats
      } else {
        backupMessage = result.message || 'Export canceled';
      }

      setTimeout(() => { backupMessage = ''; }, 5000);
    } catch (error) {
      console.error('Error exporting database:', error);
      backupMessage = 'Error exporting database';
      setTimeout(() => { backupMessage = ''; }, 5000);
    } finally {
      userExporting = false;
    }
  }

  // Open restore modal with list of internal backups
  async function openRestoreModal() {
    if (!window.electronAPI?.database?.listBackups) {
      restoreMessage = 'Internal restore not available';
      setTimeout(() => { restoreMessage = ''; }, 5000);
      return;
    }

    try {
      const result = await window.electronAPI.database.listBackups();
      if (result.success) {
        internalBackups = result.backups || [];
        showRestoreModal = true;
      } else {
        restoreMessage = result.message || 'Failed to list backups';
        setTimeout(() => { restoreMessage = ''; }, 5000);
      }
    } catch (error) {
      console.error('Error listing backups:', error);
      restoreMessage = 'Error listing backups';
      setTimeout(() => { restoreMessage = ''; }, 5000);
    }
  }

  // Restore from internal backup
  async function restoreFromBackup(backupId: string) {
    if (!window.electronAPI?.database?.restoreFromInternal) {
      restoreMessage = 'Internal restore not available';
      setTimeout(() => { restoreMessage = ''; }, 5000);
      return;
    }

    try {
      restoring = true;
      showRestoreModal = false;
      restoreMessage = '';

      const result = await window.electronAPI.database.restoreFromInternal(backupId);

      if (result.success) {
        restoreMessage = result.message || 'Database restored. Please restart.';
      } else {
        restoreMessage = result.message || 'Restore failed';
        setTimeout(() => { restoreMessage = ''; }, 5000);
      }
    } catch (error) {
      console.error('Error restoring from backup:', error);
      restoreMessage = 'Error restoring from backup';
      setTimeout(() => { restoreMessage = ''; }, 5000);
    } finally {
      restoring = false;
    }
  }

  // Load database health stats
  async function loadDatabaseHealth() {
    if (!window.electronAPI?.database?.getStats) return;
    try {
      const stats = await window.electronAPI.database.getStats();
      dbHealthy = stats.integrityOk;
      backupCount = stats.backupCount;
    } catch (error) {
      console.error('Failed to load database health:', error);
    }
  }

  // Database Archive Export: Load archive status
  async function loadArchiveExportStatus() {
    if (!window.electronAPI?.database?.archiveStatus) return;
    try {
      archiveExportStatus = await window.electronAPI.database.archiveStatus();
    } catch (error) {
      console.error('Failed to load archive export status:', error);
    }
  }

  // Database Archive Export: Trigger manual export
  async function exportToArchive() {
    if (!window.electronAPI?.database?.archiveExport || archiveExporting) return;
    try {
      archiveExporting = true;
      archiveExportMessage = '';

      const result = await window.electronAPI.database.archiveExport();

      if (result.success) {
        archiveExportMessage = `Exported to archive (${result.size})`;
        // Refresh the status
        await loadArchiveExportStatus();
      } else {
        archiveExportMessage = result.message || 'Export failed';
      }
    } catch (error) {
      archiveExportMessage = 'Export failed: ' + (error instanceof Error ? error.message : 'Unknown error');
    } finally {
      archiveExporting = false;
    }
  }

  // Helper to format bytes to human readable
  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Load storage stats for archive drive
  async function loadStorageStats() {
    if (!window.electronAPI?.storage?.getStats) return;
    try {
      loadingStorage = true;
      storageStats = await window.electronAPI.storage.getStats();
    } catch (error) {
      console.error('Failed to load storage stats:', error);
    } finally {
      loadingStorage = false;
    }
  }

  // OPT-047: Verify storage integrity - backfills missing file sizes, checks for corruption
  async function verifyStorageIntegrity() {
    if (!window.electronAPI?.storage?.verifyIntegrity || verifyingStorage) return;

    try {
      verifyingStorage = true;
      verifyProgress = { processed: 0, currentFile: 'Starting...' };
      verifyResult = null;

      // Set up progress listener
      const unsubscribe = window.electronAPI.storage.onVerifyProgress((progress: { processed: number; currentFile: string }) => {
        verifyProgress = progress;
      });

      const result = await window.electronAPI.storage.verifyIntegrity();

      unsubscribe();
      verifyProgress = null;

      verifyResult = {
        newMeasurements: result.newMeasurements,
        sizeMismatches: result.sizeMismatches?.length || 0,
        missingFiles: result.missingFiles?.length || 0,
      };

      // Reload storage stats to show updated values
      await loadStorageStats();

      // Clear result after 10 seconds
      setTimeout(() => { verifyResult = null; }, 10000);
    } catch (error) {
      console.error('Failed to verify storage integrity:', error);
      verifyProgress = null;
    } finally {
      verifyingStorage = false;
    }
  }

  // Helper to format time ago
  function formatTimeAgo(isoDate: string | null | undefined): string {
    if (!isoDate) return 'Never';
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  }

  // BagIt Integrity functions
  async function loadBagSummary() {
    if (!window.electronAPI?.bagit?.summary) return;
    try {
      bagSummary = await window.electronAPI.bagit.summary();
      const lastVal = await window.electronAPI.bagit.lastValidation();
      lastValidation = lastVal;
    } catch (error) {
      console.error('Failed to load bag summary:', error);
    }
  }

  async function validateAllBags() {
    if (!window.electronAPI?.bagit?.validateAll || validatingAllBags) return;

    try {
      validatingAllBags = true;
      bagValidationMessage = 'Starting validation...';

      // Set up progress listener
      const unsubscribe = window.electronAPI.bagit.onProgress((progress: { current: number; total: number; currentLocation: string }) => {
        validationProgress = progress;
        bagValidationMessage = `Validating ${progress.current}/${progress.total}: ${progress.currentLocation}`;
      });

      const result = await window.electronAPI.bagit.validateAll();

      unsubscribe();
      validationProgress = null;

      bagValidationMessage = `Validation complete: ${result.validCount} valid, ${result.incompleteCount} incomplete, ${result.invalidCount} invalid`;
      await loadBagSummary();

      setTimeout(() => { bagValidationMessage = ''; }, 5000);
    } catch (error) {
      console.error('Failed to validate all bags:', error);
      bagValidationMessage = 'Validation failed';
    } finally {
      validatingAllBags = false;
    }
  }

  // OPT-113: Load pending web source count
  async function loadPendingWebSourceCount() {
    if (!window.electronAPI?.websources?.countPending) return;
    try {
      pendingWebSourceCount = await window.electronAPI.websources.countPending();
    } catch (error) {
      console.error('Failed to load pending web source count:', error);
    }
  }

  // OPT-113: Archive all pending web sources
  async function archiveAllPendingWebSources() {
    if (!window.electronAPI?.websources?.archiveAllPending || archivingWebSources) return;

    try {
      archivingWebSources = true;
      webSourceArchiveMessage = 'Queueing archives...';

      const result = await window.electronAPI.websources.archiveAllPending();

      if (result.queued === 0) {
        webSourceArchiveMessage = 'No pending sources to archive';
      } else {
        webSourceArchiveMessage = `Queued ${result.queued} sources for archiving`;
      }

      setTimeout(() => { webSourceArchiveMessage = ''; }, 5000);
    } catch (error) {
      console.error('Failed to archive web sources:', error);
      webSourceArchiveMessage = 'Failed to queue archives';
    } finally {
      archivingWebSources = false;
    }
  }

  onMount(() => {
    loadSettings();
    loadProxyCacheStats();
    loadRefMaps();
    loadStorageStats();
    loadDatabaseHealth();
    loadBagSummary();
    loadArchiveExportStatus();
    loadPendingWebSourceCount();

    // OPT-113: Listen for archive completion to update pending count
    let cleanupArchiveListener: (() => void) | undefined;
    if (window.electronAPI?.websources?.onArchiveComplete) {
      cleanupArchiveListener = window.electronAPI.websources.onArchiveComplete(async () => {
        await loadPendingWebSourceCount();
      });
    }

    return () => {
      cleanupArchiveListener?.();
    };
  });
</script>

<div class="p-8">
  <div class="mb-8">
    <div class="flex items-baseline justify-between">
      <h1 class="text-3xl font-bold text-foreground mb-2">Settings</h1>
      <span class="text-sm text-braun-400">v0.1.0</span>
    </div>
  </div>

  {#if loading}
    <div class="max-w-2xl">
      <p class="text-braun-500">Loading settings...</p>
    </div>
  {:else}
    <div class="max-w-2xl">
      <!-- User Management -->
      <div class="bg-white rounded border border-braun-300 mb-6 {usersExpanded ? 'p-6' : 'px-6 py-4'}">
        <!-- Accordion Header -->
        <button
          onclick={() => usersExpanded = !usersExpanded}
          aria-expanded={usersExpanded}
          class="w-full flex items-center justify-between text-left hover:opacity-80 transition-opacity"
        >
          <h2 class="text-lg font-semibold text-foreground leading-none">Users</h2>
          <svg
            class="w-5 h-5 text-braun-900 transition-transform duration-200 {usersExpanded ? 'rotate-180' : ''}"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {#if usersExpanded}
        <!-- User List -->
        <div class="space-y-3 mt-4">
          {#each users as user}
            <div class="border border-braun-200 rounded p-4">
              {#if editingUserId === user.user_id}
                <!-- Edit Mode -->
                <div class="space-y-3">
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="block text-xs font-medium text-braun-600 mb-1">Username</label>
                      <input
                        type="text"
                        bind:value={editUsername}
                        class="w-full px-2 py-1 text-sm border border-braun-300 rounded focus:outline-none focus:border-braun-600"
                      />
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-braun-600 mb-1">Display Name</label>
                      <input
                        type="text"
                        bind:value={editDisplayName}
                        placeholder="Optional"
                        class="w-full px-2 py-1 text-sm border border-braun-300 rounded focus:outline-none focus:border-braun-600"
                      />
                    </div>
                  </div>
                  {#if editError}
                    <p class="text-red-500 text-xs">{editError}</p>
                  {/if}
                  <div class="flex gap-2">
                    <button
                      onclick={saveEditUser}
                      class="px-3 py-1 text-sm bg-braun-900 text-white rounded hover:bg-braun-600"
                    >
                      Save
                    </button>
                    <button
                      onclick={cancelEditUser}
                      class="px-3 py-1 text-sm bg-braun-100 text-braun-700 rounded hover:bg-braun-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              {:else if changingPinUserId === user.user_id}
                <!-- Change PIN Mode -->
                <div class="space-y-3">
                  <p class="text-sm font-medium text-foreground">
                    Change PIN for {user.display_name || user.username}
                  </p>
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="block text-xs font-medium text-braun-600 mb-1">New PIN</label>
                      <input
                        type="password"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        maxlength="6"
                        bind:value={changePin}
                        placeholder="4-6 digits"
                        class="w-full px-2 py-1 text-sm border border-braun-300 rounded focus:outline-none focus:border-braun-600 text-center"
                      />
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-braun-600 mb-1">Confirm PIN</label>
                      <input
                        type="password"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        maxlength="6"
                        bind:value={changeConfirmPin}
                        placeholder="Re-enter"
                        class="w-full px-2 py-1 text-sm border border-braun-300 rounded focus:outline-none focus:border-braun-600 text-center"
                      />
                    </div>
                  </div>
                  {#if changePinError}
                    <p class="text-red-500 text-xs">{changePinError}</p>
                  {/if}
                  <div class="flex gap-2">
                    <button
                      onclick={saveChangePin}
                      class="px-3 py-1 text-sm bg-braun-900 text-white rounded hover:bg-braun-600"
                    >
                      Save PIN
                    </button>
                    <button
                      onclick={cancelChangePin}
                      class="px-3 py-1 text-sm bg-braun-100 text-braun-700 rounded hover:bg-braun-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              {:else}
                <!-- View Mode -->
                <div class="flex items-center justify-between">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-foreground">{user.display_name || user.username}</span>
                      {#if currentUserId === user.user_id}
                        <span class="text-xs bg-braun-100 text-braun-900 px-1.5 py-0.5 rounded">Current</span>
                      {/if}
                    </div>
                    {#if user.display_name}
                      <p class="text-xs text-braun-500">@{user.username}</p>
                    {/if}
                  </div>
                  <div class="flex gap-1">
                    <button
                      onclick={() => startEditUser(user)}
                      class="p-1.5 text-braun-500 hover:text-braun-700 hover:bg-braun-100 rounded"
                      title="Edit user"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                      </svg>
                    </button>
                    <button
                      onclick={() => startChangePin(user)}
                      class="p-1.5 text-braun-500 hover:text-braun-700 hover:bg-braun-100 rounded"
                      title="Change PIN"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                      </svg>
                    </button>
                    {#if users.length > 1}
                      <button
                        onclick={() => deleteUser(user)}
                        class="p-1.5 text-braun-500 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Delete user"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                      </button>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          {/each}

          <!-- Add User row -->
          <div class="flex items-center justify-end pt-4 mt-4">
            <button
              onclick={openAddUser}
              class="text-sm text-braun-900 hover:underline"
              title="Add user"
            >
              add user
            </button>
          </div>

          <!-- Add User Form -->
          {#if showAddUser}
            <div class="border border-braun-400 rounded p-4 bg-braun-50">
              <h3 class="font-medium text-foreground mb-3">Add New User</h3>
              <div class="space-y-3">
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-braun-600 mb-1">Username *</label>
                    <input
                      type="text"
                      bind:value={newUsername}
                      placeholder="Enter username"
                      class="w-full px-2 py-1 text-sm border border-braun-300 rounded focus:outline-none focus:border-braun-600"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-braun-600 mb-1">Display Name</label>
                    <input
                      type="text"
                      bind:value={newDisplayName}
                      placeholder="Optional"
                      class="w-full px-2 py-1 text-sm border border-braun-300 rounded focus:outline-none focus:border-braun-600"
                    />
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-braun-600 mb-1">PIN *</label>
                    <input
                      type="password"
                      inputmode="numeric"
                      pattern="[0-9]*"
                      maxlength="6"
                      bind:value={newPin}
                      placeholder="4-6 digits"
                      class="w-full px-2 py-1 text-sm border border-braun-300 rounded focus:outline-none focus:border-braun-600 text-center"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-braun-600 mb-1">Confirm PIN *</label>
                    <input
                      type="password"
                      inputmode="numeric"
                      pattern="[0-9]*"
                      maxlength="6"
                      bind:value={newConfirmPin}
                      placeholder="Re-enter"
                      class="w-full px-2 py-1 text-sm border border-braun-300 rounded focus:outline-none focus:border-braun-600 text-center"
                    />
                  </div>
                </div>
                {#if newUserError}
                  <p class="text-red-500 text-xs">{newUserError}</p>
                {/if}
                <div class="flex gap-2">
                  <button
                    onclick={createUser}
                    class="px-3 py-1 text-sm bg-braun-900 text-white rounded hover:bg-braun-600"
                  >
                    Create User
                  </button>
                  <button
                    onclick={cancelAddUser}
                    class="px-3 py-1 text-sm bg-braun-100 text-braun-700 rounded hover:bg-braun-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          {/if}

          <!-- Startup PIN Required -->
          <div class="flex items-center justify-between pt-4 mt-4 border-t border-braun-200">
            <span class="text-sm font-medium text-braun-700">Startup PIN Required</span>
            <button
              onclick={() => requestPinForAction('startupPin')}
              class="text-sm px-2 py-0.5 rounded transition {requireLogin ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-braun-100 text-braun-600 hover:bg-braun-200'}"
            >
              {requireLogin ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>
        {/if}
      </div>

      <!-- Archive Accordion -->
      <div class="bg-white rounded border border-braun-300 mb-6 overflow-hidden">
        <button
          onclick={() => archiveExpanded = !archiveExpanded}
          class="w-full flex items-center justify-between text-left transition-colors hover:bg-braun-50 {archiveExpanded ? 'p-6' : 'px-6 py-4'}"
        >
          <h2 class="text-lg font-semibold text-foreground">Archive</h2>
          <svg
            class="w-5 h-5 text-braun-900 transition-transform duration-200 {archiveExpanded ? 'rotate-180' : ''}"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {#if archiveExpanded}
        <div class="px-6 pb-6 space-y-4">
          <!-- Archive Location Row -->
          <div class="flex items-center justify-between py-2 border-b border-braun-100">
            <span class="text-sm font-medium text-braun-700">Archive Location</span>
            <button
              onclick={() => requestPinForAction('archive')}
              class="text-sm text-braun-900 hover:underline"
            >
              edit
            </button>
          </div>

          <!-- Database Sub-Accordion -->
          <div>
            <button
              onclick={() => databaseExpanded = !databaseExpanded}
              class="w-full flex items-center justify-between py-2 border-b border-braun-100 text-left hover:bg-braun-50 transition-colors"
            >
              <span class="text-sm font-medium text-braun-700">Database</span>
              <svg
                class="w-4 h-4 text-braun-900 transition-transform duration-200 {databaseExpanded ? 'rotate-180' : ''}"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {#if databaseExpanded}
            <div class="py-3">
              <!-- Status pills inside accordion -->
              <div class="flex items-center gap-2 mb-3">
                <span class="text-xs px-1.5 py-0.5 rounded {dbHealthy ? 'bg-braun-100 text-success' : 'bg-braun-100 text-error'}">
                  {dbHealthy ? 'healthy' : 'needs attention'}
                </span>
                <span class="text-xs px-1.5 py-0.5 rounded {backupCount > 0 ? 'bg-braun-100 text-success' : 'bg-braun-100 text-warning'}">
                  {backupCount} backups
                </span>
              </div>

              <!-- 4 database buttons -->
              <div class="flex flex-wrap gap-2">
                <button
                  onclick={backupDatabase}
                  disabled={backingUp || restoring || userExporting}
                  class="px-3 py-1.5 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
                >
                  {backingUp ? 'Backing up...' : 'Backup'}
                </button>
                <button
                  onclick={userBackupDatabase}
                  disabled={userExporting || backingUp || restoring}
                  class="px-3 py-1.5 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
                >
                  {userExporting ? 'Exporting...' : 'User Backup'}
                </button>
                <button
                  onclick={openRestoreModal}
                  disabled={restoring || backingUp || userExporting}
                  class="px-3 py-1.5 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
                >
                  Restore
                </button>
                <button
                  onclick={restoreDatabase}
                  disabled={restoring || backingUp || userExporting}
                  class="px-3 py-1.5 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
                >
                  {restoring ? 'Restoring...' : 'User Restore'}
                </button>
              </div>
              {#if backupMessage}
                <p class="text-sm mt-2 {backupMessage.includes('Error') || backupMessage.includes('canceled') ? 'text-error' : 'text-success'}">
                  {backupMessage}
                </p>
              {/if}
              {#if restoreMessage}
                <p class="text-sm mt-2 {restoreMessage.includes('Error') || restoreMessage.includes('canceled') || restoreMessage.includes('Invalid') ? 'text-error' : 'text-success'}">
                  {restoreMessage}
                </p>
              {/if}

              <!-- Archive Export Section -->
              <div class="mt-4 pt-3 border-t border-braun-200">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-sm font-medium text-braun-700">Archive Snapshot</span>
                  {#if archiveExportStatus?.configured}
                    <span class="text-xs px-1.5 py-0.5 rounded {archiveExportStatus.verified ? 'bg-braun-100 text-success' : archiveExportStatus.exported ? 'bg-braun-100 text-warning' : 'bg-braun-100 text-braun-600'}">
                      {archiveExportStatus.verified ? 'verified' : archiveExportStatus.exported ? 'exported' : 'none'}
                    </span>
                  {:else}
                    <span class="text-xs px-1.5 py-0.5 rounded bg-braun-100 text-braun-500">
                      not configured
                    </span>
                  {/if}
                </div>

                {#if archiveExportStatus?.lastExport}
                  <p class="text-xs text-braun-500 mb-2">
                    Last: {new Date(archiveExportStatus.lastExport.exportedAt).toLocaleString()}
                  </p>
                {/if}

                <button
                  onclick={exportToArchive}
                  disabled={archiveExporting || !archiveExportStatus?.configured}
                  class="px-3 py-1.5 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
                  title={!archiveExportStatus?.configured ? 'Set archive location first' : 'Export database to archive folder'}
                >
                  {archiveExporting ? 'Exporting...' : 'Export to Archive'}
                </button>

                {#if archiveExportMessage}
                  <p class="text-sm mt-2 {archiveExportMessage.includes('failed') || archiveExportMessage.includes('Error') ? 'text-error' : 'text-success'}">
                    {archiveExportMessage}
                  </p>
                {/if}

                <p class="text-xs text-braun-400 mt-2">
                  Auto-exports on backup and quit. Stored in archive/_database/
                </p>
              </div>
            </div>
            {/if}
          </div>

          <!-- Maps Sub-Accordion (Reference Maps) -->
          <div>
            <button
              onclick={() => mapsExpanded = !mapsExpanded}
              class="w-full flex items-center justify-between py-2 border-b border-braun-100 text-left hover:bg-braun-50 transition-colors"
            >
              <span class="text-sm font-medium text-braun-700">Maps</span>
              <svg
                class="w-4 h-4 text-braun-900 transition-transform duration-200 {mapsExpanded ? 'rotate-180' : ''}"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {#if mapsExpanded}
            <div class="py-3">
              <!-- Stats -->
              {#if refMapStats}
                <div class="bg-braun-50 rounded p-3 mb-3">
                  <div class="flex gap-6 text-sm">
                    <div>
                      <span class="text-braun-500">Imported maps:</span>
                      <span class="font-medium ml-1">{refMapStats.mapCount}</span>
                    </div>
                    <div>
                      <span class="text-braun-500">Total points:</span>
                      <span class="font-medium ml-1">{refMapStats.pointCount.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              {/if}

              <!-- Map List -->
              {#if refMaps.length > 0}
                <div class="space-y-2 mb-3 max-h-48 overflow-y-auto">
                  {#each refMaps as map}
                    <div class="flex items-center justify-between border border-braun-200 rounded p-2">
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="text-sm font-medium text-foreground truncate">{map.mapName}</span>
                          <span class="text-xs bg-braun-100 text-braun-600 px-1 py-0.5 rounded uppercase">{map.fileType}</span>
                        </div>
                        <p class="text-xs text-braun-500">
                          {map.pointCount} points - {new Date(map.importedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onclick={() => deleteRefMap(map.mapId)}
                        class="p-1 text-braun-400 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Delete map"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                      </button>
                    </div>
                  {/each}
                </div>
              {/if}

              <!-- Buttons -->
              <div class="flex justify-end gap-2">
                <!-- OPT-048: Calculate catalogued count on-demand (was blocking page load) -->
                {#if cataloguedCount === null}
                  <button
                    onclick={loadCataloguedCount}
                    disabled={loadingCatalogued}
                    class="px-3 py-1.5 text-sm bg-braun-100 text-braun-700 rounded hover:bg-braun-200 transition disabled:opacity-50"
                    title="Find reference points that match existing locations (may take a moment)"
                  >
                    {loadingCatalogued ? 'Checking...' : 'Check Duplicates'}
                  </button>
                {:else if cataloguedCount > 0}
                  <button
                    onclick={purgeCataloguedPoints}
                    disabled={purgingPoints}
                    class="px-3 py-1.5 text-sm bg-braun-600 text-white rounded hover:bg-braun-500 transition disabled:opacity-50"
                    title="Remove reference points that are already in your locations database"
                  >
                    {purgingPoints ? 'Purging...' : `Purge ${cataloguedCount} Catalogued`}
                  </button>
                {/if}
                <button
                  onclick={importRefMap}
                  disabled={importingRefMap}
                  class="px-3 py-1.5 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
                >
                  {importingRefMap ? 'Importing...' : 'Import Map'}
                </button>
              </div>
              {#if refMapMessage}
                <p class="text-sm text-braun-600 mt-2">{refMapMessage}</p>
              {/if}
              {#if purgeMessage}
                <p class="text-sm text-braun-600 mt-2">{purgeMessage}</p>
              {/if}
            </div>
            {/if}
          </div>

          <!-- Repair Sub-Accordion -->
          <div>
            <button
              onclick={() => maintenanceExpanded = !maintenanceExpanded}
              class="w-full flex items-center justify-between py-2 border-b border-braun-100 text-left hover:bg-braun-50 transition-colors"
            >
              <span class="text-sm font-medium text-braun-700">Repair</span>
              <svg
                class="w-4 h-4 text-braun-900 transition-transform duration-200 {maintenanceExpanded ? 'rotate-180' : ''}"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {#if maintenanceExpanded}
            <div class="py-3">
              <div class="flex flex-wrap gap-2">
                <!-- OPT-053: Removed "Purge Cache" button - proxies are now permanent (Immich model) -->
                <button
                  onclick={() => openLocationPicker('addresses')}
                  disabled={normalizing || backfillingRegions}
                  class="px-3 py-1.5 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
                >
                  Fix Addresses
                </button>
                <button
                  onclick={() => openLocationPicker('images')}
                  disabled={regenerating || renderingDng || detectingLivePhotos}
                  class="px-3 py-1.5 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
                >
                  Fix Images
                </button>
                <button
                  onclick={() => openLocationPicker('videos')}
                  disabled={fixingVideos || detectingLivePhotos}
                  class="px-3 py-1.5 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
                >
                  Fix Videos
                </button>
              </div>
            </div>
            {/if}
          </div>

          <!-- Integrity Sub-Accordion (BagIt RFC 8493) -->
          <div>
            <button
              onclick={() => integrityExpanded = !integrityExpanded}
              class="w-full flex items-center justify-between py-2 border-b border-braun-100 text-left hover:bg-braun-50 transition-colors"
            >
              <span class="text-sm font-medium text-braun-700">Integrity</span>
              <svg
                class="w-4 h-4 text-braun-900 transition-transform duration-200 {integrityExpanded ? 'rotate-180' : ''}"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {#if integrityExpanded}
            <div class="py-3">
              <!-- Summary Stats -->
              {#if bagSummary}
                <div class="bg-braun-50 rounded p-3 mb-3">
                  <div class="flex flex-wrap gap-4 text-sm">
                    <div class="flex items-center gap-1">
                      <span class="w-2 h-2 rounded-full bg-success"></span>
                      <span class="text-braun-500">Valid:</span>
                      <span class="font-medium">{bagSummary.valid}</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <span class="w-2 h-2 rounded-full bg-warning"></span>
                      <span class="text-braun-500">Incomplete:</span>
                      <span class="font-medium">{bagSummary.incomplete}</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <span class="w-2 h-2 rounded-full bg-error"></span>
                      <span class="text-braun-500">Invalid:</span>
                      <span class="font-medium">{bagSummary.invalid}</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <span class="w-2 h-2 rounded-full bg-braun-400"></span>
                      <span class="text-braun-500">None:</span>
                      <span class="font-medium">{bagSummary.none}</span>
                    </div>
                  </div>
                  {#if lastValidation}
                    <p class="text-xs text-braun-500 mt-2">
                      Last validated: {new Date(lastValidation).toLocaleString()}
                    </p>
                  {/if}
                </div>
              {/if}

              <!-- Progress bar during validation -->
              {#if validationProgress}
                <div class="mb-3">
                  <div class="h-2 bg-braun-200 rounded-full overflow-hidden">
                    <div
                      class="h-full bg-braun-900 transition-all duration-300"
                      style="width: {(validationProgress.current / validationProgress.total) * 100}%"
                    ></div>
                  </div>
                </div>
              {/if}

              <!-- Actions -->
              <div class="flex flex-wrap gap-2">
                <button
                  onclick={validateAllBags}
                  disabled={validatingAllBags}
                  class="px-3 py-1.5 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
                >
                  {validatingAllBags ? 'Validating...' : 'Verify All Locations'}
                </button>
              </div>

              {#if bagValidationMessage}
                <p class="text-sm text-braun-600 mt-2">{bagValidationMessage}</p>
              {/if}

              <p class="text-xs text-braun-400 mt-3">
                Self-documenting archive per BagIt RFC 8493. Weekly automatic validation.
              </p>
            </div>
            {/if}
          </div>

          <!-- OPT-113: Web Sources Sub-Accordion -->
          <div>
            <button
              onclick={() => webSourcesExpanded = !webSourcesExpanded}
              class="w-full flex items-center justify-between py-2 border-b border-braun-100 text-left hover:bg-braun-50 transition-colors"
            >
              <span class="text-sm font-medium text-braun-700">Web Sources</span>
              <svg
                class="w-4 h-4 text-braun-900 transition-transform duration-200 {webSourcesExpanded ? 'rotate-180' : ''}"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {#if webSourcesExpanded}
            <div class="py-3">
              <!-- Pending count -->
              <div class="bg-braun-50 rounded p-3 mb-3">
                <div class="flex items-center justify-between">
                  <div>
                    <span class="text-sm text-braun-600">Pending archives:</span>
                    <span class="ml-2 font-medium text-braun-900">{pendingWebSourceCount}</span>
                  </div>
                  {#if pendingWebSourceCount === 0}
                    <span class="text-xs text-success">All archived</span>
                  {/if}
                </div>
              </div>

              <!-- Actions -->
              <div class="flex flex-wrap gap-2">
                <button
                  onclick={archiveAllPendingWebSources}
                  disabled={archivingWebSources || pendingWebSourceCount === 0}
                  class="px-3 py-1.5 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
                >
                  {#if archivingWebSources}
                    Queueing...
                  {:else}
                    Archive All ({pendingWebSourceCount})
                  {/if}
                </button>
              </div>

              {#if webSourceArchiveMessage}
                <p class="text-sm text-braun-600 mt-2">{webSourceArchiveMessage}</p>
              {/if}

              <p class="text-xs text-braun-400 mt-3">
                Web sources are automatically archived when saved. Use this to archive any pending sources.
              </p>
            </div>
            {/if}
          </div>

          <!-- Storage Section (at bottom) - OPT-047: Enhanced with detailed breakdown -->
          <div class="py-3 mt-2">
            <span class="text-sm font-medium text-braun-700 mb-2 block">Storage</span>
            {#if storageStats}
              {@const archivePercent = (storageStats.archiveBytes / storageStats.totalBytes) * 100}
              {@const otherUsedBytes = storageStats.totalBytes - storageStats.availableBytes - storageStats.archiveBytes}
              {@const otherUsedPercent = Math.max(0, (otherUsedBytes / storageStats.totalBytes) * 100)}

              <!-- Detailed breakdown -->
              <div class="text-xs text-braun-600 mb-2 space-y-0.5">
                <div class="flex justify-between">
                  <span>Media files:</span>
                  <span class="font-medium">{formatBytes(storageStats.mediaBytes || 0)}</span>
                </div>
                {#if (storageStats.thumbnailBytes || 0) > 0 || (storageStats.previewBytes || 0) > 0 || (storageStats.proxyBytes || 0) > 0}
                  <div class="flex justify-between text-braun-400">
                    <span>Thumbnails:</span>
                    <span>{formatBytes(storageStats.thumbnailBytes || 0)}</span>
                  </div>
                  <div class="flex justify-between text-braun-400">
                    <span>Previews:</span>
                    <span>{formatBytes(storageStats.previewBytes || 0)}</span>
                  </div>
                  <div class="flex justify-between text-braun-400">
                    <span>Video proxies:</span>
                    <span>{formatBytes(storageStats.proxyBytes || 0)}</span>
                  </div>
                {/if}
                <div class="flex justify-between border-t border-braun-200 pt-1 mt-1">
                  <span class="font-medium">Total archive:</span>
                  <span class="font-medium">{formatBytes(storageStats.archiveBytes)}</span>
                </div>
                <div class="flex justify-between">
                  <span>Disk available:</span>
                  <span>{formatBytes(storageStats.availableBytes)}</span>
                </div>
              </div>

              <!-- Storage bar -->
              <div class="h-4 bg-braun-200 rounded-full overflow-hidden flex">
                <div class="bg-braun-900" style="width: {archivePercent}%"></div>
                <div class="bg-braun-400" style="width: {otherUsedPercent}%"></div>
              </div>

              <!-- Unmeasured warning and verify button -->
              {#if (storageStats.unmeasuredCount || 0) > 0}
                <p class="text-xs text-warning mt-2">
                  {storageStats.unmeasuredCount} files not yet measured
                </p>
              {/if}

              <!-- Verify progress -->
              {#if verifyingStorage && verifyProgress}
                <div class="mt-2">
                  <p class="text-xs text-braun-500">Verifying: {verifyProgress.currentFile}</p>
                  <p class="text-xs text-braun-400">{verifyProgress.processed} files processed</p>
                </div>
              {/if}

              <!-- Verify result -->
              {#if verifyResult}
                <div class="mt-2 p-2 bg-braun-100 rounded text-xs">
                  {#if verifyResult.newMeasurements > 0}
                    <p class="text-success">Measured {verifyResult.newMeasurements} files</p>
                  {/if}
                  {#if verifyResult.sizeMismatches > 0}
                    <p class="text-warning">Found {verifyResult.sizeMismatches} size mismatches</p>
                  {/if}
                  {#if verifyResult.missingFiles > 0}
                    <p class="text-error">Found {verifyResult.missingFiles} missing files</p>
                  {/if}
                  {#if verifyResult.newMeasurements === 0 && verifyResult.sizeMismatches === 0 && verifyResult.missingFiles === 0}
                    <p class="text-success">All files verified</p>
                  {/if}
                </div>
              {/if}

              <!-- Verify button and last verified -->
              <div class="flex items-center justify-between mt-2">
                <button
                  onclick={verifyStorageIntegrity}
                  disabled={verifyingStorage}
                  class="text-xs text-braun-900 hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {verifyingStorage ? 'Verifying...' : (storageStats.unmeasuredCount || 0) > 0 ? 'Measure All Files' : 'Verify Integrity'}
                </button>
                <span class="text-xs text-braun-400">
                  Last verified: {formatTimeAgo(storageStats.lastVerifiedAt)}
                </span>
              </div>
            {:else if loadingStorage}
              <div class="h-4 bg-braun-200 rounded-full"></div>
              <p class="text-xs text-braun-400 mt-1">Loading storage info...</p>
            {:else}
              <p class="text-xs text-braun-400">Storage info unavailable</p>
            {/if}
          </div>
        </div>
        {/if}
      </div>

      <!-- Data Engine Accordion (consolidated from Date Engine, Image Auto-Tagging, AI & Cloud Providers) -->
      <div class="bg-white rounded border border-braun-300 mb-6 overflow-hidden">
        <button
          onclick={() => dataEngineExpanded = !dataEngineExpanded}
          class="w-full flex items-center justify-between text-left transition-colors hover:bg-braun-50 {dataEngineExpanded ? 'p-6' : 'px-6 py-4'}"
        >
          <h2 class="text-lg font-semibold text-foreground">Data Engine</h2>
          <svg
            class="w-5 h-5 text-braun-900 transition-transform duration-200 {dataEngineExpanded ? 'rotate-180' : ''}"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {#if dataEngineExpanded}
        <div class="px-6 pb-6">
          <DataEngineSettings />
        </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- Import Preview Modal - Premium Archive Experience -->
{#if showImportPreview && importPreview}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div class="bg-white rounded border border-braun-300 max-w-md w-full mx-4 max-h-[80vh] flex flex-col">
      <!-- Header -->
      <div class="px-5 pt-5 pb-3">
        <h2 class="text-base font-semibold text-foreground">Import Reference Map</h2>
      </div>

      <!-- Content -->
      <div class="px-5 pb-5 overflow-y-auto flex-1 space-y-4">

        <!-- Matches Found (enrichment opportunities) -->
        {#if importPreview.enrichmentCount > 0}
          <div class="bg-[#FFFFFF] border border-braun-100 rounded p-4">
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-medium text-foreground">Matches Found</span>
              <button
                onclick={selectAllEnrichments}
                class="text-xs text-braun-900 hover:underline"
              >
                check all
              </button>
            </div>
            <div class="space-y-2 max-h-40 overflow-y-auto">
              {#each importPreview.enrichmentOpportunities as match}
                {@const isSelected = selectedEnrichments.has(match.existingId)}
                {@const similarity = match.nameSimilarity ?? 0}
                <div class="flex items-center gap-2 text-sm">
                  <span class="px-2 py-0.5 rounded text-xs font-medium {getSimilarityPillClass(similarity)}">
                    {similarity}%
                  </span>
                  <span class="flex-1 truncate text-braun-700 text-xs">
                    {match.newPointName} — {match.existingName}
                  </span>
                  <button
                    onclick={() => toggleEnrichment(match)}
                    class="w-4 h-4 rounded border-2 flex items-center justify-center transition flex-shrink-0 {isSelected ? 'bg-braun-900 border-braun-900' : 'border-braun-300 hover:border-braun-900'}"
                  >
                    {#if isSelected}
                      <svg class="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                      </svg>
                    {/if}
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- New Locations Found -->
        {#if importPreview.newPoints > 0}
          <div class="bg-[#FFFFFF] border border-braun-100 rounded p-4">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-foreground">New Locations</span>
              <span class="text-sm text-braun-600">{importPreview.newPoints}</span>
            </div>
          </div>
        {/if}

        <!-- Duplicates -->
        {#if importPreview.cataloguedCount > 0 || importPreview.referenceCount > 0}
          <div class="bg-[#FFFFFF] border border-braun-100 rounded p-4">
            <span class="text-sm font-medium text-foreground block mb-2">Duplicates</span>
            <div class="space-y-1">
              {#if importPreview.cataloguedCount > 0}
                <div class="flex items-center justify-between text-sm">
                  <span class="text-braun-600">Already Catalogued</span>
                  <span class="text-braun-600">{importPreview.cataloguedCount}</span>
                </div>
              {/if}
              {#if importPreview.referenceCount > 0}
                <div class="flex items-center justify-between text-sm">
                  <span class="text-braun-600">Reference Matches</span>
                  <span class="text-braun-600">{importPreview.referenceCount}</span>
                </div>
              {/if}
            </div>
          </div>
        {/if}

      </div>

      <!-- Footer -->
      <div class="px-5 pb-5 pt-2 flex justify-end gap-3">
        <button
          onclick={cancelImportPreview}
          class="px-4 py-2 text-sm text-braun-900 border border-braun-400 rounded hover:bg-braun-100 transition"
        >
          Cancel
        </button>
        <button
          onclick={confirmImport}
          disabled={importingRefMap}
          class="px-4 py-2 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
        >
          {#if importingRefMap}
            Importing...
          {:else}
            Import
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Location Picker Modal -->
{#if showLocationPicker && pickerMode}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div class="bg-white rounded border border-braun-300 max-w-md w-full mx-4">
      <!-- Header -->
      <div class="p-4 border-b flex items-center justify-between">
        <h2 class="text-lg font-semibold text-foreground">{getPickerTitle()}</h2>
        <button
          onclick={closeLocationPicker}
          class="p-1 text-braun-400 hover:text-braun-600 rounded"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="p-4">
        <!-- Search Input -->
        <div class="relative">
          <input
            type="text"
            bind:value={pickerSearchQuery}
            oninput={handlePickerSearch}
            placeholder="Search location..."
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          />
          {#if pickerSelectedLocation}
            <button
              onclick={clearPickerLocation}
              class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-braun-400 hover:text-braun-600"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          {/if}
        </div>

        <!-- Search Results Dropdown -->
        {#if pickerSearchResults.length > 0 && !pickerSelectedLocation}
          <div class="mt-2 border border-braun-200 rounded max-h-48 overflow-y-auto">
            {#each pickerSearchResults as loc}
              <button
                onclick={() => selectPickerLocation(loc)}
                class="w-full px-3 py-2 text-left hover:bg-braun-50 text-sm flex items-center justify-between border-b border-braun-100 last:border-b-0"
              >
                <span class="font-medium text-foreground truncate">{loc.locnam}</span>
                {#if loc.state}
                  <span class="text-braun-500 ml-2">{loc.state}</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}

        <!-- Selected Location Display -->
        {#if pickerSelectedLocation}
          <div class="mt-2 bg-braun-100 border border-braun-300 rounded px-3 py-2 flex items-center justify-between">
            <span class="text-sm font-medium text-foreground">{pickerSelectedLocation.locnam}</span>
            {#if pickerSelectedLocation.state}
              <span class="text-sm text-braun-500">{pickerSelectedLocation.state}</span>
            {/if}
          </div>
        {/if}

        <!-- Message -->
        {#if pickerMessage}
          <p class="mt-3 text-sm {pickerMessage.includes('Error') || pickerMessage.includes('failed') ? 'text-error' : 'text-success'}">
            {pickerMessage}
          </p>
        {/if}
      </div>

      <!-- Footer -->
      <div class="p-4 border-t bg-braun-50 rounded-b flex justify-end">
        <button
          onclick={runPickerAction}
          disabled={pickerLoading}
          class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
        >
          {pickerLoading ? 'Processing...' : getPickerButtonText()}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- PIN Verification Modal -->
{#if showPinModal}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div class="bg-white rounded border border-braun-300 max-w-sm w-full mx-4">
      <!-- Header -->
      <div class="p-4 border-b flex items-center justify-between">
        <h2 class="text-lg font-semibold text-foreground">Enter PIN</h2>
        <button
          onclick={closePinModal}
          class="p-1 text-braun-400 hover:text-braun-600 rounded"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="p-4">
        <p class="text-sm text-braun-600 mb-4">
          {#if pinAction === 'archive'}
            Enter your PIN to change the archive location.
          {:else if pinAction === 'deleteOnImport'}
            Enter your PIN to change the delete on import setting.
          {:else if pinAction === 'startupPin'}
            Enter your PIN to change the startup PIN requirement.
          {/if}
        </p>
        <input
          type="password"
          bind:value={pinInput}
          placeholder="Enter 4-6 digit PIN"
          maxlength="6"
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 text-center text-xl tracking-widest"
          onkeydown={(e) => e.key === 'Enter' && verifyAndExecutePinAction()}
        />
        {#if pinError}
          <p class="text-sm text-error mt-2">{pinError}</p>
        {/if}
      </div>

      <!-- Footer -->
      <div class="p-4 border-t bg-braun-50 rounded-b flex justify-end gap-2">
        <button
          onclick={closePinModal}
          class="px-4 py-2 bg-braun-100 text-braun-700 rounded hover:bg-braun-200 transition"
        >
          Cancel
        </button>
        <button
          onclick={verifyAndExecutePinAction}
          disabled={pinVerifying || pinInput.length < 4}
          class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
        >
          {pinVerifying ? 'Verifying...' : 'Confirm'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Restore from Backup Modal -->
{#if showRestoreModal}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div class="bg-white rounded border border-braun-300 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
      <!-- Header -->
      <div class="p-4 border-b">
        <h2 class="text-lg font-semibold text-foreground">Restore from Backup</h2>
        <p class="text-sm text-braun-500 mt-1">Select a backup to restore</p>
      </div>

      <!-- Content -->
      <div class="p-4 flex-1 overflow-y-auto">
        {#if internalBackups.length > 0}
          <div class="space-y-2">
            {#each internalBackups as backup}
              <button
                onclick={() => restoreFromBackup(backup.id)}
                disabled={restoring}
                class="w-full text-left p-3 border rounded hover:border-braun-400 hover:bg-braun-50 transition disabled:opacity-50"
              >
                <div class="flex justify-between items-center">
                  <span class="font-medium text-foreground">{backup.date}</span>
                  <span class="text-sm text-braun-500">{backup.size}</span>
                </div>
              </button>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-braun-500 text-center py-8">No internal backups available</p>
        {/if}
      </div>

      <!-- Footer -->
      <div class="p-4 border-t bg-braun-50 rounded-b flex justify-end">
        <button
          onclick={() => showRestoreModal = false}
          class="px-4 py-2 bg-braun-100 text-braun-700 rounded hover:bg-braun-200 transition"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}
