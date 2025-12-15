<script lang="ts">
  /**
   * LocationNerdStats - Technical metadata (IDs, timestamps, GPS details, counts)
   * OPT-100: Settings moved to LocationSettings.svelte for better discoverability
   */
  import type { Location } from '@au-archive/core';

  interface Props {
    location: Location;
    imageCount: number;
    videoCount: number;
    documentCount: number;
    mapCount?: number; // MAP-MEDIA-FIX-001
    onLocationUpdated?: () => void;
  }

  let { location, imageCount, videoCount, documentCount, mapCount = 0, onLocationUpdated }: Props = $props();

  let isOpen = $state(false);
  let copiedField = $state<string | null>(null);

  // BagIt Archive state
  let bagStatus = $state<string | null>(null);
  let bagLastVerified = $state<string | null>(null);
  let bagLastError = $state<string | null>(null);
  let regeneratingBag = $state(false);
  let validatingBag = $state(false);
  let bagMessage = $state('');

  // Per-user view statistics
  interface ViewStats {
    totalViews: number;
    uniqueViewers: number;
    lastViewedAt: string | null;
    recentViewers: Array<{
      user_id: string;
      username: string;
      display_name: string | null;
      view_count: number;
      last_viewed_at: string;
    }>;
  }
  let viewStats = $state<ViewStats | null>(null);
  let loadingViewStats = $state(false);

  // Fetch view stats and BagIt status when section is opened
  $effect(() => {
    if (isOpen && !viewStats && !loadingViewStats) {
      loadingViewStats = true;
      window.electronAPI?.locations?.getViewStats(location.locid)
        .then((stats: ViewStats) => {
          viewStats = stats;
        })
        .catch((err: Error) => {
          console.warn('[NerdStats] Failed to load view stats:', err);
        })
        .finally(() => {
          loadingViewStats = false;
        });

      // Load BagIt status
      loadBagStatus();
    }
  });

  async function loadBagStatus() {
    try {
      const status = await window.electronAPI?.bagit?.status(location.locid);
      if (status) {
        bagStatus = status.bag_status || 'none';
        bagLastVerified = status.bag_last_verified || null;
        bagLastError = status.bag_last_error || null;
      }
    } catch (err) {
      console.warn('[NerdStats] Failed to load bag status:', err);
    }
  }

  async function regenerateBag() {
    if (regeneratingBag || !window.electronAPI?.bagit?.regenerate) return;

    try {
      regeneratingBag = true;
      bagMessage = 'Regenerating archive...';

      await window.electronAPI.bagit.regenerate(location.locid);

      bagMessage = 'Archive regenerated successfully';
      await loadBagStatus();
      setTimeout(() => { bagMessage = ''; }, 3000);
    } catch (err) {
      console.error('Regenerate bag failed:', err);
      bagMessage = 'Failed to regenerate archive';
    } finally {
      regeneratingBag = false;
    }
  }

  async function validateBag() {
    if (validatingBag || !window.electronAPI?.bagit?.validate) return;

    try {
      validatingBag = true;
      bagMessage = 'Validating archive...';

      const result = await window.electronAPI.bagit.validate(location.locid);

      if (result.status === 'valid') {
        bagMessage = 'Archive verified successfully';
      } else if (result.status === 'incomplete') {
        bagMessage = `Archive incomplete: ${result.missingFiles?.length || 0} missing files`;
      } else if (result.status === 'invalid') {
        bagMessage = `Archive invalid: ${result.checksumErrors?.length || 0} checksum errors`;
      }

      await loadBagStatus();
      setTimeout(() => { bagMessage = ''; }, 5000);
    } catch (err) {
      console.error('Validate bag failed:', err);
      bagMessage = 'Validation failed';
    } finally {
      validatingBag = false;
    }
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    copiedField = field;
    setTimeout(() => {
      copiedField = null;
    }, 1500);
  }
</script>

