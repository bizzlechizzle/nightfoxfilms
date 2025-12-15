<script lang="ts">
  /**
   * WeddingsStats - Statistics and analytics for wedding photography
   * Follows Braun/Ulm functional minimalism
   */
  interface MonthlyStats {
    weddingsShot: number;
    weddingsDelivered: number;
    inProgress: number;
    imagesEdited: number;
  }

  interface YearlyStats {
    totalWeddings: number;
    totalDelivered: number;
    deliveryRate: number;
    avgDaysToDelivery: number;
  }

  let currentYear = $state(new Date().getFullYear());
  let monthlyStats = $state<MonthlyStats[]>([]);
  let yearlyStats = $state<YearlyStats | null>(null);
  let loading = $state(true);

  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  async function loadStats() {
    loading = true;
    try {
      // Load yearly stats
      yearlyStats = await window.electronAPI.weddings.getYearlyStats(currentYear);

      // Load monthly stats for each month
      const monthlyPromises = Array.from({ length: 12 }, (_, i) =>
        window.electronAPI.weddings.getMonthlyStats(currentYear, i + 1)
      );
      monthlyStats = await Promise.all(monthlyPromises);
    } catch (e) {
      console.error('Failed to load stats:', e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadStats();
  });

  function previousYear() {
    currentYear--;
  }

  function nextYear() {
    currentYear++;
  }

  function goToCurrentYear() {
    currentYear = new Date().getFullYear();
  }

  const maxWeddingsInMonth = $derived(() => {
    return Math.max(...monthlyStats.map(m => m.weddingsShot), 1);
  });
</script>

<div class="page">
  <header class="page-header">
    <h1>Statistics</h1>
    <div class="year-nav">
      <button class="btn btn-secondary" onclick={previousYear}>Previous</button>
      <span class="year-nav__year">{currentYear}</span>
      <button class="btn btn-secondary" onclick={nextYear}>Next</button>
      <button class="btn btn-secondary" onclick={goToCurrentYear}>Current</button>
    </div>
  </header>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if yearlyStats}
    <!-- Yearly Overview -->
    <section class="stats-section">
      <h2 class="section-label">Year Overview</h2>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-card__label">Total Weddings</div>
          <div class="stat-card__value">{yearlyStats.totalWeddings}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Delivered</div>
          <div class="stat-card__value">{yearlyStats.totalDelivered}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Delivery Rate</div>
          <div class="stat-card__value">{yearlyStats.deliveryRate}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Avg. Days to Delivery</div>
          <div class="stat-card__value">{yearlyStats.avgDaysToDelivery}</div>
        </div>
      </div>
    </section>

    <!-- Monthly Chart -->
    <section class="stats-section">
      <h2 class="section-label">Weddings by Month</h2>
      <div class="chart">
        <div class="chart-bars">
          {#each monthlyStats as stats, i}
            <div class="chart-bar-container">
              <div
                class="chart-bar"
                style="height: {(stats.weddingsShot / maxWeddingsInMonth()) * 100}%"
              >
                {#if stats.weddingsShot > 0}
                  <span class="chart-bar__value">{stats.weddingsShot}</span>
                {/if}
              </div>
              <span class="chart-bar__label">{monthNames[i]}</span>
            </div>
          {/each}
        </div>
      </div>
    </section>

    <!-- Monthly Breakdown -->
    <section class="stats-section">
      <h2 class="section-label">Monthly Breakdown</h2>
      <div class="monthly-table">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Shot</th>
              <th>Delivered</th>
              <th>In Progress</th>
              <th>Images Edited</th>
            </tr>
          </thead>
          <tbody>
            {#each monthlyStats as stats, i}
              <tr>
                <td>{monthNames[i]}</td>
                <td>{stats.weddingsShot}</td>
                <td>{stats.weddingsDelivered}</td>
                <td>{stats.inProgress}</td>
                <td>{stats.imagesEdited.toLocaleString()}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {:else}
    <div class="empty-state">
      <h3 class="empty-state__title">No data for {currentYear}</h3>
      <p class="empty-state__text">Import weddings to see statistics</p>
    </div>
  {/if}
</div>

<style>
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  .year-nav {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .year-nav__year {
    font-size: var(--step-1);
    font-weight: 500;
    min-width: 80px;
    text-align: center;
  }

  .stats-section {
    margin-bottom: 2rem;
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
  }

  .chart {
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1.5rem;
  }

  .chart-bars {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    height: 200px;
  }

  .chart-bar-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
  }

  .chart-bar {
    width: 100%;
    background-color: var(--color-text);
    border-radius: 2px 2px 0 0;
    min-height: 2px;
    position: relative;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }

  .chart-bar__value {
    position: absolute;
    top: -20px;
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .chart-bar__label {
    font-size: 11px;
    color: var(--color-text-muted);
    margin-top: 0.5rem;
  }

  .monthly-table {
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    overflow: hidden;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th, td {
    padding: 0.75rem 1rem;
    text-align: left;
    border-bottom: 1px solid var(--color-border);
  }

  th {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
    background-color: var(--color-bg-alt);
  }

  td {
    font-size: var(--step-0);
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr:hover {
    background-color: var(--color-bg-alt);
  }

  .loading {
    text-align: center;
    padding: 3rem;
    color: var(--color-text-muted);
  }
</style>
