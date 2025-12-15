# Document Intelligence Extraction System

A multi-provider extraction system for extracting dates, entities, summaries, and titles from historical documents.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Renderer (Svelte)                        │
│  ExtractionSettings.svelte │ DateExtractionQueue.svelte         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ IPC (extraction:*)
┌─────────────────────────────────────────────────────────────────┐
│                      IPC Handlers                               │
│  electron/main/ipc-handlers/extraction.ts                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Extraction Service                            │
│  electron/services/extraction/extraction-service.ts             │
│  - Provider management                                          │
│  - Fallback & retry logic                                       │
│  - Batch processing                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌──────────┐    ┌──────────┐    ┌──────────┐
       │  spaCy   │    │  Ollama  │    │  Cloud   │
       │ Provider │    │ Provider │    │ Provider │
       │ (Local)  │    │ (Network)│    │ (Future) │
       └──────────┘    └──────────┘    └──────────┘
              │               │
              ▼               ▼
       ┌──────────┐    ┌──────────┐
       │ Python   │    │  Ollama  │
       │ Service  │    │  Server  │
       │ (FastAPI)│    │ (HTTP)   │
       └──────────┘    └──────────┘
```

## Components

### 1. Types (`extraction-types.ts`)

Core type definitions for the entire system:

```typescript
// What we send to extract
interface ExtractionInput {
  text: string;
  sourceType: 'web_source' | 'document' | 'note' | 'media_caption';
  sourceId: string;
  locid?: string;
  extractTypes?: Array<'dates' | 'people' | 'organizations' | 'locations' | 'summary' | 'title'>;
  articleDate?: string;
  locationName?: string;
}

// What we get back
interface ExtractionResult {
  provider: string;
  model: string;
  dates: ExtractedDate[];
  people: ExtractedPerson[];
  organizations: ExtractedOrganization[];
  locations: ExtractedLocation[];
  summaryData?: ExtractedSummary;
  processingTimeMs: number;
}
```

### 2. Providers

#### spaCy Provider (`spacy-provider.ts`)

**Purpose**: Fast, offline NER extraction using spaCy + dateparser.

**Capabilities**:
- Dates (with false-positive filtering)
- People (with role detection)
- Organizations (with type classification)
- Locations (cities, regions, landmarks)

**Cannot do**: Summary/title generation (requires LLM)

**How it works**:
1. Spawns Python FastAPI service as child process
2. Communicates via HTTP (localhost:8234)
3. Pre-filters false positives BEFORE dateparser
4. Returns structured extractions

```typescript
// Usage example
const provider = new SpacyProvider(config);
const result = await provider.extract(input);
```

#### Ollama Provider (`ollama-provider.ts`)

**Purpose**: Full extraction including summaries using local LLM.

**Key Feature**: Network-transparent design. Works with:
- `localhost:11434` (local Ollama)
- `192.168.1.100:11434` (remote Ollama on M2 Ultra)
- `my-server.local:11434` (DNS hostname)

**Capabilities**: Everything (dates, entities, summaries, titles)

**Recommended models for M2 Ultra 64GB**:
- `qwen2.5:32b` (Q8_0) - Best balance
- `qwen2.5:7b` - Faster, lighter

```typescript
// Network configuration
const config: ProviderConfig = {
  id: 'ollama-m2-server',
  name: 'M2 Ultra Server',
  type: 'ollama',
  enabled: true,
  priority: 1,
  settings: {
    host: '192.168.1.100',  // Your M2 Ultra's IP
    port: 11434,
    model: 'qwen2.5:32b',
    timeout: 120000,
  }
};
```

### 3. Agents (Prompt Templates)

Two specialized agents with carefully crafted prompts:

#### Date Extraction Agent

Extracts dates with:
- Category classification (build_date, closure, demolition, visit, etc.)
- Confidence scoring
- Context capture
- Approximate date handling

**Key insight**: Explicit rules about what is NOT a date:
- "110 to 130 employees" - numeric range
- "1,500 square feet" - measurement
- "$1,923" - currency
- "9:00 AM" - time

#### Summary/Title Agent

Generates:
- Concise title (max 60 chars)
- 2-3 sentence summary
- Key facts list
- Confidence score

### 4. Python Service (`python/spacy-service/`)

FastAPI service providing offline NER:

```bash
# Install dependencies
cd packages/desktop/electron/python/spacy-service
pip install -r requirements.txt
python -m spacy download en_core_web_lg

# Run standalone (for testing)
python main.py --port 8234
```

**Critical**: The `FALSE_POSITIVE_PATTERNS` list masks problematic patterns BEFORE dateparser sees them. This prevents "110 to 130" from being parsed as dates.

## Usage

### From Renderer

```typescript
// Extract from text
const result = await window.electron.extraction.extract({
  text: 'The factory was built in 1923...',
  sourceType: 'web_source',
  sourceId: 'ws-123',
});

// Extract from web source by ID
const result = await window.electron.extraction.extractFromWebSource(sourceId);

// Test a provider
const result = await window.electron.extraction.testProvider('ollama-local');

// Get provider statuses
const statuses = await window.electron.extraction.getProviderStatuses();

