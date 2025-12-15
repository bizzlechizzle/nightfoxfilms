# Document Intelligence Implementation Guide

**Version:** 1.0
**Date:** 2025-12-13
**Status:** Implementation Plan (Approved)
**Scope:** Option 1 (spaCy/KISS) + Option 2 (Network LLM) with unified provider interface

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Phase 1: Provider Interface](#phase-1-provider-interface)
4. [Phase 2: spaCy Service (Option 1)](#phase-2-spacy-service)
5. [Phase 3: LLM Provider (Option 2)](#phase-3-llm-provider)
6. [Phase 4: Electron Integration](#phase-4-electron-integration)
7. [Phase 5: UI Components](#phase-5-ui-components)
8. [Database Schema](#database-schema)
9. [Testing Strategy](#testing-strategy)
10. [Bundling & Distribution](#bundling-distribution)

---

## Overview

### What We're Building

A **unified extraction system** that can use multiple backends:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         YOUR ELECTRON APP                                │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    EXTRACTION ORCHESTRATOR                         │ │
│  │                                                                    │ │
│  │   extract(text) → tries providers in order until success           │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│            ┌───────────────────────┼───────────────────────┐            │
│            │                       │                       │            │
│            ▼                       ▼                       ▼            │
│     ┌────────────┐          ┌────────────┐          ┌────────────┐     │
│     │   spaCy    │          │   Ollama   │          │  Cloud LLM │     │
│     │  Provider  │          │  Provider  │          │  Provider  │     │
│     │            │          │            │          │            │     │
│     │ localhost  │          │ ANY host   │          │  Claude    │     │
│     │ :8100      │          │ :11434     │          │  Gemini    │     │
│     └────────────┘          └────────────┘          │  OpenAI    │     │
│                                    │                └────────────┘     │
│                                    │                                    │
└────────────────────────────────────┼────────────────────────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │                                 │
                    ▼                                 ▼
           ┌──────────────┐                 ┌──────────────┐
           │  Local       │                 │  Remote      │
           │  Ollama      │                 │  Ollama      │
           │              │                 │              │
           │  M2 Ultra    │                 │  RTX 3090    │
           │  This Mac    │                 │  Other PC    │
           └──────────────┘                 └──────────────┘
```

### Why This Design?

1. **Same interface for everything** - Whether you're using spaCy, local Ollama, remote Ollama, or Claude API, the code that calls it is identical
2. **Network-transparent** - Ollama running on your M2 Ultra can serve your Windows machine
3. **Graceful degradation** - If cloud is unavailable, falls back to local; if local is unavailable, falls back to spaCy
4. **Future-proof** - Adding new providers (OpenRouter, Groq, local llama.cpp) is just implementing one interface

### What Gets Bundled

| Component | Bundled? | Size | Notes |
|-----------|----------|------|-------|
| spaCy + model | Yes | ~150MB | Python executable via PyInstaller |
| dateparser | Yes | ~10MB | Included in Python bundle |
| Ollama | No | User installs | We provide setup instructions |
| Default model | Optional | ~4-8GB | Can pre-download qwen2.5:7b |

---

## Architecture

### File Structure

```
packages/desktop/
├── electron/
│   ├── services/
│   │   ├── extraction/                    # NEW: Extraction system
│   │   │   ├── providers/                 # Provider implementations
│   │   │   │   ├── base-provider.ts       # Abstract interface
│   │   │   │   ├── spacy-provider.ts      # spaCy + dateparser
│   │   │   │   ├── ollama-provider.ts     # Ollama (local or remote)
│   │   │   │   └── cloud-provider.ts      # Claude/Gemini/OpenAI
│   │   │   ├── extraction-service.ts      # Main orchestrator
│   │   │   ├── extraction-types.ts        # Type definitions
│   │   │   └── prompt-templates.ts        # LLM prompts
│   │   └── ...existing services
│   ├── main/
│   │   └── ipc-handlers/
│   │       └── extraction-handlers.ts     # NEW: IPC handlers
│   └── preload/
│       └── preload.cjs                    # Add extraction API
├── src/
│   ├── components/
│   │   └── extraction/                    # NEW: UI components
│   │       ├── ExtractionQueue.svelte
│   │       ├── ExtractionReview.svelte
│   │       └── ProviderSettings.svelte
│   └── pages/
│       └── Settings.svelte                # Add extraction settings
└── resources/
    └── extraction/                        # NEW: Bundled resources
        └── spacy-service/                 # PyInstaller bundle
            ├── spacy-service.exe          # Windows
            ├── spacy-service              # macOS/Linux
            └── models/                    # spaCy models
```

### Data Flow (Detailed)

```
User clicks "Extract" on a web source
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RENDERER (Svelte)                                                   │
│                                                                      │
│  await window.electron.extraction.extract({                          │
│    text: webSource.extracted_text,                                   │
│    sourceType: 'web_source',                                         │
│    sourceId: webSource.source_id,                                    │
│    locid: webSource.locid                                            │
│  })                                                                  │
└─────────────────────────────────────────────────────────────────────┘
            │
            │ IPC: 'extraction:extract'
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MAIN PROCESS (extraction-handlers.ts)                               │
│                                                                      │
│  ipcMain.handle('extraction:extract', async (_, input) => {          │
│    return extractionService.extract(input);                          │
│  })                                                                  │
└─────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  EXTRACTION SERVICE (extraction-service.ts)                          │
│                                                                      │
│  1. Get enabled providers from settings                              │
│  2. Sort by priority (user-configured)                               │
│  3. Try each provider until one succeeds:                            │
│                                                                      │
│     for (const provider of enabledProviders) {                       │
│       if (await provider.isAvailable()) {                            │
│         try {                                                        │
│           return await provider.extract(input);                      │
│         } catch (e) {                                                │
│           log(`${provider.name} failed, trying next...`);            │
│         }                                                            │
│       }                                                              │
│     }                                                                │
└─────────────────────────────────────────────────────────────────────┘
            │
            ▼ (example: OllamaProvider selected)
┌─────────────────────────────────────────────────────────────────────┐
│  OLLAMA PROVIDER (ollama-provider.ts)                                │
│                                                                      │
│  1. Connect to configured endpoint (localhost:11434 or remote)       │
│  2. Build prompt from template                                       │
│  3. Call Ollama API: POST /api/generate                              │
│  4. Parse JSON response                                              │
│  5. Validate and normalize results                                   │
│  6. Return ExtractionResult                                          │
└─────────────────────────────────────────────────────────────────────┘
            │
            │ HTTP to Ollama server
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  OLLAMA SERVER (on any machine)                                      │
│                                                                      │
│  Running model: qwen2.5:7b or qwen2.5-vl:32b                        │
│  Processes text, returns structured JSON                             │
└─────────────────────────────────────────────────────────────────────┘
            │
            │ Response back up the chain
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SAVE TO DATABASE                                                    │
│                                                                      │
│  entity_extractions table: dates, people, orgs, locations            │
│  document_summaries table: TL;DR text                                │
│  extraction_jobs table: status tracking                              │
└─────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RENDERER UPDATED                                                    │
│                                                                      │
│  Extraction queue shows new pending items                            │
│  User can review and approve/reject/correct                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Provider Interface

### Step 1.1: Define Types

**File: `packages/desktop/electron/services/extraction/extraction-types.ts`**

```typescript
/**
 * Extraction Types
 *
 * These types define the contract between the extraction service
 * and all providers. Every provider must return data in this format.
 */

// ============================================================
// INPUT TYPES
// ============================================================

/**
 * What we send to an extraction provider
 */
export interface ExtractionInput {
  /** The text to extract from */
  text: string;

  /** Where this text came from */
  sourceType: 'web_source' | 'document' | 'note' | 'media_caption';

  /** ID of the source record */
  sourceId: string;

  /** Associated location (optional) */
  locid?: string;

  /** What to extract (if not specified, extract everything) */
  extractTypes?: Array<'dates' | 'people' | 'organizations' | 'locations' | 'summary'>;

  /** Article/document date for relative date resolution */
  articleDate?: string;
}

// ============================================================
// OUTPUT TYPES
// ============================================================

/**
 * A single extracted date
 */
export interface ExtractedDate {
  /** Exact text from document */
  rawText: string;

  /** Parsed date in ISO format: YYYY, YYYY-MM, or YYYY-MM-DD */
  parsedDate: string | null;

  /** For date ranges: end date */
  parsedDateEnd?: string | null;

  /** How precise is this date? */
  precision: 'exact' | 'month' | 'year' | 'decade' | 'approximate';

  /** What kind of date is this? */
  category: 'build_date' | 'opening' | 'closure' | 'demolition' | 'visit' | 'publication' | 'unknown';

  /** 0-1 confidence score */
  confidence: number;

  /** Surrounding sentence for context */
  context: string;

  /** Is this approximate? (circa, about, etc.) */
  isApproximate: boolean;
}

/**
 * A single extracted person
 */
export interface ExtractedPerson {
  /** Full name as found */
  name: string;

  /** Role in relation to the location */
  role: 'owner' | 'architect' | 'developer' | 'employee' | 'founder' | 'visitor' | 'unknown';

  /** All text mentions of this person */
  mentions: string[];

  /** Confidence score */
  confidence: number;
}

/**
 * A single extracted organization
 */
export interface ExtractedOrganization {
  /** Organization name */
  name: string;

  /** Type of organization */
  type: 'company' | 'government' | 'school' | 'hospital' | 'church' | 'unknown';

  /** All text mentions */
  mentions: string[];

  /** Confidence score */
  confidence: number;
}

/**
 * A single extracted location reference
 */
export interface ExtractedLocation {
  /** Location name or address */
  name: string;

  /** Type: city, address, landmark, etc. */
  type: 'city' | 'state' | 'address' | 'landmark' | 'region' | 'unknown';

  /** Confidence score */
  confidence: number;
}

/**
 * Complete extraction result from a provider
 */
export interface ExtractionResult {
  /** Which provider produced this result */
  provider: string;

  /** Model used (e.g., "qwen2.5:7b", "en_core_web_lg", "claude-sonnet-4") */
  model: string;

  /** Extracted dates */
  dates: ExtractedDate[];

  /** Extracted people */
  people: ExtractedPerson[];

  /** Extracted organizations */
  organizations: ExtractedOrganization[];

  /** Extracted location references */
  locations: ExtractedLocation[];

  /** Document summary (TL;DR) */
  summary?: string;

  /** Key facts as bullet points */
  keyFacts?: string[];

  /** Processing time in milliseconds */
  processingTimeMs: number;

  /** Any warnings or notes */
  warnings?: string[];
}

// ============================================================
// PROVIDER TYPES
// ============================================================

/**
 * Provider configuration (stored in settings)
 */
export interface ProviderConfig {
  /** Unique provider ID */
  id: string;

  /** Display name */
  name: string;

  /** Provider type */
  type: 'spacy' | 'ollama' | 'openai' | 'anthropic' | 'google';

  /** Is this provider enabled? */
  enabled: boolean;

  /** Priority (lower = tried first) */
  priority: number;

  /** Provider-specific settings */
  settings: {
    /** For spaCy: path to executable */
    executablePath?: string;

    /** For Ollama: host (e.g., "localhost", "192.168.1.100") */
    host?: string;

    /** For Ollama: port (default 11434) */
    port?: number;

    /** For Ollama: model name */
    model?: string;

    /** For cloud providers: API key */
    apiKey?: string;

    /** For cloud providers: model name */
    cloudModel?: string;

    /** Request timeout in ms */
    timeout?: number;
  };
}

/**
 * Provider status (runtime state)
 */
export interface ProviderStatus {
  id: string;
  available: boolean;
  lastCheck: string;
  lastError?: string;
  modelInfo?: {
    name: string;
    size?: string;
    quantization?: string;
  };
}
```

### Step 1.2: Define Base Provider Interface

**File: `packages/desktop/electron/services/extraction/providers/base-provider.ts`**

```typescript
/**
 * Base Provider Interface
 *
 * Every extraction provider must implement this interface.
 * This ensures consistent behavior across spaCy, Ollama, and cloud providers.
 */

import type {
  ExtractionInput,
  ExtractionResult,
  ProviderConfig,
  ProviderStatus,
} from '../extraction-types';

/**
 * Abstract base class for all extraction providers
 */
export abstract class BaseExtractionProvider {
  /** Provider configuration */
  protected config: ProviderConfig;

  /** Last known status */
  protected status: ProviderStatus;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.status = {
      id: config.id,
      available: false,
      lastCheck: new Date().toISOString(),
    };
  }

  // ============================================================
  // ABSTRACT METHODS (must be implemented by each provider)
  // ============================================================

  /**
   * Check if this provider is available and ready to use.
   * For Ollama: can we connect to the server?
   * For spaCy: is the executable present and working?
   * For cloud: is the API key valid?
   */
  abstract checkAvailability(): Promise<ProviderStatus>;

  /**
   * Perform the actual extraction.
   * This is where the magic happens.
   */
  abstract extract(input: ExtractionInput): Promise<ExtractionResult>;

  /**
   * Get information about the model being used.
   * Useful for displaying to the user.
   */
  abstract getModelInfo(): Promise<{ name: string; size?: string; description?: string }>;

  // ============================================================
  // SHARED METHODS (inherited by all providers)
  // ============================================================

  /**
   * Get provider ID
   */
  getId(): string {
    return this.config.id;
  }

  /**
   * Get provider display name
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * Get provider type
   */
  getType(): string {
    return this.config.type;
  }

  /**
   * Check if provider is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get priority (lower = higher priority)
   */
  getPriority(): number {
    return this.config.priority;
  }

  /**
   * Quick availability check using cached status
   * (Use checkAvailability() for fresh check)
   */
  async isAvailable(): Promise<boolean> {
    // If last check was more than 30 seconds ago, refresh
    const lastCheck = new Date(this.status.lastCheck);
    const now = new Date();
    const ageMs = now.getTime() - lastCheck.getTime();

    if (ageMs > 30000) {
      this.status = await this.checkAvailability();
    }

    return this.status.available;
  }

  /**
   * Get last known status
   */
  getStatus(): ProviderStatus {
    return { ...this.status };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...config };
    // Force availability recheck
    this.status.lastCheck = new Date(0).toISOString();
  }
}
```

---

## Phase 2: spaCy Service

### Step 2.1: Python Service

This is a standalone Python application that runs as a sidecar process.
We'll bundle it with PyInstaller so users don't need Python installed.

**File: `resources/extraction/spacy-service/main.py`**

```python
#!/usr/bin/env python3
"""
spaCy Extraction Service

A FastAPI server that provides NLP extraction capabilities.
This runs as a sidecar process alongside Electron.

Features:
- Named Entity Recognition (NER) via spaCy
- Date parsing via dateparser
- Fast startup, low memory footprint
- JSON API compatible with our TypeScript types
"""

import os
import sys
import json
import time
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime

# FastAPI for the HTTP server
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# NLP libraries
import spacy
import dateparser
from dateparser.search import search_dates

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('spacy-service')

# ============================================================
# CONFIGURATION
# ============================================================

# Port to run on (can be overridden by environment variable)
PORT = int(os.environ.get('SPACY_SERVICE_PORT', 8100))

# spaCy model to use
# en_core_web_lg is best for accuracy (~50MB)
# en_core_web_md is a good balance (~40MB)
# en_core_web_sm is fastest but less accurate (~12MB)
SPACY_MODEL = os.environ.get('SPACY_MODEL', 'en_core_web_lg')

# Dateparser settings optimized for historical documents
DATEPARSER_SETTINGS = {
    'PREFER_DATES_FROM': 'past',  # Assume dates are in the past
    'PREFER_DAY_OF_MONTH': 'first',  # Ambiguous day → use 1st
    'REQUIRE_PARTS': ['year'],  # Must have a year
    'RELATIVE_BASE': datetime.now(),  # Base for relative dates
}

# ============================================================
# PYDANTIC MODELS (match TypeScript types)
# ============================================================

class ExtractionInput(BaseModel):
    text: str
    sourceType: str = 'unknown'
    sourceId: str = ''
    locid: Optional[str] = None
    extractTypes: Optional[List[str]] = None
    articleDate: Optional[str] = None

class ExtractedDate(BaseModel):
    rawText: str
    parsedDate: Optional[str]
    parsedDateEnd: Optional[str] = None
    precision: str
    category: str
    confidence: float
    context: str
    isApproximate: bool

class ExtractedPerson(BaseModel):
    name: str
    role: str
    mentions: List[str]
    confidence: float

class ExtractedOrganization(BaseModel):
    name: str
    type: str
    mentions: List[str]
    confidence: float

class ExtractedLocation(BaseModel):
    name: str
    type: str
    confidence: float

class ExtractionResult(BaseModel):
    provider: str
    model: str
    dates: List[ExtractedDate]
    people: List[ExtractedPerson]
    organizations: List[ExtractedOrganization]
    locations: List[ExtractedLocation]
    summary: Optional[str] = None
    keyFacts: Optional[List[str]] = None
    processingTimeMs: int
    warnings: Optional[List[str]] = None

class HealthResponse(BaseModel):
    status: str
    model: str
    version: str

# ============================================================
# GLOBAL STATE
# ============================================================

# spaCy model (loaded once at startup)
nlp = None

# ============================================================
# EXTRACTION LOGIC
# ============================================================

# Keywords for date category detection
DATE_CATEGORY_KEYWORDS = {
    'build_date': [
        'built', 'constructed', 'erected', 'established', 'founded',
        'completed', 'construction', 'dating from', 'dates from',
        'dates back', 'originated'
    ],
    'opening': [
        'opened', 'inaugurated', 'grand opening', 'began operations',
        'first opened', 'doors opened', 'ribbon cutting', 'launched'
    ],
    'closure': [
        'closed', 'shut down', 'abandoned', 'ceased operations',
        'shuttered', 'went out of business', 'closed its doors',
        'closure', 'closing'
    ],
    'demolition': [
        'demolished', 'torn down', 'razed', 'destroyed', 'bulldozed',
        'leveled', 'wrecking ball', 'demolition'
    ],
    'visit': [
        'visited', 'explored', 'trip', 'photographed', 'toured',
        'expedition', 'urbex'
    ],
    'publication': [
        'published', 'posted', 'article', 'updated', 'written',
        'reported', 'dated'
    ]
}

def detect_date_category(text: str, date_position: int) -> tuple[str, float]:
    """
    Detect the category of a date based on surrounding keywords.
    Returns (category, confidence).
    """
    # Get context around the date (100 chars before and after)
    start = max(0, date_position - 100)
    end = min(len(text), date_position + 100)
    context = text[start:end].lower()

    for category, keywords in DATE_CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            if keyword in context:
                # Calculate distance-based confidence
                keyword_pos = context.find(keyword)
                date_pos_in_context = date_position - start
                distance = abs(keyword_pos - date_pos_in_context)

                # Closer = higher confidence
                if distance < 20:
                    confidence = 0.9
                elif distance < 50:
                    confidence = 0.7
                else:
                    confidence = 0.5

                return category, confidence

    return 'unknown', 0.3

def extract_dates_with_dateparser(text: str) -> List[ExtractedDate]:
    """
    Extract dates using dateparser library.
    This handles natural language dates like "March 15, 1968" and "circa 1920".
    """
    results = []

    # Use dateparser's search_dates to find all dates in text
    found_dates = search_dates(
        text,
        settings=DATEPARSER_SETTINGS,
        languages=['en']
    )

    if not found_dates:
        return results

    for raw_text, parsed_date in found_dates:
        # Skip very short matches (likely false positives)
        if len(raw_text) < 4:
            continue

        # Determine precision
        precision = 'exact'
        if parsed_date.day == 1 and '1' not in raw_text.split()[-1]:
            # Day was defaulted, so we only have month precision
            if parsed_date.month == 1:
                precision = 'year'
            else:
                precision = 'month'

        # Check for approximate indicators
        is_approximate = any(word in raw_text.lower() for word in [
            'circa', 'c.', 'ca.', 'about', 'around', 'approximately',
            'late', 'early', 'mid', 'mid-'
        ])

        if is_approximate:
            precision = 'approximate'

        # Handle decades
        if any(decade in raw_text.lower() for decade in ['1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s']):
            precision = 'decade'
            is_approximate = True

        # Find position in original text for category detection
        position = text.find(raw_text)
        category, cat_confidence = detect_date_category(text, position)

        # Format the parsed date
        if precision == 'year' or precision == 'decade' or precision == 'approximate':
            parsed_str = str(parsed_date.year)
        elif precision == 'month':
            parsed_str = f"{parsed_date.year}-{parsed_date.month:02d}"
        else:
            parsed_str = parsed_date.strftime('%Y-%m-%d')

        # Get surrounding context
        context_start = max(0, position - 50)
        context_end = min(len(text), position + len(raw_text) + 50)
        context = text[context_start:context_end].strip()

        # Calculate overall confidence
        confidence = cat_confidence
        if precision in ['exact', 'month']:
            confidence = min(1.0, confidence + 0.1)

        results.append(ExtractedDate(
            rawText=raw_text,
            parsedDate=parsed_str,
            precision=precision,
            category=category,
            confidence=round(confidence, 2),
            context=context,
            isApproximate=is_approximate
        ))

    return results

def extract_with_spacy(text: str) -> dict:
    """
    Extract entities using spaCy NER.
    """
    doc = nlp(text)

    # Group entities by type
    people = {}
    organizations = {}
    locations = {}
    spacy_dates = []

    for ent in doc.ents:
        if ent.label_ == 'PERSON':
            name = ent.text.strip()
            if name not in people:
                people[name] = {'mentions': [], 'positions': []}
            people[name]['mentions'].append(ent.text)
            people[name]['positions'].append(ent.start_char)

        elif ent.label_ == 'ORG':
            name = ent.text.strip()
            if name not in organizations:
                organizations[name] = {'mentions': [], 'type': 'unknown'}
            organizations[name]['mentions'].append(ent.text)

        elif ent.label_ in ('GPE', 'LOC', 'FAC'):
            name = ent.text.strip()
            if name not in locations:
                loc_type = 'city' if ent.label_ == 'GPE' else 'landmark' if ent.label_ == 'FAC' else 'region'
                locations[name] = {'type': loc_type}

        elif ent.label_ == 'DATE':
            # spaCy DATE entities (supplement dateparser)
            spacy_dates.append(ent.text)

    return {
        'people': people,
        'organizations': organizations,
        'locations': locations,
        'spacy_dates': spacy_dates
    }

def perform_extraction(input_data: ExtractionInput) -> ExtractionResult:
    """
    Main extraction function that combines dateparser and spaCy.
    """
    start_time = time.time()
    warnings = []

    text = input_data.text

    # Extract dates with dateparser
    dates = extract_dates_with_dateparser(text)

    # Extract entities with spaCy
    spacy_results = extract_with_spacy(text)

    # Convert spaCy results to our format
    people = [
        ExtractedPerson(
            name=name,
            role='unknown',  # spaCy doesn't detect roles
            mentions=data['mentions'],
            confidence=0.75  # spaCy NER is generally reliable
        )
        for name, data in spacy_results['people'].items()
    ]

    organizations = [
        ExtractedOrganization(
            name=name,
            type=data['type'],
            mentions=data['mentions'],
            confidence=0.8
        )
        for name, data in spacy_results['organizations'].items()
    ]

    locations = [
        ExtractedLocation(
            name=name,
            type=data['type'],
            confidence=0.8
        )
        for name, data in spacy_results['locations'].items()
    ]

    # Calculate processing time
    processing_time = int((time.time() - start_time) * 1000)

    return ExtractionResult(
        provider='spacy',
        model=SPACY_MODEL,
        dates=dates,
        people=people,
        organizations=organizations,
        locations=locations,
        summary=None,  # spaCy doesn't do summarization
        keyFacts=None,
        processingTimeMs=processing_time,
        warnings=warnings if warnings else None
    )

# ============================================================
# FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title="spaCy Extraction Service",
    description="NLP extraction service for Abandoned Archive",
    version="1.0.0"
)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    """Load spaCy model on startup."""
    global nlp
    logger.info(f"Loading spaCy model: {SPACY_MODEL}")
    try:
        nlp = spacy.load(SPACY_MODEL)
        logger.info(f"spaCy model loaded successfully")
    except OSError:
        logger.error(f"Could not load spaCy model: {SPACY_MODEL}")
        logger.info("Attempting to download model...")
        os.system(f"python -m spacy download {SPACY_MODEL}")
        nlp = spacy.load(SPACY_MODEL)

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy" if nlp else "unhealthy",
        model=SPACY_MODEL,
        version=spacy.__version__
    )

@app.post("/extract", response_model=ExtractionResult)
async def extract(input_data: ExtractionInput):
    """
    Extract entities from text.

    This is the main extraction endpoint. Send text and get back
    structured data including dates, people, organizations, and locations.
    """
    if not nlp:
        raise HTTPException(status_code=503, detail="spaCy model not loaded")

    if not input_data.text or len(input_data.text.strip()) < 10:
        raise HTTPException(status_code=400, detail="Text too short for extraction")

    try:
        result = perform_extraction(input_data)
        return result
    except Exception as e:
        logger.exception("Extraction failed")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
async def root():
    """Root endpoint with basic info."""
    return {
        "service": "spaCy Extraction Service",
        "version": "1.0.0",
        "model": SPACY_MODEL,
        "endpoints": {
            "health": "/health",
            "extract": "/extract (POST)"
        }
    }

# ============================================================
# MAIN ENTRY POINT
# ============================================================

if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting spaCy service on port {PORT}")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
```

### Step 2.2: Requirements File

**File: `resources/extraction/spacy-service/requirements.txt`**

```
fastapi==0.109.0
uvicorn==0.27.0
pydantic==2.5.3
spacy==3.7.2
dateparser==1.2.0
```

### Step 2.3: spaCy Provider (TypeScript)

**File: `packages/desktop/electron/services/extraction/providers/spacy-provider.ts`**

```typescript
/**
 * spaCy Provider
 *
 * Connects to the local spaCy FastAPI service.
 * This provider offers fast, deterministic extraction without needing an LLM.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { BaseExtractionProvider } from './base-provider';
import type {
  ExtractionInput,
  ExtractionResult,
  ProviderConfig,
  ProviderStatus,
} from '../extraction-types';

export class SpacyProvider extends BaseExtractionProvider {
  private process: ChildProcess | null = null;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    const port = config.settings.port || 8100;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  /**
   * Start the spaCy service process if not running
   */
  private async ensureServiceRunning(): Promise<void> {
    // Check if already running
    if (this.process && !this.process.killed) {
      return;
    }

    // Find the executable
    const executablePath = this.getExecutablePath();

    if (!executablePath) {
      throw new Error('spaCy service executable not found');
    }

    // Start the process
    console.log(`Starting spaCy service: ${executablePath}`);

    const port = this.config.settings.port || 8100;

    this.process = spawn(executablePath, [], {
      env: {
        ...process.env,
        SPACY_SERVICE_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data) => {
      console.log(`[spaCy] ${data.toString().trim()}`);
    });

    this.process.stderr?.on('data', (data) => {
      console.error(`[spaCy] ${data.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      console.log(`spaCy service exited with code ${code}`);
      this.process = null;
    });

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

    throw new Error('spaCy service failed to start within 30 seconds');
  }

  /**
   * Get path to the spaCy executable
   */
  private getExecutablePath(): string | null {
    // Check configured path first
    if (this.config.settings.executablePath) {
      return this.config.settings.executablePath;
    }

    // Look in resources directory
    const resourcesPath = process.resourcesPath || path.join(app.getAppPath(), 'resources');

    const platform = process.platform;
    const execName = platform === 'win32' ? 'spacy-service.exe' : 'spacy-service';

    const possiblePaths = [
      path.join(resourcesPath, 'extraction', 'spacy-service', execName),
      path.join(app.getAppPath(), 'resources', 'extraction', 'spacy-service', execName),
      // Development path
      path.join(app.getAppPath(), '..', '..', 'resources', 'extraction', 'spacy-service', execName),
    ];

    for (const p of possiblePaths) {
      try {
        const fs = require('fs');
        if (fs.existsSync(p)) {
          return p;
        }
      } catch {
        // Continue checking
      }
    }

    return null;
  }

  /**
   * Check if spaCy service is available
   */
  async checkAvailability(): Promise<ProviderStatus> {
    try {
      await this.ensureServiceRunning();

      const response = await fetch(`${this.baseUrl}/health`);
      const data = await response.json();

      this.status = {
        id: this.config.id,
        available: data.status === 'healthy',
        lastCheck: new Date().toISOString(),
        modelInfo: {
          name: data.model,
          size: 'medium',
        },
      };
    } catch (error) {
      this.status = {
        id: this.config.id,
        available: false,
        lastCheck: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    return this.status;
  }

  /**
   * Perform extraction via spaCy service
   */
  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    await this.ensureServiceRunning();

    const response = await fetch(`${this.baseUrl}/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`spaCy extraction failed: ${error}`);
    }

    return await response.json();
  }

  /**
   * Get model info
   */
  async getModelInfo(): Promise<{ name: string; size?: string; description?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      const data = await response.json();

      return {
        name: data.model,
        size: '~50MB',
        description: 'spaCy English language model with NER and dependency parsing',
      };
    } catch {
      return {
        name: 'en_core_web_lg',
        description: 'spaCy English language model (not connected)',
      };
    }
  }

  /**
   * Stop the spaCy service
   */
  async shutdown(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill();
      this.process = null;
    }
  }
}
```

---

## Phase 3: LLM Provider

### Step 3.1: Ollama Provider

**File: `packages/desktop/electron/services/extraction/providers/ollama-provider.ts`**

```typescript
/**
 * Ollama Provider
 *
 * Connects to Ollama running locally OR on any network host.
 * This is the key insight: same code works for:
 * - localhost:11434 (local Ollama)
 * - 192.168.1.100:11434 (Ollama on your M2 Ultra from Windows)
 * - my-server.local:11434 (remote server)
 */

import { BaseExtractionProvider } from './base-provider';
import { EXTRACTION_PROMPT_TEMPLATE, parseStructuredResponse } from '../prompt-templates';
import type {
  ExtractionInput,
  ExtractionResult,
  ProviderConfig,
  ProviderStatus,
} from '../extraction-types';

export class OllamaProvider extends BaseExtractionProvider {
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);

    const host = config.settings.host || 'localhost';
    const port = config.settings.port || 11434;

    // Support both http and hostname-only formats
    if (host.startsWith('http://') || host.startsWith('https://')) {
      this.baseUrl = host;
    } else {
      this.baseUrl = `http://${host}:${port}`;
    }
  }

  /**
   * Check if Ollama is reachable and has the required model
   */
  async checkAvailability(): Promise<ProviderStatus> {
    const timeout = this.config.settings.timeout || 5000;

    try {
      // Check if Ollama is running
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }

      const data = await response.json();
      const models = data.models || [];

      // Check if configured model is available
      const configuredModel = this.config.settings.model || 'qwen2.5:7b';
      const modelAvailable = models.some(
        (m: { name: string }) =>
          m.name === configuredModel ||
          m.name.startsWith(configuredModel.split(':')[0])
      );

      // Find the actual model info
      const modelInfo = models.find(
        (m: { name: string }) =>
          m.name === configuredModel ||
          m.name.startsWith(configuredModel.split(':')[0])
      );

      this.status = {
        id: this.config.id,
        available: modelAvailable,
        lastCheck: new Date().toISOString(),
        modelInfo: modelInfo ? {
          name: modelInfo.name,
          size: formatBytes(modelInfo.size),
          quantization: modelInfo.details?.quantization_level,
        } : undefined,
        lastError: modelAvailable ? undefined : `Model ${configuredModel} not found. Available: ${models.map((m: { name: string }) => m.name).join(', ')}`,
      };
    } catch (error) {
      this.status = {
        id: this.config.id,
        available: false,
        lastCheck: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : 'Connection failed',
      };
    }

    return this.status;
  }

  /**
   * Extract using Ollama
   */
  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const model = this.config.settings.model || 'qwen2.5:7b';
    const timeout = this.config.settings.timeout || 120000; // 2 minutes default

    const startTime = Date.now();

    // Build the prompt
    const prompt = EXTRACTION_PROMPT_TEMPLATE.replace('{text}', input.text);

    // Call Ollama API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          format: 'json',
          options: {
            temperature: 0.1, // Low temperature for consistent extraction
            num_predict: 4096, // Max tokens to generate
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama error: ${error}`);
      }

      const data = await response.json();
      const processingTimeMs = Date.now() - startTime;

      // Parse the LLM response
      const parsed = parseStructuredResponse(data.response);

      return {
        provider: 'ollama',
        model,
        dates: parsed.dates,
        people: parsed.people,
        organizations: parsed.organizations,
        locations: parsed.locations,
        summary: parsed.summary,
        keyFacts: parsed.keyFacts,
        processingTimeMs,
        warnings: parsed.warnings,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Ollama request timed out after ${timeout}ms`);
      }

      throw error;
    }
  }

  /**
   * Get model info
   */
  async getModelInfo(): Promise<{ name: string; size?: string; description?: string }> {
    const model = this.config.settings.model || 'qwen2.5:7b';

    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          name: model,
          size: formatBytes(data.size),
          description: data.modelfile?.split('\n')[0] || 'Ollama model',
        };
      }
    } catch {
      // Fall through to default
    }

    return {
      name: model,
      description: `Ollama model at ${this.baseUrl}`,
    };
  }

  /**
   * Get the base URL (useful for debugging)
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (!bytes) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
```

### Step 3.2: Prompt Templates

**File: `packages/desktop/electron/services/extraction/prompt-templates.ts`**

```typescript
/**
 * LLM Prompt Templates
 *
 * These prompts are carefully crafted to extract structured data
 * from historical documents about abandoned places.
 */

