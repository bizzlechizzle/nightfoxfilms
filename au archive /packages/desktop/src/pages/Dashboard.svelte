<script lang="ts">
  /**
   * Dashboard.svelte - Main dashboard
   *
   * Layout:
   * - Stats row
   * - Projects (pinned/favorite locations)
   * - Recent Locations / Recent Imports (2-col)
   * - Top Type / Top State (2-col, no thumbnails)
   */
  import { onMount, onDestroy } from 'svelte';
  import { router } from '../stores/router';
  import { isImporting, importProgress, recentImports as storeRecentImports } from '../stores/import-store';
  import { thumbnailCache } from '../stores/thumbnail-cache-store';

  // OPT-087 + OPT-110: Handle asset-ready events for hero thumbnail refresh
  // OPT-110: Debounce cache bust to prevent rapid reloads during batch thumbnail generation
  let cacheBustTimer: ReturnType<typeof setTimeout> | null = null;
  const CACHE_BUST_DEBOUNCE_MS = 500;

  function handleAssetReady(event: CustomEvent<{ type: string; hash: string; paths?: { sm?: string; lg?: string } }>) {
    const { type } = event.detail;
    // When thumbnails are ready, debounce the cache bust to prevent rapid reloads
    if (type === 'thumbnail') {
      if (cacheBustTimer) clearTimeout(cacheBustTimer);
      cacheBustTimer = setTimeout(() => {
        cacheBustTimer = null;
        thumbnailCache.bust();
      }, CACHE_BUST_DEBOUNCE_MS);
    }
  }
  import SkeletonLoader from '../components/SkeletonLoader.svelte';

  interface ImportRecord {
    import_id: string;
    locid: string | null;
    import_date: string;
    auth_imp: string | null;
    img_count: number;
    vid_count: number;
    doc_count: number;
    map_count: number;
    notes: string | null;
    locnam?: string;
    address_state?: string;
    heroThumbPath?: string;
  }

  interface LocationWithHero {
    locid: string;
    locnam: string;
    address?: { state?: string };
    heroThumbPath?: string;
  }

  interface CategoryStat {
    category: string;
    count: number;
  }

  interface StateStat {
    state: string;
    count: number;
  }

  // Stats
  let totalLocations = $state(0);
  let totalImages = $state(0);
  let totalVideos = $state(0);
  let totalDocuments = $state(0);
  let totalWebSources = $state(0);

  // Format large numbers with "k" suffix (e.g., 3024 → "3k", 3150 → "3.2k")
  function formatCount(n: number): string {
    if (n < 1000) return n.toString();
    const k = n / 1000;
    const rounded = Math.round(k * 10) / 10;
    return rounded % 1 === 0 ? `${Math.floor(rounded)}k` : `${rounded}k`;
  }

  // Sections
  let projects = $state<LocationWithHero[]>([]);
  let recentLocations = $state<LocationWithHero[]>([]);
  let recentImports = $state<ImportRecord[]>([]);
  let topCategories = $state<CategoryStat[]>([]);
  let topStates = $state<StateStat[]>([]);

  let loading = $state(true);

  // Cache version for busting browser cache after thumbnail regeneration
  const cacheVersion = $derived($thumbnailCache);

  onMount(async () => {
    // OPT-087: Listen for asset-ready events to refresh hero thumbnails
    window.addEventListener('asset-ready', handleAssetReady as EventListener);

    if (!window.electronAPI?.locations) {
      console.error('Electron API not available');
      loading = false;
      return;
    }

    // Fetch each section independently so one failure doesn't blank the whole dashboard
    try {
      totalLocations = await window.electronAPI.locations.count();
    } catch (e) {
      console.error('Failed to load location count:', e);
    }

    try {
      const mediaCounts = await window.electronAPI.imports.getTotalMediaCount();
      totalImages = mediaCounts.images;
      totalVideos = mediaCounts.videos;
      totalDocuments = mediaCounts.documents;
    } catch (e) {
      console.error('Failed to load media counts:', e);
    }

    try {
      totalWebSources = await window.electronAPI.websources.count();
    } catch (e) {
      console.error('Failed to load web sources count:', e);
    }

    try {
      // Projects = locations with project flag set, includes hero thumbnails
      projects = await window.electronAPI.locations.findProjects(5);
    } catch (e) {
      console.error('Failed to load projects:', e);
    }

    try {
      // OPT-068: Fetch extra to ensure 4 remain after deduplication
      recentLocations = await window.electronAPI.locations.findRecentlyViewed(15);
    } catch (e) {
      console.error('Failed to load recent locations:', e);
    }

    try {
      // OPT-068: Fetch extra to ensure 4 remain after deduplication
      recentImports = await window.electronAPI.imports.findRecent(15) as ImportRecord[];
    } catch (e) {
      console.error('Failed to load recent imports:', e);
    }

    try {
      topCategories = await window.electronAPI.stats.topCategories(5);
    } catch (e) {
      console.error('Failed to load top categories:', e);
    }

    try {
      topStates = await window.electronAPI.stats.topStates(5);
    } catch (e) {
      console.error('Failed to load top states:', e);
    }

    // OPT-068: Deduplicate locations across sections (Projects > Imports > Recent)
    // Priority: Projects > Imports > Recent. Each location appears only once.
    const projectIds = new Set(projects.map(p => p.locid));
    recentImports = recentImports
      .filter(imp => !imp.locid || !projectIds.has(imp.locid))
      .slice(0, 4);
    const shownIds = new Set([
      ...projectIds,
      ...recentImports.filter(imp => imp.locid).map(imp => imp.locid!)
    ]);
    recentLocations = recentLocations
      .filter(loc => !shownIds.has(loc.locid))
      .slice(0, 4);

    loading = false;
  });

  // OPT-087: Cleanup asset-ready event listener
  // OPT-110: Also cleanup cache bust debounce timer
  onDestroy(() => {
    window.removeEventListener('asset-ready', handleAssetReady as EventListener);
    if (cacheBustTimer) clearTimeout(cacheBustTimer);
  });

  function formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
