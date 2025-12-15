<script lang="ts">
  import { getAPI, formatDuration, formatDate } from '../lib/api';
  import type { Couple, CoupleInput } from '../lib/types';

  const api = getAPI();

  let couples = $state<Couple[]>([]);
  let loading = $state(true);
  let searchQuery = $state('');
  let showCreateModal = $state(false);
  let selectedCouple = $state<Couple | null>(null);

  // Form state
  let formName = $state('');
  let formDate = $state('');
  let formNotes = $state('');

  $effect(() => {
    loadCouples();
  });

  async function loadCouples() {
    loading = true;
    try {
      if (searchQuery) {
        couples = await api.couples.search(searchQuery);
      } else {
        couples = await api.couples.findAll();
      }
    } catch (error) {
      console.error('Failed to load couples:', error);
    } finally {
      loading = false;
    }
  }

  async function createCouple() {
    if (!formName) return;

    try {
      const input: CoupleInput = {
        name: formName,
        wedding_date: formDate || null,
        notes: formNotes || null,
      };
      await api.couples.create(input);
      closeModal();
      await loadCouples();
    } catch (error) {
      console.error('Failed to create couple:', error);
    }
  }

  async function deleteCouple(id: number) {
    if (!confirm('Are you sure you want to delete this couple? This will not delete the files.')) {
      return;
    }

    try {
      await api.couples.delete(id);
      await loadCouples();
    } catch (error) {
      console.error('Failed to delete couple:', error);
    }
  }

  async function exportCouple(id: number) {
    try {
      const path = await api.couples.exportJson(id);
      if (path) {
        console.log('Exported to:', path);
      }
    } catch (error) {
      console.error('Failed to export couple:', error);
    }
  }

  function openCreateModal() {
    formName = '';
    formDate = '';
    formNotes = '';
    selectedCouple = null;
    showCreateModal = true;
  }

  function closeModal() {
    showCreateModal = false;
    selectedCouple = null;
  }

  function handleSearch(event: Event) {
    searchQuery = (event.target as HTMLInputElement).value;
    loadCouples();
  }
</script>

<div class="page">
  <header class="page-header">
    <div class="header-content">
      <h2>Couples</h2>
      <p class="subtitle">Manage wedding couples and their footage</p>
    </div>
    <button class="btn btn-primary" onclick={openCreateModal}>
      New Couple
    </button>
  </header>

  <div class="search-bar">
    <input
      type="text"
      placeholder="Search couples..."
      value={searchQuery}
      oninput={handleSearch}
    />
  </div>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if couples.length === 0}
    <div class="empty-state">
      {#if searchQuery}
        <p>No couples found matching "{searchQuery}"</p>
      {:else}
        <p>No couples yet.</p>
        <p>Create your first couple to start organizing footage.</p>
      {/if}
    </div>
  {:else}
    <div class="couples-grid">
      {#each couples as couple}
        <div class="couple-card">
          <div class="couple-header">
            <h3>{couple.name}</h3>
            <span class="couple-date">{formatDate(couple.wedding_date)}</span>
          </div>
          <div class="couple-body">
            <div class="stat">
              <span class="stat-value">{couple.file_count}</span>
              <span class="stat-label">Files</span>
            </div>
            <div class="stat">
              <span class="stat-value">{formatDuration(couple.total_duration_seconds)}</span>
              <span class="stat-label">Duration</span>
            </div>
          </div>
          {#if couple.notes}
            <p class="couple-notes">{couple.notes}</p>
          {/if}
          <div class="couple-actions">
            <button class="btn btn-small" onclick={() => exportCouple(couple.id)}>
              Export
            </button>
            <button class="btn btn-small btn-danger" onclick={() => deleteCouple(couple.id)}>
              Delete
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if showCreateModal}
  <div class="modal-overlay" onclick={closeModal}>
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <h3>New Couple</h3>
      <form onsubmit={(e) => { e.preventDefault(); createCouple(); }}>
        <div class="form-group">
          <label for="name">Name</label>
          <input
            id="name"
            type="text"
            placeholder="e.g., Smith & Jones"
            bind:value={formName}
            required
          />
        </div>
        <div class="form-group">
          <label for="date">Wedding Date</label>
          <input
            id="date"
            type="date"
            bind:value={formDate}
          />
        </div>
        <div class="form-group">
          <label for="notes">Notes</label>
          <textarea
            id="notes"
            placeholder="Optional notes..."
            bind:value={formNotes}
            rows="3"
          ></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick={closeModal}>
            Cancel
          </button>
          <button type="submit" class="btn btn-primary">
            Create
          </button>
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
    margin-bottom: 1.5rem;
  }

  .header-content h2 {
    margin-bottom: 0.25rem;
  }

  .subtitle {
    color: var(--color-text-muted);
    margin: 0;
  }

  .search-bar {
    margin-bottom: 1.5rem;
  }

  .search-bar input {
    width: 100%;
    max-width: 400px;
    padding: 0.625rem 1rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: var(--step-0);
    font-family: var(--font-sans);
    background: var(--color-surface);
  }

  .search-bar input:focus {
    outline: none;
    border-color: var(--color-text);
  }

  .loading, .empty-state {
    padding: 3rem;
    text-align: center;
    background: var(--color-surface);
    border: 1px dashed var(--color-border);
    border-radius: 4px;
    color: var(--color-text-muted);
  }

  .couples-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem;
  }

  .couple-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1.25rem;
  }

  .couple-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1rem;
  }

  .couple-header h3 {
    font-size: var(--step-1);
    margin: 0;
  }

  .couple-date {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .couple-body {
    display: flex;
    gap: 2rem;
    margin-bottom: 1rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
  }

  .stat-value {
    font-size: var(--step-1);
    font-weight: 600;
  }

  .stat-label {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .couple-notes {
    font-size: var(--step--1);
    color: var(--color-text-secondary);
    margin-bottom: 1rem;
  }

  .couple-actions {
    display: flex;
    gap: 0.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--color-border);
  }

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

  .btn-danger {
    background: var(--color-status-error);
    color: white;
  }

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
    max-width: 480px;
  }

  .modal h3 {
    margin-bottom: 1.5rem;
  }

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
  .form-group textarea {
    width: 100%;
    padding: 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: var(--step-0);
    font-family: var(--font-sans);
  }

  .form-group input:focus,
  .form-group textarea:focus {
    outline: none;
    border-color: var(--color-text);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }
</style>
