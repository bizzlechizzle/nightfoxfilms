# Document Intelligence Architecture Options
## Abandoned Archive - Strategic Planning Document

**Version:** 1.0
**Date:** 2025-12-13
**Author:** Architecture Review
**Status:** Planning Document for Review

---

## Executive Summary

This document presents four architectural options for implementing comprehensive document intelligence in the Abandoned Archive application. The goal is to extract structured data (dates, people, places, events, organizations) from web sources and documents while maintaining the project's core principles: **offline-first**, **local data ownership**, and **research-grade accuracy**.

### The Challenge

Current regex-based date extraction produces false positives (e.g., "110 to 130 employees" interpreted as dates). We need a robust extraction pipeline that can:

1. **Extract dates** with historical context awareness (1800s-2000s bias)
2. **Extract named entities** (people, organizations, places)
3. **Identify relationships** between entities
4. **Summarize documents** for quick research consumption
5. **Learn from corrections** to improve over time

### Hardware Available

| Machine | CPU | GPU | RAM | Best For |
|---------|-----|-----|-----|----------|
| Mac Studio | M2 Ultra | Integrated (76-core GPU) | 64GB Unified | Primary dev + inference |
| Windows | AMD 5800X3D | NVIDIA RTX 3090 (24GB) | ~32GB? | Heavy CUDA inference |
| Linux #1 | AMD 5950X | AMD 6750XT (12GB) | ~32GB? | ROCm inference |
| Linux #2 | AMD 3800X | Intel Arc B570 (10GB) | ~32GB? | IPEX-LLM inference |

---

# Option Comparison Matrix

| Aspect | Option 1: KISS | Option 2: Local LLM | Option 3: Online LLM | Option 4: SR71 |
|--------|----------------|---------------------|----------------------|----------------|
| **Accuracy** | 75-85% | 90-95% | 95-99% | 95-99% |
| **Speed** | Fastest | Medium | Slow (network) | Adaptive |
| **Cost** | $0 | $0 (after hardware) | $10-100/month | Variable |
| **Offline** | 100% | 100% | 0% | 100% fallback |
| **Setup** | Easy | Medium | Easy | Complex |
| **Maintenance** | Low | Medium | Low | High |
| **Privacy** | Full | Full | Partial* | Full option |

*Online LLMs process your text on external servers

---

# Option 1: KISS (Keep It Simple, Stupid)

## TL;DR

**Best for:** Users who want reliable extraction without complexity, don't need summarization, and prioritize speed over accuracy.

**Stack:** spaCy + dateparser + FastAPI microservice running alongside Electron.

**Why choose this:** Zero cloud dependency, fastest processing, most predictable behavior, no GPU required. Gets you 75-85% of the way there with 10% of the complexity.

---

## Detailed Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    ELECTRON APP (Main Process)                   │
│                                                                  │
│  ┌──────────────┐    HTTP/IPC    ┌──────────────────────────┐  │
│  │   Renderer   │ ◄────────────► │   FastAPI Microservice   │  │
│  │   (Svelte)   │                │   (Python sidecar)       │  │
│  └──────────────┘                └──────────────────────────┘  │
│                                           │                      │
│                                           ▼                      │
│                                  ┌──────────────────────────┐   │
│                                  │  Extraction Pipeline     │   │
│                                  │  • spaCy (en_core_web_lg)│   │
│                                  │  • dateparser            │   │
│                                  │  • Custom rules engine   │   │
│                                  └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Component | Library | Purpose | Size |
|-----------|---------|---------|------|
| NLP Engine | spaCy 3.7+ | NER, POS tagging, dependency parsing | ~50MB model |
| Date Parsing | dateparser 1.2 | 200+ language date parsing | ~5MB |
| API Server | FastAPI | Async Python service | ~2MB |
| Bundler | PyInstaller | Package Python as executable | Varies |

### Extraction Pipeline

