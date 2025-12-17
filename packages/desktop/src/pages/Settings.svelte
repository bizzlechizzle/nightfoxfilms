<script lang="ts">
  import { getAPI, formatBytes } from '../lib/api';
  import type { DatabaseStats, AIStatus } from '../lib/types';

  const api = getAPI();

  // General settings
  let storagePath = $state<string | null>(null);
  let theme = $state<string>('system');
  let dbPath = $state<string>('');
  let dbStats = $state<DatabaseStats | null>(null);
  let loading = $state(true);

  // AI settings
  let aiStatus = $state<AIStatus | null>(null);
  let visionModel = $state<string>('caption-local');
  let textModel = $state<string>('caption-local');
  let anthropicKey = $state<string>('');
  let openaiKey = $state<string>('');
  let savingAI = $state(false);
  let testingAI = $state(false);
  let showAnthropicKey = $state(false);
  let showOpenaiKey = $state(false);

  $effect(() => {
    loadSettings();
  });

  async function loadSettings() {
    loading = true;
    try {
      const [settings, dbPathResult, dbStatsResult, aiStatusResult] = await Promise.all([
        api.settings.getAll(),
        api.database.getLocation(),
        api.database.getStats(),
        api.ai.getStatus(),
      ]);

      storagePath = settings.storage_path ?? null;
      visionModel = settings.litellm_model_vlm ?? 'caption-local';
      textModel = settings.litellm_model_llm ?? 'caption-local';
      anthropicKey = settings.anthropic_api_key ?? '';
      openaiKey = settings.openai_api_key ?? '';
      theme = settings.theme ?? 'system';
      dbPath = dbPathResult;
      dbStats = dbStatsResult;
      aiStatus = aiStatusResult;
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      loading = false;
    }
  }

  async function saveSetting(key: string, value: string | null) {
    try {
      await api.settings.set(key, value);
    } catch (error) {
      console.error('Failed to save setting:', error);
    }
  }

  async function selectStoragePath() {
    try {
      const path = await api.dialog.selectFolder();
      if (path) {
        storagePath = path;
        await saveSetting('storage_path', path);
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    }
  }

  async function saveAISettings() {
    savingAI = true;
    try {
      await Promise.all([
        saveSetting('litellm_model_vlm', visionModel),
        saveSetting('litellm_model_llm', textModel),
        saveSetting('anthropic_api_key', anthropicKey || null),
        saveSetting('openai_api_key', openaiKey || null),
      ]);
      // Refresh status after saving
      aiStatus = await api.ai.getStatus();
    } finally {
      savingAI = false;
    }
  }

  async function showDatabaseInFinder() {
    if (dbPath) {
      await api.shell.showItemInFolder(dbPath);
    }
  }

  async function testAI() {
    testingAI = true;
    try {
      const status = await api.ai.getStatus();
      aiStatus = status;

      if (status.installed) {
        if (status.running) {
          alert('AI Gateway running at localhost:' + status.port + '\n\nConfigured models:\n- ' + (status.configuredModels.join('\n- ') || 'none'));
        } else {
          alert('LiteLLM installed. AI Gateway will start automatically when needed.');
        }
      } else {
        alert('LiteLLM not installed.\n\nTo enable AI features, run:\npip install litellm\n\nOr run the setup script:\n./scripts/setup-litellm.sh');
      }
    } catch (error) {
      alert('AI test failed: ' + error);
    } finally {
      testingAI = false;
    }
  }

  function maskKey(key: string): string {
    if (!key || key.length < 8) return key;
    return key.substring(0, 4) + '...' + key.substring(key.length - 4);
  }
</script>

<div class="page">
  <header class="page-header">
    <h2>Settings</h2>
  </header>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else}
    <div class="settings-sections">
      <section class="settings-section">
        <h3>Storage</h3>

        <div class="setting-row">
          <div class="setting-info">
            <label>Nightfox Storage Root</label>
            <p class="setting-description">
              Base folder for all wedding projects and app data
            </p>
          </div>
          <div class="setting-control">
            <div class="path-input">
              <input
                type="text"
                value={storagePath ?? 'Not set'}
                readonly
              />
              <button class="btn btn-secondary" onclick={selectStoragePath}>
                Browse
              </button>
            </div>
          </div>
        </div>

        {#if storagePath}
          <div class="folder-structure">
            <div class="structure-header">Folder Structure</div>
            <div class="structure-tree">
              <div class="tree-item root">{storagePath.split('/').pop()}/</div>
              <div class="tree-item level-1">weddings/</div>
              <div class="tree-item level-2">{new Date().getFullYear()}/</div>
              <div class="tree-item level-3">MM-DD Couple Name/</div>
              <div class="tree-item level-4">media/</div>
              <div class="tree-item level-4">thumbnails/</div>
              <div class="tree-item level-4">documents/</div>
              <div class="tree-item level-1">app-data/</div>
              <div class="tree-item level-2">luts/</div>
              <div class="tree-item level-2">camera-signatures/</div>
            </div>
          </div>
        {/if}

      </section>

      <section class="settings-section">
        <h3>Appearance</h3>
        <div class="setting-row">
          <div class="setting-info">
            <label for="theme">Theme</label>
            <p class="setting-description">
              Choose your preferred color scheme
            </p>
          </div>
          <div class="setting-control">
            <select
              id="theme"
              bind:value={theme}
              onchange={() => saveSetting('theme', theme)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <h3>AI Integration</h3>

        <!-- Status indicators -->
        {#if aiStatus}
          <div class="ai-status">
            <div class="status-item">
              <span class="status-dot {aiStatus.installed ? 'status-ok' : 'status-error'}"></span>
              <span>LiteLLM {aiStatus.installed ? 'Installed' : 'Not Installed'}</span>
            </div>
            {#if aiStatus.running}
              <div class="status-item">
                <span class="status-dot status-ok"></span>
                <span>AI Gateway Running (localhost:{aiStatus.port})</span>
              </div>
            {/if}
            {#if aiStatus.ollamaAvailable}
              <div class="status-item">
                <span class="status-dot status-ok"></span>
                <span>Ollama Available (local)</span>
              </div>
            {/if}
            {#if aiStatus.configuredProviders?.length > 0}
              <div class="status-item">
                <span class="status-dot status-ok"></span>
                <span>Providers: {aiStatus.configuredProviders.join(', ')}</span>
              </div>
            {/if}
          </div>
          {#if !aiStatus.installed}
            <p class="ai-warning">
              LiteLLM not installed. Run the setup script to enable AI features:<br/>
              <code>./scripts/setup-litellm.sh</code>
            </p>
          {:else if !aiStatus.ollamaAvailable && !anthropicKey && !openaiKey}
            <p class="ai-warning">
              No AI providers configured. Install Ollama for local AI, or add API keys below for cloud models.
            </p>
          {/if}
        {/if}

        <!-- Model selection -->
        <div class="setting-row">
          <div class="setting-info">
            <label for="vision-model">Vision Model</label>
            <p class="setting-description">
              Model for image/video analysis (caption-local uses Ollama)
            </p>
          </div>
          <div class="setting-control">
            <select id="vision-model" bind:value={visionModel}>
              <option value="caption-local">Local (Ollama)</option>
              <option value="caption-anthropic">Anthropic (Claude)</option>
              <option value="caption-openai">OpenAI (GPT-4o)</option>
            </select>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <label for="text-model">Text Model</label>
            <p class="setting-description">
              Model for text generation
            </p>
          </div>
          <div class="setting-control">
            <select id="text-model" bind:value={textModel}>
              <option value="caption-local">Local (Ollama)</option>
              <option value="caption-anthropic">Anthropic (Claude)</option>
              <option value="caption-openai">OpenAI (GPT-4o)</option>
            </select>
          </div>
        </div>

        <!-- Cloud API Keys -->
        <div class="api-keys-section">
          <h4>Cloud API Keys (Optional)</h4>
          <p class="setting-description">Add API keys to enable cloud-based AI models. Keys are stored locally.</p>

          <div class="setting-row">
            <div class="setting-info">
              <label for="anthropic-key">Anthropic API Key</label>
            </div>
            <div class="setting-control">
              <div class="key-input">
                <input
                  id="anthropic-key"
                  type={showAnthropicKey ? 'text' : 'password'}
                  bind:value={anthropicKey}
                  placeholder="sk-ant-..."
                />
                <button
                  class="btn btn-small"
                  onclick={() => showAnthropicKey = !showAnthropicKey}
                  type="button"
                >
                  {showAnthropicKey ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <label for="openai-key">OpenAI API Key</label>
            </div>
            <div class="setting-control">
              <div class="key-input">
                <input
                  id="openai-key"
                  type={showOpenaiKey ? 'text' : 'password'}
                  bind:value={openaiKey}
                  placeholder="sk-..."
                />
                <button
                  class="btn btn-small"
                  onclick={() => showOpenaiKey = !showOpenaiKey}
                  type="button"
                >
                  {showOpenaiKey ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="setting-actions">
          <button class="btn btn-secondary" onclick={testAI} disabled={testingAI}>
            {testingAI ? 'Testing...' : 'Test AI'}
          </button>
          <button class="btn btn-primary" onclick={saveAISettings} disabled={savingAI}>
            {savingAI ? 'Saving...' : 'Save AI Settings'}
          </button>
        </div>
      </section>

      <section class="settings-section">
        <h3>About</h3>
        <div class="about-info">
          <p><strong>Nightfox Films</strong></p>
          <p class="version">Version 0.1.0</p>
          <p class="description">
            Wedding videography workflow management.
            Built with Electron, Svelte, and SQLite.
          </p>
          <div class="tech-stack">
            <span>Node {window.electronAPI?.versions.node()}</span>
            <span>Chrome {window.electronAPI?.versions.chrome()}</span>
            <span>Electron {window.electronAPI?.versions.electron()}</span>
          </div>
        </div>
      </section>
    </div>
  {/if}
</div>

<style>
  .page-header {
    margin-bottom: 2rem;
  }

  .page-header h2 { margin-bottom: 0; }

  .loading {
    padding: 3rem;
    text-align: center;
    color: var(--color-text-muted);
  }

  .settings-sections {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    max-width: 800px;
  }

  .settings-section {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1.5rem;
  }

  .settings-section h3 {
    margin-bottom: 1.5rem;
    font-size: var(--step-1);
    font-weight: 600;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--color-border);
  }

  .setting-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 2rem;
    margin-bottom: 1.25rem;
  }

  .setting-row:last-child { margin-bottom: 0; }

  .setting-info {
    flex: 1;
  }

  .setting-info label {
    display: block;
    font-weight: 500;
    margin-bottom: 0.25rem;
  }

  .setting-description {
    font-size: var(--step--1);
    color: var(--color-text-muted);
    margin: 0;
  }

  .setting-control {
    flex-shrink: 0;
    min-width: 220px;
  }

  .setting-control input,
  .setting-control select {
    width: 100%;
    padding: 0.625rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: var(--step-0);
    font-family: var(--font-sans);
    background: var(--color-bg);
  }

  .path-input {
    display: flex;
    gap: 0.5rem;
  }

  .path-input input {
    flex: 1;
    background: var(--color-bg-alt);
    color: var(--color-text-muted);
  }

  .setting-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--color-border);
  }

  .about-info {
    text-align: center;
  }

  .about-info p { margin: 0.5rem 0; }
  .about-info .version { color: var(--color-text-muted); }
  .about-info .description {
    max-width: 400px;
    margin: 1rem auto;
    color: var(--color-text-secondary);
  }

  .tech-stack {
    display: flex;
    justify-content: center;
    gap: 1.5rem;
    font-size: var(--step--1);
    color: var(--color-text-muted);
    margin-top: 1rem;
  }

  .btn {
    padding: 0.625rem 1.25rem;
    border: none;
    border-radius: 4px;
    font-size: var(--step-0);
    font-family: var(--font-sans);
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--color-text);
    color: var(--color-surface);
  }

  .btn-secondary {
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }

  .btn-small {
    padding: 0.375rem 0.75rem;
    font-size: var(--step--1);
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }

  /* AI Status indicators */
  .ai-status {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding: 0.75rem 1rem;
    background: var(--color-bg-alt);
    border-radius: 4px;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--step--1);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-ok { background: #10b981; }
  .status-error { background: #ef4444; }

  .ai-warning {
    margin: 0.5rem 0 1rem 0;
    padding: 0.75rem;
    background: #fef3c7;
    border-radius: 4px;
    font-size: var(--step--1);
    color: #92400e;
  }

  .ai-warning code {
    background: rgba(0,0,0,0.1);
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: var(--step--2);
  }

  /* API Keys section */
  .api-keys-section {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--color-border);
  }

  .api-keys-section h4 {
    margin: 0 0 0.5rem 0;
    font-size: var(--step-0);
    font-weight: 600;
  }

  .api-keys-section > .setting-description {
    margin-bottom: 1rem;
  }

  .key-input {
    display: flex;
    gap: 0.5rem;
  }

  .key-input input {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--step--1);
  }

  /* Folder structure visualization */
  .folder-structure {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--color-border);
  }

  .structure-header {
    font-size: var(--step--1);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.75rem;
  }

  .structure-tree {
    font-family: var(--font-mono);
    font-size: var(--step--1);
    background: var(--color-bg-alt);
    border-radius: 4px;
    padding: 1rem;
    line-height: 1.6;
  }

  .tree-item {
    color: var(--color-text-muted);
  }

  .tree-item.root {
    color: var(--color-text);
    font-weight: 500;
  }

  .tree-item.level-1 { padding-left: 1rem; }
  .tree-item.level-2 { padding-left: 2rem; }
  .tree-item.level-3 { padding-left: 3rem; }
  .tree-item.level-4 { padding-left: 4rem; }

</style>
