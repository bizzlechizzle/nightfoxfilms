<script lang="ts">
  /**
   * LocationResearchTimeline - Table-based timeline with multi-source support
   * Shows Date | Event | Sources columns
   * Per Braun: Table format, source badges, conflict indicators
   * LLM Tools Overhaul: Uses findByLocationWithSources for multi-source data
   */
  import type { TimelineEventWithSources } from '../../types/electron';
  import TimelineTableRow from './TimelineTableRow.svelte';
  import { onMount } from 'svelte';

  interface Props {
    locid: string;
    subid?: string | null;
    isHostLocation?: boolean;
    onOpenWebSource?: (websourceId: string) => void;
  }

  let {
    locid,
    subid = null,
    isHostLocation = false,
    onOpenWebSource
  }: Props = $props();

  let events = $state<TimelineEventWithSources[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let isOpen = $state(false);
  let currentUser = $state<string | null>(null);
  let editingEventId = $state<string | null>(null);

  // Chronological sort: oldest first, established at top
  let sortedEvents = $derived(
    [...events].sort((a, b) => {
      // Established events always come first
      const aSort = a.event_type === 'established' && (a.date_sort === null || a.date_sort === 99999999)
        ? -1
        : (a.date_sort ?? 99999999);
      const bSort = b.event_type === 'established' && (b.date_sort === null || b.date_sort === 99999999)
        ? -1
        : (b.date_sort ?? 99999999);
      return aSort - bSort;
    })
  );

  // Count events needing review
  let needsReviewCount = $derived(
    events.filter(e => e.needs_review).length
  );

  onMount(async () => {
    try {
      currentUser = await window.electronAPI.settings.get('current_user') as string | null;
    } catch (e) {
      console.warn('Could not get current user:', e);
    }
    loadTimeline();
  });

  $effect(() => {
    const _ = locid + (subid ?? '');
    loadTimeline();
  });

  async function loadTimeline() {
    loading = true;
    error = null;

    try {
      // Use the new multi-source endpoint
      events = await window.electronAPI.timeline.findByLocationWithSources(locid);
    } catch (e) {
      console.error('Failed to load timeline:', e);
      error = 'Failed to load timeline';
    } finally {
      loading = false;
    }
  }

  async function handleApprove(eventId: string) {
    try {
      await window.electronAPI.timeline.approve(eventId, currentUser || 'system');
      // Reload to reflect changes
      await loadTimeline();
    } catch (e) {
      console.error('Failed to approve event:', e);
    }
  }

  async function handleReject(eventId: string) {
    try {
      await window.electronAPI.timeline.reject(eventId, currentUser || undefined);
      // Reload to reflect changes
      await loadTimeline();
    } catch (e) {
      console.error('Failed to reject event:', e);
    }
  }

  function handleEdit(eventId: string) {
    editingEventId = eventId;
    // TODO: Open inline edit form
  }

  function handleOpenSource(sourceId: string) {
    if (onOpenWebSource) {
      onOpenWebSource(sourceId);
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
    <span class="text-base font-medium text-braun-900">Timeline</span>
    <div class="flex items-center gap-2">
      {#if !loading}
        <span class="text-sm text-braun-400">({sortedEvents.length})</span>
        {#if needsReviewCount > 0}
          <span class="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-amber-200 text-amber-800 rounded">
            {needsReviewCount} to review
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
        <div class="py-4 text-sm text-braun-500 pl-4">Loading timeline...</div>
      {:else if error}
        <div class="py-4 text-sm text-red-600 pl-4">{error}</div>
      {:else if sortedEvents.length === 0}
        <div class="py-4 text-sm text-braun-500 pl-4">No timeline events</div>
      {:else}
        <!-- Table format: Date | Event | Sources -->
        <table class="w-full">
          <thead>
            <tr class="border-b border-braun-300 text-left">
              <th class="pb-2 pr-4 text-xs font-medium text-braun-500 uppercase tracking-wide w-28">Date</th>
              <th class="pb-2 pr-4 text-xs font-medium text-braun-500 uppercase tracking-wide">Event</th>
              <th class="pb-2 text-xs font-medium text-braun-500 uppercase tracking-wide w-36">Source</th>
            </tr>
          </thead>
          <tbody>
            {#each sortedEvents as event (event.event_id)}
              <TimelineTableRow
                {event}
                isEditing={editingEventId === event.event_id}
                onEdit={handleEdit}
                onApprove={handleApprove}
                onReject={handleReject}
                onOpenSource={handleOpenSource}
                {currentUser}
              />
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
</div>
