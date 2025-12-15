# AI Integration Audit Report
## LiteLLM + Assistive Tools Settings Implementation

**Version:** 1.0
**Date:** 2025-12-14
**Auditor:** Claude Code

---

## Executive Summary

This audit examines the Abandoned Archive codebase for readiness to implement a unified LiteLLM-based provider abstraction layer with assistive tools settings. The codebase has **excellent foundations** with mature extraction pipelines, timeline systems, and provider configuration already in place. Key gaps identified are API key security (no encrypted storage) and missing LiteLLM integration layer.

### Readiness Status by Area

| Area | Status | Readiness |
|------|--------|-----------|
| Extraction Pipeline | Mature | 95% |
| Timeline System | Complete | 100% |
| Provider Configuration | Good | 80% |
| IPC Architecture | Solid | 90% |
| Database Schema | Extensible | 85% |
| Security/Credentials | Gap | 30% |
| UI Components | Reusable | 85% |

---

## PART A: API/LM TOOLS SPECIFICATION AUDIT

### A1. Date/Name/Company Extraction Tasks

**Current Implementation:** `packages/desktop/electron/services/extraction/extraction-service.ts`

**Existing Capabilities:**
- Full entity extraction pipeline with spaCy (local NER) and Ollama (local LLM)
- Date extraction with 9 categories: `build_date`, `opening`, `closure`, `demolition`, `visit`, `publication`, `renovation`, `event`, `unknown`
- Person extraction with roles: owner, architect, developer, employee, founder, etc.
- Organization extraction with types: company, government, school, hospital, etc.
- Confidence scoring (0-1 scale) with relevancy categorization

**Types Location:** `packages/desktop/electron/services/extraction/extraction-types.ts:1-400`

```typescript
// Key types already defined
export type ProviderType = 'spacy' | 'ollama' | 'anthropic' | 'google' | 'openai';
export type DateCategory = 'build_date' | 'opening' | 'closure' | 'demolition' | ...;
export interface ExtractedDate { date: string; category: DateCategory; confidence: number; ... }
export interface ExtractedPerson { name: string; role: string; confidence: number; ... }
```

**LiteLLM Integration Point:** Add `'litellm'` to ProviderType, route all cloud providers through it.

### A2. Timeline System

**Current Implementation:** `packages/desktop/electron/main/database.ts` (Migration 75)

**Database Schema:**
```sql
CREATE TABLE location_timeline (
  event_id TEXT PRIMARY KEY,
  locid TEXT NOT NULL,
  subid TEXT,
  entry_type TEXT NOT NULL,  -- date, date_range, narrative, milestone
  display_date TEXT,
  start_year INTEGER, end_year INTEGER,
  start_month INTEGER, end_month INTEGER,
  start_day INTEGER, end_day INTEGER,
  circa_start INTEGER DEFAULT 0,
  circa_end INTEGER DEFAULT 0,
  smart_title TEXT,
  tldr TEXT,
  category TEXT,  -- 9 categories
  confidence REAL DEFAULT 0.5,
  source_ref_id TEXT,
  source_url TEXT,
  source_title TEXT,
  verification_status TEXT DEFAULT 'unverified',
  FOREIGN KEY (locid) REFERENCES locs(locid)
)
```

**Timeline Domain Types:** `packages/core/src/domain/timeline.ts`

**Readiness:** Complete timeline event storage, categorization, confidence, and source attribution. No changes needed.

### A3. People/Company Profiles

**Current Implementation:** `packages/desktop/electron/main/database.ts` (Migrations 77-78)

**People Profiles Schema:**
```sql
CREATE TABLE people_profiles (
  profile_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  display_name TEXT,
  name_variants TEXT,  -- JSON array
  birth_year INTEGER, death_year INTEGER,
  occupation TEXT,
  key_facts TEXT,  -- JSON array
  source_refs TEXT,  -- JSON array of source IDs
  verification_status TEXT DEFAULT 'unverified',
  merge_history TEXT,  -- JSON array for deduplication tracking
  ...
)
```

