<script lang="ts">
  // Nightfox Films - Main Application Shell
  import Dashboard from './pages/Dashboard.svelte';
  import Couples from './pages/Couples.svelte';
  import Import from './pages/Import.svelte';
  import Cameras from './pages/Cameras.svelte';
  import Settings from './pages/Settings.svelte';

  // Wedding CMS Pages
  import WeddingsDashboard from './pages/WeddingsDashboard.svelte';
  import WeddingsList from './pages/WeddingsList.svelte';
  import WeddingDetail from './pages/WeddingDetail.svelte';
  import WeddingsCalendar from './pages/WeddingsCalendar.svelte';
  import WeddingsStats from './pages/WeddingsStats.svelte';

  type Page = 'dashboard' | 'couples' | 'import' | 'cameras' | 'settings' |
              'weddings-dashboard' | 'weddings-list' | 'wedding-detail' | 'weddings-calendar' | 'weddings-stats';

  let currentPage = $state<Page>('weddings-dashboard');
  let selectedWeddingId = $state<string | null>(null);

  // Navigation sections
  const videoPages: { id: Page; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'couples', label: 'Couples' },
    { id: 'import', label: 'Import' },
    { id: 'cameras', label: 'Cameras' },
  ];

  const photoPages: { id: Page; label: string }[] = [
    { id: 'weddings-dashboard', label: 'Dashboard' },
    { id: 'weddings-list', label: 'Weddings' },
    { id: 'weddings-calendar', label: 'Calendar' },
    { id: 'weddings-stats', label: 'Stats' },
  ];

  const utilityPages: { id: Page; label: string }[] = [
    { id: 'settings', label: 'Settings' },
  ];

  function handleWeddingNavigate(page: string, weddingId?: string) {
    if (page === 'wedding-detail' && weddingId) {
      selectedWeddingId = weddingId;
      currentPage = 'wedding-detail';
    } else if (page === 'weddings-list') {
      currentPage = 'weddings-list';
      selectedWeddingId = null;
    }
  }

  function handleBackFromDetail() {
    currentPage = 'weddings-list';
    selectedWeddingId = null;
  }
</script>

<div class="app-container">
  <!-- Sidebar Navigation -->
  <nav class="sidebar">
    <div class="logo">
      <h1>Nightfox</h1>
      <span class="tagline">Films</span>
    </div>

    <!-- Photography Section -->
    <div class="nav-section">
      <span class="nav-section__label">Photography</span>
      <ul class="nav-links">
        {#each photoPages as page}
          <li>
            <button
              class="nav-link"
              class:active={currentPage === page.id}
              onclick={() => { currentPage = page.id; selectedWeddingId = null; }}
            >
              {page.label}
            </button>
          </li>
        {/each}
      </ul>
    </div>

    <!-- Videography Section -->
    <div class="nav-section">
      <span class="nav-section__label">Videography</span>
      <ul class="nav-links">
        {#each videoPages as page}
          <li>
            <button
              class="nav-link"
              class:active={currentPage === page.id}
              onclick={() => currentPage = page.id}
            >
              {page.label}
            </button>
          </li>
        {/each}
      </ul>
    </div>

    <!-- Utility Section -->
    <div class="nav-section nav-section--bottom">
      <ul class="nav-links">
        {#each utilityPages as page}
          <li>
            <button
              class="nav-link"
              class:active={currentPage === page.id}
              onclick={() => currentPage = page.id}
            >
              {page.label}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  </nav>

  <!-- Main Content Area -->
  <main class="content">
    {#if currentPage === 'dashboard'}
      <Dashboard />
    {:else if currentPage === 'couples'}
      <Couples />
    {:else if currentPage === 'import'}
      <Import />
    {:else if currentPage === 'cameras'}
      <Cameras />
    {:else if currentPage === 'settings'}
      <Settings />
    {:else if currentPage === 'weddings-dashboard'}
      <WeddingsDashboard onnavigate={handleWeddingNavigate} />
    {:else if currentPage === 'weddings-list'}
      <WeddingsList onnavigate={handleWeddingNavigate} />
    {:else if currentPage === 'wedding-detail' && selectedWeddingId}
      <WeddingDetail weddingId={selectedWeddingId} onback={handleBackFromDetail} />
    {:else if currentPage === 'weddings-calendar'}
      <WeddingsCalendar onnavigate={handleWeddingNavigate} />
    {:else if currentPage === 'weddings-stats'}
      <WeddingsStats />
    {/if}
  </main>
</div>

<style>
  .app-container {
    display: flex;
    min-height: 100vh;
  }

  .sidebar {
    width: 220px;
    background-color: var(--color-surface);
    border-right: 1px solid var(--color-border);
    padding: 1.5rem 1rem;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .logo {
    margin-bottom: 1.5rem;
    padding: 0 0.5rem;
  }

  .nav-section {
    margin-bottom: 1.5rem;
  }

  .nav-section--bottom {
    margin-top: auto;
    margin-bottom: 0;
    padding-top: 1rem;
    border-top: 1px solid var(--color-border);
  }

  .nav-section__label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-muted);
    padding: 0 0.5rem;
    margin-bottom: 0.5rem;
  }

  .logo h1 {
    font-size: var(--step-2);
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.02em;
  }

  .logo .tagline {
    font-size: var(--step--1);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .nav-links {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .nav-links li {
    margin-bottom: 0.25rem;
  }

  .nav-link {
    display: block;
    width: 100%;
    padding: 0.625rem 0.75rem;
    text-align: left;
    background: none;
    border: none;
    border-radius: 4px;
    font-size: var(--step-0);
    font-family: var(--font-sans);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
  }

  .nav-link:hover {
    background-color: var(--color-bg-alt);
    color: var(--color-text);
  }

  .nav-link.active {
    background-color: var(--color-text);
    color: var(--color-surface);
  }

  .content {
    flex: 1;
    padding: 2rem;
    background-color: var(--color-bg);
    overflow-y: auto;
  }

  :global(.page) {
    max-width: 1200px;
  }
</style>
