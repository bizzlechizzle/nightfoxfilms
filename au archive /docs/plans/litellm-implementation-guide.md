# LiteLLM Integration - Implementation Guide

**Version:** 1.0
**Date:** 2025-12-14
**Target Audience:** Junior-to-Mid Level Developers
**Estimated Implementation:** 7 Phases

---

## Overview

This guide walks through implementing LiteLLM as a unified AI gateway for the Abandoned Archive application. By the end, you'll have a production-ready system that:

1. Securely stores API keys using Electron's safeStorage
2. Manages LiteLLM proxy lifecycle (auto-start/stop)
3. Sanitizes sensitive data before sending to cloud providers
4. Integrates with the existing extraction pipeline
5. Provides a clean Settings UI for configuration

---

## Prerequisites

Before starting, ensure you understand:

- **Electron IPC**: Communication between main and renderer processes
- **TypeScript**: Strong typing for all new code
- **SQLite/Kysely**: Database operations
- **Svelte 5**: UI components with runes ($state, $derived)

### Codebase Patterns to Follow

| Pattern | Example File | Key Concept |
|---------|--------------|-------------|
| Lifecycle Service | `ollama-lifecycle-service.ts` | Singleton with idle timeout |
| IPC Handlers | `extraction.ts` | `ipcMain.handle()` with try/catch |
| Preload Bridge | `preload.cjs` | CommonJS only, `invokeAuto()` |
| Settings UI | `ExtractionSettings.svelte` | Provider management pattern |

---

## Phase 1: Credential Security

**Goal:** Securely store API keys using Electron's safeStorage.

### Why safeStorage?

- OS-level encryption (Keychain on macOS, DPAPI on Windows)
- Keys never stored in plaintext
- Keys only accessible to this app

### Step 1.1: Create Credential Service

**File:** `packages/desktop/electron/services/credential-service.ts`

```typescript
import { safeStorage } from 'electron';
import { getRawDatabase } from '../main/database';

// Store encrypted API keys
export async function storeCredential(provider: string, apiKey: string): Promise<void>

// Retrieve decrypted API key (main process only)
export async function retrieveCredential(provider: string): Promise<string | null>

// Check if credential exists
export async function hasCredential(provider: string): Promise<boolean>

// Delete credential
export async function deleteCredential(provider: string): Promise<void>

// List all providers with stored credentials
export async function listCredentialProviders(): Promise<string[]>
```

### Step 1.2: Add Database Migration

**File:** `packages/desktop/electron/main/database.ts`

Add Migration 85 to create the `credentials` table:

```sql
CREATE TABLE credentials (
  provider TEXT PRIMARY KEY,
  encrypted_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);
```

### Step 1.3: Create IPC Handlers

**File:** `packages/desktop/electron/main/ipc-handlers/credentials.ts`

Channels:
- `credentials:store` - Store encrypted API key
- `credentials:has` - Check if provider has key
- `credentials:delete` - Remove key
- `credentials:list` - List providers with keys

**IMPORTANT:** Never expose `credentials:retrieve` to renderer - keys stay in main process.

### Step 1.4: Add Zod Validation

**File:** `packages/desktop/electron/main/ipc-handlers/litellm-validation.ts`

```typescript
export const StoreCredentialSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google', 'groq']),
  apiKey: z.string().min(10).max(200),
});
```

---

## Phase 2: LiteLLM Lifecycle Service

**Goal:** Manage LiteLLM proxy as a subprocess with auto-start/stop.

### Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌───────────────┐
│  Extraction     │───▶│  LiteLLM         │───▶│  LiteLLM      │
│  Request        │    │  Lifecycle       │    │  Proxy        │
│                 │    │  Service         │    │  :4000        │
└─────────────────┘    └──────────────────┘    └───────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │  Credential      │
                       │  Service         │
                       │  (for config)    │
                       └──────────────────┘
