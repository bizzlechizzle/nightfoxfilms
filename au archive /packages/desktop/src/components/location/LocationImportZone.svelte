<script lang="ts">
  /**
   * LocationImportZone - Drag-drop zone, progress, GPS warnings
   * Per LILBITS: ~200 lines, single responsibility
   */
  import type { GpsWarning, FailedFile } from './types';
  import { importProgress as storeProgress, isImporting as storeIsImporting, importStore } from '../../stores/import-store';

  interface Props {
    isImporting: boolean;
    isDragging: boolean;
    gpsWarnings: GpsWarning[];
    failedFiles: FailedFile[];
    scopeLabel?: string | null; // e.g., "Campus-Level" for host locations
    onDragOver: (e: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: DragEvent) => void;
    onSelectFiles: () => void;
    onRetryFailed: () => void;
    onDismissWarning: (index: number) => void;
    onDismissAllWarnings: () => void;
  }

  let {
    isImporting, isDragging, gpsWarnings, failedFiles,
    scopeLabel = null,
    onDragOver, onDragLeave, onDrop, onSelectFiles, onRetryFailed,
    onDismissWarning, onDismissAllWarnings
  }: Props = $props();
</script>

<div
  class="mt-6 bg-white rounded border border-braun-300 p-6"
  data-import-zone
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  role="region"
  aria-label="Media import zone"
>
  <div class="flex items-center justify-between mb-3">
    <h2 class="text-xl font-semibold text-braun-900">Import</h2>
    {#if failedFiles.length > 0}
      <button
        onclick={onRetryFailed}
        class="text-sm text-error hover:opacity-80 hover:underline"
      >
        Retry {failedFiles.length} failed
      </button>
    {/if}
  </div>

  <!-- GPS Mismatch Warnings -->
  {#if gpsWarnings.length > 0}
    <div class="mb-3 p-4 bg-gps-medium/10 border border-gps-medium/20 rounded">
      <div class="flex items-start gap-3">
        <svg class="w-5 h-5 text-gps-medium mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div class="flex-1">
          <h4 class="text-sm font-semibold text-gps-medium mb-2">GPS Mismatch Detected</h4>
          <p class="text-xs text-gps-medium mb-3">
            Some imported files have GPS coordinates that differ from this location.
          </p>
          <div class="space-y-2">
            {#each gpsWarnings as warning, index}
              <div class="flex items-center justify-between bg-white/50 rounded p-2 text-xs">
                <div>
                  <span class="font-medium text-gps-medium">{warning.filename}</span>
                  <span class="text-gps-medium ml-2">
                    {warning.message}
                    <span class="inline-block ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium
                      {warning.severity === 'major' ? 'bg-error/10 text-error' : 'bg-gps-medium/10 text-gps-medium'}">
                      {warning.severity}
                    </span>
                  </span>
                </div>
                <button
                  onclick={() => onDismissWarning(index)}
                  class="p-1 text-gps-medium hover:text-gps-medium"
                  title="Dismiss warning"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            {/each}
          </div>
          <button
            onclick={onDismissAllWarnings}
            class="mt-2 text-xs text-gps-medium hover:text-gps-medium underline"
          >
            Dismiss all warnings
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Drag-drop zone -->
  <div
    class="p-6 border-2 border-dashed rounded text-center transition-colors {isDragging ? 'border-braun-900 bg-braun-100' : 'border-braun-300 hover:border-braun-400'}"
  >
    {#if $storeIsImporting && $storeProgress}
      <!-- Clean Braun progress bar -->
      <div class="text-left">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium text-braun-700">Importing</span>
          <button
            onclick={() => importStore.cancelImport()}
            class="text-xs text-braun-500 hover:text-braun-700"
          >
            Cancel
          </button>
        </div>
        <!-- OPT-105: Granular progress bar with current file display -->
        <div class="relative h-6 bg-braun-200 rounded overflow-hidden">
          <div
            class="absolute inset-y-0 left-0 bg-braun-900 transition-[width] duration-100 ease-out"
            style="width: {$storeProgress.percent}%"
          ></div>
          <div class="absolute inset-0 flex items-center justify-center">
            <span class="text-xs font-medium text-white mix-blend-difference">
              {$storeProgress.current}/{$storeProgress.total} · {$storeProgress.percent}%
            </span>
          </div>
        </div>
        {#if $storeProgress.currentFilename}
          <p class="mt-1 text-xs text-braun-500 truncate" title={$storeProgress.currentFilename}>
            {$storeProgress.currentFilename}
          </p>
        {/if}
      </div>
    {:else}
      <svg class="w-10 h-10 mx-auto mb-2 text-braun-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
      <p class="text-sm text-braun-500">
        {isDragging
          ? 'Drop files or folders here'
          : scopeLabel
            ? `Drag & drop files to import to ${scopeLabel}`
            : 'Drag & drop files or folders to import'}
      </p>
      <p class="text-xs text-braun-400 mt-1">Supports images, videos, and documents</p>
      <button
        onclick={onSelectFiles}
        class="mt-3 px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition text-sm"
      >
        Select Files
      </button>
    {/if}
  </div>
</div>
