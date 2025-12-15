<script lang="ts">
  /**
   * LocationInfo - Information box with structured fields
   * Per DECISION-019: Complete overhaul to mirror LocationMapSection styling
   * Display order: AKA, Status+Type, Built/Abandoned, Documentation, Flags, Historical Name, Author
   */
  import type { Location, LocationInput } from '@au-archive/core';
  import { ACCESS_OPTIONS } from '../../constants/location-enums';
  import { onMount } from 'svelte';
  import { router } from '../../stores/router';

  // Author from location_authors table
  interface LocationAuthor {
    user_id: string;
    username: string;
    display_name: string | null;
    role: 'creator' | 'documenter' | 'contributor';
    added_at: string;
  }

  // Media types for author extraction
  interface MediaWithAuthor {
    auth_imp?: string | null;
    imported_by?: string | null;
    is_contributed?: number;
    contribution_source?: string | null;
  }

  // Sub-location type for building list
  interface SubLocationSummary {
    subid: string;
    locid: string;
    subnam: string;
    is_primary?: boolean;
  }

  // Migration 32: SubLocation type for edit mode
  // Migration 65: Added class for sub-location class
  interface SubLocationData {
    subid: string;
    subnam: string;
    ssubname: string | null;
    category: string | null;
    class: string | null;
    status: string | null;
    is_primary: boolean;
    akanam: string | null;
  }

  // Migration 32: SubLocation update input (historicalName removed)
  // Migration 65: Added class for sub-location class
  interface SubLocationUpdates {
    subnam?: string;
    ssubname?: string | null;
    category?: string | null;
    class?: string | null;
    status?: string | null;
    is_primary?: boolean;
    akanam?: string | null;
  }

  interface Props {
    location: Location;
    images?: MediaWithAuthor[];
    videos?: MediaWithAuthor[];
    documents?: MediaWithAuthor[];
    // Issue 3: All media for author extraction (includes sub-location media on host view)
    allImagesForAuthors?: MediaWithAuthor[];
    allVideosForAuthors?: MediaWithAuthor[];
    allDocumentsForAuthors?: MediaWithAuthor[];
    onNavigateFilter: (type: string, value: string) => void;
    onSave?: (updates: Partial<LocationInput>) => Promise<void>;
    // Host/Sub-location support
    sublocations?: SubLocationSummary[];
    isHostLocation?: boolean;
    onConvertToHost?: () => Promise<void>;
    // Migration 32: Sub-location edit mode
    currentSubLocation?: SubLocationData | null;
    onSubLocationSave?: (subUpdates: SubLocationUpdates, locUpdates: Partial<LocationInput>) => Promise<void>;
    // Hero image props (moved from Index Card)
    heroThumbPath?: string | null;
    heroFocalX?: number;
    heroFocalY?: number;
    onHeroClick?: () => void;
  }

  let {
    location, images = [], videos = [], documents = [], onNavigateFilter, onSave,
    allImagesForAuthors, allVideosForAuthors, allDocumentsForAuthors,
    sublocations = [], isHostLocation = false, onConvertToHost,
    currentSubLocation = null, onSubLocationSave,
    heroThumbPath = null, heroFocalX = 0.5, heroFocalY = 0.5, onHeroClick
  }: Props = $props();

  // Migration 32: Sub-location edit mode detection
  const isSubLocationMode = $derived(!!currentSubLocation && !!onSubLocationSave);

  // Edit modal state
  let showEditModal = $state(false);
  let saving = $state(false);

  // Convert to Host modal state (PIN protected)
  let showConvertModal = $state(false);
  let convertPin = $state('');
  let convertError = $state('');
  let converting = $state(false);

  // Autocomplete options for Category/Class
  let categoryOptions = $state<string[]>([]);
  let classOptions = $state<string[]>([]);

  // Authors from location_authors table
  let authors = $state<LocationAuthor[]>([]);

  // Load autocomplete options and authors on mount
  // Migration 65: Load from sublocation-specific endpoints when in sub-location mode
  onMount(async () => {
    try {
      // Determine which API to use based on mode
      const categoryPromise = isSubLocationMode
        ? window.electronAPI?.sublocations?.getDistinctCategories?.() || []
        : window.electronAPI?.locations?.getDistinctCategories?.() || [];
      const classPromise = isSubLocationMode
        ? window.electronAPI?.sublocations?.getDistinctClasses?.() || []
        : window.electronAPI?.locations?.getDistinctClasses?.() || [];

      const [categories, classes, locationAuthors] = await Promise.all([
        categoryPromise,
        classPromise,
        window.electronAPI?.locationAuthors?.findByLocation?.(location.locid) || [],
      ]);
      categoryOptions = categories;
      classOptions = classes;
      authors = locationAuthors;
    } catch (err) {
      console.error('Error loading category options:', err);
    }
  });

  // Edit form state - DECISION-019: All information fields (historicalName removed)
  // Migration 32: Extended to support sub-location editing
  let editForm = $state({
    // Location/Building name (locnam or subnam depending on mode)
    locnam: '',
    locnamVerified: false,
    akanam: '',
    akanamVerified: false,
    access: '',           // Status (locs.access or slocs.status)
    builtYear: '',
    builtType: 'year' as 'year' | 'range' | 'date',
    abandonedYear: '',
    abandonedType: 'year' as 'year' | 'range' | 'date',
    category: '',         // Category (locs.category or slocs.category for Building Category)
    class: '',            // Class (Migration 65: now supported for both host and sub-locations)
    historic: false,
    favorite: false,
    project: false,
    docInterior: false,
    docExterior: false,
    docDrone: false,
    docWebHistory: false,
    docMapFind: false,
    auth_imp: '',
    // Migration 32: Sub-location specific fields
    is_primary: false,    // Primary Building checkbox (sub-location only)
  });

  // Track original status for change detection
  let originalStatus = $state('');

  // PUEA: Check if we have data to display for each section (historicalName removed)
  const hasAkaName = $derived(!!location.akanam);
  const hasStatus = $derived(!!location.access);
  const hasDocumentation = $derived(
    location.docInterior || location.docExterior || location.docDrone || location.docWebHistory || location.docMapFind
  );
  const hasBuiltOrAbandoned = $derived(!!location.builtYear || !!location.abandonedYear);
  const hasCategory = $derived(!!location.category);
  const hasClass = $derived(!!location.class);
  const hasFlags = $derived(location.historic || location.favorite || location.project);

  // Verification scoring: Information complete when has Category, Class, AND Status
  const isInfoComplete = $derived(hasStatus && hasCategory && hasClass);

  const hasAuthor = $derived(!!location.auth_imp);  // Original author field
  const hasAuthors = $derived(authors.length > 0);  // Tracked contributors from location_authors

  // Host/Sub-location display flags
  const hasSublocations = $derived(isHostLocation && sublocations.length > 0);
  // Migration 32: Hide Convert to Host when viewing/editing a sub-location
  const canConvertToHost = $derived(!isHostLocation && !isSubLocationMode && !!onConvertToHost);

  // Role display labels
  const roleLabels: Record<string, string> = {
    creator: 'Creator',
    documenter: 'Documenter',
    contributor: 'Contributor',
  };

  // Extract unique authors from media (dedup against location_authors)
  // Issue 3: Use all media (including sub-location media) when provided for host view
  const mediaAuthors = $derived(() => {
    const mediaForAuthors: MediaWithAuthor[] = [
      ...(allImagesForAuthors || images),
      ...(allVideosForAuthors || videos),
      ...(allDocumentsForAuthors || documents)
    ];
    const authorSet = new Set<string>();
    const locationAuthorNames = new Set(authors.map(a => a.username).concat(authors.map(a => a.display_name).filter(Boolean) as string[]));

    // Also include location.auth_imp in dedup check
    if (location.auth_imp) locationAuthorNames.add(location.auth_imp);

    for (const m of mediaForAuthors) {
      if (m.auth_imp && !locationAuthorNames.has(m.auth_imp)) {
        authorSet.add(m.auth_imp);
      }
    }
    return Array.from(authorSet);
  });

  // Extract unique external contributors (is_contributed = 1)
  // Issue 3: Use all media (including sub-location media) when provided for host view
  const externalContributors = $derived(() => {
    const mediaForAuthors: MediaWithAuthor[] = [
      ...(allImagesForAuthors || images),
      ...(allVideosForAuthors || videos),
      ...(allDocumentsForAuthors || documents)
    ];
    const sources = new Set<string>();
    for (const m of mediaForAuthors) {
      if (m.is_contributed === 1 && m.contribution_source) {
        sources.add(m.contribution_source);
      }
    }
    return Array.from(sources);
  });

  const hasMediaAuthors = $derived(mediaAuthors().length > 0);
  const hasExternalContributors = $derived(externalContributors().length > 0);

  // Parse AKA names for display (split by comma)
  const displayAkaNames = $derived(
    location.akanam ? location.akanam.split(',').map(s => s.trim()).filter(Boolean) : []
  );

  // Show AKA if we have any alias names (historicalName removed)
  const shouldShowAka = $derived(hasAkaName);

  // Check if we have any info to display at all (historicalName removed)
  const hasAnyInfo = $derived(
    hasAkaName || hasStatus || hasDocumentation ||
    hasBuiltOrAbandoned || hasCategory || hasFlags || hasSublocations
  );

  // Documentation labels for display
  const docLabels = [
    { key: 'docInterior', label: 'Interior', field: 'docInterior' as const },
    { key: 'docExterior', label: 'Exterior', field: 'docExterior' as const },
    { key: 'docDrone', label: 'Drone', field: 'docDrone' as const },
    { key: 'docMapFind', label: 'Map Find', field: 'docMapFind' as const },
    { key: 'docWebHistory', label: 'Web Find', field: 'docWebHistory' as const },
  ];

  // Get active documentation types
  const activeDocTypes = $derived(
    docLabels.filter(d => location[d.field]).map(d => d.label)
  );

  // Parse AKA names for Historical Name dropdown
  const akaNames = $derived(
    editForm.akanam ? editForm.akanam.split(',').map(s => s.trim()).filter(Boolean) : []
  );

  // Format year display based on type
  function formatYearDisplay(value: string | undefined, type: 'year' | 'range' | 'date' | undefined): string {
    if (!value) return '';
    return value; // Return as-is, type determines interpretation
  }

  // Handle Drone checkbox - auto-select Exterior
  function handleDroneChange(checked: boolean) {
    editForm.docDrone = checked;
    if (checked) {
      editForm.docExterior = true;
    }
  }

  // AKA name management
  let newAkaInput = $state('');

  function removeAkaName(nameToRemove: string) {
    const names = akaNames.filter(n => n !== nameToRemove);
    editForm.akanam = names.join(', ');
  }

  function addAkaName() {
    const trimmed = newAkaInput.trim();
    if (trimmed && !akaNames.includes(trimmed)) {
      const names = [...akaNames, trimmed];
      editForm.akanam = names.join(', ');
    }
    newAkaInput = '';
  }

  function handleAkaKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addAkaName();
    }
  }

  function openEditModal() {
    // Migration 32: Initialize form differently for sub-location vs host location
    if (isSubLocationMode && currentSubLocation) {
      // Sub-location mode: load from sub-location data + host location for campus fields
      originalStatus = currentSubLocation.status || '';
      editForm = {
        // Sub-location specific fields
        locnam: currentSubLocation.subnam || '',
        locnamVerified: false, // Not used for sub-locations
        akanam: currentSubLocation.akanam || '',
        akanamVerified: false, // Not used for sub-locations
        access: currentSubLocation.status || '', // slocs.status
        category: currentSubLocation.category || '', // Building Category
        // Migration 65: Sub-location class (now supported)
        class: currentSubLocation.class || '',
        is_primary: currentSubLocation.is_primary || false,
        // Campus-level fields from host location
        builtYear: location.builtYear || '',
        builtType: location.builtType || 'year',
        abandonedYear: location.abandonedYear || '',
        abandonedType: location.abandonedType || 'year',
        historic: location.historic || false,
        favorite: location.favorite || false,
        project: location.project || false,
        docInterior: location.docInterior || false,
        docExterior: location.docExterior || false,
        docDrone: location.docDrone || false,
        docWebHistory: location.docWebHistory || false,
        docMapFind: location.docMapFind || false,
        auth_imp: location.auth_imp || '',
      };
    } else {
      // Host/regular location mode
      originalStatus = location.access || '';
      editForm = {
        locnam: location.locnam || '',
        locnamVerified: location.locnamVerified || false,
        akanam: location.akanam || '',
        akanamVerified: location.akanamVerified || false,
        access: location.access || '',
        builtYear: location.builtYear || '',
        builtType: location.builtType || 'year',
        abandonedYear: location.abandonedYear || '',
        abandonedType: location.abandonedType || 'year',
        category: location.category || '',
        class: location.class || '',
        historic: location.historic || false,
        favorite: location.favorite || false,
        project: location.project || false,
        docInterior: location.docInterior || false,
        docExterior: location.docExterior || false,
        docDrone: location.docDrone || false,
        docWebHistory: location.docWebHistory || false,
        docMapFind: location.docMapFind || false,
        auth_imp: location.auth_imp || '',
        is_primary: false, // Not used for host locations
      };
    }
    newAkaInput = '';
    showEditModal = true;
  }

  async function handleSave() {
    try {
      saving = true;

      // Migration 32: Split save based on sub-location mode
      if (isSubLocationMode && onSubLocationSave) {
        // Sub-location mode: save to subloc and flags to host location
        const subUpdates: SubLocationUpdates = {
          subnam: editForm.locnam,
          category: editForm.category || null, // Building Category
          // Migration 65: Sub-location class (separate from host location class)
          class: editForm.class || null,
          status: editForm.access || null,
          is_primary: editForm.is_primary,
          akanam: editForm.akanam || null,
        };

        // Only flags go to host location (years, documentation, author edited elsewhere)
        const locUpdates: Partial<LocationInput> = {
          historic: editForm.historic,
          favorite: editForm.favorite,
          project: editForm.project,
        };

        await onSubLocationSave(subUpdates, locUpdates);
      } else if (onSave) {
        // Host/regular location mode
        const statusChanged = editForm.access !== originalStatus;
        const statusChangedAt = statusChanged ? new Date().toISOString() : undefined;

        // Save only fields editable in this modal (years, documentation, author edited elsewhere)
        await onSave({
          locnam: editForm.locnam,
          locnamVerified: editForm.locnamVerified,
          akanam: editForm.akanam || undefined,
          akanamVerified: editForm.akanamVerified,
          access: editForm.access || undefined,
          statusChangedAt: statusChangedAt,
          category: editForm.category || undefined,
          class: editForm.class || undefined,
          historic: editForm.historic,
          favorite: editForm.favorite,
          project: editForm.project,
        });
      }
      showEditModal = false;
    } catch (err) {
      console.error('Error saving information:', err);
    } finally {
      saving = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      showEditModal = false;
      showConvertModal = false;
    }
  }

  // Convert to Host Location with PIN verification
  async function handleConvertToHost() {
    if (!onConvertToHost) return;

    convertError = '';
    converting = true;

    try {
      // Verify PIN using the users API
      const users = await window.electronAPI?.users?.findAll?.() || [];
      const currentUser = users[0]; // Get first user (typically the owner)

      if (currentUser) {
        const hasPin = await window.electronAPI?.users?.hasPin?.(currentUser.user_id);
        if (hasPin) {
          const isValid = await window.electronAPI?.users?.verifyPin?.(currentUser.user_id, convertPin);
          if (!isValid) {
            convertError = 'Invalid PIN. Please try again.';
            converting = false;
            return;
          }
        }
      }

      // PIN verified (or no PIN required), proceed with conversion
      await onConvertToHost();
      showConvertModal = false;
      convertPin = '';
    } catch (err) {
      console.error('Error converting to host location:', err);
      convertError = 'Failed to convert. Please try again.';
    } finally {
      converting = false;
    }
  }

  function openConvertModal() {
    convertPin = '';
    convertError = '';
    showConvertModal = true;
  }
