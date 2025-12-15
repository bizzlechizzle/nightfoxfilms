<script lang="ts">
  import { getAPI, formatBytes, formatDuration, formatDate } from '../lib/api';
  import type { Couple, DatabaseStats, JobStats } from '../lib/types';

  const api = getAPI();

  let couples = $state<Couple[]>([]);
  let dbStats = $state<DatabaseStats | null>(null);
  let jobStats = $state<JobStats | null>(null);
  let loading = $state(true);

  // Load dashboard data
  $effect(() => {
    loadData();
  });

  async function loadData() {
    loading = true;
    try {
      const [couplesResult, dbResult, jobsResult] = await Promise.all([
        api.couples.findAll(),
        api.database.getStats(),
        api.jobs.status(),
      ]);
      couples = couplesResult.slice(0, 5); // Recent 5 couples
      dbStats = dbResult;
      jobStats = jobsResult;
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      loading = false;
    }
  }
</script>

<div class="page">
  <header class="page-header">
    <h2>Dashboard</h2>
    <p class="subtitle">Welcome to Nightfox Films</p>
  </header>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else}
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">{couples.length > 0 ? couples[0]?.name ?? 'None' : 'None'}</div>
        <div class="stat-label">Recent Couple</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{dbStats?.totalRows ?? 0}</div>
        <div class="stat-label">Total Files</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{formatBytes(dbStats?.sizeBytes ?? 0)}</div>
        <div class="stat-label">Database Size</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{(jobStats?.pending ?? 0) + (jobStats?.processing ?? 0)}</div>
        <div class="stat-label">Active Jobs</div>
      </div>
    </div>

    <section class="section">
      <h3>Recent Couples</h3>
      {#if couples.length === 0}
        <p class="empty-state">No couples yet. Create one to get started.</p>
      {:else}
        <div class="couples-list">
          {#each couples as couple}
            <div class="couple-card">
              <div class="couple-info">
                <div class="couple-name">{couple.name}</div>
                <div class="couple-date">{formatDate(couple.wedding_date)}</div>
              </div>
              <div class="couple-stats">
                <span>{couple.file_count} files</span>
                <span>{formatDuration(couple.total_duration_seconds)}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class="section">
      <h3>Quick Actions</h3>
      <div class="actions">
        <button class="btn btn-primary">Import Files</button>
        <button class="btn btn-secondary">New Couple</button>
        <button class="btn btn-secondary">Add Camera</button>
      </div>
    </section>
  {/if}
</div>

<style>
  .page-header {
    margin-bottom: 2rem;
  }

  .page-header h2 {
    margin-bottom: 0.25rem;
  }

  .subtitle {
    color: var(--color-text-muted);
    margin: 0;
  }

  .loading {
    padding: 2rem;
    text-align: center;
    color: var(--color-text-muted);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .stat-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1.25rem;
  }

  .stat-value {
    font-size: var(--step-2);
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .stat-label {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .section {
    margin-bottom: 2rem;
  }

  .section h3 {
    font-size: var(--step-1);
    margin-bottom: 1rem;
    font-weight: 600;
  }

  .empty-state {
    padding: 2rem;
    text-align: center;
    background: var(--color-surface);
    border: 1px dashed var(--color-border);
    border-radius: 4px;
    color: var(--color-text-muted);
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
  }

  .couple-name {
    font-weight: 500;
  }

  .couple-date {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .couple-stats {
    display: flex;
    gap: 1rem;
    font-size: var(--step--1);
    color: var(--color-text-secondary);
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
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
</style>
