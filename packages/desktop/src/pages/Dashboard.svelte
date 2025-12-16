<script lang="ts">
  /**
   * Dashboard - Unified overview for wedding videography workflow
   * Follows Braun/Ulm functional minimalism
   */
  import type { CoupleStatus, Couple } from '@nightfox/core';
  import type { WhatsNextData, WhatsNextSection, WhatsNextItem } from '../lib/types';

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
  let whatsNext = $state<WhatsNextData | null>(null);
  let loading = $state(true);
  let statusBreakdownCollapsed = $state(false);

  const statusLabels: Record<CoupleStatus, string> = {
    booked: 'Booked',
    ingested: 'Ingested',
    editing: 'Editing',
    delivered: 'Delivered',
    archived: 'Archived',
  };

  async function loadStats() {
    loading = true;
    try {
      const [dashStats, databaseStats, whatsNextData] = await Promise.all([
        window.electronAPI.couples.getDashboardStats(),
        window.electronAPI.database.getStats(),
        window.electronAPI.couples.getWhatsNextData(),
      ]);
      stats = dashStats;
      dbStats = databaseStats;
      whatsNext = whatsNextData;
    } catch (e) {
      console.error('Failed to load dashboard stats:', e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadStats();
  });

  function toggleStatusBreakdown() {
    statusBreakdownCollapsed = !statusBreakdownCollapsed;
  }

  function formatShortDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  function formatDaysUntil(days: number): string {
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 0) return `${Math.abs(days)}d overdue`;
    return `${days}d`;
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

  function getTotalItemCount(sections: WhatsNextSection[]): number {
    return sections.reduce((sum, section) => sum + section.items.length, 0);
  }
</script>

<div class="page">
  <header class="page-header">
    <h1>Dashboard</h1>
  </header>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if stats}
    <!-- What's Next Section -->
    {#if whatsNext && getTotalItemCount(whatsNext.sections) > 0}
      <section class="dashboard-section">
        <h2 class="section-label">What's Next</h2>
        <div class="whats-next-card">
          {#each whatsNext.sections as section}
            {#if section.items.length > 0}
              <div class="whats-next-section">
                <div class="whats-next-section__header">
                  <span class="whats-next-section__label">{section.label}</span>
                  <span class="whats-next-section__count">{section.items.length}</span>
                </div>
                <div class="whats-next-items">
                  {#each section.items as item}
                    <button
                      class="whats-next-item"
                      class:whats-next-item--urgent={item.isUrgent}
                      type="button"
                      onclick={() => handleCoupleClick(item.coupleId)}
                    >
                      <span class="whats-next-item__date">
                        {formatShortDate(item.date)}
                      </span>
                      <span class="whats-next-item__name">{item.coupleName}</span>
                      <span class="whats-next-item__venue">{item.venue}</span>
                      <span class="whats-next-item__badge">
                        {formatDaysUntil(item.daysUntil)}
                      </span>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
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
    {:else if !whatsNext || getTotalItemCount(whatsNext.sections) === 0}
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

    <!-- Status Breakdown (Demoted, Collapsible) -->
    <section class="dashboard-section dashboard-section--demoted">
      <button
        class="status-breakdown-header"
        type="button"
        onclick={toggleStatusBreakdown}
      >
        <h2 class="section-label">Status Breakdown</h2>
        <span class="status-breakdown-toggle">
          {statusBreakdownCollapsed ? '+' : '−'}
        </span>
      </button>
      {#if !statusBreakdownCollapsed}
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
      {/if}
    </section>
  {/if}
</div>

<style>
  /* Page Header - No subtitle */
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 32px;
  }

  /* Section spacing - 48px (8pt grid) */
  .dashboard-section {
    margin-bottom: 48px;
  }

  /* Demoted section - 64px gap with border */
  .dashboard-section--demoted {
    margin-top: 64px;
    padding-top: 24px;
    border-top: 1px solid var(--color-border-muted);
  }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-muted);
    margin: 0;
  }

  /* What's Next Card */
  .whats-next-card {
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    overflow: hidden;
    margin-top: 16px;
  }

  /* What's Next Section */
  .whats-next-section {
    padding: 16px 24px;
  }

  .whats-next-section:not(:last-child) {
    padding-bottom: 24px;
  }

  .whats-next-section__header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .whats-next-section__label {
    font-size: var(--step--1);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
  }

  .whats-next-section__count {
    font-size: var(--step--1);
    font-weight: 600;
    color: var(--color-text-muted);
  }

  /* What's Next Items */
  .whats-next-items {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .whats-next-item {
    display: flex;
    align-items: center;
    gap: 16px;
    width: 100%;
    padding: 10px 12px;
    border: none;
    border-radius: 4px;
    background: var(--color-bg);
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    transition: background-color 0.15s;
  }

  .whats-next-item:hover {
    background-color: var(--color-bg-alt);
  }

  /* Urgent items - weight only, no color (Braun-compliant) */
  .whats-next-item--urgent {
    font-weight: 600;
  }

  .whats-next-item--urgent .whats-next-item__badge {
    font-weight: 700;
  }

  .whats-next-item__date {
    width: 56px;
    font-size: var(--step--1);
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }

  .whats-next-item__name {
    flex: 1;
    font-size: var(--step-0);
    color: var(--color-text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .whats-next-item__venue {
    flex: 1;
    font-size: var(--step--1);
    color: var(--color-text-muted);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .whats-next-item__badge {
    font-size: var(--step--1);
    font-weight: 500;
    padding: 4px 8px;
    background-color: var(--color-bg-alt);
    border-radius: 4px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* Stat Grid - 24px padding (8pt grid) */
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-top: 16px;
  }

  .stat-grid--small {
    grid-template-columns: repeat(2, 1fr);
    max-width: 400px;
  }

  .stat-card {
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 24px;
  }

  .stat-card--small {
    padding: 16px;
  }

  .stat-card__value {
    font-size: var(--step-2);
    font-weight: 600;
    margin-bottom: 4px;
  }

  .stat-card--small .stat-card__value {
    font-size: var(--step-1);
  }

  .stat-card__label {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  /* Status Breakdown - Collapsible */
  .status-breakdown-header {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 0;
    margin-bottom: 16px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-family: inherit;
    text-align: left;
  }

  .status-breakdown-toggle {
    margin-left: auto;
    font-size: var(--step-0);
    color: var(--color-text-muted);
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .status-breakdown {
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 16px;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 0;
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
    width: 32px;
    text-align: right;
    font-weight: 500;
  }

  /* List */
  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 16px;
  }

  .list-item {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
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

  .list-item__name {
    flex: 1;
    font-size: var(--step-0);
    font-weight: 500;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .list-item__action {
    font-size: var(--step--1);
    color: var(--color-text-secondary);
  }

  .list-item__time {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  /* Empty State */
  .empty-state {
    text-align: center;
    padding: 48px;
    background-color: var(--color-surface);
    border: 1px dashed var(--color-border);
    border-radius: 4px;
  }

  .empty-state__title {
    font-size: var(--step-1);
    margin-bottom: 8px;
  }

  .empty-state__text {
    color: var(--color-text-muted);
  }

  /* Loading */
  .loading {
    text-align: center;
    padding: 48px;
    color: var(--color-text-muted);
  }
</style>
