<script lang="ts">
  /**
   * WeddingsList - List view of all weddings with filtering
   * Follows Braun/Ulm functional minimalism
   */
  import WeddingCard from '../components/wedding/WeddingCard.svelte';
  import WeddingImportModal from '../components/wedding/WeddingImportModal.svelte';

  type Status = 'imported' | 'culling' | 'editing' | 'delivered' | 'archived';

  interface Wedding {
    id: string;
    display_name: string;
    wedding_date: string;
    status: Status;
    venue_name?: string | null;
    venue_city?: string | null;
    total_images: number;
    edited_images: number;
    contracted_images?: number | null;
  }

  interface Props {
    onnavigate?: (page: string, weddingId?: string) => void;
  }

  const { onnavigate }: Props = $props();

  let weddings = $state<Wedding[]>([]);
  let statusCounts = $state<Record<Status | 'all', number>>({
    all: 0,
    imported: 0,
    culling: 0,
    editing: 0,
    delivered: 0,
    archived: 0,
  });
  let activeFilter = $state<Status | 'all'>('all');
  let searchQuery = $state('');
  let loading = $state(true);
  let showImportModal = $state(false);

  async function loadWeddings() {
    loading = true;
    try {
      const filters: Record<string, unknown> = {};

      if (activeFilter !== 'all') {
        filters.status = activeFilter;
      }

      if (searchQuery.trim()) {
        filters.search = searchQuery.trim();
      }

      weddings = await window.electronAPI.weddings.findAll(filters);

      // Get counts for all statuses
      const allWeddings = await window.electronAPI.weddings.findAll();
      statusCounts = {
        all: allWeddings.length,
        imported: allWeddings.filter((w: Wedding) => w.status === 'imported').length,
        culling: allWeddings.filter((w: Wedding) => w.status === 'culling').length,
        editing: allWeddings.filter((w: Wedding) => w.status === 'editing').length,
        delivered: allWeddings.filter((w: Wedding) => w.status === 'delivered').length,
        archived: allWeddings.filter((w: Wedding) => w.status === 'archived').length,
      };
    } catch (e) {
      console.error('Failed to load weddings:', e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadWeddings();
  });

  function handleFilterChange(filter: Status | 'all') {
    activeFilter = filter;
    loadWeddings();
  }

  function handleSearch(e: Event) {
    const input = e.target as HTMLInputElement;
    searchQuery = input.value;
    loadWeddings();
  }

  function handleWeddingClick(weddingId: string) {
    onnavigate?.('wedding-detail', weddingId);
  }

  const tabs: Array<{ id: Status | 'all'; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'imported', label: 'Imported' },
    { id: 'culling', label: 'Culling' },
    { id: 'editing', label: 'Editing' },
    { id: 'delivered', label: 'Delivered' },
    { id: 'archived', label: 'Archived' },
  ];
</script>

<div class="page">
  <header class="page-header">
    <h1>Weddings</h1>
    <button class="btn btn-primary" onclick={() => showImportModal = true}>
      Import Wedding
    </button>
  </header>

  <!-- Search -->
  <div class="search-bar">
    <input
      type="search"
      class="input"
      placeholder="Search weddings..."
      value={searchQuery}
      oninput={handleSearch}
    />
  </div>

  <!-- Filter Tabs -->
  <div class="filter-tabs">
    {#each tabs as tab}
      <button
        class="filter-tab"
        class:filter-tab--active={activeFilter === tab.id}
        onclick={() => handleFilterChange(tab.id)}
      >
        {tab.label}
        <span class="filter-tab__count">{statusCounts[tab.id]}</span>
      </button>
    {/each}
  </div>

  <!-- Wedding List -->
  {#if loading}
    <div class="loading">Loading...</div>
  {:else if weddings.length === 0}
    <div class="empty-state">
      <h3 class="empty-state__title">
        {#if searchQuery}
          No weddings found
        {:else if activeFilter !== 'all'}
          No weddings in {activeFilter}
        {:else}
          No weddings yet
        {/if}
      </h3>
      <p class="empty-state__text">
        {#if searchQuery}
          Try a different search term
        {:else}
          Import your first wedding to get started
        {/if}
      </p>
      {#if !searchQuery}
        <button class="btn btn-primary" onclick={() => showImportModal = true}>
          Import Wedding
        </button>
      {/if}
    </div>
  {:else}
    <div class="wedding-grid">
      {#each weddings as wedding (wedding.id)}
        <WeddingCard
          {wedding}
          onclick={() => handleWeddingClick(wedding.id)}
        />
      {/each}
    </div>
  {/if}
</div>

<WeddingImportModal
  open={showImportModal}
  onclose={() => showImportModal = false}
  oncreated={loadWeddings}
/>

<style>
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .search-bar {
    margin-bottom: 1rem;
  }

  .search-bar .input {
    max-width: 300px;
  }

  .wedding-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem;
  }

  .loading {
    text-align: center;
    padding: 3rem;
    color: var(--color-text-muted);
  }
</style>
