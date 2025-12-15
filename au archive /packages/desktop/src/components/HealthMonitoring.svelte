<script lang="ts">
  import { onMount } from 'svelte';

  let healthDashboard = $state<any>(null);
  let healthLoading = $state(false);
  let healthError = $state('');
  let showHealthDetails = $state(false);

  async function loadHealthDashboard() {
    try {
      healthLoading = true;
      healthError = '';
      healthDashboard = await window.electronAPI.health.getDashboard();
    } catch (error) {
      console.error('Error loading health dashboard:', error);
      healthError = 'Failed to load health information';
    } finally {
      healthLoading = false;
    }
  }

  async function runHealthCheck() {
    try {
      healthLoading = true;
      healthError = '';
      await window.electronAPI.health.runCheck();
      await loadHealthDashboard();
    } catch (error) {
      console.error('Error running health check:', error);
      healthError = 'Health check failed';
    } finally {
      healthLoading = false;
    }
  }

  async function createBackup() {
    try {
      healthLoading = true;
      await window.electronAPI.health.createBackup();
      await loadHealthDashboard();
    } catch (error) {
      console.error('Error creating backup:', error);
      healthError = 'Backup creation failed';
    } finally {
      healthLoading = false;
    }
  }

  async function runMaintenance() {
    try {
      healthLoading = true;
      await window.electronAPI.health.runMaintenance();
      await loadHealthDashboard();
    } catch (error) {
      console.error('Error running maintenance:', error);
      healthError = 'Maintenance failed';
    } finally {
      healthLoading = false;
    }
  }

  function formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function getStatusColor(status: string): string {
    if (status === 'healthy') return 'text-success';
    if (status === 'warning') return 'text-warning';
    return 'text-error';
  }

  function getStatusBgColor(status: string): string {
    // Use neutral backgrounds per Braun, color only in text
    if (status === 'healthy') return 'bg-braun-100';
    if (status === 'warning') return 'bg-braun-100';
    return 'bg-braun-100';
  }

  onMount(() => {
    loadHealthDashboard();
  });
</script>

