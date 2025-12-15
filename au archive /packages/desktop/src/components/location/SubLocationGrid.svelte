<script lang="ts">
  /**
   * SubLocationGrid - Grid of sub-location cards for host locations
   * Migration 28: 2 cols, click to navigate to sub-location detail
   * OPT-096: 4:1 aspect ratio with bottom-right text (matches sub-location page)
   */
  import { router } from '../../stores/router';

  interface SubLocation {
    subid: string;
    sub12: string;
    locid: string;
    subnam: string;
    ssubname: string | null;
    type: string | null;
    status: string | null;
    hero_imghash: string | null;
    is_primary: boolean;
    hero_thumb_path?: string;
  }

  interface Props {
    locid: string;
    sublocations: SubLocation[];
    onAddSubLocation?: () => void;
  }

  let { locid, sublocations, onAddSubLocation }: Props = $props();

  function navigateToSubLocation(subid: string) {
    router.navigate(`/location/${locid}/sub/${subid}`);
  }

  // Derived: Add Building should span full width when even number of buildings
  const addCardFullWidth = $derived(sublocations.length % 2 === 0);
</script>

<section class="mt-8">
  {#if sublocations.length === 0}
    <div class="text-center py-12 bg-braun-50 rounded border-2 border-dashed border-braun-200">
      <svg class="w-12 h-12 mx-auto text-braun-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
      <p class="text-braun-500 mb-2">No buildings added yet</p>
      <p class="text-sm text-braun-400">Add buildings to organize media by structure</p>
      {#if onAddSubLocation}
        <button
          onclick={onAddSubLocation}
          class="mt-4 px-4 py-2 bg-braun-900 text-white rounded hover:bg-braun-600 transition"
        >
          Add First Building
        </button>
      {/if}
    </div>
  {:else}
    <div class="grid grid-cols-2 gap-4">
      {#each sublocations as subloc}
        <button
          onclick={() => navigateToSubLocation(subloc.subid)}
          class="building-card rounded overflow-hidden text-left group"
        >
          <!-- Card container (4:1 aspect ratio) - transparent when no hero -->
          <div class="card-container relative overflow-hidden {subloc.hero_thumb_path ? 'bg-braun-100' : ''}" style="aspect-ratio: 4 / 1;">
            {#if subloc.hero_thumb_path}
              <img
                src="media://{subloc.hero_thumb_path}"
                alt={subloc.subnam}
                class="w-full h-full object-cover"
              />
              <!-- Hover-only overlay -->
              <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition pointer-events-none"></div>
              <!-- Bottom-right text - white -->
              <div class="absolute bottom-0 right-0 p-4 pointer-events-none">
                <span class="text-2xl font-bold" style="color: #FAFAF8;">
                  {subloc.subnam}
                </span>
              </div>
            {:else}
              <!-- No hero - title only, same position -->
              <div class="absolute bottom-0 right-0 p-4 pointer-events-none">
                <span class="text-2xl font-bold text-braun-900">
                  {subloc.subnam}
                </span>
              </div>
            {/if}
          </div>
        </button>
      {/each}

      <!-- Add card (4:1 aspect ratio to match building cards) -->
      {#if onAddSubLocation}
        <button
          onclick={onAddSubLocation}
          class="add-card rounded border-2 border-dashed border-braun-200 hover:border-braun-900 hover:bg-braun-100 transition flex flex-col items-center justify-center gap-2 {addCardFullWidth ? 'col-span-2' : ''}"
          style="aspect-ratio: 4 / 1;"
        >
          <svg class="w-8 h-8 text-braun-400 group-hover:text-braun-900 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          <span class="text-sm text-braun-500">Add Building</span>
        </button>
      {/if}
    </div>
  {/if}
</section>

<style>
  /* Premium hover effect - Braun design system */
  .building-card {
    transition: transform 200ms ease, border-color 200ms ease;
    border: 2px solid transparent;
  }

  .building-card:hover {
    transform: scale(1.02);
    border-color: #1C1C1A; /* braun-900 */
  }

  /* Add card hover */
  .add-card {
    transition: border-color 200ms ease, background-color 200ms ease;
  }

  .add-card:hover svg,
  .add-card:hover span {
    color: #1C1C1A; /* braun-900 */
  }
</style>
