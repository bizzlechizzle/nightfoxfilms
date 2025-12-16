<script lang="ts">
  /**
   * Dashboard - Unified overview for wedding videography workflow
   * Follows Braun/Ulm functional minimalism
   */
  import type { CoupleStatus, Couple } from '@nightfox/core';

  interface DashboardStats {
    byStatus: Record<CoupleStatus, number>;
    deliveredThisMonth: number;
    upcomingWeddings: Array<{
      couple: Couple;
      daysUntil: number;
    }>;
    recentActivity: Array<{
      couple: Couple;
      action: string;
      timestamp: string;
    }>;
  }

  interface DatabaseStats {
    tables: number;
    totalRows: number;
    sizeBytes: number;
  }

  interface Props {
    onnavigate?: (page: string, coupleId?: number) => void;
  }

  const { onnavigate }: Props = $props();

  let stats = $state<DashboardStats | null>(null);
  let dbStats = $state<DatabaseStats | null>(null);
  let loading = $state(true);

  const statusLabels: Record<CoupleStatus, string> = {
    booked: 'Booked',
    shot: 'Shot',
    ingested: 'Ingested',
    editing: 'Editing',
    delivered: 'Delivered',
    archived: 'Archived',
  };

  async function loadStats() {
    loading = true;
    try {
      const [dashStats, databaseStats] = await Promise.all([
        window.electronAPI.couples.getDashboardStats(),
        window.electronAPI.database.getStats(),
      ]);
      stats = dashStats;
      dbStats = databaseStats;
    } catch (e) {
      console.error('Failed to load dashboard stats:', e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadStats();
  });

  const totalActive = $derived(() => {
    if (!stats) return 0;
    return stats.byStatus.shot + stats.byStatus.ingested + stats.byStatus.editing;
  });

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  function formatRelativeTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays} days ago`;
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  function handleCoupleClick(coupleId: number) {
    onnavigate?.('couple-detail', coupleId);
  }
</script>

<div class="page">
  <header class="page-header">
    <div>
      <h1>Dashboard</h1>
      <p class="page-subtitle">Wedding videography workflow</p>
    </div>
  </header>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if stats}
    <!-- Workflow Status Overview -->
    <section class="dashboard-section">
      <h2 class="section-label">Workflow Status</h2>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-card__value">{stats.byStatus.booked}</div>
          <div class="stat-card__label">Upcoming</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value">{totalActive()}</div>
          <div class="stat-card__label">In Progress</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value">{stats.deliveredThisMonth}</div>
          <div class="stat-card__label">Delivered This Month</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value">{stats.byStatus.archived}</div>
          <div class="stat-card__label">Archived</div>
        </div>
      </div>
    </section>

    <!-- Status Breakdown -->
    <section class="dashboard-section">
      <h2 class="section-label">Status Breakdown</h2>
      <div class="status-breakdown">
        {#each Object.entries(statusLabels) as [status, label]}
          <div class="status-row">
            <span class="status-row__label">{label}</span>
            <div class="status-row__bar">
              <div
                class="status-row__fill"
                style="width: {Math.max(stats.byStatus[status as CoupleStatus] * 10, stats.byStatus[status as CoupleStatus] > 0 ? 4 : 0)}%"
              ></div>
            </div>
            <span class="status-row__count">{stats.byStatus[status as CoupleStatus]}</span>
          </div>
        {/each}
      </div>
    </section>

    <!-- Upcoming Weddings -->
    {#if stats.upcomingWeddings.length > 0}
      <section class="dashboard-section">
        <h2 class="section-label">Upcoming Weddings</h2>
        <div class="list">
          {#each stats.upcomingWeddings as item}
            <button
              class="list-item"
              type="button"
              onclick={() => handleCoupleClick(item.couple.id)}
            >
              <div class="list-item__info">
                <span class="list-item__name">{item.couple.name}</span>
                <span class="list-item__meta">
                  {item.couple.wedding_date ? formatDate(item.couple.wedding_date) : 'No date'}
                </span>
              </div>
              <span class="list-item__badge">
                {item.daysUntil === 0 ? 'Today' : item.daysUntil === 1 ? 'Tomorrow' : `${item.daysUntil} days`}
              </span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Recent Activity -->
    {#if stats.recentActivity.length > 0}
      <section class="dashboard-section">
        <h2 class="section-label">Recent Activity</h2>
        <div class="list">
          {#each stats.recentActivity as activity}
            <button
              class="list-item"
              type="button"
              onclick={() => handleCoupleClick(activity.couple.id)}
            >
              <span class="list-item__name">{activity.couple.name}</span>
              <span class="list-item__action">{activity.action}</span>
              <span class="list-item__time">{formatRelativeTime(activity.timestamp)}</span>
            </button>
          {/each}
        </div>
      </section>
    {:else}
      <div class="empty-state">
        <h3 class="empty-state__title">No projects yet</h3>
        <p class="empty-state__text">Create your first project to get started</p>
      </div>
    {/if}

    <!-- Storage Stats -->
    {#if dbStats}
      <section class="dashboard-section">
        <h2 class="section-label">Storage</h2>
        <div class="stat-grid stat-grid--small">
          <div class="stat-card stat-card--small">
            <div class="stat-card__value">{dbStats.totalRows}</div>
            <div class="stat-card__label">Total Files</div>
          </div>
          <div class="stat-card stat-card--small">
            <div class="stat-card__value">{formatBytes(dbStats.sizeBytes)}</div>
            <div class="stat-card__label">Database Size</div>
          </div>
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 2rem;
  }

  .page-subtitle {
    font-size: var(--step-0);
    color: var(--color-text-muted);
    margin: 0.25rem 0 0;
  }

  .dashboard-section {
    margin-bottom: 2rem;
  }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-muted);
    margin-bottom: 1rem;
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
  }

  .stat-grid--small {
    grid-template-columns: repeat(2, 1fr);
    max-width: 400px;
  }

  .stat-card {
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1.25rem;
  }

  .stat-card--small {
    padding: 1rem;
  }

  .stat-card__value {
    font-size: var(--step-2);
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .stat-card--small .stat-card__value {
    font-size: var(--step-1);
  }

  .stat-card__label {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .status-breakdown {
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1rem;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0;
  }

  .status-row__label {
    width: 80px;
    font-size: var(--step--1);
    color: var(--color-text-secondary);
  }

  .status-row__bar {
    flex: 1;
    height: 8px;
    background-color: var(--color-bg-alt);
    border-radius: 4px;
    overflow: hidden;
  }

  .status-row__fill {
    height: 100%;
    background-color: var(--color-text);
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .status-row__count {
    width: 30px;
    text-align: right;
    font-weight: 500;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .list-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    cursor: pointer;
    transition: border-color 0.15s;
    text-align: left;
    width: 100%;
    font-family: inherit;
  }

  .list-item:hover {
    border-color: var(--color-text-muted);
  }

  .list-item__info {
    flex: 1;
    min-width: 0;
  }

  .list-item__name {
    display: block;
    font-size: var(--step-0);
    font-weight: 500;
  }

  .list-item__meta {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .list-item__action {
    flex: 1;
    font-size: var(--step--1);
    color: var(--color-text-secondary);
  }

  .list-item__time {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .list-item__badge {
    font-size: var(--step--1);
    font-weight: 500;
    padding: 0.25rem 0.5rem;
    background-color: var(--color-bg-alt);
    border-radius: 4px;
  }

  .empty-state {
    text-align: center;
    padding: 3rem;
    background-color: var(--color-surface);
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

  .loading {
    text-align: center;
    padding: 3rem;
    color: var(--color-text-muted);
  }
</style>