// Configure Ollama
await window.electron.extraction.updateProvider('ollama-local', {
  settings: {
    host: '192.168.1.100',
    model: 'qwen2.5:32b',
  }
});
```

### IPC Channels

| Channel | Description |
|---------|-------------|
| `extraction:extract` | Extract from text |
| `extraction:extractFromWebSource` | Extract from web source by ID |
| `extraction:extractBatch` | Batch extraction |
| `extraction:getProviders` | List all providers |
| `extraction:getProviderStatuses` | Get availability status |
| `extraction:updateProvider` | Update provider config |
| `extraction:addProvider` | Add new provider |
| `extraction:removeProvider` | Remove provider |
| `extraction:testProvider` | Test with sample text |
| `extraction:healthCheck` | System health check |
| `extraction:testOllamaConnection` | Test Ollama connection |
| `extraction:listOllamaModels` | List available Ollama models |
| `extraction:pullOllamaModel` | Pull/download Ollama model |

## Adding a New Provider

1. **Create provider class** extending `BaseExtractionProvider`:

```typescript
// providers/my-provider.ts
import { BaseExtractionProvider } from './base-provider';

export class MyProvider extends BaseExtractionProvider {
  async checkAvailability(): Promise<ProviderStatus> {
    // Check if provider is ready
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    // Perform extraction
  }

  async getModelInfo(): Promise<{ name: string; size?: string }> {
    // Return model info
  }
}
```

2. **Register in extraction-service.ts**:

```typescript
case 'my-provider':
  provider = new MyProvider(config);
  break;
```

3. **Add to default providers if needed**:

```typescript
const DEFAULT_PROVIDERS: ProviderConfig[] = [
  // ... existing providers
  {
    id: 'my-provider',
    name: 'My Provider',
    type: 'my-provider',
    enabled: true,
    priority: 3,
    settings: { /* ... */ }
  }
];
```

## Database Schema

Migration 74 adds:

```sql
-- Provider configurations
CREATE TABLE extraction_providers (
  provider_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 10,
  settings_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Entity extractions (dates, people, orgs, locations)
CREATE TABLE entity_extractions (
  extraction_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  locid TEXT,
  entity_type TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  normalized_value TEXT,
  -- ... additional fields
);

-- Document summaries
CREATE TABLE document_summaries (
  summary_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  locid TEXT,
  title TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  -- ... additional fields
);
```

## Confidence Scoring

### Pattern-based (spaCy)

| Pattern Type | Base Confidence |
|-------------|-----------------|
| Full date (MM/DD/YYYY) | 0.95 |
| Month + Year | 0.80 |
| Year with keyword | 0.75 |
| Approximate (circa) | 0.65 |

### LLM-based (Ollama)

Post-processing applies:
- +0.1 for explicit date format
- +0.1 for strong keyword in context
- -0.1 for short context
- -0.05 for approximate dates
- -0.1 for unknown category

## False Positive Prevention

The system uses multiple strategies:

1. **Pre-filtering** (spaCy): Mask patterns before dateparser
2. **Explicit rules** (Ollama): Prompt includes "What is NOT a date" section
3. **Validation** (post-processing): Check extractions against source text
4. **Confidence threshold**: Filter out low-confidence results

## Network Ollama Setup

To run Ollama on a powerful server (e.g., M2 Ultra) and access from other machines:

### On the Server

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Start with network access
OLLAMA_HOST=0.0.0.0 ollama serve

# Pull recommended model
ollama pull qwen2.5:32b
```

### In the App

1. Open Settings > Date Engine
2. Click "Add Network Ollama"
3. Enter:
   - Name: "M2 Ultra Server"
   - Host: 192.168.1.100 (server IP)
   - Port: 11434
   - Model: qwen2.5:32b
4. Test connection
5. Save

## Troubleshooting

### spaCy service won't start

```bash
# Check Python is available
python3 --version

# Install dependencies
cd packages/desktop/electron/python/spacy-service
pip install -r requirements.txt
python -m spacy download en_core_web_lg

# Test standalone
python main.py --port 8234
# Then visit http://localhost:8234/health
```

### Ollama connection refused

```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# For network access, ensure OLLAMA_HOST=0.0.0.0
OLLAMA_HOST=0.0.0.0 ollama serve
```

### False positives still appearing

1. Check if pattern is in `FALSE_POSITIVE_PATTERNS` (Python service)
2. Add new pattern if needed
3. Restart app to reload Python service

### Slow extraction

- Use `qwen2.5:7b` instead of larger models
- Reduce text length before extraction
- Check network latency for remote Ollama

## Files Reference

| File | Purpose |
|------|---------|
| `extraction-types.ts` | Type definitions |
| `providers/base-provider.ts` | Abstract base class |
| `providers/spacy-provider.ts` | spaCy implementation |
| `providers/ollama-provider.ts` | Ollama implementation |
| `agents/prompt-templates.ts` | Agent prompts and parsing |
| `extraction-service.ts` | Main orchestrator |
| `index.ts` | Public API exports |
| `ipc-handlers/extraction.ts` | IPC handlers |
| `python/spacy-service/main.py` | Python FastAPI service |