```python
# Simplified extraction flow
def extract_entities(text: str) -> ExtractionResult:
    # 1. Pre-process text
    text = clean_html(text)
    text = normalize_whitespace(text)

    # 2. Extract dates with dateparser
    dates = dateparser.search.search_dates(
        text,
        settings={
            'PREFER_DATES_FROM': 'past',
            'PREFER_DAY_OF_MONTH': 'first',
            'REQUIRE_PARTS': ['year'],
        }
    )

    # 3. Run spaCy NER
    doc = nlp(text)
    entities = {
        'people': [ent.text for ent in doc.ents if ent.label_ == 'PERSON'],
        'organizations': [ent.text for ent in doc.ents if ent.label_ == 'ORG'],
        'locations': [ent.text for ent in doc.ents if ent.label_ in ('GPE', 'LOC')],
        'dates': [ent.text for ent in doc.ents if ent.label_ == 'DATE'],
    }

    # 4. Apply domain-specific rules
    entities = apply_urbex_rules(entities, text)

    # 5. Calculate confidence scores
    scored = score_extractions(entities, text)

    return scored
```

### Capabilities

| Feature | Capability | Confidence |
|---------|-----------|------------|
| Date extraction | Full dates, month/year, "circa", decades | 80-90% |
| Person names | First/last names, titles | 70-80% |
| Organizations | Company names, government bodies | 75-85% |
| Locations | Cities, states, addresses | 80-90% |
| Relationships | Basic co-occurrence only | 50-60% |
| Summarization | **Not supported** | N/A |

### Pros

- **Fastest processing** - Milliseconds per document
- **Fully deterministic** - Same input = same output
- **No GPU required** - Runs on any machine
- **Small footprint** - ~100MB total with models
- **Battle-tested** - spaCy used in production by millions
- **200+ languages** - dateparser supports international dates

### Cons

- **No summarization** - Cannot generate TL;DR
- **Limited context** - Can't understand nuanced relationships
- **False positives** - Still susceptible to edge cases
- **No learning** - Cannot improve from corrections
- **Entity resolution** - "John Smith" vs "J. Smith" are different

### Implementation Effort

| Task | Effort | Notes |
|------|--------|-------|
| FastAPI service setup | 2-3 days | Scaffold, endpoints, error handling |
| spaCy pipeline | 3-5 days | Custom components, rules |
| Electron integration | 2-3 days | Process management, IPC |
| Testing suite | 2-3 days | Unit tests, accuracy benchmarks |
| Packaging (PyInstaller) | 1-2 days | Cross-platform builds |
| **Total** | **10-16 days** | |

### Best Use Cases

1. High-volume batch processing
2. Environments where LLMs are prohibited
3. When deterministic output is required
4. Budget-constrained deployments

---

# Option 2: Local LLM

## TL;DR

**Best for:** Power users with capable hardware who want near-cloud accuracy while keeping all data local and private.

**Stack:** Ollama + Qwen2.5-VL or DeepSeek-VL2 for document understanding, with spaCy as preprocessing layer.

**Why choose this:** Full privacy, no ongoing costs, works offline, can be fine-tuned on your specific use case. The M2 Ultra and RTX 3090 can run 32B+ parameter models at usable speeds.

---

## Detailed Architecture

### Components

```
┌────────────────────────────────────────────────────────────────────────┐
│                         ELECTRON APP                                    │
│                                                                         │
│  ┌──────────────┐         ┌──────────────────────────────────────────┐ │
│  │   Renderer   │ ◄─────► │            Extraction Service            │ │
│  │   (Svelte)   │   IPC   │                                          │ │
│  └──────────────┘         │  ┌────────────────────────────────────┐  │ │
│                           │  │  Phase 1: spaCy Pre-processing     │  │ │
│                           │  │  • Sentence segmentation           │  │ │
│                           │  │  • Initial NER (fast)              │  │ │
│                           │  │  • Candidate identification        │  │ │
│                           │  └────────────────────────────────────┘  │ │
│                           │                  │                        │ │
│                           │                  ▼                        │ │
│                           │  ┌────────────────────────────────────┐  │ │
│                           │  │  Phase 2: LLM Refinement           │  │ │
│                           │  │  • Ollama API (localhost:11434)    │  │ │
│                           │  │  • Qwen2.5-VL / DeepSeek-VL2       │  │ │
│                           │  │  • Structured JSON output          │  │ │
│                           │  └────────────────────────────────────┘  │ │
│                           │                  │                        │ │
│                           │                  ▼                        │ │
│                           │  ┌────────────────────────────────────┐  │ │
│                           │  │  Phase 3: Knowledge Integration    │  │ │
│                           │  │  • Entity resolution               │  │ │
│                           │  │  • Relationship extraction         │  │ │
│                           │  │  • Summary generation              │  │ │
│                           │  └────────────────────────────────────┘  │ │
│                           └──────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────┐
                        │     OLLAMA (Background)       │
                        │                               │
                        │  Model: qwen2.5-vl:32b-q4    │
                        │  or: deepseek-vl2:16b        │
                        │                               │
                        │  Memory: 20-40GB              │
                        │  Speed: 15-35 tok/s          │
                        └──────────────────────────────┘
```

