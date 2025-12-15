# LiteLLM Plan Audit

**Auditing:** `litellm-integration-plan.md`
**Against:** Full conversation context + audit findings

---

## Audit Checklist

### From Initial Audit Findings

| Requirement | Plan Addresses? | Notes |
|-------------|-----------------|-------|
| Boot sequence compliance | ✅ Yes | Plan follows CLAUDE.md conventions |
| Preload MUST be CommonJS | ✅ Yes | Phase 6 uses `ipcRenderer.invoke` syntax |
| IPC naming: `domain:action` | ✅ Yes | Uses `litellm:status`, `credentials:store` |
| Security: safeStorage for API keys | ✅ Yes | Phase 1 core focus |
| Existing extraction_providers table | ⚠️ PARTIAL | Plan adds litellm type but doesn't migrate existing configs |
| Existing versioned prompts system | ✅ Yes | LiteLLMProvider uses existing prompts |
| Existing spaCy preprocessing | ❌ MISSING | Plan doesn't show spaCy → LiteLLM flow |
| Timeline system integration | ❌ MISSING | No connection to timeline extraction |
| People/Company profile extraction | ❌ MISSING | Only dates mentioned in prompts |
| Braun design compliance | ✅ Yes | UI uses braun-* classes, 4px radius |
| Settings accordion pattern | ✅ Yes | Follows existing pattern |

### From LiteLLM Research

| LiteLLM Feature | Plan Leverages? | Notes |
|-----------------|-----------------|-------|
| Cost tracking | ⚠️ PARTIAL | Plan doesn't expose LiteLLM cost dashboard |
| Rate limiting | ✅ Yes | LiteLLM handles, config in YAML |
| Caching | ⚠️ PARTIAL | Config shows cache:true but no Redis setup |
| Fallbacks | ✅ Yes | Router config with fallback chains |
| Observability | ❌ MISSING | No Langfuse/Helicone integration mentioned |

### From Gaps Document

| Gap Identified | Plan Addresses? | Notes |
|----------------|-----------------|-------|
| Response caching | ✅ Yes | LiteLLM handles |
| Rate limiting | ✅ Yes | LiteLLM handles |
| Cost tracking | ⚠️ PARTIAL | LiteLLM has it, UI doesn't expose |
| Retry logic | ✅ Yes | LiteLLM router handles |
| Streaming | ❌ MISSING | Plan uses sync calls only |
| Privacy controls | ✅ Yes | Phase 3 sanitizer |
| User feedback loop | ❌ MISSING | Not in plan |
| A/B testing | ❌ MISSING | Not in plan |

### Architecture Consistency

| Pattern | Consistent? | Notes |
|---------|-------------|-------|
| Service singleton pattern | ✅ Yes | Follows Ollama lifecycle pattern |
| Kysely for DB queries | ✅ Yes | Used in credential service |
| Zod validation | ❌ MISSING | No input validation schemas |
| Error wrapping | ⚠️ PARTIAL | Basic try/catch, not full pattern |

---

## Required Updates to Plan

### HIGH PRIORITY

1. **Add spaCy preprocessing flow**
   - LiteLLMProvider should call preprocessing service before LLM
   - Pass preprocessed data to prompts

2. **Add People/Company extraction**
   - Plan only shows date extraction
   - Need profile extraction prompts integration

3. **Add cost dashboard exposure**
   - LiteLLM tracks costs, but UI doesn't show them
   - Add `/spend/logs` endpoint query to UI

4. **Add Zod validation**
   - Validate IPC inputs
   - Validate LLM response structure

### MEDIUM PRIORITY

5. **Add streaming support**
   - LiteLLM supports streaming
   - Add optional streaming IPC pattern

6. **Add observability integration**
   - Configure Langfuse or Helicone callback
   - Expose logs in UI

7. **Migration for existing providers**
   - Handle existing Ollama configs
   - Don't break current extractions

### LOW PRIORITY