<div class="bg-white rounded border border-braun-300 p-6 mb-6">
  <div class="flex justify-between items-center mb-3">
    <h2 class="text-lg font-semibold text-foreground">System Health</h2>
    <button
      onclick={runHealthCheck}
      disabled={healthLoading}
      class="px-3 py-1 text-sm bg-braun-200 text-foreground rounded hover:bg-braun-300 transition disabled:opacity-50"
    >
      {healthLoading ? 'Checking...' : 'Run Check'}
    </button>
  </div>

  {#if healthError}
    <div class="p-3 bg-braun-100 text-error rounded mb-3">
      {healthError}
    </div>
  {/if}

  {#if healthDashboard}
    <!-- Overall Status -->
    <div class="mb-5 p-4 rounded {getStatusBgColor(healthDashboard.status.overall)}">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="font-semibold {getStatusColor(healthDashboard.status.overall)}">
            Overall Status: {healthDashboard.status.overall.toUpperCase()}
          </h3>
          <p class="text-sm text-braun-600 mt-1">
            Last checked: {formatDate(healthDashboard.status.lastCheck)}
          </p>
        </div>
      </div>

      {#if healthDashboard.status.recommendations.length > 0}
        <div class="mt-3 pt-3 border-t border-braun-200">
          <p class="text-sm font-medium text-braun-700 mb-2">Recommendations:</p>
          <ul class="text-sm text-braun-600 list-disc list-inside">
            {#each healthDashboard.status.recommendations as rec}
              <li>{rec}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>

    <!-- Component Health Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
      <!-- Database Health -->
      <div class="p-4 border rounded">
        <div class="flex items-center justify-between mb-2">
          <h4 class="font-medium text-braun-900">Database</h4>
          <span class="text-xs px-2 py-1 rounded {getStatusBgColor(healthDashboard.status.components.database.status)} {getStatusColor(healthDashboard.status.components.database.status)}">
            {healthDashboard.status.components.database.status}
          </span>
        </div>
        <p class="text-sm text-braun-600">{healthDashboard.status.components.database.message}</p>
      </div>

      <!-- Backups Health -->
      <div class="p-4 border rounded">
        <div class="flex items-center justify-between mb-2">
          <h4 class="font-medium text-braun-900">Backups</h4>
          <span class="text-xs px-2 py-1 rounded {getStatusBgColor(healthDashboard.status.components.backups.status)} {getStatusColor(healthDashboard.status.components.backups.status)}">
            {healthDashboard.status.components.backups.status}
          </span>
        </div>
        <p class="text-sm text-braun-600">{healthDashboard.status.components.backups.message}</p>
      </div>

      <!-- Disk Space Health -->
      <div class="p-4 border rounded">
        <div class="flex items-center justify-between mb-2">
          <h4 class="font-medium text-braun-900">Disk Space</h4>
          <span class="text-xs px-2 py-1 rounded {getStatusBgColor(healthDashboard.status.components.diskSpace.status)} {getStatusColor(healthDashboard.status.components.diskSpace.status)}">
            {healthDashboard.status.components.diskSpace.status}
          </span>
        </div>
        <p class="text-sm text-braun-600">{healthDashboard.status.components.diskSpace.message}</p>
      </div>

      <!-- Data Integrity Health (from database check) -->
      {#if healthDashboard.status.components.database?.details?.errors !== undefined}
        <div class="p-4 border rounded">
          <div class="flex items-center justify-between mb-2">
            <h4 class="font-medium text-braun-900">Data Integrity</h4>
            <span class="text-xs px-2 py-1 rounded {getStatusBgColor(healthDashboard.status.components.database.status)} {getStatusColor(healthDashboard.status.components.database.status)}">
              {healthDashboard.status.components.database.status}
            </span>
          </div>
          <p class="text-sm text-braun-600">
            {#if healthDashboard.status.components.database.details?.errors?.length > 0}
              {healthDashboard.status.components.database.details.errors.length} integrity issues found
            {:else}
              Data integrity verified
            {/if}
          </p>
        </div>
      {/if}
    </div>

    <!-- Quick Actions -->
    <div class="flex gap-2">
      <button
        onclick={createBackup}
        disabled={healthLoading}
        class="px-3 py-1 text-sm bg-braun-100 text-braun-700 rounded hover:bg-braun-200 transition disabled:opacity-50"
      >
        Create Backup
      </button>
      <button
        onclick={runMaintenance}
        disabled={healthLoading}
        class="px-3 py-1 text-sm bg-braun-100 text-braun-700 rounded hover:bg-braun-200 transition disabled:opacity-50"
      >
        Run Maintenance
      </button>
      <button
        onclick={() => (showHealthDetails = !showHealthDetails)}
        class="px-3 py-1 text-sm bg-braun-100 text-braun-700 rounded hover:bg-braun-200 transition"
      >
        {showHealthDetails ? 'Hide' : 'Show'} Details
      </button>
    </div>

    {#if showHealthDetails && healthDashboard.stats}
      <div class="mt-4 pt-4 border-t">
        <h3 class="font-semibold text-braun-900 mb-3">Statistics</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p class="text-sm text-braun-600">Database Size</p>
            <p class="font-medium">{(healthDashboard.stats.databaseSize / (1024 * 1024)).toFixed(2)} MB</p>
          </div>
          <div>
            <p class="text-sm text-braun-600">Total Locations</p>
            <p class="font-medium">{healthDashboard.stats.totalLocations}</p>
          </div>
          <div>
            <p class="text-sm text-braun-600">Total Media</p>
            <p class="font-medium">{healthDashboard.stats.totalMedia}</p>
          </div>
          <div>
            <p class="text-sm text-braun-600">Backups</p>
            <p class="font-medium">{healthDashboard.stats.backupCount}</p>
          </div>
        </div>
      </div>
    {/if}
  {:else if healthLoading}
    <p class="text-braun-500">Loading health information...</p>
  {/if}
</div>
