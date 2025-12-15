<script lang="ts">
  /**
   * SourceBadge - Clickable badge showing source domain
   * Per Braun: Minimal pill design, functional hover state
   */
  interface Props {
    domain: string;
    title?: string | null;
    url?: string | null;
    sourceId?: string;
    onClick?: (sourceId: string) => void;
  }

  let {
    domain,
    title = null,
    url = null,
    sourceId = '',
    onClick
  }: Props = $props();

  function handleClick() {
    if (onClick && sourceId) {
      onClick(sourceId);
    }
  }

  // Truncate long domains
  let displayDomain = $derived(() => {
    if (domain.length > 15) {
      return domain.slice(0, 12) + '...';
    }
    return domain;
  });
</script>

<button
  type="button"
  onclick={handleClick}
  title={title || domain}
  class="inline-flex items-center px-1.5 py-0.5 text-[11px] bg-braun-100 text-braun-600 rounded hover:bg-braun-200 hover:text-braun-800 transition-colors cursor-pointer"
>
  {displayDomain()}
</button>
