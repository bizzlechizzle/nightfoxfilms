<script lang="ts">
  /**
   * Research.svelte - Research browser launch page
   *
   * Simple page with button to launch external Ungoogled Chromium browser
   * for research workflows. Shows status and error messages.
   */

  let browserRunning = $state(false);
  let launching = $state(false);
  let errorMessage = $state('');

  // Check browser status on mount and periodically
  $effect(() => {
    const checkStatus = async () => {
      if (window.electronAPI?.research) {
        const status = await window.electronAPI.research.status();
        browserRunning = status.running;
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  });

  async function launchBrowser() {
    if (!window.electronAPI?.research) {
      errorMessage = 'Research API not available';
      return;
    }

    launching = true;
    errorMessage = '';

    try {
      const result = await window.electronAPI.research.launch();
      if (result.success) {
        browserRunning = true;
      } else {
        errorMessage = result.error || 'Failed to launch browser';
      }
    } catch (error) {
      console.error('Error launching research browser:', error);
      errorMessage = 'Error launching browser. The research browser may not be installed.';
    } finally {
      launching = false;
    }
  }
</script>

<div class="p-6 h-full">
  <div class="max-w-2xl mx-auto">
    <h1 class="text-2xl font-bold text-foreground mb-2">Research</h1>
    <p class="text-braun-600 mb-8">
      Launch the research browser to explore and document locations.
    </p>

    <div class="bg-white rounded border border-braun-300 p-6">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-lg font-semibold text-foreground">Research Browser</h2>
          <p class="text-sm text-braun-500">
            Privacy-focused browser for location research
          </p>
        </div>

        {#if browserRunning}
          <span class="flex items-center gap-2 text-success text-sm">
            <span class="w-2 h-2 bg-success rounded-full"></span>
            Running
          </span>
        {:else}
          <span class="flex items-center gap-2 text-braun-400 text-sm">
            <span class="w-2 h-2 bg-braun-300 rounded-full"></span>
            Not running
          </span>
        {/if}
      </div>

      <button
        onclick={launchBrowser}
        disabled={launching || browserRunning}
        class="w-full px-4 py-3 bg-braun-900 text-white rounded hover:bg-braun-600 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {#if launching}
          <div class="w-5 h-5 border-2 border-white rounded flex items-center justify-center">
            <div class="w-2 h-2 bg-white rounded"></div>
          </div>
          Launching...
        {:else if browserRunning}
          Browser is Running
        {:else}
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Open Research Browser
        {/if}
      </button>

      {#if errorMessage}
        <div class="mt-4 p-3 bg-braun-100 border border-braun-300 rounded">
          <p class="text-sm text-error">{errorMessage}</p>
          <p class="text-xs text-braun-500 mt-1">
            Make sure Ungoogled Chromium is installed in the resources folder.
          </p>
        </div>
      {/if}

      <div class="mt-6 pt-4 border-t border-braun-100">
        <h3 class="text-sm font-medium text-braun-700 mb-2">Features</h3>
        <ul class="text-sm text-braun-500 space-y-1">
          <li class="flex items-center gap-2">
            <svg class="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            Privacy-focused (Ungoogled Chromium)
          </li>
          <li class="flex items-center gap-2">
            <svg class="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            Bookmark integration with archive
          </li>
          <li class="flex items-center gap-2">
            <svg class="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            Persistent profile across sessions
          </li>
        </ul>
      </div>
    </div>
  </div>
</div>
