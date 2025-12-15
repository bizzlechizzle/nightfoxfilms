<script lang="ts">
  import { onMount } from 'svelte';
  import { router } from '../stores/router';
  import Map from '../components/Map.svelte';

  interface Props {
    projectId: string;
  }

  let { projectId }: Props = $props();

  interface ProjectWithLocations {
    project_id: string;
    project_name: string;
    description: string | null;
    created_date: string;
    auth_imp: string | null;
    location_count?: number;
    locations: Array<{
      locid: string;
      locnam: string;
      address_state: string | null;
      added_date: string;
    }>;
  }

  interface Location {
    locid: string;
    locnam: string;
    address?: { state?: string | null };
  }

  let project = $state<ProjectWithLocations | null>(null);
  let allLocations = $state<Location[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showAddLocation = $state(false);
  let selectedLocationId = $state('');
  let adding = $state(false);
  let isEditing = $state(false);
  let editName = $state('');
  let editDescription = $state('');
  let saving = $state(false);

  async function loadProject() {
    try {
      loading = true;
      error = null;
      const [proj, locs] = await Promise.all([
        window.electronAPI.projects.findByIdWithLocations(projectId) as Promise<ProjectWithLocations>,
        window.electronAPI.locations.findAll() as Promise<Location[]>,
      ]);
      project = proj;
      allLocations = locs.filter(loc => !proj.locations.some(pl => pl.locid === loc.locid));
    } catch (err) {
      console.error('Error loading project:', err);
      error = 'Failed to load project';
    } finally {
      loading = false;
    }
  }

  async function handleAddLocation() {
    if (!selectedLocationId || !project) return;

    try {
      adding = true;
      error = null;
      await window.electronAPI.projects.addLocation(project.project_id, selectedLocationId);
      selectedLocationId = '';
      showAddLocation = false;
      await loadProject();
    } catch (err) {
      console.error('Error adding location:', err);
      error = 'Failed to add location';
    } finally {
      adding = false;
    }
  }

  async function handleRemoveLocation(locid: string) {
    if (!project || !confirm('Remove this location from the project?')) return;

    try {
      error = null;
      await window.electronAPI.projects.removeLocation(project.project_id, locid);
      await loadProject();
    } catch (err) {
      console.error('Error removing location:', err);
      error = 'Failed to remove location';
    }
  }

  function startEdit() {
    if (!project) return;
    editName = project.project_name;
    editDescription = project.description || '';
    isEditing = true;
  }

  async function handleSaveEdit() {
    if (!project || !editName.trim()) return;

    try {
      saving = true;
      error = null;
      await window.electronAPI.projects.update(project.project_id, {
        project_name: editName.trim(),
        description: editDescription.trim() || null,
      });
      isEditing = false;
      await loadProject();
    } catch (err) {
      console.error('Error updating project:', err);
      error = 'Failed to update project';
    } finally {
      saving = false;
    }
  }

  function viewLocation(locid: string) {
    router.navigate(`/location/${locid}`);
  }

  onMount(() => {
    loadProject();
  });
</script>

<div class="h-full overflow-auto">
  {#if loading}
    <div class="p-8">
      <p class="text-braun-500">Loading project...</p>
    </div>
  {:else if error || !project}
    <div class="p-8">
      <p class="text-red-600">{error || 'Project not found'}</p>
      <button
        onclick={() => router.navigate({ page: 'projects' })}
        class="mt-4 px-4 py-2 bg-braun-200 rounded hover:bg-braun-300"
      >
        Back to Projects
      </button>
    </div>
  {:else}
    <div class="p-8">
      {#if isEditing}
        <div class="mb-8 bg-white rounded border border-braun-300 p-6">
          <h2 class="text-lg font-semibold mb-4">Edit Project</h2>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-braun-700 mb-1">Project Name</label>
              <input
                type="text"
                bind:value={editName}
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-braun-700 mb-1">Description</label>
              <textarea
                bind:value={editDescription}
                rows="3"
                class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
              ></textarea>
            </div>
            <div class="flex justify-end gap-2">
              <button
                onclick={() => (isEditing = false)}
                disabled={saving}
                class="px-4 py-2 bg-braun-200 rounded hover:bg-braun-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onclick={handleSaveEdit}
                disabled={saving || !editName.trim()}
                class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      {:else}
        <div class="mb-8 flex justify-between items-start">
          <div>
            <h1 class="text-3xl font-bold text-foreground mb-2">{project.project_name}</h1>
            {#if project.description}
              <p class="text-braun-600 mb-2">{project.description}</p>
            {/if}
            <p class="text-sm text-braun-500">
              {project.locations.length} locations
            </p>
          </div>
          <div class="flex gap-2">
            <button
              onclick={startEdit}
              class="px-4 py-2 bg-braun-200 rounded hover:bg-braun-300"
            >
              Edit
            </button>
            <button
              onclick={() => router.navigate({ page: 'projects' })}
              class="px-4 py-2 bg-braun-200 rounded hover:bg-braun-300"
            >
              Back
            </button>
          </div>
        </div>
      {/if}

      {#if error}
        <div class="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          {error}
        </div>
      {/if}

      {#if showAddLocation}
        <div class="mb-6 p-6 bg-white rounded border border-braun-300">
          <h3 class="text-lg font-semibold mb-4">Add Location to Project</h3>
          <select
            bind:value={selectedLocationId}
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600 mb-4"
          >
            <option value="">Select a location...</option>
            {#each allLocations as loc}
              <option value={loc.locid}>
                {loc.locnam} {loc.address?.state ? `(${loc.address.state})` : ''}
              </option>
            {/each}
          </select>
          <div class="flex justify-end gap-2">
            <button
              onclick={() => {
                showAddLocation = false;
                selectedLocationId = '';
              }}
              disabled={adding}
              class="px-4 py-2 bg-braun-200 rounded hover:bg-braun-300 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onclick={handleAddLocation}
              disabled={adding || !selectedLocationId}
              class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 disabled:opacity-50"
            >
              {adding ? 'Adding...' : 'Add Location'}
            </button>
          </div>
        </div>
      {/if}

      <div class="bg-white rounded border border-braun-300 p-6 mb-6">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-semibold">Locations</h2>
          <button
            onclick={() => (showAddLocation = true)}
            class="px-4 py-2 text-sm bg-braun-900 text-white rounded hover:bg-braun-600"
          >
            Add Location
          </button>
        </div>

        {#if project.locations.length === 0}
          <p class="text-braun-400 text-center py-8">No locations in this project yet</p>
        {:else}
          <div class="space-y-2">
            {#each project.locations as loc}
              <div class="flex items-center justify-between p-3 bg-braun-50 rounded hover:bg-braun-100 transition">
                <button
                  onclick={() => viewLocation(loc.locid)}
                  class="flex-1 text-left"
                >
                  <p class="font-medium text-braun-900">{loc.locnam}</p>
                  {#if loc.address_state}
                    <p class="text-sm text-braun-500">{loc.address_state}</p>
                  {/if}
                </button>
                <button
                  onclick={() => handleRemoveLocation(loc.locid)}
                  class="text-sm text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