```

### Step 2.1: Create Lifecycle Service

**File:** `packages/desktop/electron/services/litellm-lifecycle-service.ts`

Follow the `ollama-lifecycle-service.ts` pattern:

```typescript
// State management
let litellmProcess: ChildProcess | null = null;
let weStartedIt = false;
let idleTimer: NodeJS.Timeout | null = null;

// Core functions
export async function isLiteLLMInstalled(): Promise<boolean>
export async function isLiteLLMRunning(): Promise<boolean>
export async function startLiteLLM(): Promise<boolean>
export function stopLiteLLM(): void
export async function ensureLiteLLMRunning(): Promise<boolean>
export function resetIdleTimer(): void
export async function getLiteLLMStatus(): Promise<LiteLLMStatus>
```

### Step 2.2: Config File Generation

The service must generate a LiteLLM config from stored credentials:

```typescript
async function generateConfig(): Promise<string> {
  const credService = getCredentialService();

  const models = [];

  // Always add local Ollama
  models.push({
    model_name: 'extraction-local',
    litellm_params: {
      model: 'ollama/qwen2.5:7b',
      api_base: 'http://localhost:11434',
    },
  });

  // Add cloud providers if keys exist
  if (await hasCredential('anthropic')) {
    models.push({
      model_name: 'extraction-cloud',
      litellm_params: {
        model: 'claude-3-5-sonnet-20241022',
        api_key: await retrieveCredential('anthropic'),
      },
    });
  }

  return JSON.stringify({ model_list: models }, null, 2);
}
```

### Step 2.3: IPC Handlers

**File:** `packages/desktop/electron/main/ipc-handlers/litellm.ts`

Channels:
- `litellm:status` - Get proxy status
- `litellm:start` - Start proxy
- `litellm:stop` - Stop proxy
- `litellm:reload` - Regenerate config and restart
- `litellm:test` - Test a model
- `litellm:costs` - Get usage costs from LiteLLM

---

## Phase 3: Privacy Sanitizer

**Goal:** Remove sensitive data before sending to cloud providers.

### What to Redact

| Data Type | Pattern | Replacement |
|-----------|---------|-------------|
| GPS Coordinates | `-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}` | `[GPS_REDACTED]` |
| Street Addresses | `\d+\s+\w+\s+(Street|St|Ave|...)` | `[ADDRESS_REDACTED]` |
| ZIP Codes | `\d{5}(-\d{4})?` | `[ZIP_REDACTED]` |

### Step 3.1: Create Sanitizer Service

**File:** `packages/desktop/electron/services/privacy-sanitizer.ts`

```typescript
export interface PrivacySettings {
  enabled: boolean;
  redactGps: boolean;
  redactAddresses: boolean;
  excludedLocationIds: string[];
}

export function sanitizeForCloud(text: string, settings: PrivacySettings): string
export function isLocationExcluded(locId: string, settings: PrivacySettings): boolean
export async function getPrivacySettings(): Promise<PrivacySettings>
```

### Usage in Provider

```typescript
// In LiteLLMProvider.extract()
const privacySettings = await getPrivacySettings();
const isCloud = !modelName.includes('local');

let textToProcess = input.text;
if (isCloud && privacySettings.enabled) {
  textToProcess = sanitizeForCloud(input.text, privacySettings);
}
```

---

## Phase 4: Extraction Service Integration

**Goal:** Add LiteLLM as a provider in the extraction pipeline.

### Step 4.1: Create LiteLLM Provider

**File:** `packages/desktop/electron/services/extraction/providers/litellm-provider.ts`

Extend `BaseExtractionProvider`:

```typescript
export class LiteLLMProvider extends BaseExtractionProvider {
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
    // 1. Ensure LiteLLM running
    // 2. Call spaCy preprocessing (if available)
    // 3. Apply privacy sanitization (for cloud)
    // 4. Build prompt from versioned prompts
    // 5. Call LiteLLM proxy
    // 6. Parse and validate response
  }

  async getModelInfo(): Promise<{ name: string }> {
    return { name: this.config.settings.cloudModel || 'extraction-local' };
  }
}
```

### Step 4.2: Register Provider Type

**File:** `packages/desktop/electron/services/extraction/extraction-service.ts`

```typescript
// In getProviderInstance()
case 'litellm':
  return new LiteLLMProvider(config);
