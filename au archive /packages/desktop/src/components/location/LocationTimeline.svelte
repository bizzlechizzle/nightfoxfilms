<script lang="ts">
  /**
   * LocationTimeline - Timeline display for location history (OPT-119)
   * Shows established dates, visits, web page publish dates, and database entry
   * Visual hierarchy: Major (user visits, established) → Minor (other visits, web pages) → Technical (db entry)
   * Per PLAN: Braun white card styling, view-only mode (no editing)
   */
  import type { TimelineEvent, TimelineEventWithSource } from '@au-archive/core';
  import { onMount } from 'svelte';

  interface Props {
    locid: string;
    subid?: string | null;
    isHostLocation?: boolean;
    onUpdate?: () => void;
    onOpenWebSource?: (websourceId: string) => void;
    onExpandClick?: () => void; // Scroll to Research section
  }

  let {
    locid,
    subid = null,
    isHostLocation = false,
    onUpdate,
    onOpenWebSource,
    onExpandClick
  }: Props = $props();

  // Timeline state
  let events = $state<(TimelineEvent | TimelineEventWithSource)[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let expanded = $state(false);
  let currentUser = $state<string | null>(null);

  // Media counts cache: event_id -> { images, videos }
  let mediaCounts = $state<Map<string, { images: number; videos: number }>>(new Map());

  // Max entries to show (major events only)
  const MAX_ENTRIES = 9;

  // Major event subtypes to include
  const MAJOR_SUBTYPES = ['built', 'opened', 'closed', 'abandoned', 'demolished'];

  // Filter to major events only, then sort chronologically
  // Major = established events + user's own visits with media
  let sortedEvents = $derived(
    events
      .filter(e =>
        (e.event_type === 'established' && MAJOR_SUBTYPES.includes(e.event_subtype ?? '')) ||
        (e.event_type === 'visit' && e.created_by === currentUser && (e.media_count ?? 0) > 0)
      )
      .sort((a, b) => {
        const aSort = a.event_type === 'established' && (a.date_sort === null || a.date_sort === 99999999)
          ? -1
          : (a.date_sort ?? 99999999);
        const bSort = b.event_type === 'established' && (b.date_sort === null || b.date_sort === 99999999)
          ? -1
          : (b.date_sort ?? 99999999);
        return aSort - bSort;
      })
  );

  // Count events by type for collapse priority
  let establishedEvents = $derived(
    sortedEvents.filter(e => e.event_type === 'established')
  );

  let databaseEntryEvents = $derived(
    sortedEvents.filter(e => e.event_type === 'database_entry')
  );

  let visitEvents = $derived(
    sortedEvents.filter(e => e.event_type === 'visit')
  );

  let webPageEvents = $derived(
    sortedEvents.filter(e => e.event_type === 'custom' && e.event_subtype === 'web_page')
  );

  // Calculate hidden count
  let hiddenCount = $derived(
    sortedEvents.length > MAX_ENTRIES ? sortedEvents.length - MAX_ENTRIES : 0
  );

  // Build display list with priority-based collapsing
  let displayEvents = $derived(() => {
    if (expanded || sortedEvents.length <= MAX_ENTRIES) {
      return sortedEvents;
    }

    // Priority: established first, then database_entry, then fill with recent visits/web pages
    const reserved = [...establishedEvents, ...databaseEntryEvents];
    const reservedIds = new Set(reserved.map(e => e.event_id));

    // Remaining slots for visits and web pages
    const remainingSlots = Math.max(0, MAX_ENTRIES - reserved.length);

    // Combine visits and web pages, sorted by date (most recent first for priority)
    const otherEvents = [...visitEvents, ...webPageEvents]
      .sort((a, b) => (b.date_sort ?? 0) - (a.date_sort ?? 0))
      .slice(0, remainingSlots);

    // Combine all and re-sort chronologically
    const combined = [...reserved, ...otherEvents];
    return combined.sort((a, b) => {
      const aSort = a.event_type === 'established' && (a.date_sort === null || a.date_sort === 99999999)
        ? -1
        : (a.date_sort ?? 99999999);
      const bSort = b.event_type === 'established' && (b.date_sort === null || b.date_sort === 99999999)
        ? -1
        : (b.date_sort ?? 99999999);
      return aSort - bSort;
    });
  });

  // Subtype labels for established events ("Built", "Opened", etc.)
  const subtypeLabels: Record<string, string> = {
    built: 'Built',
    opened: 'Opened',
    expanded: 'Expanded',
    renovated: 'Renovated',
    closed: 'Closed',
    abandoned: 'Abandoned',
    demolished: 'Demolished'
  };

  // Load timeline on mount
  onMount(async () => {
    // Get current user for visit classification
    try {
      currentUser = await window.electronAPI.settings.get('current_user') as string | null;
    } catch (e) {
      console.warn('Could not get current user:', e);
    }
    loadTimeline();
  });

  // Reload when locid/subid changes
  $effect(() => {
    const _ = locid + (subid ?? '');
    loadTimeline();
  });

  async function loadTimeline() {
    loading = true;
    error = null;

    try {
      if (subid) {
        events = await window.electronAPI.timeline.findBySubLocation(locid, subid);
      } else if (isHostLocation) {
        events = await window.electronAPI.timeline.findCombined(locid);
      } else {
        events = await window.electronAPI.timeline.findByLocation(locid);
      }

      // Fetch media counts for visit events (async, non-blocking)
      loadMediaCounts();
    } catch (e) {
      console.error('Failed to load timeline:', e);
      error = 'Failed to load timeline';
    } finally {
      loading = false;
    }
  }

  async function loadMediaCounts() {
    const visitEvts = events.filter(e => e.event_type === 'visit' && e.media_hashes);
    if (!visitEvts.length) return;

    const newCounts = new Map(mediaCounts);

    // Fetch counts in parallel
    await Promise.all(
      visitEvts.map(async (event) => {
        if (!event.media_hashes) return;
        try {
          const counts = await window.electronAPI.timeline.getMediaCounts(event.media_hashes);
          newCounts.set(event.event_id, counts);
        } catch (err) {
          console.warn('Failed to get media counts for', event.event_id, err);
        }
      })
    );

    mediaCounts = newCounts;
  }

  /**
   * Classify event for visual hierarchy
   * Major: established, user's own visits
   * Minor: other visits, web pages
   * Technical: database entry
   */
  function getEventClass(event: TimelineEvent | TimelineEventWithSource): 'major' | 'minor' | 'technical' {
    if (event.event_type === 'database_entry') return 'technical';
    if (event.event_type === 'established') return 'major';
    if (event.event_type === 'visit') {
      return event.created_by === currentUser ? 'major' : 'minor';
    }
    // Web page events are Minor
    if (event.event_type === 'custom' && event.event_subtype === 'web_page') {
      return 'minor';
    }
    return 'minor';
  }

  // Get year only from date_sort (YYYYMMDD format)
  function getYear(event: TimelineEvent | TimelineEventWithSource): string {
    const dateSort = event.date_sort ?? 99999999;
    if (dateSort === 99999999) return '?';
    return String(Math.floor(dateSort / 10000));
  }

  function formatEstablishedLine(event: TimelineEvent | TimelineEventWithSource): string {
    const subtype = event.event_subtype || 'built';
    const label = subtypeLabels[subtype] || 'Built';
    const year = getYear(event);
    return `${year} - ${label}`;
  }

  function formatVisitLine(event: TimelineEvent | TimelineEventWithSource): string {
    const year = getYear(event);

    // Get media counts if available
    const counts = mediaCounts.get(event.event_id);
    const imgCount = counts?.images ?? 0;
    const vidCount = counts?.videos ?? 0;

    // Choose verb based on media type (KISS: Year - Event)
    if (imgCount > 0 && vidCount > 0) {
      return `${year} - Documented`;
    } else if (vidCount > 0) {
      return `${year} - Filmed`;
    } else if (imgCount > 0) {
      return `${year} - Photographed`;
    }
    return `${year} - Visited`;
  }

  function formatWebPageLine(event: TimelineEvent | TimelineEventWithSource): string {
    const date = event.date_display || '—';
    // OPT-120: Prefer smart_title (LLM-generated) over notes (raw web title)
    const title = event.smart_title || event.notes || 'Web Page';
    // Truncate long titles
    const truncatedTitle = title.length > 40 ? title.slice(0, 37) + '...' : title;
    return `${date} - Web: ${truncatedTitle}`;
  }

  function getWebPageTldr(event: TimelineEvent | TimelineEventWithSource): string | null {
    return event.tldr || null;
  }

  function formatDatabaseEntryLine(event: TimelineEvent | TimelineEventWithSource): string {
    if (!event.date_display) return '— - Added to Database';
    // Normalize to ISO 8601: YYYY-MM-DD
    const raw = event.date_display;
    let formatted = raw;
    if (raw.includes('T')) {
      formatted = raw.split('T')[0];
    }
    return `${formatted} - Added to Database`;
  }

  function handleWebPageClick(event: TimelineEvent | TimelineEventWithSource) {
    if (event.source_ref && onOpenWebSource) {
      onOpenWebSource(event.source_ref);
    }
  }

  function toggleExpanded() {
    expanded = !expanded;
  }
</script>

<!-- PLAN: Match LocationMapSection white card styling -->
<div class="bg-white rounded border border-braun-300 flex-1 flex flex-col">
  <!-- Header with expand button (same position as edit button in Location box) -->
  <div class="px-8 pt-6 pb-4 flex items-center justify-between">
    <h2 class="text-2xl font-semibold text-braun-900 leading-none">Timeline</h2>
    {#if onExpandClick}
      <button
        onclick={onExpandClick}
        class="text-sm text-braun-500 hover:text-braun-900 hover:underline"
        title="View full timeline in Research section"
      >
        expand
      </button>
    {/if}
  </div>

  <!-- Content - fills height, matches LocationMapSection section spacing -->
  <div class="px-8 pb-8 flex-1 flex flex-col">
    {#if loading}
      <div class="flex-1 flex items-center justify-center">
        <div class="text-braun-500 text-sm">Loading timeline...</div>
      </div>
    {:else if error}
      <div class="flex-1 flex items-center justify-center">
        <div class="text-red-600 text-sm">{error}</div>
      </div>
    {:else if sortedEvents.length === 0}
      <div class="flex-1 flex items-center justify-center">
        <div class="text-braun-500 text-sm">No timeline events</div>
      </div>
    {:else}
      <div class="timeline-events relative pl-6 py-4 flex-1 flex flex-col justify-between">
        <!-- Vertical line (8pt grid: 4px from left edge of pl-6 = centered on 8px dot) -->
        <div class="absolute left-[4px] top-4 bottom-4 w-px bg-braun-300"></div>

        <!-- Chronological event list - evenly distributed -->
        {#each displayEvents() as event (event.event_id)}
          <div class="relative">
            <!-- Filled 8px dot (centered on vertical line) -->
            <div class="absolute -left-6 top-[6px] w-2 h-2 rounded-full bg-braun-900"></div>
            <div class="text-[15px] font-medium text-braun-900">
              {#if event.event_type === 'established'}
                {formatEstablishedLine(event)}
              {:else}
                {formatVisitLine(event)}
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
