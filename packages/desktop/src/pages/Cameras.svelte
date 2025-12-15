<script lang="ts">
  import { getAPI, getMediumName } from '../lib/api';
  import type { CameraWithPatterns, CameraInput, CameraPatternInput, Medium, PatternType } from '../lib/types';

  const api = getAPI();

  let cameras = $state<CameraWithPatterns[]>([]);
  let loading = $state(true);
  let showCreateModal = $state(false);
  let showPatternModal = $state(false);
  let selectedCamera = $state<CameraWithPatterns | null>(null);

  // Camera form state
  let formName = $state('');
  let formMedium = $state<Medium>('modern');
  let formMake = $state('');
  let formModel = $state('');
  let formNotes = $state('');
  let formDeinterlace = $state(false);
  let formIsDefault = $state(false);

  // Pattern form state
  let patternType = $state<PatternType>('filename');
  let patternValue = $state('');
  let patternPriority = $state(0);

  $effect(() => {
    loadCameras();
  });

  async function loadCameras() {
    loading = true;
    try {
      cameras = await api.cameras.findAll();
    } catch (error) {
      console.error('Failed to load cameras:', error);
    } finally {
      loading = false;
    }
  }

  async function createCamera() {
    if (!formName) return;

    try {
      const input: CameraInput = {
        name: formName,
        medium: formMedium,
        make: formMake || null,
        model: formModel || null,
        notes: formNotes || null,
        deinterlace: formDeinterlace,
        is_default: formIsDefault,
      };
      await api.cameras.create(input);
      closeModal();
      await loadCameras();
    } catch (error) {
      console.error('Failed to create camera:', error);
    }
  }

  async function deleteCamera(id: number) {
    if (!confirm('Are you sure you want to delete this camera profile?')) return;

    try {
      await api.cameras.delete(id);
      await loadCameras();
    } catch (error) {
      console.error('Failed to delete camera:', error);
    }
  }

  async function setDefault(id: number) {
    try {
      await api.cameras.setDefault(id);
      await loadCameras();
    } catch (error) {
      console.error('Failed to set default:', error);
    }
  }

  async function addPattern() {
    if (!selectedCamera || !patternValue) return;

    try {
      const input: CameraPatternInput = {
        camera_id: selectedCamera.id,
        pattern_type: patternType,
        pattern: patternValue,
        priority: patternPriority,
      };
      await api.cameraPatterns.create(input);
      closePatternModal();
      await loadCameras();
    } catch (error) {
      console.error('Failed to add pattern:', error);
    }
  }

  async function deletePattern(patternId: number) {
    try {
      await api.cameraPatterns.delete(patternId);
      await loadCameras();
    } catch (error) {
      console.error('Failed to delete pattern:', error);
    }
  }

  function openCreateModal() {
    formName = '';
    formMedium = 'modern';
    formMake = '';
    formModel = '';
    formNotes = '';
    formDeinterlace = false;
    formIsDefault = false;
    showCreateModal = true;
  }

  function closeModal() {
    showCreateModal = false;
  }

  function openPatternModal(camera: CameraWithPatterns) {
    selectedCamera = camera;
    patternType = 'filename';
    patternValue = '';
    patternPriority = 0;
    showPatternModal = true;
  }

  function closePatternModal() {
    showPatternModal = false;
    selectedCamera = null;
  }
</script>