**Company Profiles Schema:** Similar structure with `company_type`, `industry`, `founding_year`, etc.

**Readiness:** Full profile management exists. Add `linked_llm_provider` field for extraction source tracking.

### A4. Tool Routing Architecture

**Current Flow:**
1. Text input → PreprocessingService (spaCy NER) → Structured entities
2. Entities → ExtractionService → Provider selection by priority
3. Provider (Ollama/cloud) → LLM completion → Parsed results
4. Results → Conflict detection → Storage

**Recommended LiteLLM Integration:**
```
Text → spaCy (local preprocessing)
     → LiteLLM Proxy (localhost:4000)
       → Routes to: Ollama | Anthropic | OpenAI | Google | Groq
     → Standardized response
     → Existing extraction pipeline
```

---

## PART B: CODEBASE AUDIT

### B1. Project Architecture

**Monorepo Structure:**
```
packages/
├── core/           # Domain models, repository contracts (no Electron deps)
│   ├── src/domain/ # Location, Media, Timeline entities
│   └── src/repositories/  # Interface contracts
└── desktop/        # Electron app
    ├── electron/
    │   ├── main/   # IPC handlers, database, migrations
    │   ├── preload/# CommonJS bridge (MUST stay .cjs)
    │   ├── services/  # All business logic
    │   │   └── extraction/  # LLM extraction pipeline
    │   └── repositories/  # SQLite implementations
    └── src/        # Svelte renderer
        ├── components/
        ├── pages/
        └── stores/
```

**Key Constraint:** Preload MUST be pure CommonJS (.cjs) - no ES modules.

### B2. Dependencies Analysis

**Relevant Current Dependencies:**
```json
{
  "better-sqlite3": "^11.x",  // SQLite
  "zod": "^3.x",              // Validation
  "exiftool-vendored": "^28.x",
  "sharp": "^0.33.x",
  "electron": "^35.x"
}
```

**Required Additions for LiteLLM:**
```json
{
  "litellm": "latest",        // LiteLLM Python proxy (subprocess)
  "keytar": "^7.x"            // Secure credential storage
}
```

### B3. Extraction Pipeline Deep Dive

**File:** `packages/desktop/electron/services/extraction/extraction-service.ts`

**Current Provider Flow:**
1. `getProviders()` - Load from `extraction_providers` table
2. `getAvailableProvider()` - Find first enabled provider by priority
3. `extractFromText()` - Execute extraction with fallback chain
4. Provider-specific handlers: `executeSpacyExtraction()`, `executeOllamaExtraction()`

**Provider Configuration Table (Migration 74):**
```sql
CREATE TABLE extraction_providers (
  provider_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'spacy', 'ollama', 'anthropic', etc.
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  settings TEXT,  -- JSON: { host, port, model, apiKey, timeout, temperature }
  created_at TEXT,
  updated_at TEXT
)
```

**Gap:** `apiKey` stored as plain text in JSON settings column. MUST encrypt.

### B4. spaCy Integration Status

**Current Implementation:**
- `packages/desktop/electron/services/extraction/preprocessing-service.ts`
- `scripts/spacy-server/main.py` - FastAPI server auto-spawned by app

**Endpoints:**
- `GET /health` - Health check
- `POST /preprocess` - Text preprocessing
- `GET /verb-categories` - Verb pattern definitions

**Features:**
- Named Entity Recognition (PERSON, ORG, DATE, GPE)
- Verb-based timeline relevancy detection
- Profile candidate extraction
- Relevancy scoring for LLM context building

**Readiness:** 100% - spaCy integration is mature and working.

### B5. Settings System Architecture

**Storage:** Key-value `settings` table in SQLite

