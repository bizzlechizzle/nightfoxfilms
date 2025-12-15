<script lang="ts">
  /**
   * WeddingsDashboard - Overview page for wedding photography workflow
   * Follows Braun/Ulm functional minimalism
   */
  import StatusBadge from '../components/wedding/StatusBadge.svelte';
  import ProgressBar from '../components/wedding/ProgressBar.svelte';
  import WeddingImportModal from '../components/wedding/WeddingImportModal.svelte';

  type Status = 'imported' | 'culling' | 'editing' | 'delivered' | 'archived';

  interface DashboardStats {
    byStatus: Record<Status, number>;
    deliveredThisMonth: number;
    upcomingDeliveries: Array<{
      wedding: Wedding;
      daysUntilDue: number;
      progress: number;
    }>;
    recentActivity: Array<{
      wedding: Wedding;
      action: string;
      timestamp: string;
    }>;
  }

  interface Wedding {
    id: string;
    display_name: string;
    wedding_date: string;
    status: Status;
    total_images: number;
    edited_images: number;
  }

  interface Props {
    onnavigate?: (page: string, weddingId?: string) => void;
  }

  const { onnavigate }: Props = $props();

  let stats = $state<DashboardStats | null>(null);
  let loading = $state(true);
  let showImportModal = $state(false);

  async function loadStats() {
    try {
      stats = await window.electronAPI.weddings.getDashboardStats();
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
    return stats.byStatus.imported + stats.byStatus.culling + stats.byStatus.editing;
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

  function handleWeddingClick(weddingId: string) {
    onnavigate?.('wedding-detail', weddingId);
  }
</script>

<div class="page">
  <header class="page-header">
    <div>
      <h1>Dashboard</h1>
      <p class="page-subtitle">Wedding photography workflow</p>
    </div>
    <button class="btn btn-primary" onclick={() => showImportModal = true}>
      Import Wedding
    </button>
  </header>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if stats}
    <!-- Status Overview -->
    <section class="dashboard-section">
      <h2 class="section-label">Workflow Status</h2>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-card__label">Active</div>
          <div class="stat-card__value">{totalActive()}</div>
          <div class="stat-card__subtext">In progress</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Culling</div>
          <div class="stat-card__value">{stats.byStatus.culling}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Editing</div>
          <div class="stat-card__value">{stats.byStatus.editing}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Delivered</div>
          <div class="stat-card__value">{stats.deliveredThisMonth}</div>
          <div class="stat-card__subtext">This month</div>
        </div>
      </div>
    </section>

    <!-- Upcoming Deliveries -->
    {#if stats.upcomingDeliveries.length > 0}
      <section class="dashboard-section">
        <h2 class="section-label">Upcoming Deliveries</h2>
        <div class="upcoming-list">
          {#each stats.upcomingDeliveries as item}
            <button
              class="upcoming-item"
              type="button"
              onclick={() => handleWeddingClick(item.wedding.id)}
            >
              <div class="upcoming-item__info">
                <span class="upcoming-item__name">{item.wedding.display_name}</span>
                <span class="upcoming-item__date">
                  {item.daysUntilDue > 0 ? `${item.daysUntilDue} days` : 'Today'}
                </span>
              </div>
              <div class="upcoming-item__progress">
                <ProgressBar percent={item.progress} showLabel />
              </div>
              <StatusBadge status={item.wedding.status} />
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Recent Activity -->
    {#if stats.recentActivity.length > 0}
      <section class="dashboard-section">
        <h2 class="section-label">Recent Activity</h2>
        <div class="activity-list">
          {#each stats.recentActivity as activity}
            <button
              class="activity-item"
              type="button"
              onclick={() => handleWeddingClick(activity.wedding.id)}
            >
              <span class="activity-item__name">{activity.wedding.display_name}</span>
              <span class="activity-item__action">{activity.action}</span>
              <span class="activity-item__time">{formatRelativeTime(activity.timestamp)}</span>
            </button>
          {/each}
        </div>
      </section>
    {:else}
      <div class="empty-state">
        <h3 class="empty-state__title">No weddings yet</h3>
        <p class="empty-state__text">Import your first wedding to get started</p>
        <button class="btn btn-primary" onclick={() => showImportModal = true}>
          Import Wedding
        </button>
      </div>
    {/if}
  {/if}
</div>

<WeddingImportModal
  open={showImportModal}
  onclose={() => showImportModal = false}
  oncreated={loadStats}
/>

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

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
  }

  .upcoming-list,
  .activity-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .upcoming-item {
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

  .upcoming-item:hover {
    border-color: var(--color-text-muted);
  }

  .upcoming-item__info {
    flex: 1;
    min-width: 0;
  }

  .upcoming-item__name {
    display: block;
    font-size: var(--step-0);
    font-weight: 500;
  }

  .upcoming-item__date {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .upcoming-item__progress {
    width: 120px;
  }

  .activity-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0.75rem;
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.15s;
    text-align: left;
    width: 100%;
    font-family: inherit;
  }

  .activity-item:hover {
    background-color: var(--color-bg-alt);
  }

  .activity-item__name {
    font-size: var(--step-0);
    font-weight: 500;
    min-width: 150px;
  }

  .activity-item__action {
    flex: 1;
    font-size: var(--step--1);
    color: var(--color-text-secondary);
  }

  .activity-item__time {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .loading {
    text-align: center;
    padding: 3rem;
    color: var(--color-text-muted);
  }
</style>
