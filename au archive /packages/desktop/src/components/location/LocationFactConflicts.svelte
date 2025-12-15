<script lang="ts">
  /**
   * LocationFactConflicts - Display and resolve fact conflicts from multiple sources
   * Shows conflicting claims side-by-side with resolution workflow.
   * Per Braun: Functional colors, confidence indicators, clear action buttons
   */
  import { onMount } from 'svelte';
  import type { FactConflict, ConflictSummary, ConflictResolution } from '../../types/electron';

  interface Props {
    locid: string;
    onUpdate?: () => void;
  }

  let { locid, onUpdate }: Props = $props();

  let conflicts = $state<FactConflict[]>([]);
  let summary = $state<ConflictSummary | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showResolved = $state(false);
  let resolvingId = $state<string | null>(null);

  // Filter to show/hide resolved conflicts
  let visibleConflicts = $derived(
    showResolved ? conflicts : conflicts.filter(c => !c.resolution)
  );

  // Conflict type labels
  const typeLabels: Record<string, string> = {
    date: 'Date Conflict',
    name: 'Name Conflict',
    fact: 'Fact Conflict',
    attribution: 'Attribution Conflict',
    location: 'Location Conflict',
  };

  // Resolution labels
  const resolutionLabels: Record<string, string> = {
    source_a: 'Source A Correct',
    source_b: 'Source B Correct',
    both_valid: 'Both Valid',
    neither: 'Neither Correct',
    merged: 'Merged Values',
  };

  onMount(async () => {
    await loadConflicts();
  });

  $effect(() => {
    const _ = locid;
    loadConflicts();
  });

  async function loadConflicts() {
    if (!window.electronAPI?.extraction?.conflicts) {
      loading = false;
      return;
    }

    loading = true;
    error = null;

    try {
      const [conflictsResult, summaryResult] = await Promise.all([
        window.electronAPI.extraction.conflicts.getByLocation(locid, showResolved),
        window.electronAPI.extraction.conflicts.getSummary(locid),
      ]);

      if (conflictsResult.success && conflictsResult.conflicts) {
        conflicts = conflictsResult.conflicts;
      }

      if (summaryResult.success && summaryResult.summary) {
        summary = summaryResult.summary;
      }
    } catch (e) {
      console.error('Failed to load conflicts:', e);
      error = 'Failed to load fact conflicts';
    } finally {
      loading = false;
    }
  }

  async function resolveConflict(
    conflictId: string,
    resolution: ConflictResolution,
    resolvedValue: string | null
  ) {
    resolvingId = conflictId;
    try {
      const result = await window.electronAPI.extraction.conflicts.resolve(
        conflictId,
        resolution,
        resolvedValue,
        'current-user', // TODO: Get actual user ID
        undefined
      );

      if (result.success) {
        await loadConflicts();
        onUpdate?.();
      } else {
        error = result.error || 'Failed to resolve conflict';
      }
    } catch (e) {
      console.error('Failed to resolve conflict:', e);
      error = 'Failed to resolve conflict';
    } finally {
      resolvingId = null;
    }
  }

  async function getSuggestion(conflictId: string) {
    try {
      const result = await window.electronAPI.extraction.conflicts.suggestResolution(conflictId);
      if (result.success && result.suggestion) {
        return result.suggestion;
      }
    } catch (e) {
      console.error('Failed to get suggestion:', e);
    }
    return null;
  }

  function getConfidenceClass(confidence: number): string {
    if (confidence >= 0.85) return 'bg-[#4A8C5E]';
    if (confidence >= 0.5) return 'bg-[#C9A227]';
    return 'bg-[#B85C4A]';
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString();
  }

  function getDomainFromRef(sourceRef: string): string {
    try {
      const url = new URL(sourceRef);
      return url.hostname;
    } catch {
      return sourceRef.substring(0, 30);
    }
  }
</script>

