# LiteLLM Integration Implementation Plan

**Version:** 1.1 (Post-Audit)
**Date:** 2025-12-14
**Status:** APPROVED - Ready for Implementation
**Audit:** See `litellm-plan-audit.md` for full audit trail

---

## Executive Summary

Integrate LiteLLM as the unified AI gateway for Abandoned Archive, replacing direct provider calls with a proxy-based architecture. LiteLLM handles cost tracking, rate limiting, caching, fallbacks, and observability out of the box. We build only: credential encryption, privacy controls, LiteLLM lifecycle management, and UI.

---

## Phase 1: Credential Security Foundation

**Priority:** P0 - Must complete before any cloud provider integration
**Estimated Effort:** 1-2 days

### 1.1 Add Electron safeStorage for API Keys

**File:** `packages/desktop/electron/services/credential-service.ts` (new)

```typescript
/**
 * Credential Service
 * Secure storage for API keys using Electron's safeStorage
 */
import { safeStorage } from 'electron';
import { getDb } from '../main/database';

export interface StoredCredential {
  provider: string;
  encryptedKey: Buffer;
  createdAt: string;
  lastUsedAt: string;
}

export class CredentialService {
  private db = getDb();

  async store(provider: string, apiKey: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption not available on this system');
    }

    const encrypted = safeStorage.encryptString(apiKey);

    await this.db
      .insertInto('credentials')
      .values({
        provider,
        encrypted_key: encrypted.toString('base64'),
        created_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
      })
      .onConflict((oc) => oc.column('provider').doUpdateSet({
        encrypted_key: encrypted.toString('base64'),
        last_used_at: new Date().toISOString(),
      }))
      .execute();
  }

  async retrieve(provider: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('credentials')
      .select(['encrypted_key'])
      .where('provider', '=', provider)
      .executeTakeFirst();

    if (!row) return null;

    const buffer = Buffer.from(row.encrypted_key, 'base64');
    return safeStorage.decryptString(buffer);
  }

  async delete(provider: string): Promise<void> {
    await this.db
      .deleteFrom('credentials')
      .where('provider', '=', provider)
      .execute();
  }

  async hasCredential(provider: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('credentials')
      .select(['provider'])
      .where('provider', '=', provider)
      .executeTakeFirst();

    return !!row;
  }

  async listProviders(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('credentials')
      .select(['provider'])
      .execute();

    return rows.map(r => r.provider);
  }
}

let instance: CredentialService | null = null;
export function getCredentialService(): CredentialService {
  if (!instance) instance = new CredentialService();
  return instance;
}
```

### 1.2 Database Migration

**File:** `packages/desktop/electron/main/database.ts`

Add Migration 82:

```typescript
// Migration 82: Encrypted credentials table
{
  const tableExists = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='credentials'")
    .get();

  if (!tableExists) {
    console.log('Running migration 82: Creating credentials table');
    sqlite.exec(`
      CREATE TABLE credentials (
        provider TEXT PRIMARY KEY,
        encrypted_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL
      );
    `);
  }
}
```

### 1.3 IPC Handlers

**File:** `packages/desktop/electron/main/ipc-handlers/credentials.ts` (new)

```typescript
import { ipcMain } from 'electron';
import { getCredentialService } from '../../services/credential-service';

export function registerCredentialHandlers(): void {
  const service = getCredentialService();

  ipcMain.handle('credentials:store', async (_, provider: string, apiKey: string) => {
    try {
      await service.store(provider, apiKey);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('credentials:has', async (_, provider: string) => {
    return { success: true, hasKey: await service.hasCredential(provider) };
  });

  ipcMain.handle('credentials:delete', async (_, provider: string) => {
    try {
      await service.delete(provider);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('credentials:list', async () => {
    return { success: true, providers: await service.listProviders() };
  });

  // NOTE: No 'credentials:retrieve' exposed to renderer for security
  // Keys are only retrieved internally when writing LiteLLM config
}
```

### 1.4 Preload Bridge

**File:** `packages/desktop/electron/preload/preload.cjs`

Add to contextBridge:

```javascript
credentials: {
  store: (provider, apiKey) => ipcRenderer.invoke('credentials:store', provider, apiKey),
  has: (provider) => ipcRenderer.invoke('credentials:has', provider),
  delete: (provider) => ipcRenderer.invoke('credentials:delete', provider),
  list: () => ipcRenderer.invoke('credentials:list'),
  // No retrieve - keys never sent to renderer
},
```

---

## Phase 2: LiteLLM Lifecycle Service

**Priority:** P0
**Estimated Effort:** 2-3 days

### 2.1 LiteLLM Lifecycle Service

**File:** `packages/desktop/electron/services/litellm-lifecycle-service.ts` (new)

Pattern: Follow `ollama-lifecycle-service.ts`

