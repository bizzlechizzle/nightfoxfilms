<script lang="ts">
  /**
   * LocationHeader - Location name display only
   * Per LILBITS: ~30 lines, single responsibility
   * DECISION-014: Removed favorite button (now in LocationInfo)
   * DECISION-015: Removed edit button (edit is in LocationMapSection)
   */
  import { router } from '../../stores/router';
  import type { Location } from '@au-archive/core';

  interface Props {
    location: Location;
  }

  let { location }: Props = $props();
</script>

<div class="mb-6">
  <button
    onclick={() => router.navigate('/locations')}
    class="text-sm text-braun-900 hover:underline mb-2"
  >
    &larr; Back to Locations
  </button>
  <div class="flex items-center">
    <h1 class="text-3xl font-bold text-braun-900">{location.locnam}</h1>
  </div>
  {#if location.akanam}
    <p class="text-braun-500 mt-1">Also Known As: {location.akanam}</p>
  {/if}
</div>