{#if loading}
  <div class="py-4 text-sm text-braun-500">Loading conflicts...</div>
{:else if error}
  <div class="py-4 text-sm text-[#B85C4A]">{error}</div>
{:else if summary && summary.totalConflicts > 0}
  <div class="bg-white rounded border border-braun-300 mb-8">
    <!-- Header with summary -->
    <div class="px-8 pt-6 pb-4 border-b border-braun-200">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-2xl font-semibold text-braun-900 leading-none">Fact Conflicts</h2>
          <p class="text-sm text-braun-500 mt-2">
            {summary.unresolvedConflicts} unresolved of {summary.totalConflicts} total conflicts
          </p>
        </div>
        <div class="flex items-center gap-4">
          <label class="flex items-center gap-2 text-sm text-braun-600">
            <input
              type="checkbox"
              bind:checked={showResolved}
              onchange={loadConflicts}
              class="rounded border-braun-300"
            />
            Show resolved
          </label>
        </div>
      </div>
    </div>

    <!-- Conflict list -->
    <div class="divide-y divide-braun-200">
      {#each visibleConflicts as conflict (conflict.conflict_id)}
        <div class="px-8 py-6">
          <!-- Conflict header -->
          <div class="flex items-center gap-3 mb-4">
            <span class="px-2 py-1 text-xs font-medium uppercase tracking-wide rounded
              {conflict.resolution ? 'bg-braun-100 text-braun-600' : 'bg-[#B85C4A]/10 text-[#B85C4A]'}">
              {typeLabels[conflict.conflict_type] || conflict.conflict_type}
            </span>
            <span class="text-sm text-braun-600">
              Field: <strong>{conflict.field_name}</strong>
            </span>
            {#if conflict.resolution}
              <span class="ml-auto text-xs text-braun-500">
                Resolved: {resolutionLabels[conflict.resolution]}
              </span>
            {/if}
          </div>

          <!-- Claims comparison -->
          <div class="grid grid-cols-2 gap-6">
            <!-- Claim A -->
            <div class="p-4 rounded border border-braun-200 {conflict.resolution === 'source_a' ? 'ring-2 ring-[#4A8C5E]' : ''}">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-medium uppercase tracking-wide text-braun-500">Source A</span>
                <span
                  class="w-2 h-2 rounded-full {getConfidenceClass(conflict.claim_a.confidence)}"
                  title="Confidence: {Math.round(conflict.claim_a.confidence * 100)}%"
                ></span>
              </div>
              <p class="text-[15px] font-medium text-braun-900 mb-2">
                "{conflict.claim_a.value}"
              </p>
              <p class="text-xs text-braun-500">
                {getDomainFromRef(conflict.claim_a.source_ref)}
                <span class="mx-1">·</span>
                {formatDate(conflict.claim_a.extracted_at)}
              </p>
              {#if !conflict.resolution}
                <button
                  onclick={() => resolveConflict(conflict.conflict_id, 'source_a', conflict.claim_a.value)}
                  disabled={resolvingId === conflict.conflict_id}
                  class="mt-3 px-3 py-1.5 text-xs font-medium rounded border border-braun-300 hover:bg-braun-50 transition-colors disabled:opacity-50"
                >
                  Use This
                </button>
              {/if}
            </div>

            <!-- Claim B -->
            <div class="p-4 rounded border border-braun-200 {conflict.resolution === 'source_b' ? 'ring-2 ring-[#4A8C5E]' : ''}">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-medium uppercase tracking-wide text-braun-500">Source B</span>
                <span
                  class="w-2 h-2 rounded-full {getConfidenceClass(conflict.claim_b.confidence)}"
                  title="Confidence: {Math.round(conflict.claim_b.confidence * 100)}%"
                ></span>
              </div>
              <p class="text-[15px] font-medium text-braun-900 mb-2">
                "{conflict.claim_b.value}"
              </p>
              <p class="text-xs text-braun-500">
                {getDomainFromRef(conflict.claim_b.source_ref)}
                <span class="mx-1">·</span>
                {formatDate(conflict.claim_b.extracted_at)}
              </p>
              {#if !conflict.resolution}
                <button
                  onclick={() => resolveConflict(conflict.conflict_id, 'source_b', conflict.claim_b.value)}
                  disabled={resolvingId === conflict.conflict_id}
                  class="mt-3 px-3 py-1.5 text-xs font-medium rounded border border-braun-300 hover:bg-braun-50 transition-colors disabled:opacity-50"
                >
                  Use This
                </button>
              {/if}
            </div>
          </div>

          <!-- Additional resolution options -->
          {#if !conflict.resolution}
            <div class="mt-4 flex items-center gap-3">
              <button
                onclick={() => resolveConflict(conflict.conflict_id, 'both_valid', null)}
                disabled={resolvingId === conflict.conflict_id}
                class="px-3 py-1.5 text-xs font-medium rounded border border-braun-300 hover:bg-braun-50 transition-colors disabled:opacity-50"
              >
                Both Valid
              </button>
              <button
                onclick={() => resolveConflict(conflict.conflict_id, 'neither', null)}
                disabled={resolvingId === conflict.conflict_id}
                class="px-3 py-1.5 text-xs font-medium text-[#B85C4A] rounded border border-[#B85C4A]/30 hover:bg-[#B85C4A]/5 transition-colors disabled:opacity-50"
              >
                Neither Correct
              </button>
              {#if resolvingId === conflict.conflict_id}
                <span class="text-xs text-braun-500 ml-auto">Resolving...</span>
              {/if}
            </div>
          {:else if conflict.resolved_value}
            <div class="mt-4 p-3 bg-braun-50 rounded">
              <p class="text-xs text-braun-500 mb-1">Resolved Value:</p>
              <p class="text-sm font-medium text-braun-900">{conflict.resolved_value}</p>
              {#if conflict.resolution_notes}
                <p class="text-xs text-braun-500 mt-2">{conflict.resolution_notes}</p>
              {/if}
            </div>
          {/if}
        </div>
      {/each}

      {#if visibleConflicts.length === 0}
        <div class="px-8 py-6 text-sm text-braun-500">
          {showResolved ? 'No conflicts found' : 'All conflicts resolved!'}
        </div>
      {/if}
    </div>
  </div>
{/if}
