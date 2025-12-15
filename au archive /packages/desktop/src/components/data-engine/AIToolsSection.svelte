<script lang="ts">
  import OnlineModels from './OnlineModels.svelte';
  import OfflineModels from './OfflineModels.svelte';

  interface Props {
    expanded?: boolean;
    onToggle?: () => void;
  }

  let { expanded = false, onToggle }: Props = $props();

  // Track which sub-section is expanded
  let onlineExpanded = $state(false);
  let offlineExpanded = $state(true); // Default to offline since it's more common

  function toggleOnline() {
    onlineExpanded = !onlineExpanded;
  }

  function toggleOffline() {
    offlineExpanded = !offlineExpanded;
  }
</script>

<div class="border-b border-braun-200 last:border-b-0">
  <!-- Section Header -->
  <button
    onclick={onToggle}
    class="w-full py-4 flex items-center justify-between text-left hover:bg-braun-50 transition-colors"
  >
    <span class="text-base font-semibold text-braun-900">AI Tools</span>
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
        Configure AI providers for extraction and tagging. Online models require internet,
        offline models run locally for maximum privacy.
      </p>

      <div class="border border-braun-200 rounded overflow-hidden">
        <OnlineModels expanded={onlineExpanded} onToggle={toggleOnline} />
        <OfflineModels expanded={offlineExpanded} onToggle={toggleOffline} />
      </div>
    </div>
  {/if}
</div>