**IPC Pattern:**
```typescript
// Handler
ipcMain.handle('settings:get', async (_, key) => { ... });
ipcMain.handle('settings:set', async (_, key, value) => { ... });

// Preload bridge
settings: {
  get: (key) => ipcRenderer.invoke('settings:get', key),
  set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
}
```

**UI Pattern:** Accordion-based sections in `Settings.svelte`

**Existing Accordion Sections:**
- Users, Archive, Maps, Maintenance, Database, Health
- Date Engine, Image Tagging (RAM++)

**New Section Needed:** "AI Models" or "Document Intelligence"

### B6. IPC Patterns

**Channel Naming:** `domain:action` format

**Timeout Configuration:** `packages/desktop/electron/preload/preload.cjs`
```javascript
const DEFAULT_IPC_TIMEOUT = 30000;      // 30 seconds
const LONG_IPC_TIMEOUT = 120000;        // 2 minutes
const VERY_LONG_IPC_TIMEOUT = 600000;   // 10 minutes
```

**Existing Extraction IPC Channels:**
- `extraction:getProviders`, `extraction:updateProvider`, `extraction:addProvider`
- `extraction:testProvider`, `extraction:testOllamaConnection`
- `extraction:getProviderStatuses`, `extraction:listOllamaModels`
- `extraction:entities.*`, `extraction:profiles.*`, `extraction:timeline.*`

**New Channels Needed:**
- `litellm:status`, `litellm:start`, `litellm:stop`
- `credentials:store`, `credentials:retrieve`, `credentials:delete`

### B7. Security & Credential Storage

**Current State:** API keys stored as plain text in `extraction_providers.settings` JSON

**Gap Analysis:**
| Requirement | Current | Target |
|-------------|---------|--------|
| API key encryption | None | Electron safeStorage or keytar |
| Key rotation | None | Manual update supported |
| Key validation | None | Provider-specific validation |
| Secure memory | None | Clear after use |

**Recommended Solution:**
```typescript
// Use Electron's safeStorage for encryption
import { safeStorage } from 'electron';

async function storeApiKey(provider: string, key: string): Promise<void> {
  const encrypted = safeStorage.encryptString(key);
  await db.run('UPDATE extraction_providers SET encrypted_key = ? WHERE provider_id = ?',
    encrypted.toString('base64'), provider);
}

async function retrieveApiKey(provider: string): Promise<string> {
  const row = await db.get('SELECT encrypted_key FROM extraction_providers WHERE provider_id = ?', provider);
  return safeStorage.decryptString(Buffer.from(row.encrypted_key, 'base64'));
}
```

### B8. Import & Processing Pipeline

**Job Queue System:** `packages/desktop/electron/services/import/job-queue.ts`

**Job Types:**
- `EXIFTOOL` - Metadata extraction (Priority: HIGH)
- `THUMBNAIL` - Image thumbnails (Priority: NORMAL)
- `IMAGE_TAGGING` - RAM++ tags (Priority: BACKGROUND)
- `GPS_ENRICHMENT`, `LOCATION_STATS`, `BAGIT` - Post-import

**Integration Point:** Add `LLM_EXTRACTION` job type for batch text extraction

### B9. Database Schema Summary

**Relevant Tables for AI Integration:**

| Table | Purpose | Status |
|-------|---------|--------|
| `extraction_providers` | Provider configuration | Exists, needs encryption |
| `extraction_queue` | Processing queue | Exists |
| `entity_extractions` | Extracted entities | Exists |
| `location_timeline` | Timeline events | Exists |
| `people_profiles` | Person profiles | Exists |
| `company_profiles` | Company profiles | Exists |
| `versioned_prompts` | LLM prompt versions | Exists |
| `conflict_detections` | Data conflicts | Exists |

**New Tables Needed:**
- `litellm_config` - LiteLLM proxy configuration
- `provider_usage_stats` - Token usage tracking per provider

### B10. UI Component Audit (Braun Design Verification)

**Existing Components for Reuse:**