import type { ExtractedDate, ExtractedPerson, ExtractedOrganization, ExtractedLocation } from './extraction-types';

/**
 * Main extraction prompt template
 *
 * Key design decisions:
 * 1. Explicit JSON schema in the prompt
 * 2. Examples of expected output
 * 3. Clear instructions about confidence levels
 * 4. Historical context awareness
 */
export const EXTRACTION_PROMPT_TEMPLATE = `You are an expert at extracting structured information from historical documents about abandoned places, buildings, and locations.

DOCUMENT TO ANALYZE:
---
{text}
---

Extract all relevant information and return it as valid JSON matching this exact schema:

{
  "dates": [
    {
      "rawText": "exact text containing the date from the document",
      "parsedDate": "YYYY-MM-DD or YYYY-MM or YYYY",
      "precision": "exact|month|year|decade|approximate",
      "category": "build_date|opening|closure|demolition|visit|publication|unknown",
      "confidence": 0.0 to 1.0,
      "context": "the sentence containing this date",
      "isApproximate": true or false
    }
  ],
  "people": [
    {
      "name": "Full Name",
      "role": "owner|architect|developer|employee|founder|visitor|unknown",
      "mentions": ["all variations of their name in the text"],
      "confidence": 0.0 to 1.0
    }
  ],
  "organizations": [
    {
      "name": "Organization Name",
      "type": "company|government|school|hospital|church|unknown",
      "mentions": ["all variations in the text"],
      "confidence": 0.0 to 1.0
    }
  ],
  "locations": [
    {
      "name": "Location Name",
      "type": "city|state|address|landmark|region|unknown",
      "confidence": 0.0 to 1.0
    }
  ],
  "summary": "A 2-3 sentence TL;DR of the document",
  "keyFacts": ["Important fact 1", "Important fact 2", ...]
}

IMPORTANT RULES:
1. Only extract information EXPLICITLY stated in the document
2. For dates:
   - "built in 1923" → category: "build_date", parsedDate: "1923", precision: "year"
   - "March 15, 1968" → parsedDate: "1968-03-15", precision: "exact"
   - "circa 1920" → isApproximate: true, precision: "approximate"
   - "the 1920s" → precision: "decade", parsedDate: "1925" (mid-decade)
   - "late 1800s" → precision: "decade", parsedDate: "1890", isApproximate: true
3. Confidence scores:
   - 0.9-1.0: Explicit, unambiguous information
   - 0.7-0.8: Clear implication or strong context
   - 0.5-0.6: Reasonable inference
   - Below 0.5: Don't include, too uncertain
4. If no relevant information exists for a category, use an empty array []
5. The summary should focus on historical significance and current state
6. keyFacts should be specific, verifiable claims from the document

Return ONLY the JSON object, no other text.`;