### Recommended Models by Hardware

| Hardware | Recommended Model | Quantization | Speed | VRAM Usage |
|----------|-------------------|--------------|-------|------------|
| M2 Ultra 64GB | Qwen2.5-VL-32B | Q5_K_M | ~25 tok/s | ~25GB |
| M2 Ultra 64GB | DeepSeek-VL2-16B | Q8 | ~40 tok/s | ~18GB |
| RTX 3090 24GB | Qwen2.5-VL-14B | Q6_K | ~35 tok/s | ~18GB |
| RTX 3090 24GB | Mistral-Nemo-12B | Q8 | ~50 tok/s | ~14GB |
| AMD 6750XT 12GB | Llama3.2-11B | Q4_K_M | ~25 tok/s | ~10GB |
| Arc B570 10GB | Phi-3.5-Vision-4B | Q8 | ~40 tok/s | ~8GB |

### LLM Prompt Template

```markdown
You are extracting structured information from historical documents about abandoned places.

DOCUMENT:
{text}

Extract the following as JSON:

{
  "dates": [
    {
      "text": "exact text from document",
      "parsed": "YYYY-MM-DD or YYYY-MM or YYYY",
      "type": "build_date|opening|closure|demolition|visit|unknown",
      "confidence": 0.0-1.0,
      "context": "surrounding sentence"
    }
  ],
  "people": [
    {
      "name": "full name",
      "role": "owner|architect|developer|employee|visitor|unknown",
      "mentions": ["list of text mentions"]
    }
  ],
  "organizations": [
    {
      "name": "organization name",
      "type": "company|government|school|hospital|unknown"
    }
  ],
  "summary": "2-3 sentence TL;DR of the document",
  "key_facts": ["bullet point facts"]
}

Only include information explicitly stated in the document. If uncertain, set confidence lower.
```

### Capabilities

| Feature | Capability | Confidence |
|---------|-----------|------------|
| Date extraction | All formats + natural language | 90-95% |
| Person names | Names + roles + relationships | 85-90% |
| Organizations | Full recognition + categorization | 90-95% |
| Locations | Addresses, coordinates, descriptions | 90-95% |
| Relationships | Entity connections + context | 80-85% |
| Summarization | **Full TL;DR generation** | 85-90% |
| Historical context | Understanding "circa", decades | 90-95% |

### Pros

- **Full privacy** - All processing on your hardware
- **No ongoing costs** - One-time hardware investment
- **Offline capable** - Works without internet
- **Summarization** - Can generate TL;DR
- **Context understanding** - Nuanced interpretation
- **Fine-tunable** - Can adapt to your domain

### Cons

- **Hardware dependent** - Needs capable GPU/M-series chip
- **Slower than regex** - 5-30 seconds per document
- **Non-deterministic** - May vary between runs
- **Model management** - Need to track versions
- **Power consumption** - GPU uses significant power

### Hardware-Specific Setup

#### M2 Ultra (macOS)

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull recommended model
ollama pull qwen2.5-vl:32b-q5_K_M

# Test inference
ollama run qwen2.5-vl:32b "Extract dates from: Built in 1923"
```

#### RTX 3090 (Windows/Linux)

```bash
# Install Ollama (Windows: download from ollama.com)
# Linux:
curl -fsSL https://ollama.com/install.sh | sh

# Pull model (fits in 24GB)
ollama pull qwen2.5-vl:14b-q6_K

