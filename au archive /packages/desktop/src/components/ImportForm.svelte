<script lang="ts">
  import { onMount } from 'svelte';
  import { type Location, LocationEntity } from '@au-archive/core';
  import AutocompleteInput from './AutocompleteInput.svelte';
  import { STATE_ABBREVIATIONS, getStateCodeFromName } from '../../electron/services/us-state-codes';
  import { getCategoryForClass } from '../lib/type-hierarchy';
  import { importProgress as storeImportProgress, isImporting as storeIsImporting, importStore } from '../stores/import-store';

  interface Props {
    locations: Location[];
    selectedLocation: string;
    isImporting: boolean;
    isDragging: boolean;
    onLocationChange: (locid: string) => void;
    onBrowse: () => void;
    onDragOver: (event: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (event: DragEvent) => void;
    onLocationCreated?: (location: Location) => void;
    // Navigate to location detail page (for "Add Media" button)
    onNavigateToLocation?: (locid: string) => void;
    // DECISION-013: Auto-fill author from Settings
    defaultAuthor?: string;
  }

  let {
    locations,
    selectedLocation,
    isImporting,
    isDragging,
    onLocationChange,
    onBrowse,
    onDragOver,
    onDragLeave,
    onDrop,
    onLocationCreated,
    onNavigateToLocation,
    // DECISION-013: Auto-fill author from Settings
    defaultAuthor = '',
  }: Props = $props();

  // Documentation level options per spec
  const DOCUMENTATION_OPTIONS = [
    'Interior + Exterior',
    'Exterior Only',
    'Perimeter Only',
    'Drive-By',
    'No Visit / Keyboard Scout',
    'Drone Only',
  ];

  // P0: Access options - consolidated from condition/status per v010steps.md
  const ACCESS_OPTIONS = [
    'Abandoned',
    'Demolished',
    'Active',
    'Partially Active',
    'Future Classic',
    'Vacant',
    'Unknown',
  ];

  // P0: STATUS_OPTIONS and CONDITION_OPTIONS removed - use ACCESS_OPTIONS only

  // New location form state - COMPREHENSIVE
  let showNewLocationForm = $state(false);
  let creatingLocation = $state(false);
  let createError = $state('');

  // Location Details
  let newLocName = $state('');
  let newAkaName = $state('');
  let newShortName = $state('');

  // Sub-location
  let isSubLocation = $state(false);
  let parentLocId = $state('');
  let isPrimarySubLocation = $state(false);

  // Classification
  let newCategory = $state('');
  let newClass = $state('');

  // Auto-fill category when user enters a known class
  $effect(() => {
    if (newClass && !newCategory) {
      const matchedCategory = getCategoryForClass(newClass);
      if (matchedCategory) {
        newCategory = matchedCategory;
      }
    }
  });

  // Documentation Status
  let newDocumentation = $state('');
  let newAccess = $state('');
  // P0: newCondition and newStatus removed - use newAccess only
  let newHistoric = $state(false);

  // Address
  let newStreet = $state('');
  let newCity = $state('');
  let newState = $state('');
  let newCounty = $state('');
  let newZipcode = $state('');

  // Author - DECISION-013: Auto-fill from Settings
  let newAuthor = $state(defaultAuthor);

  // Users for author dropdown
  let users = $state<Array<{user_id: string, username: string, display_name: string | null}>>([]);

  // Load users on mount
  onMount(async () => {
    if (window.electronAPI?.users) {
      users = await window.electronAPI.users.findAll();
    }
  });

  // Autocomplete suggestions derived from existing locations
  function getCategorySuggestions(): string[] {
    const categories = new Set<string>();
    locations.forEach(loc => {
      if (loc.category) categories.add(loc.category);
    });
    return Array.from(categories).sort();
  }

  function getClassSuggestions(): string[] {
    const classes = new Set<string>();
    locations.forEach(loc => {
      if (loc.class) classes.add(loc.class);
    });
    return Array.from(classes).sort();
  }

  function getCitySuggestions(): string[] {
    const cities = new Set<string>();
    locations.forEach(loc => {
      if (loc.address?.city) cities.add(loc.address.city);
    });
    return Array.from(cities).sort();
  }

  function getCountySuggestions(): string[] {
    const counties = new Set<string>();
    locations.forEach(loc => {
      if (loc.address?.county) counties.add(loc.address.county);
    });
    return Array.from(counties).sort();
  }

  function getStateSuggestions(): string[] {
    // Get states from existing locations
    const existingStates = new Set<string>();
    locations.forEach(loc => {
      if (loc.address?.state) {
        const code = loc.address.state.toUpperCase();
        // Find full name for this code
        const fullName = Object.entries(STATE_ABBREVIATIONS).find(([_, abbr]) => abbr === code)?.[0];
        if (fullName) {
          // Title case the full name
          const titleCased = fullName.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
          existingStates.add(`${code} (${titleCased})`);
        } else {
          existingStates.add(code);
        }
      }
    });

    // Add all US states in format "NY (New York)"
    const allStates = Object.entries(STATE_ABBREVIATIONS).map(([name, code]) => {
      const titleCased = name.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      return `${code} (${titleCased})`;
    });

    // Merge and deduplicate
    const merged = new Set([...existingStates, ...allStates]);
    return Array.from(merged).sort();
  }

  // Filter out sub-locations for parent selection
  function getParentLocationOptions(): Location[] {
    return locations.filter(loc => !loc.sub12);
  }

  function generateShortName(name: string): string {
    return LocationEntity.generateShortName(name);
  }

  // Auto-generate short name when location name changes
  function handleLocNameChange() {
    if (newLocName && !newShortName) {
      newShortName = generateShortName(newLocName);
    }
  }

  // Normalize state input - accepts full name or code
  function handleStateChange(value: string) {
    if (!value) {
      newState = '';
      return;
    }

    // Extract just the code if format is "NY (New York)"
    const codeMatch = value.match(/^([A-Z]{2})\s*\(/);
    if (codeMatch) {
      newState = codeMatch[1];
      return;
    }

    // Try to convert full name to code
    const code = getStateCodeFromName(value);
    if (code) {
      newState = code;
      return;
    }

    // Otherwise store as-is (will be uppercased by CSS)
    newState = value.toUpperCase().substring(0, 2);
  }

  function validateForm(): boolean {
    if (!newLocName.trim()) {
      createError = 'Location name is required';
      return false;
    }
    if (!newState.trim()) {
      createError = 'State is required (2-letter abbreviation)';
      return false;
    }
    if (newState.length !== 2) {
      createError = 'State must be 2-letter postal abbreviation (e.g., NY, CA)';
      return false;
    }
    if (isSubLocation && !parentLocId) {
      createError = 'Please select a parent location for this sub-location';
      return false;
    }
    return true;
  }

  function buildLocationData(): Record<string, unknown> {
    return {
      locnam: newLocName.trim(),
      slocnam: newShortName.trim() || undefined,
      akanam: newAkaName.trim() || undefined,
      category: newCategory.trim() || undefined,
      class: newClass.trim() || undefined,
      documentation: newDocumentation || undefined,
      access: newAccess || undefined,
      historic: newHistoric,
      auth_imp: newAuthor.trim() || undefined,
      address: {
        street: newStreet.trim() || undefined,
        city: newCity.trim() || undefined,
        county: newCounty.trim() || undefined,
        state: newState.trim().toUpperCase(),
        zipcode: newZipcode.trim() || undefined,
      },
    };
  }

  async function handleCreateLocation() {
    if (!validateForm()) return;

    try {
      creatingLocation = true;
      createError = '';

      const newLocation = await window.electronAPI.locations.create(buildLocationData());
      onLocationChange(newLocation.locid);
      onLocationCreated?.(newLocation);
      resetForm();
    } catch (error) {
      console.error('Error creating location:', error);
      createError = error instanceof Error ? error.message : 'Failed to create location';
    } finally {
      creatingLocation = false;
    }
  }

  async function handleCreateAndAddMedia() {
    if (!validateForm()) return;

    try {
      creatingLocation = true;
      createError = '';

      const newLocation = await window.electronAPI.locations.create(buildLocationData());
      onLocationCreated?.(newLocation);
      resetForm();
      onNavigateToLocation?.(newLocation.locid);
    } catch (error) {
      console.error('Error creating location:', error);
      createError = error instanceof Error ? error.message : 'Failed to create location';
    } finally {
      creatingLocation = false;
    }
  }

  function resetForm() {
    showNewLocationForm = false;
    newLocName = '';
    newAkaName = '';
    newShortName = '';
    isSubLocation = false;
    parentLocId = '';
    isPrimarySubLocation = false;
    newCategory = '';
    newClass = '';
    newDocumentation = '';
    newAccess = '';
    // P0: newCondition and newStatus removed
    newHistoric = false;
    newStreet = '';
    newCity = '';
    newState = '';
    newCounty = '';
    newZipcode = '';
    // DECISION-013: Reset to default author from Settings
    newAuthor = defaultAuthor;
    createError = '';
  }

  function cancelNewLocation() {
    resetForm();
  }
</script>

<div class="max-w-4xl">
  <!-- Location Selector -->
  <div class="bg-white rounded border border-braun-300 p-6 mb-6">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-lg font-semibold text-braun-900">Import Location</h2>
        <p class="text-sm text-braun-500">Select an existing location or create a new one</p>
      </div>
      <button
        type="button"
        onclick={() => (showNewLocationForm = !showNewLocationForm)}
        disabled={isImporting}
        class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50 text-sm font-medium"
        title="Add new location"
      >
        {showNewLocationForm ? 'Back to Select' : '+ Create New Location'}
      </button>
    </div>

    {#if !showNewLocationForm}
      <!-- Existing Location Selector -->
      <div class="space-y-4">
        <div>
          <label for="location-select" class="block text-sm font-medium text-braun-700 mb-2">
            Select Location <span class="text-error">*</span>
          </label>
          <select
            id="location-select"
            value={selectedLocation}
            onchange={(e) => onLocationChange((e.target as HTMLSelectElement).value)}
            disabled={isImporting}
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 disabled:opacity-50"
          >
            <option value="">Choose a location...</option>
            {#each locations as location}
              <option value={location.locid}>
                {location.locnam}
                {location.address?.city ? `, ${location.address.city}` : ''}
                {location.address?.state ? ` (${location.address.state})` : ''}
                {location.category ? ` - ${location.category}` : ''}
              </option>
            {/each}
          </select>
        </div>

        {#if locations.length === 0}
          <div class="p-4 bg-braun-100 border border-braun-300 rounded">
            <p class="text-sm text-braun-700">
              <strong>No locations found.</strong> Click "Create New Location" to add your first location before importing.
            </p>
          </div>
        {/if}
      </div>
    {:else}
      <!-- COMPREHENSIVE New Location Form -->
      <div class="space-y-6 border-t pt-6">
        {#if createError}
          <div class="p-3 bg-braun-100 text-error rounded text-sm border border-braun-300">
            {createError}
          </div>
        {/if}

        <!-- Section: Location Details -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-braun-900 uppercase tracking-wide border-b border-braun-200 pb-2">
            Location Details
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="md:col-span-2">
              <label for="new-loc-name" class="block text-sm font-medium text-braun-700 mb-1">
                Name <span class="text-error">*</span>
              </label>
              <input
                id="new-loc-name"
                type="text"
                bind:value={newLocName}
                oninput={handleLocNameChange}
                placeholder="e.g., Hudson River State Hospital, Bethlehem Steel"
                disabled={creatingLocation}
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 disabled:opacity-50"
              />
            </div>

            <div>
              <label for="new-aka-name" class="block text-sm font-medium text-braun-700 mb-1">
                Also Known As (AKA)
              </label>
              <input
                id="new-aka-name"
                type="text"
                bind:value={newAkaName}
                placeholder="Alternative name, local name..."
                disabled={creatingLocation}
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 disabled:opacity-50"
              />
            </div>

            <div>
              <label for="new-short-name" class="block text-sm font-medium text-braun-700 mb-1">
                Short Name (12 chars max)
              </label>
              <input
                id="new-short-name"
                type="text"
                bind:value={newShortName}
                maxlength="12"
                placeholder="Auto-generated"
                disabled={creatingLocation}
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 disabled:opacity-50 font-mono"
              />
              <p class="text-xs text-braun-500 mt-1">Used for folder names and file prefixes</p>
            </div>
          </div>
        </div>

        <!-- Section: Sub-Location -->
        <div class="space-y-4">
          <div class="flex items-center">
            <input
              type="checkbox"
              id="is-sublocation"
              bind:checked={isSubLocation}
              disabled={creatingLocation}
              class="mr-2"
            />
            <label for="is-sublocation" class="text-sm font-medium text-braun-700">
              This is a sub-location (building within a complex, wing of a hospital, etc.)
            </label>
          </div>

          {#if isSubLocation}
            <div class="ml-6 p-4 bg-braun-50 border border-braun-200 rounded space-y-4">
              <div>
                <label for="parent-location" class="block text-sm font-medium text-braun-700 mb-1">
                  Parent Location <span class="text-error">*</span>
                </label>
                <select
                  id="parent-location"
                  bind:value={parentLocId}
                  disabled={creatingLocation}
                  class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 disabled:opacity-50"
                >
                  <option value="">Select parent location...</option>
                  {#each getParentLocationOptions() as loc}
                    <option value={loc.locid}>
                      {loc.locnam} {loc.address?.state ? `(${loc.address.state})` : ''}
                    </option>
                  {/each}
                </select>
              </div>

              <div class="flex items-center">
                <input
                  type="checkbox"
                  id="primary-sublocation"
                  bind:checked={isPrimarySubLocation}
                  disabled={creatingLocation}
                  class="mr-2"
                />
                <label for="primary-sublocation" class="text-sm text-braun-700">
                  Primary sub-location (main building/area)
                </label>
              </div>
            </div>
          {/if}
        </div>

        <!-- Section: Classification -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-braun-900 uppercase tracking-wide border-b border-braun-200 pb-2">
            Classification
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label for="new-category" class="block text-sm font-medium text-braun-700 mb-1">
                Category
              </label>
              <AutocompleteInput
                bind:value={newCategory}
                onchange={(val) => newCategory = val}
                suggestions={getCategorySuggestions()}
                id="new-category"
                placeholder="Hospital, Factory, School, Church..."
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              />
            </div>

            <div>
              <label for="new-class" class="block text-sm font-medium text-braun-700 mb-1">
                Class
              </label>
              <AutocompleteInput
                bind:value={newClass}
                onchange={(val) => newClass = val}
                suggestions={getClassSuggestions()}
                id="new-class"
                placeholder="Psychiatric, Textile Mill, Sanatorium..."
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              />
            </div>
          </div>
        </div>

        <!-- Section: Documentation Status -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-braun-900 uppercase tracking-wide border-b border-braun-200 pb-2">
            Documentation Status
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label for="new-documentation" class="block text-sm font-medium text-braun-700 mb-1">
                Documentation Level
              </label>
              <select
                id="new-documentation"
                bind:value={newDocumentation}
                disabled={creatingLocation}
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 disabled:opacity-50"
              >
                <option value="">Select...</option>
                {#each DOCUMENTATION_OPTIONS as opt}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            </div>

            <div>
              <label for="new-access" class="block text-sm font-medium text-braun-700 mb-1">
                Access Status
              </label>
              <select
                id="new-access"
                bind:value={newAccess}
                disabled={creatingLocation}
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 disabled:opacity-50"
              >
                <option value="">Select...</option>
                {#each ACCESS_OPTIONS as opt}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            </div>

            <!-- P0: Condition and Status fields removed - use Access Status only -->
          </div>

          <div class="flex items-center">
            <input
              type="checkbox"
              id="new-historic"
              bind:checked={newHistoric}
              disabled={creatingLocation}
              class="mr-2"
            />
            <label for="new-historic" class="text-sm text-braun-700">
              Historic Landmark / National Register
            </label>
          </div>
        </div>

        <!-- Section: Address -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-braun-900 uppercase tracking-wide border-b border-braun-200 pb-2">
            Address
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="md:col-span-2">
              <label for="new-street" class="block text-sm font-medium text-braun-700 mb-1">
                Street Address
              </label>
              <input
                id="new-street"
                type="text"
                bind:value={newStreet}
                placeholder="123 Main Street"
                disabled={creatingLocation}
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 disabled:opacity-50"
              />
            </div>

            <div>
              <label for="new-city" class="block text-sm font-medium text-braun-700 mb-1">
                City
              </label>
              <AutocompleteInput
                bind:value={newCity}
                onchange={(val) => newCity = val}
                suggestions={getCitySuggestions()}
                id="new-city"
                placeholder="City name"
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              />
            </div>

            <div>
              <label for="new-state" class="block text-sm font-medium text-braun-700 mb-1">
                State <span class="text-error">*</span>
              </label>
              <AutocompleteInput
                bind:value={newState}
                onchange={handleStateChange}
                suggestions={getStateSuggestions()}
                id="new-state"
                placeholder="NY or New York"
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 uppercase"
              />
              <p class="text-xs text-braun-500 mt-1">Type 2-letter code or full state name</p>
            </div>

            <div>
              <label for="new-county" class="block text-sm font-medium text-braun-700 mb-1">
                County
              </label>
              <AutocompleteInput
                bind:value={newCounty}
                onchange={(val) => newCounty = val}
                suggestions={getCountySuggestions()}
                id="new-county"
                placeholder="County name"
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              />
            </div>

            <div>
              <label for="new-zipcode" class="block text-sm font-medium text-braun-700 mb-1">
                Zipcode
              </label>
              <input
                id="new-zipcode"
                type="text"
                bind:value={newZipcode}
                placeholder="12345"
                maxlength="10"
                disabled={creatingLocation}
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        <!-- DECISION-013: GPS section removed - GPS comes only from EXIF data on imported media -->

        <!-- Section: Author -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-braun-900 uppercase tracking-wide border-b border-braun-200 pb-2">
            Attribution
          </h3>

          <div>
            <label for="new-author" class="block text-sm font-medium text-braun-700 mb-1">
              Documented By
            </label>
            <select
              id="new-author"
              bind:value={newAuthor}
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
            >
              {#each users as user}
                <option value={user.username}>
                  {user.display_name || user.username}
                </option>
              {/each}
            </select>
            <p class="text-xs text-braun-500 mt-1">Who documented/photographed this location</p>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-3 pt-4 border-t border-braun-200">
          <button
            type="button"
            onclick={handleCreateLocation}
            disabled={creatingLocation || !newLocName.trim() || !newState.trim()}
            class="px-6 py-3 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50 font-medium"
          >
            {creatingLocation ? 'Creating...' : 'Create'}
          </button>
          <button
            type="button"
            onclick={handleCreateAndAddMedia}
            disabled={creatingLocation || !newLocName.trim() || !newState.trim()}
            class="px-6 py-3 bg-braun-700 text-white rounded hover:bg-braun-500 transition disabled:opacity-50 font-medium"
          >
            {creatingLocation ? 'Creating...' : 'Add Media'}
          </button>
          <button
            type="button"
            onclick={cancelNewLocation}
            disabled={creatingLocation}
            class="px-6 py-3 bg-braun-200 text-braun-700 rounded hover:bg-braun-300 transition disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}
  </div>

  {#if !showNewLocationForm}
    <!-- Browse Button -->
    <button
      onclick={onBrowse}
      disabled={!selectedLocation || isImporting}
      class="w-full mb-4 px-4 py-3 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
    >
      {isImporting ? 'Importing...' : 'Browse Files to Import'}
    </button>

    <!-- Drag & Drop Zone -->
    <div
      class="border-2 border-dashed rounded p-12 text-center transition cursor-pointer {isDragging ? 'border-braun-900 bg-braun-50' : 'border-braun-300'} {!selectedLocation || isImporting ? 'opacity-50 cursor-not-allowed' : 'hover:border-braun-900'}"
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      ondrop={onDrop}
      onclick={!selectedLocation || isImporting ? undefined : onBrowse}
      role="button"
      tabindex="0"
    >
      <div class="text-braun-400">
        <svg class="mx-auto h-12 w-12 mb-4" stroke="currentColor" fill="none" viewBox="0 0 48 48">
          <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <p class="text-lg mb-2 text-braun-600">Drag and drop files here</p>
        <p class="text-sm text-braun-500">or click to browse</p>
        <p class="text-xs mt-4 text-braun-400">Supported: Images (JPG, PNG, TIFF, RAW), Videos (MP4, MOV, AVI), Documents (PDF, TXT)</p>
      </div>
    </div>

    <!-- OPT-104: Minimal progress display with pulsing dot -->
    {#if $storeIsImporting && $storeImportProgress}
      <div class="mt-4 p-4 bg-braun-50 border border-braun-200 rounded">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium text-braun-700">Importing</span>
          <button
            onclick={() => importStore.cancelImport()}
            class="text-xs text-braun-500 hover:text-braun-700"
          >
            Cancel
          </button>
        </div>
        <div class="relative h-6 bg-braun-200 rounded overflow-hidden">
          <div
            class="absolute inset-y-0 left-0 bg-braun-900 transition-[width] duration-150 ease-out"
            style="width: {$storeImportProgress.percent}%"
          ></div>
          <div class="absolute inset-0 flex items-center justify-center">
            <span class="text-xs font-medium text-white mix-blend-difference">
              processing <span class="animate-pulse-dot">{$storeImportProgress.current}/{$storeImportProgress.total} · {$storeImportProgress.percent}%</span>
            </span>
          </div>
        </div>
      </div>
    {/if}
  {/if}
</div>
