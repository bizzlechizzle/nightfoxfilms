<script lang="ts">
  /**
   * ImportProgressBox - Global floating import progress indicator
   * Styled like the Details card on CoupleDetail page
   * Appears during file imports, visible on all pages
   */
  import type { ImportProgress } from '../lib/types';

  interface Props {
    progress: ImportProgress;
    oncancel?: () => void;
  }

  const { progress, oncancel }: Props = $props();

  const percentage = $derived(
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  );

  // Truncate long filenames for display
  const displayFilename = $derived(() => {
    const name = progress.filename || '';
    if (name.length > 40) {
      return '...' + name.slice(-37);
    }
    return name;
  });
</script>

<div class="import-progress-box">
  <div class="progress-header">
    <h3 class="progress-title">Importing</h3>
    {#if oncancel}
      <button class="btn-cancel" onclick={oncancel}>Cancel</button>
    {/if}
  </div>

  <div class="progress-bar-container">
    <div class="progress-bar" style="width: {percentage}%"></div>
  </div>

  <div class="progress-details">
    <span class="progress-count">{progress.current} of {progress.total}</span>
    <span class="progress-percentage">{percentage}%</span>
  </div>

  <div class="progress-file">
    <span class="file-name">{displayFilename()}</span>
    <span class="file-status">{progress.status}</span>
  </div>
</div>

<style>
  .import-progress-box {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .progress-title {
    margin: 0;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }

  .btn-cancel {
    padding: 0.25rem 0.5rem;
    font-size: 0.6875rem;
    font-family: inherit;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-cancel:hover {
    border-color: var(--color-status-error);
    color: var(--color-status-error);
  }

  .progress-bar-container {
    height: 6px;
    background: var(--color-bg-alt, #f0f0f0);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 0.5rem;
  }

  .progress-bar {
    height: 100%;
    background: var(--color-status-success, #047857);
    transition: width 0.2s ease-out;
    border-radius: 3px;
  }

  .progress-details {
    display: flex;
    justify-content: space-between;
    font-size: 0.875rem;
    margin-bottom: 0.25rem;
  }

  .progress-count {
    color: var(--color-text);
    font-weight: 500;
  }

  .progress-percentage {
    color: var(--color-text-muted);
  }

  .progress-file {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-right: 1rem;
  }

  .file-status {
    text-transform: capitalize;
    flex-shrink: 0;
  }
</style>
