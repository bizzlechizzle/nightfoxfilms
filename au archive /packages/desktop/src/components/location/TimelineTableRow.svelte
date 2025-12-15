<script lang="ts">
  /**
   * TimelineTableRow - Single row in the timeline table
   * Supports inline editing, source badges, and conflict indicators
   * Per Braun: Amber bg for needs_review, clean table cells
   */
  import SourceBadge from './SourceBadge.svelte';
  import type { TimelineEventWithSources } from '../../types/electron';

  interface Props {
    event: TimelineEventWithSources;
    isEditing?: boolean;
    onEdit?: (eventId: string) => void;
    onApprove?: (eventId: string) => void;
    onReject?: (eventId: string) => void;
    onOpenSource?: (sourceId: string) => void;
    currentUser?: string | null;
  }

  let {
    event,
    isEditing = false,
    onEdit,
    onApprove,
    onReject,
    onOpenSource,
    currentUser
  }: Props = $props();

  // Format date based on precision
  let displayDate = $derived(() => {
    if (!event.date_display) return '—';
    return event.date_display;
  });

  // Event description - prioritize smart_title/tldr over generic
  let eventDescription = $derived(() => {
    if (event.smart_title) return event.smart_title;
    if (event.tldr) return event.tldr;
    if (event.notes) return event.notes;

    // Fallback to type-based description
    if (event.event_type === 'established') {
      const subtype = event.event_subtype || 'built';
      const labels: Record<string, string> = {
        built: 'Location was built',
        opened: 'Location opened',
        closed: 'Location closed',
        abandoned: 'Location abandoned',
        demolished: 'Location demolished',
        renovated: 'Location renovated'
      };
      return labels[subtype] || 'Established';
    }

    if (event.event_type === 'visit') {
      // Use created_by, fall back to currentUser prop, then 'Unknown'
      const by = event.created_by || currentUser || 'Unknown';
      const imgCount = event.image_count || 0;
      const vidCount = event.video_count || 0;
      const totalCount = imgCount + vidCount;

      if (totalCount > 0) {
        // Build media label based on what's present
        const parts: string[] = [];

        if (imgCount > 0) {
          parts.push(`${imgCount} ${imgCount === 1 ? 'Image' : 'Images'}`);
        }
        if (vidCount > 0) {
          parts.push(`${vidCount} ${vidCount === 1 ? 'Video' : 'Videos'}`);
        }

        const mediaLabel = parts.join(', ');

        // Choose verb based on media type
        let verb: string;
        if (imgCount > 0 && vidCount > 0) {
          verb = 'Documented';
        } else if (vidCount > 0) {
          verb = 'Filmed';
        } else {
          verb = 'Photographed';
        }

        return `${verb} by ${by} [${mediaLabel}]`;
      }
      // No media - generic visit
      return `Site visit by ${by}`;
    }

    if (event.event_type === 'database_entry') {
      return 'Added to database';
    }

    return event.event_type || 'Event';
  });

  // Determine row styling based on needs_review
  let rowClass = $derived(() => {
    if (event.needs_review) {
      return 'bg-amber-50 hover:bg-amber-100';
    }
    return 'hover:bg-braun-50';
  });

  // Conflict indicator
  let hasConflict = $derived(() => event.has_conflicts && event.sources.length > 1);

  // Limit displayed sources to 3, show +N more
  let displayedSources = $derived(() => {
    if (event.sources.length <= 3) return event.sources;
    return event.sources.slice(0, 3);
  });
  let extraSourceCount = $derived(() => Math.max(0, event.sources.length - 3));

  // Fallback source label when no web sources - be specific about origin
  let fallbackSourceLabel = $derived(() => {
    // Source type specific labels
    switch (event.source_type) {
      case 'exif':
        return 'EXIF Metadata';
      case 'web':
        return 'Web Metadata';
      case 'document':
        return 'Document Metadata';
      case 'system':
        // Database entry - show who added it
        if (event.event_type === 'database_entry') {
          const addedBy = event.location_author || event.created_by || currentUser;
          return addedBy || 'System';
        }
        return 'System';
      case 'manual':
        // For manual entries, show who entered it if available
        if (event.created_by) {
          return event.created_by;
        }
        return 'Manual Entry';
      default:
        return 'Unknown';
    }
  });
</script>

<tr class="{rowClass()} transition-colors border-b border-braun-200 last:border-b-0">
  <!-- Date Column -->
  <td class="py-2 pr-4 align-top whitespace-nowrap">
    <span class="text-sm font-medium text-braun-900">{displayDate()}</span>
    {#if event.date_precision && event.date_precision !== 'exact'}
      <span class="text-xs text-braun-400 ml-1">({event.date_precision})</span>
    {/if}
  </td>

  <!-- Event Column -->
  <td class="py-2 pr-4 align-top">
    <div class="flex items-start gap-2">
      {#if hasConflict()}
        <span class="inline-flex items-center px-1 py-0.5 text-[10px] font-medium bg-amber-200 text-amber-800 rounded" title="Sources disagree on this event">
          Conflict
        </span>
      {/if}
      <span class="text-sm text-braun-700 flex-1">{eventDescription()}</span>
    </div>

    <!-- TLDR if different from title -->
    {#if event.tldr && event.smart_title && event.tldr !== event.smart_title}
      <p class="text-xs text-braun-500 mt-1 line-clamp-2">{event.tldr}</p>
    {/if}

    <!-- Review actions for needs_review events -->
    {#if event.needs_review}
      <div class="flex gap-2 mt-2">
        {#if onApprove}
          <button
            type="button"
            onclick={() => onApprove(event.event_id)}
            class="text-xs text-green-600 hover:text-green-800 hover:underline"
          >
            Approve
          </button>
        {/if}
        {#if onEdit}
          <button
            type="button"
            onclick={() => onEdit(event.event_id)}
            class="text-xs text-blue-600 hover:text-blue-800 hover:underline"
          >
            Edit
          </button>
        {/if}
        {#if onReject}
          <button
            type="button"
            onclick={() => onReject(event.event_id)}
            class="text-xs text-red-600 hover:text-red-800 hover:underline"
          >
            Reject
          </button>
        {/if}
      </div>
    {/if}
  </td>

  <!-- Sources Column -->
  <td class="py-2 align-top">
    {#if event.sources.length > 0}
      <div class="flex flex-wrap gap-1">
        {#each displayedSources() as source}
          <SourceBadge
            domain={source.domain || 'Unknown'}
            title={source.title}
            url={source.url}
            sourceId={source.source_id}
            onClick={onOpenSource}
          />
        {/each}
        {#if extraSourceCount() > 0}
          <span class="text-[11px] text-braun-400 py-0.5">+{extraSourceCount()} more</span>
        {/if}
      </div>
    {:else}
      <span class="text-xs text-braun-400">{fallbackSourceLabel()}</span>
    {/if}
  </td>
</tr>