/**
 * Parse the LLM's JSON response into our structured types
 */
export function parseStructuredResponse(response: string): {
  dates: ExtractedDate[];
  people: ExtractedPerson[];
  organizations: ExtractedOrganization[];
  locations: ExtractedLocation[];
  summary?: string;
  keyFacts?: string[];
  warnings?: string[];
} {
  const warnings: string[] = [];

  // Try to extract JSON from the response
  let jsonStr = response.trim();

  // Handle markdown code blocks
  if (jsonStr.startsWith('```')) {
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      jsonStr = match[1].trim();
    }
  }

  // Handle responses that start with text before JSON
  const jsonStart = jsonStr.indexOf('{');
  if (jsonStart > 0) {
    jsonStr = jsonStr.substring(jsonStart);
  }

  // Find the last closing brace
  const jsonEnd = jsonStr.lastIndexOf('}');
  if (jsonEnd !== -1 && jsonEnd < jsonStr.length - 1) {
    jsonStr = jsonStr.substring(0, jsonEnd + 1);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    warnings.push(`Failed to parse JSON: ${e instanceof Error ? e.message : 'unknown error'}`);
    return {
      dates: [],
      people: [],
      organizations: [],
      locations: [],
      warnings,
    };
  }

  // Validate and normalize dates
  const dates: ExtractedDate[] = (parsed.dates || [])
    .filter((d: any) => d.rawText && d.parsedDate)
    .map((d: any) => ({
      rawText: String(d.rawText),
      parsedDate: String(d.parsedDate),
      parsedDateEnd: d.parsedDateEnd ? String(d.parsedDateEnd) : undefined,
      precision: validateEnum(d.precision, ['exact', 'month', 'year', 'decade', 'approximate'], 'year'),
      category: validateEnum(d.category, ['build_date', 'opening', 'closure', 'demolition', 'visit', 'publication', 'unknown'], 'unknown'),
      confidence: normalizeConfidence(d.confidence),
      context: String(d.context || d.rawText),
      isApproximate: Boolean(d.isApproximate),
    }));

  // Validate and normalize people
  const people: ExtractedPerson[] = (parsed.people || [])
    .filter((p: any) => p.name)
    .map((p: any) => ({
      name: String(p.name),
      role: validateEnum(p.role, ['owner', 'architect', 'developer', 'employee', 'founder', 'visitor', 'unknown'], 'unknown'),
      mentions: Array.isArray(p.mentions) ? p.mentions.map(String) : [String(p.name)],
      confidence: normalizeConfidence(p.confidence),
    }));

  // Validate and normalize organizations
  const organizations: ExtractedOrganization[] = (parsed.organizations || [])
    .filter((o: any) => o.name)
    .map((o: any) => ({
      name: String(o.name),
      type: validateEnum(o.type, ['company', 'government', 'school', 'hospital', 'church', 'unknown'], 'unknown'),
      mentions: Array.isArray(o.mentions) ? o.mentions.map(String) : [String(o.name)],
      confidence: normalizeConfidence(o.confidence),
    }));

  // Validate and normalize locations
  const locations: ExtractedLocation[] = (parsed.locations || [])
    .filter((l: any) => l.name)
    .map((l: any) => ({
      name: String(l.name),
      type: validateEnum(l.type, ['city', 'state', 'address', 'landmark', 'region', 'unknown'], 'unknown'),
      confidence: normalizeConfidence(l.confidence),
    }));

  return {
    dates,
    people,
    organizations,
    locations,
    summary: parsed.summary ? String(parsed.summary) : undefined,
    keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts.map(String) : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Validate a value is one of the allowed enum values
 */
function validateEnum<T extends string>(value: any, allowed: T[], defaultValue: T): T {
  const str = String(value).toLowerCase();
  return allowed.includes(str as T) ? (str as T) : defaultValue;
}

/**
 * Normalize confidence to 0-1 range
 */
function normalizeConfidence(value: any): number {
  const num = Number(value);
  if (isNaN(num)) return 0.5;
  if (num > 1) return num / 100; // Handle percentages
  return Math.max(0, Math.min(1, num));
}
```

### Step 3.3: Cloud Provider (Claude/Gemini/OpenAI)

**File: `packages/desktop/electron/services/extraction/providers/cloud-provider.ts`**

```typescript
/**
 * Cloud LLM Provider
 *
 * Supports multiple cloud APIs with the same interface:
 * - Anthropic (Claude)
 * - Google (Gemini)
 * - OpenAI (GPT-4)
 *
 * The beauty of this design: same ExtractionInput → ExtractionResult
 * regardless of which cloud provider you use.
 */

import { BaseExtractionProvider } from './base-provider';
import { EXTRACTION_PROMPT_TEMPLATE, parseStructuredResponse } from '../prompt-templates';
import type {
  ExtractionInput,
  ExtractionResult,
  ProviderConfig,
  ProviderStatus,
} from '../extraction-types';

type CloudProviderType = 'anthropic' | 'google' | 'openai';

interface CloudApiConfig {
  baseUrl: string;
  authHeader: string;
  modelKey: string;
  defaultModel: string;
}

const CLOUD_CONFIGS: Record<CloudProviderType, CloudApiConfig> = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1/messages',
    authHeader: 'x-api-key',
    modelKey: 'model',
    defaultModel: 'claude-sonnet-4-20250514',
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    authHeader: 'x-goog-api-key',
    modelKey: 'model',
    defaultModel: 'gemini-2.0-flash',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    authHeader: 'Authorization',
    modelKey: 'model',
    defaultModel: 'gpt-4o',
  },
};

