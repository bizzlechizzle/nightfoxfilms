<script lang="ts">
  /**
   * DateExtractionReview - Per-location date extraction review panel
   * Migration 73: Date Engine - NLP date extraction from web sources
   *
   * Premium UX Features:
   * - Keyboard shortcuts: j/k navigate, a approve, r reject, Enter convert
   * - Visual confidence indicators with color-coded badges
   * - Inline context display with highlighted dates
   * - One-click approval workflow
   * - Conflict resolution UI
   * - Duplicate detection badges
   */
  import { onMount, onDestroy } from 'svelte';
  import type { DateExtraction } from '@au-archive/core';

  interface Props {
    locid: string;
    subid?: string | null;
    onUpdate?: () => void;
  }
  let { locid, subid = null, onUpdate }: Props = $props();

  // State
  let extractions = $state<DateExtraction[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let selectedIndex = $state(0);
  let processing = $state<string | null>(null);
  let currentUser = $state('default');
  let expanded = $state(true);

  // Statistics
  let stats = $state<{
    pending: number;
    approved: number;
    rejected: number;
    converted: number;
  } | null>(null);

  // Category labels and colors
  const categoryColors: Record<string, string> = {
    build_date: 'bg-blue-100 text-blue-800 border-blue-200',
    site_visit: 'bg-green-100 text-green-800 border-green-200',
    obituary: 'bg-gray-100 text-gray-800 border-gray-200',
    publication: 'bg-purple-100 text-purple-800 border-purple-200',
    closure: 'bg-red-100 text-red-800 border-red-200',
    opening: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    demolition: 'bg-orange-100 text-orange-800 border-orange-200',
    unknown: 'bg-braun-100 text-braun-800 border-braun-200',
  };

  const categoryLabels: Record<string, string> = {
    build_date: 'Built',
    site_visit: 'Visit',
    obituary: 'Obituary',
    publication: 'Published',
    closure: 'Closed',
    opening: 'Opened',
    demolition: 'Demolished',
    unknown: 'Unknown',
  };

  // Confidence color based on score
  function getConfidenceColor(confidence: number): string {
    if (confidence >= 0.8) return 'text-green-600';
    if (confidence >= 0.6) return 'text-yellow-600';
    if (confidence >= 0.4) return 'text-orange-600';
    return 'text-red-600';
  }

  // Status badge colors
  function getStatusBadge(status: string): string {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'auto_approved': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'user_approved': return 'bg-green-100 text-green-800 border-green-200';
      case 'rejected': return 'bg-red-100 text-red-800 border-red-200';
      case 'converted': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'reverted': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-braun-100 text-braun-800 border-braun-200';
    }
  }

  // Load extractions for this location
  async function loadExtractions() {
    try {
      loading = true;
      error = null;

      const results = await window.electronAPI.dateEngine.getByLocation(locid, {
        status: 'pending',
      });

      extractions = results || [];

      // Reset selection if out of bounds
      if (selectedIndex >= extractions.length) {
        selectedIndex = Math.max(0, extractions.length - 1);
      }
    } catch (err) {
      console.error('Error loading date extractions:', err);
      error = err instanceof Error ? err.message : 'Failed to load extractions';
    } finally {
      loading = false;
    }
  }

  // Approve extraction
  async function handleApprove(extractionId: string) {
    try {
      processing = extractionId;
      await window.electronAPI.dateEngine.approve(extractionId, currentUser);
      await loadExtractions();
      onUpdate?.();
    } catch (err) {
      console.error('Error approving extraction:', err);
    } finally {
      processing = null;
    }
  }

  // Reject extraction
  async function handleReject(extractionId: string, reason?: string) {
    try {
      processing = extractionId;
      await window.electronAPI.dateEngine.reject(extractionId, currentUser, reason);
      await loadExtractions();
      onUpdate?.();
    } catch (err) {
      console.error('Error rejecting extraction:', err);
    } finally {
      processing = null;
    }
  }

  // Convert to timeline
  async function handleConvert(extractionId: string) {
    try {
      processing = extractionId;
      await window.electronAPI.dateEngine.convertToTimeline(extractionId, currentUser);
      await loadExtractions();
      onUpdate?.();
    } catch (err) {
      console.error('Error converting extraction:', err);
    } finally {
      processing = null;
    }
  }

  // Approve and resolve conflict
  async function handleResolveConflict(extractionId: string, updateTimeline: boolean) {
    try {
      processing = extractionId;
      await window.electronAPI.dateEngine.approveAndResolveConflict(
        extractionId,
        currentUser,
        updateTimeline
      );
      await loadExtractions();
      onUpdate?.();
    } catch (err) {
      console.error('Error resolving conflict:', err);
    } finally {
      processing = null;
    }
  }

  // Keyboard navigation
  function handleKeydown(event: KeyboardEvent) {
    if (!expanded || extractions.length === 0) return;

    switch (event.key) {
      case 'j':
        event.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, extractions.length - 1);
        break;
      case 'k':
        event.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        break;
      case 'a':
        event.preventDefault();
        if (extractions[selectedIndex]) {
          handleApprove(extractions[selectedIndex].extraction_id);
        }
        break;
      case 'r':
        event.preventDefault();
        if (extractions[selectedIndex]) {
          handleReject(extractions[selectedIndex].extraction_id);
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (extractions[selectedIndex]?.status === 'user_approved' ||
            extractions[selectedIndex]?.status === 'auto_approved') {
          handleConvert(extractions[selectedIndex].extraction_id);
        }
        break;
      case 'Escape':
        event.preventDefault();
        expanded = false;
        break;
    }
  }

  // Highlight date in sentence
  function highlightDate(sentence: string, rawText: string): string {
    if (!rawText) return sentence;
    const escaped = rawText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return sentence.replace(
      new RegExp(`(${escaped})`, 'gi'),
      '<mark class="bg-yellow-200 px-0.5 rounded">$1</mark>'
    );
  }

  onMount(async () => {
    await loadExtractions();

    // Get current user
    try {
      const settings = await window.electronAPI.settings.getAll();
      currentUser = settings.current_user || 'default';
    } catch (err) {
      console.error('Error loading user:', err);
    }

    // Add keyboard listener
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
  });

  // Reactive reload when locid changes
  $effect(() => {
    const _locid = locid;
    loadExtractions();
  });