```typescript
/**
 * LiteLLM Lifecycle Service
 *
 * Manages the LiteLLM proxy server as a subprocess.
 * - Auto-start when extraction needed
 * - Idle timeout shutdown
 * - Config file generation from stored credentials
 * - Health monitoring
 */
import { spawn, ChildProcess } from 'child_process';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { getCredentialService } from './credential-service';
import { getDb } from '../main/database';

// Types
export interface LiteLLMConfig {
  port: number;
  models: LiteLLMModelConfig[];
  routerSettings: {
    routingStrategy: 'simple-shuffle' | 'least-busy' | 'cost-based-routing';
    retries: number;
    fallbacks: Record<string, string[]>;
  };
  cacheEnabled: boolean;
  cacheType: 'local' | 'redis';
}

export interface LiteLLMModelConfig {
  modelName: string;
  litellmParams: {
    model: string;
    apiBase?: string;
    apiKey?: string;
  };
}

export interface LiteLLMStatus {
  installed: boolean;
  running: boolean;
  managedByApp: boolean;
  port: number;
  healthEndpoint: string;
  configuredModels: string[];
  lastError: string | null;
}

// Constants
const DEFAULT_PORT = 4000;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const STARTUP_TIMEOUT_MS = 30 * 1000;
const HEALTH_CHECK_INTERVAL_MS = 30 * 1000;

// State
let litellmProcess: ChildProcess | null = null;
let weStartedIt = false;
let idleTimer: NodeJS.Timeout | null = null;
let healthCheckInterval: NodeJS.Timeout | null = null;
let lastError: string | null = null;
let currentPort = DEFAULT_PORT;

/**
 * Check if LiteLLM is installed (pip package)
 */
export async function isLiteLLMInstalled(): Promise<boolean> {
  try {
    const { execSync } = require('child_process');
    execSync('python3 -c "import litellm"', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if LiteLLM proxy is responding
 */
export async function isLiteLLMRunning(): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${currentPort}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Generate LiteLLM config YAML from stored credentials
 */
async function generateConfig(): Promise<string> {
  const credService = getCredentialService();
  const db = getDb();

  // Get LiteLLM settings from database
  const settings = await db
    .selectFrom('settings')
    .select(['key', 'value'])
    .where('key', 'like', 'litellm_%')
    .execute();

  const settingsMap = Object.fromEntries(settings.map(s => [s.key, s.value]));

  // Build model list
  const models: any[] = [];

  // Always add local Ollama if available
  models.push({
    model_name: 'extraction-local',
    litellm_params: {
      model: 'ollama/qwen2.5:7b',
      api_base: 'http://localhost:11434',
    },
  });

  // Add cloud providers if credentials exist
  if (await credService.hasCredential('anthropic')) {
    const key = await credService.retrieve('anthropic');
    models.push({
      model_name: 'extraction-cloud',
      litellm_params: {
        model: 'claude-3-5-sonnet-20241022',
        api_key: key,
      },
    });
    models.push({
      model_name: 'extraction-fast',
      litellm_params: {
        model: 'claude-3-5-haiku-20241022',
        api_key: key,
      },
    });
  }

  if (await credService.hasCredential('openai')) {
    const key = await credService.retrieve('openai');
    models.push({
      model_name: 'extraction-cloud',
      litellm_params: {
        model: 'gpt-4o',
        api_key: key,
      },
    });
    models.push({
      model_name: 'extraction-fast',
      litellm_params: {
        model: 'gpt-4o-mini',
        api_key: key,
      },
    });
  }

  // Build config object
  const config = {
    model_list: models,
    router_settings: {
      routing_strategy: settingsMap.litellm_routing_strategy || 'cost-based-routing',
      retry_policy: {
        retries: parseInt(settingsMap.litellm_retries || '3'),
      },
      fallbacks: [
        { 'extraction-local': ['extraction-fast', 'extraction-cloud'] },
      ],
    },
    litellm_settings: {
      cache: settingsMap.litellm_cache_enabled === 'true',
      drop_params: true,
      set_verbose: false,
    },
    general_settings: {
      master_key: `sk-${crypto.randomUUID()}`, // Internal use only
    },
  };

  // Convert to YAML (simple implementation)
  return JSON.stringify(config, null, 2);
}

/**
 * Get config file path
 */
function getConfigPath(): string {
  const configDir = join(app.getPath('userData'), 'litellm');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  return join(configDir, 'config.json');
}

/**
 * Start LiteLLM proxy server
 */
export async function startLiteLLM(): Promise<boolean> {
  lastError = null;

  // Already running?
  if (await isLiteLLMRunning()) {
    console.log('[LiteLLM] Already running');
    return true;
  }

  // Check if installed
  if (!await isLiteLLMInstalled()) {
    lastError = 'LiteLLM not installed. Run: pip install litellm[proxy]';
    console.error(`[LiteLLM] ${lastError}`);
    return false;
  }

  // Generate config
  const configPath = getConfigPath();
  const configContent = await generateConfig();
  writeFileSync(configPath, configContent, 'utf8');

  console.log(`[LiteLLM] Starting proxy on port ${currentPort}`);

  try {
    litellmProcess = spawn('litellm', [
      '--config', configPath,
      '--port', String(currentPort),
      '--detailed_debug', 'false',
    ], {
      detached: true,
      stdio: 'ignore',
    });

    litellmProcess.unref();
    weStartedIt = true;

    // Wait for startup
    const startTime = Date.now();
    while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, 1000));
      if (await isLiteLLMRunning()) {
        console.log(`[LiteLLM] Started in ${Date.now() - startTime}ms`);
        startHealthCheck();
        return true;
      }
    }

    lastError = 'LiteLLM failed to start within timeout';
    console.error(`[LiteLLM] ${lastError}`);
    stopLiteLLM();
    return false;

  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error('[LiteLLM] Start failed:', lastError);
    return false;
  }
}

/**
 * Stop LiteLLM proxy (only if we started it)
 */
export function stopLiteLLM(): void {
  clearIdleTimer();
  clearHealthCheck();

  if (!weStartedIt) {
    console.log('[LiteLLM] Not our instance, skipping shutdown');
    return;
  }

  if (litellmProcess) {
    try {
      litellmProcess.kill('SIGTERM');
    } catch {}
    litellmProcess = null;
  }

  weStartedIt = false;
  console.log('[LiteLLM] Stopped');
}

/**
 * Ensure LiteLLM is running (main entry point)
 */
export async function ensureLiteLLMRunning(): Promise<boolean> {
  if (await isLiteLLMRunning()) {
    resetIdleTimer();
    return true;
  }

  const started = await startLiteLLM();
  if (started) {
    resetIdleTimer();
  }
  return started;
}

/**
 * Reset idle timer
 */
function resetIdleTimer(): void {
  if (!weStartedIt) return;
  clearIdleTimer();

  idleTimer = setTimeout(() => {
    console.log('[LiteLLM] Idle timeout, stopping');
    stopLiteLLM();
  }, IDLE_TIMEOUT_MS);
}

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/**
 * Health check monitoring
 */
function startHealthCheck(): void {
  clearHealthCheck();
  healthCheckInterval = setInterval(async () => {
    if (!await isLiteLLMRunning()) {
      console.warn('[LiteLLM] Health check failed');
      // Could auto-restart here if desired
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

function clearHealthCheck(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

/**
 * Get current status
 */
export async function getLiteLLMStatus(): Promise<LiteLLMStatus> {
  const running = await isLiteLLMRunning();

  return {
    installed: await isLiteLLMInstalled(),
    running,
    managedByApp: weStartedIt,
    port: currentPort,
    healthEndpoint: `http://localhost:${currentPort}/health`,
    configuredModels: [], // TODO: Parse from config
    lastError,
  };
}

