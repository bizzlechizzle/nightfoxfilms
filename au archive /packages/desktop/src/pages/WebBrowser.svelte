<script lang="ts">
  /**
   * WebBrowser.svelte - Integrated web browser per page_web-browser.md spec
   *
   * Per spec:
   * - embedded browser
   * - right side toolbar with:
   *   - save bookmark (with search/autofill based on database)
   *   - recents (list top 5)
   *   - projects/pinned (list top 5 - refers to favorite locations)
   *   - uploads (list top 5)
   *   - save - add new buttons
   *   - bookmark browser by state/type/location
   */
  import { onMount, onDestroy } from 'svelte';
  import type { Location } from '@au-archive/core';
  import { openImportModal } from '../stores/import-modal-store';

  interface Bookmark {
    bookmark_id: string;
    url: string;
    title: string | null;
    locid: string | null;
    created_date: string;
  }


  // Browser state - Default to Abandoned Upstate website
  let currentUrl = $state('https://www.abandonedupstate.com');
  let urlInput = $state('https://www.abandonedupstate.com');
  let pageTitle = $state('');
  let isLoading = $state(false);
  let browserContainerRef: HTMLDivElement;

  // Sidebar state
  let searchQuery = $state('');
  let recentBookmarks = $state<Bookmark[]>([]);
  let pinnedLocations = $state<Location[]>([]);
  let showSaveBookmark = $state(false);
  let bookmarkLocid = $state<string | null>(null);
  let bookmarkTitle = $state('');
  let autocompleteResults = $state<Location[]>([]);
  let locationSearchQuery = $state('');
  let savingBookmark = $state(false);

  // Bookmark browser state - per spec: bookmark browser by state/type/location
  let allBookmarks = $state<Bookmark[]>([]);
  let bookmarkFilterState = $state('');
  let bookmarkFilterType = $state('');
  let showBookmarkBrowser = $state(false);
  let bookmarkStates = $state<string[]>([]);
  let bookmarkTypes = $state<string[]>([]);
  let locationCache = $state<Map<string, Location>>(new Map());

  let cleanupFunctions: Array<() => void> = [];
  let resizeObserver: ResizeObserver | null = null;

  onMount(async () => {
    // Set up browser event listeners
    if (window.electronAPI?.browser) {
      cleanupFunctions.push(
        window.electronAPI.browser.onNavigated((url: string) => {
          currentUrl = url;
          urlInput = url;
        })
      );
      cleanupFunctions.push(
        window.electronAPI.browser.onTitleChanged((title: string) => {
          pageTitle = title;
          bookmarkTitle = title;
        })
      );
      cleanupFunctions.push(
        window.electronAPI.browser.onLoadingChanged((loading: boolean) => {
          isLoading = loading;
        })
      );

      // Set up resize observer for browser container
      if (browserContainerRef) {
        resizeObserver = new ResizeObserver(() => {
          updateBrowserBounds();
        });
        resizeObserver.observe(browserContainerRef);
      }

      // Initial positioning and navigation
      await updateBrowserBounds();
      await window.electronAPI.browser.navigate(currentUrl);
    }

    // Load sidebar data
    await loadSidebarData();
  });

  onDestroy(() => {
    // Clean up event listeners
    cleanupFunctions.forEach(fn => fn());

    // Clean up resize observer
    if (resizeObserver) {
      resizeObserver.disconnect();
    }

    // Hide browser view when leaving page
    window.electronAPI?.browser?.hide();
  });

  async function updateBrowserBounds() {
    if (!browserContainerRef || !window.electronAPI?.browser) return;

    const rect = browserContainerRef.getBoundingClientRect();
    await window.electronAPI.browser.show({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }

  async function loadSidebarData() {
    if (!window.electronAPI) return;

    try {
      // Load recent bookmarks (top 5) per spec
      if (window.electronAPI.bookmarks) {
        recentBookmarks = (await window.electronAPI.bookmarks.findRecent(5)) as Bookmark[];
      }

      // Load pinned/favorite locations (top 5) - "projects" in spec means pinned items
      if (window.electronAPI.locations) {
        pinnedLocations = (await window.electronAPI.locations.favorites()).slice(0, 5);
      }
    } catch (error) {
      console.error('Error loading sidebar data:', error);
    }
  }

  // Per spec: bookmark browser by state/type/location
  async function loadBookmarkBrowserData() {
    if (!window.electronAPI?.bookmarks || !window.electronAPI?.locations) return;

    try {
      // Load all bookmarks
      allBookmarks = (await window.electronAPI.bookmarks.findAll()) as Bookmark[];

      // Load locations for bookmarks that have locid to get state/type info
      const locids = [...new Set(allBookmarks.filter(b => b.locid).map(b => b.locid!))];
      const newCache = new Map<string, Location>();
      const states = new Set<string>();
      const types = new Set<string>();

      for (const locid of locids) {
        const loc = await window.electronAPI.locations.findById(locid);
        if (loc) {
          newCache.set(locid, loc);
          if (loc.address?.state) states.add(loc.address.state);
          if (loc.type) types.add(loc.type);
        }
      }

      locationCache = newCache;
      bookmarkStates = Array.from(states).sort();
      bookmarkTypes = Array.from(types).sort();
    } catch (error) {
      console.error('Error loading bookmark browser data:', error);
    }
  }

  // Derived filtered bookmarks for bookmark browser
  function getFilteredBookmarks(): Bookmark[] {
    return allBookmarks.filter(bookmark => {
      if (!bookmark.locid) return !bookmarkFilterState && !bookmarkFilterType;

      const loc = locationCache.get(bookmark.locid);
      if (!loc) return false;

      const matchesState = !bookmarkFilterState || loc.address?.state === bookmarkFilterState;
      const matchesType = !bookmarkFilterType || loc.type === bookmarkFilterType;

      return matchesState && matchesType;
    });
  }

  async function toggleBookmarkBrowser() {
    showBookmarkBrowser = !showBookmarkBrowser;
    if (showBookmarkBrowser && allBookmarks.length === 0) {
      await loadBookmarkBrowserData();
    }
  }

  async function navigate() {
    if (!window.electronAPI?.browser) return;

    let url = urlInput.trim();
    if (!url) return;

    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    await window.electronAPI.browser.navigate(url);
  }

  async function goBack() {
    await window.electronAPI?.browser?.goBack();
  }

  async function goForward() {
    await window.electronAPI?.browser?.goForward();
  }

  async function reload() {
    await window.electronAPI?.browser?.reload();
  }

  async function handleLocationSearch() {
    if (!locationSearchQuery.trim() || !window.electronAPI?.locations) {
      autocompleteResults = [];
      return;
    }

    try {
      // Search locations for autocomplete - per spec "autofill based on database"
      const results = await window.electronAPI.locations.findAll({ search: locationSearchQuery });
      autocompleteResults = results.slice(0, 10);
    } catch (error) {
      console.error('Error searching locations:', error);
    }
  }

  function selectLocation(loc: Location) {
    bookmarkLocid = loc.locid;
    locationSearchQuery = loc.locnam;
    autocompleteResults = [];
  }

  async function saveBookmark() {
    if (!window.electronAPI?.bookmarks) return;

    try {
      savingBookmark = true;
      await window.electronAPI.bookmarks.create({
        url: currentUrl,
        title: bookmarkTitle || pageTitle || null,
        locid: bookmarkLocid,
        auth_imp: null,
      });
      showSaveBookmark = false;
      bookmarkLocid = null;
      locationSearchQuery = '';
      bookmarkTitle = '';
      // Reload sidebar data to show new bookmark
      await loadSidebarData();
    } catch (error) {
      console.error('Error saving bookmark:', error);
    } finally {
      savingBookmark = false;
    }
  }

  function openBookmark(url: string) {
    urlInput = url;
    navigate();
  }

  function handleKeyPress(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      navigate();
    }
  }
</script>

<div class="h-full flex">
  <!-- Browser Area -->
  <div class="flex-1 flex flex-col">
    <!-- Browser Toolbar -->
    <div class="bg-braun-100 border-b border-braun-200 px-3 py-2 flex items-center gap-2">
      <button
        onclick={goBack}
        class="p-1.5 hover:bg-braun-200 rounded transition"
        title="Back"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        onclick={goForward}
        class="p-1.5 hover:bg-braun-200 rounded transition"
        title="Forward"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <button
        onclick={reload}
        class="p-1.5 hover:bg-braun-200 rounded transition"
        title="Reload"
      >
        <svg class="w-4 h-4 {isLoading ? 'text-braun-400' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>

      <div class="flex-1 flex">
        <input
          type="text"
          bind:value={urlInput}
          onkeypress={handleKeyPress}
          class="flex-1 px-3 py-1.5 text-sm border border-braun-300 rounded-l focus:outline-none focus:border-braun-600"
          placeholder="Enter URL..."
        />
        <button
          onclick={navigate}
          class="px-4 py-1.5 bg-braun-900 text-white text-sm rounded-r hover:bg-braun-600 transition"
        >
          Go
        </button>
      </div>

      {#if isLoading}
        <span class="text-xs text-braun-500">Loading...</span>
      {/if}
    </div>

    <!-- Browser View Container -->
    <div bind:this={browserContainerRef} class="flex-1 bg-white relative">
      <!-- BrowserView will be positioned here by Electron -->
      {#if !window.electronAPI?.browser}
        <div class="absolute inset-0 flex items-center justify-center bg-braun-50">
          <div class="text-center p-8">
            <p class="text-braun-500 mb-2">Browser API not available</p>
            <p class="text-sm text-braun-400">The integrated browser requires the Electron API to be loaded</p>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Right Sidebar Toolbar - per spec page_web-browser.md -->
  <aside class="w-80 bg-white border-l border-braun-200 flex flex-col overflow-hidden">
    <div class="p-4 border-b border-braun-200">
      <h2 class="text-lg font-semibold text-foreground">Research Tools</h2>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- BOX 1: Save Bookmarks Bar - Quick save destination shortcuts -->
      <div class="bg-braun-50 rounded border border-braun-200 p-4">
        <h3 class="text-sm font-semibold text-braun-800 mb-3">Save Bookmark</h3>

        <!-- Save Bookmark Button & Form -->
        <div class="mb-3">
          <button
            onclick={() => { showSaveBookmark = !showSaveBookmark; bookmarkTitle = pageTitle; }}
            class="w-full px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition text-sm font-medium"
          >
            {showSaveBookmark ? 'Cancel' : 'Save Current Page'}
          </button>

          {#if showSaveBookmark}
            <div class="mt-3 p-3 bg-white rounded border space-y-3">
              <div>
                <p class="text-xs text-braun-600 mb-1 truncate" title={currentUrl}>{currentUrl}</p>
              </div>

              <div>
                <label for="bookmark-title" class="block text-xs text-braun-700 mb-1">Title</label>
                <input
                  id="bookmark-title"
                  type="text"
                  bind:value={bookmarkTitle}
                  placeholder="Bookmark title"
                  class="w-full px-2 py-1 text-sm border border-braun-300 rounded focus:outline-none focus:border-braun-600"
                />
              </div>

              <!-- Search with autofill based on database -->
              <div>
                <label for="location-search" class="block text-xs text-braun-700 mb-1">Link to Location (optional)</label>
                <input
                  id="location-search"
                  type="text"
                  bind:value={locationSearchQuery}
                  oninput={handleLocationSearch}
                  placeholder="Search locations..."
                  class="w-full px-2 py-1 text-sm border border-braun-300 rounded focus:outline-none focus:border-braun-600"
                />

                {#if autocompleteResults.length > 0}
                  <div class="max-h-32 overflow-y-auto border border-braun-300 rounded mt-1 bg-white">
                    {#each autocompleteResults as loc}
                      <button
                        onclick={() => selectLocation(loc)}
                        class="w-full text-left px-2 py-1 text-sm hover:bg-braun-100 truncate"
                      >
                        {loc.locnam}
                        {#if loc.address?.state}
                          <span class="text-braun-400 text-xs">({loc.address.state})</span>
                        {/if}
                      </button>
                    {/each}
                  </div>
                {/if}

                {#if bookmarkLocid}
                  <p class="text-xs text-green-600 mt-1">Linked to: {locationSearchQuery}</p>
                {/if}
              </div>

              <button
                onclick={saveBookmark}
                disabled={savingBookmark}
                class="w-full px-3 py-1.5 bg-braun-900 text-white text-sm rounded hover:bg-braun-600 disabled:opacity-50 transition"
              >
                {savingBookmark ? 'Saving...' : 'Save Bookmark'}
              </button>
            </div>
          {/if}
        </div>

        <!-- Quick Save Destinations -->
        <div class="space-y-3 border-t border-braun-200 pt-3">
          <!-- Recents - quick save destinations -->
          <div>
            <h4 class="text-xs font-medium text-braun-600 mb-1.5">Recents</h4>
            {#if recentBookmarks.length === 0}
              <p class="text-xs text-braun-400 italic">No recent bookmarks</p>
            {:else}
              <div class="space-y-1">
                {#each recentBookmarks.slice(0, 5) as bookmark}
                  <button
                    onclick={() => {
                      // Quick save to same location as this recent bookmark
                      if (bookmark.locid) {
                        bookmarkLocid = bookmark.locid;
                      }
                      showSaveBookmark = true;
                      bookmarkTitle = pageTitle;
                    }}
                    class="w-full text-left px-2 py-1 text-xs bg-white rounded hover:bg-braun-100 truncate transition border border-braun-100"
                    title="Save to same location as: {bookmark.title || bookmark.url}"
                  >
                    {bookmark.title || bookmark.url}
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Pinned Locations - quick save destinations -->
          <div>
            <h4 class="text-xs font-medium text-braun-600 mb-1.5">Pinned Locations</h4>
            {#if pinnedLocations.length === 0}
              <p class="text-xs text-braun-400 italic">No pinned locations</p>
            {:else}
              <div class="space-y-1">
                {#each pinnedLocations.slice(0, 5) as loc}
                  <button
                    onclick={() => {
                      // Quick save to this pinned location
                      bookmarkLocid = loc.locid;
                      locationSearchQuery = loc.locnam;
                      showSaveBookmark = true;
                      bookmarkTitle = pageTitle;
                    }}
                    class="w-full text-left px-2 py-1 text-xs bg-white rounded hover:bg-braun-100 truncate transition border border-braun-100"
                    title="Save to: {loc.locnam}"
                  >
                    <span class="truncate block">{loc.locnam}</span>
                    {#if loc.address?.state}
                      <span class="text-braun-400">({loc.address.state})</span>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>

        </div>
      </div>

      <!-- BOX 2: Bookmark Browser - Browse existing bookmarks by state/type/location -->
      <div class="bg-braun-50 rounded border border-braun-200 p-4">
        <button
          onclick={toggleBookmarkBrowser}
          class="w-full text-left text-sm font-semibold text-braun-800 mb-3 flex items-center justify-between hover:text-braun-600 transition"
        >
          <span>Bookmark Browser</span>
          <span class="text-xs text-braun-500">{showBookmarkBrowser ? '[-]' : '[+]'}</span>
        </button>

        {#if showBookmarkBrowser}
          <div class="space-y-3">
            <!-- Filters -->
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label for="bm-state" class="block text-xs text-braun-600 mb-1">State</label>
                <select
                  id="bm-state"
                  bind:value={bookmarkFilterState}
                  class="w-full px-2 py-1 text-xs border border-braun-300 rounded focus:outline-none focus:border-braun-600 bg-white"
                >
                  <option value="">All States</option>
                  {#each bookmarkStates as state}
                    <option value={state}>{state}</option>
                  {/each}
                </select>
              </div>
              <div>
                <label for="bm-type" class="block text-xs text-braun-600 mb-1">Type</label>
                <select
                  id="bm-type"
                  bind:value={bookmarkFilterType}
                  class="w-full px-2 py-1 text-xs border border-braun-300 rounded focus:outline-none focus:border-braun-600 bg-white"
                >
                  <option value="">All Types</option>
                  {#each bookmarkTypes as type}
                    <option value={type}>{type}</option>
                  {/each}
                </select>
              </div>
            </div>

            <!-- Filtered Bookmarks List -->
            <div class="max-h-48 overflow-y-auto bg-white rounded border border-braun-300">
              {#if getFilteredBookmarks().length === 0}
                <p class="text-xs text-braun-400 text-center py-4">No bookmarks match filters</p>
              {:else}
                <div class="divide-y divide-braun-100">
                  {#each getFilteredBookmarks() as bookmark}
                    <button
                      onclick={() => openBookmark(bookmark.url)}
                      class="w-full text-left px-3 py-2 text-xs hover:bg-braun-50 transition"
                      title={bookmark.url}
                    >
                      <div class="truncate font-medium text-braun-800">{bookmark.title || bookmark.url}</div>
                      {#if bookmark.locid && locationCache.get(bookmark.locid)}
                        <div class="text-braun-400 truncate text-[10px]">
                          {locationCache.get(bookmark.locid)?.locnam}
                        </div>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {:else}
          <p class="text-xs text-braun-500">Click to browse saved bookmarks by state, type, or location</p>
        {/if}
      </div>

      <!-- New Location - opens global import modal -->
      <div class="bg-braun-50 rounded border border-braun-200 p-4">
        <h3 class="text-sm font-semibold text-braun-800 mb-3">Add New</h3>
        <button
          onclick={() => openImportModal()}
          class="w-full px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition text-sm font-medium"
        >
          New Location
        </button>
        <p class="text-xs text-braun-500 mt-2">Create a new location to save bookmarks to</p>
      </div>

      <!-- Quick Links -->
      <div class="bg-braun-50 rounded border border-braun-200 p-4">
        <h3 class="text-sm font-semibold text-braun-800 mb-3">Quick Links</h3>
        <div class="space-y-1">
          <button
            onclick={() => { urlInput = 'https://www.abandonedupstate.com'; navigate(); }}
            class="w-full text-left px-2 py-1.5 text-sm bg-white rounded hover:bg-braun-100 transition border border-braun-100 font-medium text-braun-900"
          >
            Abandoned Upstate
          </button>
          <button
            onclick={() => { urlInput = 'https://www.openstreetmap.org'; navigate(); }}
            class="w-full text-left px-2 py-1.5 text-sm bg-white rounded hover:bg-braun-100 transition border border-braun-100"
          >
            OpenStreetMap
          </button>
          <button
            onclick={() => { urlInput = 'https://www.historicaerials.com'; navigate(); }}
            class="w-full text-left px-2 py-1.5 text-sm bg-white rounded hover:bg-braun-100 transition border border-braun-100"
          >
            Historic Aerials
          </button>
          <button
            onclick={() => { urlInput = 'https://duckduckgo.com'; navigate(); }}
            class="w-full text-left px-2 py-1.5 text-sm bg-white rounded hover:bg-braun-100 transition border border-braun-100"
          >
            DuckDuckGo
          </button>
          <button
            onclick={() => { urlInput = 'https://www.loc.gov/maps/'; navigate(); }}
            class="w-full text-left px-2 py-1.5 text-sm bg-white rounded hover:bg-braun-100 transition border border-braun-100"
          >
            Library of Congress Maps
          </button>
        </div>
      </div>
    </div>
  </aside>
</div>