</script>

<svelte:window onkeydown={showEditModal ? handleKeydown : undefined} />

<!-- DECISION-019: Information Box styled to match LocationMapSection -->
<div class="bg-white rounded border border-braun-300 flex-1 flex flex-col">
  <!-- Header with edit button -->
  <div class="px-8 pt-6 pb-4 flex items-center justify-between">
    <h2 class="text-2xl font-semibold text-braun-900 leading-none">Information</h2>
    {#if onSave || onSubLocationSave}
      <button
        onclick={openEditModal}
        class="text-sm text-braun-500 hover:text-braun-900 hover:underline"
        title="Edit information"
      >
        edit
      </button>
    {/if}
  </div>

  <!-- Content sections - PUEA: Only show sections that have data -->
  <!-- Display order: AKA, Status+Type, Built/Abandoned, Documentation, Flags, Historical Name, Author -->
  <div class="px-8 pb-6 flex-1">
    {#if hasAnyInfo}
      <!-- AKA Name (show only if exists and not duplicate of Historical Name) -->
      {#if shouldShowAka}
        <div class="mb-4">
          <h3 class="section-title mb-1">Also Known As</h3>
          <div class="flex flex-wrap gap-2">
            {#each displayAkaNames as name}
              <span class="px-2 py-0.5 bg-braun-100 text-braun-900 rounded text-sm">{name}</span>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Status + Type (same row) -->
      {#if hasStatus || hasCategory}
        <div class="mb-4 grid grid-cols-2 gap-4">
          <div>
            <h3 class="section-title mb-1">Status</h3>
            {#if hasStatus}
              <button
                onclick={() => onNavigateFilter('access', location.access!)}
                class="text-base text-braun-900 hover:underline"
                title="View all locations with this status"
              >
                {location.access}
              </button>
            {:else}
              <p class="text-sm text-braun-500 italic">Not set</p>
            {/if}
          </div>
          <div>
            <h3 class="section-title mb-1">Category</h3>
            {#if hasCategory}
              <p class="text-base">
                <button
                  onclick={() => onNavigateFilter('category', location.category!)}
                  class="text-braun-900 hover:underline"
                  title="View all {location.category} locations"
                >
                  {location.category}
                </button>
                {#if location.class}
                  <span class="text-braun-400"> / </span>
                  <button
                    onclick={() => onNavigateFilter('class', location.class!)}
                    class="text-braun-900 hover:underline"
                    title="View all {location.class} locations"
                  >
                    {location.class}
                  </button>
                {/if}
              </p>
            {:else}
              <p class="text-sm text-braun-500 italic">Not set</p>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Built / Abandoned -->
      {#if hasBuiltOrAbandoned}
        <div class="mb-4 grid grid-cols-2 gap-4">
          <div>
            <h3 class="section-title mb-1">Built</h3>
            {#if location.builtYear}
              <span class="px-2 py-0.5 bg-braun-100 text-braun-900 rounded text-sm">{formatYearDisplay(location.builtYear, location.builtType)}</span>
            {:else}
              <p class="text-sm text-braun-500 italic">Not set</p>
            {/if}
          </div>
          <div>
            <h3 class="section-title mb-1">Abandoned</h3>
            {#if location.abandonedYear}
              <span class="px-2 py-0.5 bg-braun-100 text-braun-900 rounded text-sm">{formatYearDisplay(location.abandonedYear, location.abandonedType)}</span>
            {:else}
              <p class="text-sm text-braun-500 italic">Not set</p>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Documentation badges - accent color -->
      {#if hasDocumentation}
        <div class="mb-4">
          <h3 class="section-title mb-1">Documentation</h3>
          <div class="flex flex-wrap gap-2">
            {#each activeDocTypes as docType}
              <span class="px-2 py-0.5 bg-braun-100 text-braun-900 rounded text-sm">
                {docType}
              </span>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Flags - text links (clickable filters) -->
      {#if hasFlags}
        <div class="mb-4">
          <h3 class="section-title mb-1">Flags</h3>
          <div class="flex flex-wrap gap-3">
            {#if location.project}
              <button
                onclick={() => onNavigateFilter('project', 'true')}
                class="text-base text-braun-900 hover:underline"
                title="View all project locations"
              >
                Project
              </button>
            {/if}
            {#if location.favorite}
              <button
                onclick={() => onNavigateFilter('favorite', 'true')}
                class="text-base text-braun-900 hover:underline"
                title="View all favorites"
              >
                Favorite
              </button>
            {/if}
            {#if location.historic}
              <button
                onclick={() => onNavigateFilter('historic', 'true')}
                class="text-base text-braun-900 hover:underline"
                title="View all historic landmarks"
              >
                Historical
              </button>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Historical Name removed -->

    {:else}
      <p class="text-braun-500 text-sm italic">No information added yet</p>
    {/if}
  </div>
</div>

<!-- DECISION-019: Edit Modal -->
{#if showEditModal}
  <div
    class="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50"
    onclick={() => showEditModal = false}
    role="button"
    tabindex="-1"
  >
    <div
      class="bg-white rounded border border-braun-300 w-full max-w-lg max-h-[90vh] overflow-hidden relative z-[100000]"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-braun-200">
        <h2 class="text-lg font-semibold text-braun-900">Edit Information</h2>
        <button
          onclick={() => showEditModal = false}
          class="p-1 text-braun-400 hover:text-braun-600 transition"
          aria-label="Close"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Content - Form order: Location/Building Name, AKA, Historical Name (dropdown), Status (dropdown), Type/Sub-Type (autocomplete), Built/Abandoned, Documentation, Flags, Author -->
      <div class="p-6 overflow-y-auto max-h-[65vh] space-y-5">
        <!-- Location/Building Name -->
        <div>
          <label class="form-label">{isSubLocationMode ? 'Building Name' : 'Location Name'}</label>
          <input
            type="text"
            bind:value={editForm.locnam}
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
            placeholder={isSubLocationMode ? 'Building name' : 'Location name'}
          />
        </div>

        <!-- AKA Name - Pill tag UI -->
        <div>
          <label class="form-label">Also Known As</label>
          <!-- Existing AKA names as pills -->
          {#if akaNames.length > 0}
            <div class="flex flex-wrap gap-2 mb-2">
              {#each akaNames as name}
                <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-braun-100 text-braun-900 rounded text-sm">
                  {name}
                  <button
                    type="button"
                    onclick={() => removeAkaName(name)}
                    class="text-braun-400 hover:text-braun-600 ml-0.5"
                    title="Remove {name}"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              {/each}
            </div>
          {/if}
          <!-- Input to add new AKA name -->
          <input
            type="text"
            bind:value={newAkaInput}
            onkeydown={handleAkaKeydown}
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
            placeholder="Type a name and press Enter"
          />
        </div>

        <!-- Historical Name removed -->

        <!-- Status - dropdown -->
        <div>
          <label class="form-label">Status</label>
          <select
            bind:value={editForm.access}
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          >
            <option value="">Select status...</option>
            {#each ACCESS_OPTIONS as option}
              <option value={option}>{option}</option>
            {/each}
          </select>
        </div>

        <!-- Category / Class with autocomplete (or Building Category for sub-locations) -->
        {#if isSubLocationMode}
          <!-- Sub-location: Building Category only -->
          <div>
            <label class="form-label">Building Category</label>
            <input
              type="text"
              list="category-options"
              bind:value={editForm.category}
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              placeholder="e.g., Administration, Dormitory, Chapel"
            />
            <datalist id="category-options">
              {#each categoryOptions as option}
                <option value={option} />
              {/each}
            </datalist>
          </div>

          <!-- Primary Building checkbox -->
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              bind:checked={editForm.is_primary}
              class="w-4 h-4 text-braun-900 rounded border-braun-300 focus:ring-braun-600"
            />
            <span class="text-sm font-medium text-braun-700">Primary Building</span>
            <span class="text-xs text-braun-500">(main building on campus)</span>
          </label>
        {:else}
          <!-- Host location: Category + Class -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="form-label">Category</label>
              <input
                type="text"
                list="category-options"
                bind:value={editForm.category}
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
                placeholder="e.g., Hospital, Factory"
              />
              <datalist id="category-options">
                {#each categoryOptions as option}
                  <option value={option} />
                {/each}
              </datalist>
            </div>
            <div>
              <label class="form-label">Class</label>
              <input
                type="text"
                list="class-options"
                bind:value={editForm.class}
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
                placeholder="e.g., Psychiatric, Textile"
              />
              <datalist id="class-options">
                {#each classOptions as option}
                  <option value={option} />
                {/each}
              </datalist>
            </div>
          </div>
        {/if}

        <!-- Flags -->
        <div>
          <label class="form-label">Flags</label>
          <div class="flex flex-wrap gap-4">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                bind:checked={editForm.project}
                class="w-4 h-4 text-braun-900 rounded border-braun-300 focus:ring-braun-600"
              />
              <span class="text-sm">Project</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                bind:checked={editForm.favorite}
                class="w-4 h-4 text-braun-900 rounded border-braun-300 focus:ring-braun-600"
              />
              <span class="text-sm">Favorite</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                bind:checked={editForm.historic}
                class="w-4 h-4 text-braun-900 rounded border-braun-300 focus:ring-braun-600"
              />
              <span class="text-sm">Historical</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-braun-200 bg-braun-50">
        {#if canConvertToHost}
          <button
            type="button"
            onclick={openConvertModal}
            class="mr-auto text-sm text-braun-500 hover:text-braun-900 hover:underline"
            title="Enable sub-locations for this location"
          >
            Convert to Host Location
          </button>
        {/if}
        <button
          type="button"
          onclick={() => showEditModal = false}
          class="px-4 py-2 text-sm font-medium text-braun-900 bg-white border border-braun-300 rounded hover:bg-braun-100 transition"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={handleSave}
          disabled={saving}
          class="px-4 py-2 text-sm font-medium text-white bg-braun-900 rounded hover:bg-braun-600 transition disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Convert to Host Location Modal (PIN Protected) -->
{#if showConvertModal}
  <div
    class="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50"
    onclick={() => showConvertModal = false}
    role="button"
    tabindex="-1"
  >
    <div
      class="bg-white rounded border border-braun-300 w-full max-w-sm overflow-hidden relative z-[100000]"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-braun-200">
        <h2 class="text-lg font-semibold text-braun-900">Convert to Host Location</h2>
        <button
          onclick={() => showConvertModal = false}
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
        <p class="text-sm text-braun-600">
          Converting this location to a host location enables you to add buildings (sub-locations) to it.
          This action requires PIN verification.
        </p>

        {#if convertError}
          <div class="p-3 bg-error/10 border border-error/20 rounded text-sm text-error">
            {convertError}
          </div>
        {/if}

        <div>
          <label class="form-label">Enter PIN</label>
          <input
            type="password"
            bind:value={convertPin}
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 text-center text-lg tracking-widest"
            placeholder="****"
            maxlength="6"
            onkeydown={(e) => e.key === 'Enter' && handleConvertToHost()}
          />
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-braun-200 bg-braun-50">
        <button
          type="button"
          onclick={() => showConvertModal = false}
          class="px-4 py-2 text-sm font-medium text-braun-900 bg-white border border-braun-300 rounded hover:bg-braun-100 transition"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={handleConvertToHost}
          disabled={converting}
          class="px-4 py-2 text-sm font-medium text-white bg-braun-900 rounded hover:bg-braun-600 transition disabled:opacity-50"
        >
          {converting ? 'Converting...' : 'Convert'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* DECISION-019: Section titles - Braun design system */
  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #8A8A86; /* braun-500 */
    line-height: 1.25;
  }
</style>