export class CloudProvider extends BaseExtractionProvider {
  private cloudType: CloudProviderType;

  constructor(config: ProviderConfig) {
    super(config);
    this.cloudType = config.type as CloudProviderType;

    if (!CLOUD_CONFIGS[this.cloudType]) {
      throw new Error(`Unknown cloud provider type: ${config.type}`);
    }
  }

  /**
   * Check if API key is configured and valid
   */
  async checkAvailability(): Promise<ProviderStatus> {
    const apiKey = this.config.settings.apiKey;

    if (!apiKey) {
      this.status = {
        id: this.config.id,
        available: false,
        lastCheck: new Date().toISOString(),
        lastError: 'API key not configured',
      };
      return this.status;
    }

    // For cloud providers, we don't ping the API to check availability
    // (that would cost money). Just verify the key looks valid.
    const keyValid = apiKey.length > 10;

    this.status = {
      id: this.config.id,
      available: keyValid,
      lastCheck: new Date().toISOString(),
      modelInfo: {
        name: this.config.settings.cloudModel || CLOUD_CONFIGS[this.cloudType].defaultModel,
      },
      lastError: keyValid ? undefined : 'API key appears invalid',
    };

    return this.status;
  }

  /**
   * Extract using cloud LLM
   */
  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const apiKey = this.config.settings.apiKey;
    if (!apiKey) {
      throw new Error('API key not configured');
    }

