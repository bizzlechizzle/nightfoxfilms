<script lang="ts">
  // Nightfox Films - Main Application Shell
  import Dashboard from './pages/Dashboard.svelte';
  import Couples from './pages/Couples.svelte';
  import CoupleDetail from './pages/CoupleDetail.svelte';
  import Calendar from './pages/Calendar.svelte';
  import Import from './pages/Import.svelte';
  import Cameras from './pages/Cameras.svelte';
  import Stats from './pages/Stats.svelte';
  import Settings from './pages/Settings.svelte';

  type Page = 'dashboard' | 'couples' | 'couple-detail' | 'calendar' | 'import' | 'cameras' | 'stats' | 'settings';

  let currentPage = $state<Page>('dashboard');
  let selectedCoupleId = $state<number | null>(null);

  // Navigation pages
  const mainPages: { id: Page; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'couples', label: 'Projects' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'import', label: 'Import' },
    { id: 'cameras', label: 'Cameras' },
    { id: 'stats', label: 'Stats' },
  ];

  const utilityPages: { id: Page; label: string }[] = [
    { id: 'settings', label: 'Settings' },
  ];

  function handleCoupleNavigate(page: string, coupleId?: number) {
    if (page === 'couple-detail' && coupleId) {
      selectedCoupleId = coupleId;
      currentPage = 'couple-detail';
    } else if (page === 'couples') {
      currentPage = 'couples';
      selectedCoupleId = null;
    }
  }

  function handleBackFromDetail() {
    currentPage = 'couples';
    selectedCoupleId = null;
  }
</script>

<div class="app-container">
  <!-- Sidebar Navigation -->
  <nav class="sidebar">
    <div class="logo">
      <h1>Nightfox</h1>
      <span class="tagline">Films</span>
    </div>

    <!-- Main Navigation -->
    <div class="nav-section">
      <ul class="nav-links">
        {#each mainPages as page}
          <li>
            <button
              class="nav-link"
              class:active={currentPage === page.id || (page.id === 'couples' && currentPage === 'couple-detail')}
              onclick={() => { currentPage = page.id; selectedCoupleId = null; }}
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
      <Dashboard onnavigate={handleCoupleNavigate} />
    {:else if currentPage === 'couples'}
      <Couples onnavigate={handleCoupleNavigate} />
    {:else if currentPage === 'couple-detail' && selectedCoupleId}
      <CoupleDetail coupleId={selectedCoupleId} onback={handleBackFromDetail} />
    {:else if currentPage === 'calendar'}
      <Calendar onnavigate={handleCoupleNavigate} />
    {:else if currentPage === 'import'}
      <Import />
    {:else if currentPage === 'cameras'}
      <Cameras />
    {:else if currentPage === 'stats'}
      <Stats />
    {:else if currentPage === 'settings'}
      <Settings />
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
