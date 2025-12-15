<script lang="ts">
  import { onMount } from 'svelte';
  import { router } from '../stores/router';
  import type { Location } from '@au-archive/core';
  import ImportForm from '../components/ImportForm.svelte';
  import RecentImports from '../components/RecentImports.svelte';
  import { toasts } from '../stores/toast-store';

  interface ImportResult {
    success: boolean;
    hash: string;
    type: 'image' | 'video' | 'document' | 'unknown';
    duplicate: boolean;
    archivePath?: string;
    error?: string;
    gpsWarning?: string;
  }

  interface ImportSessionResult {
    total: number;
    imported: number;
    duplicates: number;
    errors: number;
    results: ImportResult[];
    importId: string;
  }

  interface ImportRecord {
    import_id: string;
    locid: string | null;
    import_date: string;
    auth_imp: string | null;
    img_count: number;
    vid_count: number;
    doc_count: number;
    locnam?: string;
    address_state?: string;
  }

  let locations = $state<Location[]>([]);
  let selectedLocation = $state('');
  let isDragging = $state(false);
  let isImporting = $state(false);
  let importResult = $state<ImportSessionResult | null>(null);
  let recentImports = $state<ImportRecord[]>([]);
  let currentUser = $state('default');
  let loading = $state(true);
  let archiveFolderConfigured = $state(false);
  let archiveFolder = $state('');

  // Migration 26: Import attribution modal
  let showAttributionModal = $state(false);
  let pendingImportPaths = $state<string[]>([]);
  let isSomeoneElse = $state(false); // false = current user, true = someone else
  let selectedAuthor = $state(''); // username of selected author (or 'external')
  let contributionSource = $state(''); // for external contributors
  let users = $state<Array<{user_id: string, username: string, display_name: string | null}>>([]);

  onMount(async () => {
    try {
      if (!window.electronAPI?.locations) {
        console.error('Electron API not available - preload script may have failed to load');
        return;
      }
      const [locs, imports, settings] = await Promise.all([
        window.electronAPI.locations.findAll(),
        window.electronAPI.imports.findRecent(10) as Promise<ImportRecord[]>,
        window.electronAPI.settings.getAll(),
      ]);

      locations = locs;
      recentImports = imports;
      currentUser = settings.current_user || 'default';

      // Check if archive folder is configured
      archiveFolder = settings.archive_folder || '';
      archiveFolderConfigured = !!archiveFolder;

      // Load users for attribution modal
      if (window.electronAPI?.users) {
        users = await window.electronAPI.users.findAll();
      }

      // Set up v2 progress listener - progress display handled by store
      const unsubscribeProgress = window.electronAPI.importV2.onProgress(() => {
        // Progress bar display handled by import store
      });

      // Clean up listener on unmount
      return () => {
        unsubscribeProgress();
      };
    } catch (error) {
      console.error('Error loading imports page:', error);
    } finally {
      loading = false;
    }
  });

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    isDragging = true;
  }

  function handleDragLeave() {
    isDragging = false;
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    isDragging = false;

    if (!event.dataTransfer?.files || event.dataTransfer.files.length === 0) {
      return;
    }

    // Small delay to ensure preload's drop handler has processed the files
    await new Promise(resolve => setTimeout(resolve, 10));

    // Get paths extracted by preload's drop event handler
    // The preload captures drop events and extracts paths using webUtils.getPathForFile()
    const droppedPaths = window.getDroppedFilePaths?.() || [];

    if (droppedPaths.length === 0) {
      toasts.warning('No valid files found in dropped items');
      return;
    }

    // Use main process to expand paths (handles directories recursively)
    if (!window.electronAPI?.media?.expandPaths) {
      toasts.error('API not available');
      return;
    }

    const expandedPaths = await window.electronAPI.media.expandPaths(droppedPaths);

    if (expandedPaths.length > 0) {
      // Show attribution modal instead of importing directly
      pendingImportPaths = expandedPaths;
      isSomeoneElse = false;
      selectedAuthor = '';
      contributionSource = '';
      showAttributionModal = true;
    } else {
      toasts.warning('No supported media files found');
    }
  }

  async function handleBrowse() {
    if (!window.electronAPI?.media) return;
    try {
      const filePaths = await window.electronAPI.media.selectFiles();
      if (!filePaths || filePaths.length === 0) {
        return;
      }

      // Show attribution modal instead of importing directly
      pendingImportPaths = filePaths;
      isSomeoneElse = false;
      selectedAuthor = '';
      contributionSource = '';
      showAttributionModal = true;
    } catch (error) {
      console.error('Error selecting files:', error);
      toasts.error('Error selecting files');
    }
  }

  // Called when user confirms attribution in modal
  function confirmImport() {
    showAttributionModal = false;
    if (pendingImportPaths.length > 0) {
      // Determine author and contribution status
      let author = currentUser;
      let isContributed = 0;
      let source = '';

      if (isSomeoneElse) {
        if (selectedAuthor === 'external') {
          // External contributor
          isContributed = 1;
          source = contributionSource;
          author = currentUser; // Current user is importing on behalf of external
        } else {
          // Another registered user is the author
          author = selectedAuthor;
          isContributed = 0;
        }
      }

      importFilePaths(pendingImportPaths, author, isContributed, source);
      pendingImportPaths = [];
    }
  }

  function cancelImport() {
    showAttributionModal = false;
    pendingImportPaths = [];
    isSomeoneElse = false;
    selectedAuthor = '';
    contributionSource = '';
  }

  // Import v2.0: Uses v2 pipeline with streaming progress
  async function importFilePaths(filePaths: string[], author: string, contributed: number = 0, source: string = '') {
    if (!selectedLocation) {
      toasts.warning('Please select a location first');
      return;
    }
    if (!window.electronAPI?.importV2) {
      toasts.error('Import v2 API not available');
      return;
    }

    // Get full location object from locations array (v2 requires loc12 and other fields)
    const location = locations.find(loc => loc.locid === selectedLocation);
    if (!location) {
      toasts.error('Selected location not found');
      return;
    }

    try {
      isImporting = true;

      // Call v2 import pipeline - no chunking needed, v2 handles it internally
      const result = await window.electronAPI.importV2.start({
        paths: filePaths,
        locid: location.locid,
        loc12: location.loc12,
        address_state: location.address_state || null,
        type: location.type || null,
        slocnam: location.slocnam || null,
        subid: null, // Imports page doesn't support sub-location selection
        auth_imp: author,
        is_contributed: contributed,
        contribution_source: source || null,
      });

      // Extract counts from v2 result structure
      const totalImported = result.finalizationResult?.totalFinalized ?? 0;
      const totalDuplicates = result.hashResult?.totalDuplicates ?? 0;
      const totalErrors = (result.hashResult?.totalErrors ?? 0) +
                          (result.copyResult?.totalErrors ?? 0) +
                          (result.validationResult?.totalInvalid ?? 0) +
                          (result.finalizationResult?.totalErrors ?? 0);
      const jobsQueued = result.finalizationResult?.jobsQueued ?? 0;

      // Build result for UI display
      importResult = {
        total: result.scanResult?.totalFiles ?? filePaths.length,
        imported: totalImported,
        duplicates: totalDuplicates,
        errors: totalErrors,
        results: [], // v2 doesn't return per-file results to avoid memory issues
        importId: result.sessionId,
      };

      // Success toast
      if (totalErrors > 0) {
        toasts.warning(`Imported ${totalImported} files. ${totalErrors} failed.`);
      } else if (totalImported > 0) {
        toasts.success(`Successfully imported ${totalImported} files`);
      } else if (totalDuplicates > 0) {
        toasts.info(`${totalDuplicates} files were already in archive`);
      }

      // Refresh recent imports list
      const imports = (await window.electronAPI.imports.findRecent(10)) as ImportRecord[];
      recentImports = imports;

      // Clear result display after delay
      setTimeout(() => {
        importResult = null;
      }, 5000);

    } catch (error) {
      console.error('Error importing files:', error);
      toasts.error(`Import error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      isImporting = false;
    }
  }
</script>

<div class="p-8">
  <div class="mb-8">
    <h1 class="text-3xl font-bold text-foreground mb-2">Imports</h1>
    <p class="text-braun-600">Import media files for your locations</p>
  </div>

  {#if loading}
    <p class="text-braun-500">Loading...</p>
  {:else if !archiveFolderConfigured}
    <!-- Archive folder not configured - block imports -->
    <div class="max-w-3xl bg-braun-100 border-2 border-braun-400 rounded p-6">
      <div class="flex items-start gap-4">
        <div class="flex-shrink-0">
          <svg class="w-8 h-8 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div class="flex-1">
          <h3 class="text-lg font-semibold text-braun-900">Archive Folder Not Configured</h3>
          <p class="text-braun-600 mt-1">
            Before you can import media files, you need to set up an archive folder where your files will be organized and stored.
          </p>
          <div class="mt-4 flex gap-3">
            <button
              onclick={() => router.navigate('/settings')}
              class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition font-medium"
            >
              Go to Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  {:else}
    <ImportForm
      {locations}
      {selectedLocation}
      {isImporting}
      {isDragging}
      onLocationChange={(locid) => (selectedLocation = locid)}
      onBrowse={handleBrowse}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onLocationCreated={async (newLoc) => {
        // Refresh locations list and select the new one
        if (window.electronAPI?.locations) {
          locations = await window.electronAPI.locations.findAll();
          selectedLocation = newLoc.locid;
        }
      }}
      onNavigateToLocation={(locid) => router.navigate(`/location/${locid}?autoImport=true`)}
      defaultAuthor={currentUser}
    />

    {#if importResult}
      <div class="max-w-3xl mt-4 p-4 bg-braun-100 border border-braun-300 rounded">
        <h3 class="font-semibold text-braun-900 mb-2">Import Summary</h3>
        <div class="text-sm text-braun-700 space-y-1">
          <p>Total files: {importResult.total}</p>
          <p class="text-success">Successfully imported: {importResult.imported}</p>
          <p>Duplicates skipped: {importResult.duplicates}</p>
          {#if importResult.errors > 0}
            <p class="text-error">Errors: {importResult.errors}</p>
          {/if}
        </div>
      </div>
    {/if}

    <RecentImports imports={recentImports} />
  {/if}

  <!-- Migration 26: Import Attribution Modal -->
  {#if showAttributionModal}
    <div
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999]"
      onclick={cancelImport}
      role="dialog"
      aria-modal="true"
      aria-labelledby="attribution-title"
    >
      <div
        class="bg-braun-50 rounded border border-braun-300 w-full max-w-md mx-4"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="p-5 flex justify-between items-center">
          <h2 id="attribution-title" class="text-xl font-semibold text-foreground">
            Import Author
          </h2>
          <button
            onclick={cancelImport}
            class="text-braun-400 hover:text-braun-600 transition p-1 rounded hover:bg-braun-200"
            aria-label="Close"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="p-5 space-y-4">
          <!-- Step 1: Current user or someone else? -->
          <div class="space-y-3">
            <label class="flex items-center gap-3 p-3 border rounded cursor-pointer hover:bg-braun-50 transition bg-white {!isSomeoneElse ? 'border-braun-400' : 'border-braun-200'}">
              <input
                type="radio"
                name="author-type"
                checked={!isSomeoneElse}
                onchange={() => { isSomeoneElse = false; selectedAuthor = ''; contributionSource = ''; }}
                class="w-4 h-4 text-braun-900"
              />
              <span class="font-medium text-foreground">{currentUser}</span>
            </label>

            <label class="flex items-center gap-3 p-3 border rounded cursor-pointer hover:bg-braun-50 transition bg-white {isSomeoneElse ? 'border-braun-400' : 'border-braun-200'}">
              <input
                type="radio"
                name="author-type"
                checked={isSomeoneElse}
                onchange={() => isSomeoneElse = true}
                class="w-4 h-4 text-braun-900"
              />
              <span class="font-medium text-foreground">Someone Else</span>
            </label>
          </div>

          <!-- Step 2: If someone else, who? -->
          {#if isSomeoneElse}
            <div class="pt-2 space-y-3">
              <label for="author-select" class="block text-sm font-medium text-braun-700">
                Who shot these?
              </label>
              <select
                id="author-select"
                bind:value={selectedAuthor}
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              >
                <option value="">Select...</option>
                {#each users.filter(u => u.username !== currentUser) as user}
                  <option value={user.username}>{user.display_name || user.username}</option>
                {/each}
                <option value="external">External Contributor</option>
              </select>

              <!-- If external contributor, show source field -->
              {#if selectedAuthor === 'external'}
                <div class="pt-2">
                  <label for="contribution-source" class="block text-sm font-medium text-braun-700 mb-1">
                    Source
                  </label>
                  <input
                    id="contribution-source"
                    type="text"
                    bind:value={contributionSource}
                    placeholder="e.g., John Smith via text, Facebook group"
                    class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
                  />
                  <p class="text-xs text-braun-500 mt-1">Who contributed these or where they came from</p>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div class="p-5 flex justify-end gap-3">
          <button
            onclick={cancelImport}
            class="px-3 py-1.5 text-sm text-braun-700 bg-white border border-braun-300 rounded hover:bg-braun-50 transition font-medium"
          >
            Cancel
          </button>
          <button
            onclick={confirmImport}
            disabled={isSomeoneElse && !selectedAuthor || (selectedAuthor === 'external' && !contributionSource.trim())}
            class="px-3 py-1.5 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