    const config = CLOUD_CONFIGS[this.cloudType];
    const model = this.config.settings.cloudModel || config.defaultModel;
    const timeout = this.config.settings.timeout || 60000;

    const startTime = Date.now();
    const prompt = EXTRACTION_PROMPT_TEMPLATE.replace('{text}', input.text);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      let response: Response;
      let responseText: string;

      switch (this.cloudType) {
        case 'anthropic':
          response = await fetch(config.baseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model,
              max_tokens: 4096,
              messages: [{ role: 'user', content: prompt }],
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(`Anthropic API error: ${response.status}`);
          }

          const anthropicData = await response.json();
          responseText = anthropicData.content[0].text;
          break;

        case 'google':
          response = await fetch(`${config.baseUrl}/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 4096,
              },
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(`Google API error: ${response.status}`);
          }

          const googleData = await response.json();
          responseText = googleData.candidates[0].content.parts[0].text;
          break;

        case 'openai':
          response = await fetch(config.baseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.1,
              max_tokens: 4096,
              response_format: { type: 'json_object' },
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status}`);
          }

          const openaiData = await response.json();
          responseText = openaiData.choices[0].message.content;
          break;

        default:
          throw new Error(`Unknown cloud type: ${this.cloudType}`);
      }

      clearTimeout(timeoutId);
      const processingTimeMs = Date.now() - startTime;

      // Parse the response
      const parsed = parseStructuredResponse(responseText);

      return {
        provider: this.cloudType,
        model,
        dates: parsed.dates,
        people: parsed.people,
        organizations: parsed.organizations,
        locations: parsed.locations,
        summary: parsed.summary,
        keyFacts: parsed.keyFacts,
        processingTimeMs,
        warnings: parsed.warnings,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeout}ms`);
      }

      throw error;
    }
  }

  /**
   * Get model info
   */
  async getModelInfo(): Promise<{ name: string; size?: string; description?: string }> {
    const config = CLOUD_CONFIGS[this.cloudType];
    const model = this.config.settings.cloudModel || config.defaultModel;

    const descriptions: Record<string, string> = {
      'claude-sonnet-4-20250514': 'Anthropic Claude Sonnet 4 - Best for accuracy and reasoning',
      'claude-opus-4-20250514': 'Anthropic Claude Opus 4 - Maximum capability',
      'gemini-2.0-flash': 'Google Gemini 2.0 Flash - Fast and cost-effective',
      'gemini-2.5-pro': 'Google Gemini 2.5 Pro - Best for complex tasks',
      'gpt-4o': 'OpenAI GPT-4o - Balanced performance',
      'gpt-4-turbo': 'OpenAI GPT-4 Turbo - Extended context',
    };

    return {
      name: model,
      description: descriptions[model] || `${this.cloudType} cloud model`,
    };
  }
}
```