# Enable CUDA
export OLLAMA_CUDA=1
```

#### Intel Arc B570 (Linux)

```bash
# Requires IPEX-LLM Docker setup
docker run -d \
  --device /dev/dri \
  -p 11434:11434 \
  -v ollama:/root/.ollama \
  intelanalytics/ipex-llm-inference-cpp-xpu:latest

# Pull smaller model (10GB VRAM limit)
ollama pull phi3.5-vision:4b
```

### Implementation Effort

| Task | Effort | Notes |
|------|--------|-------|
| Ollama integration | 2-3 days | API client, health checks |
| Prompt engineering | 3-5 days | Iteration, testing |
| spaCy preprocessing | 2-3 days | Candidate extraction |
| Response parsing | 2-3 days | JSON validation, error handling |
| Hardware abstraction | 2-3 days | Auto-detect best setup |
| Testing & tuning | 3-5 days | Accuracy benchmarks |
| **Total** | **14-22 days** | |

### Best Use Cases

1. Privacy-critical deployments
2. When summarization is essential
3. Complex relationship extraction
4. Users with capable hardware already available

---

# Option 3: Online LLM

## TL;DR

**Best for:** Users who want maximum accuracy with minimal setup, don't mind sending text to cloud services, and prefer pay-as-you-go pricing.

**Stack:** Claude API (Anthropic) or Gemini API (Google) with intelligent batching and caching.

**Why choose this:** Highest accuracy (95-99%), always up-to-date models, zero hardware requirements, scales infinitely. Choose Claude for reliability and reasoning, Gemini for massive context and cost efficiency.

---

## Detailed Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    ELECTRON APP                                  │
│                                                                  │
│  ┌──────────────┐         ┌──────────────────────────────────┐  │
│  │   Renderer   │ ◄─────► │       Extraction Service         │  │
│  │   (Svelte)   │   IPC   │                                  │  │
│  └──────────────┘         │  ┌────────────────────────────┐  │  │
│                           │  │  Request Manager           │  │  │
│                           │  │  • Batching (10 docs/req)  │  │  │
│                           │  │  • Rate limiting           │  │  │
│                           │  │  • Response caching        │  │  │
│                           │  └────────────────────────────┘  │  │
│                           └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                       │
                                       │ HTTPS
                                       ▼
                    ┌───────────────────────────────────┐
                    │         CLOUD LLM APIs            │
                    │                                   │
                    │  ┌─────────────┐  ┌───────────┐  │
                    │  │   Claude    │  │  Gemini   │  │
                    │  │   (Opus)    │  │  (2.5)    │  │
                    │  └─────────────┘  └───────────┘  │
                    │                                   │
                    │  • 200K context (Claude)         │
                    │  • 1M+ context (Gemini)          │
                    │  • Latest model capabilities     │
                    └───────────────────────────────────┘
```

### Provider Comparison

| Aspect | Claude (Anthropic) | Gemini (Google) | Winner |
|--------|-------------------|-----------------|--------|
| **Accuracy** | 95-98% | 94-97% | Claude |
| **Hallucination** | Very low | Low | Claude |
| **Context Window** | 200K tokens | 1M+ tokens | Gemini |
| **Speed** | Medium | Fast | Gemini |
| **Cost (per 1M tokens)** | $15 input / $75 output (Opus) | $1.25 input / $5 output (Flash) | Gemini |
| **Cost (per 1M tokens)** | $3 input / $15 output (Sonnet) | $2.50 input / $15 output (Pro) | Similar |
| **Research features** | Strong reasoning | Deep Research mode | Gemini |
| **Document handling** | Text focused | Native PDF/image | Gemini |
| **Prompt caching** | Yes (discounts) | Limited | Claude |
| **Privacy policy** | Strong, no training | Uses for improvement | Claude |

### Pricing Estimates

Based on typical web source documents (~5,000 tokens each):

| Usage Level | Documents/Month | Claude Sonnet | Gemini Flash | Gemini Pro |
|-------------|-----------------|---------------|--------------|------------|
| Light | 100 | ~$2 | ~$0.65 | ~$2 |
| Medium | 1,000 | ~$20 | ~$6.50 | ~$20 |
| Heavy | 10,000 | ~$200 | ~$65 | ~$200 |
| Enterprise | 100,000 | ~$2,000 | ~$650 | ~$2,000 |

