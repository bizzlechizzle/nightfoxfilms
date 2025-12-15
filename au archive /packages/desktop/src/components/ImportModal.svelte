<script lang="ts">
  /**
   * ImportModal.svelte
   * Simplified location creation popup
   * Fields: Name, State, Host Location checkbox
   * Author auto-filled from current user
   */
  import { onMount } from 'svelte';
  import type { Location } from '@au-archive/core';
  import { importModal, closeImportModal } from '../stores/import-modal-store';
  import { router } from '../stores/router';
  import { toasts } from '../stores/toast-store';
  import AutocompleteInput from './AutocompleteInput.svelte';
  import ImportIntelligence from './ImportIntelligence.svelte';
  import DuplicateWarningPanel from './DuplicateWarningPanel.svelte';
  import { STATE_ABBREVIATIONS, getStateCodeFromName } from '../../electron/services/us-state-codes';
  import { DUPLICATE_CONFIG } from '../lib/constants';

  // Form state - simplified to essential fields only
  let name = $state('');
  let selectedState = $state('');

  // Host location flag (campus with multiple buildings)
  let isHostLocation = $state(false);

  // P2: Database-driven lists
  let allLocations = $state<Location[]>([]);

  // Current user for auto-attribution
  let currentUser = $state('');

  // UI state
  let saving = $state(false);
  let error = $state('');

  // Import Intelligence state
  let showIntelligence = $state(false);
  let intelligenceDismissed = $state(false);

  // Phase 2: Reference map matching
  interface RefMapMatch {
    pointId: string;
    mapId: string;
    name: string;
    description: string | null;
    lat: number;
    lng: number;
    state: string | null;
    category: string | null;
    mapName: string;
    score: number;
  }
  let refMapMatches = $state<RefMapMatch[]>([]);
  let matchesLoading = $state(false);
  let matchesDismissed = $state(false);
  let matchSearchTimeout: ReturnType<typeof setTimeout> | null = null;

  // Migration 38: Duplicate detection state (historicalName removed)
  // ADR: ADR-pin-conversion-duplicate-prevention.md
  interface DuplicateMatch {
    locationId: string;
    locnam: string;
    akanam: string | null;
    state: string | null;
    matchType: 'gps' | 'name';
    distanceMeters?: number;
    nameSimilarity?: number;
    matchedField?: 'locnam' | 'akanam';
    mediaCount: number;
  }
  let duplicateMatch = $state<DuplicateMatch | null>(null);
  let duplicateProcessing = $state(false);
  let duplicateDismissed = $state(false);
  let duplicateCheckTimeout: ReturnType<typeof setTimeout> | null = null;
  // Track ref point ID when creating from a reference map point
  let creatingFromRefPointId = $state<string | null>(null);

  // Generate state suggestions (all US states formatted)
  function getStateSuggestions(): string[] {
    const existingStates = new Set<string>();
    allLocations.forEach(loc => {
      if (loc.address?.state) {
        const code = loc.address.state.toUpperCase();
        const fullName = Object.entries(STATE_ABBREVIATIONS).find(([_, abbr]) => abbr === code)?.[0];
        if (fullName) {
          const titleCased = fullName.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
          existingStates.add(`${code} (${titleCased})`);
        } else {
          existingStates.add(code);
        }
      }
    });

    const allStates = Object.entries(STATE_ABBREVIATIONS).map(([name, code]) => {
      const titleCased = name.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      return `${code} (${titleCased})`;
    });

    const merged = new Set([...existingStates, ...allStates]);
    return Array.from(merged).sort();
  }

  // Normalize state input - accepts full name or code
  function handleStateChange(value: string) {
    if (!value) {
      selectedState = '';
      return;
    }

    // Extract just the code if format is "NY (New York)"
    const codeMatch = value.match(/^([A-Z]{2})\s*\(/);
    if (codeMatch) {
      selectedState = codeMatch[1];
      return;
    }

    // Try to convert full name to code
    const code = getStateCodeFromName(value);
    if (code) {
      selectedState = code;
      return;
    }

    // Otherwise store as-is (will be uppercased)
    selectedState = value.toUpperCase().substring(0, 2);
  }

  // Load locations and current user from database/settings
  async function loadOptions() {
    try {
      const locations = await window.electronAPI.locations.findAll();
      allLocations = locations;

      // Get current user for auto-attribution
      if (window.electronAPI?.settings) {
        const settings = await window.electronAPI.settings.getAll();
        if (settings.current_user) {
          currentUser = settings.current_user;
        }
      }
    } catch (err) {
      console.error('Error loading options:', err);
    }
  }

  // Handle pre-filled data from store
  $effect(() => {
    if ($importModal.prefilledData) {
      if ($importModal.prefilledData.name) {
        name = $importModal.prefilledData.name;
      }
      if ($importModal.prefilledData.state) {
        selectedState = $importModal.prefilledData.state;
      }
      // Migration 38: Track ref point ID for deletion after location creation
      if ($importModal.prefilledData.refPointId) {
        creatingFromRefPointId = $importModal.prefilledData.refPointId;
      }
    }
  });

  // Re-load settings when modal opens (to restore author after resetForm)
  $effect(() => {
    if ($importModal.isOpen) {
      loadOptions();
      // Show intelligence panel if GPS is prefilled and not dismissed
      if ($importModal.prefilledData?.gps_lat && $importModal.prefilledData?.gps_lng && !intelligenceDismissed) {
        showIntelligence = true;
      }
    }
  });

  // Debounced reference map matching
  // Searches for matches when name OR state changes (300ms debounce)
  $effect(() => {
    // Read reactive values to ensure effect re-runs
    const currentName = name.trim();
    const currentState = selectedState;

    // Don't search if:
    // - GPS already provided (from map click)
    // - User dismissed suggestions
    // - Name too short
    // - State not selected (require state for better matches)
    const hasGps = $importModal.prefilledData?.gps_lat && $importModal.prefilledData?.gps_lng;
    if (hasGps || matchesDismissed || currentName.length < 3 || currentState.length !== 2) {
      refMapMatches = [];
      return;
    }

    // Clear previous timeout
    if (matchSearchTimeout) {
      clearTimeout(matchSearchTimeout);
    }

    // Debounce the search
    matchSearchTimeout = setTimeout(async () => {
      if (!window.electronAPI?.refMaps?.findMatches) return;

      try {
        matchesLoading = true;
        const matches = await window.electronAPI.refMaps.findMatches(currentName, {
          threshold: DUPLICATE_CONFIG.NAME_SIMILARITY_THRESHOLD,
          limit: 3,
          state: currentState,
        });
        refMapMatches = matches;
      } catch (err) {
        console.error('Error finding ref map matches:', err);
        refMapMatches = [];
      } finally {
        matchesLoading = false;
      }
    }, 300);
  });

  // Migration 38: Debounced duplicate check when name or GPS changes
  // Checks for existing locations with similar name OR nearby GPS
  $effect(() => {
    // Skip if user already dismissed the warning
    if (duplicateDismissed) return;

    // Need at least a name to check
    const trimmedName = name.trim();
    if (trimmedName.length < 3) {
      duplicateMatch = null;
      return;
    }

    // Clear previous timeout
    if (duplicateCheckTimeout) {
      clearTimeout(duplicateCheckTimeout);
    }

    // Get GPS if available
    const gpsLat = $importModal.prefilledData?.gps_lat ?? null;
    const gpsLng = $importModal.prefilledData?.gps_lng ?? null;

    // Debounce the check (300ms)
    duplicateCheckTimeout = setTimeout(async () => {
      if (!window.electronAPI?.locations?.checkDuplicateByNameAndGps) return;

      try {
        const result = await window.electronAPI.locations.checkDuplicateByNameAndGps({
          name: trimmedName,
          lat: gpsLat,
          lng: gpsLng,
        });

        if (result.hasDuplicate && result.match) {
          duplicateMatch = result.match;
        } else {
          duplicateMatch = null;
        }
      } catch (err) {
        console.error('[ImportModal] Duplicate check failed:', err);
        duplicateMatch = null;
      }
    }, 300);
  });

  // Apply GPS from a matched reference point
  function applyMatchGps(match: RefMapMatch) {
    // Update the prefilled data in the store to include GPS with proper source attribution
    importModal.update(current => ({
      ...current,
      prefilledData: {
        ...current.prefilledData,
        gps_lat: match.lat,
        gps_lng: match.lng,
        gps_source: 'ref_map_point', // Track that GPS came from reference map, not user verification
      },
    }));
    // Clear matches after applying
    refMapMatches = [];
    // User already chose from RefMapMatches - skip ImportIntelligence panel
    intelligenceDismissed = true;
    showIntelligence = false;
    toasts.success(`GPS applied from "${match.name}"`);
  }

  // Dismiss match suggestions
  function dismissMatches() {
    matchesDismissed = true;
    refMapMatches = [];
  }

  // Migration 38: Handle "This is the same place" - navigate to existing location
  async function handleDuplicateSamePlace(locationId: string, locationName: string) {
    duplicateProcessing = true;
    try {
      closeImportModal();
      resetForm();
      toasts.success(`Navigating to "${locationName}"`);
      router.navigate(`/location/${locationId}`);
    } finally {
      duplicateProcessing = false;
    }
  }

  // Migration 38: Handle "Different place" - add exclusion and allow creation
  async function handleDuplicateDifferentPlace(matchName: string) {
    duplicateProcessing = true;
    try {
      // Add exclusion so we don't ask again for this pair
      if (window.electronAPI?.locations?.addExclusion) {
        await window.electronAPI.locations.addExclusion(name.trim(), matchName);
      }
      // Clear the warning and allow creation
      duplicateDismissed = true;
      duplicateMatch = null;
      toasts.success('Got it! You can proceed with creating this location.');
    } catch (err) {
      console.error('[ImportModal] Failed to add exclusion:', err);
      toasts.error('Failed to save preference');
    } finally {
      duplicateProcessing = false;
    }
  }

  function validateForm(): boolean {
    if (!name.trim()) {
      error = 'Location name is required';
      return false;
    }
    if (!selectedState) {
      error = 'State is required';
      return false;
    }
    if (selectedState.length !== 2) {
      error = 'State must be 2-letter postal abbreviation (e.g., NY, CA)';
      return false;
    }
    return true;
  }

  function buildLocationData(): Record<string, unknown> {
    const data: Record<string, unknown> = {
      locnam: name.trim(),
      // Auto-use signed-in user for attribution
      auth_imp: currentUser || undefined,
      // OPT-062: Pass host-only flag to create a location expecting sub-locations
      isHostOnly: isHostLocation,
      address: {
        state: selectedState.toUpperCase(),
      },
    };

    // Include GPS if pre-filled (from map right-click or ref map match)
    // Use explicit null check to handle coordinates at 0 (equator/prime meridian)
    if ($importModal.prefilledData?.gps_lat !== null && $importModal.prefilledData?.gps_lat !== undefined &&
        $importModal.prefilledData?.gps_lng !== null && $importModal.prefilledData?.gps_lng !== undefined) {
      // Use tracked GPS source, defaulting to user_map_click for backward compatibility
      const gpsSource = $importModal.prefilledData.gps_source || 'user_map_click';
      data.gps = {
        lat: $importModal.prefilledData.gps_lat,
        lng: $importModal.prefilledData.gps_lng,
        source: gpsSource,
        // Only mark as verified on map if user actually confirmed via map click
        // GPS from ref_map_point or other sources should NOT be marked as verified
        verifiedOnMap: gpsSource === 'user_map_click',
      };
    }

    return data;
  }

  async function handleCreate() {
    if (!validateForm()) return;

    try {
      saving = true;
      error = '';

      // Create the location
      const newLocation = await window.electronAPI.locations.create(buildLocationData());

      // Migration 38: Delete the ref point if we created from one
      // ADR: ADR-pin-conversion-duplicate-prevention.md - original map file preserved
      if (creatingFromRefPointId && window.electronAPI?.refMaps?.deletePoint) {
        try {
          await window.electronAPI.refMaps.deletePoint(creatingFromRefPointId);
        } catch (delErr) {
          // Non-fatal - location was created successfully
        }
      }

      closeImportModal();
      const successMsg = isHostLocation
        ? 'Host location created - add buildings from the location page'
        : 'Location created';
      toasts.success(successMsg);

      if (newLocation?.locid) {
        router.navigate(`/location/${newLocation.locid}?autoImport=true`);
      }

      resetForm();
    } catch (err) {
      console.error('Error creating location:', err);
      error = 'Failed to create location. Please try again.';
    } finally {
      saving = false;
    }
  }

  function resetForm() {
    name = '';
    selectedState = '';
    isHostLocation = false;
    error = '';
    // Phase 2: Reset match state
    refMapMatches = [];
    matchesDismissed = false;
    if (matchSearchTimeout) {
      clearTimeout(matchSearchTimeout);
      matchSearchTimeout = null;
    }
    // Reset intelligence state
    showIntelligence = false;
    intelligenceDismissed = false;
    // Migration 38: Reset duplicate detection state
    duplicateMatch = null;
    duplicateDismissed = false;
    duplicateProcessing = false;
    creatingFromRefPointId = null;
    if (duplicateCheckTimeout) {
      clearTimeout(duplicateCheckTimeout);
      duplicateCheckTimeout = null;
    }
  }

  function handleCancel() {
    resetForm();
    closeImportModal();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      handleCancel();
    }
  }

  // Import Intelligence handlers
  function handleIntelligenceSelectLocation(locid: string, locName: string) {
    // User selected an existing location - navigate to it for import
    closeImportModal();
    resetForm();
    toasts.success(`Selected "${locName}" - add media from location page`);
    router.navigate(`/location/${locid}?autoImport=true`);
  }

  function handleIntelligenceSelectSubLocation(subid: string, locid: string, subName: string) {
    closeImportModal();
    resetForm();
    toasts.success(`Selected "${subName}" - add media from building page`);
    router.navigate(`/location/${locid}/sub/${subid}?autoImport=true`);
  }

  function handleIntelligenceCreateFromRefPoint(pointId: string, pointName: string, lat: number, lng: number) {
    // Apply the ref point data and show create form
    name = pointName;
    // Migration 38: Track the ref point ID for deletion after location creation
    creatingFromRefPointId = pointId;
    importModal.update(current => ({
      ...current,
      prefilledData: {
        ...current.prefilledData,
        gps_lat: lat,
        gps_lng: lng,
        gps_source: 'ref_map_point', // Track that GPS came from reference map
        name: pointName,
      },
    }));
    showIntelligence = false;
    intelligenceDismissed = true;
    toasts.success(`GPS applied from reference point`);
  }

  function handleIntelligenceCreateNew() {
    // User explicitly wants to create new location
    showIntelligence = false;
    intelligenceDismissed = true;
  }

  onMount(() => {
    loadOptions();
  });
