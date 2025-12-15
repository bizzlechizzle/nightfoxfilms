<script lang="ts">
  /**
   * CaptureProgress.svelte - OPT-121
   *
   * Shows the progress and status of web source capture.
   * Displays checklist of completed/pending/failed components.
   * Handles partial captures gracefully with clear user messaging.
   */

  export let sourceId: string;
  export let status: CaptureStatus;

  interface CaptureItem {
    key: string;
    label: string;
    status: 'done' | 'pending' | 'failed' | 'skipped';
    note?: string;
    source?: 'extension' | 'puppeteer';
  }

  interface CaptureStatus {
    phase: 'pending' | 'capturing' | 'partial' | 'complete' | 'failed';
    title: string;
    items: CaptureItem[];
    warning?: string;
    error?: string;
    puppeteerBlocked?: boolean;
    extensionDataAvailable?: boolean;
  }

  // Status icons
  const icons: Record<string, string> = {
    done: '✓',
    pending: '○',
    failed: '✗',
    skipped: '–',
  };

  // Phase colors
  const phaseColors: Record<string, string> = {
    pending: 'text-gray-500',
    capturing: 'text-blue-500',
    partial: 'text-amber-500',
    complete: 'text-green-500',
    failed: 'text-red-500',
  };

  // Phase icons
  const phaseIcons: Record<string, string> = {
    pending: '○',
    capturing: '↻',
    partial: '◐',
    complete: '✓',
    failed: '✗',
  };
</script>

<div class="capture-progress rounded-lg border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 p-4">
  <!-- Header -->
  <div class="flex items-center gap-2 mb-3">
    <span class="text-lg {phaseColors[status.phase]}">{phaseIcons[status.phase]}</span>
    <span class="font-medium text-surface-900 dark:text-surface-100">{status.title}</span>
  </div>

  <!-- Checklist -->
  <div class="space-y-2">
    {#each status.items as item}
      <div
        class="flex items-center gap-2 text-sm"
        class:text-green-600={item.status === 'done'}
        class:text-surface-500={item.status === 'pending'}
        class:text-red-500={item.status === 'failed'}
        class:text-surface-400={item.status === 'skipped'}
      >
        <span class="w-4">{icons[item.status]}</span>
        <span class="flex-1">
          {item.label}
          {#if item.source === 'extension'}
            <span class="text-xs text-surface-400 ml-1">(from your browser)</span>
          {/if}
        </span>
        {#if item.note}
          <span class="text-xs text-surface-400">{item.note}</span>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Warning message for partial captures -->
  {#if status.warning}
    <div class="mt-3 p-2 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
      <p class="text-xs text-amber-700 dark:text-amber-300">
        {status.warning}
      </p>
    </div>
  {/if}

  <!-- Error message -->
  {#if status.error}
    <div class="mt-3 p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700">
      <p class="text-xs text-red-700 dark:text-red-300">
        {status.error}
      </p>
    </div>
  {/if}

  <!-- Puppeteer blocked notice -->
  {#if status.puppeteerBlocked && status.extensionDataAvailable}
    <div class="mt-3 p-2 rounded bg-surface-100 dark:bg-surface-700 border border-surface-200 dark:border-surface-600">
      <p class="text-xs text-surface-600 dark:text-surface-300">
        This site blocks automated archiving. The content captured from your browser session is preserved.
      </p>
    </div>
  {/if}
</div>

<style>
  .capture-progress {
    max-width: 400px;
  }
</style>
