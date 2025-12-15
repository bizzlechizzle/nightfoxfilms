<script lang="ts">
  import PromptEditor from './PromptEditor.svelte';
  import { type CategoryKey, CATEGORY_LABELS, DEFAULT_PROMPTS } from './default-prompts';

  interface Props {
    category: CategoryKey;
    expanded?: boolean;
    onToggle?: () => void;
  }

  let { category, expanded = false, onToggle }: Props = $props();

  let activeTab = $state<'settings' | 'prompt'>('settings');

  const label = CATEGORY_LABELS[category];
</script>

<div class="border-b border-braun-200 last:border-b-0">
  <!-- Category Header -->
  <button
    onclick={onToggle}
    class="w-full py-4 flex items-center justify-between text-left hover:bg-braun-50 transition-colors"
  >
    <div class="flex items-center gap-3">
      <span class="text-sm font-medium text-braun-900">{label}</span>
      <span class="px-2 py-0.5 text-xs bg-braun-100 text-braun-600 rounded">placeholder</span>
    </div>
    <svg
      class="w-4 h-4 text-braun-400 transition-transform duration-200 {expanded ? 'rotate-180' : ''}"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  <!-- Category Content -->
  {#if expanded}
    <div class="pl-4 pr-2 pb-4">
      <!-- Tab Buttons -->
      <div class="flex gap-2 mb-4">
        <button
          onclick={() => (activeTab = 'settings')}
          class="px-3 py-1.5 text-xs rounded transition-colors {activeTab === 'settings'
            ? 'bg-braun-900 text-white'
            : 'bg-braun-100 text-braun-700 hover:bg-braun-200'}"
        >
          Settings
        </button>
        <button
          onclick={() => (activeTab = 'prompt')}
          class="px-3 py-1.5 text-xs rounded transition-colors {activeTab === 'prompt'
            ? 'bg-braun-900 text-white'
            : 'bg-braun-100 text-braun-700 hover:bg-braun-200'}"
        >
          Prompt
        </button>
      </div>

      <!-- Tab Content -->
      <div class="bg-braun-50 rounded p-4">
        {#if activeTab === 'settings'}
          <div class="text-center py-8">
            <p class="text-sm text-braun-500">Settings for {label} auto-tagging coming soon.</p>
            <p class="text-xs text-braun-400 mt-2">
              Configure confidence thresholds, auto-apply rules, and provider selection.
            </p>
          </div>
        {:else}
          <PromptEditor {category} />
        {/if}
      </div>
    </div>
  {/if}
</div>
