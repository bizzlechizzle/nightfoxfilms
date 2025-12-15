<script lang="ts">
  import { onMount } from 'svelte';
  import { router } from '../stores/router';
  import type { Location, LocationFilters } from '@au-archive/core';

  let searchResults = $state<Location[]>([]);
  let searching = $state(false);

  let filters = $state<LocationFilters & { historic?: boolean; gpsVerified?: boolean }>({
    search: '',
    state: '',
    category: '',
    hasGPS: undefined,
    documented: undefined,
    historic: undefined,
    gpsVerified: undefined,
  });

  let allStates = $state<string[]>([]);
  let allCategories = $state<string[]>([]);

  // OPT-036: Load filter options using efficient SELECT DISTINCT query
  async function loadFilterOptions() {
    if (!window.electronAPI?.locations?.getFilterOptions) {
      console.error('Electron API not available - preload script may have failed to load');
      return;
    }
    try {
      const options = await window.electronAPI.locations.getFilterOptions();
      allStates = options.states;
      allCategories = options.categories;
    } catch (error) {
      console.error('Error loading filter options:', error);
    }
  }

  async function handleSearch() {
    if (!window.electronAPI?.locations) return;
    try {
      searching = true;

      const searchFilters: LocationFilters = {
        search: filters.search || undefined,
        state: filters.state || undefined,
        category: filters.category || undefined,
        hasGPS: filters.hasGPS,
        documented: filters.documented,
      };

      let results = await window.electronAPI.locations.findAll(searchFilters);

      if (filters.historic) {
        results = results.filter(l => l.historic);
      }

      if (filters.gpsVerified) {
        results = results.filter(l => l.gps?.verifiedOnMap);
      }

      searchResults = results;
    } catch (error) {
      console.error('Error searching locations:', error);
    } finally {
      searching = false;
    }
  }

  function clearFilters() {
    filters = {
      search: '',
      state: '',
      category: '',
      hasGPS: undefined,
      documented: undefined,
      historic: undefined,
      gpsVerified: undefined,
    };
    searchResults = [];
  }

  // OPT-036: Use onMount instead of $effect to load filter options only once
  onMount(() => {
    loadFilterOptions();
  });
</script>

<div class="p-8">
  <div class="mb-8">
    <h1 class="text-3xl font-bold text-foreground mb-2">Advanced Search</h1>
    <p class="text-braun-600">Search locations with advanced filters</p>
  </div>

  <div class="bg-white rounded border border-braun-300 p-6 mb-6">
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div class="md:col-span-3">
        <label for="search" class="block text-sm font-medium text-braun-700 mb-2">Search Query</label>
        <input
          id="search"
          type="text"
          bind:value={filters.search}
          placeholder="Search by name or AKA..."
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
        />
      </div>

      <div>
        <label for="state" class="block text-sm font-medium text-braun-700 mb-2">State</label>
        <select
          id="state"
          bind:value={filters.state}
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
        >
          <option value="">Any State</option>
          {#each allStates as state}
            <option value={state}>{state}</option>
          {/each}
        </select>
      </div>

      <div>
        <label for="category" class="block text-sm font-medium text-braun-700 mb-2">Category</label>
        <select
          id="category"
          bind:value={filters.category}
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
        >
          <option value="">Any Category</option>
          {#each allCategories as category}
            <option value={category}>{category}</option>
          {/each}
        </select>
      </div>

      <div>
        <label for="gps" class="block text-sm font-medium text-braun-700 mb-2">GPS Status</label>
        <select
          id="gps"
          bind:value={filters.hasGPS}
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
        >
          <option value={undefined}>Any</option>
          <option value={true}>Has GPS</option>
          <option value={false}>No GPS</option>
        </select>
      </div>

      <div>
        <label for="documented" class="block text-sm font-medium text-braun-700 mb-2">Documentation</label>
        <select
          id="documented"
          bind:value={filters.documented}
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
        >
          <option value={undefined}>Any</option>
          <option value={true}>Documented</option>
          <option value={false}>Undocumented</option>
        </select>
      </div>

      <div class="flex items-center gap-6 pt-6">
        <label class="flex items-center">
          <input type="checkbox" bind:checked={filters.historic} class="mr-2" />
          <span class="text-sm text-braun-700">Historic Only</span>
        </label>
        <label class="flex items-center">
          <input type="checkbox" bind:checked={filters.gpsVerified} class="mr-2" />
          <span class="text-sm text-braun-700">GPS Verified</span>
        </label>
      </div>
    </div>

    <div class="flex gap-4 mt-6">
      <button
        onclick={handleSearch}
        disabled={searching}
        class="px-6 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
      >
        {searching ? 'Searching...' : 'Search'}
      </button>
      <button
        onclick={clearFilters}
        class="px-6 py-2 bg-braun-200 text-foreground rounded hover:bg-braun-300 transition"
      >
        Clear Filters
      </button>
    </div>
  </div>

  {#if searchResults.length > 0}
    <div class="bg-white rounded border border-braun-300">
      <div class="px-6 py-4 border-b border-braun-200">
        <h2 class="text-lg font-semibold text-foreground">
          Search Results ({searchResults.length})
        </h2>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-braun-200">
          <thead class="bg-braun-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-braun-500 uppercase tracking-wider">
                Name
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-braun-500 uppercase tracking-wider">
                Category
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-braun-500 uppercase tracking-wider">
                Location
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-braun-500 uppercase tracking-wider">
                Status
              </th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-braun-200">
            {#each searchResults as location}
              <tr class="hover:bg-braun-50 cursor-pointer" onclick={() => router.navigate(`/location/${location.locid}`)}>
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="text-sm font-medium text-braun-900">{location.locnam}</div>
                  {#if location.akanam}
                    <div class="text-xs text-braun-500">{location.akanam}</div>
                  {/if}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-braun-500">
                  {location.category || '-'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-braun-500">
                  {#if location.address?.city && location.address?.state}
                    {location.address.city}, {location.address.state}
                  {:else if location.address?.state}
                    {location.address.state}
                  {:else}
                    -
                  {/if}
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="flex gap-2">
                    {#if location.gps}
                      <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded bg-braun-100 text-braun-700">
                        GPS
                      </span>
                    {/if}
                    {#if location.historic}
                      <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded bg-braun-200 text-braun-800">
                        Historic
                      </span>
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {:else if searching}
    <div class="bg-white rounded border border-braun-300 p-6 text-center text-braun-400">
      Searching...
    </div>
  {:else}
    <div class="bg-white rounded border border-braun-300 p-6 text-center text-braun-400">
      <p class="text-lg">No search performed yet</p>
      <p class="text-sm mt-2">Use the filters above to search for locations</p>
    </div>
  {/if}
</div>