</script>

<div class="h-full overflow-auto">
  <!-- Page Header -->
  <div class="max-w-6xl mx-auto px-8 pt-8 pb-4">
    <h1 class="text-4xl font-bold text-braun-900">Dashboard</h1>

    <!-- Projects (Pinned Locations) - above stats -->
    {#if !loading}
      <div class="mt-6">
        <div class="bg-white border border-braun-300 rounded p-8">
          <div class="flex justify-between items-center mb-4">
            <h3 class="section-label mb-0">Projects</h3>
            <button onclick={() => router.navigate('/locations', undefined, { project: true })} class="text-xs text-braun-600 hover:text-braun-900 hover:underline font-medium">
              show all
            </button>
          </div>
          {#if projects.length > 0}
            <div class="space-y-3">
              {#each projects as location}
                <button
                  onclick={() => router.navigate(`/location/${location.locid}`)}
                  class="flex items-center gap-4 w-full text-left px-3 py-3 rounded hover:bg-braun-100 transition"
                >
                  {#if location.heroThumbPath}
                    <div class="w-32 h-20 bg-braun-200 rounded flex-shrink-0 overflow-hidden">
                      <img src={`media://${location.heroThumbPath}?v=${cacheVersion}`} alt="" class="w-full h-full object-cover" loading="lazy" width="128" height="80" />
                    </div>
                  {/if}
                  <div class="min-w-0">
                    <span class="text-base text-braun-900 font-medium truncate block">{location.locnam}</span>
                  </div>
                </button>
              {/each}
            </div>
          {:else}
            <p class="text-sm text-braun-500">No pinned locations yet</p>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Stats Row -->
    {#if !loading}
      <div class="flex justify-center gap-8 mt-6">
        <div class="text-center">
          <div class="text-2xl font-bold text-braun-900">{formatCount(totalLocations)}</div>
          <div class="text-[11px] uppercase tracking-wider text-braun-500">locations</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold text-braun-900">{formatCount(totalImages)}</div>
          <div class="text-[11px] uppercase tracking-wider text-braun-500">images</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold text-braun-900">{formatCount(totalVideos)}</div>
          <div class="text-[11px] uppercase tracking-wider text-braun-500">videos</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold text-braun-900">{formatCount(totalDocuments)}</div>
          <div class="text-[11px] uppercase tracking-wider text-braun-500">documents</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold text-braun-900">{formatCount(totalWebSources)}</div>
          <div class="text-[11px] uppercase tracking-wider text-braun-500">bookmarks</div>
        </div>
      </div>
    {/if}
  </div>

  <div class="max-w-6xl mx-auto px-8 pt-4 pb-8">
  {#if loading}
    <!-- OPT-040: Premium skeleton loaders instead of "Loading..." text -->
    <div class="space-y-6">
      <!-- Stats skeleton -->
      <div class="flex justify-center gap-8 mb-8">
        {#each Array(5) as _}
          <div class="text-center space-y-1">
            <div class="skeleton-shimmer h-8 w-12 bg-braun-200 rounded mx-auto"></div>
            <div class="skeleton-shimmer h-3 w-16 bg-braun-200 rounded"></div>
          </div>
        {/each}
      </div>
      <!-- Projects skeleton -->
      <div class="bg-white border border-braun-300 rounded p-8">
        <div class="skeleton-shimmer h-5 w-24 bg-braun-200 rounded mb-4"></div>
        <SkeletonLoader type="row" count={3} />
      </div>
      <!-- Two-column skeleton -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-white border border-braun-300 rounded p-8">
          <div class="skeleton-shimmer h-5 w-32 bg-braun-200 rounded mb-4"></div>
          <SkeletonLoader type="row" count={3} />
        </div>
        <div class="bg-white border border-braun-300 rounded p-8">
          <div class="skeleton-shimmer h-5 w-28 bg-braun-200 rounded mb-4"></div>
          <SkeletonLoader type="row" count={3} />
        </div>
      </div>
    </div>
  {:else}
    <!-- Active Import Status -->
    {#if $isImporting && $importProgress}
      <div class="mb-6">
        <div class="bg-white border border-braun-300 rounded p-8 border-l-4 border-l-braun-900">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <div class="w-3 h-3 bg-braun-900 rounded-full"></div>
              <h3 class="section-label mb-0">Import In Progress</h3>
            </div>
            <span class="text-sm text-braun-500">
              {$importProgress.current} of {$importProgress.total} files
            </span>
          </div>
          <p class="text-sm text-braun-600 mb-2">
            Importing to <button onclick={() => router.navigate(`/location/${$importProgress.locid}`)} class="text-braun-900 hover:underline font-medium">{$importProgress.locationName}</button>
          </p>
          <div class="w-full bg-braun-200 rounded-full h-3">
            <div
              class="bg-braun-900 h-3 rounded-full transition-all duration-300 ease-out"
              style="width: {$importProgress.percent}%"
            ></div>
          </div>
          <p class="text-xs text-braun-500 mt-2">
            {$importProgress.percent}% complete
          </p>
        </div>
      </div>
    {/if}

    <!-- Recent Background Imports -->
    {#if $storeRecentImports.length > 0}
      <div class="mb-6">
        <div class="bg-white border border-braun-300 rounded p-8">
          <h3 class="section-label">Recent Background Imports</h3>
          <div class="space-y-2">
            {#each $storeRecentImports.slice(0, 3) as job}
              <div class="flex items-center justify-between text-sm py-2 border-b border-braun-200 last:border-0">
                <div class="flex items-center gap-2">
                  <button onclick={() => router.navigate(`/location/${job.locid}`)} class="text-braun-900 hover:underline font-medium">
                    {job.locationName}
                  </button>
                </div>
                <div class="text-braun-500 text-xs">
                  {#if job.status === 'completed'}
                    {job.imported} imported, {job.duplicates} duplicates
                  {:else}
                    <span class="text-error">{job.error || 'Failed'}</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    <!-- Recent Locations + Recent Imports -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
      <!-- Recent Locations -->
      <div class="bg-white border border-braun-300 rounded p-8">
        <div class="flex justify-between items-center mb-4">
          <h3 class="section-label mb-0">Recent Locations</h3>
          <button onclick={() => router.navigate('/locations')} class="text-xs text-braun-600 hover:text-braun-900 hover:underline font-medium">
            show all
          </button>
        </div>
        {#if recentLocations.length > 0}
          <div class="space-y-3">
            {#each recentLocations as location}
              <button
                onclick={() => router.navigate(`/location/${location.locid}`)}
                class="flex items-center gap-4 w-full text-left px-2 py-2 rounded hover:bg-braun-100 transition"
              >
                {#if location.heroThumbPath}
                  <div class="w-16 h-16 bg-braun-200 rounded flex-shrink-0 overflow-hidden">
                    <img src={`media://${location.heroThumbPath}?v=${cacheVersion}`} alt="" class="w-full h-full object-cover" loading="lazy" width="64" height="64" />
                  </div>
                {/if}
                <div class="min-w-0">
                  <span class="text-sm text-braun-900 font-medium truncate block">{location.locnam}</span>
                </div>
              </button>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-braun-500">No recent locations</p>
        {/if}
      </div>

      <!-- Recent Imports -->
      <div class="bg-white border border-braun-300 rounded p-8">
        <div class="flex justify-between items-center mb-4">
          <h3 class="section-label mb-0">Recent Imports</h3>
          <button onclick={() => router.navigate('/imports')} class="text-xs text-braun-600 hover:text-braun-900 hover:underline font-medium">
            show all
          </button>
        </div>
        {#if recentImports.length > 0}
          <div class="space-y-3">
            {#each recentImports as importRecord}
              <button
                onclick={() => importRecord.locid && router.navigate(`/location/${importRecord.locid}`)}
                class="flex items-center gap-4 w-full text-left px-2 py-2 rounded hover:bg-braun-100 transition"
                disabled={!importRecord.locid}
              >
                {#if importRecord.heroThumbPath}
                  <div class="w-16 h-16 bg-braun-200 rounded flex-shrink-0 overflow-hidden">
                    <img src={`media://${importRecord.heroThumbPath}?v=${cacheVersion}`} alt="" class="w-full h-full object-cover" loading="lazy" width="64" height="64" />
                  </div>
                {/if}
                <div class="min-w-0">
                  <span class="text-sm text-braun-900 font-medium truncate block">
                    {importRecord.locnam || `Import #${importRecord.import_id.slice(0, 8)}`}
                  </span>
                </div>
              </button>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-braun-500">No imports yet</p>
        {/if}
      </div>
    </div>

    <!-- Top Type + Top State (no thumbnails) -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <!-- Top Type -->
      <div class="bg-white border border-braun-300 rounded p-8">
        <div class="flex justify-between items-center mb-4">
          <h3 class="section-label mb-0">Top Category</h3>
          <button onclick={() => router.navigate('/locations')} class="text-xs text-braun-600 hover:text-braun-900 hover:underline font-medium">
            show all
          </button>
        </div>
        {#if topCategories.length > 0}
          <div class="space-y-2">
            {#each topCategories as stat}
              <button
                onclick={() => router.navigate('/locations', undefined, { category: stat.category })}
                class="flex items-center justify-between w-full text-left px-2 py-2 rounded hover:bg-braun-100 transition"
              >
                <span class="text-sm text-braun-900 font-medium truncate">{stat.category}</span>
                <span class="text-xs text-braun-500">{stat.count}</span>
              </button>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-braun-500">No data yet</p>
        {/if}
      </div>

      <!-- Top State -->
      <div class="bg-white border border-braun-300 rounded p-8">
        <div class="flex justify-between items-center mb-4">
          <h3 class="section-label mb-0">Top State</h3>
          <button onclick={() => router.navigate('/locations')} class="text-xs text-braun-600 hover:text-braun-900 hover:underline font-medium">
            show all
          </button>
        </div>
        {#if topStates.length > 0}
          <div class="space-y-2">
            {#each topStates as stat}
              <button
                onclick={() => router.navigate('/locations', undefined, { state: stat.state })}
                class="flex items-center justify-between w-full text-left px-2 py-2 rounded hover:bg-braun-100 transition"
              >
                <span class="text-sm text-braun-900 font-medium truncate">{stat.state}</span>
                <span class="text-xs text-braun-500">{stat.count}</span>
              </button>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-braun-500">No data yet</p>
        {/if}
      </div>
    </div>
  {/if}
</div>
</div>

<style>
  /* Braun: No shimmer animation - static loading states only */
</style>