<div class="page">
  <header class="page-header">
    <div class="header-content">
      <h2>Cameras</h2>
      <p class="subtitle">Configure camera profiles and filename patterns</p>
    </div>
    <button class="btn btn-primary" onclick={openCreateModal}>
      Add Camera
    </button>
  </header>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if cameras.length === 0}
    <div class="empty-state">
      <p>No camera profiles yet.</p>
      <p>Add cameras to automatically match imported files.</p>
    </div>
  {:else}
    <div class="medium-sections">
      {#each ['modern', 'dadcam', 'super8'] as medium}
        {@const mediumCameras = cameras.filter(c => c.medium === medium)}
        {#if mediumCameras.length > 0}
          <section class="medium-section">
            <h3 class="medium-header">
              <span class="medium-badge medium-{medium}"></span>
              {getMediumName(medium as Medium)}
            </h3>
            <div class="cameras-list">
              {#each mediumCameras as camera}
                <div class="camera-card">
                  <div class="camera-header">
                    <div class="camera-info">
                      <h4>
                        {camera.name}
                        {#if camera.is_default}
                          <span class="default-badge">Default</span>
                        {/if}
                      </h4>
                      {#if camera.make || camera.model}
                        <span class="camera-meta">
                          {[camera.make, camera.model].filter(Boolean).join(' ')}
                        </span>
                      {/if}
                    </div>
                    <div class="camera-actions">
                      {#if !camera.is_default}
                        <button class="btn btn-small" onclick={() => setDefault(camera.id)}>
                          Set Default
                        </button>
                      {/if}
                      <button class="btn btn-small" onclick={() => openPatternModal(camera)}>
                        Add Pattern
                      </button>
                      <button class="btn btn-small btn-danger" onclick={() => deleteCamera(camera.id)}>
                        Delete
                      </button>
                    </div>
                  </div>

                  {#if camera.patterns.length > 0}
                    <div class="patterns-list">
                      {#each camera.patterns as pattern}
                        <div class="pattern-item">
                          <span class="pattern-type">{pattern.pattern_type}</span>
                          <code class="pattern-value">{pattern.pattern}</code>
                          <span class="pattern-priority">P{pattern.priority}</span>
                          <button
                            class="pattern-delete"
                            onclick={() => deletePattern(pattern.id)}
                          >
                            x
                          </button>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <p class="no-patterns">No patterns defined</p>
                  {/if}

                  {#if camera.notes}
                    <p class="camera-notes">{camera.notes}</p>
                  {/if}
                </div>
              {/each}
            </div>
          </section>
        {/if}
      {/each}
    </div>
  {/if}
</div>

{#if showCreateModal}
  <div class="modal-overlay" onclick={closeModal}>
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <h3>Add Camera</h3>
      <form onsubmit={(e) => { e.preventDefault(); createCamera(); }}>
        <div class="form-row">
          <div class="form-group">
            <label for="name">Name</label>
            <input id="name" type="text" bind:value={formName} required />
          </div>
          <div class="form-group">
            <label for="medium">Medium</label>
            <select id="medium" bind:value={formMedium}>
              <option value="modern">Modern</option>
              <option value="dadcam">Dad Cam</option>
              <option value="super8">Super 8</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="make">Make (optional)</label>
            <input id="make" type="text" bind:value={formMake} placeholder="e.g., Sony" />
          </div>
          <div class="form-group">
            <label for="model">Model (optional)</label>
            <input id="model" type="text" bind:value={formModel} placeholder="e.g., FX3" />
          </div>
        </div>
        <div class="form-group">
          <label for="notes">Notes</label>
          <textarea id="notes" bind:value={formNotes} rows="2"></textarea>
        </div>
        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={formDeinterlace} />
            Needs deinterlacing
          </label>
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={formIsDefault} />
            Set as default for medium
          </label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick={closeModal}>Cancel</button>
          <button type="submit" class="btn btn-primary">Create</button>
        </div>
      </form>
    </div>
  </div>
{/if}

{#if showPatternModal && selectedCamera}
  <div class="modal-overlay" onclick={closePatternModal}>
    <div class="modal modal-small" onclick={(e) => e.stopPropagation()}>
      <h3>Add Pattern for {selectedCamera.name}</h3>
      <form onsubmit={(e) => { e.preventDefault(); addPattern(); }}>
        <div class="form-group">
          <label for="patternType">Pattern Type</label>
          <select id="patternType" bind:value={patternType}>
            <option value="filename">Filename</option>
            <option value="folder">Folder</option>
            <option value="extension">Extension</option>
          </select>
        </div>
        <div class="form-group">
          <label for="patternValue">Pattern</label>
          <input
            id="patternValue"
            type="text"
            bind:value={patternValue}
            placeholder={patternType === 'filename' ? 'e.g., MVI_*' : patternType === 'folder' ? 'e.g., DCIM' : 'e.g., .mts'}
            required
          />
          <span class="help-text">Use * for wildcards</span>
        </div>
        <div class="form-group">
          <label for="patternPriority">Priority</label>
          <input
            id="patternPriority"
            type="number"
            bind:value={patternPriority}
            min="0"
            max="100"
          />
          <span class="help-text">Lower numbers match first</span>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick={closePatternModal}>Cancel</button>
          <button type="submit" class="btn btn-primary">Add</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 2rem;
  }

  .header-content h2 { margin-bottom: 0.25rem; }
  .subtitle { color: var(--color-text-muted); margin: 0; }

  .loading, .empty-state {
    padding: 3rem;
    text-align: center;
    background: var(--color-surface);
    border: 1px dashed var(--color-border);
    border-radius: 4px;
    color: var(--color-text-muted);
  }

  .medium-sections { display: flex; flex-direction: column; gap: 2rem; }

  .medium-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    font-size: var(--step-1);
  }

  .medium-badge {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }

  .medium-modern { background: var(--color-medium-modern); }
  .medium-dadcam { background: var(--color-medium-dadcam); }
  .medium-super8 { background: var(--color-medium-super8); }

  .cameras-list { display: flex; flex-direction: column; gap: 0.75rem; }

  .camera-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1rem 1.25rem;
  }

  .camera-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.75rem;
  }

  .camera-info h4 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .default-badge {
    font-size: var(--step--2);
    background: var(--color-status-success);
    color: white;
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    font-weight: 500;
  }

  .camera-meta {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .camera-actions { display: flex; gap: 0.5rem; }

  .patterns-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .pattern-item {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    background: var(--color-bg-alt);
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    font-size: var(--step--1);
  }

  .pattern-type {
    color: var(--color-text-muted);
    text-transform: uppercase;
    font-size: var(--step--2);
  }

  .pattern-value {
    font-family: var(--font-mono);
    background: none;
  }

  .pattern-priority {
    color: var(--color-text-muted);
    font-size: var(--step--2);
  }

  .pattern-delete {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 0;
    font-size: var(--step--1);
  }

  .pattern-delete:hover { color: var(--color-status-error); }

  .no-patterns {
    font-size: var(--step--1);
    color: var(--color-text-muted);
    margin: 0;
  }

  .camera-notes {
    font-size: var(--step--1);
    color: var(--color-text-secondary);
    margin: 0;
    padding-top: 0.5rem;
    border-top: 1px solid var(--color-border);
  }

  .btn {
    padding: 0.625rem 1.25rem;
    border: none;
    border-radius: 4px;
    font-size: var(--step-0);
    font-family: var(--font-sans);
    cursor: pointer;
  }

  .btn-small { padding: 0.375rem 0.75rem; font-size: var(--step--1); }
  .btn-primary { background: var(--color-text); color: var(--color-surface); }
  .btn-secondary { background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border); }
  .btn-danger { background: var(--color-status-error); color: white; }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: var(--color-surface);
    border-radius: 4px;
    padding: 1.5rem;
    width: 100%;
    max-width: 560px;
  }

  .modal-small { max-width: 400px; }

  .modal h3 { margin-bottom: 1.5rem; }

  .form-row {
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .form-row .form-group { flex: 1; }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.375rem;
    font-size: var(--step--1);
    font-weight: 500;
  }

  .form-group input,
  .form-group select,
  .form-group textarea {
    width: 100%;
    padding: 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: var(--step-0);
    font-family: var(--font-sans);
  }

  .help-text {
    display: block;
    margin-top: 0.25rem;
    font-size: var(--step--2);
    color: var(--color-text-muted);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--step--1);
    cursor: pointer;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }
</style>