8. **Add user feedback loop**
   - Not critical for v1

9. **Add A/B testing**
   - Future enhancement

---

## Specific Code Fixes

### Fix 1: Add spaCy preprocessing to LiteLLMProvider

```typescript
// In LiteLLMProvider.extract()
async extract(input: ExtractionInput): Promise<ExtractionResult> {
  // MISSING: Call preprocessing service
  const preprocessingService = getPreprocessingService();
  const preprocessed = await preprocessingService.preprocess(input.text);

  // Then build prompt with preprocessed data
  const { systemPrompt, userPrompt } = this.buildPrompt(input.text, {
    ...input,
    preprocessedData: preprocessed,
  });
  // ... rest of method
}
```

### Fix 2: Add profile extraction

```typescript
// buildPrompt should support multiple prompt types
private buildPrompt(text: string, input: ExtractionInput, type: 'date' | 'profile' | 'combined' = 'combined') {
  if (type === 'date') {
    return DATE_EXTRACTION_PROMPTS['v2.0'];
  } else if (type === 'profile') {
    return PROFILE_EXTRACTION_PROMPTS['v1.0'];
  } else {
    return COMBINED_EXTRACTION_PROMPTS['v1.0'];
  }
}
```

### Fix 3: Add cost tracking UI

```svelte
<!-- In AISettingsPanel.svelte -->
<div class="bg-white rounded border border-braun-200 p-6">
  <h3 class="text-sm font-medium text-braun-800 mb-4">Usage & Costs</h3>

  {#if costs}
    <div class="grid grid-cols-3 gap-4">
      <div>
        <p class="text-xs text-braun-500">Today</p>
        <p class="text-lg font-medium text-braun-900">${costs.today.toFixed(2)}</p>
      </div>
      <div>
        <p class="text-xs text-braun-500">This Month</p>
        <p class="text-lg font-medium text-braun-900">${costs.month.toFixed(2)}</p>
      </div>
      <div>
        <p class="text-xs text-braun-500">Requests Today</p>
        <p class="text-lg font-medium text-braun-900">{costs.requestsToday}</p>
      </div>
    </div>
  {/if}
</div>
```

### Fix 4: Add IPC handler for costs

```typescript
// In litellm.ts handlers
ipcMain.handle('litellm:costs', async () => {
  try {
    const response = await fetch('http://localhost:4000/spend/logs?start_date=' + getStartOfMonth());
    const data = await response.json();
    return { success: true, costs: data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

### Fix 5: Add Zod validation

```typescript
// New file: ipc-handlers/litellm-validation.ts
import { z } from 'zod';

export const StoreCredentialSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google', 'groq']),
  apiKey: z.string().min(10).max(200),
});

export const TestModelSchema = z.object({
  model: z.string().min(1),
});

// Use in handlers
ipcMain.handle('credentials:store', async (_, provider: string, apiKey: string) => {
  const validated = StoreCredentialSchema.parse({ provider, apiKey });
  // ... proceed with validated data
});
```

---

## Updated Phase List

| Phase | Original | Updated |
|-------|----------|---------|
| 1 | Credential Security | Credential Security + Validation |
| 2 | LiteLLM Lifecycle | LiteLLM Lifecycle + spaCy Integration |
| 3 | Privacy Sanitizer | Privacy Sanitizer (unchanged) |
| 4 | Extraction Integration | Extraction Integration + Profiles |
| 5 | Settings UI | Settings UI + Cost Dashboard |
| 6 | Preload & Types | Preload & Types + Streaming (optional) |
| 7 | Register & Cleanup | Register & Cleanup (unchanged) |

---

## Audit Result

**Overall Assessment:** Plan is 75% complete

**Critical Gaps:**
1. Missing spaCy preprocessing integration
2. Missing profile (people/company) extraction
3. Missing cost dashboard UI

**Recommended Action:** Update plan with fixes above before implementation.

---

**Audit Complete**
