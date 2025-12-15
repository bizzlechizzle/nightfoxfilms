<script lang="ts">
  /**
   * LocationInfoHorizontal - Horizontal info strip below timeline/map row
   * Per PLAN: Display Status, Category/Class, Built, Abandoned, Flags
   * Click edit to open existing LocationInfo edit modal
   */
  import type { Location, LocationInput } from '@au-archive/core';
  import { ACCESS_OPTIONS } from '../../constants/location-enums';
  import { onMount } from 'svelte';

  // Sub-location type for edit mode
  interface SubLocationData {
    subid: string;
    subnam: string;
    ssubname: string | null;
    category: string | null;
    class: string | null;
    status: string | null;
    is_primary: boolean;
    akanam: string | null;
  }

  interface SubLocationUpdates {
    subnam?: string;
    ssubname?: string | null;
    category?: string | null;
    class?: string | null;
    status?: string | null;
    is_primary?: boolean;
    akanam?: string | null;
  }

  interface Props {
    location: Location;
    onNavigateFilter: (type: string, value: string) => void;
    onSave?: (updates: Partial<LocationInput>) => Promise<void>;
    // Sub-location support
    currentSubLocation?: SubLocationData | null;
    onSubLocationSave?: (subUpdates: SubLocationUpdates, locUpdates: Partial<LocationInput>) => Promise<void>;
  }

  let {
    location,
    onNavigateFilter,
    onSave,
    currentSubLocation = null,
    onSubLocationSave
  }: Props = $props();

  // Edit modal state
  let showEditModal = $state(false);
  let saving = $state(false);

  // Autocomplete options
  let categoryOptions = $state<string[]>([]);
  let classOptions = $state<string[]>([]);

  // Sub-location mode detection
  const isSubLocationMode = $derived(!!currentSubLocation && !!onSubLocationSave);

  // Load autocomplete options on mount
  onMount(async () => {
    try {
      const categoryPromise = isSubLocationMode
        ? window.electronAPI?.sublocations?.getDistinctCategories?.() || []
        : window.electronAPI?.locations?.getDistinctCategories?.() || [];
      const classPromise = isSubLocationMode
        ? window.electronAPI?.sublocations?.getDistinctClasses?.() || []
        : window.electronAPI?.locations?.getDistinctClasses?.() || [];

      const [categories, classes] = await Promise.all([categoryPromise, classPromise]);
      categoryOptions = categories;
      classOptions = classes;
    } catch (err) {
      console.error('Error loading category options:', err);
    }
  });

  // Edit form state
  let editForm = $state({
    access: '',
    category: '',
    class: '',
    builtYear: '',
    builtType: 'year' as 'year' | 'range' | 'date',
    abandonedYear: '',
    abandonedType: 'year' as 'year' | 'range' | 'date',
    historic: false,
    favorite: false,
    project: false,
    // Sub-location specific
    status: '',
    is_primary: false,
  });

  let originalStatus = $state('');

  // Data display helpers
  const hasStatus = $derived(isSubLocationMode ? !!currentSubLocation?.status : !!location.access);
  const hasCategory = $derived(isSubLocationMode ? !!currentSubLocation?.category : !!location.category);
  const hasClass = $derived(isSubLocationMode ? !!currentSubLocation?.class : !!location.class);
  const hasBuilt = $derived(!!location.builtYear);
  const hasAbandoned = $derived(!!location.abandonedYear);
  const hasFlags = $derived(location.historic || location.favorite || location.project);

  function getStatus(): string {
    return isSubLocationMode ? (currentSubLocation?.status || '') : (location.access || '');
  }

  function getCategory(): string {
    return isSubLocationMode ? (currentSubLocation?.category || '') : (location.category || '');
  }

  function getClass(): string {
    return isSubLocationMode ? (currentSubLocation?.class || '') : (location.class || '');
  }

  function openEditModal() {
    if (isSubLocationMode && currentSubLocation) {
      originalStatus = currentSubLocation.status || '';
      editForm = {
        access: '',
        category: currentSubLocation.category || '',
        class: currentSubLocation.class || '',
        builtYear: location.builtYear || '',
        builtType: location.builtType || 'year',
        abandonedYear: location.abandonedYear || '',
        abandonedType: location.abandonedType || 'year',
        historic: location.historic || false,
        favorite: location.favorite || false,
        project: location.project || false,
        status: currentSubLocation.status || '',
        is_primary: currentSubLocation.is_primary || false,
      };
    } else {
      originalStatus = location.access || '';
      editForm = {
        access: location.access || '',
        category: location.category || '',
        class: location.class || '',
        builtYear: location.builtYear || '',
        builtType: location.builtType || 'year',
        abandonedYear: location.abandonedYear || '',
        abandonedType: location.abandonedType || 'year',
        historic: location.historic || false,
        favorite: location.favorite || false,
        project: location.project || false,
        status: '',
        is_primary: false,
      };
    }
    showEditModal = true;
  }

  async function handleSave() {
    try {
      saving = true;

      if (isSubLocationMode && onSubLocationSave) {
        const subUpdates: SubLocationUpdates = {
          category: editForm.category || null,
          class: editForm.class || null,
          status: editForm.status || null,
          is_primary: editForm.is_primary,
        };

        const locUpdates: Partial<LocationInput> = {
          builtYear: editForm.builtYear || undefined,
          builtType: editForm.builtType,
          abandonedYear: editForm.abandonedYear || undefined,
          abandonedType: editForm.abandonedType,
          historic: editForm.historic,
          favorite: editForm.favorite,
          project: editForm.project,
        };

        await onSubLocationSave(subUpdates, locUpdates);
      } else if (onSave) {
        const statusChanged = editForm.access !== originalStatus;
        const statusChangedAt = statusChanged ? new Date().toISOString() : undefined;

        await onSave({
          access: editForm.access || undefined,
          statusChangedAt: statusChangedAt,
          category: editForm.category || undefined,
          class: editForm.class || undefined,
          builtYear: editForm.builtYear || undefined,
          builtType: editForm.builtType,
          abandonedYear: editForm.abandonedYear || undefined,
          abandonedType: editForm.abandonedType,
          historic: editForm.historic,
          favorite: editForm.favorite,
          project: editForm.project,
        });
      }
      showEditModal = false;
    } catch (err) {
      console.error('Error saving information:', err);
    } finally {
      saving = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      showEditModal = false;
    }
  }