```

### Step 4.3: Add spaCy Preprocessing

Call the existing preprocessing service before LLM:

```typescript
import { getPreprocessingService } from '../preprocessing-service';

// In extract()
let preprocessedData = input.preprocessedData;
if (!preprocessedData && input.text.length > 100) {
  const service = getPreprocessingService();
  preprocessedData = await service.preprocess(input.text);
}
```

---

## Phase 5: Settings UI

**Goal:** Build a Braun-design-compliant settings panel.

### Design Requirements

- 4px border radius (`rounded`)
- 8pt grid spacing
- `braun-*` color classes
- Functional minimalism

### Step 5.1: Create AISettingsPanel Component

**File:** `packages/desktop/src/components/AISettingsPanel.svelte`

Sections:
1. **AI Gateway Status** - LiteLLM running/stopped indicator
2. **LLM Providers** - List with add/remove/test
3. **Usage & Costs** - Cost dashboard from LiteLLM
4. **Privacy Controls** - Checkboxes for sanitization options

### Step 5.2: Add to Settings Page

**File:** `packages/desktop/src/pages/Settings.svelte`

```svelte
<script>
  import AISettingsPanel from '../components/AISettingsPanel.svelte';
  let aiExpanded = $state(false);
</script>

<!-- Add accordion section -->
<div class="border border-braun-200 rounded">
  <button onclick={() => aiExpanded = !aiExpanded}>
    AI Models
  </button>
  {#if aiExpanded}
    <AISettingsPanel />
  {/if}
</div>
```

---

## Phase 6: Preload & Types

**Goal:** Expose new IPC channels to renderer.

### Step 6.1: Update Preload Bridge

**File:** `packages/desktop/electron/preload/preload.cjs`

**CRITICAL:** This MUST be CommonJS. No `import` statements.

```javascript
// Add to api object
litellm: {
  status: () => invokeAuto("litellm:status")(),
  start: () => invokeAuto("litellm:start")(),
  stop: () => invokeAuto("litellm:stop")(),
  reload: () => invokeAuto("litellm:reload")(),
  test: (model) => invokeLong("litellm:test")(model),
  costs: () => invokeAuto("litellm:costs")(),
},

credentials: {
  store: (provider, key) => invokeAuto("credentials:store")(provider, key),
  has: (provider) => invokeAuto("credentials:has")(provider),
  delete: (provider) => invokeAuto("credentials:delete")(provider),
  list: () => invokeAuto("credentials:list")(),
},
```

### Step 6.2: Update Type Definitions

**File:** `packages/desktop/src/types/electron.d.ts`

```typescript
interface LiteLLMStatus {
  installed: boolean;
  running: boolean;
  managedByApp: boolean;
  port: number;
  lastError: string | null;
}

interface ElectronAPI {
  litellm: {
    status(): Promise<{ success: boolean; status: LiteLLMStatus }>;
    start(): Promise<{ success: boolean; error?: string }>;
    stop(): Promise<{ success: boolean }>;
    reload(): Promise<{ success: boolean }>;
    test(model: string): Promise<{ success: boolean; response?: string; error?: string }>;
    costs(): Promise<{ success: boolean; costs?: CostData; error?: string }>;
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

## Phase 7: Register & Cleanup

**Goal:** Wire everything together and handle app lifecycle.

### Step 7.1: Register Handlers

**File:** `packages/desktop/electron/main/ipc-handlers/index.ts`

```typescript
import { registerCredentialHandlers } from './credentials';
import { registerLiteLLMHandlers, shutdownLiteLLM } from './litellm';

export function registerIpcHandlers() {
  // ... existing handlers ...

  registerCredentialHandlers();
  registerLiteLLMHandlers();
}

// Export for app cleanup
export { shutdownLiteLLM };
```

### Step 7.2: App Lifecycle Cleanup

**File:** `packages/desktop/electron/main/index.ts`

```typescript
import { shutdownLiteLLM } from './ipc-handlers';

app.on('before-quit', () => {
  shutdownLiteLLM();
});
```

---

## Testing Checklist

### Unit Tests

- [ ] CredentialService encrypts/decrypts correctly
- [ ] PrivacySanitizer removes GPS patterns
- [ ] PrivacySanitizer removes address patterns
- [ ] Zod validation rejects invalid API keys

### Integration Tests

- [ ] LiteLLM starts and responds to health
- [ ] Credential stored → config includes API key
- [ ] Privacy sanitization applied for cloud models
- [ ] Cost tracking returns data

### Manual Testing

- [ ] Add API key via UI
- [ ] Test local Ollama extraction
- [ ] Test cloud extraction
- [ ] Verify privacy sanitization
- [ ] Check cost dashboard updates

---

## Common Pitfalls

### 1. Preload ES Modules

**WRONG:**
```javascript
import { ipcRenderer } from 'electron';
```

**RIGHT:**
```javascript
const { ipcRenderer } = require('electron');
```

### 2. Missing Error Handling

**WRONG:**
```typescript
ipcMain.handle('channel', async () => {
  return await service.doThing();
});
```

**RIGHT:**
```typescript
ipcMain.handle('channel', async () => {
  try {
    const result = await service.doThing();
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

### 3. Exposing Keys to Renderer

**WRONG:**
```javascript
// In preload
credentials: {
  get: (provider) => ipcRenderer.invoke('credentials:get', provider),
}
```

**RIGHT:**
Keys should NEVER be exposed to renderer. Only main process accesses them.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Electron Main Process                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────────┐     │
│  │  Extraction  │────────▶│   spaCy      │────────▶│    LiteLLM       │     │
│  │  Request     │         │   Preproc    │         │    Provider      │     │
│  └──────────────┘         └──────────────┘         └──────────────────┘     │
│                                                             │               │
│                                                             ▼               │
│  ┌──────────────┐                              ┌──────────────────────┐    │
│  │  Credential  │◀─────────────────────────────│   LiteLLM Proxy      │    │
│  │  Service     │   (writes API keys to        │   localhost:4000     │    │
│  │  (encrypted) │    config on start)          └──────────────────────┘    │
│  └──────────────┘                                          │               │
│                               ┌──────────────┬─────────────┴───────────┐   │
│                               ▼              ▼                         ▼   │
│                        ┌──────────┐   ┌──────────┐              ┌─────────┐│
│                        │  Ollama  │   │Anthropic │              │  OpenAI ││
│                        │  (local) │   │  (cloud) │              │  (cloud)││
│                        └──────────┘   └──────────┘              └─────────┘│
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

| Phase | Files Created/Modified | New IPC Channels |
|-------|------------------------|------------------|
| 1 | credential-service.ts, credentials.ts, litellm-validation.ts | 4 |
| 2 | litellm-lifecycle-service.ts, litellm.ts | 6 |
| 3 | privacy-sanitizer.ts | 0 |
| 4 | litellm-provider.ts, extraction-service.ts | 0 |
| 5 | AISettingsPanel.svelte, Settings.svelte | 0 |
| 6 | preload.cjs, electron.d.ts | 0 |
| 7 | index.ts, main/index.ts | 0 |

**Total New Files:** 7
**Total Modified Files:** 5
**Total New IPC Channels:** 10

---

## Next Steps After Implementation

1. Run `pnpm build` to verify TypeScript compilation
2. Run `pnpm lint` to catch any style issues
3. Test manually with the app
4. Create git commit with proper message
5. Push to feature branch

---

**End of Implementation Guide**
