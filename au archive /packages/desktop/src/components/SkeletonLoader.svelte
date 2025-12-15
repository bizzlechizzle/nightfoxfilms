<script lang="ts">
  /**
   * SkeletonLoader - Static loading placeholders
   * Braun/Ulm: No animated loading states. Static blocks indicate loading.
   *
   * Usage:
   *   <SkeletonLoader type="card" />
   *   <SkeletonLoader type="row" count={5} />
   *   <SkeletonLoader type="grid" count={8} />
   *   <SkeletonLoader type="text" width="60%" />
   */

  interface Props {
    type?: 'card' | 'row' | 'grid' | 'text' | 'thumbnail' | 'table-row';
    count?: number;
    width?: string;
    height?: string;
  }

  let { type = 'text', count = 1, width = '100%', height }: Props = $props();
</script>

{#if type === 'card'}
  {#each Array(count) as _, i}
    <div class="skeleton-card rounded overflow-hidden">
      <div class="skeleton-shimmer aspect-video bg-braun-200"></div>
      <div class="p-4 space-y-2">
        <div class="skeleton-shimmer h-4 bg-braun-200 rounded w-3/4"></div>
        <div class="skeleton-shimmer h-3 bg-braun-200 rounded w-1/2"></div>
      </div>
    </div>
  {/each}

{:else if type === 'row'}
  {#each Array(count) as _, i}
    <div class="flex items-center gap-4 p-4">
      <div class="skeleton-shimmer w-16 h-16 bg-braun-200 rounded flex-shrink-0"></div>
      <div class="flex-1 space-y-2">
        <div class="skeleton-shimmer h-4 bg-braun-200 rounded w-3/4"></div>
        <div class="skeleton-shimmer h-3 bg-braun-200 rounded w-1/2"></div>
      </div>
    </div>
  {/each}

{:else if type === 'grid'}
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
    {#each Array(count) as _, i}
      <div class="skeleton-shimmer aspect-[1.618/1] bg-braun-200 rounded"></div>
    {/each}
  </div>

{:else if type === 'thumbnail'}
  {#each Array(count) as _, i}
    <div class="skeleton-shimmer bg-braun-200 rounded" style="width: {width}; height: {height || '64px'};"></div>
  {/each}

{:else if type === 'table-row'}
  {#each Array(count) as _, i}
    <div class="grid grid-cols-[1fr_150px_200px_80px] border-b border-braun-100" style="height: 60px;">
      <div class="px-6 py-4 flex flex-col justify-center gap-1">
        <div class="skeleton-shimmer h-4 bg-braun-200 rounded w-3/4"></div>
        <div class="skeleton-shimmer h-3 bg-braun-200 rounded w-1/2"></div>
      </div>
      <div class="px-6 py-4 flex items-center">
        <div class="skeleton-shimmer h-4 bg-braun-200 rounded w-20"></div>
      </div>
      <div class="px-6 py-4 flex items-center">
        <div class="skeleton-shimmer h-4 bg-braun-200 rounded w-28"></div>
      </div>
      <div class="px-6 py-4 flex items-center">
        <div class="skeleton-shimmer h-5 bg-braun-200 rounded-full w-10"></div>
      </div>
    </div>
  {/each}

{:else}
  <!-- Default: text line -->
  <div class="skeleton-shimmer h-4 bg-braun-200 rounded" style="width: {width};"></div>
{/if}

<style>
  /* Braun/Ulm: Static loading placeholders - no animation */
  .skeleton-card {
    background: white;
    border: 1px solid #E2E1DE; /* braun-300 */
  }
</style>