</script>

<svelte:window onkeydown={showEditModal ? handleKeydown : undefined} />

<!-- Horizontal Info Strip -->
<div class="bg-white rounded border border-braun-300">
  <div class="px-8 py-4 flex items-start gap-8">
    <!-- Status -->
    <div class="min-w-[100px]">
      <h3 class="section-title mb-1">Status</h3>
      {#if hasStatus}
        <button
          onclick={() => onNavigateFilter('access', getStatus())}
          class="text-[15px] text-braun-900 hover:underline"
          title="View all locations with this status"
        >
          {getStatus()}
        </button>
      {:else}
        <span class="text-sm text-braun-500 italic">—</span>
      {/if}
    </div>

    <!-- Category / Class -->
    <div class="min-w-[140px]">
      <h3 class="section-title mb-1">Category</h3>
      {#if hasCategory}
        <span class="text-[15px]">
          <button
            onclick={() => onNavigateFilter('category', getCategory())}
            class="text-braun-900 hover:underline"
            title="View all {getCategory()} locations"
          >
            {getCategory()}
          </button>
          {#if hasClass}
            <span class="text-braun-400"> / </span>
            <button
              onclick={() => onNavigateFilter('class', getClass())}
              class="text-braun-900 hover:underline"
              title="View all {getClass()} locations"
            >
              {getClass()}
            </button>
          {/if}
        </span>
      {:else}
        <span class="text-sm text-braun-500 italic">—</span>
      {/if}
    </div>

    <!-- Built -->
    <div class="min-w-[80px]">
      <h3 class="section-title mb-1">Built</h3>
      {#if hasBuilt}
        <span class="text-[15px] text-braun-900">{location.builtYear}</span>
      {:else}
        <span class="text-sm text-braun-500 italic">—</span>
      {/if}
    </div>

    <!-- Abandoned -->
    <div class="min-w-[80px]">
      <h3 class="section-title mb-1">Abandoned</h3>
      {#if hasAbandoned}
        <span class="text-[15px] text-braun-900">{location.abandonedYear}</span>
      {:else}
        <span class="text-sm text-braun-500 italic">—</span>
      {/if}
    </div>

    <!-- Flags -->
    <div class="min-w-[100px]">
      <h3 class="section-title mb-1">Flags</h3>
      {#if hasFlags}
        <div class="flex gap-2 text-[15px] text-braun-900">
          {#if location.project}
            <button
              onclick={() => onNavigateFilter('project', 'true')}
              class="hover:underline"
              title="View all project locations"
            >
              Project
            </button>
          {/if}
          {#if location.favorite}
            <button
              onclick={() => onNavigateFilter('favorite', 'true')}
              class="hover:underline"
              title="View all favorites"
            >
              Favorite
            </button>
          {/if}
          {#if location.historic}
            <button
              onclick={() => onNavigateFilter('historic', 'true')}
              class="hover:underline"
              title="View all historic landmarks"
            >
              Historic
            </button>
          {/if}
        </div>
      {:else}
        <span class="text-sm text-braun-500 italic">—</span>
      {/if}
    </div>

    <!-- Edit button (pushed to right) -->
    <div class="ml-auto">
      {#if onSave || onSubLocationSave}
        <button
          onclick={openEditModal}
          class="text-sm text-braun-500 hover:text-braun-900 hover:underline"
          title="Edit information"
        >
          edit
        </button>
      {/if}
    </div>
  </div>
</div>

<!-- Edit Modal -->
{#if showEditModal}
  <div
    class="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50"
    onclick={() => showEditModal = false}
    role="button"
    tabindex="-1"
  >
    <div
      class="bg-white rounded border border-braun-300 w-full max-w-lg max-h-[90vh] overflow-hidden relative z-[100000]"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-braun-200">
        <h2 class="text-lg font-semibold text-braun-900">Edit Information</h2>
        <button
          onclick={() => showEditModal = false}
          class="p-1 text-braun-400 hover:text-braun-600 transition"
          aria-label="Close"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="p-6 overflow-y-auto max-h-[65vh] space-y-5">
        <!-- Status -->
        <div>
          <label class="form-label">Status</label>
          {#if isSubLocationMode}
            <select
              bind:value={editForm.status}
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
            >
              <option value="">Select status...</option>
              {#each ACCESS_OPTIONS as option}
                <option value={option}>{option}</option>
              {/each}
            </select>
          {:else}
            <select
              bind:value={editForm.access}
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
            >
              <option value="">Select status...</option>
              {#each ACCESS_OPTIONS as option}
                <option value={option}>{option}</option>
              {/each}
            </select>
          {/if}
        </div>

        <!-- Category / Class -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="form-label">{isSubLocationMode ? 'Building Category' : 'Category'}</label>
            <input
              type="text"
              list="category-options"
              bind:value={editForm.category}
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              placeholder={isSubLocationMode ? 'e.g., Administration' : 'e.g., Hospital'}
            />
            <datalist id="category-options">
              {#each categoryOptions as option}
                <option value={option} />
              {/each}
            </datalist>
          </div>
          <div>
            <label class="form-label">Class</label>
            <input
              type="text"
              list="class-options"
              bind:value={editForm.class}
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              placeholder="e.g., Psychiatric"
            />
            <datalist id="class-options">
              {#each classOptions as option}
                <option value={option} />
              {/each}
            </datalist>
          </div>
        </div>

        <!-- Built / Abandoned -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="form-label">Built</label>
            <input
              type="text"
              bind:value={editForm.builtYear}
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              placeholder="e.g., 1920, 1920s"
            />
          </div>
          <div>
            <label class="form-label">Abandoned</label>
            <input
              type="text"
              bind:value={editForm.abandonedYear}
              class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              placeholder="e.g., 2005"
            />
          </div>
        </div>

        <!-- Flags -->
        <div>
          <label class="form-label">Flags</label>
          <div class="flex flex-wrap gap-4">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                bind:checked={editForm.project}
                class="w-4 h-4 text-braun-900 rounded border-braun-300 focus:ring-braun-600"
              />
              <span class="text-sm">Project</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                bind:checked={editForm.favorite}
                class="w-4 h-4 text-braun-900 rounded border-braun-300 focus:ring-braun-600"
              />
              <span class="text-sm">Favorite</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                bind:checked={editForm.historic}
                class="w-4 h-4 text-braun-900 rounded border-braun-300 focus:ring-braun-600"
              />
              <span class="text-sm">Historic</span>
            </label>
          </div>
        </div>

        <!-- Primary Building (sub-location only) -->
        {#if isSubLocationMode}
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              bind:checked={editForm.is_primary}
              class="w-4 h-4 text-braun-900 rounded border-braun-300 focus:ring-braun-600"
            />
            <span class="text-sm font-medium text-braun-700">Primary Building</span>
            <span class="text-xs text-braun-500">(main building on campus)</span>
          </label>
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-braun-200 bg-braun-50">
        <button
          type="button"
          onclick={() => showEditModal = false}
          class="px-4 py-2 text-sm font-medium text-braun-900 bg-white border border-braun-300 rounded hover:bg-braun-100 transition"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={handleSave}
          disabled={saving}
          class="px-4 py-2 text-sm font-medium text-white bg-braun-900 rounded hover:bg-braun-600 transition disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #8A8A86;
    line-height: 1.25;
  }

  .form-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #8A8A86;
    margin-bottom: 4px;
  }
</style>
