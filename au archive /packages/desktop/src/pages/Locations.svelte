<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { router } from '../stores/router';
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import type { Location } from '@au-archive/core';
  import SkeletonLoader from '../components/SkeletonLoader.svelte';

  // OPT-036: Locations now loaded with database-side filtering
  let locations = $state<Location[]>([]);
  let totalCount = $state(0);
  let searchQuery = $state('');
  let filterState = $state('');
  let filterCategory = $state('');
  let filterClass = $state('');
  let filterCondition = $state('');
  let filterStatus = $state('');
  let filterCity = $state('');
  let filterCounty = $state('');
  let filterDocumentation = $state('');
  let filterAccess = $state('');
  let filterAuthor = $state('');
  let filterAuthorId = $state('');  // Filter by user_id from location_authors
  let authorLocIds = $state<Set<string>>(new Set());  // Location IDs for the filtered author
  let authorDisplayName = $state('');  // Display name for the filtered author
  // DECISION-012: Census region filters
  let filterCensusRegion = $state('');
  let filterCensusDivision = $state('');
  let filterCulturalRegion = $state('');
  let filterStateDirection = $state('');
  let specialFilter = $state(''); // 'undocumented', 'historical', 'favorites', or ''
  let loading = $state(true);
  let activeFilterCount = $state(0);

  // OPT-036: Filter options loaded via efficient SELECT DISTINCT (not from full location array)
  let filterOptions = $state<{
    states: string[];
    categories: string[];
    classes: string[];
    cities: string[];
    counties: string[];
    censusRegions: string[];
    censusDivisions: string[];
    culturalRegions: string[];
  }>({
    states: [],
    categories: [],
    classes: [],
    cities: [],
    counties: [],
    censusRegions: [],
    censusDivisions: [],
    culturalRegions: [],
  });

  // OPT-036: Debounce timer for search input
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // OPT-038: Virtual scrolling for large location lists
  let scrollContainerRef = $state<HTMLDivElement | null>(null);
  const ROW_HEIGHT = 60; // Fixed row height for virtualization

  // Store the virtualizer instance and its reactive value
  let virtualizerInstance = $state<ReturnType<typeof createVirtualizer> | null>(null);
  let virtualItems = $state<{ index: number; start: number; size: number }[]>([]);
  let totalSize = $state(0);

  // Create and subscribe to virtualizer when dependencies change
  $effect(() => {
    const items = filteredLocations();
    const container = scrollContainerRef;

    // Guard: Don't create virtualizer until scroll container is mounted
    if (!container) {
      virtualItems = [];
      totalSize = 0;
      return;
    }

    const store = createVirtualizer({
      count: items.length,
      getScrollElement: () => container,
      estimateSize: () => ROW_HEIGHT,
      overscan: 5,
    });

    virtualizerInstance = store;

    // Subscribe to store updates
    const unsub = store.subscribe((v) => {
      virtualItems = v.getVirtualItems();
      totalSize = v.getTotalSize();
    });

    return unsub;
  });

  // Subscribe to router for query params
  let routeQuery = $state<Record<string, string>>({});
  const unsubscribe = router.subscribe((route) => {
    const q = route.query || {};
    routeQuery = q;

    // Apply URL query params to filters
    if (q.filter) specialFilter = q.filter;
    if (q.state) filterState = q.state;
    if (q.category) filterCategory = q.category;
    if (q.class) filterClass = q.class;
    if (q.condition) filterCondition = q.condition;
    if (q.status) filterStatus = q.status;
    if (q.city) filterCity = q.city;
    if (q.county) filterCounty = q.county;
    if (q.documentation) filterDocumentation = q.documentation;
    if (q.access) filterAccess = q.access;
    if (q.author) filterAuthor = q.author;
    // Author ID filter (from location_authors table)
    if (q.authorId && q.authorId !== filterAuthorId) {
      filterAuthorId = q.authorId;
      loadAuthorLocations(q.authorId);
    } else if (!q.authorId && filterAuthorId) {
      filterAuthorId = '';
      authorLocIds = new Set();
      authorDisplayName = '';
    }
    // DECISION-012: Census region query params
    if (q.censusRegion) filterCensusRegion = q.censusRegion;
    if (q.censusDivision) filterCensusDivision = q.censusDivision;
    if (q.culturalRegion) filterCulturalRegion = q.culturalRegion;
    if (q.stateDirection) filterStateDirection = q.stateDirection;

    // Count active filters
    activeFilterCount = [
      filterState, filterCategory, filterClass, filterCondition, filterStatus,
      filterCity, filterCounty, filterDocumentation, filterAccess, filterAuthor,
      filterAuthorId, filterCensusRegion, filterCensusDivision, filterCulturalRegion,
      filterStateDirection, specialFilter
    ].filter(Boolean).length;
  });

  // OPT-017: Clean up router subscription on component destroy
  onDestroy(() => {
    unsubscribe();
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  });

  // Load locations for a specific author from location_authors table
  async function loadAuthorLocations(userId: string) {
    try {
      const authorLocs = await window.electronAPI?.locationAuthors?.findByUser?.(userId);
      if (authorLocs && authorLocs.length > 0) {
        authorLocIds = new Set(authorLocs.map((l: { locid: string }) => l.locid));
        // Get author display name from users
        const user = await window.electronAPI?.users?.findById?.(userId);
        authorDisplayName = user?.display_name || user?.username || userId;
      } else {
        authorLocIds = new Set();
        authorDisplayName = '';
      }
    } catch (err) {
      console.error('Error loading author locations:', err);
      authorLocIds = new Set();
    }
  }

  // OPT-036: Database-side filtering - build filter object and query
  async function loadLocationsWithFilters() {
    if (!window.electronAPI?.locations) return;

    loading = true;
    try {
      // Build filter object for database query
      const filters: Record<string, any> = {};

      if (filterState) filters.state = filterState;
      if (filterCategory) filters.category = filterCategory;
      if (filterClass) filters.class = filterClass;
      if (filterCounty) filters.county = filterCounty;
      if (filterAccess) filters.access = filterAccess;
      if (searchQuery) filters.search = searchQuery;

      // OPT-036: Extended filters now handled by database
      if (filterCensusRegion) filters.censusRegion = filterCensusRegion;
      if (filterCensusDivision) filters.censusDivision = filterCensusDivision;
      if (filterCulturalRegion) filters.culturalRegion = filterCulturalRegion;
      if (filterCity) filters.city = filterCity;

      // Special filters
      if (specialFilter === 'undocumented') filters.documented = false;
      if (specialFilter === 'historical') filters.historic = true;
      if (specialFilter === 'favorites') filters.favorite = true;

      const results = await window.electronAPI.locations.findAll(filters);

      // Client-side filters that can't easily be done in SQL
      let filtered = results;

      // Author filter (matches auth_imp field)
      if (filterAuthor) {
        filtered = filtered.filter(loc => loc.auth_imp === filterAuthor);
      }

      // Author ID filter (from location_authors join)
      if (filterAuthorId && authorLocIds.size > 0) {
        filtered = filtered.filter(loc => authorLocIds.has(loc.locid));
      }

      locations = filtered;
      totalCount = filtered.length;
    } catch (error) {
      console.error('Error loading locations:', error);
    } finally {
      loading = false;
    }
  }

  // OPT-036: Debounced search to avoid query on every keystroke
  function handleSearchInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    searchQuery = value;

    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      loadLocationsWithFilters();
    }, 300); // 300ms debounce
  }

  // OPT-036: Immediate filter change (for dropdowns)
  function handleFilterChange() {
    loadLocationsWithFilters();
  }

  // OPT-036: Use derived to just return locations (already filtered by database)
  let filteredLocations = $derived(() => locations);

  // OPT-036: Use memoized filter options instead of computing from locations
  let uniqueStates = $derived(() => filterOptions.states);
  let uniqueCategories = $derived(() => filterOptions.categories);
  let uniqueCensusRegions = $derived(() => filterOptions.censusRegions);
  let uniqueCensusDivisions = $derived(() => filterOptions.censusDivisions);
  let uniqueCulturalRegions = $derived(() => filterOptions.culturalRegions);

  function clearAllFilters() {
    specialFilter = '';
    filterState = '';
    filterCategory = '';
    filterClass = '';
    filterCondition = '';
    filterStatus = '';
    filterCity = '';
    filterCounty = '';
    filterDocumentation = '';
    filterAccess = '';
    filterAuthor = '';
    filterAuthorId = '';
    authorLocIds = new Set();
    authorDisplayName = '';
    // DECISION-012: Census region filters
    filterCensusRegion = '';
    filterCensusDivision = '';
    filterCulturalRegion = '';
    filterStateDirection = '';
    searchQuery = '';
    router.navigate('/locations');
    // OPT-036: Reload with cleared filters
    loadLocationsWithFilters();
  }

  function clearFilter(filterName: string) {
    switch (filterName) {
      case 'filter': specialFilter = ''; break;
      case 'state': filterState = ''; break;
      case 'category': filterCategory = ''; break;
      case 'class': filterClass = ''; break;
      case 'condition': filterCondition = ''; break;
      case 'status': filterStatus = ''; break;
      case 'city': filterCity = ''; break;
      case 'county': filterCounty = ''; break;
      case 'documentation': filterDocumentation = ''; break;
      case 'access': filterAccess = ''; break;
      case 'author': filterAuthor = ''; break;
      case 'authorId': filterAuthorId = ''; authorLocIds = new Set(); authorDisplayName = ''; break;
      // DECISION-012: Census region filters
      case 'censusRegion': filterCensusRegion = ''; break;
      case 'censusDivision': filterCensusDivision = ''; break;
      case 'culturalRegion': filterCulturalRegion = ''; break;
      case 'stateDirection': filterStateDirection = ''; break;
    }
    // Rebuild URL with remaining filters
    const newQuery: Record<string, string> = {};
    if (specialFilter) newQuery.filter = specialFilter;
    if (filterState) newQuery.state = filterState;
    if (filterCategory) newQuery.category = filterCategory;
    if (filterClass) newQuery.class = filterClass;
    if (filterCondition) newQuery.condition = filterCondition;
    if (filterStatus) newQuery.status = filterStatus;
    if (filterCity) newQuery.city = filterCity;
    if (filterCounty) newQuery.county = filterCounty;
    if (filterDocumentation) newQuery.documentation = filterDocumentation;
    if (filterAccess) newQuery.access = filterAccess;
    if (filterAuthor) newQuery.author = filterAuthor;
    if (filterAuthorId) newQuery.authorId = filterAuthorId;
    // DECISION-012: Census region query params
    if (filterCensusRegion) newQuery.censusRegion = filterCensusRegion;
    if (filterCensusDivision) newQuery.censusDivision = filterCensusDivision;
    if (filterCulturalRegion) newQuery.culturalRegion = filterCulturalRegion;
    if (filterStateDirection) newQuery.stateDirection = filterStateDirection;
    router.navigate('/locations', undefined, Object.keys(newQuery).length > 0 ? newQuery : undefined);
    // OPT-036: Reload with updated filters
    loadLocationsWithFilters();
  }

  // Get active filters for display
  let activeFilters = $derived(() => {
    const filters: Array<{ key: string; label: string; value: string }> = [];
    if (specialFilter) filters.push({ key: 'filter', label: 'Filter', value: specialFilter });
    if (filterState) filters.push({ key: 'state', label: 'State', value: filterState });
    if (filterCategory) filters.push({ key: 'category', label: 'Category', value: filterCategory });
    if (filterClass) filters.push({ key: 'class', label: 'Class', value: filterClass });
    if (filterCondition) filters.push({ key: 'condition', label: 'Condition', value: filterCondition });
    if (filterStatus) filters.push({ key: 'status', label: 'Status', value: filterStatus });
    if (filterCity) filters.push({ key: 'city', label: 'City', value: filterCity });
    if (filterCounty) filters.push({ key: 'county', label: 'County', value: filterCounty });
    if (filterDocumentation) filters.push({ key: 'documentation', label: 'Documentation', value: filterDocumentation });
    if (filterAccess) filters.push({ key: 'access', label: 'Access', value: filterAccess });
    if (filterAuthor) filters.push({ key: 'author', label: 'Author', value: filterAuthor });
    if (filterAuthorId) filters.push({ key: 'authorId', label: 'Contributor', value: authorDisplayName || filterAuthorId });
    // DECISION-012: Census region filters
    if (filterCensusRegion) filters.push({ key: 'censusRegion', label: 'Region', value: filterCensusRegion });
    if (filterCensusDivision) filters.push({ key: 'censusDivision', label: 'Division', value: filterCensusDivision });
    if (filterCulturalRegion) filters.push({ key: 'culturalRegion', label: 'Cultural Region', value: filterCulturalRegion });
    if (filterStateDirection) filters.push({ key: 'stateDirection', label: 'Direction', value: filterStateDirection });
    return filters;
  });

  // OPT-036: Load filter options once on mount (efficient SELECT DISTINCT queries)
  async function loadFilterOptions() {
    try {
      if (!window.electronAPI?.locations?.getFilterOptions) {
        console.error('getFilterOptions not available');
        return;
      }
      filterOptions = await window.electronAPI.locations.getFilterOptions();
    } catch (error) {
      console.error('Error loading filter options:', error);
    }
  }

  onMount(() => {
    // OPT-036: Load filter options and initial locations in parallel
    Promise.all([
      loadFilterOptions(),
      loadLocationsWithFilters(),
    ]);
    return () => unsubscribe();
  });
