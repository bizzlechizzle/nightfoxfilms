<script lang="ts">
  /**
   * TimelineDateInput - Smart date input with auto-detection
   * Per PLAN-timeline-feature: Braun approach - progressive disclosure
   * "Start with what you know. Never force false precision."
   */
  import type { ParsedDate, DatePrecision } from '@au-archive/core';
  import { onMount } from 'svelte';

  interface Props {
    initialValue?: string;
    initialSubtype?: string;
    placeholder?: string;
    onSave: (dateInput: string, eventSubtype: string) => void;
    onCancel?: () => void;
  }

  let {
    initialValue = '',
    initialSubtype = 'built',
    placeholder = 'Enter date...',
    onSave,
    onCancel
  }: Props = $props();

  // Input state
  let dateInput = $state(initialValue);
  let subtype = $state(initialSubtype);
  let parsedDate = $state<ParsedDate | null>(null);
  let showPrecisionDropdown = $state(false);
  let debounceTimer: NodeJS.Timeout | null = null;

  // Precision options for dropdown override
  const precisionOptions: { value: DatePrecision; label: string }[] = [
    { value: 'exact', label: 'Exact Date' },
    { value: 'month', label: 'Month' },
    { value: 'year', label: 'Year' },
    { value: 'decade', label: 'Decade' },
    { value: 'century', label: 'Century' },
    { value: 'circa', label: 'Circa (approx)' },
    { value: 'range', label: 'Range' },
    { value: 'before', label: 'Before' },
    { value: 'after', label: 'After' },
    { value: 'early', label: 'Early period' },
    { value: 'mid', label: 'Mid period' },
    { value: 'late', label: 'Late period' },
    { value: 'unknown', label: 'Unknown' }
  ];

  // Subtype options for established events
  const subtypeOptions = [
    { value: 'built', label: 'Built' },
    { value: 'opened', label: 'Opened' },
    { value: 'expanded', label: 'Expanded' },
    { value: 'renovated', label: 'Renovated' },
    { value: 'closed', label: 'Closed' },
    { value: 'abandoned', label: 'Abandoned' },
    { value: 'demolished', label: 'Demolished' }
  ];

  // Parse date as user types (debounced)
  $effect(() => {
    if (debounceTimer) clearTimeout(debounceTimer);

    if (!dateInput.trim()) {
      parsedDate = null;
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        parsedDate = await window.electronAPI.timeline.parseDate(dateInput);
      } catch (e) {
        console.error('Failed to parse date:', e);
        parsedDate = null;
      }
    }, 300);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });

  // Parse on mount if initial value provided
  onMount(async () => {
    if (initialValue) {
      try {
        parsedDate = await window.electronAPI.timeline.parseDate(initialValue);
      } catch (e) {
        console.error('Failed to parse initial date:', e);
      }
    }
  });

  function handleSave() {
    onSave(dateInput, subtype);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape' && onCancel) {
      onCancel();
    }
  }

  function getPrecisionDescription(precision: DatePrecision): string {
    const descriptions: Record<DatePrecision, string> = {
      exact: 'Full date',
      month: 'Month and year',
      year: 'Year only',
      decade: 'Decade range',
      century: 'Century',
      circa: 'Approximate',
      range: 'Date range',
      before: 'Upper bound',
      after: 'Lower bound',
      early: 'First third of decade',
      mid: 'Middle of decade',
      late: 'Last third of decade',
      unknown: 'No date'
    };
    return descriptions[precision] || precision;
  }
</script>

<div class="date-input-container">
  <!-- Main input row -->
  <div class="flex gap-2 items-start">
    <!-- Date input -->
    <div class="flex-1">
      <input
        type="text"
        bind:value={dateInput}
        onkeydown={handleKeydown}
        {placeholder}
        class="w-full px-2 py-1.5 text-[14px] border border-braun-300 rounded
               focus:outline-none focus:ring-1 focus:ring-braun-400 focus:border-braun-400
               bg-white text-braun-900 placeholder:text-braun-400"
      />

      <!-- Feedback line (Braun: honest, self-explanatory) -->
      {#if parsedDate && parsedDate.precision !== 'unknown'}
        <div class="mt-1 text-[12px] text-braun-500">
          Interpreted as: {parsedDate.display}
          <span class="text-braun-400">({getPrecisionDescription(parsedDate.precision)})</span>
        </div>
      {:else if dateInput.trim() && parsedDate?.precision === 'unknown'}
        <div class="mt-1 text-[12px] text-amber-600">
          Could not parse date format
        </div>
      {/if}
    </div>

    <!-- Subtype dropdown (for established events) -->
    <select
      bind:value={subtype}
      class="px-2 py-1.5 text-[13px] border border-braun-300 rounded
             focus:outline-none focus:ring-1 focus:ring-braun-400
             bg-white text-braun-700"
    >
      {#each subtypeOptions as option}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </div>

  <!-- Example formats hint -->
  <div class="mt-2 text-[11px] text-braun-400">
    Examples: 1920, 1920s, early 1900s, ca 1920, 1920-1925, before 1950
  </div>

  <!-- Action buttons -->
  <div class="flex gap-2 mt-2">
    <button
      type="button"
      onclick={handleSave}
      class="px-3 py-1 text-[12px] font-medium bg-braun-800 text-white rounded
             hover:bg-braun-900 transition-colors"
    >
      Save
    </button>
    {#if onCancel}
      <button
        type="button"
        onclick={onCancel}
        class="px-3 py-1 text-[12px] font-medium text-braun-600 hover:text-braun-900
               transition-colors"
      >
        Cancel
      </button>
    {/if}
  </div>
</div>

<style>
  .date-input-container {
    max-width: 400px;
  }
</style>
