<script lang="ts">
  import { onMount } from 'svelte';
  import { router } from '../stores/router';

  interface Project {
    project_id: string;
    project_name: string;
    description: string | null;
    created_date: string;
    auth_imp: string | null;
    location_count?: number;
  }

  let projects = $state<Project[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showCreateForm = $state(false);
  let newProjectName = $state('');
  let newProjectDescription = $state('');
  let creating = $state(false);
  let currentUser = $state('default');

  async function loadProjects() {
    try {
      loading = true;
      error = null;
      if (!window.electronAPI?.projects) {
        console.error('Electron API not available - preload script may have failed to load');
        error = 'API not available';
        return;
      }
      const result = (await window.electronAPI.projects.findAll()) as Project[];
      projects = result;
    } catch (err) {
      console.error('Error loading projects:', err);
      error = 'Failed to load projects';
    } finally {
      loading = false;
    }
  }

  async function handleCreateProject() {
    if (!newProjectName.trim()) return;
    if (!window.electronAPI?.projects) return;

    try {
      creating = true;
      error = null;

      await window.electronAPI.projects.create({
        project_name: newProjectName.trim(),
        description: newProjectDescription.trim() || null,
        auth_imp: currentUser,
      });

      newProjectName = '';
      newProjectDescription = '';
      showCreateForm = false;
      await loadProjects();
    } catch (err) {
      console.error('Error creating project:', err);
      error = 'Failed to create project';
    } finally {
      creating = false;
    }
  }

  async function handleDeleteProject(project_id: string, project_name: string) {
    if (!confirm(`Are you sure you want to delete project "${project_name}"?`)) return;
    if (!window.electronAPI?.projects) return;

    try {
      error = null;
      await window.electronAPI.projects.delete(project_id);
      await loadProjects();
    } catch (err) {
      console.error('Error deleting project:', err);
      error = 'Failed to delete project';
    }
  }

  function viewProject(project_id: string) {
    router.navigate(`/project/${project_id}`);
  }

  function formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  onMount(async () => {
    await loadProjects();

    // Load current user
    try {
      if (window.electronAPI?.settings) {
        const settings = await window.electronAPI.settings.getAll();
        currentUser = settings.current_user || 'default';
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    }
  });
</script>

<div class="p-8">
  <div class="mb-8 flex justify-between items-center">
    <div>
      <h1 class="text-3xl font-bold text-foreground mb-2">Projects</h1>
      <p class="text-braun-600">Organize locations into projects</p>
    </div>
    {#if !showCreateForm}
      <button
        onclick={() => (showCreateForm = true)}
        class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition"
      >
        New Project
      </button>
    {/if}
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-100 text-red-700 rounded">
      {error}
    </div>
  {/if}

  {#if showCreateForm}
    <div class="mb-6 p-6 bg-white rounded border border-braun-300">
      <h2 class="text-lg font-semibold mb-4">Create New Project</h2>
      <div class="space-y-4">
        <div>
          <label for="project_name" class="block text-sm font-medium text-braun-700 mb-1">
            Project Name <span class="text-red-500">*</span>
          </label>
          <input
            id="project_name"
            type="text"
            bind:value={newProjectName}
            placeholder="Enter project name"
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          />
        </div>
        <div>
          <label for="description" class="block text-sm font-medium text-braun-700 mb-1">
            Description
          </label>
          <textarea
            id="description"
            bind:value={newProjectDescription}
            placeholder="Enter project description"
            rows="3"
            class="w-full px-3 py-2 border border-braun-300 rounded focus:outline-none focus:border-braun-600"
          ></textarea>
        </div>
        <div class="flex justify-end gap-2">
          <button
            onclick={() => {
              showCreateForm = false;
              newProjectName = '';
              newProjectDescription = '';
            }}
            disabled={creating}
            class="px-4 py-2 bg-braun-200 text-foreground rounded hover:bg-braun-300 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onclick={handleCreateProject}
            disabled={creating || !newProjectName.trim()}
            class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if loading}
    <p class="text-braun-500">Loading projects...</p>
  {:else if projects.length === 0}
    <div class="bg-white rounded border border-braun-300 p-12 text-center">
      <p class="text-braun-400 mb-4">No projects yet</p>
      <button
        onclick={() => (showCreateForm = true)}
        class="px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition"
      >
        Create Your First Project
      </button>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each projects as project}
        <div class="bg-white rounded border border-braun-300 p-6 hover:border-braun-400 transition">
          <div class="flex justify-between items-start mb-3">
            <h3 class="text-lg font-semibold text-foreground">{project.project_name}</h3>
            <button
              onclick={(e) => {
                e.stopPropagation();
                handleDeleteProject(project.project_id, project.project_name);
              }}
              class="text-red-600 hover:text-red-800 text-sm"
            >
              Delete
            </button>
          </div>
          {#if project.description}
            <p class="text-sm text-braun-600 mb-4 line-clamp-2">{project.description}</p>
          {/if}
          <div class="text-sm text-braun-500 mb-4">
            <p>Created: {formatDate(project.created_date)}</p>
            <p class="font-semibold text-braun-900 mt-1">
              {project.location_count || 0} locations
            </p>
          </div>
          <button
            onclick={() => viewProject(project.project_id)}
            class="w-full px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition"
          >
            View Project
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>
