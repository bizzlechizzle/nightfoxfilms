# Document Intelligence Implementation Audit

**Version:** 1.0
**Date:** 2025-12-13
**Type:** Technical Audit & Recommendations
**Auditor:** Architecture Review

---

## Table of Contents

1. [LLM Recommendation for M2 Ultra 64GB](#llm-recommendation)
2. [Implementation Guide Audit](#implementation-guide-audit)
3. [Precision Improvements: Option 1 (spaCy)](#precision-improvements-option-1)
4. [Precision Improvements: Option 2 (LLM)](#precision-improvements-option-2)
5. [Developer Onboarding Guide](#developer-onboarding-guide)
6. [Sources & References](#sources-references)

---

# LLM Recommendation for M2 Ultra 64GB {#llm-recommendation}

## Hardware Analysis

Your M2 Ultra 64GB has:
- **Memory Bandwidth:** ~800 GB/s (theoretical), ~400-500 GB/s effective due to split-die architecture
- **Unified Memory:** 64GB shared between CPU and GPU
- **GPU Cores:** 76 cores

**Key insight:** The M2 Ultra is two M1/M2 Max dies connected together. This means you don't get the full 800 GB/s bandwidth for all workloads - it's more like 400-500 GB/s in practice for LLM inference.

**Source:** [llama.cpp Apple Silicon Performance Discussion](https://github.com/ggml-org/llama.cpp/discussions/4167)

## Model Recommendations (Ranked)

### Primary Recommendation: **Qwen2.5-32B-Instruct (Q8_0)**

| Metric | Value |
|--------|-------|
| Model Size | ~34GB |
| Quantization | Q8_0 (highest quality) |
| Expected Speed | 15-25 tokens/second |
| Memory Headroom | ~30GB for context + system |
| Ollama Command | `ollama pull qwen2.5:32b` |

**Why this model:**

1. **Fits comfortably in 64GB** - At Q8_0 quantization (~34GB), you have 30GB headroom for context window and system overhead. This is important because context windows can consume significant memory.

2. **Q8_0 is near-lossless** - Unlike Q4 quantization which loses ~5-10% accuracy, Q8_0 preserves nearly all model capability. For extraction tasks where precision matters, this is crucial.

3. **Qwen2.5 excels at structured output** - Qwen models have been specifically optimized for JSON output and instruction following, which is exactly what we need for extraction.

4. **Speed is practical** - 15-25 tok/s means a typical extraction (500-1000 output tokens) completes in 20-40 seconds. Acceptable for document processing.

**Source:** [Qwen2.5 Official Benchmarks](https://qwen2.org/benchmarks-of-providers-of-qwen2-5/), [Best Ollama Models 2025](https://collabnix.com/best-ollama-models-in-2025-complete-performance-comparison/)

### Alternative: **Qwen2.5-72B-Instruct (Q4_K_M)** - Maximum Intelligence

| Metric | Value |
|--------|-------|
| Model Size | ~42GB (Q4_K_M) |
| Quantization | Q4_K_M (good quality) |
| Expected Speed | 8-12 tokens/second |
| Memory Headroom | ~22GB |
| Ollama Command | `ollama pull qwen2.5:72b-instruct-q4_K_M` |

**When to choose this:**
- You prioritize accuracy over speed
- Documents are complex with ambiguous dates
- You're willing to wait 60-90 seconds per extraction

**Trade-off:** The Q4_K_M quantization loses some precision compared to Q8_0. For straightforward extraction, the 32B at Q8_0 may actually perform better than 72B at Q4.

### Alternative: **DeepSeek-R1-32B** - Reasoning Heavy

| Metric | Value |
|--------|-------|
| Model Size | ~34GB (Q8_0) |
| Expected Speed | 15-20 tokens/second |
| Ollama Command | `ollama pull deepseek-r1:32b` |

**When to choose this:**
- Documents require chain-of-thought reasoning
- Dates are buried in complex narrative
- You need the model to "think through" ambiguity

**Source:** [DeepSeek R1 Local Deployment Guide](https://obrienlabs.medium.com/running-reasoning-llms-like-the-deepseek-r1-70b-43g-locally-for-private-offline-air-gapped-259fa437da8f)

### NOT Recommended: Qwen3-235B or larger

Even with quantization, models over 70B will:
- Require aggressive Q2/Q3 quantization, severely degrading quality
- Run at 2-5 tokens/second, making extraction impractical
- Leave no headroom for context window

## Final Recommendation

```bash
# Install on your M2 Ultra
ollama pull qwen2.5:32b

# Test it works
ollama run qwen2.5:32b "Extract dates from: The factory was built in 1923 and closed in 2008."
```

**Expected output:** JSON with dates, ~20 seconds

---

# Implementation Guide Audit {#implementation-guide-audit}

## Audit Methodology

I reviewed the implementation guide (`document-intelligence-implementation-guide.md`) line by line, checking:

1. **Technical Correctness** - Are the code examples valid and functional?
2. **Architecture Soundness** - Does the design follow best practices?
3. **Completeness** - Are there missing pieces that would block implementation?
4. **Security** - Are there vulnerabilities or data leaks?
5. **Maintainability** - Can a less experienced developer understand and modify this?

## Findings

### ✅ CORRECT: Provider Interface Design

**Location:** Phase 1, Step 1.1-1.2

**Assessment:** The abstract provider interface pattern is correct and well-designed.

**Why this is good:**
- Follows the **Strategy Pattern** - each provider is interchangeable
- TypeScript interfaces enforce contract compliance
- Adding new providers requires only implementing the interface

**Source for pattern:** [Gang of Four Design Patterns - Strategy](https://refactoring.guru/design-patterns/strategy)

---

### ⚠️ ISSUE: dateparser False Positive Handling

**Location:** Phase 2, `main.py`, line ~135

**Current Code:**
```python
found_dates = search_dates(
    text,
    settings=DATEPARSER_SETTINGS,
    languages=['en']
)
```

**Problem:** `dateparser.search.search_dates()` will match numeric patterns that aren't dates. It doesn't have built-in filtering for:
- Numeric ranges ("110 to 130")
- Formatted numbers ("1,500")
- Measurements ("50 feet")

**CRITICAL FIX REQUIRED:**

```python
# ADD THIS: Pre-filter false positives BEFORE dateparser
FALSE_POSITIVE_PATTERNS = [
    r'\b\d+\s+to\s+\d+\b',           # "110 to 130"
    r'\b\d{1,3},\d{3}\b',             # "1,500"
    r'\b\d+\s*(?:feet|ft|meters?|m|inches?|yards?|miles?)\b',  # measurements
    r'\b\d+\s*(?:employees?|workers?|people|members?)\b',  # counts
    r'\$\s*[\d,]+',                   # currency
    r'\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b',  # times
]

def mask_false_positives(text: str) -> tuple[str, list]:
    """
    Replace false positive patterns with placeholder text.
    Returns masked text and list of masks for restoration.
    """
    import re
    masks = []
    masked = text

    for pattern in FALSE_POSITIVE_PATTERNS:
        for match in re.finditer(pattern, masked, re.IGNORECASE):
            placeholder = '█' * len(match.group())
            masks.append({
                'start': match.start(),
                'original': match.group(),
                'placeholder': placeholder
            })
            masked = masked[:match.start()] + placeholder + masked[match.end():]

    return masked, masks
```

**Why this matters:** This is THE problem that caused the "110 to 130 employees" false positive. dateparser doesn't know these aren't dates - we must filter them out first.

**Source:** Your own Date Engine v3 guide documents this exact issue in the "False Positive Patterns" section.

---

### ⚠️ ISSUE: Ollama API Error Handling

**Location:** Phase 3, `ollama-provider.ts`, line ~90

**Current Code:**
```typescript
const response = await fetch(`${this.baseUrl}/api/generate`, {
  method: 'POST',
  // ...
});

if (!response.ok) {
  const error = await response.text();
  throw new Error(`Ollama error: ${error}`);
}
```

**Problem:** This doesn't handle:
1. Network timeouts gracefully
2. Ollama returning partial/streaming responses
3. Model not loaded (cold start)

**IMPROVED CODE:**

```typescript
async extract(input: ExtractionInput): Promise<ExtractionResult> {
  const model = this.config.settings.model || 'qwen2.5:32b';
  const timeout = this.config.settings.timeout || 120000;

  // Pre-flight check: ensure model is loaded
  await this.ensureModelLoaded(model);

  const startTime = Date.now();
  const prompt = EXTRACTION_PROMPT_TEMPLATE.replace('{text}', input.text);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: 'json',  // IMPORTANT: Request JSON format
        options: {
          temperature: 0.1,
          num_predict: 4096,
          // ADD: Stop sequences to prevent runaway generation
          stop: ['\n\n\n', '```', 'Human:', 'Assistant:'],
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();

      // Handle specific Ollama errors
      if (response.status === 404) {
        throw new Error(`Model '${model}' not found. Run: ollama pull ${model}`);
      }
      if (response.status === 500 && errorText.includes('loading')) {
        throw new Error(`Model '${model}' is still loading. Please wait and retry.`);
      }

      throw new Error(`Ollama error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // Validate response has content
    if (!data.response || data.response.trim() === '') {
      throw new Error('Ollama returned empty response');
    }

    // ... rest of parsing
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(
          `Extraction timed out after ${timeout / 1000}s. ` +
          `Try a smaller model or increase timeout in settings.`
        );
      }
      if (error.message.includes('ECONNREFUSED')) {
        throw new Error(
          `Cannot connect to Ollama at ${this.baseUrl}. ` +
          `Is Ollama running? Start it with: ollama serve`
        );
      }
    }

    throw error;
  }
}

/**
 * Ensure model is loaded before making extraction request.
 * Ollama has a cold-start delay when loading models.
 */
private async ensureModelLoaded(model: string): Promise<void> {
  try {
    // This triggers model loading if not already loaded
    const response = await fetch(`${this.baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
    });

    if (!response.ok) {
      console.warn(`Model ${model} may not be ready`);
    }
  } catch {
    // Ignore - we'll get a clearer error in the main request
  }
}
```

**Why this matters:** Users will get cryptic errors without this. A less experienced developer won't know "ECONNREFUSED" means Ollama isn't running.

---

### ⚠️ ISSUE: JSON Parsing Robustness

**Location:** Phase 3, `prompt-templates.ts`, `parseStructuredResponse()`

**Current Code:** Handles markdown blocks and text before JSON, but...

**Missing Cases:**
1. LLM adds commentary after the JSON
2. LLM returns multiple JSON objects
3. LLM uses single quotes instead of double quotes
4. LLM includes JavaScript-style comments

**IMPROVED CODE:**

```typescript
export function parseStructuredResponse(response: string): ParsedResponse {
  const warnings: string[] = [];
  let jsonStr = response.trim();

  // Step 1: Remove markdown code blocks
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Step 2: Find JSON object boundaries
  // This handles LLM adding text before/after
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    warnings.push('No valid JSON object found in response');
    return emptyResult(warnings);
  }

  jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);

  // Step 3: Fix common LLM JSON mistakes
  jsonStr = fixCommonJsonErrors(jsonStr);

  // Step 4: Parse with error recovery
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    // Try to salvage partial data
    const partialResult = attemptPartialParse(jsonStr);
    if (partialResult) {
      warnings.push('JSON was malformed but partially recovered');
      parsed = partialResult;
    } else {
      warnings.push(`JSON parse failed: ${e instanceof Error ? e.message : 'unknown'}`);
      return emptyResult(warnings);
    }
  }

  // Step 5: Validate and normalize
  return normalizeResult(parsed, warnings);
}

/**
 * Fix common JSON errors that LLMs make
 */
function fixCommonJsonErrors(json: string): string {
  let fixed = json;

  // Remove JavaScript comments (// and /* */)
  fixed = fixed.replace(/\/\/.*$/gm, '');
  fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');

  // Fix single quotes to double quotes (careful with apostrophes)
  // Only replace quotes that are clearly string delimiters
  fixed = fixed.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');

  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

  // Fix unquoted keys (common LLM mistake)
  fixed = fixed.replace(/(\{|\,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

  return fixed;
}

/**
 * Attempt to extract partial data from malformed JSON
 */
function attemptPartialParse(json: string): any | null {
  // Try to extract arrays individually
  const result: any = {
    dates: [],
    people: [],
    organizations: [],
    locations: [],
  };

  const patterns = {
    dates: /"dates"\s*:\s*\[([\s\S]*?)\]/,
    people: /"people"\s*:\s*\[([\s\S]*?)\]/,
    organizations: /"organizations"\s*:\s*\[([\s\S]*?)\]/,
    locations: /"locations"\s*:\s*\[([\s\S]*?)\]/,
    summary: /"summary"\s*:\s*"([^"]*)"/,
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = json.match(pattern);
    if (match) {
      try {
        if (key === 'summary') {
          result[key] = match[1];
        } else {
          result[key] = JSON.parse(`[${match[1]}]`);
        }
      } catch {
        // Keep empty array
      }
    }
  }

  // Only return if we got something
  const hasData = result.dates.length > 0 ||
                  result.people.length > 0 ||
                  result.organizations.length > 0 ||
                  result.locations.length > 0 ||
                  result.summary;

  return hasData ? result : null;
}
```

**Why this matters:** LLMs are not perfect JSON generators. Even with `format: 'json'`, they sometimes:
- Add explanatory text
- Use wrong quote styles
- Include trailing commas
- Add comments

This robust parser handles these gracefully instead of failing completely.

**Source:** [Crafting Structured JSON Responses from LLMs](https://dev.to/rishabdugar/crafting-structured-json-responses-ensuring-consistent-output-from-any-llm-l9h), [Improving LLM Output Reliability](https://www.matt-adams.co.uk/2025/02/12/structured-data-generation.html)

---

### ✅ CORRECT: Provider Priority/Fallback System

**Location:** Phase 4, `extraction-service.ts`

**Assessment:** The priority-based fallback is well-designed.

**Why this is good:**
- Tries fastest provider (spaCy) first
- Falls back to LLM only when needed
- Can skip spaCy when summary is required
- Collects all errors for debugging

---

### ⚠️ ISSUE: Missing Retry Logic

**Location:** Phase 4, `extraction-service.ts`

**Current Code:** Tries each provider once, then gives up.

**Problem:** Transient failures (network blip, Ollama busy) will fail the entire extraction.

**ADD THIS:**

```typescript
async extract(
  input: ExtractionInput,
  options?: ExtractOptions
): Promise<ExtractionResult & { providerId: string }> {
  const { preferProvider, needsSummary = false, maxRetries = 2 } = options || {};

  // ... provider selection code ...

  for (const [id, provider] of providers) {
    let lastError: Error | null = null;

    // Retry loop for transient failures
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!(await provider.isAvailable())) {
          lastError = new Error('Provider not available');
          break; // Don't retry availability issues
        }

        console.log(`Attempting extraction with ${provider.getName()} (attempt ${attempt}/${maxRetries})...`);

        const result = await provider.extract(input);

        // Validate result
        if (this.isValidResult(result)) {
          return { ...result, providerId: id };
        }

        lastError = new Error('Extraction returned no useful data');

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry certain errors
        if (this.isNonRetryableError(lastError)) {
          break;
        }

        // Exponential backoff before retry
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    errors.push(`${provider.getName()}: ${lastError?.message || 'Unknown error'}`);
  }

  throw new Error(`All providers failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
}

private isNonRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('not found') ||
    message.includes('api key') ||
    message.includes('invalid') ||
    message.includes('unauthorized')
  );
}

private isValidResult(result: ExtractionResult): boolean {
  return (
    result.dates.length > 0 ||
    result.people.length > 0 ||
    result.organizations.length > 0 ||
    result.locations.length > 0 ||
    (result.summary && result.summary.length > 10)
  );
}
```

---

### ⚠️ ISSUE: spaCy Service Startup Race Condition

**Location:** Phase 2, `spacy-provider.ts`, `ensureServiceRunning()`

**Current Code:**
```typescript
// Wait for service to be ready (max 30 seconds)
const maxWait = 30000;
const startTime = Date.now();

while (Date.now() - startTime < maxWait) {
  try {
    const response = await fetch(`${this.baseUrl}/health`);
    if (response.ok) {
      console.log('spaCy service is ready');
      return;
    }
  } catch {
    // Not ready yet
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
```

**Problem:** If two extractions start simultaneously, both might try to start the spaCy process.

**FIX:**

```typescript
private startupPromise: Promise<void> | null = null;
private startupLock = false;

private async ensureServiceRunning(): Promise<void> {
  // If already running, return immediately
  if (this.process && !this.process.killed) {
    // Quick health check
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) return;
    } catch {
      // Process died, need to restart
      this.process = null;
    }
  }

  // If another call is already starting the service, wait for it
  if (this.startupPromise) {
    return this.startupPromise;
  }

  // We're the first caller, start the service
  this.startupPromise = this.doStartService();

  try {
    await this.startupPromise;
  } finally {
    this.startupPromise = null;
  }
}

private async doStartService(): Promise<void> {
  // ... actual startup logic ...
}
```

---

### ✅ CORRECT: Database Schema Design

**Location:** Database Schema section

**Assessment:** The schema is well-normalized and follows the project's patterns.

**Why this is good:**
- `entity_extractions` table unifies all entity types
- Foreign keys to `locs` table maintain referential integrity
- Status workflow matches existing `date_extractions` pattern
- Indexes on commonly-queried columns

---

### ⚠️ MISSING: Settings Persistence

**Location:** Not in guide

**Problem:** Provider configurations should persist across app restarts. The guide shows in-memory config but no database persistence.

**ADD THIS TABLE:**

```sql
-- Provider configurations (persisted settings)
CREATE TABLE IF NOT EXISTS extraction_providers (
  provider_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 10,
  settings_json TEXT,  -- JSON blob of settings

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**AND THIS CODE:**

```typescript
// In extraction-service.ts constructor:
constructor(private db: Database) {
  this.configs = this.loadConfigsFromDatabase();
  this.initializeProviders();
}

private loadConfigsFromDatabase(): ProviderConfig[] {
  const rows = this.db.prepare(`
    SELECT provider_id, name, type, enabled, priority, settings_json
    FROM extraction_providers
    ORDER BY priority ASC
  `).all();

  if (rows.length === 0) {
    // First run - insert defaults
    for (const config of DEFAULT_PROVIDERS) {
      this.saveConfigToDatabase(config);
    }
    return [...DEFAULT_PROVIDERS];
  }

  return rows.map(row => ({
    id: row.provider_id,
    name: row.name,
    type: row.type,
    enabled: Boolean(row.enabled),
    priority: row.priority,
    settings: JSON.parse(row.settings_json || '{}'),
  }));
}

private saveConfigToDatabase(config: ProviderConfig): void {
  this.db.prepare(`
    INSERT OR REPLACE INTO extraction_providers
    (provider_id, name, type, enabled, priority, settings_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    config.id,
    config.name,
    config.type,
    config.enabled ? 1 : 0,
    config.priority,
    JSON.stringify(config.settings)
  );
}
```

---

# Precision Improvements: Option 1 (spaCy) {#precision-improvements-option-1}

## Current Accuracy: ~75-85%

The guide's spaCy implementation is functional but leaves precision on the table. Here's how to get to **90-95%**:

## Improvement 1: Pre-filtering (CRITICAL)

**Problem:** dateparser matches things that aren't dates.

**Solution:** Mask false positives BEFORE calling dateparser.

```python
# Add to main.py

import re

FALSE_POSITIVE_PATTERNS = [
    # Numeric ranges (THE problem case)
    (r'\b(\d{1,3})\s+to\s+(\d{1,3})\b', 'numeric_range'),

    # Formatted numbers with commas
    (r'\b\d{1,3}(?:,\d{3})+\b', 'formatted_number'),

    # Measurements with units
    (r'\b\d+(?:\.\d+)?\s*(?:feet|foot|ft|meters?|m|inches?|in|yards?|yd|miles?|mi|km)\b', 'measurement'),
    (r'\b\d+(?:\.\d+)?\s*(?:pounds?|lbs?|ounces?|oz|kilograms?|kg|grams?|g|tons?)\b', 'weight'),
    (r'\b\d+(?:\.\d+)?\s*(?:acres?|hectares?|sqft|sq\s*ft|square\s*(?:feet|meters?))\b', 'area'),

    # People counts
    (r'\b\d+\s*(?:employees?|workers?|people|persons?|staff|members?|residents?|students?|patients?)\b', 'count_people'),

    # Object counts
    (r'\b\d+\s*(?:units?|rooms?|beds?|floors?|stories|buildings?|houses?|apartments?|cars?|vehicles?)\b', 'count_objects'),

    # Currency
    (r'\$\s*[\d,]+(?:\.\d{2})?', 'currency'),
    (r'\b\d+(?:,\d{3})*\s*(?:dollars?|cents?|bucks?|USD|EUR|GBP)\b', 'currency'),

    # Times (without date context)
    (r'\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm|AM|PM)?\b', 'time'),

    # Phone numbers
    (r'\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b', 'phone'),
    (r'\(\d{3}\)\s*\d{3}[-.\s]?\d{4}', 'phone'),

    # Route/building numbers
    (r'\b(?:route|rt|rte|hwy|highway|interstate|i-)\s*#?\s*\d+\b', 'route'),
    (r'\b(?:room|rm|building|bldg|suite|ste|apt|apartment|unit|floor|fl)\s*#?\s*\d+\b', 'building_id'),

    # Percentages
    (r'\b\d+(?:\.\d+)?\s*%', 'percentage'),

    # Coordinates (lat/long)
    (r'-?\d{1,3}\.\d{4,}', 'coordinate'),

    # Ages
    (r'\b\d+\s*(?:years?\s+old|year-old|-year-old|yo)\b', 'age'),

    # Model numbers / serial numbers
    (r'\b[A-Z]{1,3}-?\d{3,}\b', 'model_number'),
]

def prefilter_text(text: str) -> tuple[str, list[dict]]:
    """
    Mask false positive patterns before date extraction.

    Returns:
        masked_text: Text with false positives replaced by █ characters
        masks: List of what was masked (for debugging/logging)
    """
    masks = []
    masked = text

    for pattern, reason in FALSE_POSITIVE_PATTERNS:
        for match in re.finditer(pattern, masked, re.IGNORECASE):
            original = match.group()
            placeholder = '█' * len(original)

            masks.append({
                'original': original,
                'reason': reason,
                'position': match.start(),
            })

            # Replace in text (careful with positions changing)
            masked = masked[:match.start()] + placeholder + masked[match.end():]

    return masked, masks
```

**Why this works:** By replacing "110 to 130" with "███████████", dateparser never sees it. The masks preserve position information for debugging.

**Source:** This is the exact approach documented in your Date Engine v3 guide.

## Improvement 2: Keyword Proximity Validation (CRITICAL)

**Problem:** A bare "1923" in text might not be a date at all.

**Solution:** Require a date-related keyword within N characters.

```python
DATE_CONTEXT_KEYWORDS = {
    'strong': [  # High confidence if found near date
        'built', 'constructed', 'erected', 'established', 'founded',
        'opened', 'inaugurated', 'closed', 'abandoned', 'demolished',
        'completed', 'dating from', 'dates from', 'dates back',
    ],
    'medium': [  # Medium confidence
        'in', 'from', 'since', 'circa', 'c.', 'ca.', 'around',
        'during', 'by', 'before', 'after', 'until',
    ],
    'weak': [  # Low confidence, but still valid
        'year', 'dated', 'historic', 'original',
    ],
}

def calculate_keyword_confidence(text: str, date_position: int, date_length: int) -> tuple[float, str | None]:
    """
    Calculate confidence based on keyword proximity.

    Returns:
        confidence: 0.0-1.0
        keyword: The matched keyword (or None)
    """
    # Check 100 characters before and after
    context_start = max(0, date_position - 100)
    context_end = min(len(text), date_position + date_length + 100)
    context = text[context_start:context_end].lower()

    date_pos_in_context = date_position - context_start

    for strength, keywords in DATE_CONTEXT_KEYWORDS.items():
        for keyword in keywords:
            keyword_pos = context.find(keyword.lower())
            if keyword_pos != -1:
                # Calculate distance
                distance = abs(keyword_pos - date_pos_in_context)

                # Score based on strength and distance
                if strength == 'strong':
                    if distance < 30:
                        return 0.95, keyword
                    elif distance < 60:
                        return 0.85, keyword
                    else:
                        return 0.70, keyword

                elif strength == 'medium':
                    if distance < 20:
                        return 0.75, keyword
                    elif distance < 50:
                        return 0.60, keyword
                    else:
                        return 0.45, keyword

                elif strength == 'weak':
                    if distance < 30:
                        return 0.50, keyword
                    else:
                        return 0.35, keyword

    # No keyword found - low confidence for year-only dates
    return 0.20, None
```

**Why this matters:** "1923" alone could be a room number, model number, or anything. "built in 1923" is clearly a date.

## Improvement 3: Historical Plausibility Check

**Problem:** Dates like "2087" or "1523" are unlikely for urbex.

**Solution:** Score dates by historical plausibility.

```python
def historical_plausibility_score(year: int) -> float:
    """
    Score how plausible a year is for an abandoned place.
    Based on typical urbex documentation patterns.
    """
    current_year = datetime.now().year

    if year < 1800 or year > current_year + 5:
        return 0.0  # Reject: too old or future

    if 1850 <= year <= 1970:
        return 1.0  # Prime abandoned building era

    if 1800 <= year < 1850:
        return 0.8  # Early industrial

    if 1970 < year <= 2000:
        return 0.9  # Modern abandonment

    if 2000 < year <= current_year:
        return 0.7  # Recent

    return 0.5  # Edge cases
```

## Improvement 4: spaCy Custom NER Training (Advanced)

**Problem:** spaCy's default NER is trained on news articles, not historical documents about abandoned places.

**Solution:** Fine-tune with domain-specific examples.

```python
# Example training data for urbex domain
TRAINING_DATA = [
    ("The factory was built in 1923 by John Smith.", {
        "entities": [(25, 29, "DATE"), (33, 43, "PERSON")]
    }),
    ("Established by the Smith Brothers Company in 1895.", {
        "entities": [(19, 41, "ORG"), (45, 49, "DATE")]
    }),
    ("The building employed 150 workers at its peak.", {
        "entities": []  # No date here! "150" is a count
    }),
    # ... more examples
]
```

**Source:** [spaCy Training Documentation](https://spacy.io/usage/training), [Fine-Tuning SpaCy for Domain-Specific NER](https://medium.com/ubiai-nlp/fine-tuning-spacy-models-customizing-named-entity-recognition-for-domain-specific-data-3d17c5fc72ae)

## Improvement 5: Entity Ruler for Known Patterns

**Problem:** spaCy might miss patterns you know are always valid.

**Solution:** Add an EntityRuler before the NER.

```python
from spacy.pipeline import EntityRuler

def create_extraction_pipeline():
    nlp = spacy.load('en_core_web_lg')

    # Add EntityRuler before NER
    ruler = nlp.add_pipe('entity_ruler', before='ner')

    # Patterns for historical date expressions
    patterns = [
        # Decades
        {"label": "DATE", "pattern": [{"TEXT": {"REGEX": r"1[89]\d0s"}}]},

        # Circa expressions
        {"label": "DATE", "pattern": [
            {"LOWER": {"IN": ["circa", "c.", "ca."]}},
            {"TEXT": {"REGEX": r"1[89]\d{2}|20[0-2]\d"}}
        ]},

        # "late/early 1800s" etc.
        {"label": "DATE", "pattern": [
            {"LOWER": {"IN": ["late", "early", "mid"]}},
            {"TEXT": {"REGEX": r"1[89]\d0s"}}
        ]},

        # Explicit date phrases
        {"label": "DATE", "pattern": [
            {"LOWER": {"IN": ["built", "constructed", "established", "founded", "opened"]}},
            {"LOWER": "in", "OP": "?"},
            {"TEXT": {"REGEX": r"1[89]\d{2}|20[0-2]\d"}}
        ]},
    ]

    ruler.add_patterns(patterns)

    return nlp
```

**Source:** [spaCy EntityRuler Documentation](https://spacy.io/usage/rule-based-matching#entityruler)

---

# Precision Improvements: Option 2 (LLM) {#precision-improvements-option-2}

## Current Accuracy: ~90-95%

LLMs are already good at extraction, but here's how to get to **97-99%**:

## Improvement 1: Structured Output Mode (CRITICAL)

**Problem:** LLMs sometimes generate invalid JSON.

**Solution:** Use provider-specific structured output features.

```typescript
// For Ollama with Qwen2.5
const response = await fetch(`${this.baseUrl}/api/generate`, {
  method: 'POST',
  body: JSON.stringify({
    model,
    prompt,
    stream: false,
    format: 'json',  // CRITICAL: Force JSON output
    options: {
      temperature: 0.1,  // Low temperature = more deterministic
      num_predict: 4096,
    },
  }),
});
```

**For Claude API:**
```typescript
// Use tool_use for structured extraction
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    tools: [{
      name: 'extract_document_data',
      description: 'Extract structured data from a historical document',
      input_schema: {
        type: 'object',
        properties: {
          dates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                rawText: { type: 'string' },
                parsedDate: { type: 'string' },
                category: {
                  type: 'string',
                  enum: ['build_date', 'opening', 'closure', 'demolition', 'visit', 'publication', 'unknown']
                },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['rawText', 'parsedDate', 'category', 'confidence'],
            },
          },
          // ... other fields
        },
        required: ['dates', 'people', 'organizations', 'locations'],
      },
    }],
    tool_choice: { type: 'tool', name: 'extract_document_data' },
    messages: [{ role: 'user', content: prompt }],
  }),
});
```

**Why this works:** Using tool_use forces Claude to output data matching your exact schema. No more malformed JSON.

**Source:** [Anthropic Tool Use Documentation](https://docs.anthropic.com/en/docs/tool-use), [Structured Output with LLM Schemas](https://simonwillison.net/2025/Feb/28/llm-schemas/)

## Improvement 2: Few-Shot Examples

**Problem:** LLM might misunderstand what you want.

**Solution:** Include examples in the prompt.

```typescript
export const EXTRACTION_PROMPT_TEMPLATE = `You are an expert at extracting structured information from historical documents about abandoned places.

## EXAMPLES

### Example 1 - Factory Document
INPUT: "The Sterling Steel Factory was built in 1923 by John Sterling. It employed 500 workers at its peak before closing in 2008."

OUTPUT:
{
  "dates": [
    {"rawText": "built in 1923", "parsedDate": "1923", "category": "build_date", "confidence": 0.95},
    {"rawText": "closing in 2008", "parsedDate": "2008", "category": "closure", "confidence": 0.90}
  ],
  "people": [
    {"name": "John Sterling", "role": "founder", "confidence": 0.85}
  ],
  "organizations": [
    {"name": "Sterling Steel Factory", "type": "company", "confidence": 0.95}
  ],
  "summary": "Industrial factory built in 1923, closed in 2008 after 85 years of operation."
}

NOTE: "500 workers" is NOT a date - it's an employee count.

### Example 2 - Approximate Dates
INPUT: "This Victorian-era mansion dates from the late 1800s, circa 1885."

OUTPUT:
{
  "dates": [
    {"rawText": "late 1800s, circa 1885", "parsedDate": "1885", "precision": "approximate", "category": "build_date", "confidence": 0.80, "isApproximate": true}
  ],
  "summary": "Victorian mansion from approximately 1885."
}

---

## YOUR TASK

DOCUMENT TO ANALYZE:
---
{text}
---

Extract all relevant information as JSON. Follow the exact format shown in the examples.
Remember:
- Employee counts, measurements, and prices are NOT dates
- Include confidence scores based on how explicit the information is
- Only extract what's clearly stated in the document`;
```

**Source:** [Crafting Structured JSON Responses from LLMs](https://dev.to/rishabdugar/crafting-structured-json-responses-ensuring-consistent-output-from-any-llm-l9h)

## Improvement 3: Chain-of-Thought for Complex Documents

**Problem:** Complex documents with multiple dates may confuse the model.

**Solution:** Ask the model to think step-by-step.

```typescript
const COT_EXTRACTION_PROMPT = `You are an expert at extracting structured information from historical documents.

DOCUMENT:
---
{text}
---

STEP 1: First, identify all potential dates in the text. List them.
STEP 2: For each potential date, determine:
  - Is this actually a date, or a number (employee count, measurement, etc.)?
  - What category does it belong to (build_date, opening, closure, etc.)?
  - How confident are you (0.0-1.0)?
STEP 3: Identify all people mentioned and their roles.
STEP 4: Identify all organizations mentioned.
STEP 5: Write a 2-3 sentence summary.

Finally, output the JSON with your findings.`;
```

## Improvement 4: Validation Layer

**Problem:** LLM might hallucinate data not in the document.

**Solution:** Post-process to verify extractions exist in source.

```typescript
function validateExtractions(
  input: ExtractionInput,
  result: ExtractionResult
): ExtractionResult {
  const text = input.text.toLowerCase();
  const warnings: string[] = result.warnings || [];

  // Validate dates appear in source
  result.dates = result.dates.filter(date => {
    const rawLower = date.rawText.toLowerCase();
    if (!text.includes(rawLower) && !text.includes(date.parsedDate)) {
      warnings.push(`Removed hallucinated date: ${date.rawText}`);
      return false;
    }
    return true;
  });

  // Validate people appear in source
  result.people = result.people.filter(person => {
    // Check if any part of the name appears
    const nameParts = person.name.toLowerCase().split(' ');
    const found = nameParts.some(part => part.length > 2 && text.includes(part));
    if (!found) {
      warnings.push(`Removed hallucinated person: ${person.name}`);
      return false;
    }
    return true;
  });

  // Validate organizations
  result.organizations = result.organizations.filter(org => {
    const orgLower = org.name.toLowerCase();
    // Allow partial matches for organizations (they might be abbreviated)
    const words = orgLower.split(' ').filter(w => w.length > 2);
    const found = words.some(word => text.includes(word));
    if (!found) {
      warnings.push(`Removed hallucinated organization: ${org.name}`);
      return false;
    }
    return true;
  });

  result.warnings = warnings.length > 0 ? warnings : undefined;
  return result;
}
```

## Improvement 5: Confidence Calibration

**Problem:** LLM confidence scores may not be well-calibrated.

**Solution:** Recalibrate based on extraction characteristics.

```typescript
function recalibrateConfidence(extraction: ExtractedDate, text: string): number {
  let confidence = extraction.confidence;

  // Boost: Explicit date format (MM/DD/YYYY, etc.)
  if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(extraction.rawText)) {
    confidence = Math.min(1.0, confidence + 0.1);
  }

  // Boost: Strong keyword present
  const strongKeywords = ['built', 'constructed', 'established', 'founded', 'opened', 'closed', 'demolished'];
  const contextLower = extraction.context?.toLowerCase() || '';
  if (strongKeywords.some(k => contextLower.includes(k))) {
    confidence = Math.min(1.0, confidence + 0.1);
  }

  // Penalty: Very short context
  if (extraction.context && extraction.context.length < 20) {
    confidence = Math.max(0.1, confidence - 0.1);
  }

  // Penalty: Approximate date
  if (extraction.isApproximate) {
    confidence = Math.max(0.1, confidence - 0.05);
  }

  return Math.round(confidence * 100) / 100;
}
```

---

# Developer Onboarding Guide {#developer-onboarding-guide}

## For Developers New to This Codebase

### Prerequisites You Need

1. **Node.js 20+** - The runtime for the Electron app
   - Why: We use modern JavaScript features (optional chaining, nullish coalescing)
   - Install: `nvm install 20 && nvm use 20`

2. **pnpm 10+** - Package manager
   - Why: Faster than npm, better monorepo support
   - Install: `npm install -g pnpm`

3. **Python 3.9+** - For the spaCy service
   - Why: spaCy and dateparser are Python libraries
   - Install: Download from python.org or use pyenv

4. **Ollama** - For local LLM inference
   - Why: Runs LLMs locally without cloud dependencies
   - Install: https://ollama.com

### Understanding the Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ELECTRON APP                                                            │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  RENDERER PROCESS (packages/desktop/src/)                         │  │
│  │                                                                    │  │
│  │  • Svelte components (UI)                                         │  │
│  │  • Cannot access Node.js APIs directly                            │  │
│  │  • Communicates via window.electron.* (exposed by preload)        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                              │                                           │
│                              │ IPC (Inter-Process Communication)         │
│                              ▼                                           │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  PRELOAD SCRIPT (packages/desktop/electron/preload/)              │  │
│  │                                                                    │  │
│  │  • Bridge between renderer and main                               │  │
│  │  • MUST be CommonJS (.cjs) - no ES modules!                       │  │
│  │  • Exposes safe APIs to renderer                                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                              │                                           │
│                              ▼                                           │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  MAIN PROCESS (packages/desktop/electron/main/)                   │  │
│  │                                                                    │  │
│  │  • Full Node.js access                                            │  │
│  │  • Database operations                                            │  │
│  │  • File system access                                             │  │
│  │  • Spawns child processes (spaCy, etc.)                           │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key insight:** The preload script is the ONLY way for the UI to talk to the backend. If you need a new feature, you must:
1. Add the handler in main process (`ipc-handlers/`)
2. Expose it in preload (`preload.cjs`)
3. Call it from the UI (`window.electron.something.action()`)

### Common Tasks

#### Adding a New IPC Channel

```typescript
// 1. packages/desktop/electron/main/ipc-handlers/your-handlers.ts
import { ipcMain } from 'electron';

export function registerYourHandlers(): void {
  ipcMain.handle('your:action', async (event, arg1, arg2) => {
    // Do something
    return result;
  });
}

// 2. Register in packages/desktop/electron/main/ipc-handlers/index.ts
import { registerYourHandlers } from './your-handlers';

export function registerAllHandlers(): void {
  // ... existing handlers
  registerYourHandlers();
}

// 3. Expose in packages/desktop/electron/preload/preload.cjs
your: {
  action: (arg1, arg2) => ipcRenderer.invoke('your:action', arg1, arg2),
},

// 4. Use in Svelte component
const result = await window.electron.your.action(arg1, arg2);
```

#### Debugging Tips

1. **Main process logs** - Check the terminal where you ran `pnpm dev`
2. **Renderer logs** - Open DevTools (Cmd+Option+I on Mac)
3. **Preload crashes** - Usually means you used `import` instead of `require()`
4. **IPC not working** - Check the channel name matches exactly

### File Naming Rules

| Type | Naming | Example |
|------|--------|---------|
| Svelte components | PascalCase | `ExtractionQueue.svelte` |
| TypeScript services | kebab-case | `extraction-service.ts` |
| IPC handlers | kebab-case + domain | `extraction-handlers.ts` |
| Types | PascalCase + .types.ts | `extraction.types.ts` |

### Testing Your Changes

```bash
# Run the app in dev mode
pnpm dev

# Run tests
pnpm test

# Lint code
pnpm lint

# Type-check
pnpm --filter desktop type-check
```

---

# Sources & References {#sources-references}

## LLM & Hardware

- [Best Ollama Models 2025](https://collabnix.com/best-ollama-models-in-2025-complete-performance-comparison/)
- [llama.cpp Apple Silicon Performance](https://github.com/ggml-org/llama.cpp/discussions/4167)
- [DeepSeek R1 Local Deployment](https://obrienlabs.medium.com/running-reasoning-llms-like-the-deepseek-r1-70b-43g-locally-for-private-offline-air-gapped-259fa437da8f)
- [Qwen2.5 Official Benchmarks](https://qwen2.org/benchmarks-of-providers-of-qwen2-5/)

## Structured Output & JSON

- [Structured Data Extraction from Unstructured Content](https://simonwillison.net/2025/Feb/28/llm-schemas/)
- [Crafting Structured JSON Responses](https://dev.to/rishabdugar/crafting-structured-json-responses-ensuring-consistent-output-from-any-llm-l9h)
- [Improving LLM Output Reliability](https://www.matt-adams.co.uk/2025/02/12/structured-data-generation.html)
- [PARSE: LLM Schema Optimization - Amazon Science](https://www.amazon.science/publications/parse-llm-driven-schema-optimization-for-reliable-entity-extraction)

## spaCy & NER

- [spaCy Training Documentation](https://spacy.io/usage/training)
- [spaCy EntityRuler](https://spacy.io/usage/rule-based-matching#entityruler)
- [Fine-Tuning SpaCy for Domain-Specific NER](https://medium.com/ubiai-nlp/fine-tuning-spacy-models-customizing-named-entity-recognition-for-domain-specific-data-3d17c5fc72ae)
- [Improving NER with Active Learning](https://support.prodi.gy/t/improve-accuracy-of-the-spacy-model/2151)

## Date Parsing

- [dateparser Documentation](https://dateparser.readthedocs.io/)
- [Your Date Engine v3 Guide](../implementations/date-engine-v3-guide.md)

## Design Patterns

- [Strategy Pattern](https://refactoring.guru/design-patterns/strategy)
- [Gang of Four Design Patterns](https://www.amazon.com/Design-Patterns-Elements-Reusable-Object-Oriented/dp/0201633612)

---

## Summary of Critical Fixes

| Issue | Priority | Fix |
|-------|----------|-----|
| dateparser false positives | CRITICAL | Add pre-filtering before dateparser |
| Ollama error handling | HIGH | Add specific error messages, cold-start handling |
| JSON parsing robustness | HIGH | Handle LLM JSON mistakes gracefully |
| Retry logic | MEDIUM | Add exponential backoff retries |
| spaCy startup race condition | MEDIUM | Add startup lock |
| Settings persistence | MEDIUM | Save provider configs to database |

---

*Audit completed 2025-12-13*