---

## Phase 4: Electron Integration

### Step 4.1: Extraction Service (Orchestrator)

**File: `packages/desktop/electron/services/extraction/extraction-service.ts`**

```typescript
/**
 * Extraction Service
 *
 * The main orchestrator that:
 * 1. Manages all providers (spaCy, Ollama, Cloud)
 * 2. Routes extraction requests to the best available provider
 * 3. Handles fallback when providers fail
 * 4. Caches results and tracks jobs
 */

import { SpacyProvider } from './providers/spacy-provider';
import { OllamaProvider } from './providers/ollama-provider';
import { CloudProvider } from './providers/cloud-provider';
import { BaseExtractionProvider } from './providers/base-provider';
import type {
  ExtractionInput,
  ExtractionResult,
  ProviderConfig,
  ProviderStatus,
} from './extraction-types';

/**
 * Default provider configurations
 */
const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'spacy-local',
    name: 'spaCy (Local)',
    type: 'spacy',
    enabled: true,
    priority: 1, // Fastest, try first for simple cases
    settings: {
      port: 8100,
    },
  },
  {
    id: 'ollama-local',
    name: 'Ollama (Local)',
    type: 'ollama',
    enabled: true,
    priority: 2,
    settings: {
      host: 'localhost',
      port: 11434,
      model: 'qwen2.5:7b',
      timeout: 120000,
    },
  },
  {
    id: 'ollama-remote',
    name: 'Ollama (Remote)',
    type: 'ollama',
    enabled: false, // User enables and configures
    priority: 3,
    settings: {
      host: '', // User sets this
      port: 11434,
      model: 'qwen2.5:7b',
      timeout: 120000,
    },
  },
  {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    type: 'anthropic',
    enabled: false, // Requires API key
    priority: 10,
    settings: {
      apiKey: '',
      cloudModel: 'claude-sonnet-4-20250514',
      timeout: 60000,
    },
  },
  {
    id: 'google',
    name: 'Gemini (Google)',
    type: 'google',
    enabled: false,
    priority: 11,
    settings: {
      apiKey: '',
      cloudModel: 'gemini-2.0-flash',
      timeout: 60000,
    },
  },
  {
    id: 'openai',
    name: 'GPT-4 (OpenAI)',
    type: 'openai',
    enabled: false,
    priority: 12,
    settings: {
      apiKey: '',
      cloudModel: 'gpt-4o',
      timeout: 60000,
    },
  },
];

export class ExtractionService {
  private providers: Map<string, BaseExtractionProvider> = new Map();
  private configs: ProviderConfig[];

  constructor() {
    this.configs = [...DEFAULT_PROVIDERS];
    this.initializeProviders();
  }

  /**
   * Initialize provider instances from configs
   */
  private initializeProviders(): void {
    this.providers.clear();

    for (const config of this.configs) {
      if (!config.enabled) continue;

      let provider: BaseExtractionProvider;

      switch (config.type) {
        case 'spacy':
          provider = new SpacyProvider(config);
          break;
        case 'ollama':
          provider = new OllamaProvider(config);
          break;
        case 'anthropic':
        case 'google':
        case 'openai':
          provider = new CloudProvider(config);
          break;
        default:
          console.warn(`Unknown provider type: ${config.type}`);
          continue;
      }

      this.providers.set(config.id, provider);
    }
  }

  /**
   * Get all provider statuses
   */
  async getProviderStatuses(): Promise<ProviderStatus[]> {
    const statuses: ProviderStatus[] = [];

    for (const [id, provider] of this.providers) {
      const status = await provider.checkAvailability();
      statuses.push(status);
    }

    return statuses;
  }

  /**
   * Get provider configurations
   */
  getProviderConfigs(): ProviderConfig[] {
    return [...this.configs];
  }

  /**
   * Update a provider configuration
   */
  updateProviderConfig(id: string, updates: Partial<ProviderConfig>): void {
    const index = this.configs.findIndex(c => c.id === id);
    if (index === -1) {
      throw new Error(`Provider not found: ${id}`);
    }

    this.configs[index] = { ...this.configs[index], ...updates };
    this.initializeProviders();
  }

  /**
   * Add a new provider configuration
   */
  addProviderConfig(config: ProviderConfig): void {
    if (this.configs.some(c => c.id === config.id)) {
      throw new Error(`Provider already exists: ${config.id}`);
    }

    this.configs.push(config);
    this.initializeProviders();
  }

  /**
   * Main extraction method
   *
   * Tries providers in priority order until one succeeds.
   * If needsSummary is true, skips spaCy (can't summarize).
   */
  async extract(
    input: ExtractionInput,
    options?: {
      preferProvider?: string;
      needsSummary?: boolean;
      minConfidence?: number;
    }
  ): Promise<ExtractionResult & { providerId: string }> {
    const { preferProvider, needsSummary = false, minConfidence = 0.3 } = options || {};

    // Get enabled providers sorted by priority
    let providers = Array.from(this.providers.entries())
      .filter(([_, p]) => p.isEnabled())
      .sort((a, b) => a[1].getPriority() - b[1].getPriority());

    // If summary needed, skip spaCy
    if (needsSummary) {
      providers = providers.filter(([_, p]) => p.getType() !== 'spacy');
    }

    // If preferred provider specified, try it first
    if (preferProvider) {
      const preferred = providers.find(([id]) => id === preferProvider);
      if (preferred) {
        providers = [preferred, ...providers.filter(([id]) => id !== preferProvider)];
      }
    }

    // Try each provider
    const errors: string[] = [];

    for (const [id, provider] of providers) {
      try {
        // Check availability
        if (!(await provider.isAvailable())) {
          errors.push(`${provider.getName()}: Not available`);
          continue;
        }

        console.log(`Attempting extraction with ${provider.getName()}...`);

        // Perform extraction
        const result = await provider.extract(input);

        // Basic validation - must have found something
        const hasContent =
          result.dates.length > 0 ||
          result.people.length > 0 ||
          result.organizations.length > 0 ||
          result.locations.length > 0 ||
          result.summary;

        if (!hasContent) {
          errors.push(`${provider.getName()}: No content extracted`);
          continue;
        }

        console.log(`Extraction successful with ${provider.getName()}`);

        return {
          ...result,
          providerId: id,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${provider.getName()}: ${message}`);
        console.error(`Provider ${provider.getName()} failed:`, error);
      }
    }

    // All providers failed
    throw new Error(
      `All providers failed:\n${errors.map(e => `  - ${e}`).join('\n')}`
    );
  }

  /**
   * Extract with a specific provider (no fallback)
   */
  async extractWith(
    providerId: string,
    input: ExtractionInput
  ): Promise<ExtractionResult> {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    if (!(await provider.isAvailable())) {
      throw new Error(`Provider not available: ${providerId}`);
    }

    return provider.extract(input);
  }

  /**
   * Shutdown all providers (cleanup)
   */
  async shutdown(): Promise<void> {
    for (const [_, provider] of this.providers) {
      if ('shutdown' in provider && typeof provider.shutdown === 'function') {
        await provider.shutdown();
      }
    }
  }
}

