<script lang="ts">
  /**
   * LinkLocationModal - Modal for linking a reference point to an existing location.
   * Used from the Atlas page when clicking the Link button on a reference pin popup.
   */
  import type { Location } from '@au-archive/core';

  interface Props {
    pointName: string;
    onClose: () => void;
    onLink: (locationId: string) => void;
  }

  let { pointName, onClose, onLink }: Props = $props();

  let searchQuery = $state('');
  let locations = $state<Location[]>([]);
  let loading = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout>;

  async function searchLocations() {
    if (!searchQuery.trim()) {
      locations = [];
      return;
    }
    loading = true;
    try {
      const all = await window.electronAPI.locations.findAll();
      // Simple client-side filter by name, city, or state
      const query = searchQuery.toLowerCase();
      locations = all.filter(loc =>
        loc.locnam.toLowerCase().includes(query) ||
        loc.address?.city?.toLowerCase().includes(query) ||
        loc.address?.state?.toLowerCase().includes(query) ||
        loc.type?.toLowerCase().includes(query)
      ).slice(0, 20);
    } catch (err) {
      console.error('Search error:', err);
      locations = [];
    } finally {
      loading = false;
    }
  }

  function handleInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(searchLocations, 300);
  }

  function selectLocation(locid: string) {
    onLink(locid);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Modal backdrop -->
<div
  class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
  onclick={onClose}
  role="dialog"
  aria-modal="true"
  aria-labelledby="link-modal-title"
>
  <!-- Modal content -->
  <div
    class="bg-white rounded border border-braun-300 w-full max-w-md mx-4"
    onclick={(e) => e.stopPropagation()}
  >
    <!-- Header -->
    <div class="p-4 border-b border-braun-200">
      <h3 id="link-modal-title" class="text-lg font-semibold text-foreground">Link to Location</h3>
      <p class="text-sm text-braun-500 mt-1">
        Link "<span class="font-medium">{pointName}</span>" to an existing location
      </p>
    </div>

    <!-- Search input -->
    <div class="p-4 border-b border-braun-100">
      <input
        type="text"
        bind:value={searchQuery}
        oninput={handleInput}
        placeholder="Search locations by name, type, city, or state..."
        class="w-full px-3 py-2 border border-braun-300 rounded focus:border-braun-600 focus:outline-none text-sm"
        autofocus
      />
    </div>

    <!-- Results list -->
    <div class="max-h-64 overflow-y-auto">
      {#if loading}
        <div class="p-4 text-braun-500 text-center text-sm">
          Searching...
        </div>
      {:else if locations.length === 0 && searchQuery.trim()}
        <div class="p-4 text-braun-500 text-center text-sm">
          No locations found
        </div>
      {:else if locations.length === 0}
        <div class="p-4 text-braun-400 text-center text-sm">
          Type to search for locations
        </div>
      {:else}
        {#each locations as loc}
          <button
            onclick={() => selectLocation(loc.locid)}
            class="w-full text-left px-4 py-3 hover:bg-braun-50 border-b border-braun-100 last:border-b-0 transition-colors"
          >
            <div class="font-medium text-foreground">{loc.locnam}</div>
            <div class="text-sm text-braun-500 mt-0.5">
              {loc.type || 'Unknown type'}
              {#if loc.address?.city || loc.address?.state}
                <span class="mx-1">-</span>
                {loc.address?.city || ''}{loc.address?.city && loc.address?.state ? ', ' : ''}{loc.address?.state || ''}
              {/if}
            </div>
          </button>
        {/each}
      {/if}
    </div>

    <!-- Footer -->
    <div class="p-4 border-t border-braun-200 flex justify-end">
      <button
        onclick={onClose}
        class="px-4 py-2 text-braun-600 hover:bg-braun-100 rounded transition-colors text-sm"
      >
        Cancel
      </button>
    </div>
  </div>
</div>
