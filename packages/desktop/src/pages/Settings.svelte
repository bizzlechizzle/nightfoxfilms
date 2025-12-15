<script lang="ts">
  import { getAPI, formatBytes } from '../lib/api';
  import type { DatabaseStats } from '../lib/types';

  const api = getAPI();

  let storagePath = $state<string | null>(null);
  let litellmUrl = $state<string>('http://localhost:4000');
  let litellmVlm = $state<string>('local-vlm');
  let litellmLlm = $state<string>('local-llm');
  let theme = $state<string>('system');
  let dbPath = $state<string>('');
  let dbStats = $state<DatabaseStats | null>(null);
  let loading = $state(true);
  let saving = $state(false);

  $effect(() => {
    loadSettings();
  });

  async function loadSettings() {
    loading = true;
    try {
      const [settings, dbPathResult, dbStatsResult] = await Promise.all([
        api.settings.getAll(),
        api.database.getLocation(),
        api.database.getStats(),
      ]);

      storagePath = settings.storage_path ?? null;
      litellmUrl = settings.litellm_url ?? 'http://localhost:4000';
      litellmVlm = settings.litellm_model_vlm ?? 'local-vlm';
      litellmLlm = settings.litellm_model_llm ?? 'local-llm';
      theme = settings.theme ?? 'system';
      dbPath = dbPathResult;
      dbStats = dbStatsResult;
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

  async function saveAllSettings() {
    saving = true;
    try {
      await Promise.all([
        saveSetting('litellm_url', litellmUrl),
        saveSetting('litellm_model_vlm', litellmVlm),
        saveSetting('litellm_model_llm', litellmLlm),
        saveSetting('theme', theme),
      ]);
    } finally {
      saving = false;
    }
  }

  async function showDatabaseInFinder() {
    if (dbPath) {
      await api.shell.showItemInFolder(dbPath);
    }
  }

  async function testLiteLLM() {
    try {
      const status = await api.ai.getStatus();
      if (status.available) {
        alert('LiteLLM connection successful!');
      } else {
        alert('LiteLLM not available. Check the URL and ensure the server is running.');
      }
    } catch (error) {
      alert('Failed to connect to LiteLLM: ' + error);
    }
  }
</script>

<div class="page">
  <header class="page-header">
    <h2>Settings</h2>
    <p class="subtitle">Configure application preferences</p>
  </header>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else}
    <div class="settings-sections">
      <section class="settings-section">
        <h3>Storage</h3>
        <div class="setting-row">
          <div class="setting-info">
            <label>Managed Storage Path</label>
            <p class="setting-description">
              Location where imported files are copied (optional)
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
        <div class="setting-row">
          <div class="setting-info">
            <label for="litellm-url">LiteLLM Server URL</label>
            <p class="setting-description">
              Base URL for the LiteLLM proxy server
            </p>
          </div>
          <div class="setting-control">
            <input
              id="litellm-url"
              type="text"
              bind:value={litellmUrl}
              placeholder="http://localhost:4000"
            />
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <label for="litellm-vlm">Vision Model</label>
            <p class="setting-description">
              Model for image/video analysis
            </p>
          </div>
          <div class="setting-control">
            <input
              id="litellm-vlm"
              type="text"
              bind:value={litellmVlm}
              placeholder="local-vlm"
            />
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <label for="litellm-llm">Text Model</label>
            <p class="setting-description">
              Model for text generation
            </p>
          </div>
          <div class="setting-control">
            <input
              id="litellm-llm"
              type="text"
              bind:value={litellmLlm}
              placeholder="local-llm"
            />
          </div>
        </div>
        <div class="setting-actions">
          <button class="btn btn-secondary" onclick={testLiteLLM}>
            Test Connection
          </button>
          <button class="btn btn-primary" onclick={saveAllSettings} disabled={saving}>
            {saving ? 'Saving...' : 'Save AI Settings'}
          </button>
        </div>
      </section>

      <section class="settings-section">
        <h3>Database</h3>
        <div class="setting-row">
          <div class="setting-info">
            <label>Database Location</label>
            <p class="setting-description setting-path">{dbPath}</p>
          </div>
          <div class="setting-control">
            <button class="btn btn-secondary" onclick={showDatabaseInFinder}>
              Show in Finder
            </button>
          </div>
        </div>
        {#if dbStats}
          <div class="db-stats">
            <div class="db-stat">
              <span class="stat-value">{dbStats.tables}</span>
              <span class="stat-label">Tables</span>
            </div>
            <div class="db-stat">
              <span class="stat-value">{dbStats.totalRows}</span>
              <span class="stat-label">Records</span>
            </div>
            <div class="db-stat">
              <span class="stat-value">{formatBytes(dbStats.sizeBytes)}</span>
              <span class="stat-label">Size</span>
            </div>
          </div>
        {/if}
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

  .page-header h2 { margin-bottom: 0.25rem; }
  .subtitle { color: var(--color-text-muted); margin: 0; }

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

  .setting-path {
    font-family: var(--font-mono);
    font-size: var(--step--2);
    word-break: break-all;
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

  .db-stats {
    display: flex;
    gap: 2rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--color-border);
  }

  .db-stat {
    display: flex;
    flex-direction: column;
  }

  .db-stat .stat-value {
    font-size: var(--step-1);
    font-weight: 600;
  }

  .db-stat .stat-label {
    font-size: var(--step--1);
    color: var(--color-text-muted);
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
</style>
