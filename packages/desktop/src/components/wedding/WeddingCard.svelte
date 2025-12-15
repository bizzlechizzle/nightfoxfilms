<script lang="ts">
  /**
   * WeddingCard - Displays wedding summary in list/grid view
   * Follows Braun/Ulm functional minimalism
   */
  import StatusBadge from './StatusBadge.svelte';
  import ProgressBar from './ProgressBar.svelte';

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
    wedding: Wedding;
    onclick?: () => void;
  }

  const { wedding, onclick }: Props = $props();

  const formattedDate = $derived(() => {
    const date = new Date(wedding.wedding_date);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  });

  const location = $derived(() => {
    if (wedding.venue_name && wedding.venue_city) {
      return `${wedding.venue_name}, ${wedding.venue_city}`;
    }
    return wedding.venue_name || wedding.venue_city || null;
  });

  const progress = $derived(() => {
    const target = wedding.contracted_images || wedding.total_images;
    if (target === 0) return 0;
    if (wedding.status === 'delivered' || wedding.status === 'archived') return 100;
    return Math.round((wedding.edited_images / target) * 100);
  });
</script>

<button class="wedding-card" type="button" onclick={onclick}>
  <div class="wedding-card__header">
    <div>
      <h3 class="wedding-card__title">{wedding.display_name}</h3>
      <span class="wedding-card__date">{formattedDate()}</span>
    </div>
    <StatusBadge status={wedding.status} />
  </div>

  {#if location()}
    <p class="wedding-card__location">{location()}</p>
  {/if}

  <div class="wedding-card__footer">
    <div class="wedding-card__meta">
      <span>{wedding.total_images} images</span>
      {#if wedding.contracted_images}
        <span>{wedding.contracted_images} contracted</span>
      {/if}
    </div>
    <div class="wedding-card__progress">
      <ProgressBar
        percent={progress()}
        delivered={wedding.status === 'delivered'}
      />
    </div>
  </div>
</button>

<style>
  .wedding-card {
    display: block;
    width: 100%;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
  }

  .wedding-card__location {
    font-size: var(--step--1);
    color: var(--color-text-secondary);
    margin: 0 0 0.75rem;
  }

  .wedding-card__footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--color-border-muted);
  }

  .wedding-card__progress {
    width: 100px;
  }
</style>