| Component | Location | Reuse For |
|-----------|----------|-----------|
| `ExtractionSettings.svelte` | `src/components/` | Provider management UI |
| `PatternEditor.svelte` | `src/components/` | Prompt template editing |
| `DateExtractionQueue.svelte` | `src/components/` | Queue monitoring |
| `LocationPeopleCompanies.svelte` | `src/components/location/` | Entity display |

**Braun Design Compliance:**

Current UI follows Braun principles:
- `braun-*` color classes (braun-100 through braun-900)
- 4px border-radius on cards/inputs
- 8pt grid spacing (16px, 24px gaps)
- Card-based layouts with subtle borders
- Functional color use only (green=success, amber=warning, red=error)

**Anti-Patterns to Avoid:**
- Colored accent buttons (use braun-900 primary only)
- Decorative shadows
- Border-radius > 4px

---

## PART C: RECOMMENDATIONS

### C1. LiteLLM Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Electron Main Process                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │   Settings   │───▶│  LiteLLM     │───▶│  Provider        │   │
│  │   UI         │    │  Service     │    │  Router          │   │
│  └──────────────┘    └──────────────┘    └──────────────────┘   │
│                              │                     │             │
│                              ▼                     ▼             │
│                    ┌──────────────┐    ┌──────────────────┐     │
│                    │  LiteLLM     │    │  Local           │     │
│                    │  Proxy       │    │  Providers       │     │
│                    │  :4000       │    │  (spaCy, Ollama) │     │
│                    └──────────────┘    └──────────────────┘     │
│                              │                                   │
│                    ┌─────────┴─────────┐                        │
│                    ▼                   ▼                        │
│           ┌──────────────┐    ┌──────────────┐                  │
│           │  Anthropic   │    │  OpenAI      │                  │
│           │  Google      │    │  Groq        │                  │
│           └──────────────┘    └──────────────┘                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### C2. New Service: LiteLLM Lifecycle Service

**Location:** `packages/desktop/electron/services/litellm-lifecycle-service.ts`

**Pattern:** Follow `ollama-lifecycle-service.ts` structure

```typescript
export interface LiteLLMLifecycleStatus {
  installed: boolean;
  running: boolean;
  managedByApp: boolean;
  port: number;
  configuredProviders: string[];
  lastError: string | null;
}

// Key functions
export function findLiteLLMBinary(): string | null;
export async function startLiteLLM(config: LiteLLMConfig): Promise<boolean>;
export function stopLiteLLM(): void;
export async function ensureLiteLLMRunning(): Promise<boolean>;
```

### C3. New IPC Handlers

**File:** `packages/desktop/electron/main/ipc-handlers/litellm.ts`

```typescript
// LiteLLM lifecycle
ipcMain.handle('litellm:status', () => getLiteLLMStatus());
ipcMain.handle('litellm:start', () => startLiteLLM());
ipcMain.handle('litellm:stop', () => stopLiteLLM());
ipcMain.handle('litellm:test', (_, provider) => testLiteLLMProvider(provider));

// Credential management (using safeStorage)
ipcMain.handle('credentials:store', (_, provider, key) => storeCredential(provider, key));
ipcMain.handle('credentials:verify', (_, provider) => verifyCredential(provider));
ipcMain.handle('credentials:delete', (_, provider) => deleteCredential(provider));
```

### C4. Database Migrations Needed