</script>

<!-- Date Extraction Review Panel -->
{#if extractions.length > 0 || loading}
  <section class="mb-8">
    <button
      onclick={() => expanded = !expanded}
      class="w-full flex items-center justify-between px-4 py-3 bg-braun-50 border border-braun-200 rounded hover:bg-braun-100 transition"
    >
      <div class="flex items-center gap-3">
        <svg
          class="w-5 h-5 text-braun-600 transition-transform {expanded ? 'rotate-90' : ''}"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
        <span class="font-medium text-braun-900">Date Extractions</span>
        {#if extractions.length > 0}
          <span class="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 border border-yellow-200 rounded-full">
            {extractions.length} pending
          </span>
        {/if}
      </div>
      <span class="text-xs text-braun-500">j/k a/r Enter</span>
    </button>

    {#if expanded}
      <div class="border border-t-0 border-braun-200 rounded-b bg-white">
        {#if loading}
          <div class="p-6 text-center text-braun-500">Loading extractions...</div>
        {:else if error}
          <div class="p-6 text-center text-red-500">{error}</div>
        {:else if extractions.length === 0}
          <div class="p-6 text-center text-braun-500">No pending date extractions</div>
        {:else}
          <div class="divide-y divide-braun-100">
            {#each extractions as extraction, index}
              {@const isSelected = index === selectedIndex}
              {@const isProcessing = processing === extraction.extraction_id}
              <div
                class="p-4 transition {isSelected ? 'bg-blue-50' : 'hover:bg-braun-50'}"
                onclick={() => selectedIndex = index}
                role="button"
                tabindex={0}
              >
                <!-- Header Row: Date + Category + Confidence -->
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <!-- Parsed Date -->
                    <span class="font-semibold text-braun-900 text-lg">
                      {extraction.date_display || extraction.parsed_date || extraction.raw_text}
                    </span>

                    <!-- Category Badge -->
                    <span class="px-2 py-0.5 text-xs border rounded {categoryColors[extraction.category] || categoryColors.unknown}">
                      {categoryLabels[extraction.category] || extraction.category}
                    </span>

                    <!-- Confidence Score -->
                    <span class="text-sm {getConfidenceColor(extraction.overall_confidence)}">
                      {Math.round(extraction.overall_confidence * 100)}%
                    </span>

                    <!-- Status Badge -->
                    <span class="px-2 py-0.5 text-xs border rounded {getStatusBadge(extraction.status)}">
                      {extraction.status.replace('_', ' ')}
                    </span>

                    <!-- Conflict Warning -->
                    {#if extraction.conflict_event_id && !extraction.conflict_resolved}
                      <span class="px-2 py-0.5 text-xs bg-orange-100 text-orange-800 border border-orange-200 rounded">
                        Conflict
                      </span>
                    {/if}

                    <!-- Duplicate Badge -->
                    {#if extraction.is_primary === 0}
                      <span class="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 border border-gray-200 rounded">
                        Duplicate
                      </span>
                    {:else if extraction.merged_from_ids}
                      {@const mergedCount = JSON.parse(extraction.merged_from_ids || '[]').length}
                      {#if mergedCount > 0}
                        <span class="px-2 py-0.5 text-xs bg-blue-100 text-blue-600 border border-blue-200 rounded">
                          +{mergedCount} sources
                        </span>
                      {/if}
                    {/if}

                    <!-- Relative Date Indicator -->
                    {#if extraction.was_relative_date}
                      <span class="text-xs text-braun-500" title="Anchored to article date {extraction.article_date}">
                        ~relative
                      </span>
                    {/if}

                    <!-- Century Bias Indicator -->
                    {#if extraction.century_bias_applied}
                      <span class="text-xs text-braun-500" title="Historical year bias applied">
                        1900s
                      </span>
                    {/if}
                  </div>

                  <!-- Action Buttons -->
                  <div class="flex items-center gap-2">
                    {#if extraction.status === 'pending'}
                      {#if extraction.conflict_event_id && !extraction.conflict_resolved}
                        <!-- Conflict Resolution Buttons -->
                        <button
                          onclick={(e) => { e.stopPropagation(); handleResolveConflict(extraction.extraction_id, true); }}
                          disabled={isProcessing}
                          class="px-3 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 transition disabled:opacity-50"
                          title="Approve and update existing timeline event"
                        >
                          Update Timeline
                        </button>
                        <button
                          onclick={(e) => { e.stopPropagation(); handleResolveConflict(extraction.extraction_id, false); }}
                          disabled={isProcessing}
                          class="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition disabled:opacity-50"
                          title="Approve but keep existing timeline event"
                        >
                          Keep Existing
                        </button>
                      {:else}
                        <!-- Standard Approve/Reject -->
                        <button
                          onclick={(e) => { e.stopPropagation(); handleApprove(extraction.extraction_id); }}
                          disabled={isProcessing}
                          class="px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 transition disabled:opacity-50"
                          title="Approve (a)"
                        >
                          {isProcessing ? '...' : 'Approve'}
                        </button>
                      {/if}
                      <button
                        onclick={(e) => { e.stopPropagation(); handleReject(extraction.extraction_id); }}
                        disabled={isProcessing}
                        class="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition disabled:opacity-50"
                        title="Reject (r)"
                      >
                        Reject
                      </button>
                    {:else if extraction.status === 'user_approved' || extraction.status === 'auto_approved'}
                      <button
                        onclick={(e) => { e.stopPropagation(); handleConvert(extraction.extraction_id); }}
                        disabled={isProcessing}
                        class="px-3 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 transition disabled:opacity-50"
                        title="Convert to timeline (Enter)"
                      >
                        {isProcessing ? '...' : 'Add to Timeline'}
                      </button>
                    {/if}
                  </div>
                </div>

                <!-- Context Sentence -->
                <p class="text-sm text-braun-700 leading-relaxed">
                  {@html highlightDate(extraction.sentence, extraction.raw_text)}
                </p>

                <!-- Source Info -->
                <div class="mt-2 flex items-center gap-4 text-xs text-braun-500">
                  <span>Source: {extraction.source_type.replace('_', ' ')}</span>
                  {#if extraction.article_date}
                    <span>Article: {extraction.article_date}</span>
                  {/if}
                  {#if extraction.category_keywords}
                    {@const keywords = JSON.parse(extraction.category_keywords || '[]')}
                    {#if keywords.length > 0}
                      <span>Keywords: {keywords.join(', ')}</span>
                    {/if}
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </section>
{/if}
