<script lang="ts">
  /**
   * LocationSettings - Administrative controls for location
   * OPT-100: Separated from NerdStats for better discoverability
   * Braun Design: Accordion box matching NerdStats styling
   */
  import type { Location } from '@au-archive/core';
  import { router } from '../../stores/router';
  import AutocompleteInput from '../AutocompleteInput.svelte';
  import { getCategoryForClass } from '../../lib/type-hierarchy';

  interface Props {
    location: Location;
    onLocationUpdated?: () => void;
  }

  let { location, onLocationUpdated }: Props = $props();

  let isOpen = $state(false);

  // Fix media state
  let fixingImages = $state(false);
  let fixingVideos = $state(false);
  let fixMessage = $state('');

  // OPT-113: Web source archive state
  let pendingSourceCount = $state(0);
  let archivingSources = $state(false);
  let archiveMessage = $state('');

  // Image tagging state
  let untaggedCount = $state(0);
  let queueingTags = $state(false);
  let tagMessage = $state('');

  // Edit Category modal state
  let showEditCategory = $state(false);
  let editCategory = $state('');
  let editClass = $state('');
  let savingCategory = $state(false);
  let categorySuggestions = $state<string[]>([]);
  let classSuggestions = $state<string[]>([]);

  // Edit Name modal state
  let showEditName = $state(false);
  let editName = $state('');
  let savingName = $state(false);

  // Delete state
  let showDeleteConfirm = $state(false);
  let deletePin = $state('');
  let deletePinError = $state('');
  let deleting = $state(false);

  // Load suggestions when opened
  $effect(() => {
    if (isOpen && categorySuggestions.length === 0) {
      loadSuggestions();
    }
  });

  // OPT-113: Load pending source count when opened
  $effect(() => {
    if (isOpen) {
      loadPendingSourceCount();
      loadUntaggedCount();
    }
  });

  async function loadSuggestions() {
    try {
      const locations = await window.electronAPI?.locations?.findAll() || [];
      const categories = new Set<string>();
      const classes = new Set<string>();
      locations.forEach((loc: Location) => {
        if (loc.category) categories.add(loc.category);
        if (loc.class) classes.add(loc.class);
      });
      categorySuggestions = Array.from(categories).sort();
      classSuggestions = Array.from(classes).sort();
    } catch (err) {
      console.warn('[LocationSettings] Failed to load suggestions:', err);
    }
  }

  // Fix images for this location
  async function fixLocationImages() {
    if (!window.electronAPI?.media?.fixLocationImages) {
      fixMessage = 'Not available';
      return;
    }

    try {
      fixingImages = true;
      fixMessage = 'Fixing images...';

      const result = await window.electronAPI.media.fixLocationImages(location.locid);

      if (result.total === 0) {
        fixMessage = 'No images to fix';
      } else {
        fixMessage = `Fixed ${result.fixed}/${result.total} images${result.errors > 0 ? ` (${result.errors} errors)` : ''}`;
      }

      if (result.fixed > 0) {
        onLocationUpdated?.();
      }

      setTimeout(() => { fixMessage = ''; }, 5000);
    } catch (err) {
      console.error('Fix images failed:', err);
      fixMessage = 'Failed';
    } finally {
      fixingImages = false;
    }
  }

  // Fix videos for this location
  async function fixLocationVideos() {
    if (!window.electronAPI?.media?.fixLocationVideos) {
      fixMessage = 'Not available';
      return;
    }

    try {
      fixingVideos = true;
      fixMessage = 'Fixing videos...';

      const result = await window.electronAPI.media.fixLocationVideos(location.locid);

      if (result.total === 0) {
        fixMessage = 'No videos to fix';
      } else {
        fixMessage = `Fixed ${result.fixed}/${result.total} videos${result.errors > 0 ? ` (${result.errors} errors)` : ''}`;
      }

      if (result.fixed > 0) {
        onLocationUpdated?.();
      }

      setTimeout(() => { fixMessage = ''; }, 5000);
    } catch (err) {
      console.error('Fix videos failed:', err);
      fixMessage = 'Failed';
    } finally {
      fixingVideos = false;
    }
  }

  // OPT-113: Load pending web source count for this location
  async function loadPendingSourceCount() {
    if (!window.electronAPI?.websources?.countPendingByLocation) return;
    try {
      pendingSourceCount = await window.electronAPI.websources.countPendingByLocation(location.locid);
    } catch (err) {
      console.error('Failed to load pending source count:', err);
    }
  }

  // OPT-113: Archive pending sources for this location
  async function archivePendingSources() {
    if (!window.electronAPI?.websources?.archivePendingByLocation || archivingSources) return;

    try {
      archivingSources = true;
      archiveMessage = 'Queueing archives...';

      const result = await window.electronAPI.websources.archivePendingByLocation(location.locid);

      if (result.queued === 0) {
        archiveMessage = 'No pending sources';
      } else {
        archiveMessage = `Queued ${result.queued} sources`;
      }

      setTimeout(() => { archiveMessage = ''; }, 5000);
    } catch (err) {
      console.error('Archive sources failed:', err);
      archiveMessage = 'Failed';
    } finally {
      archivingSources = false;
    }
  }

  // Load untagged image count for this location
  async function loadUntaggedCount() {
    if (!window.electronAPI?.media?.countUntaggedImages) return;
    try {
      untaggedCount = await window.electronAPI.media.countUntaggedImages(location.locid);
    } catch (err) {
      console.error('Failed to load untagged count:', err);
    }
  }

  // Queue untagged images for tagging
  async function queueUntaggedForTagging() {
    if (!window.electronAPI?.tagging?.queueUntaggedImages || queueingTags) return;

    try {
      queueingTags = true;
      tagMessage = 'Queueing images...';

      const result = await window.electronAPI.tagging.queueUntaggedImages(location.locid);

      if (result.success) {
        if (result.queued === 0) {
          tagMessage = 'No untagged images';
        } else {
          tagMessage = `Queued ${result.queued} images for tagging`;
          untaggedCount = 0; // Will be processed
        }
      } else {
        tagMessage = result.error || 'Failed';
      }

      setTimeout(() => { tagMessage = ''; }, 5000);
    } catch (err) {
      console.error('Queue tagging failed:', err);
      tagMessage = 'Failed';
    } finally {
      queueingTags = false;
    }
  }

  // Open Edit Category modal
  function openEditCategory() {
    editCategory = location.category || '';
    editClass = location.class || '';
    showEditCategory = true;
  }

  // Auto-fill category when class changes
  function handleClassChange(value: string) {
    editClass = value;
    if (value && !editCategory) {
      const matchedCategory = getCategoryForClass(value);
      if (matchedCategory) {
        editCategory = matchedCategory;
      }
    }
  }

  // Save category changes
  async function saveCategory() {
    if (!window.electronAPI?.locations?.update) return;

    try {
      savingCategory = true;
      await window.electronAPI.locations.update(location.locid, {
        category: editCategory || undefined,
        class: editClass || undefined,
      });
      showEditCategory = false;
      onLocationUpdated?.();
    } catch (err) {
      console.error('Save category failed:', err);
      alert('Failed to save category');
    } finally {
      savingCategory = false;
    }
  }

  // Open Edit Name modal
  function openEditName() {
    editName = location.locnam || '';
    showEditName = true;
  }

  // Save name changes
  async function saveName() {
    if (!window.electronAPI?.locations?.update) return;
    if (!editName.trim()) {
      alert('Name is required');
      return;
    }

    try {
      savingName = true;
      await window.electronAPI.locations.update(location.locid, {
        locnam: editName.trim(),
      });
      showEditName = false;
      onLocationUpdated?.();
    } catch (err) {
      console.error('Save name failed:', err);
      alert('Failed to save name');
    } finally {
      savingName = false;
    }
  }

  // Verify PIN for delete (second confirmation)
  async function verifyDeletePin() {
    if (!deletePin) {
      deletePinError = 'Please enter your PIN';
      return;
    }

    try {
      const users = await window.electronAPI?.users?.findAll?.() || [];
      const currentUser = users[0] as { user_id: string } | undefined;

      if (!currentUser) {
        deletePinError = 'No user found';
        return;
      }

      const result = await window.electronAPI?.users?.verifyPin(currentUser.user_id, deletePin);
      if (result?.success) {
        await deleteLocation();
      } else {
        deletePinError = 'Invalid PIN';
      }
    } catch (err) {
      console.error('PIN verification failed:', err);
      deletePinError = 'Verification failed';
    }
  }

  // Delete location
  async function deleteLocation() {
    if (!window.electronAPI?.locations?.delete) return;

    try {
      deleting = true;
      await window.electronAPI.locations.delete(location.locid);
      showDeleteConfirm = false;
      router.navigate('/locations');
    } catch (err) {
      console.error('Delete location failed:', err);
      alert('Failed to delete location');
    } finally {
      deleting = false;
    }
  }

  function cancelDelete() {
    showDeleteConfirm = false;
    deletePin = '';
    deletePinError = '';
  }
