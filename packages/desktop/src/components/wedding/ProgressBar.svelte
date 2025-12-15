<script lang="ts">
  /**
   * ProgressBar - Visual progress indicator
   * Follows Braun/Ulm functional minimalism
   */
  interface Props {
    percent: number;
    delivered?: boolean;
    showLabel?: boolean;
  }

  const { percent, delivered = false, showLabel = false }: Props = $props();

  const clampedPercent = $derived(Math.max(0, Math.min(100, percent)));
</script>

<div class="progress-container">
  <div
    class="progress-bar"
    class:progress-bar--delivered={delivered}
    role="progressbar"
    aria-valuenow={clampedPercent}
    aria-valuemin={0}
    aria-valuemax={100}
  >
    <div class="progress-bar__fill" style="width: {clampedPercent}%"></div>
  </div>
  {#if showLabel}
    <span class="progress-label">{clampedPercent}%</span>
  {/if}
</div>

<style>
  .progress-container {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .progress-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--color-text-muted);
    min-width: 32px;
    text-align: right;
  }
</style>
