<script lang="ts">
  import { getAPI, formatBytes, getDroppedPaths } from '../lib/api';
  import type { Couple, ImportProgress, DirectoryScanResult } from '../lib/types';

  const api = getAPI();

  let couples = $state<Couple[]>([]);
  let selectedCoupleId = $state<number | undefined>(undefined);
  let scanResult = $state<DirectoryScanResult | null>(null);
  let importing = $state(false);
  let progress = $state<ImportProgress | null>(null);
  let importResult = $state<{ imported: number; duplicates: number; errors: number } | null>(null);
  let droppedFiles = $state<string[]>([]);

  $effect(() => {
    loadCouples();
    setupListeners();
  });

  async function loadCouples() {
    try {
      couples = await api.couples.findAll();
    } catch (error) {
      console.error('Failed to load couples:', error);
    }
  }

  function setupListeners() {
    // Listen for import progress
    const unsubProgress = api.import.onProgress((p) => {
      progress = p;
    });

    // Listen for import completion
    const unsubComplete = api.import.onComplete((result) => {
      importing = false;
      progress = null;
      importResult = {
        imported: result.imported,
        duplicates: result.duplicates,
        errors: result.errors,
      };
    });

    return () => {
      unsubProgress();
      unsubComplete();
    };
  }

  async function selectFolder() {
    try {
      const folder = await api.dialog.selectFolder();
      if (folder) {
        scanResult = await api.import.scan(folder);
      }
    } catch (error) {
      console.error('Failed to scan folder:', error);
    }
  }

  async function selectFiles() {
    try {
      const files = await api.dialog.selectFiles();
      if (files.length > 0) {
        droppedFiles = files;
        scanResult = null;
      }
    } catch (error) {
      console.error('Failed to select files:', error);
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    const paths = getDroppedPaths();
    if (paths.length > 0) {
      droppedFiles = paths;
      scanResult = null;
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
  }

  async function startImport() {
    if (importing) return;

    importing = true;
    importResult = null;
    progress = null;

    try {
      if (droppedFiles.length > 0) {
        await api.import.files(droppedFiles, selectedCoupleId);
      } else if (scanResult) {
        await api.import.files(scanResult.files, selectedCoupleId);
      }
    } catch (error) {
      console.error('Import failed:', error);
      importing = false;
    }
  }

  async function cancelImport() {
    await api.import.cancel();
    importing = false;
    progress = null;
  }

  function clearSelection() {
    droppedFiles = [];
    scanResult = null;
    importResult = null;
  }

  $effect(() => {
    // Calculate total files to import
    const totalFiles = droppedFiles.length || scanResult?.stats.totalFiles || 0;
    return totalFiles;
  });

  const totalFiles = $derived(droppedFiles.length || scanResult?.stats.totalFiles || 0);
</script>

<div class="page">
  <header class="page-header">
    <h2>Import</h2>
    <p class="subtitle">Import footage from your cameras and drives</p>
  </header>

  <div class="import-options">
    <div class="couple-select">
      <label for="couple">Associate with Couple (optional)</label>
      <select id="couple" bind:value={selectedCoupleId}>
        <option value={undefined}>No couple selected</option>
        {#each couples as couple}
          <option value={couple.id}>{couple.name}</option>
        {/each}
      </select>
    </div>
  </div>

  {#if !importing && !importResult}
    <div
      class="drop-zone"
      class:has-files={totalFiles > 0}
      ondrop={handleDrop}
      ondragover={handleDragOver}
    >
      {#if totalFiles > 0}
        <div class="files-selected">
          <h3>{totalFiles} files selected</h3>
          {#if scanResult}
            <div class="stats-row">
              <span>{scanResult.stats.videoFiles} videos</span>
              <span>{scanResult.stats.sidecarFiles} sidecars</span>
              <span>{formatBytes(scanResult.stats.totalSize)}</span>
            </div>
          {/if}
          <div class="drop-actions">
            <button class="btn btn-primary" onclick={startImport}>
              Start Import
            </button>
            <button class="btn btn-secondary" onclick={clearSelection}>
              Clear
            </button>
          </div>
        </div>
      {:else}
        <div class="drop-prompt">
          <p>Drag and drop files or folders here</p>
          <p class="or">or</p>
          <div class="drop-actions">
            <button class="btn btn-secondary" onclick={selectFolder}>
              Select Folder
            </button>
            <button class="btn btn-secondary" onclick={selectFiles}>
              Select Files
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if importing && progress}
    <div class="import-progress">
      <div class="progress-header">
        <h3>Importing...</h3>
        <button class="btn btn-secondary btn-small" onclick={cancelImport}>
          Cancel
        </button>
      </div>
      <div class="progress-bar">
        <div
          class="progress-fill"
          style="width: {(progress.current / progress.total) * 100}%"
        ></div>
      </div>
      <div class="progress-info">
        <span>{progress.current} of {progress.total}</span>
        <span class="filename">{progress.filename}</span>
        <span class="status">{progress.status}</span>
      </div>
    </div>
  {/if}

  {#if importResult}
    <div class="import-result">
      <h3>Import Complete</h3>
      <div class="result-stats">
        <div class="result-stat success">
          <span class="value">{importResult.imported}</span>
          <span class="label">Imported</span>
        </div>
        <div class="result-stat warning">
          <span class="value">{importResult.duplicates}</span>
          <span class="label">Duplicates</span>
        </div>
        <div class="result-stat error">
          <span class="value">{importResult.errors}</span>
          <span class="label">Errors</span>
        </div>
      </div>
      <button class="btn btn-primary" onclick={clearSelection}>
        Import More
      </button>
    </div>
  {/if}
</div>

<style>
  .page-header {
    margin-bottom: 1.5rem;
  }

  .page-header h2 {
    margin-bottom: 0.25rem;
  }

  .subtitle {
    color: var(--color-text-muted);
    margin: 0;
  }

  .import-options {
    margin-bottom: 1.5rem;
  }

  .couple-select {
    max-width: 320px;
  }

  .couple-select label {
    display: block;
    margin-bottom: 0.375rem;
    font-size: var(--step--1);
    font-weight: 500;
  }

  .couple-select select {
    width: 100%;
    padding: 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: var(--step-0);
    font-family: var(--font-sans);
    background: var(--color-surface);
  }

  .drop-zone {
    border: 2px dashed var(--color-border);
    border-radius: 4px;
    padding: 3rem;
    text-align: center;
    background: var(--color-surface);
    transition: border-color 0.15s, background-color 0.15s;
  }

  .drop-zone:hover {
    border-color: var(--color-text-muted);
    background: var(--color-bg-alt);
  }

  .drop-zone.has-files {
    border-style: solid;
    border-color: var(--color-status-success);
  }

  .drop-prompt p {
    margin: 0;
    color: var(--color-text-muted);
  }

  .drop-prompt .or {
    margin: 1rem 0;
    font-size: var(--step--1);
    text-transform: uppercase;
  }

  .drop-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    margin-top: 1rem;
  }

  .files-selected h3 {
    margin-bottom: 0.5rem;
  }

  .stats-row {
    display: flex;
    gap: 1.5rem;
    justify-content: center;
    color: var(--color-text-secondary);
    font-size: var(--step--1);
    margin-bottom: 1.5rem;
  }

  .import-progress {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1.5rem;
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .progress-header h3 {
    margin: 0;
  }

  .progress-bar {
    height: 8px;
    background: var(--color-bg-alt);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 1rem;
  }

  .progress-fill {
    height: 100%;
    background: var(--color-status-success);
    transition: width 0.2s;
  }

  .progress-info {
    display: flex;
    gap: 1rem;
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .progress-info .filename {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .import-result {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 2rem;
    text-align: center;
  }

  .import-result h3 {
    margin-bottom: 1.5rem;
  }

  .result-stats {
    display: flex;
    justify-content: center;
    gap: 3rem;
    margin-bottom: 1.5rem;
  }

  .result-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .result-stat .value {
    font-size: var(--step-3);
    font-weight: 600;
  }

  .result-stat .label {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .result-stat.success .value { color: var(--color-status-success); }
  .result-stat.warning .value { color: var(--color-status-warning); }
  .result-stat.error .value { color: var(--color-status-error); }

  .btn {
    padding: 0.625rem 1.25rem;
    border: none;
    border-radius: 4px;
    font-size: var(--step-0);
    font-family: var(--font-sans);
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .btn-small {
    padding: 0.375rem 0.75rem;
    font-size: var(--step--1);
  }

  .btn-primary {
    background: var(--color-text);
    color: var(--color-surface);
  }

  .btn-secondary {
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }
</style>
