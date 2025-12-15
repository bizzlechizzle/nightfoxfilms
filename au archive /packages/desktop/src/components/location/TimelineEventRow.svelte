<script lang="ts">
  /**
   * TimelineEventRow - Individual event in the timeline
   * Displays date, event type, source, and approval status
   */
  import type { TimelineEvent, TimelineEventWithSource } from '@au-archive/core';
  import TimelineDateInput from './TimelineDateInput.svelte';

  interface Props {
    event: TimelineEvent | TimelineEventWithSource;
    editMode?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    showSourceBuilding?: boolean;
    onUpdate?: (dateInput: string, eventSubtype: string) => void;
    onApprove?: (eventId: string) => void;
  }

  let {
    event,
    editMode = false,
    isFirst = false,
    isLast = false,
    showSourceBuilding = false,
    onUpdate,
    onApprove
  }: Props = $props();

  // Computed states
  let isApproved = $derived(event.auto_approved === 1 || event.user_approved === 1);
  let isPending = $derived(!isApproved && event.event_type === 'visit');
  let sourceBuilding = $derived(
    showSourceBuilding && 'source_building' in event ? (event as TimelineEventWithSource).source_building : null
  );

  // Event type labels
  const eventTypeLabels: Record<string, string> = {
    established: 'Established',
    visit: 'Visit',
    database_entry: 'Added to archive',
    custom: 'Event'
  };

  // Subtype labels for established events
  const subtypeLabels: Record<string, string> = {
    built: 'Built',
    opened: 'Opened',
    expanded: 'Expanded',
    renovated: 'Renovated',
    closed: 'Closed',
    abandoned: 'Abandoned',
    demolished: 'Demolished'
  };

  function getEventLabel(): string {
    if (event.event_type === 'established' && event.event_subtype) {
      return subtypeLabels[event.event_subtype] || 'Established';
    }
    return eventTypeLabels[event.event_type] || 'Event';
  }

  function getMediaSummary(): string {
    if (event.event_type !== 'visit') return '';
    const count = event.media_count || 0;
    if (count === 0) return '';
    return count === 1 ? '1 file' : `${count} files`;
  }

  function getSourceBadge(): string | null {
    if (event.source_type === 'exif') return 'EXIF';
    if (event.source_type === 'web') return 'WEB';
    if (event.source_type === 'document') return 'DOC';
    if (event.source_type === 'system') return null;
    return null;
  }

  // State for edit mode
  let showDateInput = $state(false);
</script>

<div class="timeline-event relative pl-6 pb-4">
  <!-- Event dot -->
  <div
    class="absolute left-0 top-1 w-[7px] h-[7px] rounded-full {isApproved ? 'bg-braun-900' : 'border border-braun-400 bg-white'}"
  ></div>

  <!-- Event content -->
  <div class="flex flex-col gap-0.5">
    <!-- Date row -->
    <div class="flex items-center gap-2">
      {#if event.event_type === 'established' && editMode && showDateInput}
        <TimelineDateInput
          initialValue={event.date_display || ''}
          initialSubtype={event.event_subtype || 'built'}
          onSave={(date, subtype) => {
            onUpdate?.(date, subtype);
            showDateInput = false;
          }}
          onCancel={() => showDateInput = false}
        />
      {:else}
        <span class="text-[15px] font-medium text-braun-900">
          {event.date_display || '—'}
        </span>

        {#if getSourceBadge()}
          <span class="text-[10px] font-medium uppercase tracking-wide text-braun-500 bg-braun-100 px-1.5 py-0.5 rounded">
            {getSourceBadge()}
          </span>
        {/if}

        {#if isApproved}
          <span class="text-braun-600" title="Verified">
            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
            </svg>
          </span>
        {:else if isPending && editMode}
          <button
            type="button"
            onclick={() => onApprove?.(event.event_id)}
            class="text-[11px] text-braun-500 hover:text-braun-900"
            title="Mark as verified"
          >
            [verify]
          </button>
        {/if}
      {/if}
    </div>

    <!-- Event type and details -->
    <div class="flex items-center gap-2 text-[13px] text-braun-600">
      <span>{getEventLabel()}</span>

      {#if sourceBuilding}
        <span class="text-braun-500">from {sourceBuilding}</span>
      {/if}

      {#if getMediaSummary()}
        <span class="text-braun-500">{getMediaSummary()}</span>
      {/if}
    </div>

    <!-- Device info -->
    {#if event.source_device}
      <div class="text-[12px] text-braun-500">
        {event.source_device}
      </div>
    {/if}

    <!-- Approval status for pending visits -->
    {#if isPending && !editMode}
      <div class="text-[12px] text-amber-600">
        Pending verification
      </div>
    {:else if event.auto_approved === 1 && event.event_type === 'visit'}
      <div class="text-[12px] text-braun-500">
        Auto-approved (cellphone)
      </div>
    {/if}

    <!-- Edit button for established dates -->
    {#if event.event_type === 'established' && editMode && !showDateInput}
      <button
        type="button"
        onclick={() => showDateInput = true}
        class="text-[11px] text-braun-500 hover:text-braun-900 mt-1"
      >
        [edit date]
      </button>
    {/if}
  </div>
</div>

<style>
  .timeline-event:last-child {
    padding-bottom: 0;
  }
</style>