<div class="mt-6 bg-white rounded border border-braun-300">
  <button
    onclick={() => isOpen = !isOpen}
    aria-expanded={isOpen}
    class="w-full p-6 flex items-center justify-between text-left hover:bg-braun-50 transition-colors"
  >
    <h2 class="text-xl font-semibold text-braun-900">Nerd Stats</h2>
    <svg
      class="w-5 h-5 text-braun-400 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if isOpen}
  <div class="px-6 pb-6">
  <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
    <!-- IDs -->
    <div class="col-span-full border-b pb-3 mb-2">
      <p class="text-xs font-semibold text-braun-400 uppercase mb-2">Identifiers</p>
    </div>
    <div>
      <span class="text-braun-500">Full Location ID:</span>
      <button
        onclick={() => copyToClipboard(location.locid, 'locid')}
        class="ml-2 font-mono text-xs text-braun-900 hover:underline"
        title="Click to copy"
      >
        {copiedField === 'locid' ? 'Copied!' : location.locid}
      </button>
    </div>
    <div>
      <span class="text-braun-500">Short ID (loc12):</span>
      <button
        onclick={() => copyToClipboard(location.loc12, 'loc12')}
        class="ml-2 font-mono text-xs text-braun-900 hover:underline"
        title="Click to copy"
      >
        {copiedField === 'loc12' ? 'Copied!' : location.loc12}
      </button>
    </div>
    {#if location.slocnam}
      <div>
        <span class="text-braun-500">Short Name:</span>
        <span class="ml-2 font-mono text-xs">{location.slocnam}</span>
      </div>
    {/if}

    <!-- Timestamps -->
    <div class="col-span-full border-b pb-3 mb-2 mt-5">
      <p class="text-xs font-semibold text-braun-400 uppercase mb-2">Timestamps</p>
    </div>
    {#if location.locadd}
      <div>
        <span class="text-braun-500">Created:</span>
        <span class="ml-2">{new Date(location.locadd).toLocaleString()}</span>
      </div>
    {/if}
    {#if location.locup}
      <div>
        <span class="text-braun-500">Last Updated:</span>
        <span class="ml-2">{new Date(location.locup).toLocaleString()}</span>
      </div>
    {/if}
    {#if location.auth_imp}
      <div>
        <span class="text-braun-500">Author:</span>
        <span class="ml-2">{location.auth_imp}</span>
      </div>
    {/if}

    <!-- View Tracking -->
    <div class="col-span-full border-b pb-3 mb-2 mt-5">
      <p class="text-xs font-semibold text-braun-400 uppercase mb-2">Activity</p>
    </div>
    <div>
      <span class="text-braun-500">Total Views:</span>
      <span class="ml-2 font-semibold">{viewStats?.totalViews ?? location.viewCount ?? 0}</span>
    </div>
    {#if viewStats}
      <div>
        <span class="text-braun-500">Unique Viewers:</span>
        <span class="ml-2 font-semibold">{viewStats.uniqueViewers}</span>
      </div>
    {/if}
    {#if viewStats?.lastViewedAt || location.lastViewedAt}
      <div>
        <span class="text-braun-500">Last Viewed:</span>
        <span class="ml-2">{new Date(viewStats?.lastViewedAt ?? location.lastViewedAt!).toLocaleString()}</span>
      </div>
    {/if}
    {#if viewStats?.recentViewers && viewStats.recentViewers.length > 0}
      <div class="col-span-full mt-3">
        <span class="text-braun-500">Recent Viewers:</span>
        <div class="mt-2 flex flex-wrap gap-2">
          {#each viewStats.recentViewers.slice(0, 5) as viewer}
            <span class="inline-flex items-center px-2 py-1 bg-braun-100 rounded text-xs">
              {viewer.display_name || viewer.username}
              <span class="ml-1 text-braun-400">({viewer.view_count})</span>
            </span>
          {/each}
        </div>
      </div>
    {/if}
    {#if loadingViewStats}
      <div class="col-span-full text-xs text-braun-400">Loading view details...</div>
    {/if}

    <!-- GPS Details -->
    {#if location.gps}
      <div class="col-span-full border-b pb-3 mb-2 mt-5">
        <p class="text-xs font-semibold text-braun-400 uppercase mb-2">GPS Details</p>
      </div>
      <div>
        <span class="text-braun-500">GPS Source:</span>
        <span class="ml-2 capitalize">{location.gps.source?.replace(/_/g, ' ')}</span>
      </div>
      <div>
        <span class="text-braun-500">Map Verified:</span>
        <span class="ml-2">{location.gps.verifiedOnMap ? 'Yes' : 'No'}</span>
      </div>
      {#if location.gps.accuracy}
        <div>
          <span class="text-braun-500">GPS Accuracy:</span>
          <span class="ml-2">{location.gps.accuracy}m</span>
        </div>
      {/if}
      {#if location.gps.capturedAt}
        <div>
          <span class="text-braun-500">GPS Captured:</span>
          <span class="ml-2">{new Date(location.gps.capturedAt).toLocaleString()}</span>
        </div>
      {/if}
    {/if}

    <!-- Media Counts -->
    <div class="col-span-full border-b pb-3 mb-2 mt-5">
      <p class="text-xs font-semibold text-braun-400 uppercase mb-2">Media Statistics</p>
    </div>
    <div>
      <span class="text-braun-500">Images:</span>
      <span class="ml-2 font-semibold">{imageCount}</span>
    </div>
    <div>
      <span class="text-braun-500">Videos:</span>
      <span class="ml-2 font-semibold">{videoCount}</span>
    </div>
    <div>
      <span class="text-braun-500">Documents:</span>
      <span class="ml-2 font-semibold">{documentCount}</span>
    </div>
    <div>
      <span class="text-braun-500">Maps:</span>
      <span class="ml-2 font-semibold">{mapCount}</span>
    </div>
    <div>
      <span class="text-braun-500">Total Media:</span>
      <span class="ml-2 font-semibold">{imageCount + videoCount + documentCount + mapCount}</span>
    </div>

    <!-- BagIt Archive (Self-Documenting Archive per RFC 8493) -->
    <div class="col-span-full border-b pb-3 mb-2 mt-5">
      <p class="text-xs font-semibold text-braun-400 uppercase mb-2">Archive Integrity</p>
    </div>
    <div>
      <span class="text-braun-500">Status:</span>
      <span class="ml-2">
        {#if bagStatus === 'valid'}
          <span class="text-success font-medium">Valid</span>
        {:else if bagStatus === 'complete'}
          <span class="text-braun-700 font-medium">Complete</span>
        {:else if bagStatus === 'incomplete'}
          <span class="text-warning font-medium">Incomplete</span>
        {:else if bagStatus === 'invalid'}
          <span class="text-error font-medium">Invalid</span>
        {:else}
          <span class="text-braun-400">Not Generated</span>
        {/if}
      </span>
    </div>
    {#if bagLastVerified}
      <div>
        <span class="text-braun-500">Last Verified:</span>
        <span class="ml-2">{new Date(bagLastVerified).toLocaleString()}</span>
      </div>
    {/if}
    {#if bagLastError}
      <div class="col-span-full">
        <span class="text-braun-500">Last Error:</span>
        <span class="ml-2 text-error text-xs">{bagLastError}</span>
      </div>
    {/if}
    <div class="col-span-full mt-2">
      <div class="flex flex-wrap items-center gap-2">
        <button
          onclick={regenerateBag}
          disabled={regeneratingBag || validatingBag}
          class="px-3 py-1 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
          title="Regenerate BagIt archive files for this location"
        >
          {regeneratingBag ? 'Regenerating...' : 'Regenerate Archive'}
        </button>
        <button
          onclick={validateBag}
          disabled={regeneratingBag || validatingBag}
          class="px-3 py-1 text-sm bg-braun-600 text-white rounded hover:bg-braun-500 transition disabled:opacity-50"
          title="Verify file checksums match manifest"
        >
          {validatingBag ? 'Validating...' : 'Verify Checksums'}
        </button>
        {#if bagMessage}
          <span class="text-sm text-braun-600">{bagMessage}</span>
        {/if}
      </div>
      <p class="text-xs text-braun-400 mt-2">
        Self-documenting archive per BagIt RFC 8493. Files survive 35+ years without database.
      </p>
    </div>

    <!-- Regions -->
    {#if location.regions && location.regions.length > 0}
      <div class="col-span-full border-b pb-3 mb-2 mt-5">
        <p class="text-xs font-semibold text-braun-400 uppercase mb-2">Classification</p>
      </div>
      <div class="col-span-full">
        <span class="text-braun-500">Regions:</span>
        <span class="ml-2">{location.regions.join(', ')}</span>
      </div>
    {/if}
  </div>
  </div>
  {/if}
</div>