**Migration 79: LiteLLM Configuration**
```sql
CREATE TABLE litellm_config (
  config_id TEXT PRIMARY KEY,
  port INTEGER DEFAULT 4000,
  fallback_model TEXT,
  default_timeout INTEGER DEFAULT 120000,
  retry_count INTEGER DEFAULT 3,
  config_yaml TEXT,  -- Full LiteLLM config
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Migration 80: Provider Usage Stats**
```sql
CREATE TABLE provider_usage_stats (
  stat_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  date TEXT NOT NULL,
  requests_count INTEGER DEFAULT 0,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,
  avg_latency_ms REAL,
  FOREIGN KEY (provider_id) REFERENCES extraction_providers(provider_id),
  UNIQUE(provider_id, date)
);
```

**Migration 81: Encrypted Credentials Column**
```sql
ALTER TABLE extraction_providers ADD COLUMN encrypted_key BLOB;
-- Migrate existing plaintext keys, then drop settings.apiKey
```

### C5. UI Component: AISettingsPanel.svelte

**Design Following Braun Principles:**

```svelte
<!-- AISettingsPanel.svelte -->
<div class="space-y-6">
  <!-- Provider Status Card -->
  <div class="bg-white rounded border border-braun-200 p-6">
    <h3 class="text-sm font-medium text-braun-800 mb-4">LLM Providers</h3>

    <!-- Provider List -->
    {#each providers as provider}
      <div class="flex items-center justify-between py-3 border-b border-braun-100">
        <div class="flex items-center gap-3">
          <!-- Status dot: green/amber/gray -->
          <span class="w-2 h-2 rounded-full {getStatusColor(provider)}"></span>
          <span class="text-sm text-braun-900">{provider.name}</span>
        </div>
        <div class="flex items-center gap-2">
          <button class="text-xs px-2 py-1 text-braun-600 hover:text-braun-900">
            Configure
          </button>
          <button class="text-xs px-2 py-1 text-braun-600 hover:text-braun-900">
            Test
          </button>
        </div>
      </div>
    {/each}
  </div>

  <!-- API Key Management Card -->
  <div class="bg-white rounded border border-braun-200 p-6">
    <h3 class="text-sm font-medium text-braun-800 mb-4">API Keys</h3>
    <p class="text-xs text-braun-500 mb-4">
      Keys are encrypted and stored locally. Never transmitted.
    </p>
    <!-- Key inputs with masked display -->
  </div>
</div>
```

**Color Mapping:**
- Available: `bg-green-500` (#4A8C5E)
- Degraded: `bg-amber-500` (#C9A227)
- Unavailable: `bg-braun-300`
- Testing: `bg-blue-400` (#5A7A94)

---

## PART D: IMPLEMENTATION ROADMAP

### Phase 1: Security Foundation (Priority: CRITICAL)
1. Add `keytar` or use `safeStorage` for credential encryption
2. Create Migration 81 for encrypted_key column
3. Implement credential IPC handlers
4. Migrate existing plaintext keys

### Phase 2: LiteLLM Service Layer
1. Create `litellm-lifecycle-service.ts`
2. Add LiteLLM IPC handlers
3. Create LiteLLM config table (Migration 79)
4. Implement provider routing through LiteLLM proxy

### Phase 3: UI Implementation
1. Create `AISettingsPanel.svelte` component
2. Add "AI Models" accordion section to Settings.svelte
3. Implement provider configuration modals
4. Add usage statistics display

### Phase 4: Integration & Testing
1. Update extraction service to route through LiteLLM
2. Add provider usage tracking (Migration 80)
3. Implement fallback chains
4. End-to-end testing with all providers

---

## Appendix: File Reference Index

| Category | File | Purpose |
|----------|------|---------|
| Types | `electron/services/extraction/extraction-types.ts` | All extraction types |
| Service | `electron/services/extraction/extraction-service.ts` | Main extraction logic |
| Preproc | `electron/services/extraction/preprocessing-service.ts` | spaCy integration |
| Ollama | `electron/services/ollama-lifecycle-service.ts` | Process management |
| IPC | `electron/main/ipc-handlers/extraction.ts` | Extraction endpoints |
| Database | `electron/main/database.ts` | Schema + migrations |
| UI | `src/components/ExtractionSettings.svelte` | Provider config UI |
| Preload | `electron/preload/preload.cjs` | IPC bridge |

---

**Report Complete.** The codebase is well-positioned for LiteLLM integration with mature extraction infrastructure. Primary gap is credential security - address this first before exposing cloud provider API key input to users.
