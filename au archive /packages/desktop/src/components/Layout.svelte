<script lang="ts">
  import Navigation from './Navigation.svelte';

  interface Props {
    children?: any;
  }

  let { children }: Props = $props();
</script>

<!-- macOS: Drag region at top of window for hiddenInset titlebar -->
<div class="drag-region"></div>

<div class="flex h-screen overflow-hidden">
  <Navigation />

  <main class="flex-1 overflow-auto bg-braun-50">
    {@render children?.()}
  </main>
</div>

<style>
  .drag-region {
    position: fixed;
    top: 0;
    left: 256px; /* Start after navigation sidebar (w-64 = 256px) */
    right: 0;
    height: 32px;
    -webkit-app-region: drag;
    z-index: 9999;
  }
</style>
