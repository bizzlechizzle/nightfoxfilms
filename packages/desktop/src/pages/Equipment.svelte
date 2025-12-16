<script lang="ts">
  /**
   * Equipment - Manage physical equipment inventory
   * Includes cameras, lenses, audio, and loaner gear tracking
   * Follows Braun/Ulm functional minimalism
   */
  import type { Equipment, EquipmentInput, EquipmentType, EquipmentStatus, Medium } from '@nightfox/core';

  interface Props {
    onnavigate?: (page: string, id?: number) => void;
  }

  const { onnavigate }: Props = $props();

  let equipment = $state<Equipment[]>([]);
  let loading = $state(true);
  let searchQuery = $state('');
  let typeFilter = $state<EquipmentType | 'all'>('all');
  let statusFilter = $state<EquipmentStatus | 'all'>('all');
  let showCreateModal = $state(false);
  let editingEquipment = $state<Equipment | null>(null);

  // Form state
  let formName = $state('');
  let formType = $state<EquipmentType>('camera');
  let formMedium = $state<Medium | ''>('');
  let formMake = $state('');
  let formModel = $state('');
  let formSerial = $state('');
  let formPurchaseDate = $state('');
  let formPurchasePrice = $state('');
  let formStatus = $state<EquipmentStatus>('available');
  let formIsLoaner = $state(false);
  let formNotes = $state('');

  const typeLabels: Record<EquipmentType, string> = {
    camera: 'Camera',
    lens: 'Lens',
    audio: 'Audio',
    lighting: 'Lighting',
    support: 'Support',
    accessory: 'Accessory',
    media: 'Media',
  };

  const statusLabels: Record<EquipmentStatus, string> = {
    available: 'Available',
    loaned: 'On Loan',
    maintenance: 'Maintenance',
    retired: 'Retired',
    lost: 'Lost',
  };

  const mediumLabels: Record<Medium, string> = {
    dadcam: 'Dad Cam',
    super8: 'Super 8',
    modern: 'Modern Digital',
  };

  const typeOrder: EquipmentType[] = ['camera', 'lens', 'audio', 'lighting', 'support', 'accessory', 'media'];

  async function loadEquipment() {
    loading = true;
    try {
      if (typeFilter !== 'all' && statusFilter !== 'all') {
        const byType = await window.electronAPI.equipment.findByType(typeFilter);
        equipment = byType.filter(e => e.status === statusFilter);
      } else if (typeFilter !== 'all') {
        equipment = await window.electronAPI.equipment.findByType(typeFilter);
      } else if (statusFilter !== 'all') {
        equipment = await window.electronAPI.equipment.findByStatus(statusFilter);
      } else if (searchQuery) {
        equipment = await window.electronAPI.equipment.search(searchQuery);
      } else {
        equipment = await window.electronAPI.equipment.findAll();
      }
    } catch (error) {
      console.error('Failed to load equipment:', error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadEquipment();
  });

  async function saveEquipment() {
    if (!formName) return;

    try {
      const input: EquipmentInput = {
        name: formName,
        type: formType,
        medium: formMedium || null,
        make: formMake || null,
        model: formModel || null,
        serial_number: formSerial || null,
        purchase_date: formPurchaseDate || null,
        purchase_price: formPurchasePrice ? parseFloat(formPurchasePrice) : null,
        status: formStatus,
        is_loaner: formIsLoaner,
        notes: formNotes || null,
      };

      if (editingEquipment) {
        await window.electronAPI.equipment.update(editingEquipment.id, input);
      } else {
        await window.electronAPI.equipment.create(input);
      }
      closeModal();
      await loadEquipment();
    } catch (error) {
      console.error('Failed to save equipment:', error);
    }
  }

  async function deleteEquipment(id: number, event: Event) {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this equipment?')) {
      return;
    }

    try {
      await window.electronAPI.equipment.delete(id);
      await loadEquipment();
    } catch (error) {
      console.error('Failed to delete equipment:', error);
    }
  }

  function openCreateModal() {
    editingEquipment = null;
    formName = '';
    formType = 'camera';
    formMedium = '';
    formMake = '';
    formModel = '';
    formSerial = '';
    formPurchaseDate = '';
    formPurchasePrice = '';
    formStatus = 'available';
    formIsLoaner = false;
    formNotes = '';
    showCreateModal = true;
  }

  function openEditModal(item: Equipment, event: Event) {
    event.stopPropagation();
    editingEquipment = item;
    formName = item.name;
    formType = item.type as EquipmentType;
    formMedium = (item.medium as Medium) || '';
    formMake = item.make || '';
    formModel = item.model || '';
    formSerial = item.serial_number || '';
    formPurchaseDate = item.purchase_date || '';
    formPurchasePrice = item.purchase_price?.toString() || '';
    formStatus = item.status as EquipmentStatus;
    formIsLoaner = item.is_loaner === 1;
    formNotes = item.notes || '';
    showCreateModal = true;
  }

  function closeModal() {
    showCreateModal = false;
    editingEquipment = null;
  }

  function handleSearch(event: Event) {
    searchQuery = (event.target as HTMLInputElement).value;
    typeFilter = 'all';
    statusFilter = 'all';
    loadEquipment();
  }

  function handleTypeFilter(type: EquipmentType | 'all') {
    typeFilter = type;
    searchQuery = '';
    loadEquipment();
  }

  function handleStatusFilter(status: EquipmentStatus | 'all') {
    statusFilter = status;
    searchQuery = '';
    loadEquipment();
  }

  function formatPrice(price: number | null): string {
    if (!price) return '';
    return `$${price.toLocaleString()}`;
  }

  function getStatusColor(status: EquipmentStatus): string {
    switch (status) {
      case 'available': return 'bg-green-100 text-green-800';
      case 'loaned': return 'bg-blue-100 text-blue-800';
      case 'maintenance': return 'bg-yellow-100 text-yellow-800';
      case 'retired': return 'bg-gray-100 text-gray-600';
      case 'lost': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-600';
    }
  }

  function getMediumColor(medium: string | null): string {
    switch (medium) {
      case 'dadcam': return 'bg-medium-dadcam';
      case 'super8': return 'bg-medium-super8';
      case 'modern': return 'bg-medium-modern';
      default: return 'bg-gray-400';
    }
  }

  // Get counts by type
  const typeCounts = $derived(() => {
    const counts: Record<string, number> = { all: equipment.length };
    for (const type of typeOrder) {
      counts[type] = equipment.filter(e => e.type === type).length;
    }
    return counts;
  });

  // Equipment grouped by type for display
  const groupedEquipment = $derived(() => {
    const groups: Record<EquipmentType, Equipment[]> = {
      camera: [],
      lens: [],
      audio: [],
      lighting: [],
      support: [],
      accessory: [],
      media: [],
    };
    for (const item of equipment) {
      if (groups[item.type as EquipmentType]) {
        groups[item.type as EquipmentType].push(item);
      }
    }
    return groups;
  });

  // Loaner gear ready for assignment
  const availableLoaners = $derived(() => {
    return equipment.filter(e => e.is_loaner && e.status === 'available');
  });