### Recommendation

**For research-focused extraction:** Use **Claude Sonnet 4**
- Better reasoning about historical contexts
- More reliable date interpretation
- Fewer hallucinations on ambiguous text
- Prompt caching reduces repeat costs

**For high-volume processing:** Use **Gemini 2.5 Flash**
- 20x cheaper than Claude for similar quality
- Faster response times
- Massive context for batch processing
- Native PDF/image understanding

### Capabilities

| Feature | Capability | Confidence |
|---------|-----------|------------|
| Date extraction | All formats + complex inference | 95-99% |
| Person names | Names + context + disambiguation | 95-98% |
| Organizations | Full recognition + history | 95-98% |
| Locations | Complete geographic understanding | 95-99% |
| Relationships | Deep entity connections | 90-95% |
| Summarization | **Excellent TL;DR generation** | 95-98% |
| Historical context | Expert-level understanding | 95-99% |
| Cross-reference | Can identify same entity across docs | 85-90% |

### Pros

- **Highest accuracy** - State-of-the-art models
- **Zero hardware** - No GPU needed
- **Always updated** - Latest model capabilities
- **Scales infinitely** - No local bottlenecks
- **Rich features** - PDF/image understanding (Gemini)
- **Simple integration** - Well-documented APIs

### Cons

- **Privacy concerns** - Text sent to third parties
- **Ongoing costs** - Pay-per-use pricing
- **Internet required** - No offline capability
- **Rate limits** - May throttle heavy usage
- **Vendor lock-in** - Dependent on provider
- **Latency** - Network round-trip adds delay

### Implementation Effort

| Task | Effort | Notes |
|------|--------|-------|
| API client setup | 1-2 days | Auth, error handling |
| Request batching | 2-3 days | Optimization |
| Response caching | 2-3 days | SQLite cache layer |
| Prompt engineering | 2-3 days | Less tuning needed |
| Cost monitoring | 1-2 days | Usage tracking |
| Fallback handling | 1-2 days | Offline degradation |
| **Total** | **9-15 days** | |

### Best Use Cases

1. Maximum accuracy requirements
2. Users without powerful hardware
3. When summarization quality is critical
4. Variable workloads (pay for what you use)
5. Teams needing shared infrastructure

---

# Option 4: SR71 Blackbird (Power User Mode)

## TL;DR

**Best for:** The ultimate abandoned archive experience - automatic quality/cost/speed optimization, works online or offline, learns from your corrections, and adapts to your hardware.

**Stack:** All three options unified under an intelligent orchestration layer that picks the best approach for each task.

**Why choose this:** Maximum flexibility, graceful degradation, continuous improvement, and the satisfaction of having a system that's smarter than the sum of its parts.

---

## Philosophy

The SR-71 Blackbird was the fastest plane ever built because it used every advantage available - titanium construction, specialized fuel, and operational tactics that maximized its capabilities. This option does the same: it combines all three approaches and intelligently routes work to the best handler.

## Detailed Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           ELECTRON APP                                        │
│                                                                               │
│  ┌──────────────┐         ┌────────────────────────────────────────────────┐ │
│  │   Renderer   │ ◄─────► │            EXTRACTION ORCHESTRATOR             │ │
│  │   (Svelte)   │   IPC   │                                                │ │
│  └──────────────┘         │  ┌──────────────────────────────────────────┐  │ │
│                           │  │  INTELLIGENT ROUTER                      │  │ │
│                           │  │                                          │  │ │
│                           │  │  Decision Matrix:                        │  │ │
│                           │  │  • Complexity score (simple→complex)     │  │ │
│                           │  │  • User preference (cost/speed/accuracy) │  │ │
│                           │  │  • Network availability                  │  │ │
│                           │  │  • Hardware capability                   │  │ │
│                           │  │  • Historical accuracy on similar docs   │  │ │
│                           │  └──────────────────────────────────────────┘  │ │
│                           │                      │                          │ │
│                           │     ┌────────────────┼────────────────┐        │ │
│                           │     │                │                │        │ │
│                           │     ▼                ▼                ▼        │ │
│                           │ ┌────────┐    ┌───────────┐    ┌──────────┐   │ │
│                           │ │ TIER 1 │    │  TIER 2   │    │  TIER 3  │   │ │
│                           │ │ spaCy  │    │ Local LLM │    │ Cloud LLM│   │ │
│                           │ │ KISS   │    │  Ollama   │    │ Claude/  │   │ │
│                           │ │        │    │           │    │ Gemini   │   │ │
│                           │ └────────┘    └───────────┘    └──────────┘   │ │
│                           │     │                │                │        │ │
│                           │     └────────────────┴────────────────┘        │ │
│                           │                      │                          │ │
│                           │                      ▼                          │ │
│                           │  ┌──────────────────────────────────────────┐  │ │
│                           │  │  LEARNING LAYER                          │  │ │
│                           │  │                                          │  │ │
│                           │  │  • Track accuracy per extraction type    │  │ │
│                           │  │  • Learn from user corrections           │  │ │
│                           │  │  • Adjust routing confidence             │  │ │
│                           │  │  • Fine-tune local models (optional)     │  │ │
│                           │  └──────────────────────────────────────────┘  │ │
│                           └────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Routing Decision Matrix

