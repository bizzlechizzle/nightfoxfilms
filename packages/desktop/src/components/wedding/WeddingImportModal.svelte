<script lang="ts">
  /**
   * WeddingImportModal - Import new wedding from folder
   * Follows Braun/Ulm functional minimalism
   */
  interface FolderResult {
    path: string;
    imageCount: number;
    parsedMeta?: {
      partnerAName?: string;
      partnerBName?: string;
      weddingDate?: string;
    };
  }

  interface Props {
    open: boolean;
    onclose: () => void;
    oncreated: () => void;
  }

  const { open, onclose, oncreated }: Props = $props();

  let folderResult = $state<FolderResult | null>(null);
  let partnerAName = $state('');
  let partnerBName = $state('');
  let weddingDate = $state('');
  let venueName = $state('');
  let venueCity = $state('');
  let venueState = $state('');
  let packageName = $state('');
  let contractedImages = $state('');
  let loading = $state(false);
  let error = $state('');

  async function selectFolder() {
    try {
      const result = await window.electronAPI.weddings.selectFolder();
      if (result) {
        folderResult = result;
        // Auto-fill from parsed metadata
        if (result.parsedMeta) {
          if (result.parsedMeta.partnerAName) partnerAName = result.parsedMeta.partnerAName;
          if (result.parsedMeta.partnerBName) partnerBName = result.parsedMeta.partnerBName;
          if (result.parsedMeta.weddingDate) weddingDate = result.parsedMeta.weddingDate;
        }
      }
    } catch (e) {
      error = 'Failed to select folder';
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!folderResult || !partnerAName || !partnerBName || !weddingDate) return;

    loading = true;
    error = '';

    try {
      await window.electronAPI.weddings.create({
        partner_a_name: partnerAName,
        partner_b_name: partnerBName,
        wedding_date: weddingDate,
        venue_name: venueName || undefined,
        venue_city: venueCity || undefined,
        venue_state: venueState || undefined,
        source_path: folderResult.path,
        total_images: folderResult.imageCount,
        package_name: packageName || undefined,
        contracted_images: contractedImages ? parseInt(contractedImages, 10) : undefined,
      });

      // Reset form
      folderResult = null;
      partnerAName = '';
      partnerBName = '';
      weddingDate = '';
      venueName = '';
      venueCity = '';
      venueState = '';
      packageName = '';
      contractedImages = '';

      oncreated();
      onclose();
    } catch (e) {
      error = 'Failed to create wedding';
    } finally {
      loading = false;
    }
  }

  function handleClose() {
    if (!loading) {
      folderResult = null;
      partnerAName = '';
      partnerBName = '';
      weddingDate = '';
      venueName = '';
      venueCity = '';
      venueState = '';
      packageName = '';
      contractedImages = '';
      error = '';
      onclose();
    }
  }

  const isValid = $derived(
    folderResult && partnerAName.trim() && partnerBName.trim() && weddingDate
  );
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={handleClose} role="presentation">
    <!-- svelte-ignore a11y_interactive_supports_focus a11y_click_events_have_key_events -->
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal__header">
        <h2 id="modal-title" class="modal__title">Import Wedding</h2>
      </div>

      <form class="modal__body" onsubmit={handleSubmit}>
        <!-- Folder Selection -->
        <div class="form-group">
          <label class="form-label" for="folder-select">Source Folder</label>
          {#if folderResult}
            <div class="folder-selected">
              <span class="folder-path">{folderResult.path}</span>
              <span class="folder-count">{folderResult.imageCount} images</span>
              <button type="button" class="btn btn-secondary" onclick={selectFolder}>
                Change
              </button>
            </div>
          {:else}
            <button
              type="button"
              id="folder-select"
              class="folder-drop-zone"
              onclick={selectFolder}
            >
              <span class="folder-drop-zone__text">Click to select folder</span>
            </button>
          {/if}
        </div>

        <!-- Partner Names -->
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="partner-a">Partner A Name</label>
            <input
              type="text"
              id="partner-a"
              class="input"
              bind:value={partnerAName}
              placeholder="First Last"
              required
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="partner-b">Partner B Name</label>
            <input
              type="text"
              id="partner-b"
              class="input"
              bind:value={partnerBName}
              placeholder="First Last"
              required
            />
          </div>
        </div>

        <!-- Wedding Date -->
        <div class="form-group">
          <label class="form-label" for="wedding-date">Wedding Date</label>
          <input
            type="date"
            id="wedding-date"
            class="input"
            bind:value={weddingDate}
            required
          />
        </div>

        <!-- Venue -->
        <div class="form-group">
          <label class="form-label" for="venue-name">Venue</label>
          <input
            type="text"
            id="venue-name"
            class="input"
            bind:value={venueName}
            placeholder="Venue name"
          />
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="venue-city">City</label>
            <input
              type="text"
              id="venue-city"
              class="input"
              bind:value={venueCity}
              placeholder="City"
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="venue-state">State</label>
            <input
              type="text"
              id="venue-state"
              class="input"
              bind:value={venueState}
              placeholder="State"
            />
          </div>
        </div>

        <!-- Contract Details -->
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="package-name">Package</label>
            <input
              type="text"
              id="package-name"
              class="input"
              bind:value={packageName}
              placeholder="e.g., Premium"
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="contracted-images">Contracted Images</label>
            <input
              type="number"
              id="contracted-images"
              class="input"
              bind:value={contractedImages}
              placeholder="e.g., 500"
              min="0"
            />
          </div>
        </div>

        {#if error}
          <p class="error-text">{error}</p>
        {/if}
      </form>

      <div class="modal__footer">
        <button type="button" class="btn btn-secondary" onclick={handleClose} disabled={loading}>
          Cancel
        </button>
        <button
          type="submit"
          class="btn btn-primary"
          onclick={handleSubmit}
          disabled={!isValid || loading}
        >
          {loading ? 'Importing...' : 'Import'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .folder-drop-zone {
    width: 100%;
    padding: 2rem;
    border: 2px dashed var(--color-border);
    border-radius: 4px;
    background: none;
    cursor: pointer;
    transition: border-color 0.15s, background-color 0.15s;
  }

  .folder-drop-zone:hover {
    border-color: var(--color-text-muted);
    background-color: var(--color-bg-alt);
  }

  .folder-drop-zone__text {
    font-size: var(--step-0);
    color: var(--color-text-muted);
  }

  .folder-selected {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem;
    background-color: var(--color-bg-alt);
    border-radius: 4px;
  }

  .folder-path {
    flex: 1;
    font-size: var(--step--1);
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder-count {
    font-size: var(--step--1);
    font-weight: 500;
    color: var(--color-text);
  }

  .error-text {
    color: var(--color-error);
    font-size: var(--step--1);
    margin-top: 1rem;
  }
</style>