/**
 * Reload config (after credential changes)
 */
export async function reloadConfig(): Promise<boolean> {
  if (!weStartedIt || !litellmProcess) {
    return false;
  }

  // Regenerate config and restart
  stopLiteLLM();
  return await startLiteLLM();
}

// Export singleton-style
export const LiteLLMLifecycle = {
  isInstalled: isLiteLLMInstalled,
  isRunning: isLiteLLMRunning,
  start: startLiteLLM,
  stop: stopLiteLLM,
  ensure: ensureLiteLLMRunning,
  getStatus: getLiteLLMStatus,
  reloadConfig,
  resetIdleTimer,
};
```

### 2.2 LiteLLM IPC Handlers

**File:** `packages/desktop/electron/main/ipc-handlers/litellm.ts` (new)

```typescript
import { ipcMain } from 'electron';
import { LiteLLMLifecycle } from '../../services/litellm-lifecycle-service';

export function registerLiteLLMHandlers(): void {
  ipcMain.handle('litellm:status', async () => {
    return { success: true, status: await LiteLLMLifecycle.getStatus() };
  });

  ipcMain.handle('litellm:start', async () => {
    const started = await LiteLLMLifecycle.start();
    return { success: started, error: started ? null : 'Failed to start LiteLLM' };
  });

  ipcMain.handle('litellm:stop', async () => {
    LiteLLMLifecycle.stop();
    return { success: true };
  });

  ipcMain.handle('litellm:reload', async () => {
    const reloaded = await LiteLLMLifecycle.reloadConfig();
    return { success: reloaded };
  });

  ipcMain.handle('litellm:test', async (_, modelName: string) => {
    try {
      await LiteLLMLifecycle.ensure();

      const response = await fetch('http://localhost:4000/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: 'Say "test successful" in exactly 2 words.' }],
          max_tokens: 10,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return { success: true, response: data.choices[0].message.content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}
```

---

## Phase 3: Privacy & Sanitization

**Priority:** P1
**Estimated Effort:** 1 day

### 3.1 Privacy Sanitizer Service

**File:** `packages/desktop/electron/services/privacy-sanitizer.ts` (new)

```typescript
/**
 * Privacy Sanitizer
 * Removes sensitive data before sending to cloud providers
 */

export interface PrivacySettings {
  enabled: boolean;
  redactGps: boolean;
  redactAddresses: boolean;
  redactNames: boolean;
  excludedLocationIds: string[];
}

const GPS_PATTERN = /\b-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}\b/g;
const ADDRESS_PATTERN = /\d+\s+[\w\s]+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\.?/gi;
const ZIPCODE_PATTERN = /\b\d{5}(-\d{4})?\b/g;

export function sanitizeForCloud(text: string, settings: PrivacySettings): string {
  if (!settings.enabled) return text;

  let sanitized = text;

  if (settings.redactGps) {
    sanitized = sanitized.replace(GPS_PATTERN, '[GPS_REDACTED]');
  }

  if (settings.redactAddresses) {
    sanitized = sanitized.replace(ADDRESS_PATTERN, '[ADDRESS_REDACTED]');
    sanitized = sanitized.replace(ZIPCODE_PATTERN, '[ZIP_REDACTED]');
  }

  return sanitized;
}

export function isLocationExcluded(locId: string, settings: PrivacySettings): boolean {
  return settings.excludedLocationIds.includes(locId);
}

export async function getPrivacySettings(): Promise<PrivacySettings> {
  const db = getDb();
  const settings = await db
    .selectFrom('settings')
    .select(['key', 'value'])
    .where('key', 'like', 'privacy_%')
    .execute();

  const map = Object.fromEntries(settings.map(s => [s.key, s.value]));

  return {
    enabled: map.privacy_enabled !== 'false',
    redactGps: map.privacy_redact_gps !== 'false',
    redactAddresses: map.privacy_redact_addresses !== 'false',
    redactNames: map.privacy_redact_names === 'true',
    excludedLocationIds: JSON.parse(map.privacy_excluded_locations || '[]'),
  };
}
```

---

## Phase 4: Extraction Service Integration

**Priority:** P1
**Estimated Effort:** 2 days

### 4.1 LiteLLM Provider Adapter

**File:** `packages/desktop/electron/services/extraction/providers/litellm-provider.ts` (new)

```typescript
/**
 * LiteLLM Provider
 * Routes extraction requests through LiteLLM proxy
 */
import { BaseExtractionProvider } from './base-provider';
import { LiteLLMLifecycle } from '../../litellm-lifecycle-service';
import { sanitizeForCloud, getPrivacySettings } from '../../privacy-sanitizer';
import type { ExtractionInput, ExtractionResult, ProviderConfig, ProviderStatus } from '../extraction-types';

export class LiteLLMProvider extends BaseExtractionProvider {
  private baseUrl = 'http://localhost:4000';

  constructor(config: ProviderConfig) {
    super(config);
  }

  async checkAvailability(): Promise<ProviderStatus> {
    const status = await LiteLLMLifecycle.getStatus();

    return {
      id: this.config.id,
      available: status.running,
      lastCheck: new Date().toISOString(),
      lastError: status.lastError || undefined,
    };
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    // Ensure LiteLLM is running
    if (!await LiteLLMLifecycle.ensure()) {
      throw new Error('LiteLLM proxy not available');
    }

    // Reset idle timer
    LiteLLMLifecycle.resetIdleTimer();

    // Apply privacy sanitization for cloud models
    const privacySettings = await getPrivacySettings();
    const modelName = this.config.settings.cloudModel || 'extraction-local';
    const isCloudModel = !modelName.includes('local') && !modelName.includes('ollama');

    let textToProcess = input.text;
    if (isCloudModel && privacySettings.enabled) {
      textToProcess = sanitizeForCloud(input.text, privacySettings);
    }

    // Build prompt using versioned prompts system
    const { systemPrompt, userPrompt } = this.buildPrompt(textToProcess, input);

    // Call LiteLLM proxy
    const response = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.getTemperature(),
        max_tokens: this.getMaxTokens(),
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LiteLLM error: ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    // Parse and validate response
    return this.parseResponse(content, input);
  }

  async getModelInfo(): Promise<{ name: string; size?: string; description?: string }> {
    return {
      name: this.config.settings.cloudModel || 'extraction-local',
      description: 'LiteLLM proxy router',
    };
  }

  private buildPrompt(text: string, input: ExtractionInput): { systemPrompt: string; userPrompt: string } {
    // Use existing versioned prompts from versioned-prompts.ts
    const { DATE_EXTRACTION_PROMPTS } = require('../agents/versioned-prompts');
    const version = this.config.settings.promptVersion || 'v2.0';
    const prompt = DATE_EXTRACTION_PROMPTS[version];

    return {
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt
        .replace('{text}', text)
        .replace('{preprocessed_sentences}', input.preprocessedData?.sentences || '')
        .replace('{total_sentences}', String(input.preprocessedData?.totalSentences || 0))
        .replace('{timeline_relevant}', String(input.preprocessedData?.timelineRelevant || 0))
        .replace('{profile_relevant}', String(input.preprocessedData?.profileRelevant || 0)),
    };
  }

  private parseResponse(content: string, input: ExtractionInput): ExtractionResult {
    // Clean markdown if present
    const cleaned = content.replace(/^```json\n?|\n?```$/g, '').trim();

    try {
      const parsed = JSON.parse(cleaned);

      return {
        dates: parsed.dates || [],
        people: parsed.people || [],
        organizations: parsed.organizations || [],
        processingTimeMs: 0, // Filled by caller
        provider: this.config.id,
        promptVersion: this.config.settings.promptVersion || 'v2.0',
      };
    } catch (error) {
      this.log('error', 'Failed to parse LLM response', { content, error });
      throw new Error(`Invalid LLM response: ${error.message}`);
    }
  }
}
```

### 4.2 Update Extraction Service

**File:** `packages/desktop/electron/services/extraction/extraction-service.ts`

Add LiteLLM as a provider type and integrate:

```typescript
// Add to imports
import { LiteLLMProvider } from './providers/litellm-provider';

// In getProvider() method, add case:
case 'litellm':
  return new LiteLLMProvider(config);
```

---

## Phase 5: Settings UI

**Priority:** P1
**Estimated Effort:** 2-3 days

### 5.1 AI Settings Panel Component

**File:** `packages/desktop/src/components/AISettingsPanel.svelte` (new)

Following Braun design principles:

```svelte
<script lang="ts">
  /**
   * AI Settings Panel
   * Configure LiteLLM providers and API keys
   * Braun/Ulm design language
   */
  import { onMount } from 'svelte';

  interface ProviderStatus {
    id: string;
    name: string;
    hasKey: boolean;
    available: boolean;
    lastError?: string;
  }

  interface LiteLLMStatus {
    installed: boolean;
    running: boolean;
    port: number;
    lastError: string | null;
  }

  // State
  let litellmStatus = $state<LiteLLMStatus | null>(null);
  let providers = $state<ProviderStatus[]>([]);
  let loading = $state(true);
  let testing = $state<string | null>(null);
  let testResult = $state<{ success: boolean; message: string } | null>(null);

  // API Key modal
  let showKeyModal = $state(false);
  let keyModalProvider = $state('');
  let apiKeyInput = $state('');
  let savingKey = $state(false);

  // Privacy settings
  let privacyEnabled = $state(true);
  let redactGps = $state(true);
  let redactAddresses = $state(true);

  onMount(async () => {
    await loadStatus();
    loading = false;
  });

  async function loadStatus() {
    // Get LiteLLM status
    const llmResult = await window.electronAPI.litellm.status();
    if (llmResult.success) {
      litellmStatus = llmResult.status;
    }

    // Get credential status for each provider
    const credList = await window.electronAPI.credentials.list();
    const storedProviders = credList.success ? credList.providers : [];

    providers = [
      { id: 'ollama', name: 'Ollama (Local)', hasKey: true, available: litellmStatus?.running || false },
      { id: 'anthropic', name: 'Anthropic (Claude)', hasKey: storedProviders.includes('anthropic'), available: false },
      { id: 'openai', name: 'OpenAI (GPT)', hasKey: storedProviders.includes('openai'), available: false },
      { id: 'google', name: 'Google (Gemini)', hasKey: storedProviders.includes('google'), available: false },
    ];

    // Test availability for providers with keys
    for (const provider of providers) {
      if (provider.hasKey && provider.id !== 'ollama') {
        // Would test here in production
      }
    }
  }

  async function startLiteLLM() {
    const result = await window.electronAPI.litellm.start();
    if (result.success) {
      await loadStatus();
    } else {
      testResult = { success: false, message: result.error || 'Failed to start' };
    }
  }

  async function stopLiteLLM() {
    await window.electronAPI.litellm.stop();
    await loadStatus();
  }

  function openKeyModal(providerId: string) {
    keyModalProvider = providerId;
    apiKeyInput = '';
    showKeyModal = true;
  }

  async function saveApiKey() {
    if (!apiKeyInput.trim()) return;

    savingKey = true;
    const result = await window.electronAPI.credentials.store(keyModalProvider, apiKeyInput.trim());

    if (result.success) {
      showKeyModal = false;
      apiKeyInput = '';
      await window.electronAPI.litellm.reload();
      await loadStatus();
    } else {
      testResult = { success: false, message: result.error || 'Failed to save key' };
    }
    savingKey = false;
  }

  async function deleteApiKey(providerId: string) {
    if (!confirm(`Remove API key for ${providerId}?`)) return;

    await window.electronAPI.credentials.delete(providerId);
    await window.electronAPI.litellm.reload();
    await loadStatus();
  }

  async function testProvider(providerId: string) {
    testing = providerId;
    testResult = null;

    const result = await window.electronAPI.litellm.test(
      providerId === 'ollama' ? 'extraction-local' : 'extraction-cloud'
    );

    testResult = {
      success: result.success,
      message: result.success ? `Response: ${result.response}` : result.error,
    };
    testing = null;
  }

  function getStatusColor(provider: ProviderStatus): string {
    if (!provider.hasKey && provider.id !== 'ollama') return 'bg-braun-300';
    if (provider.available) return 'bg-green-500';
    return 'bg-amber-500';
  }
</script>

<div class="space-y-6">
  <!-- LiteLLM Proxy Status -->
  <div class="bg-white rounded border border-braun-200 p-6">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-medium text-braun-800">AI Gateway Status</h3>
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full {litellmStatus?.running ? 'bg-green-500' : 'bg-braun-300'}"></span>
        <span class="text-xs text-braun-600">
          {litellmStatus?.running ? 'Running' : 'Stopped'}
        </span>
      </div>
    </div>

    {#if !litellmStatus?.installed}
      <p class="text-sm text-red-600 mb-4">
        LiteLLM not installed. Run: <code class="bg-braun-50 px-1 rounded">pip install litellm[proxy]</code>
      </p>
    {:else}
      <div class="flex gap-2">
        {#if litellmStatus?.running}
          <button onclick={stopLiteLLM} class="text-xs px-3 py-1.5 border border-braun-300 rounded hover:bg-braun-50 transition">
            Stop Gateway
          </button>
        {:else}
          <button onclick={startLiteLLM} class="text-xs px-3 py-1.5 bg-braun-900 text-white rounded hover:bg-braun-800 transition">
            Start Gateway
          </button>
        {/if}
      </div>
    {/if}

    {#if litellmStatus?.lastError}
      <p class="text-xs text-red-600 mt-2">{litellmStatus.lastError}</p>
    {/if}
  </div>

  <!-- Provider List -->
  <div class="bg-white rounded border border-braun-200 p-6">
    <h3 class="text-sm font-medium text-braun-800 mb-4">LLM Providers</h3>

    <div class="space-y-3">
      {#each providers as provider}
        <div class="flex items-center justify-between py-3 border-b border-braun-100 last:border-0">
          <div class="flex items-center gap-3">
            <span class="w-2 h-2 rounded-full {getStatusColor(provider)}"></span>
            <div>
              <span class="text-sm text-braun-900">{provider.name}</span>
              {#if provider.id !== 'ollama'}
                <span class="text-xs text-braun-500 ml-2">
                  {provider.hasKey ? 'Key configured' : 'No API key'}
                </span>
              {/if}
            </div>
          </div>

          <div class="flex items-center gap-2">
            {#if provider.id !== 'ollama'}
              {#if provider.hasKey}
                <button
                  onclick={() => deleteApiKey(provider.id)}
                  class="text-xs px-2 py-1 text-red-600 hover:text-red-700"
                >
                  Remove Key
                </button>
              {:else}
                <button
                  onclick={() => openKeyModal(provider.id)}
                  class="text-xs px-2 py-1 text-braun-600 hover:text-braun-900"
                >
                  Add Key
                </button>
              {/if}
            {/if}
            <button
              onclick={() => testProvider(provider.id)}
              disabled={testing === provider.id || (!provider.hasKey && provider.id !== 'ollama')}
              class="text-xs px-2 py-1 bg-braun-50 hover:bg-braun-100 text-braun-700 rounded transition disabled:opacity-50"
            >
              {testing === provider.id ? 'Testing...' : 'Test'}
            </button>
          </div>
        </div>
      {/each}
    </div>

    {#if testResult}
      <div class="mt-4 p-3 rounded text-sm {testResult.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}">
        {testResult.message}
      </div>
    {/if}
  </div>

  <!-- Privacy Settings -->
  <div class="bg-white rounded border border-braun-200 p-6">
    <h3 class="text-sm font-medium text-braun-800 mb-4">Privacy Controls</h3>
    <p class="text-xs text-braun-500 mb-4">
      Sensitive data is automatically removed before sending to cloud providers.
      Local models (Ollama) receive unmodified text.
    </p>

    <div class="space-y-3">
      <label class="flex items-center gap-3">
        <input type="checkbox" bind:checked={privacyEnabled} class="rounded border-braun-300" />
        <span class="text-sm text-braun-700">Enable privacy sanitization</span>
      </label>

      <label class="flex items-center gap-3 ml-6">
        <input type="checkbox" bind:checked={redactGps} disabled={!privacyEnabled} class="rounded border-braun-300" />
        <span class="text-sm text-braun-700">Redact GPS coordinates</span>
      </label>

      <label class="flex items-center gap-3 ml-6">
        <input type="checkbox" bind:checked={redactAddresses} disabled={!privacyEnabled} class="rounded border-braun-300" />
        <span class="text-sm text-braun-700">Redact street addresses</span>
      </label>
    </div>
  </div>
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
          Enter your API key for <strong>{keyModalProvider}</strong>.
          Keys are encrypted and stored locally.
        </p>

        <div>
          <label class="block text-sm font-medium text-braun-700 mb-1">API Key</label>
          <input
            type="password"
            bind:value={apiKeyInput}
            placeholder="sk-..."
            class="w-full px-3 py-2 border border-braun-300 rounded text-sm focus:outline-none focus:border-braun-500"
          />
        </div>
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
          class="px-4 py-2 text-sm bg-braun-900 text-white rounded hover:bg-braun-800 disabled:opacity-50"
        >
          {savingKey ? 'Saving...' : 'Save Key'}
        </button>
      </div>
    </div>
  </div>
{/if}
```

### 5.2 Add to Settings Page

**File:** `packages/desktop/src/pages/Settings.svelte`

Add accordion section:

```svelte
<!-- Add import -->
import AISettingsPanel from '../components/AISettingsPanel.svelte';

<!-- Add state -->
let aiExpanded = $state(false);

<!-- Add accordion section after Date Engine -->
<div class="border border-braun-200 rounded">
  <button
    onclick={() => aiExpanded = !aiExpanded}
    class="w-full px-4 py-3 flex items-center justify-between hover:bg-braun-50 transition"
  >
    <span class="font-medium text-braun-800">AI Models</span>
    <svg class="w-5 h-5 text-braun-500 transition {aiExpanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if aiExpanded}
    <div class="px-4 pb-4">
      <AISettingsPanel />
    </div>
  {/if}
</div>
```

---

## Phase 6: Preload & Type Definitions

**Priority:** P1
**Estimated Effort:** 0.5 days

### 6.1 Update Preload Bridge

**File:** `packages/desktop/electron/preload/preload.cjs`

```javascript
// Add to contextBridge.exposeInMainWorld('electronAPI', {...})

litellm: {
  status: () => ipcRenderer.invoke('litellm:status'),
  start: () => ipcRenderer.invoke('litellm:start'),
  stop: () => ipcRenderer.invoke('litellm:stop'),
  reload: () => ipcRenderer.invoke('litellm:reload'),
  test: (model) => ipcRenderer.invoke('litellm:test', model),
},

credentials: {
  store: (provider, key) => ipcRenderer.invoke('credentials:store', provider, key),
  has: (provider) => ipcRenderer.invoke('credentials:has', provider),
  delete: (provider) => ipcRenderer.invoke('credentials:delete', provider),
  list: () => ipcRenderer.invoke('credentials:list'),
},
```

### 6.2 Update Type Definitions

**File:** `packages/desktop/src/types/electron.d.ts`

```typescript
interface LiteLLMStatus {
  installed: boolean;
  running: boolean;
  managedByApp: boolean;
  port: number;
  healthEndpoint: string;
  configuredModels: string[];
  lastError: string | null;
}

interface ElectronAPI {
  // ... existing ...

  litellm: {
    status(): Promise<{ success: boolean; status: LiteLLMStatus }>;
    start(): Promise<{ success: boolean; error?: string }>;
    stop(): Promise<{ success: boolean }>;
    reload(): Promise<{ success: boolean }>;
    test(model: string): Promise<{ success: boolean; response?: string; error?: string }>;
  };

  credentials: {
    store(provider: string, apiKey: string): Promise<{ success: boolean; error?: string }>;
    has(provider: string): Promise<{ success: boolean; hasKey: boolean }>;
    delete(provider: string): Promise<{ success: boolean; error?: string }>;
    list(): Promise<{ success: boolean; providers: string[] }>;
  };
}
```

---

## Phase 7: Register Handlers & Cleanup

**Priority:** P1
**Estimated Effort:** 0.5 days

### 7.1 Register New Handlers

**File:** `packages/desktop/electron/main/ipc-handlers/index.ts`

```typescript
import { registerCredentialHandlers } from './credentials';
import { registerLiteLLMHandlers } from './litellm';

export function registerAllHandlers(): void {
  // ... existing handlers ...
  registerCredentialHandlers();
  registerLiteLLMHandlers();
}
```

### 7.2 Cleanup on App Quit

**File:** `packages/desktop/electron/main/index.ts`

```typescript
import { LiteLLMLifecycle } from '../services/litellm-lifecycle-service';

app.on('before-quit', () => {
  LiteLLMLifecycle.stop();
});
```

---

## Database Migrations Summary

| Migration | Table/Change |
|-----------|--------------|
| 82 | `credentials` - Encrypted API key storage |
| 83 | `settings` - Add `litellm_*` and `privacy_*` keys |
| 84 | `extraction_providers` - Add `litellm` type support |

---

## Testing Checklist

### Unit Tests
- [ ] CredentialService encrypts/decrypts correctly
- [ ] PrivacySanitizer removes GPS coordinates
- [ ] PrivacySanitizer removes addresses
- [ ] LiteLLMProvider builds correct prompt

### Integration Tests
- [ ] LiteLLM starts and responds to health checks
- [ ] Extraction routes through LiteLLM proxy
- [ ] Fallback chain works (Ollama → cloud)
- [ ] API keys stored/retrieved securely

### Manual Testing
- [ ] Add Anthropic API key via UI
- [ ] Test extraction with local Ollama
- [ ] Test extraction with cloud provider
- [ ] Verify privacy sanitization in cloud requests
- [ ] Verify cost tracking in LiteLLM logs

---

## Rollout Plan

1. **Alpha** (Internal): Credential encryption + LiteLLM lifecycle
2. **Beta**: Full UI with provider management
3. **RC**: Privacy controls + observability integration
4. **Release**: Documentation + user guide

---

## Dependencies

### Python (for LiteLLM proxy)
```bash
pip install "litellm[proxy]"
```

### No new npm dependencies required
LiteLLM runs as subprocess, communication via HTTP.

---

## Success Metrics

- [ ] API keys encrypted at rest (verify via DB inspection)
- [ ] LiteLLM proxy starts within 10 seconds
- [ ] Extraction latency <5s for local, <15s for cloud
- [ ] Zero plaintext keys in logs or DB
- [ ] Privacy sanitization removes 100% of GPS patterns

---

---

## AUDIT-DRIVEN ADDITIONS (v1.1)

The following sections address gaps identified during plan audit.

---

## Addition A: Zod Validation (Phase 1 Enhancement)

**File:** `packages/desktop/electron/main/ipc-handlers/litellm-validation.ts` (new)

```typescript
/**
 * Zod validation schemas for LiteLLM and Credentials IPC
 */
import { z } from 'zod';

export const ProviderIdSchema = z.enum(['anthropic', 'openai', 'google', 'groq', 'ollama']);

export const StoreCredentialSchema = z.object({
  provider: ProviderIdSchema,
  apiKey: z.string()
    .min(10, 'API key too short')
    .max(200, 'API key too long')
    .refine(
      (key) => !key.includes(' '),
      'API key cannot contain spaces'
    ),
});

export const TestModelSchema = z.object({
  model: z.string().min(1),
});

export const LiteLLMResponseSchema = z.object({
  dates: z.array(z.object({
    rawText: z.string(),
    parsedDate: z.string(),
    category: z.enum(['build_date', 'opening', 'closure', 'demolition', 'visit', 'publication', 'renovation', 'event', 'unknown']),
    confidence: z.number().min(0).max(1),
    verb: z.string().optional(),
  })).optional().default([]),
  people: z.array(z.object({
    name: z.string(),
    role: z.string().optional(),
    confidence: z.number().min(0).max(1),
  })).optional().default([]),
  organizations: z.array(z.object({
    name: z.string(),
    type: z.string().optional(),
    confidence: z.number().min(0).max(1),
  })).optional().default([]),
});
```

**Update credentials.ts handler:**

```typescript
import { StoreCredentialSchema } from './litellm-validation';

ipcMain.handle('credentials:store', async (_, provider: string, apiKey: string) => {
  try {
    // Validate input
    const validated = StoreCredentialSchema.parse({ provider, apiKey });
    await service.store(validated.provider, validated.apiKey);
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: error.message };
  }
});
```

---

## Addition B: spaCy Preprocessing Integration (Phase 4 Enhancement)

**Update LiteLLMProvider.extract() to call spaCy first:**

```typescript
import { getPreprocessingService } from '../preprocessing-service';

async extract(input: ExtractionInput): Promise<ExtractionResult> {
  // Ensure LiteLLM is running
  if (!await LiteLLMLifecycle.ensure()) {
    throw new Error('LiteLLM proxy not available');
  }

  LiteLLMLifecycle.resetIdleTimer();

  // === NEW: Call spaCy preprocessing ===
  let preprocessedData = input.preprocessedData;
  if (!preprocessedData && input.text.length > 100) {
    try {
      const preprocessingService = getPreprocessingService();
      preprocessedData = await preprocessingService.preprocess(input.text);
      this.log('info', `spaCy preprocessing: ${preprocessedData.timelineRelevant} timeline sentences`);
    } catch (error) {
      this.log('warn', 'spaCy preprocessing failed, continuing without', error);
    }
  }
  // === END NEW ===

  // Apply privacy sanitization for cloud models
  const privacySettings = await getPrivacySettings();
  const modelName = this.config.settings.cloudModel || 'extraction-local';
  const isCloudModel = !modelName.includes('local') && !modelName.includes('ollama');

  let textToProcess = input.text;
  if (isCloudModel && privacySettings.enabled) {
    textToProcess = sanitizeForCloud(input.text, privacySettings);
  }

  // Build prompt WITH preprocessing data
  const { systemPrompt, userPrompt } = this.buildPrompt(textToProcess, {
    ...input,
    preprocessedData,
  });

  // ... rest unchanged
}
```

---

## Addition C: Profile Extraction Support (Phase 4 Enhancement)

**Add profile extraction prompt type:**

```typescript
// In buildPrompt method, add type parameter
private buildPrompt(
  text: string,
  input: ExtractionInput,
  type: 'date' | 'profile' | 'combined' = 'combined'
): { systemPrompt: string; userPrompt: string } {

  const { DATE_EXTRACTION_PROMPTS, PROFILE_EXTRACTION_PROMPTS, COMBINED_EXTRACTION_PROMPTS }
    = require('../agents/versioned-prompts');

  const version = this.config.settings.promptVersion || 'v2.0';

  let prompt;
  switch (type) {
    case 'date':
      prompt = DATE_EXTRACTION_PROMPTS[version];
      break;
    case 'profile':
      prompt = PROFILE_EXTRACTION_PROMPTS[version] || PROFILE_EXTRACTION_PROMPTS['v1.0'];
      break;
    case 'combined':
    default:
      prompt = COMBINED_EXTRACTION_PROMPTS[version] || COMBINED_EXTRACTION_PROMPTS['v1.0'];
      break;
  }

  // ... rest of template substitution
}
```

**Add combined extraction method:**

```typescript
async extractAll(input: ExtractionInput): Promise<ExtractionResult> {
  // Single call extracts dates, people, and organizations
  return this.extract({ ...input, extractionType: 'combined' });
}

async extractDatesOnly(input: ExtractionInput): Promise<ExtractionResult> {
  return this.extract({ ...input, extractionType: 'date' });
}

async extractProfilesOnly(input: ExtractionInput): Promise<ExtractionResult> {
  return this.extract({ ...input, extractionType: 'profile' });
}
```

---

## Addition D: Cost Dashboard UI (Phase 5 Enhancement)

**Add to AISettingsPanel.svelte:**

```svelte
<!-- Add state -->
let costs = $state<{ today: number; month: number; requestsToday: number } | null>(null);
let loadingCosts = $state(false);

<!-- Add to onMount -->
onMount(async () => {
  await loadStatus();
  await loadCosts();
  loading = false;
});

async function loadCosts() {
  loadingCosts = true;
  try {
    const result = await window.electronAPI.litellm.costs();
    if (result.success) {
      costs = result.costs;
    }
  } catch (error) {
    console.error('Failed to load costs:', error);
  }
  loadingCosts = false;
}

<!-- Add UI section after Provider List -->
<!-- Usage & Costs Card -->
<div class="bg-white rounded border border-braun-200 p-6">
  <div class="flex items-center justify-between mb-4">
    <h3 class="text-sm font-medium text-braun-800">Usage & Costs</h3>
    <button onclick={loadCosts} class="text-xs text-braun-500 hover:text-braun-700">
      Refresh
    </button>
  </div>

  {#if loadingCosts}
    <p class="text-sm text-braun-500">Loading...</p>
  {:else if costs}
    <div class="grid grid-cols-3 gap-4">
      <div>
        <p class="text-xs text-braun-500 uppercase tracking-wide">Today</p>
        <p class="text-xl font-medium text-braun-900">${costs.today.toFixed(2)}</p>
      </div>
      <div>
        <p class="text-xs text-braun-500 uppercase tracking-wide">This Month</p>
        <p class="text-xl font-medium text-braun-900">${costs.month.toFixed(2)}</p>
      </div>
      <div>
        <p class="text-xs text-braun-500 uppercase tracking-wide">Requests</p>
        <p class="text-xl font-medium text-braun-900">{costs.requestsToday}</p>
      </div>
    </div>
  {:else}
    <p class="text-sm text-braun-500">Cost tracking available when LiteLLM is running</p>
  {/if}
</div>
```

**Add IPC handler for costs:**

```typescript
// In litellm.ts
ipcMain.handle('litellm:costs', async () => {
  try {
    if (!await isLiteLLMRunning()) {
      return { success: false, error: 'LiteLLM not running' };
    }

    // Get start of current month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];

    // Query LiteLLM spend endpoint
    const response = await fetch(`http://localhost:4000/spend/logs?start_date=${startOfMonth}`);
    if (!response.ok) {
      return { success: false, error: 'Failed to fetch costs' };
    }

    const logs = await response.json();

    // Aggregate costs
    let todayTotal = 0;
    let monthTotal = 0;
    let requestsToday = 0;

    for (const log of logs) {
      monthTotal += log.spend || 0;
      if (log.startTime?.startsWith(today)) {
        todayTotal += log.spend || 0;
        requestsToday++;
      }
    }

    return {
      success: true,
      costs: {
        today: todayTotal,
        month: monthTotal,
        requestsToday,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

**Add to preload:**

```javascript
litellm: {
  // ... existing
  costs: () => ipcRenderer.invoke('litellm:costs'),
},
```

---

## Addition E: Migration for Existing Provider Configs

**Migration 85: Preserve existing Ollama configs**

```typescript
// Migration 85: Add litellm provider type, preserve existing configs
{
  // Check if we have existing ollama providers that should work with LiteLLM
  const existingOllama = sqlite
    .prepare("SELECT provider_id FROM extraction_providers WHERE type = 'ollama'")
    .all();

  if (existingOllama.length > 0) {
    console.log(`Migration 85: Found ${existingOllama.length} existing Ollama providers`);
    // These will continue to work - LiteLLM routes to Ollama via ollama/ prefix
  }

  // Add default LiteLLM provider if not exists
  const litellmExists = sqlite
    .prepare("SELECT provider_id FROM extraction_providers WHERE type = 'litellm'")
    .get();

  if (!litellmExists) {
    console.log('Migration 85: Adding default LiteLLM provider');
    sqlite
      .prepare(`
        INSERT INTO extraction_providers (provider_id, name, type, enabled, priority, settings, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        'litellm-router',
        'LiteLLM Router',
        'litellm',
        1,  // enabled
        5,  // lower priority than direct Ollama (runs after local fails)
        JSON.stringify({
          cloudModel: 'extraction-fast',
          promptVersion: 'v2.0',
          timeout: 120000,
          temperature: 0.1,
        }),
        new Date().toISOString(),
        new Date().toISOString()
      );
  }
}
```

---

## Updated Testing Checklist (Post-Audit)

### Unit Tests
- [ ] CredentialService encrypts/decrypts correctly
- [ ] **NEW:** Zod validation rejects invalid API keys
- [ ] **NEW:** Zod validation rejects invalid provider IDs
- [ ] PrivacySanitizer removes GPS coordinates
- [ ] PrivacySanitizer removes addresses
- [ ] LiteLLMProvider builds correct prompt
- [ ] **NEW:** LiteLLMProvider calls preprocessing service
- [ ] **NEW:** LiteLLMResponseSchema validates LLM output

### Integration Tests
- [ ] LiteLLM starts and responds to health checks
- [ ] Extraction routes through LiteLLM proxy
- [ ] Fallback chain works (Ollama → cloud)
- [ ] API keys stored/retrieved securely
- [ ] **NEW:** spaCy preprocessing runs before LLM call
- [ ] **NEW:** Cost tracking returns data from LiteLLM
- [ ] **NEW:** Existing Ollama configs still work after migration

### Manual Testing
- [ ] Add Anthropic API key via UI
- [ ] Test extraction with local Ollama
- [ ] Test extraction with cloud provider
- [ ] Verify privacy sanitization in cloud requests
- [ ] Verify cost tracking in LiteLLM logs
- [ ] **NEW:** Verify cost dashboard shows spend
- [ ] **NEW:** Verify profile extraction (people/companies)
- [ ] **NEW:** Verify existing extractions still work

---

## Final Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Electron Main Process                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────────┐     │
│  │  Extraction  │────────▶│   spaCy      │────────▶│    LiteLLM       │     │
│  │  Request     │         │   Preproc    │         │    Provider      │     │
│  └──────────────┘         └──────────────┘         └──────────────────┘     │
│                                  │                          │               │
│                                  ▼                          ▼               │
│                          ┌──────────────┐         ┌──────────────────┐     │
│                          │  NER Data    │         │  Privacy         │     │
│                          │  Entities    │         │  Sanitizer       │     │
│                          │  Verbs       │         │  (for cloud)     │     │
│                          └──────────────┘         └──────────────────┘     │
│                                                             │               │
│                                                             ▼               │
│  ┌──────────────┐                              ┌──────────────────────┐    │
│  │  Credential  │◀─────────────────────────────│   LiteLLM Proxy      │    │
│  │  Store       │   (writes API keys to        │   localhost:4000     │    │
│  │  (encrypted) │    config on start)          │                      │    │
│  └──────────────┘                              │  ┌────────────────┐  │    │
│                                                 │  │ Cost Tracking  │  │    │
│                                                 │  │ Rate Limiting  │  │    │
│                                                 │  │ Caching        │  │    │
│                                                 │  │ Fallbacks      │  │    │
│                                                 │  └────────────────┘  │    │
│                                                 └──────────────────────┘    │
│                                                             │               │
│                               ┌──────────────┬──────────────┼──────────┐   │
│                               ▼              ▼              ▼          ▼   │
│                        ┌──────────┐   ┌──────────┐   ┌──────────┐  ┌─────┐│
│                        │  Ollama  │   │Anthropic │   │  OpenAI  │  │Groq ││
│                        │  (local) │   │  (cloud) │   │  (cloud) │  │     ││
│                        └──────────┘   └──────────┘   └──────────┘  └─────┘│
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary of Audit Changes

| Original | Post-Audit |
|----------|------------|
| No input validation | Zod schemas for all IPC |
| No spaCy integration | spaCy preprocessing before LLM |
| Date extraction only | Combined date/profile extraction |
| No cost visibility | Cost dashboard in UI |
| Might break existing | Migration preserves Ollama configs |

---

**End of Implementation Plan**