</script>

<div class="page">
  <header class="page-header">
    <div>
      <h1>Equipment</h1>
      <p class="page-subtitle">Physical equipment inventory and tracking</p>
    </div>
    <button class="btn btn-primary" onclick={openCreateModal}>
      Add Equipment
    </button>
  </header>

  <!-- Search and Filters -->
  <div class="controls">
    <input
      type="text"
      class="search-input"
      placeholder="Search equipment..."
      value={searchQuery}
      oninput={handleSearch}
    />
    <div class="status-filters">
      <button
        class="filter-btn"
        class:active={typeFilter === 'all'}
        onclick={() => handleTypeFilter('all')}
      >
        All ({typeCounts().all})
      </button>
      {#each typeOrder as type}
        {#if typeCounts()[type] > 0}
          <button
            class="filter-btn"
            class:active={typeFilter === type}
            onclick={() => handleTypeFilter(type)}
          >
            {typeLabels[type]} ({typeCounts()[type]})
          </button>
        {/if}
      {/each}
    </div>
  </div>

  <!-- Status filter row -->
  <div class="controls secondary">
    <div class="status-filters">
      <span class="filter-label">Status:</span>
      <button
        class="filter-btn small"
        class:active={statusFilter === 'all'}
        onclick={() => handleStatusFilter('all')}
      >
        All
      </button>
      <button
        class="filter-btn small"
        class:active={statusFilter === 'available'}
        onclick={() => handleStatusFilter('available')}
      >
        Available
      </button>
      <button
        class="filter-btn small"
        class:active={statusFilter === 'loaned'}
        onclick={() => handleStatusFilter('loaned')}
      >
        On Loan
      </button>
      <button
        class="filter-btn small"
        class:active={statusFilter === 'maintenance'}
        onclick={() => handleStatusFilter('maintenance')}
      >
        Maintenance
      </button>
    </div>
  </div>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if equipment.length === 0}
    <div class="empty-state">
      {#if searchQuery}
        <h3 class="empty-state__title">No results</h3>
        <p class="empty-state__text">No equipment found matching "{searchQuery}"</p>
      {:else}
        <h3 class="empty-state__title">No equipment yet</h3>
        <p class="empty-state__text">Add your first piece of equipment to start tracking inventory</p>
        <button class="btn btn-primary" onclick={openCreateModal}>Add Equipment</button>
      {/if}
    </div>
  {:else}
    <!-- Loaner summary if any available -->
    {#if availableLoaners().length > 0}
      <div class="loaner-summary">
        <span class="loaner-badge">{availableLoaners().length} Loaner{availableLoaners().length !== 1 ? 's' : ''} Available</span>
        <span class="loaner-list">
          {availableLoaners().slice(0, 3).map(e => e.name).join(', ')}
          {#if availableLoaners().length > 3}
            +{availableLoaners().length - 3} more
          {/if}
        </span>
      </div>
    {/if}

    <!-- Equipment list -->
    <div class="equipment-grid">
      {#each equipment as item (item.id)}
        <div class="equipment-card" onclick={(e) => openEditModal(item, e)}>
          <div class="equipment-card__header">
            <div class="equipment-card__title">
              {#if item.medium}
                <span class="medium-dot {getMediumColor(item.medium)}"></span>
              {/if}
              <span>{item.name}</span>
              {#if item.is_loaner}
                <span class="loaner-tag">Loaner</span>
              {/if}
            </div>
            <span class="equipment-card__status {getStatusColor(item.status as EquipmentStatus)}">
              {statusLabels[item.status as EquipmentStatus]}
            </span>
          </div>
          <div class="equipment-card__body">
            <div class="equipment-card__type">{typeLabels[item.type as EquipmentType]}</div>
            {#if item.make || item.model}
              <div class="equipment-card__make-model">
                {item.make}{item.make && item.model ? ' ' : ''}{item.model}
              </div>
            {/if}
            {#if item.serial_number}
              <div class="equipment-card__serial">S/N: {item.serial_number}</div>
            {/if}
          </div>
          <div class="equipment-card__footer">
            {#if item.purchase_price}
              <span class="equipment-card__price">{formatPrice(item.purchase_price)}</span>
            {/if}
            <button
              class="btn-icon delete"
              onclick={(e) => deleteEquipment(item.id, e)}
              title="Delete"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Create/Edit Modal -->
{#if showCreateModal}
  <div class="modal-overlay" onclick={closeModal}>
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <header class="modal__header">
        <h2>{editingEquipment ? 'Edit Equipment' : 'Add Equipment'}</h2>
        <button class="btn-icon" onclick={closeModal}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </header>
      <form class="modal__body" onsubmit={(e) => { e.preventDefault(); saveEquipment(); }}>
        <div class="form-row">
          <div class="form-group">
            <label for="name">Name *</label>
            <input type="text" id="name" bind:value={formName} required />
          </div>
          <div class="form-group">
            <label for="type">Type *</label>
            <select id="type" bind:value={formType}>
              {#each typeOrder as type}
                <option value={type}>{typeLabels[type]}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="make">Make</label>
            <input type="text" id="make" bind:value={formMake} placeholder="e.g., Canon, Kodak" />
          </div>
          <div class="form-group">
            <label for="model">Model</label>
            <input type="text" id="model" bind:value={formModel} placeholder="e.g., 814XL-S" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="serial">Serial Number</label>
            <input type="text" id="serial" bind:value={formSerial} />
          </div>
          <div class="form-group">
            <label for="medium">Medium</label>
            <select id="medium" bind:value={formMedium}>
              <option value="">None</option>
              <option value="dadcam">Dad Cam</option>
              <option value="super8">Super 8</option>
              <option value="modern">Modern Digital</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="purchaseDate">Purchase Date</label>
            <input type="date" id="purchaseDate" bind:value={formPurchaseDate} />
          </div>
          <div class="form-group">
            <label for="purchasePrice">Purchase Price</label>
            <input type="number" id="purchasePrice" bind:value={formPurchasePrice} step="0.01" min="0" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="status">Status</label>
            <select id="status" bind:value={formStatus}>
              <option value="available">Available</option>
              <option value="loaned">On Loan</option>
              <option value="maintenance">Maintenance</option>
              <option value="retired">Retired</option>
              <option value="lost">Lost</option>
            </select>
          </div>
          <div class="form-group checkbox-group">
            <label>
              <input type="checkbox" bind:checked={formIsLoaner} />
              Available as loaner for couples
            </label>
          </div>
        </div>

        <div class="form-group">
          <label for="notes">Notes</label>
          <textarea id="notes" bind:value={formNotes} rows="3"></textarea>
        </div>

        <div class="modal__footer">
          <button type="button" class="btn" onclick={closeModal}>Cancel</button>
          <button type="submit" class="btn btn-primary">
            {editingEquipment ? 'Save Changes' : 'Add Equipment'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .page {
    padding: 24px;
    max-width: 1400px;
    margin: 0 auto;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
  }

  .page-header h1 {
    font-size: 28px;
    font-weight: 600;
    margin: 0;
    color: var(--color-text);
  }

  .page-subtitle {
    margin: 4px 0 0;
    color: var(--color-text-secondary);
    font-size: 14px;
  }

  .controls {
    display: flex;
    gap: 16px;
    margin-bottom: 16px;
    flex-wrap: wrap;
    align-items: center;
  }

  .controls.secondary {
    margin-bottom: 24px;
  }

  .search-input {
    flex: 1;
    min-width: 200px;
    max-width: 400px;
    padding: 8px 12px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    font-size: 14px;
    background: var(--color-bg);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .status-filters {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }

  .filter-label {
    font-size: 13px;
    color: var(--color-text-secondary);
  }

  .filter-btn {
    padding: 6px 12px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg);
    color: var(--color-text-secondary);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .filter-btn:hover {
    border-color: var(--color-primary);
    color: var(--color-text);
  }

  .filter-btn.active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }

  .filter-btn.small {
    padding: 4px 10px;
    font-size: 12px;
  }

  .loading {
    text-align: center;
    padding: 48px;
    color: var(--color-text-secondary);
  }

  .empty-state {
    text-align: center;
    padding: 64px 24px;
    background: var(--color-surface);
    border-radius: 8px;
    border: 1px dashed var(--color-border);
  }

  .empty-state__title {
    margin: 0 0 8px;
    font-size: 18px;
    font-weight: 500;
    color: var(--color-text);
  }

  .empty-state__text {
    margin: 0 0 24px;
    color: var(--color-text-secondary);
  }

  .loaner-summary {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    margin-bottom: 24px;
  }

  .loaner-badge {
    background: var(--color-primary);
    color: white;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
  }

  .loaner-list {
    color: var(--color-text-secondary);
    font-size: 13px;
  }

  .equipment-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .equipment-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 16px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .equipment-card:hover {
    border-color: var(--color-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  .equipment-card__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
  }

  .equipment-card__title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
    color: var(--color-text);
  }

  .medium-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .bg-medium-dadcam {
    background-color: #F59E0B;
  }

  .bg-medium-super8 {
    background-color: #8B5CF6;
  }

  .bg-medium-modern {
    background-color: #3B82F6;
  }

  .loaner-tag {
    font-size: 10px;
    padding: 2px 6px;
    background: var(--color-primary);
    color: white;
    border-radius: 4px;
    text-transform: uppercase;
    font-weight: 600;
  }

  .equipment-card__status {
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    font-weight: 500;
    text-transform: uppercase;
  }

  .bg-green-100 { background: #D1FAE5; }
  .text-green-800 { color: #065F46; }
  .bg-blue-100 { background: #DBEAFE; }
  .text-blue-800 { color: #1E40AF; }
  .bg-yellow-100 { background: #FEF3C7; }
  .text-yellow-800 { color: #92400E; }
  .bg-gray-100 { background: #F3F4F6; }
  .text-gray-600 { color: #4B5563; }
  .bg-red-100 { background: #FEE2E2; }
  .text-red-800 { color: #991B1B; }

  .equipment-card__body {
    margin-bottom: 12px;
  }

  .equipment-card__type {
    font-size: 12px;
    color: var(--color-text-secondary);
    margin-bottom: 4px;
  }

  .equipment-card__make-model {
    font-size: 13px;
    color: var(--color-text);
  }

  .equipment-card__serial {
    font-size: 11px;
    color: var(--color-text-secondary);
    font-family: monospace;
    margin-top: 4px;
  }

  .equipment-card__footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 12px;
    border-top: 1px solid var(--color-border);
  }

  .equipment-card__price {
    font-size: 13px;
    color: var(--color-text-secondary);
  }

  .btn {
    padding: 8px 16px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn:hover {
    border-color: var(--color-primary);
  }

  .btn-primary {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }

  .btn-primary:hover {
    background: var(--color-primary-dark);
    border-color: var(--color-primary-dark);
  }

  .btn-icon {
    padding: 4px;
    border: none;
    background: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s;
  }

  .btn-icon:hover {
    background: var(--color-surface);
    color: var(--color-text);
  }

  .btn-icon.delete:hover {
    background: #FEE2E2;
    color: #DC2626;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--color-bg);
    border-radius: 12px;
    width: 90%;
    max-width: 600px;
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid var(--color-border);
  }

  .modal__header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .modal__body {
    padding: 24px;
  }

  .modal__footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 24px;
    margin-top: 24px;
    border-top: 1px solid var(--color-border);
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-group label {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text);
  }

  .form-group input,
  .form-group select,
  .form-group textarea {
    padding: 8px 12px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    font-size: 14px;
    background: var(--color-bg);
  }

  .form-group input:focus,
  .form-group select:focus,
  .form-group textarea:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .checkbox-group {
    flex-direction: row;
    align-items: center;
  }

  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: normal;
    cursor: pointer;
  }

  .checkbox-group input[type="checkbox"] {
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
</style>
