<script lang="ts">
  import AutoTaggingCategory from './AutoTaggingCategory.svelte';
  import { CATEGORY_KEYS, type CategoryKey } from './default-prompts';

  interface Props {
    expanded?: boolean;
    onToggle?: () => void;
  }

  let { expanded = false, onToggle }: Props = $props();

  // Track which category is expanded (only one at a time)
  let expandedCategory = $state<CategoryKey | null>(null);

  function toggleCategory(category: CategoryKey) {
    expandedCategory = expandedCategory === category ? null : category;
  }
</script>

<div class="border-b border-braun-200 last:border-b-0">
  <!-- Section Header -->
  <button
    onclick={onToggle}
    class="w-full py-4 flex items-center justify-between text-left hover:bg-braun-50 transition-colors"
  >
    <span class="text-base font-semibold text-braun-900">Auto Tagging</span>
    <svg
      class="w-5 h-5 text-braun-400 transition-transform duration-200 {expanded ? 'rotate-180' : ''}"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  <!-- Section Content -->
  {#if expanded}
    <div class="pl-4 pb-4">
      <p class="text-xs text-braun-500 mb-4">
        Configure automatic tagging and extraction for different content types.
        Each category has its own AI prompt that can be customized.
      </p>

      <div class="border border-braun-200 rounded overflow-hidden">
        {#each CATEGORY_KEYS as category}
          <AutoTaggingCategory
            {category}
            expanded={expandedCategory === category}
            onToggle={() => toggleCategory(category)}
          />
        {/each}
      </div>
    </div>
  {/if}
</div>
