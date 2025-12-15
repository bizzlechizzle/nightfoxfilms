<script lang="ts">
  /**
   * WeddingDetail - Detail view for a single wedding
   * Follows Braun/Ulm functional minimalism
   */
  import StatusBadge from '../components/wedding/StatusBadge.svelte';
  import ProgressBar from '../components/wedding/ProgressBar.svelte';

  type Status = 'imported' | 'culling' | 'editing' | 'delivered' | 'archived';

  interface Wedding {
    id: string;
    partner_a_name: string;
    partner_b_name: string;
    display_name: string;
    email?: string | null;
    phone?: string | null;
    wedding_date: string;
    venue_name?: string | null;
    venue_city?: string | null;
    venue_state?: string | null;
    status: Status;
    date_imported: string;
    date_culling_started?: string | null;
    date_editing_started?: string | null;
    date_delivered?: string | null;
    date_archived?: string | null;
    total_images: number;
    culled_images: number;
    edited_images: number;
    delivered_images: number;
    source_path?: string | null;
    working_path?: string | null;
    delivery_path?: string | null;
    package_name?: string | null;
    contracted_images?: number | null;
    notes?: string | null;
  }

  interface StatusHistoryEntry {
    id: string;
    from_status: Status | null;
    to_status: Status;
    changed_at: string;
    notes?: string | null;
  }

  interface Props {
    weddingId: string;
    onback?: () => void;
  }

  const { weddingId, onback }: Props = $props();

  let wedding = $state<Wedding | null>(null);
  let history = $state<StatusHistoryEntry[]>([]);
  let loading = $state(true);
  let editing = $state(false);
  let editForm = $state<Partial<Wedding>>({});

  async function loadWedding() {
    try {
      wedding = await window.electronAPI.weddings.findById(weddingId);
      history = await window.electronAPI.weddings.getHistory(weddingId);
    } catch (e) {
      console.error('Failed to load wedding:', e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadWedding();
  });

  const statusFlow: Status[] = ['imported', 'culling', 'editing', 'delivered', 'archived'];

  const nextStatus = $derived(() => {
    if (!wedding) return null;
    const currentIndex = statusFlow.indexOf(wedding.status);
    if (currentIndex < statusFlow.length - 1) {
      return statusFlow[currentIndex + 1];
    }
    return null;
  });

  async function advanceStatus() {
    const next = nextStatus();
    if (!wedding || !next) return;

    try {
      await window.electronAPI.weddings.updateStatus(wedding.id, next);
      await loadWedding();
    } catch (e) {
      console.error('Failed to advance status:', e);
    }
  }

  function startEditing() {
    if (!wedding) return;
    editForm = {
      partner_a_name: wedding.partner_a_name,
      partner_b_name: wedding.partner_b_name,
      wedding_date: wedding.wedding_date,
      venue_name: wedding.venue_name || '',
      venue_city: wedding.venue_city || '',
      venue_state: wedding.venue_state || '',
      email: wedding.email || '',
      phone: wedding.phone || '',
      total_images: wedding.total_images,
      culled_images: wedding.culled_images,
      edited_images: wedding.edited_images,
      delivered_images: wedding.delivered_images,
      package_name: wedding.package_name || '',
      contracted_images: wedding.contracted_images,
      notes: wedding.notes || '',
    };
    editing = true;
  }

  async function saveEdits() {
    if (!wedding) return;

    try {
      await window.electronAPI.weddings.update(wedding.id, {
        partner_a_name: editForm.partner_a_name,
        partner_b_name: editForm.partner_b_name,
        wedding_date: editForm.wedding_date,
        venue_name: editForm.venue_name || undefined,
        venue_city: editForm.venue_city || undefined,
        venue_state: editForm.venue_state || undefined,
        email: editForm.email || undefined,
        phone: editForm.phone || undefined,
        total_images: editForm.total_images,
        culled_images: editForm.culled_images,
        edited_images: editForm.edited_images,
        delivered_images: editForm.delivered_images,
        package_name: editForm.package_name || undefined,
        contracted_images: editForm.contracted_images,
        notes: editForm.notes || undefined,
      });
      editing = false;
      await loadWedding();
    } catch (e) {
      console.error('Failed to save edits:', e);
    }
  }

  async function openFolder(folderPath: string) {
    try {
      await window.electronAPI.shell.openPath(folderPath);
    } catch (e) {
      console.error('Failed to open folder:', e);
    }
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function formatShortDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  const progress = $derived(() => {
    if (!wedding) return 0;
    const target = wedding.contracted_images || wedding.total_images;
    if (target === 0) return 0;
    if (wedding.status === 'delivered' || wedding.status === 'archived') return 100;
    return Math.round((wedding.edited_images / target) * 100);
  });

  const statusLabels: Record<Status, string> = {
    imported: 'Imported',
    culling: 'Culling',
    editing: 'Editing',
    delivered: 'Delivered',
    archived: 'Archived',
  };
</script>

<div class="page">
  {#if loading}
    <div class="loading">Loading...</div>
  {:else if wedding}
    <header class="page-header">
      <div class="page-header__left">
        <button class="back-button" type="button" onclick={onback}>
          Back
        </button>
        <div>
          <h1>{wedding.display_name}</h1>
          <p class="page-subtitle">{formatDate(wedding.wedding_date)}</p>
        </div>
      </div>
      <div class="page-header__actions">
        <StatusBadge status={wedding.status} />
        {#if nextStatus()}
          <button class="btn btn-primary" onclick={advanceStatus}>
            Move to {statusLabels[nextStatus()!]}
          </button>
        {/if}
      </div>
    </header>

    <div class="detail-layout">
      <!-- Main Content -->
      <div class="detail-main">
        <!-- Progress Section -->
        <section class="detail-section">
          <h2 class="section-label">Progress</h2>
          <div class="progress-overview">
            <div class="progress-bar-large">
              <ProgressBar
                percent={progress()}
                delivered={wedding.status === 'delivered'}
                showLabel
              />
            </div>
            <div class="progress-stats">
              <div class="progress-stat">
                <span class="progress-stat__value">{wedding.total_images}</span>
                <span class="progress-stat__label">Total</span>
              </div>
              <div class="progress-stat">
                <span class="progress-stat__value">{wedding.culled_images}</span>
                <span class="progress-stat__label">Culled</span>
              </div>
              <div class="progress-stat">
                <span class="progress-stat__value">{wedding.edited_images}</span>
                <span class="progress-stat__label">Edited</span>
              </div>
              <div class="progress-stat">
                <span class="progress-stat__value">{wedding.delivered_images}</span>
                <span class="progress-stat__label">Delivered</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Details Section -->
        <section class="detail-section">
          <div class="section-header">
            <h2 class="section-label">Details</h2>
            {#if !editing}
              <button class="btn btn-secondary" onclick={startEditing}>Edit</button>
            {/if}
          </div>

          {#if editing}
            <form class="edit-form" onsubmit={(e) => { e.preventDefault(); saveEdits(); }}>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="edit-partner-a">Partner A</label>
                  <input
                    type="text"
                    id="edit-partner-a"
                    class="input"
                    bind:value={editForm.partner_a_name}
                  />
                </div>
                <div class="form-group">
                  <label class="form-label" for="edit-partner-b">Partner B</label>
                  <input
                    type="text"
                    id="edit-partner-b"
                    class="input"
                    bind:value={editForm.partner_b_name}
                  />
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="edit-date">Wedding Date</label>
                <input
                  type="date"
                  id="edit-date"
                  class="input"
                  bind:value={editForm.wedding_date}
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="edit-venue">Venue</label>
                <input
                  type="text"
                  id="edit-venue"
                  class="input"
                  bind:value={editForm.venue_name}
                />
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="edit-city">City</label>
                  <input
                    type="text"
                    id="edit-city"
                    class="input"
                    bind:value={editForm.venue_city}
                  />
                </div>
                <div class="form-group">
                  <label class="form-label" for="edit-state">State</label>
                  <input
                    type="text"
                    id="edit-state"
                    class="input"
                    bind:value={editForm.venue_state}
                  />
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="edit-email">Email</label>
                  <input
                    type="email"
                    id="edit-email"
                    class="input"
                    bind:value={editForm.email}
                  />
                </div>
                <div class="form-group">
                  <label class="form-label" for="edit-phone">Phone</label>
                  <input
                    type="tel"
                    id="edit-phone"
                    class="input"
                    bind:value={editForm.phone}
                  />
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="edit-package">Package</label>
                  <input
                    type="text"
                    id="edit-package"
                    class="input"
                    bind:value={editForm.package_name}
                  />
                </div>
                <div class="form-group">
                  <label class="form-label" for="edit-contracted">Contracted</label>
                  <input
                    type="number"
                    id="edit-contracted"
                    class="input"
                    bind:value={editForm.contracted_images}
                  />
                </div>
              </div>

              <h3 class="section-label">Image Counts</h3>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="edit-total">Total</label>
                  <input
                    type="number"
                    id="edit-total"
                    class="input"
                    bind:value={editForm.total_images}
                  />
                </div>
                <div class="form-group">
                  <label class="form-label" for="edit-culled">Culled</label>
                  <input
                    type="number"
                    id="edit-culled"
                    class="input"
                    bind:value={editForm.culled_images}
                  />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="edit-edited">Edited</label>
                  <input
                    type="number"
                    id="edit-edited"
                    class="input"
                    bind:value={editForm.edited_images}
                  />
                </div>
                <div class="form-group">
                  <label class="form-label" for="edit-delivered">Delivered</label>
                  <input
                    type="number"
                    id="edit-delivered"
                    class="input"
                    bind:value={editForm.delivered_images}
                  />
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="edit-notes">Notes</label>
                <textarea
                  id="edit-notes"
                  class="input"
                  rows="3"
                  bind:value={editForm.notes}
                ></textarea>
              </div>

              <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick={() => editing = false}>
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary">Save</button>
              </div>
            </form>
          {:else}
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-item__label">Partner A</span>
                <span class="detail-item__value">{wedding.partner_a_name}</span>
              </div>
              <div class="detail-item">
                <span class="detail-item__label">Partner B</span>
                <span class="detail-item__value">{wedding.partner_b_name}</span>
              </div>
              {#if wedding.venue_name}
                <div class="detail-item detail-item--full">
                  <span class="detail-item__label">Venue</span>
                  <span class="detail-item__value">
                    {wedding.venue_name}
                    {#if wedding.venue_city || wedding.venue_state}
                      <br>
                      <span class="detail-item__subvalue">
                        {[wedding.venue_city, wedding.venue_state].filter(Boolean).join(', ')}
                      </span>
                    {/if}
                  </span>
                </div>
              {/if}
              {#if wedding.email}
                <div class="detail-item">
                  <span class="detail-item__label">Email</span>
                  <span class="detail-item__value">{wedding.email}</span>
                </div>
              {/if}
              {#if wedding.phone}
                <div class="detail-item">
                  <span class="detail-item__label">Phone</span>
                  <span class="detail-item__value">{wedding.phone}</span>
                </div>
              {/if}
              {#if wedding.package_name}
                <div class="detail-item">
                  <span class="detail-item__label">Package</span>
                  <span class="detail-item__value">{wedding.package_name}</span>
                </div>
              {/if}
              {#if wedding.contracted_images}
                <div class="detail-item">
                  <span class="detail-item__label">Contracted</span>
                  <span class="detail-item__value">{wedding.contracted_images} images</span>
                </div>
              {/if}
              {#if wedding.notes}
                <div class="detail-item detail-item--full">
                  <span class="detail-item__label">Notes</span>
                  <span class="detail-item__value">{wedding.notes}</span>
                </div>
              {/if}
            </div>
          {/if}
        </section>

        <!-- Folders Section -->
        <section class="detail-section">
          <h2 class="section-label">Folders</h2>
          <div class="folder-list">
            {#if wedding.source_path}
              <button
                class="folder-item"
                type="button"
                onclick={() => openFolder(wedding!.source_path!)}
              >
                <span class="folder-item__label">Source</span>
                <span class="folder-item__path">{wedding.source_path}</span>
              </button>
            {/if}
            {#if wedding.working_path}
              <button
                class="folder-item"
                type="button"
                onclick={() => openFolder(wedding!.working_path!)}
              >
                <span class="folder-item__label">Working</span>
                <span class="folder-item__path">{wedding.working_path}</span>
              </button>
            {/if}
            {#if wedding.delivery_path}
              <button
                class="folder-item"
                type="button"
                onclick={() => openFolder(wedding!.delivery_path!)}
              >
                <span class="folder-item__label">Delivery</span>
                <span class="folder-item__path">{wedding.delivery_path}</span>
              </button>
            {/if}
          </div>
        </section>
      </div>

      <!-- Sidebar -->
      <aside class="detail-sidebar">
        <!-- Timeline -->
        <section class="detail-section">
          <h2 class="section-label">Timeline</h2>
          <div class="timeline">
            {#each history as entry}
              <div class="timeline-item">
                <span class="timeline-item__status">
                  {entry.from_status ? `${statusLabels[entry.from_status]} to ` : ''}{statusLabels[entry.to_status]}
                </span>
                <span class="timeline-item__date">{formatShortDate(entry.changed_at)}</span>
                {#if entry.notes}
                  <span class="timeline-item__notes">{entry.notes}</span>
                {/if}
              </div>
            {/each}
          </div>
        </section>
      </aside>
    </div>
  {:else}
    <div class="empty-state">
      <h3 class="empty-state__title">Wedding not found</h3>
      <button class="btn btn-secondary" onclick={onback}>Go back</button>
    </div>
  {/if}
</div>

<style>
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 2rem;
  }

  .page-header__left {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }

  .page-header__actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .back-button {
    padding: 0.5rem 0.75rem;
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: var(--step--1);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .back-button:hover {
    border-color: var(--color-text-muted);
  }

  .page-subtitle {
    font-size: var(--step-0);
    color: var(--color-text-muted);
    margin: 0.25rem 0 0;
  }

  .detail-layout {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 2rem;
  }

  .detail-section {
    margin-bottom: 2rem;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .section-header .section-label {
    margin-bottom: 0;
  }

  .progress-overview {
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1.5rem;
  }

  .progress-bar-large {
    margin-bottom: 1.5rem;
  }

  .progress-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    text-align: center;
  }

  .progress-stat__value {
    display: block;
    font-size: var(--step-2);
    font-weight: 700;
  }

  .progress-stat__label {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .detail-item {
    padding: 0.75rem;
    background-color: var(--color-bg-alt);
    border-radius: 4px;
  }

  .detail-item--full {
    grid-column: span 2;
  }

  .detail-item__label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
    margin-bottom: 0.25rem;
  }

  .detail-item__value {
    font-size: var(--step-0);
  }

  .detail-item__subvalue {
    font-size: var(--step--1);
    color: var(--color-text-secondary);
  }

  .folder-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .folder-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem;
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    cursor: pointer;
    transition: border-color 0.15s;
    text-align: left;
    width: 100%;
    font-family: inherit;
  }

  .folder-item:hover {
    border-color: var(--color-text-muted);
  }

  .folder-item__label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
    min-width: 60px;
  }

  .folder-item__path {
    font-size: var(--step--1);
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .timeline {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .timeline-item {
    padding-left: 1rem;
    border-left: 2px solid var(--color-border);
  }

  .timeline-item__status {
    display: block;
    font-size: var(--step--1);
    font-weight: 500;
  }

  .timeline-item__date {
    display: block;
    font-size: 11px;
    color: var(--color-text-muted);
  }

  .timeline-item__notes {
    display: block;
    font-size: var(--step--1);
    color: var(--color-text-secondary);
    margin-top: 0.25rem;
  }

  .edit-form {
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1.5rem;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--color-border);
  }

  textarea.input {
    resize: vertical;
  }

  .loading {
    text-align: center;
    padding: 3rem;
    color: var(--color-text-muted);
  }
</style>
