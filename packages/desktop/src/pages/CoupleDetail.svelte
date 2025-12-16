<script lang="ts">
  /**
   * CoupleDetail - View and manage individual wedding project
   * Based on wireframe: Couples Name.pdf
   * Follows Braun/Ulm functional minimalism
   */
  import type {
    CoupleWithFiles,
    CoupleStatus,
    ContractDeliverable
  } from '@nightfox/core';
  import { getAPI } from '../lib/api';

  interface Props {
    coupleId: number;
    onback?: () => void;
  }

  const { coupleId, onback }: Props = $props();

  const api = getAPI();

  let couple = $state<CoupleWithFiles | null>(null);
  let loading = $state(true);
  let importing = $state(false);

  const statusLabels: Record<CoupleStatus, string> = {
    booked: 'Booked',
    ingested: 'Ingested',
    editing: 'Editing',
    delivered: 'Delivered',
    archived: 'Archived',
  };

  // Parse deliverables from JSON
  const deliverables = $derived<ContractDeliverable[]>(() => {
    if (!couple) return [];
    if (couple.deliverables_json) {
      try {
        return JSON.parse(couple.deliverables_json);
      } catch {
        return [];
      }
    }
    return [];
  });

  // Filter to only edit deliverables (highlight films, teasers, etc.)
  const editDeliverables = $derived(() => {
    return deliverables().filter(d => d.category === 'edit');
  });

  // Check if Date Night is included (session category deliverables)
  const hasDateNight = $derived(() => {
    const dels = deliverables();
    return dels.some(d => d.code === 'session_datenight' || d.category === 'session');
  });

  // Check if Raw Footage or Timeline deliverables exist
  const hasRawOrTimeline = $derived(() => {
    const dels = deliverables();
    return dels.some(d => d.category === 'raw' || d.category === 'timeline');
  });

  // Helper: Check if a date has passed
  const isDatePast = (dateStr: string | null): boolean => {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    return date < today;
  };

  // Format medium for display
  const mediumDisplay = $derived(() => {
    if (!couple?.mediums_json) return 'Medium not specified';
    try {
      const mediums = JSON.parse(couple.mediums_json) as string[];
      if (mediums.length === 0) return 'Medium not specified';
      const labels: Record<string, string> = {
        modern: 'Modern 4K Digital',
        dadcam: 'Dad Cam',
        super8: 'Super 8',
      };
      if (mediums.length === 1) return labels[mediums[0]] || mediums[0];
      if (mediums.length === 3) return 'Super 8 + Dad Cam + Modern Digital';
      return mediums.map(m => labels[m]?.split(' ')[0] || m).join(' + ');
    } catch {
      return 'Medium not specified';
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

  // Is this a wedding countdown (booked status with future wedding)?
  const isWeddingCountdown = $derived(() => {
    if (!couple) return false;
    if (couple.status !== 'booked') return false;
    if (!couple.wedding_date) return false;
    const wedding = new Date(couple.wedding_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    wedding.setHours(0, 0, 0, 0);
    return wedding.getTime() >= today.getTime();
  });

  // Days until wedding (for booked status)
  const daysUntilWedding = $derived(() => {
    if (!couple?.wedding_date) return null;
    const wedding = new Date(couple.wedding_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    wedding.setHours(0, 0, 0, 0);
    return Math.ceil((wedding.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  });

  // Urgency class - different thresholds for wedding countdown vs due date
  const daysLeftClass = $derived(() => {
    if (isWeddingCountdown()) {
      const days = daysUntilWedding();
      if (days === null) return '';
      if (days < 0) return 'overdue';
      if (days < 7) return 'urgent';
      if (days < 15) return 'warning';
      return 'ok';
    }
    // Due date logic for post-wedding statuses
    const days = daysLeft();
    if (days === null) return '';
    if (days < 0) return 'overdue';
    if (days <= 14) return 'urgent';
    if (days <= 30) return 'warning';
    return 'ok';
  });

  // Countdown display (number + unit) - converts to weeks when > 14 days
  const countdownDisplay = $derived(() => {
    const days = isWeddingCountdown() ? daysUntilWedding() : daysLeft();
    if (days === null) return { number: '-', unit: '' };
    if (days === 0) return { number: '0', unit: 'Days' };
    if (days < 0) {
      const absDays = Math.abs(days);
      if (absDays > 14) {
        const weeks = Math.floor(absDays / 7);
        return { number: weeks, unit: weeks === 1 ? 'Week' : 'Weeks' };
      }
      return { number: absDays, unit: absDays === 1 ? 'Day' : 'Days' };
    }
    if (days > 14) {
      const weeks = Math.floor(days / 7);
      return { number: weeks, unit: weeks === 1 ? 'Week' : 'Weeks' };
    }
    return { number: days, unit: days === 1 ? 'Day' : 'Days' };
  });

  // Context label based on status
  const countdownContext = $derived(() => {
    if (!couple) return '';
    if (isWeddingCountdown()) return 'Wedding';
    if (['ingested', 'editing'].includes(couple.status)) return 'Editing';
    if (couple.status === 'delivered') return 'Delivered';
    if (couple.status === 'archived') return 'Archived';
    return 'Due';
  });

  // Show getting ready section only before wedding date
  const showGettingReady = $derived(() => {
    if (!couple) return false;
    // Show if we have any getting ready data
    const hasData = couple.getting_ready_1_name || couple.getting_ready_1_address ||
                    couple.getting_ready_2_name || couple.getting_ready_2_address;
    if (!hasData) return false;
    // Hide after wedding date
    if (!couple.wedding_date) return true;
    const wedding = new Date(couple.wedding_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    wedding.setHours(0, 0, 0, 0);
    return wedding >= today;
  });

  // Show separate ceremony venue if different from reception
  const hasSeparateCeremony = $derived(() => {
    if (!couple?.ceremony_venue_name) return false;
    return couple.ceremony_venue_name !== couple.venue_name;
  });

  // Show addresses only if wedding is within 30 days (for day-of logistics)
  const showAddresses = $derived(() => {
    if (!couple?.wedding_date) return false;
    const wedding = new Date(couple.wedding_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    wedding.setHours(0, 0, 0, 0);
    const daysUntil = Math.ceil((wedding.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntil >= 0 && daysUntil <= 30;
  });

  // Timeline events - completed status derived from workflow progression
  const timelineEvents = $derived(() => {
    if (!couple) return [];
    const statusOrder = ['booked', 'ingested', 'editing', 'delivered', 'archived'];
    const currentIndex = statusOrder.indexOf(couple.status);

    const events: Array<{ label: string; date: string | null | undefined; completed: boolean }> = [
      { label: 'Booked', date: couple.created_at?.split('T')[0], completed: true },
    ];

    // Add Date Night if couple has it (between Booked and Wedding)
    if (hasDateNight()) {
      events.push({
        label: 'Date Night',
        date: couple.date_night_date,
        completed: isDatePast(couple.date_night_date),
      });
    }

    events.push(
      { label: 'Wedding', date: couple.wedding_date, completed: currentIndex >= 1 },
      { label: 'Ingested', date: couple.date_ingested, completed: currentIndex >= 1 },
      { label: 'Editing', date: couple.date_editing_started, completed: currentIndex >= 2 },
      { label: 'Delivered', date: couple.date_delivered, completed: currentIndex >= 3 },
      { label: 'Archived', date: couple.date_archived, completed: currentIndex >= 4 },
    );

    return events;
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

  async function importFiles() {
    if (importing) return;
    try {
      const files = await api.dialog.selectFiles();
      if (files.length > 0) {
        importing = true;
        await api.import.files(files, coupleId);
        await loadCouple();
      }
    } catch (e) {
      console.error('Failed to import files:', e);
    } finally {
      importing = false;
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
      <button class="btn btn-back" onclick={importFiles} disabled={importing}>
        {importing ? 'Importing...' : 'Import'}
      </button>
      <div class="header-content">
        <h1>{couple.name}</h1>
        <p class="page-subtitle">{formatDateLong(couple.wedding_date)}</p>
      </div>
    </header>

    <!-- Top Row: Countdown | Deliverables -->
    <div class="card-row top-row">
      <!-- Countdown Card -->
      <div class="card countdown-card {daysLeftClass()}">
        <span class="countdown-number">{countdownDisplay().number}</span>
        <span class="countdown-unit">{countdownDisplay().unit}</span>
        <span class="countdown-context">{countdownContext()}</span>
      </div>

      <!-- Deliverables Card (clean) -->
      <div class="card deliverables-card">
        <p class="videographer-line">{couple.videographer_count || 1} Videographer{(couple.videographer_count || 1) > 1 ? 's' : ''}</p>
        <p class="medium-line">{mediumDisplay()}</p>
        {#each editDeliverables() as edit}
          <p class="edit-line">{edit.name}</p>
        {/each}
        {#if hasRawOrTimeline()}
          <p class="included-line">Raw Footage & Timeline</p>
        {/if}
        {#if hasDateNight()}
          <p class="included-line">Date Night</p>
        {/if}
      </div>
    </div>

    <!-- Middle Row: Project Details | Contact -->
    <div class="card-row middle-row">
      <!-- Details Card -->
      <div class="card project-card">
        <h2 class="card-label">Details</h2>
        <dl class="details-grid">
          {#if showGettingReady()}
            {#if couple.getting_ready_1_name || couple.getting_ready_1_address}
              <div class="detail-row">
                <dt>Getting Ready</dt>
                <dd>
                  {#if couple.getting_ready_1_name}{couple.getting_ready_1_name}{/if}
                  {#if showAddresses() && couple.getting_ready_1_address}
                    {#if couple.getting_ready_1_name}<br />{/if}
                    {couple.getting_ready_1_address}
                  {/if}
                </dd>
              </div>
            {/if}
            {#if couple.getting_ready_2_name || couple.getting_ready_2_address}
              <div class="detail-row">
                <dt>Getting Ready</dt>
                <dd>
                  {#if couple.getting_ready_2_name}{couple.getting_ready_2_name}{/if}
                  {#if showAddresses() && couple.getting_ready_2_address}
                    {#if couple.getting_ready_2_name}<br />{/if}
                    {couple.getting_ready_2_address}
                  {/if}
                </dd>
              </div>
            {/if}
          {/if}
          {#if hasSeparateCeremony()}
            <div class="detail-row">
              <dt>Ceremony</dt>
              <dd>
                {couple.ceremony_venue_name}
                {#if showAddresses() && couple.ceremony_venue_address}<br />{couple.ceremony_venue_address}{/if}
              </dd>
            </div>
            <div class="detail-row">
              <dt>Reception</dt>
              <dd>
                {#if couple.venue_name}
                  {couple.venue_name}
                  {#if showAddresses()}
                    {#if couple.venue_address}<br />{couple.venue_address}{/if}
                    {#if couple.venue_city}, {couple.venue_city}{/if}{#if couple.venue_state}, {couple.venue_state}{/if}
                  {/if}
                {:else}
                  -
                {/if}
              </dd>
            </div>
          {:else}
            <div class="detail-row">
              <dt>Venue</dt>
              <dd>
                {#if couple.venue_name}
                  {couple.venue_name}
                  {#if showAddresses()}
                    {#if couple.venue_address}<br />{couple.venue_address}{/if}
                    {#if couple.venue_city}, {couple.venue_city}{/if}{#if couple.venue_state}, {couple.venue_state}{/if}
                  {/if}
                {:else}
                  -
                {/if}
              </dd>
            </div>
          {/if}
          {#if couple.notes}
            <div class="detail-row full">
              <dt>Notes</dt>
              <dd>{couple.notes}</dd>
            </div>
          {/if}
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

    <!-- Contact Section: Partner 1 | Partner 2 -->
    {#if couple.partner_1_name || couple.phone || couple.partner_2_name || couple.phone_2}
      <div class="card-row contact-row">
        <!-- Partner 1 -->
        <div class="card partner-card">
          <h2 class="card-label">{couple.partner_1_name || 'Partner 1'}</h2>
          <dl class="details-grid">
            {#if couple.phone}
              <div class="detail-row">
                <dt>Phone</dt>
                <dd><a href="tel:{couple.phone}">{couple.phone}</a></dd>
              </div>
            {/if}
            {#if couple.partner_1_email}
              <div class="detail-row">
                <dt>Email</dt>
                <dd><a href="mailto:{couple.partner_1_email}">{couple.partner_1_email}</a></dd>
              </div>
            {:else if couple.email && !couple.partner_2_email}
              <div class="detail-row">
                <dt>Email</dt>
                <dd><a href="mailto:{couple.email}">{couple.email}</a></dd>
              </div>
            {/if}
            {#if couple.partner_1_instagram}
              <div class="detail-row">
                <dt>Instagram</dt>
                <dd><a href="https://instagram.com/{couple.partner_1_instagram}" target="_blank" rel="noopener">@{couple.partner_1_instagram}</a></dd>
              </div>
            {:else if couple.instagram && !couple.partner_2_instagram}
              <div class="detail-row">
                <dt>Instagram</dt>
                <dd><a href="https://instagram.com/{couple.instagram}" target="_blank" rel="noopener">@{couple.instagram}</a></dd>
              </div>
            {/if}
            {#if couple.mailing_address}
              <div class="detail-row">
                <dt>Address</dt>
                <dd>{couple.mailing_address}</dd>
              </div>
            {/if}
          </dl>
        </div>

        <!-- Partner 2 -->
        <div class="card partner-card">
          <h2 class="card-label">{couple.partner_2_name || 'Partner 2'}</h2>
          <dl class="details-grid">
            {#if couple.phone_2}
              <div class="detail-row">
                <dt>Phone</dt>
                <dd><a href="tel:{couple.phone_2}">{couple.phone_2}</a></dd>
              </div>
            {/if}
            {#if couple.partner_2_email}
              <div class="detail-row">
                <dt>Email</dt>
                <dd><a href="mailto:{couple.partner_2_email}">{couple.partner_2_email}</a></dd>
              </div>
            {/if}
            {#if couple.partner_2_instagram}
              <div class="detail-row">
                <dt>Instagram</dt>
                <dd><a href="https://instagram.com/{couple.partner_2_instagram}" target="_blank" rel="noopener">@{couple.partner_2_instagram}</a></dd>
              </div>
            {/if}
          </dl>
        </div>
      </div>
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
    grid-template-columns: 1fr 2.5fr;
    align-items: stretch;
  }

  .middle-row {
    grid-template-columns: 1fr;
  }

  .contact-row {
    grid-template-columns: 1fr 1fr;
  }

  .partner-card {
    margin-bottom: 0;
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

  /* Countdown Card (centered, flexbox) */
  .countdown-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    min-height: 120px;
  }

  .countdown-number {
    font-size: 36px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--color-text, #1C1C1A);
  }

  .countdown-unit {
    font-size: 17px;
    font-weight: 500;
    color: var(--color-text-muted, #5C5C58);
    margin-top: 8px;
  }

  .countdown-context {
    font-size: 13px;
    font-weight: 400;
    color: #8A8A86;
    margin-top: 8px;
  }

  /* Urgency states */
  .countdown-card.warning .countdown-number { color: #C9A227; }
  .countdown-card.urgent .countdown-number { color: #B85C4A; }
  .countdown-card.overdue .countdown-number { color: #B85C4A; }
  .countdown-card.overdue .countdown-context::before { content: 'Overdue - '; }

  /* Deliverables Card (clean layout, right-aligned, vertically centered) */
  .deliverables-card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-align: right;
  }

  .videographer-line {
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0;
  }

  .medium-line {
    font-size: 15px;
    color: var(--color-text-muted, #5C5C58);
    margin: 0 0 16px;
  }

  .edit-line {
    font-size: 17px;
    font-weight: 500;
    margin: 0 0 8px;
  }

  .edit-line:last-of-type {
    margin-bottom: 0;
  }

  .included-line {
    font-size: 13px;
    color: var(--color-text-muted, #8A8A86);
    margin: 8px 0 0;
  }

  .included-line:first-of-type {
    margin-top: 16px;
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
    .top-row, .middle-row, .contact-row {
      grid-template-columns: 1fr;
    }

    .page-header {
      flex-wrap: wrap;
    }
  }
</style>