### Document Complexity Score

| Indicator | Low (→ spaCy) | Medium (→ Local LLM) | High (→ Cloud LLM) |
|-----------|---------------|----------------------|-------------------|
| Text length | < 500 words | 500-5000 words | > 5000 words |
| Date format | Explicit (MM/DD/YYYY) | Mixed formats | Natural language |
| Entity density | Few mentions | Moderate | Many overlapping |
| Relationship complexity | None | Some | Complex narrative |
| Historical ambiguity | Clear dates | Some "circa" | "late 1800s", "turn of century" |
| Summarization needed | No | Optional | Yes |

### User Mode Selection

| Mode | spaCy Weight | Local LLM Weight | Cloud LLM Weight | Use Case |
|------|--------------|------------------|------------------|----------|
| Speed | 70% | 25% | 5% | Batch processing |
| Balanced | 30% | 50% | 20% | Daily use |
| Accuracy | 10% | 30% | 60% | Critical research |
| Offline | 40% | 60% | 0% | Field work |
| Budget | 50% | 50% | 0% | Cost-conscious |

### Cascade Strategy

```
For each document:

1. RUN spaCy extraction (always, ~50ms)
   - If confidence > 0.9 for all entities: DONE
   - If confidence > 0.8 AND no summarization needed: DONE
   - Otherwise: escalate

2. CHECK local LLM availability
   - If available AND (offline mode OR complexity < high):
     - RUN local LLM extraction (~10-30s)
     - Merge with spaCy results
     - If confidence > 0.85: DONE
     - Otherwise: escalate (if online)

3. IF online AND accuracy mode:
   - RUN cloud LLM extraction (~2-5s)
   - Use as ground truth
   - Update learning model with deltas
   - DONE

4. RETURN best available result with confidence scores
```

## Learning System

### Feedback Loop

```
┌─────────────────┐
│  User Reviews   │
│  Extraction     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Correction     │───────┐
│  Interface      │       │
└────────┬────────┘       │
         │                │
         ▼                ▼
┌─────────────────┐  ┌─────────────────┐
│  Learning DB    │  │  Pattern Rules  │
│  (corrections)  │  │  (if repeated)  │
└────────┬────────┘  └────────┬────────┘
         │                    │
         ▼                    ▼
┌─────────────────────────────────────┐
│  Routing Confidence Adjustment      │
│                                     │
│  "Documents about hospitals →       │
│   Local LLM performs better"        │
│                                     │
│  "Short articles with MM/DD/YYYY →  │
│   spaCy is sufficient"              │
└─────────────────────────────────────┘
```

### Metrics Tracked

| Metric | Purpose |
|--------|---------|
| Precision per tier | Which tier gets it right |
| Recall per entity type | Missing entities by tier |
| User correction rate | How often users fix outputs |
| Processing time per tier | Speed benchmarks |
| Cost per document | Cloud API spending |
| Accuracy improvement | Learning effectiveness |

## Capabilities (Combined)

