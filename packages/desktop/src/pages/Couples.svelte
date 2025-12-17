<script lang="ts">
  /**
   * Couples - Manage wedding projects with workflow status
   * Follows Braun/Ulm functional minimalism
   */
  import type { Couple, CoupleStatus, CoupleInput } from '@nightfox/core';

  interface Props {
    onnavigate?: (page: string, coupleId?: number) => void;
  }

  const { onnavigate }: Props = $props();

  let couples = $state<Couple[]>([]);
  let loading = $state(true);
  let searchQuery = $state('');
  let statusFilter = $state<CoupleStatus | 'all'>('all');
  let showCreateModal = $state(false);
  let showFutureBookings = $state(false);

  // Filter out future booked weddings (next year+) unless explicitly shown
  const displayedCouples = $derived.by(() => {
    if (showFutureBookings || statusFilter === 'booked') {
      return couples;
    }
    const currentYear = new Date().getFullYear();
    return couples.filter(c => {
      // Show all non-booked couples
      if (c.status !== 'booked') return true;
      // For booked, only show current year
      if (!c.wedding_date) return true;
      const weddingYear = parseInt(c.wedding_date.split('-')[0]);
      return weddingYear <= currentYear;
    });
  });

  // Form state
  let formName = $state('');
  let formDate = $state('');
  let formNotes = $state('');
  let formEmail = $state('');
  let formPhone = $state('');
  let formVenueName = $state('');
  let formVenueCity = $state('');
  let formVenueState = $state('');
  let formPackageName = $state('');

  const statusLabels: Record<string, string> = {
    booked: 'Booked',
    ingested: 'Ingested',
    editing: 'Editing',
    delivered: 'Delivered',
    archived: 'Archived',
  };

  const statusOrder: CoupleStatus[] = ['booked', 'ingested', 'editing', 'delivered', 'archived'];

  async function loadCouples() {
    loading = true;
    try {
      if (statusFilter !== 'all') {
        couples = await window.electronAPI.couples.findByStatus(statusFilter);
      } else if (searchQuery) {
        couples = await window.electronAPI.couples.search(searchQuery);
      } else {
        couples = await window.electronAPI.couples.findAll();
      }
    } catch (error) {
      console.error('Failed to load couples:', error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadCouples();
  });

  async function createCouple() {
    if (!formName) return;

    try {
      const input: CoupleInput = {
        name: formName,
        wedding_date: formDate || null,
        notes: formNotes || null,
        email: formEmail || null,
        phone: formPhone || null,
        venue_name: formVenueName || null,
        venue_city: formVenueCity || null,
        venue_state: formVenueState || null,
        package_name: formPackageName || null,
      };
      await window.electronAPI.couples.create(input);
      closeModal();
      await loadCouples();
    } catch (error) {
      console.error('Failed to create couple:', error);
    }
  }

  async function deleteCouple(id: number, event: Event) {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this couple? This will not delete the files.')) {
      return;
    }

    try {
      await window.electronAPI.couples.delete(id);
      await loadCouples();
    } catch (error) {
      console.error('Failed to delete couple:', error);
    }
  }

  function openCreateModal() {
    formName = '';
    formDate = '';
    formNotes = '';
    formEmail = '';
    formPhone = '';
    formVenueName = '';
    formVenueCity = '';
    formVenueState = '';
    formPackageName = '';
    showCreateModal = true;
  }

  function closeModal() {
    showCreateModal = false;
  }

  function handleSearch(event: Event) {
    searchQuery = (event.target as HTMLInputElement).value;
    statusFilter = 'all';
    loadCouples();
  }

  function handleStatusFilter(status: CoupleStatus | 'all') {
    statusFilter = status;
    searchQuery = '';
    loadCouples();
  }

  function handleCoupleClick(coupleId: number) {
    onnavigate?.('couple-detail', coupleId);
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return 'No date';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function formatDuration(seconds: number | null): string {
    if (!seconds) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}h`;
    }
    return `${minutes}m`;
  }

  function getDueDateStatus(weddingDate: string | null, status: CoupleStatus): { color: 'green' | 'yellow' | 'red' | null; daysText: string | null; label: 'wedding' | 'due' | null } {
    if (!weddingDate) {
      return { color: null, daysText: null, label: null };
    }

    const wedding = new Date(weddingDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    wedding.setHours(0, 0, 0, 0);
    const daysUntilWedding = Math.ceil((wedding.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    // For booked status with future wedding: show wedding countdown
    if (status === 'booked' && daysUntilWedding >= 0) {
      let color: 'green' | 'yellow' | 'red';
      if (daysUntilWedding >= 30) {
        color = 'green';
      } else if (daysUntilWedding >= 15) {
        color = 'yellow';
      } else {
        color = 'red';
      }
      const daysText = daysUntilWedding === 0 ? 'Today' : `${daysUntilWedding} days`;
      return { color, daysText, label: 'wedding' };
    }

    // Skip delivered/archived - no urgency display needed
    if (status === 'delivered' || status === 'archived') {
      return { color: null, daysText: null, label: null };
    }

    // For active work statuses (editing): show due date countdown
    const daysElapsed = Math.floor((today.getTime() - wedding.getTime()) / (1000 * 60 * 60 * 24));

    // Skip future weddings for work statuses
    if (daysElapsed < 0) {
      return { color: null, daysText: null, label: null };
    }

    const deadline = 180; // 6 months
    const daysRemaining = deadline - daysElapsed;

    let color: 'green' | 'yellow' | 'red';
    if (daysElapsed <= 120) {
      color = 'green';
    } else if (daysElapsed <= 150) {
      color = 'yellow';
    } else {
      color = 'red';
    }

    let daysText: string;
    if (daysRemaining > 0) {
      daysText = `${daysRemaining} days left`;
    } else {
      daysText = `${Math.abs(daysRemaining)} days overdue`;
    }

    return { color, daysText, label: 'due' };
  }

  // Get counts by status (use displayedCouples for dashboard view)
  const statusCounts = $derived.by(() => {
    const list = displayedCouples;
    const counts: Record<string, number> = { all: list.length };
    for (const status of statusOrder) {
      counts[status] = list.filter((c: Couple) => c.status === status).length;
    }
    return counts;
  });

  // Count of hidden future bookings
  const hiddenFutureCount = $derived.by(() => {
    if (showFutureBookings) return 0;
    const currentYear = new Date().getFullYear();
    return couples.filter(c => {
      if (c.status !== 'booked') return false;
      if (!c.wedding_date) return false;
      const weddingYear = parseInt(c.wedding_date.split('-')[0]);
      return weddingYear > currentYear;
    }).length;
  });
</script>

<div class="page">
  <header class="page-header">
    <div>
      <h1>Couples</h1>
      <p class="page-subtitle">Manage wedding projects and workflow</p>
    </div>
    <button class="btn btn-primary" onclick={openCreateModal}>
      New Couple
    </button>
  </header>

  <!-- Search and Filters -->
  <div class="controls">
    <input
      type="text"
      class="search-input"
      placeholder="Search couples..."
      value={searchQuery}
      oninput={handleSearch}
    />
    <div class="status-filters">
      <button
        class="filter-btn"
        class:active={statusFilter === 'all'}
        onclick={() => handleStatusFilter('all')}
      >
        All
      </button>
      {#each statusOrder as status}
        <button
          class="filter-btn"
          class:active={statusFilter === status}
          onclick={() => handleStatusFilter(status)}
        >
          {statusLabels[status]}
        </button>
      {/each}
    </div>
  </div>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if displayedCouples.length === 0}
    <div class="empty-state">
      {#if searchQuery}
        <h3 class="empty-state__title">No results</h3>
        <p class="empty-state__text">No couples found matching "{searchQuery}"</p>
      {:else if statusFilter !== 'all'}
        <h3 class="empty-state__title">No {statusLabels[statusFilter].toLowerCase()} projects</h3>
        <p class="empty-state__text">No couples with this status</p>
      {:else}
        <h3 class="empty-state__title">No couples yet</h3>
        <p class="empty-state__text">Create your first couple to start tracking your workflow</p>
      {/if}
    </div>
  {:else}
    <!-- Show hidden future bookings notice -->
    {#if hiddenFutureCount > 0 && statusFilter === 'all'}
      <button
        class="future-bookings-toggle"
        onclick={() => showFutureBookings = !showFutureBookings}
      >
        {showFutureBookings ? 'Hide' : 'Show'} {hiddenFutureCount} future booking{hiddenFutureCount === 1 ? '' : 's'} (2026+)
      </button>
    {/if}
    <div class="couples-list">
      {#each displayedCouples as couple}
        {@const dueStatus = getDueDateStatus(couple.wedding_date, couple.status)}
        <div
          class="couple-card"
          role="button"
          tabindex="0"
          onclick={() => handleCoupleClick(couple.id)}
          onkeydown={(e) => e.key === 'Enter' && handleCoupleClick(couple.id)}
        >
          <div class="couple-card__main">
            <div class="couple-card__info">
              <span class="couple-card__name">{couple.name}</span>
              <span
                class="couple-card__date"
                class:due-date--green={dueStatus.color === 'green'}
                class:due-date--yellow={dueStatus.color === 'yellow'}
                class:due-date--red={dueStatus.color === 'red'}
              >
                {formatDate(couple.wedding_date)}{#if dueStatus.daysText} ({dueStatus.daysText}){/if}
              </span>
            </div>
            <div class="couple-card__stats">
              <span class="stat">
                <span class="stat__value">{couple.file_count}</span>
                <span class="stat__label">Files</span>
              </span>
              <span class="stat">
                <span class="stat__value">{formatDuration(couple.total_duration_seconds)}</span>
                <span class="stat__label">Duration</span>
              </span>
            </div>
          </div>
          <div class="couple-card__right">
            <span class="status-badge" data-status={couple.status}>
              {statusLabels[couple.status]}
            </span>
            <button
              class="btn-icon btn-delete"
              onclick={(e) => deleteCouple(couple.id, e)}
              title="Delete couple"
            >
              Delete
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if showCreateModal}
  <div class="modal-overlay" role="dialog" aria-modal="true" onclick={closeModal} onkeydown={(e) => e.key === 'Escape' && closeModal()}>
    <div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <h2>New Couple</h2>
      <form onsubmit={(e) => { e.preventDefault(); createCouple(); }}>
        <div class="form-grid">
          <div class="form-group form-group--full">
            <label for="name">Couple Name</label>
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
            <label for="package">Package</label>
            <input
              id="package"
              type="text"
              placeholder="e.g., Premium"
              bind:value={formPackageName}
            />
          </div>

          <div class="form-group">
            <label for="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="couple@example.com"
              bind:value={formEmail}
            />
          </div>

          <div class="form-group">
            <label for="phone">Phone</label>
            <input
              id="phone"
              type="tel"
              placeholder="(555) 123-4567"
              bind:value={formPhone}
            />
          </div>

          <div class="form-group form-group--full">
            <label for="venue">Venue</label>
            <input
              id="venue"
              type="text"
              placeholder="Venue name"
              bind:value={formVenueName}
            />
          </div>

          <div class="form-group">
            <label for="city">City</label>
            <input
              id="city"
              type="text"
              placeholder="City"
              bind:value={formVenueCity}
            />
          </div>

          <div class="form-group">
            <label for="state">State</label>
            <input
              id="state"
              type="text"
              placeholder="State"
              bind:value={formVenueState}
            />
          </div>

          <div class="form-group form-group--full">
            <label for="notes">Notes</label>
            <textarea
              id="notes"
              placeholder="Optional notes..."
              bind:value={formNotes}
              rows="3"
            ></textarea>
          </div>
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

  .page-subtitle {
    font-size: var(--step-0);
    color: var(--color-text-muted);
    margin: 0.25rem 0 0;
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .search-input {
    width: 100%;
    max-width: 400px;
    padding: 0.625rem 1rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: var(--step-0);
    font-family: var(--font-sans);
    background: var(--color-surface);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--color-text);
  }

  .status-filters {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .filter-btn {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-surface);
    font-size: var(--step--1);
    font-family: var(--font-sans);
    color: var(--color-text-muted);
    cursor: pointer;
    transition: all 0.15s;
  }

  .filter-btn:hover {
    border-color: var(--color-text-muted);
  }

  .filter-btn.active {
    background: var(--color-text);
    color: var(--color-surface);
    border-color: var(--color-text);
  }

  .loading {
    text-align: center;
    padding: 3rem;
    color: var(--color-text-muted);
  }

  .empty-state {
    text-align: center;
    padding: 3rem;
    background: var(--color-surface);
    border: 1px dashed var(--color-border);
    border-radius: 4px;
  }

  .empty-state__title {
    font-size: var(--step-1);
    margin-bottom: 0.5rem;
  }

  .empty-state__text {
    color: var(--color-text-muted);
  }

  .future-bookings-toggle {
    display: block;
    width: 100%;
    padding: 0.625rem 1rem;
    margin-bottom: 0.75rem;
    border: 1px dashed var(--color-border);
    border-radius: 4px;
    background: transparent;
    font-size: var(--step--1);
    font-family: var(--font-sans);
    color: var(--color-text-muted);
    cursor: pointer;
    text-align: center;
    transition: all 0.15s;
  }

  .future-bookings-toggle:hover {
    border-color: var(--color-text-muted);
    color: var(--color-text);
  }

  .couples-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .couple-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    cursor: pointer;
    transition: border-color 0.15s;
    text-align: left;
    width: 100%;
    font-family: inherit;
  }

  .couple-card:hover {
    border-color: var(--color-text-muted);
  }

  .couple-card__main {
    display: flex;
    align-items: center;
    gap: 2rem;
    flex: 1;
    min-width: 0;
  }

  .couple-card__info {
    display: flex;
    flex-direction: column;
    min-width: 200px;
  }

  .couple-card__name {
    font-size: var(--step-1);
    font-weight: 500;
  }

  .couple-card__date {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .due-date--green {
    color: var(--color-status-success);
  }

  .due-date--yellow {
    color: var(--color-status-warning);
  }

  .due-date--red {
    color: var(--color-status-error);
  }

  .couple-card__stats {
    display: flex;
    gap: 2rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
  }

  .stat__value {
    font-weight: 600;
  }

  .stat__label {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .couple-card__right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .status-badge {
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: var(--step--1);
    font-weight: 500;
    background: var(--color-bg-alt);
  }

  .status-badge[data-status="booked"] {
    background: var(--color-status-info);
    color: white;
  }

  .status-badge[data-status="editing"] {
    background: var(--color-status-warning);
    color: black;
  }

  .status-badge[data-status="delivered"] {
    background: var(--color-status-success);
    color: white;
  }

  .status-badge[data-status="archived"] {
    background: var(--color-text-muted);
    color: white;
  }

  .btn-icon {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-surface);
    font-size: var(--step--1);
    font-family: var(--font-sans);
    cursor: pointer;
  }

  .btn-delete {
    color: var(--color-status-error);
  }

  .btn-delete:hover {
    background: var(--color-status-error);
    color: white;
    border-color: var(--color-status-error);
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

  .btn-primary {
    background: var(--color-text);
    color: var(--color-surface);
  }

  .btn-primary:hover {
    background: var(--color-text-secondary);
  }

  .btn-secondary {
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }

  .btn-secondary:hover {
    background: var(--color-bg-alt);
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
    max-width: 560px;
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal h2 {
    margin-bottom: 1.5rem;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .form-group--full {
    grid-column: 1 / -1;
  }

  .form-group label {
    font-size: var(--step--1);
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .form-group input,
  .form-group textarea {
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
    padding-top: 1.5rem;
    border-top: 1px solid var(--color-border);
  }
</style>