</script>

<div class="p-8">
  <div class="mb-8">
    <h1 class="text-[28px] font-medium text-braun-900 tracking-tight mb-1">Locations</h1>
    <p class="text-sm text-braun-600">Browse and manage abandoned locations</p>
  </div>

  {#if activeFilters().length > 0}
    <div class="mb-4 p-4 bg-braun-100 border border-braun-300 rounded">
      <div class="flex items-center justify-between mb-3">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-braun-600">
          Active Filters ({activeFilters().length})
        </span>
        <button
          onclick={clearAllFilters}
          class="text-xs text-braun-600 hover:text-braun-900 hover:underline font-medium"
        >
          Clear all
        </button>
      </div>
      <div class="flex flex-wrap gap-2">
        {#each activeFilters() as filter}
          <span class="inline-flex items-center gap-1 px-2 py-1 bg-white border border-braun-300 text-braun-900 text-sm rounded-sm">
            <span class="text-braun-500 text-xs">{filter.label}:</span>
            <span class="font-medium">{filter.value}</span>
            <button
              onclick={() => clearFilter(filter.key)}
              class="ml-1 text-braun-400 hover:text-error"
              title="Remove filter"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        {/each}
      </div>
    </div>
  {/if}

  <div class="bg-white border border-braun-300 rounded p-6 mb-6">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div>
        <label for="search" class="form-label">Search</label>
        <input
          id="search"
          type="text"
          value={searchQuery}
          oninput={handleSearchInput}
          placeholder="Search by name..."
          class="w-full px-4 py-3 bg-white border border-braun-400 rounded text-sm text-braun-900 placeholder:text-braun-400 focus:outline-none focus:border-braun-600 transition-colors"
        />
      </div>

      <div>
        <label for="state" class="form-label">State</label>
        <select
          id="state"
          bind:value={filterState}
          onchange={handleFilterChange}
          class="w-full px-4 py-3 bg-white border border-braun-400 rounded text-sm text-braun-900 focus:outline-none focus:border-braun-600 transition-colors"
        >
          <option value="">All States</option>
          {#each uniqueStates() as state}
            <option value={state}>{state}</option>
          {/each}
        </select>
      </div>

      <div>
        <label for="category" class="form-label">Category</label>
        <select
          id="category"
          bind:value={filterCategory}
          onchange={handleFilterChange}
          class="w-full px-4 py-3 bg-white border border-braun-400 rounded text-sm text-braun-900 focus:outline-none focus:border-braun-600 transition-colors"
        >
          <option value="">All Categories</option>
          {#each uniqueCategories() as category}
            <option value={category}>{category}</option>
          {/each}
        </select>
      </div>
    </div>

    <!-- DECISION-012: Census Region Filters -->
    {#if uniqueCensusRegions().length > 0 || uniqueCensusDivisions().length > 0 || uniqueCulturalRegions().length > 0}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-braun-200">
        <div>
          <label for="censusRegion" class="form-label">Census Region</label>
          <select
            id="censusRegion"
            bind:value={filterCensusRegion}
            onchange={handleFilterChange}
            class="w-full px-4 py-3 bg-white border border-braun-400 rounded text-sm text-braun-900 focus:outline-none focus:border-braun-600 transition-colors"
          >
            <option value="">All Regions</option>
            {#each uniqueCensusRegions() as region}
              <option value={region}>{region}</option>
            {/each}
          </select>
        </div>

        <div>
          <label for="censusDivision" class="form-label">Census Division</label>
          <select
            id="censusDivision"
            bind:value={filterCensusDivision}
            onchange={handleFilterChange}
            class="w-full px-4 py-3 bg-white border border-braun-400 rounded text-sm text-braun-900 focus:outline-none focus:border-braun-600 transition-colors"
          >
            <option value="">All Divisions</option>
            {#each uniqueCensusDivisions() as division}
              <option value={division}>{division}</option>
            {/each}
          </select>
        </div>

        <div>
          <label for="culturalRegion" class="form-label">Cultural Region</label>
          <select
            id="culturalRegion"
            bind:value={filterCulturalRegion}
            onchange={handleFilterChange}
            class="w-full px-4 py-3 bg-white border border-braun-400 rounded text-sm text-braun-900 focus:outline-none focus:border-braun-600 transition-colors"
          >
            <option value="">All Cultural Regions</option>
            {#each uniqueCulturalRegions() as region}
              <option value={region}>{region}</option>
            {/each}
          </select>
        </div>
      </div>
    {/if}
  </div>

  {#if loading}
    <!-- OPT-040: Premium skeleton loaders for table -->
    <div class="bg-white border border-braun-300 rounded overflow-hidden">
      <!-- Header skeleton -->
      <div class="grid grid-cols-[1fr_150px_200px_80px] bg-braun-50 border-b border-braun-300">
        <div class="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-braun-500">Name</div>
        <div class="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-braun-500">Category</div>
        <div class="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-braun-500">Location</div>
        <div class="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-braun-500">GPS</div>
      </div>
      <!-- Row skeletons -->
      <SkeletonLoader type="table-row" count={10} />
    </div>
  {:else if filteredLocations().length > 0}
    <!-- OPT-038: Virtual scrolling for performance with 4K+ locations -->
    <div class="bg-white border border-braun-300 rounded overflow-hidden">
      <!-- Fixed header -->
      <div class="grid grid-cols-[1fr_150px_200px_80px] bg-braun-50 border-b border-braun-300">
        <div class="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-braun-500">
          Name
        </div>
        <div class="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-braun-500">
          Category
        </div>
        <div class="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-braun-500">
          Location
        </div>
        <div class="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-braun-500">
          GPS
        </div>
      </div>

      <!-- Virtual scrolling container -->
      <div
        bind:this={scrollContainerRef}
        class="overflow-auto"
        style="height: calc(100vh - 420px); min-height: 300px;"
      >
        <div
          style="height: {totalSize}px; width: 100%; position: relative;"
        >
          {#each virtualItems as virtualRow (virtualRow.index)}
            {@const location = filteredLocations()[virtualRow.index]}
            <div
              class="grid grid-cols-[1fr_150px_200px_80px] absolute top-0 left-0 w-full hover:bg-braun-100 cursor-pointer border-b border-braun-200"
              style="height: {virtualRow.size}px; transform: translateY({virtualRow.start}px);"
              onclick={() => router.navigate(`/location/${location.locid}`)}
            >
              <div class="px-6 py-4 flex flex-col justify-center overflow-hidden">
                <div class="text-sm font-medium text-braun-900 truncate">{location.locnam}</div>
                {#if location.akanam}
                  <div class="text-xs text-braun-500 truncate">{location.akanam}</div>
                {/if}
              </div>
              <div class="px-6 py-4 flex items-center text-sm text-braun-600 truncate">
                {location.category || '-'}
              </div>
              <div class="px-6 py-4 flex items-center text-sm text-braun-600 truncate">
                {#if location.address?.city && location.address?.state}
                  {location.address.city}, {location.address.state}
                {:else if location.address?.state}
                  {location.address.state}
                {:else}
                  -
                {/if}
              </div>
              <div class="px-6 py-4 flex items-center">
                {#if location.gps}
                  <span class="px-2 inline-flex text-xs leading-5 font-medium rounded-sm bg-gps-verified/10 text-gps-verified">
                    Yes
                  </span>
                {:else}
                  <span class="px-2 inline-flex text-xs leading-5 font-medium rounded-sm bg-braun-100 text-braun-500">
                    No
                  </span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
    <div class="mt-4 text-sm text-braun-600">
      Showing {filteredLocations().length} of {locations.length} locations
    </div>
  {:else}
    <div class="bg-white border border-braun-300 rounded p-8 text-center">
      <p class="text-base text-braun-600">No locations found</p>
      <p class="text-sm text-braun-500 mt-2">
        {#if locations.length === 0}
          Add your first location from the Atlas page
        {:else}
          Try adjusting your filters
        {/if}
      </p>
    </div>
  {/if}
</div>