</script>

<div class="mt-6 bg-white rounded border border-braun-300">
  <button
    onclick={() => isOpen = !isOpen}
    aria-expanded={isOpen}
    class="w-full p-6 flex items-center justify-between text-left hover:bg-braun-50 transition-colors"
  >
    <h2 class="text-xl font-semibold text-braun-900">Location Settings</h2>
    <svg
      class="w-5 h-5 text-braun-400 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if isOpen}
  <div class="px-6 pb-6">
    <div class="space-y-4">
      <!-- Media Fix Section -->
      <div>
        <p class="text-xs font-semibold text-braun-400 uppercase mb-2">Media Repair</p>
        <div class="flex flex-wrap items-center gap-2">
          <button
            onclick={fixLocationImages}
            disabled={fixingImages || fixingVideos}
            class="px-3 py-1 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
          >
            {fixingImages ? 'Fixing...' : 'Fix Images'}
          </button>
          <button
            onclick={fixLocationVideos}
            disabled={fixingImages || fixingVideos}
            class="px-3 py-1 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
          >
            {fixingVideos ? 'Fixing...' : 'Fix Videos'}
          </button>
          {#if fixMessage}
            <span class="text-sm text-braun-600">{fixMessage}</span>
          {/if}
        </div>
        <p class="text-xs text-braun-400 mt-1">Regenerate missing thumbnails and proxies</p>
      </div>

      <!-- OPT-113: Web Sources Section -->
      <div>
        <p class="text-xs font-semibold text-braun-400 uppercase mb-2">Web Sources</p>
        <div class="flex flex-wrap items-center gap-2">
          <button
            onclick={archivePendingSources}
            disabled={archivingSources || pendingSourceCount === 0}
            class="px-3 py-1 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
          >
            {#if archivingSources}
              Queueing...
            {:else}
              Archive Pending ({pendingSourceCount})
            {/if}
          </button>
          {#if archiveMessage}
            <span class="text-sm text-braun-600">{archiveMessage}</span>
          {/if}
        </div>
        <p class="text-xs text-braun-400 mt-1">Archive any pending web sources for this location</p>
      </div>

      <!-- Image Tagging Section -->
      <div>
        <p class="text-xs font-semibold text-braun-400 uppercase mb-2">Image Tagging</p>
        <div class="flex flex-wrap items-center gap-2">
          <button
            onclick={queueUntaggedForTagging}
            disabled={queueingTags || untaggedCount === 0}
            class="px-3 py-1 text-sm bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
          >
            {#if queueingTags}
              Queueing...
            {:else}
              Tag Untagged ({untaggedCount})
            {/if}
          </button>
          {#if tagMessage}
            <span class="text-sm text-braun-600">{tagMessage}</span>
          {/if}
        </div>
        <p class="text-xs text-braun-400 mt-1">Queue untagged images for AI tagging (Florence-2 + SigLIP)</p>
      </div>

      <!-- Edit Section -->
      <div>
        <p class="text-xs font-semibold text-braun-400 uppercase mb-2">Edit Location</p>
        <div class="flex flex-wrap items-center gap-2">
          <button
            onclick={openEditCategory}
            class="px-3 py-1 text-sm bg-braun-600 text-white rounded hover:bg-braun-500 transition"
          >
            Edit Category
          </button>
          <button
            onclick={openEditName}
            class="px-3 py-1 text-sm bg-braun-600 text-white rounded hover:bg-braun-500 transition"
          >
            Edit Name
          </button>
        </div>
      </div>

      <!-- Danger Zone -->
      <div class="pt-2 border-t border-braun-200">
        <p class="text-xs font-semibold text-braun-400 uppercase mb-2">Danger Zone</p>
        <button
          onclick={() => showDeleteConfirm = true}
          class="px-3 py-1 text-sm bg-error text-white rounded hover:opacity-90 transition"
        >
          Delete Location
        </button>
        <p class="text-xs text-braun-400 mt-1">Permanently delete this location and all media</p>
      </div>
    </div>
  </div>
  {/if}
</div>

<!-- Edit Category Modal -->
{#if showEditCategory}
<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={() => showEditCategory = false}>
  <div class="bg-white rounded border border-braun-300 p-6 w-full max-w-md mx-4" onclick={(e) => e.stopPropagation()}>
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-lg font-semibold">Edit Category</h3>
      <button onclick={() => showEditCategory = false} class="text-braun-400 hover:text-braun-600">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
    <div class="space-y-4">
      <div>
        <label for="edit-category" class="block text-sm font-medium text-braun-700 mb-1">Category</label>
        <AutocompleteInput
          bind:value={editCategory}
          suggestions={categorySuggestions}
          id="edit-category"
          placeholder="e.g., Industrial, Medical..."
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
        />
      </div>
      <div>
        <label for="edit-class" class="block text-sm font-medium text-braun-700 mb-1">Class</label>
        <AutocompleteInput
          bind:value={editClass}
          onchange={handleClassChange}
          suggestions={classSuggestions}
          id="edit-class"
          placeholder="e.g., Factory, Hospital..."
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
        />
      </div>
    </div>
    <div class="flex justify-end gap-3 mt-6">
      <button
        onclick={() => showEditCategory = false}
        class="px-4 py-2 bg-braun-200 text-braun-700 rounded hover:bg-braun-300 transition"
      >
        Cancel
      </button>
      <button
        onclick={saveCategory}
        disabled={savingCategory}
        class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
      >
        {savingCategory ? 'Saving...' : 'Save'}
      </button>
    </div>
  </div>
</div>
{/if}

<!-- Edit Name Modal -->
{#if showEditName}
<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={() => showEditName = false}>
  <div class="bg-white rounded border border-braun-300 p-6 w-full max-w-md mx-4" onclick={(e) => e.stopPropagation()}>
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-lg font-semibold">Edit Name</h3>
      <button onclick={() => showEditName = false} class="text-braun-400 hover:text-braun-600">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
    <div class="space-y-4">
      <div>
        <label for="edit-name" class="block text-sm font-medium text-braun-700 mb-1">Location Name</label>
        <input
          id="edit-name"
          type="text"
          bind:value={editName}
          placeholder="Location name"
          class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
        />
      </div>
    </div>
    <div class="flex justify-end gap-3 mt-6">
      <button
        onclick={() => showEditName = false}
        class="px-4 py-2 bg-braun-200 text-braun-700 rounded hover:bg-braun-300 transition"
      >
        Cancel
      </button>
      <button
        onclick={saveName}
        disabled={savingName || !editName.trim()}
        class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
      >
        {savingName ? 'Saving...' : 'Save'}
      </button>
    </div>
  </div>
</div>
{/if}

<!-- Delete Confirmation Modal (with second PIN) -->
{#if showDeleteConfirm}
<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={cancelDelete}>
  <div class="bg-white rounded border border-braun-300 p-6 w-full max-w-md mx-4" onclick={(e) => e.stopPropagation()}>
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-lg font-semibold text-error">Delete "{location.locnam}"?</h3>
      <button onclick={cancelDelete} class="text-braun-400 hover:text-braun-600">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
    <div class="bg-braun-100 border border-braun-300 rounded p-4 mb-4">
      <p class="text-sm text-braun-700 mb-2">This action cannot be undone.</p>
      <p class="text-sm text-error font-medium">All media files will be permanently deleted.</p>
    </div>
    <div class="mb-4">
      <label for="delete-pin" class="block text-sm font-medium text-braun-700 mb-1">Enter PIN to confirm</label>
      <input
        id="delete-pin"
        type="password"
        inputmode="numeric"
        pattern="[0-9]*"
        maxlength="6"
        bind:value={deletePin}
        placeholder="PIN"
        onkeydown={(e) => e.key === 'Enter' && verifyDeletePin()}
        class="w-24 px-3 py-2 text-center border border-braun-300 rounded focus:outline-none focus:border-braun-600"
      />
      {#if deletePinError}
        <p class="text-sm text-error mt-1">{deletePinError}</p>
      {/if}
    </div>
    <div class="flex justify-end gap-3">
      <button
        onclick={cancelDelete}
        disabled={deleting}
        class="px-4 py-2 bg-braun-200 text-braun-700 rounded hover:bg-braun-300 transition"
      >
        Cancel
      </button>
      <button
        onclick={verifyDeletePin}
        disabled={deleting || !deletePin}
        class="px-4 py-2 bg-error text-white rounded hover:opacity-90 transition disabled:opacity-50"
      >
        {deleting ? 'Deleting...' : 'Delete'}
      </button>
    </div>
  </div>
</div>
{/if}