| Feature | Capability | Confidence |
|---------|-----------|------------|
| Date extraction | All formats, all tiers | 95-99% |
| Person names | Full extraction + learning | 95-98% |
| Organizations | Multi-tier validation | 95-99% |
| Locations | Complete geographic | 95-99% |
| Relationships | Best-of-breed per doc | 90-95% |
| Summarization | Cloud or local LLM | 90-98% |
| Historical context | Learned domain expertise | 95-99% |
| **Offline fallback** | Graceful degradation | 80-95% |
| **Continuous improvement** | Gets smarter over time | +2-5%/month |

## Pros

- **Maximum flexibility** - Best tool for each job
- **Graceful degradation** - Always produces results
- **Continuous learning** - Improves with usage
- **Cost optimization** - Uses cheap options when possible
- **Future-proof** - Easy to add new tiers
- **Research-grade** - Suitable for academic work

## Cons

- **Complexity** - More code to maintain
- **Initial setup** - Requires all three options
- **Learning overhead** - Needs corrections to improve
- **Resource usage** - Multiple systems running
- **Decision opacity** - Hard to explain "why this tier"

## Implementation Effort

| Task | Effort | Notes |
|------|--------|-------|
| Option 1 (spaCy) | 10-16 days | Base implementation |
| Option 2 (Local LLM) | 14-22 days | Ollama integration |
| Option 3 (Cloud LLM) | 9-15 days | API clients |
| Orchestrator | 5-8 days | Routing logic |
| Learning system | 5-8 days | Correction tracking |
| UI for mode selection | 2-3 days | Settings integration |
| Dashboard/metrics | 3-5 days | Performance visibility |
| **Total** | **48-77 days** | Can be phased |

## Phased Implementation

### Phase 1: Foundation (Weeks 1-3)
- Implement Option 1 (spaCy + dateparser)
- Basic extraction pipeline working
- UI integration for review queue

### Phase 2: Local Intelligence (Weeks 4-6)
- Add Option 2 (Ollama)
- Basic tier switching
- Summarization capability

### Phase 3: Cloud Power (Weeks 7-8)
- Add Option 3 (Claude/Gemini)
- Full cascade logic
- Cost tracking

### Phase 4: Learning (Weeks 9-10)
- Correction interface
- Feedback database
- Routing optimization

### Phase 5: Polish (Weeks 11-12)
- Dashboard
- Performance tuning
- Documentation

## Best Use Cases

1. **Primary application architecture** - This IS the production system
2. Professional researchers needing reliability
3. Archives that grow over time (learning benefits)
4. Mixed online/offline usage patterns
5. Users who want "set and forget" intelligence

---

# Integration with Existing App

## Affected Systems

| System | Impact | Changes Needed |
|--------|--------|----------------|
| Web Source Scraping | Medium | Add extraction trigger |
| Date Extraction Queue | High | Replace/enhance current system |
| Timeline Events | Medium | Populate from extractions |
| Location Details | Low | Display extracted data |
| Settings | Medium | Add extraction preferences |
| Image Enhancement | None | Separate system |

## Database Schema Additions

```sql
-- Entity extractions (replaces simple date_extractions)
CREATE TABLE entity_extractions (
  extraction_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,  -- 'web_source', 'document', 'note'
  source_id TEXT NOT NULL,
  locid TEXT,

  -- Extraction metadata
  entity_type TEXT NOT NULL,  -- 'date', 'person', 'organization', 'location'
  raw_text TEXT NOT NULL,
  normalized_value TEXT,

  -- For dates specifically
  date_start TEXT,
  date_end TEXT,
  date_precision TEXT,
  date_category TEXT,

  -- For entities
  entity_role TEXT,
  entity_attributes TEXT,  -- JSON

  -- Confidence and provenance
  overall_confidence REAL,
  extraction_tier TEXT,  -- 'spacy', 'local_llm', 'cloud_llm'
  model_used TEXT,

  -- Review workflow
  status TEXT DEFAULT 'pending',
  reviewed_at TEXT,
  reviewed_by TEXT,
  user_correction TEXT,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Document summaries
CREATE TABLE document_summaries (
  summary_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  locid TEXT,

  summary_text TEXT,
  key_facts TEXT,  -- JSON array

  extraction_tier TEXT,
  model_used TEXT,
  confidence REAL,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Learning feedback
CREATE TABLE extraction_feedback (
  feedback_id TEXT PRIMARY KEY,
  extraction_id TEXT NOT NULL,

  original_value TEXT,
  corrected_value TEXT,
  feedback_type TEXT,  -- 'correction', 'rejection', 'approval'

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (extraction_id) REFERENCES entity_extractions(extraction_id)
);
```

