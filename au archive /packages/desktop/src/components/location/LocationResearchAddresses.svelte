<script lang="ts">
  /**
   * LocationResearchAddresses - Extracted addresses accordion
   * Shows addresses found in web sources vs current location address
   * Per Braun: Table format, confidence indicators, action buttons
   * LLM Tools Overhaul: Uses extraction:addresses IPC handlers
   */
  import type { ExtractedAddress } from '../../types/electron';
  import SourceBadge from './SourceBadge.svelte';
  import { onMount } from 'svelte';

  interface Props {
    locid: string;
    currentAddress?: {
      street?: string | null;
      city?: string | null;
      county?: string | null;
      state?: string | null;
      zipcode?: string | null;
    };
    onOpenWebSource?: (websourceId: string) => void;
    onAddressApplied?: () => void;
  }

  let {
    locid,
    currentAddress,
    onOpenWebSource,
    onAddressApplied
  }: Props = $props();

  let addresses = $state<ExtractedAddress[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let isOpen = $state(false);
  let currentUser = $state<string | null>(null);
  let applyingId = $state<string | null>(null);

  // Filter to show only pending addresses by default
  let showAll = $state(false);

  let filteredAddresses = $derived(
    showAll
      ? addresses
      : addresses.filter(a => a.status === 'pending')
  );

  // Count pending addresses for badge
  let pendingCount = $derived(
    addresses.filter(a => a.status === 'pending').length
  );

  // Format current address for display
  let currentAddressDisplay = $derived(() => {
    if (!currentAddress) return null;
    const parts = [
      currentAddress.street,
      currentAddress.city,
      currentAddress.state,
      currentAddress.zipcode
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  });

  onMount(async () => {
    try {
      currentUser = await window.electronAPI.settings.get('current_user') as string | null;
    } catch (e) {
      console.warn('Could not get current user:', e);
    }
    loadAddresses();
  });

  $effect(() => {
    const _ = locid;
    loadAddresses();
  });

  async function loadAddresses() {
    loading = true;
    error = null;

    try {
      addresses = await window.electronAPI.extraction.addresses.getByLocation(locid);
    } catch (e) {
      console.error('Failed to load extracted addresses:', e);
      error = 'Failed to load addresses';
    } finally {
      loading = false;
    }
  }

  async function handleApply(addressId: string) {
    applyingId = addressId;
    try {
      await window.electronAPI.extraction.addresses.apply(addressId, currentUser || 'system');
      await loadAddresses();
      if (onAddressApplied) {
        onAddressApplied();
      }
    } catch (e) {
      console.error('Failed to apply address:', e);
    } finally {
      applyingId = null;
    }
  }

  async function handleReject(addressId: string) {
    try {
      await window.electronAPI.extraction.addresses.reject(addressId, currentUser || undefined);
      await loadAddresses();
    } catch (e) {
      console.error('Failed to reject address:', e);
    }
  }

  async function handleApprove(addressId: string) {
    try {
      await window.electronAPI.extraction.addresses.approve(addressId, currentUser || 'system');
      await loadAddresses();
    } catch (e) {
      console.error('Failed to approve address:', e);
    }
  }

  function handleOpenSource(sourceId: string) {
    if (onOpenWebSource) {
      onOpenWebSource(sourceId);
    }
  }

  // Confidence color mapping
  function getConfidenceClass(confidence: number): string {
    if (confidence >= 0.8) return 'text-green-600';
    if (confidence >= 0.5) return 'text-amber-600';
    return 'text-red-600';
  }

  function getConfidenceLabel(confidence: number): string {
    if (confidence >= 0.8) return 'High';
    if (confidence >= 0.5) return 'Medium';
    return 'Low';
  }

  // Status badge styling
  function getStatusClass(status: string): string {
    switch (status) {
      case 'applied':
        return 'bg-green-100 text-green-700';
      case 'approved':
        return 'bg-blue-100 text-blue-700';
      case 'rejected':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-amber-100 text-amber-700';
    }
  }
</script>

<!-- Nested accordion - no outer border -->
<div class="border-b border-braun-200 last:border-b-0">
  <button
    onclick={() => isOpen = !isOpen}
    aria-expanded={isOpen}
    class="w-full py-3 flex items-center justify-between text-left hover:bg-braun-50 transition-colors"
  >
    <span class="text-base font-medium text-braun-900">Addresses</span>
    <div class="flex items-center gap-2">
      {#if !loading}
        <span class="text-sm text-braun-400">({addresses.length})</span>
        {#if pendingCount > 0}
          <span class="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-amber-200 text-amber-800 rounded">
            {pendingCount} to review
          </span>
        {/if}
      {/if}
      <svg
        class="w-4 h-4 text-braun-400 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  </button>

  {#if isOpen}
    <div class="pb-4">
      {#if loading}
        <div class="py-4 text-sm text-braun-500 pl-4">Loading addresses...</div>
      {:else if error}
        <div class="py-4 text-sm text-red-600 pl-4">{error}</div>
      {:else}
        <!-- Current Address comparison -->
        {#if currentAddressDisplay()}
          <div class="mb-4 p-3 bg-braun-50 rounded border border-braun-200">
            <div class="text-xs font-medium text-braun-500 uppercase tracking-wide mb-1">Current Address</div>
            <div class="text-sm text-braun-900">{currentAddressDisplay()}</div>
          </div>
        {:else}
          <div class="mb-4 p-3 bg-amber-50 rounded border border-amber-200">
            <div class="text-xs font-medium text-amber-600">No address set for this location</div>
          </div>
        {/if}

        {#if filteredAddresses.length === 0}
          <div class="py-4 text-sm text-braun-500 pl-4">
            {showAll ? 'No extracted addresses' : 'No addresses pending review'}
          </div>
        {:else}
          <!-- Table format: Address | Confidence | Source | Actions -->
          <table class="w-full">
            <thead>
              <tr class="border-b border-braun-300 text-left">
                <th class="pb-2 pr-4 text-xs font-medium text-braun-500 uppercase tracking-wide">Address</th>
                <th class="pb-2 pr-4 text-xs font-medium text-braun-500 uppercase tracking-wide w-20">Conf.</th>
                <th class="pb-2 pr-4 text-xs font-medium text-braun-500 uppercase tracking-wide w-24">Source</th>
                <th class="pb-2 text-xs font-medium text-braun-500 uppercase tracking-wide w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredAddresses as address (address.address_id)}
                <tr class="border-b border-braun-200 last:border-b-0 {address.status === 'pending' ? 'bg-amber-50' : ''} hover:bg-braun-50 transition-colors">
                  <!-- Address Column -->
                  <td class="py-2 pr-4 align-top">
                    <div class="text-sm text-braun-900">{address.full_address}</div>
                    {#if address.context_sentence}
                      <p class="text-xs text-braun-500 mt-1 line-clamp-2 italic">"{address.context_sentence}"</p>
                    {/if}
                    {#if address.status !== 'pending'}
                      <span class="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded mt-1 {getStatusClass(address.status)}">
                        {address.status}
                      </span>
                    {/if}
                    {#if address.matches_location}
                      <span class="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded mt-1 ml-1">
                        Matches
                      </span>
                    {/if}
                  </td>

                  <!-- Confidence Column -->
                  <td class="py-2 pr-4 align-top whitespace-nowrap">
                    <span class="text-sm font-medium {getConfidenceClass(address.confidence)}">
                      {Math.round(address.confidence * 100)}%
                    </span>
                    <div class="text-xs text-braun-400">{getConfidenceLabel(address.confidence)}</div>
                  </td>

                  <!-- Source Column -->
                  <td class="py-2 pr-4 align-top">
                    {#if address.source_id}
                      <SourceBadge
                        domain={address.source_domain || 'Source'}
                        title={address.source_title}
                        sourceId={address.source_id}
                        onClick={handleOpenSource}
                      />
                    {:else}
                      <span class="text-xs text-braun-400">Manual</span>
                    {/if}
                  </td>

                  <!-- Actions Column -->
                  <td class="py-2 align-top">
                    {#if address.status === 'pending'}
                      <div class="flex gap-2">
                        <button
                          type="button"
                          onclick={() => handleApply(address.address_id)}
                          disabled={applyingId === address.address_id}
                          class="text-xs text-green-600 hover:text-green-800 hover:underline disabled:opacity-50"
                        >
                          {applyingId === address.address_id ? 'Applying...' : 'Use This'}
                        </button>
                        <button
                          type="button"
                          onclick={() => handleApprove(address.address_id)}
                          class="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onclick={() => handleReject(address.address_id)}
                          class="text-xs text-red-600 hover:text-red-800 hover:underline"
                        >
                          Reject
                        </button>
                      </div>
                    {:else if address.status === 'approved' && !address.matches_location}
                      <button
                        type="button"
                        onclick={() => handleApply(address.address_id)}
                        disabled={applyingId === address.address_id}
                        class="text-xs text-green-600 hover:text-green-800 hover:underline disabled:opacity-50"
                      >
                        {applyingId === address.address_id ? 'Applying...' : 'Use This'}
                      </button>
                    {:else}
                      <span class="text-xs text-braun-400">—</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}

        <!-- Show all toggle -->
        {#if addresses.length > pendingCount}
          <div class="mt-3 flex justify-center">
            <button
              type="button"
              onclick={() => showAll = !showAll}
              class="text-xs text-braun-500 hover:text-braun-700 hover:underline"
            >
              {showAll ? 'Show pending only' : `Show all (${addresses.length - pendingCount} reviewed)`}
            </button>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>
