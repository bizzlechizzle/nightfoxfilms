<script lang="ts">
  /**
   * Data Engine Settings
   *
   * Unified settings panel for Auto Tagging and AI Tools configuration.
   * Consolidates Date Engine, Image Auto-Tagging, and AI & Cloud Providers.
   */
  import AutoTaggingSection from './AutoTaggingSection.svelte';
  import AIToolsSection from './AIToolsSection.svelte';

  // Track which main section is expanded
  let autoTaggingExpanded = $state(true);
  let aiToolsExpanded = $state(false);

  function toggleAutoTagging() {
    autoTaggingExpanded = !autoTaggingExpanded;
  }

  function toggleAITools() {
    aiToolsExpanded = !aiToolsExpanded;
  }
</script>

<div class="space-y-4">
  <p class="text-sm text-braun-600">
    Configure automatic tagging, AI extraction, and model providers for your archive.
  </p>

  <div class="border border-braun-200 rounded overflow-hidden">
    <AutoTaggingSection expanded={autoTaggingExpanded} onToggle={toggleAutoTagging} />
    <AIToolsSection expanded={aiToolsExpanded} onToggle={toggleAITools} />
  </div>
</div>
