# AI Integration - Gaps, Best Practices & Feature Ideas

**Supplement to:** `ai-integration-audit-report.md`
**Date:** 2025-12-14

---

## PART 1: What I Missed in the Initial Audit

### 1.1 No LLM Response Caching

**Gap:** The codebase has excellent geocoding cache (`geocoding-cache.ts`) but **no equivalent for LLM responses**.

**Impact:**
- Repeated extractions on same text = repeated API costs
- Slow re-processing when user re-runs extraction
- No deduplication of identical queries

**Recommendation:**
```sql
CREATE TABLE llm_response_cache (
  cache_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,  -- SHA256 of system+user prompt
  input_hash TEXT NOT NULL,   -- BLAKE3 of input text
  response_json TEXT NOT NULL,
  token_count_input INTEGER,
  token_count_output INTEGER,
  created_at TEXT,
  expires_at TEXT,  -- TTL-based expiration
  hit_count INTEGER DEFAULT 0
);
CREATE INDEX idx_llm_cache_lookup ON llm_response_cache(provider, prompt_hash, input_hash);
```

**Cache Strategy:**
- Cache by `(provider, model, prompt_version, input_text_hash)`
- Default TTL: 30 days (historical data doesn't change)
- Invalidate on prompt version change
- LRU eviction when cache exceeds size limit

---

### 1.2 No Rate Limiting / Quota Management

**Gap:** `base-provider.ts` has timeout handling but **no rate limiting**.

**Impact:**
- Cloud APIs will reject requests if you hit too fast
- No protection against runaway batch jobs draining budget
- User has no visibility into API limits

**Recommendation:**
```typescript
// Add to base-provider.ts or new rate-limiter.ts
interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerDay: number;
  tokensPerMinute?: number;
  tokensPerDay?: number;
  concurrentRequests: number;
}

const PROVIDER_LIMITS: Record<string, RateLimitConfig> = {
  anthropic: { requestsPerMinute: 50, requestsPerDay: 10000, concurrentRequests: 5 },
  openai: { requestsPerMinute: 60, requestsPerDay: 10000, concurrentRequests: 10 },
  ollama: { requestsPerMinute: 999, requestsPerDay: 999999, concurrentRequests: 2 }, // Local
  google: { requestsPerMinute: 60, requestsPerDay: 1500, concurrentRequests: 5 },
};
```

**Implementation Pattern:**
- Token bucket algorithm for smooth rate limiting
- Queue requests when near limit
- Expose remaining quota to UI
- Alert when approaching daily limit

---

### 1.3 No Cost Tracking / Budget Alerts

**Gap:** No tracking of API costs or budget limits.

**Impact:**
- User has no idea how much they're spending
- No warning before expensive operations
- Can't compare cost-effectiveness of providers

**Recommendation:**
```sql
-- Migration: Provider cost tracking
CREATE TABLE provider_costs (
  cost_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  date TEXT NOT NULL,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  requests_count INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0,
  FOREIGN KEY (provider_id) REFERENCES extraction_providers(provider_id)
);

-- Add budget settings
INSERT INTO settings (key, value) VALUES
  ('ai_daily_budget_usd', '5.00'),
  ('ai_monthly_budget_usd', '50.00'),
  ('ai_budget_alert_threshold', '0.8'); -- Alert at 80%
```

**Cost Estimation (per 1K tokens, approximate):**
| Provider | Input | Output |
|----------|-------|--------|
| Claude Sonnet | $0.003 | $0.015 |
| Claude Haiku | $0.00025 | $0.00125 |
| GPT-4o | $0.005 | $0.015 |
| GPT-4o-mini | $0.00015 | $0.0006 |
| Ollama (local) | $0 | $0 |

---

### 1.4 No Retry Logic with Exponential Backoff

**Gap:** `fetchWithTimeout` exists but no retry on transient failures.

**Current Code (`base-provider.ts:180`):**
```typescript
protected async fetchWithTimeout(url: string, options: RequestInit, timeoutMs?: number): Promise<Response> {
  // Just times out, no retry
}
```

**Recommendation:**
```typescript
protected async fetchWithRetry(
  url: string,
  options: RequestInit,
  config: { maxRetries?: number; baseDelayMs?: number; timeoutMs?: number } = {}
): Promise<Response> {
  const { maxRetries = 3, baseDelayMs = 1000, timeoutMs = this.getTimeout() } = config;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await this.fetchWithTimeout(url, options, timeoutMs);
    } catch (error) {
      const isRetryable = error.name === 'AbortError' ||
                          (error.status >= 500 && error.status < 600) ||
                          error.status === 429; // Rate limited

      if (!isRetryable || attempt === maxRetries) throw error;

      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
      this.log('warn', `Retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

---

### 1.5 No Streaming Support

**Gap:** All LLM calls are synchronous request/response. No streaming.

**Impact:**
- User sees nothing until entire response completes (can be 30+ seconds)
- Poor UX for long extractions
- Can't cancel mid-generation

**Recommendation:**
Add streaming IPC pattern:
```typescript
// Main process
ipcMain.handle('extraction:streamExtract', async (event, input) => {
  const stream = await provider.extractStreaming(input);

  for await (const chunk of stream) {
    event.sender.send('extraction:chunk', {
      requestId: input.requestId,
      chunk: chunk.content,
      done: false
    });
  }

  event.sender.send('extraction:chunk', { requestId: input.requestId, done: true });
});

// Preload
extraction: {
  streamExtract: (input) => ipcRenderer.invoke('extraction:streamExtract', input),
  onChunk: (callback) => ipcRenderer.on('extraction:chunk', (_, data) => callback(data)),
}
```

---

### 1.6 No Privacy Controls

**Gap:** No user control over what data gets sent to cloud providers.

**Impact:**
- Sensitive location data (GPS, addresses) could be sent to cloud
- No opt-out for specific locations
- Compliance concerns for research data

**Recommendation:**
```typescript
interface PrivacySettings {
  allowCloudProviders: boolean;          // Master switch
  redactGpsBeforeSending: boolean;       // Strip coordinates
  redactAddressesBeforeSending: boolean; // Strip addresses
  excludedLocationIds: string[];         // Per-location opt-out
  localOnlyKeywords: string[];           // e.g., ["military", "federal"]
}

// Sanitizer before sending to cloud
function sanitizeForCloud(text: string, settings: PrivacySettings): string {
  if (settings.redactGpsBeforeSending) {
    text = text.replace(/\d+\.\d+,\s*-?\d+\.\d+/g, '[GPS_REDACTED]');
  }
  if (settings.redactAddressesBeforeSending) {
    text = text.replace(/\d+\s+\w+\s+(Street|St|Avenue|Ave|Road|Rd|Blvd|Lane|Ln)/gi, '[ADDRESS_REDACTED]');
  }
  return text;
}
```

---

### 1.7 No A/B Testing Framework

**Gap:** Versioned prompts exist (`versioned-prompts.ts`) but no A/B testing framework.

**Current:** Version selection is manual. No way to compare v1.0 vs v2.0 performance.

**Recommendation:**
```sql
CREATE TABLE prompt_ab_tests (
  test_id TEXT PRIMARY KEY,
  prompt_type TEXT NOT NULL,
  version_a TEXT NOT NULL,
  version_b TEXT NOT NULL,
  traffic_split REAL DEFAULT 0.5,  -- 50/50 by default
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'active'
);

CREATE TABLE prompt_ab_results (
  result_id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL,
  version TEXT NOT NULL,
  extraction_id TEXT NOT NULL,
  -- Quality metrics
  dates_extracted INTEGER,
  dates_correct INTEGER,  -- After human review
  people_extracted INTEGER,
  processing_time_ms INTEGER,
  user_accepted BOOLEAN,
  FOREIGN KEY (test_id) REFERENCES prompt_ab_tests(test_id)
);
```

---

### 1.8 No User Feedback Loop

**Gap:** No way for users to rate extraction quality or correct mistakes.

**Impact:**
- Can't improve prompts based on real usage
- No ground truth for accuracy measurement
- Users can reject bad extractions but system doesn't learn

**Recommendation:**
Add feedback UI to extraction results:
```svelte
<!-- ExtractionFeedback.svelte -->
<div class="flex items-center gap-2 mt-2">
  <span class="text-xs text-braun-500">Was this extraction helpful?</span>
  <button onclick={() => submitFeedback('good')} class="text-green-600 hover:text-green-700">
    <ThumbsUp size={14} />
  </button>
  <button onclick={() => submitFeedback('bad')} class="text-red-600 hover:text-red-700">
    <ThumbsDown size={14} />
  </button>
</div>
```

```sql
CREATE TABLE extraction_feedback (
  feedback_id TEXT PRIMARY KEY,
  extraction_id TEXT NOT NULL,
  rating TEXT NOT NULL,  -- 'good', 'bad', 'partial'
  correction_json TEXT,  -- User-provided corrections
  prompt_version TEXT,
  provider TEXT,
  created_at TEXT
);
```

---

## PART 2: Best Practices to Implement

### 2.1 Model Context Window Management

**Best Practice:** Track and respect context window limits.

```typescript
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-3-5-sonnet': 200000,
  'claude-3-haiku': 200000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'qwen2.5:7b': 32768,
  'qwen2.5:32b': 32768,
  'llama3.1:8b': 8192,
};

function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters for English
  return Math.ceil(text.length / 4);
}

function truncateToFit(text: string, model: string, reserveForOutput: number = 4096): string {
  const limit = MODEL_CONTEXT_LIMITS[model] || 8192;
  const maxInputTokens = limit - reserveForOutput;
  const currentTokens = estimateTokens(text);

  if (currentTokens <= maxInputTokens) return text;

  // Truncate from middle, keeping start and end
  const targetChars = maxInputTokens * 4;
  const keepStart = Math.floor(targetChars * 0.6);
  const keepEnd = Math.floor(targetChars * 0.4);

  return text.slice(0, keepStart) + '\n\n[... truncated ...]\n\n' + text.slice(-keepEnd);
}
```

---

### 2.2 Graceful Degradation Chain

**Best Practice:** Define clear fallback order.

```typescript
const PROVIDER_FALLBACK_CHAIN = [
  { provider: 'ollama-local', reason: 'Local, fast, free' },
  { provider: 'ollama-network', reason: 'Network GPU, free' },
  { provider: 'claude-haiku', reason: 'Fast, cheap cloud' },
  { provider: 'gpt-4o-mini', reason: 'Cheap cloud fallback' },
  { provider: 'claude-sonnet', reason: 'High quality, expensive' },
  { provider: 'spacy-only', reason: 'Offline NER only (degraded)' },
];

async function extractWithFallback(input: ExtractionInput): Promise<ExtractionResult> {
  for (const { provider, reason } of PROVIDER_FALLBACK_CHAIN) {
    const p = getProvider(provider);
    if (!p || !await p.isAvailable()) continue;

    try {
      return await p.extract(input);
    } catch (error) {
      console.warn(`Provider ${provider} failed, trying next: ${error.message}`);
    }
  }

  throw new Error('All providers failed');
}
```

---

### 2.3 Structured Output Validation

**Best Practice:** Validate LLM JSON output strictly.

```typescript
import { z } from 'zod';

const ExtractedDateSchema = z.object({
  rawText: z.string().min(1),
  parsedDate: z.string().regex(/^\d{4}(-\d{2})?(-\d{2})?$/),
  category: z.enum(['build_date', 'opening', 'closure', 'demolition', 'visit', 'publication', 'renovation', 'event', 'unknown']),
  confidence: z.number().min(0).max(1),
  verb: z.string().min(1), // REQUIRED - no orphan dates
});

const ExtractionResponseSchema = z.object({
  dates: z.array(ExtractedDateSchema),
  people: z.array(ExtractedPersonSchema).optional(),
  organizations: z.array(ExtractedOrgSchema).optional(),
});

function parseAndValidate(llmOutput: string): ExtractionResult {
  // Strip markdown code blocks if present
  const cleaned = llmOutput.replace(/^```json\n?|\n?```$/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    return ExtractionResponseSchema.parse(parsed);
  } catch (error) {
    throw new Error(`Invalid LLM response: ${error.message}`);
  }
}
```

---

### 2.4 Audit Trail for Compliance

**Best Practice:** Log all LLM interactions for audit.

```sql
CREATE TABLE llm_audit_log (
  log_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT,
  input_text_preview TEXT,  -- First 500 chars
  input_token_count INTEGER,
  output_token_count INTEGER,
  latency_ms INTEGER,
  success BOOLEAN,
  error_message TEXT,
  user_id TEXT,
  location_id TEXT,
  request_source TEXT  -- 'manual', 'batch', 'auto'
);
```

---

### 2.5 Health Dashboard

**Best Practice:** Real-time visibility into AI system health.

```typescript
interface AIHealthDashboard {
  providers: Array<{
    id: string;
    status: 'healthy' | 'degraded' | 'down';
    latencyP50Ms: number;
    latencyP99Ms: number;
    errorRateLast24h: number;
    requestsLast24h: number;
  }>;
  queue: {
    pending: number;
    processing: number;
    failed: number;
    avgWaitTimeMs: number;
  };
  costs: {
    todayUsd: number;
    monthUsd: number;
    budgetRemainingUsd: number;
  };
  cache: {
    hitRate: number;
    entriesCount: number;
    sizeBytes: number;
  };
}
```

---

## PART 3: Feature Ideas

### 3.1 Smart Model Routing

**Concept:** Automatically choose the best model for each task.

```typescript
interface TaskComplexity {
  textLength: number;
  entityDensity: number;  // Entities per 100 words
  dateComplexity: number; // Ranges, circa dates, etc.
  languageComplexity: number; // Rare terms, OCR errors
}

function selectModelForTask(task: TaskComplexity): string {
  // Simple text → cheap model
  if (task.textLength < 500 && task.entityDensity < 2) {
    return 'gpt-4o-mini';
  }

  // Complex historical text → powerful model
  if (task.dateComplexity > 5 || task.languageComplexity > 0.3) {
    return 'claude-sonnet';
  }

  // Default → local Ollama
  return 'ollama-local';
}
```

---

### 3.2 Batch Processing Optimization

**Concept:** Intelligent batching for bulk extraction.

```typescript
interface BatchConfig {
  maxConcurrent: number;        // Parallel requests
  prioritizeByAge: boolean;     // Oldest first
  pauseOnErrorRate: number;     // Pause if >20% errors
  costLimitUsd: number;         // Stop when budget hit
  estimatedTimeMinutes: number; // Show ETA
}

async function processBatch(locationIds: string[], config: BatchConfig) {
  const queue = new PQueue({ concurrency: config.maxConcurrent });
  let processed = 0;
  let errors = 0;

  for (const locId of locationIds) {
    queue.add(async () => {
      try {
        await extractForLocation(locId);
        processed++;
      } catch {
        errors++;
        if (errors / processed > config.pauseOnErrorRate) {
          queue.pause();
          notifyUser('Batch paused due to high error rate');
        }
      }

      emitProgress({ processed, total: locationIds.length, errors });
    });
  }

  await queue.onIdle();
}
```

---

### 3.3 Extraction Confidence Calibration

**Concept:** Adjust confidence scores based on historical accuracy.

```typescript
interface CalibrationData {
  providerId: string;
  promptVersion: string;
  category: string;
  rawConfidence: number;
  wasCorrect: boolean; // From user feedback
}

function getCalibratedConfidence(
  rawConfidence: number,
  provider: string,
  category: string
): number {
  const calibration = loadCalibrationCurve(provider, category);

  // If provider tends to be overconfident, reduce scores
  // If underconfident, boost scores
  return calibration.adjust(rawConfidence);
}
```

---

### 3.4 Cross-Source Verification

**Concept:** Boost confidence when multiple sources agree.

```typescript
async function verifyAcrossSources(locId: string): Promise<VerifiedTimeline> {
  const sources = await getWebSourcesForLocation(locId);
  const allDates: ExtractedDate[] = [];

  for (const source of sources) {
    const extraction = await getExtractionForSource(source.id);
    allDates.push(...extraction.dates);
  }

  // Find dates mentioned in multiple sources
  const dateGroups = groupByYear(allDates);

  for (const [year, dates] of dateGroups) {
    const sourceCount = new Set(dates.map(d => d.sourceId)).size;

    if (sourceCount >= 2) {
      // Multiple sources agree → boost confidence
      dates.forEach(d => d.verifiedConfidence = Math.min(d.confidence * 1.3, 0.99));
    }
  }

  return mergeTimeline(allDates);
}
```

---

### 3.5 Local Model Fine-Tuning Support

**Concept:** Allow fine-tuning Ollama models on user's data.

```typescript
interface FineTuningJob {
  baseModel: string;           // e.g., 'qwen2.5:7b'
  outputModel: string;         // e.g., 'qwen2.5:7b-auarchive'
  trainingData: TrainingPair[];
  epochs: number;
  learningRate: number;
}

interface TrainingPair {
  input: string;              // Document text
  expectedOutput: string;     // Verified extraction JSON
  source: 'user_correction' | 'approved_extraction';
}

// Generate training data from approved extractions
async function generateTrainingData(minConfidence: number = 0.9): Promise<TrainingPair[]> {
  const approved = await db.selectFrom('entity_extractions')
    .where('status', '=', 'approved')
    .where('confidence', '>=', minConfidence)
    .selectAll()
    .execute();

  return approved.map(e => ({
    input: e.source_text,
    expectedOutput: e.extraction_json,
    source: 'approved_extraction'
  }));
}
```

---

### 3.6 Extraction Diff View

**Concept:** Show what changed between extraction runs.

```svelte
<!-- ExtractionDiff.svelte -->
<div class="grid grid-cols-2 gap-4">
  <div class="border border-braun-200 rounded p-4">
    <h4 class="text-sm font-medium text-braun-600 mb-2">Previous (v1.0)</h4>
    {#each previousDates as date}
      <div class="text-sm {!currentDates.includes(date) ? 'bg-red-50 line-through' : ''}">
        {date.parsedDate} - {date.category}
      </div>
    {/each}
  </div>

  <div class="border border-braun-200 rounded p-4">
    <h4 class="text-sm font-medium text-braun-600 mb-2">Current (v2.0)</h4>
    {#each currentDates as date}
      <div class="text-sm {!previousDates.includes(date) ? 'bg-green-50' : ''}">
        {date.parsedDate} - {date.category}
      </div>
    {/each}
  </div>
</div>
```

---

### 3.7 Model Comparison Tool

**Concept:** Run same extraction through multiple models and compare.

```typescript
async function compareModels(
  text: string,
  models: string[]
): Promise<ModelComparison> {
  const results = await Promise.all(
    models.map(async model => ({
      model,
      result: await extractWithModel(text, model),
      latencyMs: performance.now(),
      tokenCount: estimateTokens(text)
    }))
  );

  return {
    text: text.slice(0, 200) + '...',
    results,
    consensus: findConsensus(results),
    disagreements: findDisagreements(results)
  };
}
```

---

## Summary: Priority Additions

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| **P0** | Credential encryption | Medium | Security |
| **P0** | Rate limiting | Medium | Reliability |
| **P1** | LLM response cache | Medium | Cost/Performance |
| **P1** | Cost tracking | Medium | User visibility |
| **P1** | Retry with backoff | Low | Reliability |
| **P2** | Streaming responses | High | UX |
| **P2** | Privacy controls | Medium | Compliance |
| **P2** | User feedback loop | Medium | Quality |
| **P3** | A/B testing | High | Optimization |
| **P3** | Smart model routing | High | Cost/Quality |
| **P3** | Batch optimization | Medium | Throughput |

---

**End of Gaps & Features Document**