// Singleton instance
let extractionService: ExtractionService | null = null;

export function getExtractionService(): ExtractionService {
  if (!extractionService) {
    extractionService = new ExtractionService();
  }
  return extractionService;
}
```

### Step 4.2: IPC Handlers

**File: `packages/desktop/electron/main/ipc-handlers/extraction-handlers.ts`**

```typescript
/**
 * Extraction IPC Handlers
 *
 * Exposes extraction service to the renderer via IPC.
 * Channel naming follows pattern: extraction:action
 */

import { ipcMain } from 'electron';
import { getExtractionService } from '../../services/extraction/extraction-service';
import type { ExtractionInput, ProviderConfig } from '../../services/extraction/extraction-types';

export function registerExtractionHandlers(): void {
  const service = getExtractionService();

  // ============================================================
  // EXTRACTION OPERATIONS
  // ============================================================

  /**
   * Extract entities from text
   */
  ipcMain.handle('extraction:extract', async (_, input: ExtractionInput, options?: {
    preferProvider?: string;
    needsSummary?: boolean;
  }) => {
    return service.extract(input, options);
  });

  /**
   * Extract with a specific provider (no fallback)
   */
  ipcMain.handle('extraction:extractWith', async (_, providerId: string, input: ExtractionInput) => {
    return service.extractWith(providerId, input);
  });

  // ============================================================
  // PROVIDER MANAGEMENT
  // ============================================================

  /**
   * Get all provider statuses
   */
  ipcMain.handle('extraction:getProviderStatuses', async () => {
    return service.getProviderStatuses();
  });

  /**
   * Get provider configurations
   */
  ipcMain.handle('extraction:getProviderConfigs', async () => {
    return service.getProviderConfigs();
  });

  /**
   * Update provider configuration
   */
  ipcMain.handle('extraction:updateProviderConfig', async (_, id: string, updates: Partial<ProviderConfig>) => {
    service.updateProviderConfig(id, updates);
    return { success: true };
  });

  /**
   * Add a new provider (e.g., second remote Ollama)
   */
  ipcMain.handle('extraction:addProvider', async (_, config: ProviderConfig) => {
    service.addProviderConfig(config);
    return { success: true };
  });

  /**
   * Test a provider connection
   */
  ipcMain.handle('extraction:testProvider', async (_, id: string) => {
    const statuses = await service.getProviderStatuses();
    return statuses.find(s => s.id === id);
  });
}
```

### Step 4.3: Preload Bridge

Add to **`packages/desktop/electron/preload/preload.cjs`**:

```javascript
// Add to the contextBridge.exposeInMainWorld('electron', { ... }) object:

extraction: {
  // Main extraction
  extract: (input, options) => ipcRenderer.invoke('extraction:extract', input, options),
  extractWith: (providerId, input) => ipcRenderer.invoke('extraction:extractWith', providerId, input),

  // Provider management
  getProviderStatuses: () => ipcRenderer.invoke('extraction:getProviderStatuses'),
  getProviderConfigs: () => ipcRenderer.invoke('extraction:getProviderConfigs'),
  updateProviderConfig: (id, updates) => ipcRenderer.invoke('extraction:updateProviderConfig', id, updates),
  addProvider: (config) => ipcRenderer.invoke('extraction:addProvider', config),
  testProvider: (id) => ipcRenderer.invoke('extraction:testProvider', id),
},
```

---

## Phase 5: UI Components

### Step 5.1: Provider Settings Component

**File: `packages/desktop/src/components/extraction/ProviderSettings.svelte`**

```svelte
<script lang="ts">
  /**
   * Provider Settings Component
   *
   * Allows users to:
   * - Enable/disable providers
   * - Configure Ollama endpoints (local or remote)
   * - Add API keys for cloud providers
   * - Test connections
   */

  import { onMount } from 'svelte';

  interface ProviderConfig {
    id: string;
    name: string;
    type: string;
    enabled: boolean;
    priority: number;
    settings: Record<string, any>;
  }

  interface ProviderStatus {
    id: string;
    available: boolean;
    lastCheck: string;
    lastError?: string;
    modelInfo?: {
      name: string;
      size?: string;
    };
  }

  let configs: ProviderConfig[] = [];
  let statuses: Map<string, ProviderStatus> = new Map();
  let testing: Set<string> = new Set();
  let saving = false;

  onMount(async () => {
    await loadProviders();
  });

  async function loadProviders() {
    configs = await window.electron.extraction.getProviderConfigs();
    const statusList = await window.electron.extraction.getProviderStatuses();
    statuses = new Map(statusList.map(s => [s.id, s]));
  }

  async function testProvider(id: string) {
    testing = new Set([...testing, id]);
    try {
      const status = await window.electron.extraction.testProvider(id);
      statuses.set(id, status);
      statuses = statuses; // Trigger reactivity
    } finally {
      testing.delete(id);
      testing = testing;
    }
  }

  async function saveConfig(config: ProviderConfig) {
    saving = true;
    try {
      await window.electron.extraction.updateProviderConfig(config.id, config);
    } finally {
      saving = false;
    }
  }

  async function toggleProvider(config: ProviderConfig) {
    config.enabled = !config.enabled;
    await saveConfig(config);
    configs = configs;
  }

  function getStatusColor(id: string): string {
    const status = statuses.get(id);
    if (!status) return 'gray';
    return status.available ? 'green' : 'red';
  }
</script>