</script>

<svelte:window on:keydown={handleKeydown} />

{#if $importModal.isOpen}
  <!-- Backdrop (DECISION-013: z-[99999] ensures modal appears above maps) -->
  <div
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999]"
    onclick={handleCancel}
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
  >
    <!-- Modal - clean single-column layout -->
    <div
      class="bg-braun-50 rounded border border-braun-300 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto relative z-[100000]"
      onclick={(e) => e.stopPropagation()}
    >
      <!-- Content with integrated close button -->
      <div class="p-6 space-y-4">
        <!-- Close button row -->
        <div class="flex justify-end -mt-2 -mr-2">
          <button
            onclick={handleCancel}
            class="text-braun-400 hover:text-braun-600 transition p-1 rounded hover:bg-braun-200"
            aria-label="Close"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <!-- Import Intelligence Panel - shown when GPS is prefilled -->
        {#if showIntelligence && $importModal.prefilledData?.gps_lat && $importModal.prefilledData?.gps_lng}
          <ImportIntelligence
            lat={$importModal.prefilledData.gps_lat}
            lng={$importModal.prefilledData.gps_lng}
            hints={{
              filename: undefined,
              inferredType: undefined,
              inferredState: selectedState || undefined,
            }}
            proposedName={name || $importModal.prefilledData?.name || undefined}
            excludeRefPointId={creatingFromRefPointId}
            onSelectLocation={handleIntelligenceSelectLocation}
            onSelectSubLocation={handleIntelligenceSelectSubLocation}
            onCreateFromRefPoint={handleIntelligenceCreateFromRefPoint}
            onCreateNew={handleIntelligenceCreateNew}
          />
        {/if}

        <!-- Migration 38: Duplicate Warning Panel - shown when similar location detected -->
        {#if duplicateMatch && !duplicateDismissed && (!showIntelligence || intelligenceDismissed)}
          <DuplicateWarningPanel
            proposedName={name.trim()}
            match={duplicateMatch}
            onSamePlace={handleDuplicateSamePlace}
            onDifferentPlace={handleDuplicateDifferentPlace}
            processing={duplicateProcessing}
            proposedLat={$importModal.prefilledData?.gps_lat}
            proposedLng={$importModal.prefilledData?.gps_lng}
          />
        {/if}

        <!-- Show form only when intelligence is dismissed or no GPS -->
        {#if !showIntelligence || intelligenceDismissed || !$importModal.prefilledData?.gps_lat}
        {#if error}
          <div class="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm flex items-center gap-2">
            <svg class="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            {error}
          </div>
        {/if}

        <!-- Location Name -->
        <div>
          <label for="loc-name" class="block text-sm font-medium text-braun-700 mb-1.5">
            Location Name
          </label>
          <input
            id="loc-name"
            type="text"
            bind:value={name}
            disabled={saving}
            placeholder=""
            class="w-full px-3 py-2.5 border border-braun-300 rounded bg-white focus:outline-none focus:border-braun-600 focus:border-transparent disabled:opacity-50 transition"
          />
        </div>

        <!-- Reference Map Match Suggestions -->
        {#if refMapMatches.length > 0 && !matchesDismissed}
          <div class="bg-braun-100 border border-braun-300 rounded p-3">
            <div class="flex items-start gap-2">
              <svg class="w-5 h-5 text-braun-900 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-braun-900">
                  {refMapMatches.length === 1 ? 'Possible match found' : `${refMapMatches.length} possible matches found`}
                </p>
                <div class="mt-2 space-y-2">
                  {#each refMapMatches as match}
                    <div class="flex items-center justify-between bg-white rounded px-3 py-2 border border-braun-200">
                      <div class="min-w-0 flex-1">
                        <p class="text-sm font-medium text-braun-900 truncate">{match.name}</p>
                        <p class="text-xs text-braun-600">{Math.round(match.score * 100)}% match</p>
                      </div>
                      <button
                        onclick={() => applyMatchGps(match)}
                        class="ml-3 px-3 py-1.5 bg-braun-900 text-white text-xs font-medium rounded hover:bg-braun-600 transition flex-shrink-0"
                      >
                        Apply GPS
                      </button>
                    </div>
                  {/each}
                </div>
                <button
                  onclick={dismissMatches}
                  class="mt-2 text-xs text-braun-900 hover:opacity-80 transition"
                >
                  Dismiss suggestions
                </button>
              </div>
            </div>
          </div>
        {:else if matchesLoading}
          <div class="text-xs text-braun-400 flex items-center gap-1">
            <div class="w-3 h-3 border border-braun-400 rounded flex items-center justify-center">
              <div class="w-1.5 h-1.5 bg-braun-400 rounded"></div>
            </div>
            Checking reference maps...
          </div>
        {/if}

        <!-- State (required) -->
        <div>
          <label for="loc-state" class="block text-sm font-medium text-braun-700 mb-1.5">
            State
          </label>
          <AutocompleteInput
            value={selectedState}
            onchange={handleStateChange}
            suggestions={getStateSuggestions()}
            id="loc-state"
            placeholder="New York or NY"
            class="w-full px-3 py-2.5 border border-braun-300 rounded bg-white focus:outline-none focus:border-braun-600 focus:border-transparent disabled:opacity-50 transition"
          />
        </div>

        <!-- Campus checkbox -->
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            bind:checked={isHostLocation}
            disabled={saving}
            class="h-4 w-4 rounded border-braun-300 text-braun-900 focus:border-braun-600 cursor-pointer"
          />
          <span class="text-sm text-braun-700">Campus with multiple buildings</span>
        </label>

        <!-- GPS Pre-fill indicator -->
        {#if $importModal.prefilledData?.gps_lat && $importModal.prefilledData?.gps_lng}
          <div class="p-3 bg-braun-100 border border-braun-300 rounded flex items-center gap-2">
            <svg class="w-4 h-4 text-braun-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <p class="text-sm text-braun-700">
              GPS: {$importModal.prefilledData.gps_lat.toFixed(6)}, {$importModal.prefilledData.gps_lng.toFixed(6)}
            </p>
          </div>
        {/if}
        {/if}
        <!-- End form conditional -->
      </div>

      <!-- Footer - hide when showing intelligence -->
      {#if !showIntelligence || intelligenceDismissed || !$importModal.prefilledData?.gps_lat}
      <div class="px-6 pb-6 bg-braun-50 flex justify-end items-center">
        <div class="flex gap-3">
          <button
            onclick={handleCancel}
            disabled={saving}
            class="px-3 py-1.5 text-sm text-braun-700 bg-white border border-braun-300 rounded hover:bg-braun-50 transition disabled:opacity-50 font-medium"
          >
            Cancel
          </button>
          <button
            onclick={handleCreate}
            disabled={saving}
            class="px-3 py-1.5 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50 font-medium"
          >
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
      {/if}
    </div>
  </div>
{/if}
