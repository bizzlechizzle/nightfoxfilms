<script lang="ts">
  /**
   * CoupleDetail - View and manage individual wedding project
   * Based on wireframe: Couples Name.pdf
   * Follows Braun/Ulm functional minimalism
   */
  import type {
    CoupleWithFiles,
    CoupleStatus,
    CoupleDeliverable,
    DeliverableType,
    EmailLogEntry
  } from '@nightfox/core';

  interface Props {
    coupleId: number;
    onback?: () => void;
  }

  const { coupleId, onback }: Props = $props();

  let couple = $state<CoupleWithFiles | null>(null);
  let loading = $state(true);

  const statusLabels: Record<CoupleStatus, string> = {
    booked: 'Booked',
    ingested: 'Ingested',
    editing: 'Editing',
    delivered: 'Delivered',
    archived: 'Archived',
  };

  const deliverableLabels: Record<DeliverableType, string> = {
    highlight: 'Highlight Film',
    trailer: 'Trailer',
    full_length: 'Full Length',
    raw_footage: 'Raw Footage',
    social_clips: 'Social Clips',
    ceremony: 'Ceremony',
    reception: 'Reception',
  };

  // Parse deliverables from JSON or generate defaults
  const deliverables = $derived<CoupleDeliverable[]>(() => {
    if (!couple) return [];
    if (couple.deliverables_json) {
      try {
        return JSON.parse(couple.deliverables_json);
      } catch {
        return [];
      }
    }
    // Generate defaults based on contracted count
    const count = couple.contracted_deliverables || 2;
    const defaults: CoupleDeliverable[] = [
      { type: 'highlight', status: 'pending' },
      { type: 'trailer', status: 'pending' },
    ];
    if (count > 2) defaults.push({ type: 'full_length', status: 'pending' });
    if (count > 3) defaults.push({ type: 'social_clips', status: 'pending' });
    return defaults.slice(0, count);
  });

  // Parse email log
  const emailLog = $derived<EmailLogEntry[]>(() => {
    if (!couple?.email_log_json) return [];
    try {
      return JSON.parse(couple.email_log_json);
    } catch {
      return [];
    }
  });

  // Calculate due date
  const dueDate = $derived(() => {
    if (!couple) return null;
    if (couple.due_date) return couple.due_date;
    if (!couple.wedding_date) return null;
    const wedding = new Date(couple.wedding_date);
    const turnaround = couple.turnaround_days || 180;
    wedding.setDate(wedding.getDate() + turnaround);
    return wedding.toISOString().split('T')[0];
  });

  // Days left until due
  const daysLeft = $derived(() => {
    const due = dueDate();
    if (!due) return null;
    const dueD = new Date(due);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dueD.setHours(0, 0, 0, 0);
    return Math.ceil((dueD.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  });

  // Urgency class
  const daysLeftClass = $derived(() => {
    const days = daysLeft();
    if (days === null) return '';
    if (days < 0) return 'overdue';
    if (days <= 14) return 'urgent';
    if (days <= 30) return 'warning';
    return 'ok';
  });

  // Pending emails based on status
  const pendingEmails = $derived(() => {
    if (!couple) return [];
    const sentTypes = new Set(emailLog().filter(e => e.sent).map(e => e.type));
    const pending: string[] = [];

    if (!sentTypes.has('booking_confirmation')) pending.push('Booking Confirmation');
    if (['editing', 'delivered', 'archived'].includes(couple.status) && !sentTypes.has('preview_ready')) pending.push('Preview Ready');
    if (['delivered', 'archived'].includes(couple.status) && !sentTypes.has('delivery')) pending.push('Delivery Email');

    return pending;
  });

  // Timeline events - completed status derived from workflow progression
  const timelineEvents = $derived(() => {
    if (!couple) return [];
    const statusOrder = ['booked', 'ingested', 'editing', 'delivered', 'archived'];
    const currentIndex = statusOrder.indexOf(couple.status);
    return [
      { label: 'Booked', date: couple.created_at?.split('T')[0], completed: true },
      { label: 'Wedding', date: couple.wedding_date, completed: currentIndex >= 1 },
      { label: 'Ingested', date: couple.date_ingested, completed: currentIndex >= 1 },
      { label: 'Editing', date: couple.date_editing_started, completed: currentIndex >= 2 },
      { label: 'Delivered', date: couple.date_delivered, completed: currentIndex >= 3 },
      { label: 'Archived', date: couple.date_archived, completed: currentIndex >= 4 },
    ];
  });

  async function loadCouple() {
    loading = true;
    try {
      couple = await window.electronAPI.couples.findWithFiles(coupleId);
    } catch (e) {
      console.error('Failed to load couple:', e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadCouple();
  });

  function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateLong(dateStr: string | null): string {
    if (!dateStr) return 'Not set';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function formatDuration(seconds: number | null): string {
    if (!seconds) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  function formatFileSize(bytes: number | null): string {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
</script>

<div class="page">
  {#if loading}
    <div class="loading">Loading...</div>
  {:else if couple}
    <!-- Header -->
    <header class="page-header">
      <button class="btn btn-back" onclick={onback}>Back</button>
      <div class="header-content">
        <h1>{couple.name}</h1>
        <p class="page-subtitle">{formatDateLong(couple.wedding_date)}</p>
      </div>
    </header>

    <!-- Top Row: Due Date | Deliverables | Emails Due -->
    <div class="card-row top-row">
      <!-- Due Date Card -->
      <div class="card due-date-card">
        <h2 class="card-label">Due Date</h2>
        <p class="big-date">{formatDate(dueDate())}</p>
        {#if daysLeft() !== null}
          <p class="days-left {daysLeftClass()}">
            {#if daysLeft()! < 0}
              {Math.abs(daysLeft()!)} days overdue
            {:else if daysLeft() === 0}
              Due today
            {:else}
              {daysLeft()} days left
            {/if}
          </p>
        {/if}
      </div>

      <!-- Deliverables Card -->
      <div class="card deliverables-card">
        <h2 class="card-label">Deliverables</h2>
        <ul class="deliverables-list">
          {#each deliverables() as d}
            <li class="deliverable-item {d.status}">
              <span class="deliverable-name">{deliverableLabels[d.type] || d.type}</span>
              <span class="deliverable-status">{d.status.replace('_', ' ')}</span>
            </li>
          {/each}
        </ul>
      </div>

      <!-- Mediums / Emails Due Card -->
      <div class="card comms-card">
        <div class="comms-section">
          <h2 class="card-label">Mediums</h2>
          <p class="comms-value">{couple.file_count} files</p>
        </div>
        <div class="comms-section">
          <h2 class="card-label">Emails Due</h2>
          {#if pendingEmails().length === 0}
            <p class="all-sent">All sent</p>
          {:else}
            <ul class="emails-list">
              {#each pendingEmails() as email}
                <li>{email}</li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    </div>

    <!-- Middle Row: Project Details | Contact -->
    <div class="card-row middle-row">
      <!-- Project Details Card -->
      <div class="card project-card">
        <h2 class="card-label">Project Details</h2>
        <dl class="details-grid">
          <div class="detail-row">
            <dt>Venue</dt>
            <dd>
              {#if couple.venue_name}
                {couple.venue_name}{#if couple.venue_city}, {couple.venue_city}{/if}{#if couple.venue_state}, {couple.venue_state}{/if}
              {:else}
                -
              {/if}
            </dd>
          </div>
          <div class="detail-row">
            <dt>Package</dt>
            <dd>{couple.package_name || '-'}</dd>
          </div>
          <div class="detail-row">
            <dt>Duration</dt>
            <dd>{formatDuration(couple.total_duration_seconds)}</dd>
          </div>
          <div class="detail-row">
            <dt>Folder</dt>
            <dd>{couple.folder_name || '-'}</dd>
          </div>
          {#if couple.notes}
            <div class="detail-row full">
              <dt>Notes</dt>
              <dd>{couple.notes}</dd>
            </div>
          {/if}
        </dl>
      </div>

      <!-- Contact Card -->
      <div class="card contact-card">
        <h2 class="card-label">Contact</h2>
        <dl class="details-grid">
          <div class="detail-row">
            <dt>Phone</dt>
            <dd>
              {#if couple.phone}
                <a href="tel:{couple.phone}">{couple.phone}</a>
              {:else}
                -
              {/if}
            </dd>
          </div>
          <div class="detail-row">
            <dt>Email</dt>
            <dd>
              {#if couple.email}
                <a href="mailto:{couple.email}">{couple.email}</a>
              {:else}
                -
              {/if}
            </dd>
          </div>
          <div class="detail-row">
            <dt>Instagram</dt>
            <dd>
              {#if couple.instagram}
                <a href="https://instagram.com/{couple.instagram}" target="_blank" rel="noopener">@{couple.instagram}</a>
              {:else}
                -
              {/if}
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <!-- Timeline Section -->
    <section class="card timeline-card">
      <h2 class="card-label">Timeline</h2>
      <div class="timeline">
        {#each timelineEvents() as event, i}
          <div class="timeline-event {event.completed ? 'completed' : 'pending'}">
            <div class="event-dot"></div>
            <span class="event-label">{event.label}</span>
            <span class="event-date">{formatDate(event.date)}</span>
          </div>
          {#if i < timelineEvents().length - 1}
            <div class="timeline-connector {event.completed ? 'completed' : 'pending'}"></div>
          {/if}
        {/each}
      </div>
    </section>

    <!-- Files Table -->
    {#if couple.files.length > 0}
      <section class="card">
        <h2 class="card-label">Files ({couple.files.length})</h2>
        <div class="files-table">
          <table>
            <thead>
              <tr>
                <th>Filename</th>
                <th>Duration</th>
                <th>Size</th>
                <th>Medium</th>
                <th>Recorded</th>
              </tr>
            </thead>
            <tbody>
              {#each couple.files as file}
                <tr>
                  <td class="filename">{file.original_filename}</td>
                  <td>{formatDuration(file.duration_seconds)}</td>
                  <td>{formatFileSize(file.file_size)}</td>
                  <td>{file.medium ?? '-'}</td>
                  <td>{file.recorded_at ? formatDate(file.recorded_at) : '-'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  {:else}
    <div class="empty-state">
      <h3>Project not found</h3>
      <button class="btn btn-primary" onclick={onback}>Go Back</button>
    </div>
  {/if}
</div>

<style>
  .page-header {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    margin-bottom: 2rem;
  }

  /* Inset all content below header */
  .card-row,
  .card:not(.card-row .card),
  .timeline-card {
    margin-left: 2rem;
    margin-right: 2rem;
  }

  .header-content {
    margin-left: auto;
    text-align: right;
  }

  .header-content h1 {
    margin: 0;
    font-size: 3.5rem;
    font-weight: 600;
  }

  .page-subtitle {
    margin: -0.25rem 0 0;
    padding-left: 25%;
    color: var(--color-text-muted);
  }

  /* Card Layout */
  .card-row {
    display: grid;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .top-row {
    grid-template-columns: 1fr 1.5fr 1fr;
  }

  .middle-row {
    grid-template-columns: 1.5fr 1fr;
  }

  .card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    padding: 1.25rem;
    margin-bottom: 1rem;
  }

  .card-label {
    margin: 0 0 1rem;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }

  /* Due Date Card */
  .big-date {
    font-size: 1.375rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
  }

  .days-left {
    font-size: 0.875rem;
    font-weight: 500;
    margin: 0;
  }

  .days-left.ok { color: #047857; }
  .days-left.warning { color: #b45309; }
  .days-left.urgent { color: #dc2626; }
  .days-left.overdue { color: #dc2626; font-weight: 600; }

  /* Deliverables */
  .deliverables-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .deliverable-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--color-border-light, #f0f0f0);
  }

  .deliverable-item:last-child {
    border-bottom: none;
  }

  .deliverable-name {
    font-size: 0.875rem;
  }

  .deliverable-status {
    font-size: 0.6875rem;
    text-transform: uppercase;
    padding: 0.125rem 0.5rem;
    background: #e5e7eb;
    color: #374151;
  }

  .deliverable-item.in_progress .deliverable-status { background: #dbeafe; color: #1d4ed8; }
  .deliverable-item.review .deliverable-status { background: #fef3c7; color: #b45309; }
  .deliverable-item.delivered .deliverable-status { background: #d1fae5; color: #047857; }

  /* Comms Card */
  .comms-section {
    margin-bottom: 1rem;
  }

  .comms-section:last-child {
    margin-bottom: 0;
  }

  .comms-value {
    margin: 0;
    font-size: 0.875rem;
  }

  .all-sent {
    margin: 0;
    font-size: 0.875rem;
    color: #047857;
  }

  .emails-list {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.875rem;
  }

  .emails-list li {
    padding: 0.125rem 0;
    color: #b45309;
  }

  /* Details Grid */
  .details-grid {
    margin: 0;
  }

  .detail-row {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 0.75rem;
    padding: 0.375rem 0;
    border-bottom: 1px solid var(--color-border-light, #f0f0f0);
  }

  .detail-row:last-child {
    border-bottom: none;
  }

  .detail-row.full {
    grid-template-columns: 1fr;
  }

  .detail-row dt {
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .detail-row dd {
    margin: 0;
    font-size: 0.875rem;
  }

  .detail-row a {
    color: #2563eb;
    text-decoration: none;
  }

  .detail-row a:hover {
    text-decoration: underline;
  }

  /* Timeline */
  .timeline-card {
    overflow-x: auto;
  }

  .timeline {
    display: flex;
    align-items: flex-start;
    min-width: 600px;
  }

  .timeline-event {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 80px;
  }

  .event-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-surface);
    border: 2px solid var(--color-border);
    margin-bottom: 0.5rem;
  }

  .timeline-event.completed .event-dot {
    background: #047857;
    border-color: #047857;
  }

  .event-label {
    font-size: 0.75rem;
    font-weight: 500;
    margin-bottom: 0.125rem;
  }

  .event-date {
    font-size: 0.625rem;
    color: var(--color-text-muted);
  }

  .timeline-connector {
    flex: 1;
    height: 2px;
    background: var(--color-border);
    margin: 6px 0.25rem 0;
  }

  .timeline-connector.completed {
    background: #047857;
  }

  /* Files Table */
  .files-table {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th, td {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--color-border);
  }

  th {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    background: var(--color-bg-alt);
  }

  td {
    font-size: 0.875rem;
  }

  td.filename {
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr:hover {
    background: var(--color-bg-alt);
  }

  /* Utils */
  .btn {
    padding: 0.5rem 1rem;
    border: none;
    font-family: inherit;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-back {
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }

  .btn-back:hover {
    background: var(--color-bg-alt);
  }

  .btn-primary {
    background: var(--color-text);
    color: var(--color-surface);
  }

  .loading {
    text-align: center;
    padding: 3rem;
    color: var(--color-text-muted);
  }

  .empty-state {
    text-align: center;
    padding: 3rem;
  }

  /* Responsive */
  @media (max-width: 900px) {
    .top-row, .middle-row {
      grid-template-columns: 1fr;
    }

    .page-header {
      flex-wrap: wrap;
    }
  }
</style>