<div class="space-y-6">
  <h3 class="text-lg font-semibold">Extraction Providers</h3>
  <p class="text-sm text-gray-400">
    Configure which extraction backends to use. Providers are tried in priority order.
  </p>

  {#each configs as config (config.id)}
    <div class="border border-gray-700 rounded-lg p-4 space-y-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <!-- Status indicator -->
          <div
            class="w-3 h-3 rounded-full"
            class:bg-green-500={getStatusColor(config.id) === 'green'}
            class:bg-red-500={getStatusColor(config.id) === 'red'}
            class:bg-gray-500={getStatusColor(config.id) === 'gray'}
          ></div>

          <div>
            <h4 class="font-medium">{config.name}</h4>
            <p class="text-xs text-gray-500">
              {#if statuses.get(config.id)?.modelInfo}
                Model: {statuses.get(config.id).modelInfo.name}
                {#if statuses.get(config.id).modelInfo.size}
                  ({statuses.get(config.id).modelInfo.size})
                {/if}
              {:else if statuses.get(config.id)?.lastError}
                <span class="text-red-400">{statuses.get(config.id).lastError}</span>
              {:else}
                Not connected
              {/if}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            on:click={() => testProvider(config.id)}
            disabled={testing.has(config.id)}
            class="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded"
          >
            {testing.has(config.id) ? 'Testing...' : 'Test'}
          </button>

          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.enabled}
              on:change={() => toggleProvider(config)}
              class="rounded"
            />
            <span class="text-sm">Enabled</span>
          </label>
        </div>
      </div>

      <!-- Settings (expanded when enabled) -->
      {#if config.enabled}
        <div class="pt-4 border-t border-gray-700 space-y-3">
          {#if config.type === 'ollama'}
            <!-- Ollama settings -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm text-gray-400 mb-1">Host</label>
                <input
                  type="text"
                  bind:value={config.settings.host}
                  on:blur={() => saveConfig(config)}
                  placeholder="localhost or 192.168.1.100"
                  class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded"
                />
                <p class="text-xs text-gray-500 mt-1">
                  Use "localhost" for this machine, or IP/hostname for remote
                </p>
              </div>
              <div>
                <label class="block text-sm text-gray-400 mb-1">Port</label>
                <input
                  type="number"
                  bind:value={config.settings.port}
                  on:blur={() => saveConfig(config)}
                  placeholder="11434"
                  class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded"
                />
              </div>
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Model</label>
              <input
                type="text"
                bind:value={config.settings.model}
                on:blur={() => saveConfig(config)}
                placeholder="qwen2.5:7b"
                class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded"
              />
              <p class="text-xs text-gray-500 mt-1">
                Run <code class="bg-gray-700 px-1 rounded">ollama list</code> to see available models
              </p>
            </div>

          {:else if config.type === 'anthropic' || config.type === 'google' || config.type === 'openai'}
            <!-- Cloud provider settings -->
            <div>
              <label class="block text-sm text-gray-400 mb-1">API Key</label>
              <input
                type="password"
                bind:value={config.settings.apiKey}
                on:blur={() => saveConfig(config)}
                placeholder="Enter API key..."
                class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded"
              />
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Model</label>
              <select
                bind:value={config.settings.cloudModel}
                on:change={() => saveConfig(config)}
                class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded"
              >
                {#if config.type === 'anthropic'}
                  <option value="claude-sonnet-4-20250514">Claude Sonnet 4 (Recommended)</option>
                  <option value="claude-opus-4-20250514">Claude Opus 4</option>
                  <option value="claude-haiku-3-20240307">Claude Haiku 3 (Fast)</option>
                {:else if config.type === 'google'}
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash (Fast)</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                {:else if config.type === 'openai'}
                  <option value="gpt-4o">GPT-4o (Recommended)</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo (Fast)</option>
                {/if}
              </select>
            </div>
          {/if}

          <!-- Priority -->
          <div>
            <label class="block text-sm text-gray-400 mb-1">Priority</label>
            <input
              type="number"
              bind:value={config.priority}
              on:blur={() => saveConfig(config)}
              min="1"
              max="100"
              class="w-24 px-3 py-2 bg-gray-800 border border-gray-600 rounded"
            />
            <span class="text-xs text-gray-500 ml-2">Lower = tried first</span>
          </div>
        </div>
      {/if}
    </div>
  {/each}

  <!-- Add Remote Ollama Button -->
  <button
    on:click={async () => {
      const newConfig: ProviderConfig = {
        id: `ollama-remote-${Date.now()}`,
        name: 'Ollama (Remote)',
        type: 'ollama',
        enabled: true,
        priority: 5,
        settings: {
          host: '',
          port: 11434,
          model: 'qwen2.5:7b',
          timeout: 120000,
        },
      };
      await window.electron.extraction.addProvider(newConfig);
      await loadProviders();
    }}
    class="w-full py-2 border-2 border-dashed border-gray-600 hover:border-gray-500 rounded-lg text-gray-400 hover:text-gray-300"
  >
    + Add Remote Ollama Server
  </button>
</div>
```

---

## Database Schema

Add this migration to `packages/desktop/electron/main/database.ts`:

```sql
-- Migration: Extraction System Tables

-- Entity extractions (all types unified)
CREATE TABLE IF NOT EXISTS entity_extractions (
  extraction_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  locid TEXT,

  -- Entity data
  entity_type TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  normalized_value TEXT,

  -- For dates
  date_start TEXT,
  date_end TEXT,
  date_precision TEXT,
  date_category TEXT,
  is_approximate INTEGER DEFAULT 0,

  -- For people/orgs
  entity_role TEXT,
  entity_subtype TEXT,
  mentions TEXT, -- JSON array

  -- Confidence and provenance
  overall_confidence REAL,
  provider_id TEXT,
  model_used TEXT,
  context_sentence TEXT,

  -- Review workflow
  status TEXT DEFAULT 'pending',
  reviewed_at TEXT,
  reviewed_by TEXT,
  user_correction TEXT,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (locid) REFERENCES locs(locid)
);

-- Document summaries
CREATE TABLE IF NOT EXISTS document_summaries (
  summary_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  locid TEXT,

  summary_text TEXT NOT NULL,
  key_facts TEXT, -- JSON array

  provider_id TEXT,
  model_used TEXT,
  confidence REAL,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (locid) REFERENCES locs(locid)
);

-- Extraction jobs (for queue management)
CREATE TABLE IF NOT EXISTS extraction_jobs (
  job_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  locid TEXT,

  status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  provider_id TEXT,

  started_at TEXT,
  completed_at TEXT,
  error_message TEXT,

  processing_time_ms INTEGER,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Provider configurations (persisted settings)
CREATE TABLE IF NOT EXISTS extraction_providers (
  provider_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 10,
  settings TEXT, -- JSON

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_entity_extractions_source
  ON entity_extractions(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_entity_extractions_locid
  ON entity_extractions(locid);
CREATE INDEX IF NOT EXISTS idx_entity_extractions_status
  ON entity_extractions(status);
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_status
  ON extraction_jobs(status);
```

---

## Testing Strategy

### Unit Tests

```typescript
// Test prompt parsing
describe('parseStructuredResponse', () => {
  it('parses valid JSON response', () => {
    const response = `{
      "dates": [{"rawText": "built in 1923", "parsedDate": "1923", "precision": "year", "category": "build_date", "confidence": 0.9, "context": "The factory was built in 1923", "isApproximate": false}],
      "people": [],
      "organizations": [],
      "locations": [],
      "summary": "A factory from 1923"
    }`;

    const result = parseStructuredResponse(response);
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].parsedDate).toBe('1923');
  });

  it('handles markdown code blocks', () => {
    const response = '```json\n{"dates": []}\n```';
    const result = parseStructuredResponse(response);
    expect(result.dates).toEqual([]);
  });
});
```

### Integration Tests

```typescript
// Test Ollama provider
describe('OllamaProvider', () => {
  it('connects to local Ollama', async () => {
    const provider = new OllamaProvider({
      id: 'test-ollama',
      name: 'Test Ollama',
      type: 'ollama',
      enabled: true,
      priority: 1,
      settings: { host: 'localhost', port: 11434, model: 'qwen2.5:7b' },
    });

    const status = await provider.checkAvailability();
    // This test requires Ollama running locally
    console.log('Ollama status:', status);
  });
});
```

---

## Bundling & Distribution

### PyInstaller for spaCy Service

**File: `resources/extraction/spacy-service/build.sh`**

```bash
#!/bin/bash
# Build spaCy service as standalone executable

cd "$(dirname "$0")"

# Install dependencies
pip install -r requirements.txt
pip install pyinstaller

# Download spaCy model
python -m spacy download en_core_web_lg

# Build executable
pyinstaller --onefile \
  --name spacy-service \
  --hidden-import=dateparser \
  --hidden-import=spacy \
  --collect-data=en_core_web_lg \
  main.py

# Output is in dist/spacy-service
echo "Built: dist/spacy-service"
```

### Recommended Ollama Models

For users setting up Ollama, recommend these models:

| Model | Size | Speed | Best For |
|-------|------|-------|----------|
| `qwen2.5:7b` | 4.4GB | Fast | Default, good balance |
| `qwen2.5:14b` | 8.5GB | Medium | Better accuracy |
| `qwen2.5-vl:7b` | 5.5GB | Medium | If processing images too |
| `mistral:7b` | 4.1GB | Fast | Alternative lightweight |
| `llama3.2:11b` | 6.4GB | Medium | Good all-around |

---

## Summary: What This Gets You

1. **Unified interface** - Same code talks to spaCy, local Ollama, remote Ollama, Claude, Gemini, OpenAI
2. **Network transparency** - Point Ollama at any IP:port and it just works
3. **Graceful fallback** - If LLM is down, falls back to spaCy; if everything is down, shows helpful error
4. **Offline-first** - spaCy + local Ollama work without internet
5. **Future-proof** - Adding new providers (OpenRouter, Groq, llama.cpp) = one file
6. **UI controls** - Users configure everything through Settings

**Next steps after implementation:**
1. Add extraction button to web source detail view
2. Build review queue UI
3. Wire extractions to timeline events
4. Add batch extraction for all web sources