## Recommended Implementation Order

1. **Option 1 first** - Get spaCy working as foundation
2. **Option 2 second** - Add local LLM for summarization
3. **Option 3 third** - Add cloud as quality benchmark
4. **Option 4 last** - Wire together with orchestration

This allows incremental delivery while building toward the full system.

---

# Final Recommendation

## For Your Specific Setup

Given your hardware (M2 Ultra 64GB, RTX 3090 24GB, multiple Linux machines) and project goals (research-grade archive, offline-first, historical documents):

### Start with: **Option 2 (Local LLM)** as primary
- Your M2 Ultra can run 32B parameter models comfortably
- Full privacy for potentially sensitive historical research
- Summarization capability built-in
- No ongoing costs

### Add: **Option 1 (spaCy)** as fast-path
- Pre-filter obvious cases
- Reduce LLM load by 50-70%
- Near-instant response for simple documents

### Consider later: **Option 3 (Cloud)** for quality assurance
- Periodic batch validation against cloud LLM
- Use for "difficult" documents flagged by user
- Claude for accuracy, Gemini for cost

### Goal: **Option 4 (SR71)** architecture from the start
- Build with orchestration in mind
- Even if only using one tier initially
- Makes future expansion seamless

## Concrete First Steps

1. **This week:** Set up Ollama on M2 Ultra with qwen2.5-vl:32b
2. **Week 2:** Create extraction service endpoint in Electron
3. **Week 3:** Wire up to web source processing
4. **Week 4:** Add review queue UI
5. **Ongoing:** Collect accuracy data, adjust approach

---

# Appendix: Research Sources

## LLM Hardware & Performance
- [Best Local LLM for Apple Silicon](https://apxml.com/posts/best-local-llm-apple-silicon-mac)
- [Local LLM Hardware Guide 2025](https://introl.com/blog/local-llm-hardware-pricing-guide-2025)
- [GPU Benchmarks with Large Language Models](https://www.hardware-corner.net/guides/gpu-benchmark-large-language-models/)
- [Best GPUs for Local LLM Inference 2025](https://localllm.in/blog/best-gpus-llm-inference-2025)
- [Ollama on Mac Silicon](https://johnwlittle.com/ollama-on-mac-silicon-local-ai-for-m-series-macs/)

## LLM Comparisons
- [ChatGPT vs Claude vs Gemini 2025](https://creatoreconomy.so/p/chatgpt-vs-claude-vs-gemini-the-best-ai-model-for-each-use-case-2025)
- [Gemini vs Claude Full Report](https://www.datastudios.org/post/google-gemini-vs-anthropic-claude-full-report-and-comparison-august-2025-updated)
- [LLM API Pricing Comparison 2025](https://intuitionlabs.ai/articles/llm-api-pricing-comparison-2025)
- [Gemini Deep Research vs Claude 4.5](https://skywork.ai/blog/ai-agent/gemini-vs-claude/)

## NLP & Entity Extraction
- [spaCy NER vs LLM Comparison](https://sunscrapers.com/blog/named-entity-recognition-comparison-spacy-chatgpt-bard-llama2/)
- [spacy-llm Integration](https://github.com/explosion/spacy-llm)
- [dateparser Documentation](https://dateparser.readthedocs.io/)

## Intel Arc AI
- [IPEX-LLM for Intel GPUs](https://github.com/intel/ipex-llm)
- [Intel Arc B580 for Local AI](https://www.propelrc.com/intel-arc-b580-and-a770-for-local-ai-software/)

## FastAPI Integration
- [FastAPI + Electron Integration](https://github.com/gnoviawan/fast-api-electron-js)
- [FastAPI for Microservices 2025](https://talent500.com/blog/fastapi-microservices-python-api-design-patterns-2025/)

---

*Document generated 2025-12-13. Hardware recommendations and pricing subject to change.*
