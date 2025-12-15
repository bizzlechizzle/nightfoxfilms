<script lang="ts">
  /**
   * LocationResearch - Research section accordion wrapper
   * Contains: Timeline (detailed), People, Companies, Addresses
   * Per Braun: White card accordion, 8pt grid, functional minimalism
   * LLM Tools Overhaul: Added Addresses accordion + conditional visibility
   */
  import { router } from '../../stores/router';
  import { onMount } from 'svelte';
  import LocationResearchTimeline from './LocationResearchTimeline.svelte';
  import LocationResearchPeople from './LocationResearchPeople.svelte';
  import LocationResearchCompanies from './LocationResearchCompanies.svelte';
  import LocationResearchAddresses from './LocationResearchAddresses.svelte';

  interface Props {
    locid: string;
    subid?: string | null;
    isHostLocation?: boolean;
    onOpenWebSource?: (websourceId: string) => void;
    currentAddress?: {
      street?: string | null;
      city?: string | null;
      county?: string | null;
      state?: string | null;
      zipcode?: string | null;
    };
    onAddressApplied?: () => void;
  }

  let {
    locid,
    subid = null,
    isHostLocation = false,
    onOpenWebSource,
    currentAddress,
    onAddressApplied
  }: Props = $props();

  // Outer accordion state - collapsed by default
  let isOpen = $state(false);

  // Counts for conditional visibility (LLM Tools Overhaul)
  let counts = $state({
    timeline: 0,
    people: 0,
    companies: 0,
    addresses: 0,
    total: 0
  });
  let countsLoading = $state(true);

  // Computed visibility flags
  let hasAnyData = $derived(counts.total > 0);
  let showTimeline = $derived(counts.timeline > 0);
  let showPeople = $derived(counts.people > 0);
  let showCompanies = $derived(counts.companies > 0);
  let showAddresses = $derived(counts.addresses > 0);

  // Load counts on mount and when locid changes
  onMount(() => {
    loadCounts();
  });

  $effect(() => {
    const _ = locid;
    loadCounts();
  });

  async function loadCounts() {
    countsLoading = true;
    try {
      // Load research counts
      const result = await window.electronAPI.extraction.research.getCounts(locid);
      if (result.success && result.counts) {
        counts = result.counts;
      }
    } catch (e) {
      console.error('Failed to load research counts:', e);
    } finally {
      countsLoading = false;
    }
  }

  // Reload counts when addresses are applied (data may have changed)
  function handleAddressApplied() {
    loadCounts();
    if (onAddressApplied) {
      onAddressApplied();
    }
  }

  // Expose expand function for TimelineHighlightBox to call
  export function expand() {
    isOpen = true;
  }

  function openResearchPage() {
    router.navigate('/research');
  }
</script>

<!-- Hide entire section if no data and not loading -->
{#if countsLoading || hasAnyData}
  <div id="research-section" class="mt-6 bg-white rounded border border-braun-300">
    <!-- Outer accordion header -->
    <button
      onclick={() => isOpen = !isOpen}
      aria-expanded={isOpen}
      class="w-full p-6 flex items-center justify-between text-left hover:bg-braun-50 transition-colors"
    >
      <div class="flex items-center gap-2">
        <h2 class="text-xl font-semibold text-braun-900">Research</h2>
        {#if !countsLoading && counts.total > 0}
          <span class="text-sm text-braun-400">({counts.total})</span>
        {/if}
      </div>
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
        <!-- Nested accordions - only show those with data -->
        <div class="pl-4 space-y-2">
          <!-- Timeline FIRST - primary research artifact -->
          {#if showTimeline || countsLoading}
            <LocationResearchTimeline
              {locid}
              {subid}
              {isHostLocation}
              {onOpenWebSource}
            />
          {/if}

          <!-- People - only show if data exists -->
          {#if showPeople || countsLoading}
            <LocationResearchPeople {locid} />
          {/if}

          <!-- Companies - only show if data exists -->
          {#if showCompanies || countsLoading}
            <LocationResearchCompanies {locid} />
          {/if}

          <!-- Addresses (extracted from sources) - only show if data exists -->
          {#if showAddresses || countsLoading}
            <LocationResearchAddresses
              {locid}
              {currentAddress}
              {onOpenWebSource}
              onAddressApplied={handleAddressApplied}
            />
          {/if}

          <!-- Show message if no data after loading -->
          {#if !countsLoading && !hasAnyData}
            <div class="py-4 text-sm text-braun-500">
              No research data extracted yet. Add web sources to extract timeline events, people, and addresses.
            </div>
          {/if}
        </div>

        <!-- Research button - bottom right -->
        <div class="flex justify-end pt-4">
          <button
            onclick={openResearchPage}
            class="px-4 py-2 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition-colors"
          >
            Research
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}
