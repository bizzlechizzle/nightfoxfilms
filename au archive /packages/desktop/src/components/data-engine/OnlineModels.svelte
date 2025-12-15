<script lang="ts">
  /**
   * Online AI Models Configuration
   *
   * Cloud-based Language Models (via LiteLLM) and Visual Models.
   * Extracted from AISettingsPanel.svelte for Data Engine settings.
   */
  import { onMount } from 'svelte';

  // Types
  interface LiteLLMStatus {
    installed: boolean;
    running: boolean;
    managedByApp: boolean;
    port: number;
    configuredModels: string[];
    idleTimeoutMs: number;
    idleTimeRemainingMs: number | null;
    lastError: string | null;
  }

  interface ProviderInfo {
    id: string;
    name: string;
    hasKey: boolean;
    available: boolean;
    description: string;
  }

  interface CostData {
    today: number;
    month: number;
    requestsToday: number;
    byProvider: Record<string, { cost: number; tokens: number; requests: number }>;
    byModel: Record<string, { cost: number; tokens: number; requests: number }>;
  }

  interface PrivacySettings {
    enabled: boolean;
    redactGps: boolean;
    redactAddresses: boolean;
    redactPhones: boolean;
    redactEmails: boolean;
  }

  interface Props {
    expanded?: boolean;
    onToggle?: () => void;
  }

  let { expanded = false, onToggle }: Props = $props();

  // Sub-accordion state
  let languageModelsExpanded = $state(true);
  let visualModelsExpanded = $state(false);

  // State
  let litellmStatus = $state<LiteLLMStatus | null>(null);
  let providers = $state<ProviderInfo[]>([]);
  let costs = $state<CostData | null>(null);
  let privacy = $state<PrivacySettings>({
    enabled: true,
    redactGps: true,
    redactAddresses: true,
    redactPhones: false,
    redactEmails: false,
  });

  let loading = $state(true);
  let loadingCosts = $state(false);
  let testing = $state<string | null>(null);
  let testResult = $state<{ success: boolean; message: string } | null>(null);
  let savingPrivacy = $state(false);

  // API Key modal
  let showKeyModal = $state(false);
  let keyModalProvider = $state('');
  let keyModalProviderName = $state('');
  let apiKeyInput = $state('');
  let savingKey = $state(false);
  let keyError = $state('');

  // Cloud provider definitions
  const cloudProviders: ProviderInfo[] = [
    { id: 'anthropic', name: 'Anthropic (Claude)', hasKey: false, available: false, description: 'claude-3.5-sonnet, claude-3.5-haiku' },
    { id: 'openai', name: 'OpenAI (GPT)', hasKey: false, available: false, description: 'gpt-4o, gpt-4o-mini' },
    { id: 'google', name: 'Google (Gemini)', hasKey: false, available: false, description: 'gemini-1.5-pro' },
    { id: 'groq', name: 'Groq (Llama)', hasKey: false, available: false, description: 'llama-3.1-70b' },
  ];

  onMount(async () => {
    if (expanded) {
      await loadAll();
    }
    loading = false;
  });

  $effect(() => {
    if (expanded && !litellmStatus) {
      loadAll();
    }
  });

  async function loadAll() {
    await Promise.all([
      loadLiteLLMStatus(),
      loadCredentials(),
      loadPrivacySettings(),
      loadCosts(),
    ]);
  }

  async function loadLiteLLMStatus() {
    try {
      const result = await window.electronAPI.litellm.status();
      if (result.success) {
        litellmStatus = result.status;
      }
    } catch (error) {
      console.error('Failed to load LiteLLM status:', error);
    }
  }

  async function loadCredentials() {
    try {
      const result = await window.electronAPI.credentials.list();
      if (result.success) {
        const storedProviders = result.providers;
        providers = cloudProviders.map(p => ({
          ...p,
          hasKey: storedProviders.includes(p.id),
        }));
      } else {
        providers = [...cloudProviders];
      }
    } catch (error) {
      console.error('Failed to load credentials:', error);
      providers = [...cloudProviders];
    }
  }

  async function loadPrivacySettings() {
    try {
      const result = await window.electronAPI.litellm.settings.get();
      if (result.success && result.settings) {
        privacy = {
          enabled: result.settings.privacy_enabled !== 'false',
          redactGps: result.settings.privacy_redact_gps !== 'false',
          redactAddresses: result.settings.privacy_redact_addresses !== 'false',
          redactPhones: result.settings.privacy_redact_phones === 'true',
          redactEmails: result.settings.privacy_redact_emails === 'true',
        };
      }
    } catch (error) {
      console.error('Failed to load privacy settings:', error);
    }
  }

  async function loadCosts() {
    loadingCosts = true;
    try {
      const [summaryResult, dailyResult] = await Promise.all([
        window.electronAPI.costs.getSummary(),
        window.electronAPI.costs.getDailyCosts(1),
      ]);

      if (summaryResult.success && summaryResult.summary) {
        const summary = summaryResult.summary;
        const todayCost = dailyResult.success && dailyResult.costs?.length
          ? dailyResult.costs.reduce((sum: number, d: { cost: number }) => sum + d.cost, 0)
          : 0;
        const todayRequests = dailyResult.success && dailyResult.costs?.length
          ? dailyResult.costs.reduce((sum: number, d: { requests: number }) => sum + d.requests, 0)
          : 0;

        costs = {
          today: todayCost,
          month: summary.totalCost,
          requestsToday: todayRequests,
          byProvider: summary.byProvider,
          byModel: summary.byModel,
        };
      }
    } catch (error) {
      console.error('Failed to load costs:', error);
    }
    loadingCosts = false;
  }

  async function startLiteLLM() {
    testResult = null;
    const result = await window.electronAPI.litellm.start();
    if (result.success) {
      await loadLiteLLMStatus();
      await loadCosts();
    } else {
      testResult = { success: false, message: result.error || 'Failed to start LiteLLM' };
    }
  }

  async function stopLiteLLM() {
    await window.electronAPI.litellm.stop();
    await loadLiteLLMStatus();
    costs = null;
  }

  function openKeyModal(providerId: string, providerName: string) {
    keyModalProvider = providerId;
    keyModalProviderName = providerName;
    apiKeyInput = '';
    keyError = '';
    showKeyModal = true;
  }

  async function saveApiKey() {
    if (!apiKeyInput.trim()) {
      keyError = 'API key is required';
      return;
    }

    if (apiKeyInput.length < 10) {
      keyError = 'API key is too short';
      return;
    }

    savingKey = true;
    keyError = '';

    try {
      const result = await window.electronAPI.credentials.store(keyModalProvider, apiKeyInput.trim());

      if (result.success) {
        showKeyModal = false;
        apiKeyInput = '';

        await window.electronAPI.litellm.reload();
        await loadCredentials();
        await loadLiteLLMStatus();

        let message = `API key saved for ${keyModalProviderName}`;
        if (result.autoEnabled) {
          message += ' (provider auto-enabled)';
        }
        if (result.responseTimeMs) {
          message += ` - Connection verified in ${result.responseTimeMs}ms`;
        }
        testResult = { success: true, message };
      } else {
        if (result.testFailed) {
          keyError = `Connection test failed: ${result.error || 'Invalid API key'}. Key not saved.`;
        } else {
          keyError = result.error || 'Failed to save API key';
        }
      }
    } catch (error) {
      keyError = error instanceof Error ? error.message : 'Unknown error';
    }

    savingKey = false;
  }

  async function deleteApiKey(providerId: string) {
    if (!confirm(`Remove API key for this provider?`)) return;

    await window.electronAPI.credentials.delete(providerId);
    await window.electronAPI.litellm.reload();
    await loadCredentials();
    await loadLiteLLMStatus();
  }

  async function testProvider(providerId: string) {
    testing = providerId;
    testResult = null;

    try {
      const result = await window.electronAPI.credentials.test(providerId);
      if (result.success) {
        const timeMsg = result.responseTimeMs ? ` (${result.responseTimeMs}ms)` : '';
        testResult = { success: true, message: `Connection successful${timeMsg}` };
      } else {
        testResult = { success: false, message: result.error || 'Connection test failed' };
      }
    } catch (error) {
      testResult = { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }

    testing = null;
  }

  async function savePrivacySettings() {
    savingPrivacy = true;

    try {
      const settings = [
        ['privacy_enabled', String(privacy.enabled)],
        ['privacy_redact_gps', String(privacy.redactGps)],
        ['privacy_redact_addresses', String(privacy.redactAddresses)],
        ['privacy_redact_phones', String(privacy.redactPhones)],
        ['privacy_redact_emails', String(privacy.redactEmails)],
      ];

      for (const [key, value] of settings) {
        await window.electronAPI.litellm.settings.set(key, value);
      }

      testResult = { success: true, message: 'Privacy settings saved' };
    } catch (error) {
      testResult = { success: false, message: 'Failed to save privacy settings' };
    }

    savingPrivacy = false;
  }

  function getStatusColor(provider: ProviderInfo): string {
    if (!provider.hasKey) return 'bg-braun-300';
    if (provider.available) return 'bg-green-500';
    return 'bg-amber-500';
  }

  function formatCurrency(value: number): string {
    return `$${value.toFixed(2)}`;
  }
</script>

<div class="border-b border-braun-200 last:border-b-0">
  <!-- Section Header -->
  <button
    onclick={onToggle}
    class="w-full py-4 flex items-center justify-between text-left hover:bg-braun-50 transition-colors"
  >
    <span class="text-base font-semibold text-braun-900">Online</span>
    <svg
      class="w-5 h-5 text-braun-400 transition-transform duration-200 {expanded ? 'rotate-180' : ''}"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if expanded}
    <div class="pl-4 pb-4 space-y-4">
      <p class="text-xs text-braun-500">
        Cloud-based AI models for text extraction and analysis. Requires internet connection.
      </p>

      <!-- Language Models Sub-accordion -->
      <div class="border border-braun-200 rounded overflow-hidden">
        <button
          onclick={() => languageModelsExpanded = !languageModelsExpanded}
          class="w-full py-3 px-4 flex items-center justify-between text-left hover:bg-braun-50 transition-colors bg-white"
        >
          <span class="text-sm font-medium text-braun-900">Language Models</span>
          <svg
            class="w-4 h-4 text-braun-400 transition-transform duration-200 {languageModelsExpanded ? 'rotate-180' : ''}"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {#if languageModelsExpanded}
          <div class="p-4 space-y-4 border-t border-braun-200 bg-braun-50">
            {#if loading}
              <div class="text-sm text-braun-500 animate-pulse">Loading...</div>
            {:else}
              <!-- LiteLLM Gateway Status -->
              <div class="bg-white rounded border border-braun-200 p-4">
                <div class="flex items-center justify-between mb-3">
                  <span class="text-sm font-medium text-braun-800">AI Gateway</span>
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full {litellmStatus?.running ? 'bg-green-500' : 'bg-braun-300'}"></span>
                    <span class="text-xs text-braun-600">
                      {litellmStatus?.running ? 'Running' : 'Stopped'}
                    </span>
                  </div>
                </div>

                {#if !litellmStatus?.installed}
                  <div class="bg-amber-50 border border-amber-200 rounded p-3 text-xs">
                    <p class="text-amber-800">LiteLLM not installed.</p>
                    <code class="block mt-1 bg-braun-100 px-2 py-1 rounded font-mono">
                      pip install "litellm[proxy]"
                    </code>
                  </div>
                {:else}
                  <div class="flex gap-2">
                    {#if litellmStatus?.running}
                      <button
                        onclick={stopLiteLLM}
                        class="text-xs px-3 py-1.5 border border-braun-300 rounded hover:bg-braun-50 transition"
                      >
                        Stop
                      </button>
                    {:else}
                      <button
                        onclick={startLiteLLM}
                        class="text-xs px-3 py-1.5 bg-braun-900 text-white rounded hover:bg-braun-700 transition"
                      >
                        Start
                      </button>
                    {/if}
                  </div>
                {/if}
              </div>

              <!-- Cloud Providers -->
              <div class="bg-white rounded border border-braun-200 p-4">
                <span class="text-sm font-medium text-braun-800 mb-3 block">Cloud Providers</span>
                <div class="space-y-2">
                  {#each providers as provider}
                    <div class="flex items-center justify-between py-2 border-b border-braun-100 last:border-0">
                      <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full {getStatusColor(provider)}"></span>
                        <div>
                          <span class="text-sm text-braun-900">{provider.name}</span>
                          <span class="text-xs text-braun-400 ml-1">
                            {provider.hasKey ? 'configured' : 'no key'}
                          </span>
                        </div>
                      </div>

                      <div class="flex items-center gap-1">
                        {#if provider.hasKey}
                          <button
                            onclick={() => deleteApiKey(provider.id)}
                            class="text-xs px-2 py-1 text-red-600 hover:text-red-700"
                          >
                            Remove
                          </button>
                          <button
                            onclick={() => testProvider(provider.id)}
                            disabled={testing === provider.id}
                            class="text-xs px-2 py-1 bg-braun-50 hover:bg-braun-100 rounded transition disabled:opacity-50"
                          >
                            {testing === provider.id ? '...' : 'Test'}
                          </button>
                        {:else}
                          <button
                            onclick={() => openKeyModal(provider.id, provider.name)}
                            class="text-xs px-2 py-1 bg-braun-900 text-white rounded hover:bg-braun-700 transition"
                          >
                            Add Key
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>

              <!-- Usage & Costs -->
              {#if costs}
                <div class="bg-white rounded border border-braun-200 p-4">
                  <div class="flex items-center justify-between mb-3">
                    <span class="text-sm font-medium text-braun-800">Usage</span>
                    <button
                      onclick={loadCosts}
                      disabled={loadingCosts}
                      class="text-xs text-braun-500 hover:text-braun-700"
                    >
                      {loadingCosts ? '...' : 'Refresh'}
                    </button>
                  </div>
                  <div class="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p class="text-xs text-braun-400 uppercase">Today</p>
                      <p class="text-base font-medium text-braun-900">{formatCurrency(costs.today)}</p>
                    </div>
                    <div>
                      <p class="text-xs text-braun-400 uppercase">Month</p>
                      <p class="text-base font-medium text-braun-900">{formatCurrency(costs.month)}</p>
                    </div>
                    <div>
                      <p class="text-xs text-braun-400 uppercase">Requests</p>
                      <p class="text-base font-medium text-braun-900">{costs.requestsToday}</p>
                    </div>
                  </div>
                </div>
              {/if}

              <!-- Privacy Controls -->
              <div class="bg-white rounded border border-braun-200 p-4">
                <span class="text-sm font-medium text-braun-800 mb-2 block">Privacy</span>
                <p class="text-xs text-braun-500 mb-3">
                  Data is sanitized before sending to cloud providers.
                </p>

                <div class="space-y-2">
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      bind:checked={privacy.enabled}
                      onchange={savePrivacySettings}
                      class="rounded border-braun-300 text-braun-900 w-3.5 h-3.5"
                    />
                    <span class="text-xs text-braun-700">Enable sanitization</span>
                  </label>

                  <div class="ml-5 space-y-1">
                    <label class="flex items-center gap-2">
                      <input
                        type="checkbox"
                        bind:checked={privacy.redactGps}
                        onchange={savePrivacySettings}
                        disabled={!privacy.enabled}
                        class="rounded border-braun-300 text-braun-900 w-3.5 h-3.5 disabled:opacity-50"
                      />
                      <span class="text-xs text-braun-600">Redact GPS</span>
                    </label>
                    <label class="flex items-center gap-2">
                      <input
                        type="checkbox"
                        bind:checked={privacy.redactAddresses}
                        onchange={savePrivacySettings}
                        disabled={!privacy.enabled}
                        class="rounded border-braun-300 text-braun-900 w-3.5 h-3.5 disabled:opacity-50"
                      />
                      <span class="text-xs text-braun-600">Redact addresses</span>
                    </label>
                  </div>
                </div>
              </div>

              {#if testResult}
                <div class="p-2 rounded text-xs {testResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}">
                  {testResult.message}
                </div>
              {/if}
            {/if}
          </div>
        {/if}
      </div>

      <!-- Visual Models Sub-accordion -->
      <div class="border border-braun-200 rounded overflow-hidden">
        <button
          onclick={() => visualModelsExpanded = !visualModelsExpanded}
          class="w-full py-3 px-4 flex items-center justify-between text-left hover:bg-braun-50 transition-colors bg-white"
        >
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-braun-900">Visual Models</span>
            <span class="px-2 py-0.5 text-xs bg-braun-100 text-braun-600 rounded">coming soon</span>
          </div>
          <svg
            class="w-4 h-4 text-braun-400 transition-transform duration-200 {visualModelsExpanded ? 'rotate-180' : ''}"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {#if visualModelsExpanded}
          <div class="p-4 border-t border-braun-200 bg-braun-50">
            <div class="text-center py-6">
              <p class="text-sm text-braun-500">Cloud-based visual AI models coming soon.</p>
              <p class="text-xs text-braun-400 mt-1">
                Claude Vision, GPT-4 Vision for image analysis.
              </p>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- API Key Modal -->
{#if showKeyModal}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div class="bg-white rounded border border-braun-300 w-full max-w-md mx-4">
      <div class="px-5 py-4 border-b border-braun-200">
        <h3 class="text-base font-semibold text-braun-900">Add API Key</h3>
      </div>

      <div class="p-5 space-y-4">
        <p class="text-sm text-braun-600">
          Enter your API key for <strong>{keyModalProviderName}</strong>.
        </p>

        <div>
          <label class="block text-sm font-medium text-braun-700 mb-1">API Key</label>
          <input
            type="password"
            bind:value={apiKeyInput}
            placeholder="sk-..."
            class="w-full px-3 py-2 border border-braun-300 rounded text-sm focus:outline-none focus:border-braun-600"
            onkeydown={(e) => e.key === 'Enter' && saveApiKey()}
          />
          {#if keyError}
            <p class="text-xs text-red-600 mt-1">{keyError}</p>
          {/if}
        </div>

        <p class="text-xs text-braun-500">
          Keys are encrypted using your OS secure storage.
        </p>
      </div>

      <div class="px-5 py-4 border-t border-braun-200 flex justify-end gap-3">
        <button
          onclick={() => showKeyModal = false}
          class="px-4 py-2 text-sm text-braun-600 hover:text-braun-900"
        >
          Cancel
        </button>
        <button
          onclick={saveApiKey}
          disabled={savingKey || !apiKeyInput.trim()}
          class="px-4 py-2 text-sm bg-braun-900 text-white rounded hover:bg-braun-700 disabled:opacity-50"
        >
          {savingKey ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  </div>
{/if}
