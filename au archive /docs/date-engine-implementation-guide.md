# Date Engine Implementation Guide

A comprehensive guide for implementing the Date Engine feature in AU Archive.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Phase 1: Foundation](#3-phase-1-foundation)
4. [Phase 2: Core Service](#4-phase-2-core-service)
5. [Phase 3: Data Layer](#5-phase-3-data-layer)
6. [Phase 4: Processor Service](#6-phase-4-processor-service)
7. [Phase 5: IPC Layer](#7-phase-5-ipc-layer)
8. [Phase 6: Integration](#8-phase-6-integration)
9. [Phase 7-15: Additional Features](#9-phases-7-15-additional-features)
10. [Testing](#10-testing)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Overview

### What is the Date Engine?

The Date Engine extracts dates from text (web pages, image captions, documents) using NLP, determines what each date represents (build date, site visit, etc.), and allows users to approve extractions that become timeline events.

### Key Concepts

- **Extraction**: A date found in text with its context
- **Category**: What the date represents (build_date, closure, etc.)
- **Confidence**: How sure we are about the extraction (0-1)
- **Timeline Event**: An approved extraction becomes a timeline event

### Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Text Sources   │────▶│  Date Engine     │────▶│  Extractions    │
│  (web, OCR)     │     │  Service         │     │  (pending)      │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                        ┌──────────────────┐              │ approve
                        │  Review UI       │◀─────────────┘
                        └────────┬─────────┘
                                 │
                        ┌────────▼─────────┐
                        │  Timeline Events │
                        └──────────────────┘
```

---

## 2. Prerequisites

### Required Knowledge

- TypeScript basics
- SQLite/SQL queries
- Svelte components
- Electron IPC pattern
- Regex fundamentals

### Development Environment

```bash
# Ensure you're in the project root
cd /Users/bryant/Documents/au\ archive

# Install dependencies
pnpm install

# Build core package first
pnpm --filter core build

# Start dev mode
pnpm dev
```

### Key Files to Understand First

Read these files to understand existing patterns:

1. `packages/desktop/electron/services/timeline-service.ts` - Timeline integration
2. `packages/desktop/electron/services/date-parser-service.ts` - Existing date parsing
3. `packages/desktop/electron/main/database.ts` - Migration patterns
4. `packages/desktop/electron/main/ipc-handlers/timeline.ts` - IPC patterns

---

## 3. Phase 1: Foundation

### Step 1.1: Add Dependencies

Open `packages/desktop/package.json` and add:

```json
{
  "dependencies": {
    "chrono-node": "^2.7.0",
    "tesseract.js": "^5.0.0"
  }
}
```

Run:
```bash
pnpm install
```

### Step 1.2: Create Domain Types

Create file: `packages/core/src/domain/date-extraction.ts`

```typescript
/**
 * Date Extraction Domain Types
 * Defines all types for the Date Engine feature
 */

import { z } from 'zod';

// =============================================================================
// Enums and Constants
// =============================================================================

/**
 * Categories of dates we can extract
 * Each maps to specific keywords and timeline event types
 */
export const DateCategorySchema = z.enum([
  'build_date',    // When structure was built
  'site_visit',    // When someone visited
  'obituary',      // Death/memorial dates
  'publication',   // When article was published
  'closure',       // When location closed
  'opening',       // When location opened
  'demolition',    // When structure was demolished
  'unknown',       // Could not determine category
]);

export type DateCategory = z.infer<typeof DateCategorySchema>;

/**
 * Status of an extraction in the review workflow
 */
export const ExtractionStatusSchema = z.enum([
  'pending',        // Awaiting review
  'auto_approved',  // System approved (high confidence)
  'user_approved',  // User approved
  'rejected',       // User rejected
  'converted',      // Converted to timeline event
  'reverted',       // User undid conversion
]);

export type ExtractionStatus = z.infer<typeof ExtractionStatusSchema>;

/**
 * Source types for extractions
 */
export const SourceTypeSchema = z.enum([
  'web_source',     // From web page text
  'image_caption',  // From image alt/caption
  'document',       // From OCR'd document
  'manual',         // Manually entered
]);

export type SourceType = z.infer<typeof SourceTypeSchema>;

// =============================================================================
// Main Schema
// =============================================================================

/**
 * A single date extraction from source text
 */
export const DateExtractionSchema = z.object({
  extraction_id: z.string().length(16),

  // Source reference
  source_type: SourceTypeSchema,
  source_id: z.string(),
  locid: z.string().length(16).nullable(),
  subid: z.string().length(16).nullable(),

  // Parsed date
  raw_text: z.string(),
  parsed_date: z.string().nullable(),
  date_start: z.string().nullable(),
  date_end: z.string().nullable(),
  date_precision: z.string(),
  date_display: z.string().nullable(),
  date_edtf: z.string().nullable(),
  date_sort: z.number().nullable(),

  // Context
  sentence: z.string(),
  sentence_position: z.number().nullable(),
  category: DateCategorySchema,
  category_confidence: z.number(),
  category_keywords: z.string().nullable(),

  // Rich confidence scoring
  keyword_distance: z.number().nullable(),
  sentence_position_type: z.string().nullable(),
  source_age_days: z.number().nullable(),
  overall_confidence: z.number(),

  // Article date context
  article_date: z.string().nullable(),
  relative_date_anchor: z.string().nullable(),
  was_relative_date: z.number().default(0),

  // Parsing metadata
  parser_name: z.string().default('chrono'),
  parser_confidence: z.number(),
  century_bias_applied: z.number().default(0),
  original_year_ambiguous: z.number().default(0),

  // Duplicate detection
  is_primary: z.number().default(1),
  merged_from_ids: z.string().nullable(),
  duplicate_of_id: z.string().nullable(),

  // Conflict detection
  conflict_event_id: z.string().nullable(),
  conflict_type: z.string().nullable(),
  conflict_resolved: z.number().default(0),

  // Verification
  status: ExtractionStatusSchema,
  auto_approve_reason: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  reviewed_by: z.string().nullable(),
  rejection_reason: z.string().nullable(),

  // Timeline linkage
  timeline_event_id: z.string().nullable(),
  converted_at: z.string().nullable(),
  reverted_at: z.string().nullable(),
  reverted_by: z.string().nullable(),

  // Timestamps
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

export type DateExtraction = z.infer<typeof DateExtractionSchema>;

// =============================================================================
// Input Types
// =============================================================================

export const DateExtractionInputSchema = DateExtractionSchema.omit({
  extraction_id: true,
  created_at: true,
  updated_at: true,
}).partial({
  status: true,
  parser_name: true,
  is_primary: true,
  was_relative_date: true,
  century_bias_applied: true,
  original_year_ambiguous: true,
  conflict_resolved: true,
});

export type DateExtractionInput = z.infer<typeof DateExtractionInputSchema>;

// =============================================================================
// Display Labels
// =============================================================================

export const DATE_CATEGORY_LABELS: Record<DateCategory, string> = {
  build_date: 'Build Date',
  site_visit: 'Site Visit',
  obituary: 'Obituary',
  publication: 'Publication',
  closure: 'Closure',
  opening: 'Opening',
  demolition: 'Demolition',
  unknown: 'Unknown',
};

/**
 * Maps category to timeline event type/subtype
 */
export const CATEGORY_TO_TIMELINE: Record<DateCategory, { type: string; subtype?: string }> = {
  build_date: { type: 'established', subtype: 'built' },
  site_visit: { type: 'visit' },
  obituary: { type: 'custom', subtype: 'obituary' },
  publication: { type: 'custom', subtype: 'publication' },
  closure: { type: 'established', subtype: 'closed' },
  opening: { type: 'established', subtype: 'opened' },
  demolition: { type: 'established', subtype: 'demolished' },
  unknown: { type: 'custom' },
};

// =============================================================================
// Category Keywords
// =============================================================================

export const CATEGORY_KEYWORDS: Record<DateCategory, string[]> = {
  build_date: [
    'built', 'constructed', 'erected', 'established', 'founded',
    'completed', 'finished building', 'broke ground', 'opened its doors'
  ],
  site_visit: [
    'visited', 'explored', 'trip', 'went to', 'checked out',
    'photographed', 'toured', 'expedition', 'urbex'
  ],
  obituary: [
    'died', 'passed away', 'obituary', 'death', 'deceased',
    'funeral', 'memorial', 'survived by', 'in loving memory'
  ],
  publication: [
    'published', 'posted', 'article', 'written', 'reported',
    'news', 'story', 'update', 'press release'
  ],
  closure: [
    'closed', 'shut down', 'abandoned', 'ceased operations',
    'went out of business', 'shuttered', 'closed its doors', 'last day'
  ],
  opening: [
    'opened', 'inaugurated', 'grand opening', 'ribbon cutting',
    'first day', 'launch', 'debut', 'welcomed'
  ],
  demolition: [
    'demolished', 'torn down', 'razed', 'destroyed',
    'knocked down', 'wrecking ball', 'demolition', 'leveled'
  ],
  unknown: [],
};
```

### Step 1.3: Export from Core

Edit `packages/core/src/index.ts` to add:

```typescript
// Date Extraction
export * from './domain/date-extraction';
```

### Step 1.4: Create Database Migration

Open `packages/desktop/electron/main/database.ts` and add Migration 76 after the last migration:

```typescript
// Migration 76: Date Engine - date_extractions table
const hasDateExtractions = sqlite.prepare(
  "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='date_extractions'"
).get() as { cnt: number };

if (hasDateExtractions.cnt === 0) {
  console.log('Running migration 76: Creating Date Engine tables');

  // Main extractions table
  sqlite.exec(`
    CREATE TABLE date_extractions (
      extraction_id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK(source_type IN ('web_source', 'image_caption', 'document', 'manual')),
      source_id TEXT NOT NULL,
      locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
      subid TEXT REFERENCES slocs(subid) ON DELETE SET NULL,

      raw_text TEXT NOT NULL,
      parsed_date TEXT,
      date_start TEXT,
      date_end TEXT,
      date_precision TEXT NOT NULL,
      date_display TEXT,
      date_edtf TEXT,
      date_sort INTEGER,

      sentence TEXT NOT NULL,
      sentence_position INTEGER,
      category TEXT NOT NULL,
      category_confidence REAL DEFAULT 0,
      category_keywords TEXT,

      keyword_distance INTEGER,
      sentence_position_type TEXT,
      source_age_days INTEGER,
      overall_confidence REAL DEFAULT 0,

      article_date TEXT,
      relative_date_anchor TEXT,
      was_relative_date INTEGER DEFAULT 0,

      parser_name TEXT DEFAULT 'chrono',
      parser_confidence REAL DEFAULT 0,
      century_bias_applied INTEGER DEFAULT 0,
      original_year_ambiguous INTEGER DEFAULT 0,

      is_primary INTEGER DEFAULT 1,
      merged_from_ids TEXT,
      duplicate_of_id TEXT,

      conflict_event_id TEXT,
      conflict_type TEXT,
      conflict_resolved INTEGER DEFAULT 0,

      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'auto_approved', 'user_approved', 'rejected', 'converted', 'reverted')),
      auto_approve_reason TEXT,
      reviewed_at TEXT,
      reviewed_by TEXT,
      rejection_reason TEXT,

      timeline_event_id TEXT REFERENCES location_timeline(event_id) ON DELETE SET NULL,
      converted_at TEXT,
      reverted_at TEXT,
      reverted_by TEXT,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT
    );

    CREATE INDEX idx_date_extractions_source ON date_extractions(source_type, source_id);
    CREATE INDEX idx_date_extractions_locid ON date_extractions(locid);
    CREATE INDEX idx_date_extractions_status ON date_extractions(status);
    CREATE INDEX idx_date_extractions_category ON date_extractions(category);
    CREATE INDEX idx_date_extractions_date_sort ON date_extractions(date_sort);
    CREATE INDEX idx_date_extractions_conflict ON date_extractions(conflict_event_id) WHERE conflict_event_id IS NOT NULL;
    CREATE INDEX idx_date_extractions_primary ON date_extractions(locid, date_start, category) WHERE is_primary = 1;
  `);

  // ML Learning table
  sqlite.exec(`
    CREATE TABLE date_engine_learning (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      keyword TEXT NOT NULL,
      approval_count INTEGER DEFAULT 0,
      rejection_count INTEGER DEFAULT 0,
      weight_modifier REAL DEFAULT 1.0,
      last_updated TEXT,
      UNIQUE(category, keyword)
    );
  `);

  // Custom regex patterns table
  sqlite.exec(`
    CREATE TABLE date_patterns (
      pattern_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      regex TEXT NOT NULL,
      category TEXT,
      priority INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      test_cases TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX idx_date_patterns_enabled ON date_patterns(enabled, priority DESC);
  `);

  // Add tracking columns to web_sources
  const wsColumns = sqlite.prepare('PRAGMA table_info(web_sources)').all() as Array<{ name: string }>;
  const wsColumnNames = wsColumns.map(c => c.name);

  if (!wsColumnNames.includes('dates_extracted_at')) {
    sqlite.exec(`ALTER TABLE web_sources ADD COLUMN dates_extracted_at TEXT`);
  }
  if (!wsColumnNames.includes('dates_extraction_count')) {
    sqlite.exec(`ALTER TABLE web_sources ADD COLUMN dates_extraction_count INTEGER DEFAULT 0`);
  }

  console.log('Migration 76 completed: Date Engine tables created');
}
```

### Step 1.5: Verify Migration

Run the app to trigger the migration:

```bash
pnpm dev
```

Check console for: "Migration 76 completed: Date Engine tables created"

---

## 4. Phase 2: Core Service

### Step 2.1: Create Date Engine Service

Create file: `packages/desktop/electron/services/date-engine-service.ts`

```typescript
/**
 * Date Engine Service
 * Core NLP date extraction with chrono-node and historical bias
 */

import * as chrono from 'chrono-node';
import type { DateCategory, DateExtraction } from '@au-archive/core';
import { CATEGORY_KEYWORDS } from '@au-archive/core';
import { parseDate as existingParseDate } from './date-parser-service';
import { calculateHash } from './crypto-service';

// =============================================================================
// Types
// =============================================================================

export interface RawDateExtraction {
  rawText: string;
  parsedDate: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  precision: string;
  display: string;
  edtf: string;
  dateSort: number;
  sentence: string;
  sentencePosition: number;
  parserConfidence: number;
  centuryBiasApplied: boolean;
  originalYearAmbiguous: boolean;
  wasRelativeDate: boolean;
}

export interface CategoryResult {
  category: DateCategory;
  confidence: number;
  matchedKeywords: string[];
  keywordDistance: number;
}

export interface ExtractionOptions {
  text: string;
  articleDate?: string;  // For anchoring relative dates
  sourceType: 'web_source' | 'image_caption' | 'document' | 'manual';
  sourceId: string;
  locid?: string;
  subid?: string;
}

// =============================================================================
// Historical Year Bias Refiner
// =============================================================================

/**
 * Custom chrono refiner that biases 2-digit years toward 1900s
 * For urbex context: "25" -> 1925, not 2025
 */
function createHistoricalBiasRefiner(): chrono.Refiner {
  return {
    refine: (context, results) => {
      for (const result of results) {
        const year = result.start.get('year');

        if (year && year >= 2020 && year <= 2099) {
          // Check if the original text had a 2-digit year
          const twoDigitMatch = result.text.match(/\b(\d{2})\b/);

          if (twoDigitMatch) {
            const twoDigit = parseInt(twoDigitMatch[1], 10);

            // Bias: 20-99 -> 1920-1999 (historical)
            // Keep: 00-19 -> 2000-2019 (recent)
            if (twoDigit >= 20 && twoDigit <= 99) {
              result.start.assign('year', 1900 + twoDigit);

              // Mark that we applied bias (store in result for later)
              (result as any)._centuryBiasApplied = true;
              (result as any)._originalYearAmbiguous = true;
            }
          }
        }
      }
      return results;
    }
  };
}

// =============================================================================
// Date Engine Service Class
// =============================================================================

export class DateEngineService {
  private chrono: chrono.Chrono;
  private customPatterns: Map<string, RegExp> = new Map();

  constructor() {
    // Create chrono instance with custom refiner
    this.chrono = chrono.casual.clone();
    this.chrono.refiners.push(createHistoricalBiasRefiner());
  }

  /**
   * Load custom patterns from database
   */
  loadPatterns(patterns: Array<{ pattern_id: string; regex: string; enabled: number }>): void {
    this.customPatterns.clear();

    for (const p of patterns) {
      if (p.enabled) {
        try {
          this.customPatterns.set(p.pattern_id, new RegExp(p.regex, 'gi'));
        } catch (e) {
          console.error(`Invalid regex pattern ${p.pattern_id}:`, e);
        }
      }
    }
  }

  /**
   * Extract all dates from text
   */
  extractDates(text: string, articleDate?: string): RawDateExtraction[] {
    const results: RawDateExtraction[] = [];

    // Reference date for relative parsing
    const refDate = articleDate ? new Date(articleDate) : new Date();

    // Parse with chrono-node
    const parsed = this.chrono.parse(text, refDate);

    for (const result of parsed) {
      const sentence = this.extractSentence(text, result.index);
      const startDate = result.start.date();

      // Use existing date parser for formatting
      const formatted = existingParseDate(
        result.start.get('year')?.toString() || ''
      );

      // Determine if it was a relative date
      const wasRelative = result.text.match(
        /\b(yesterday|today|last|ago|next|this|recent|recently)\b/i
      ) !== null;

      results.push({
        rawText: result.text,
        parsedDate: startDate.toISOString().split('T')[0],
        dateStart: startDate.toISOString().split('T')[0],
        dateEnd: result.end ? result.end.date().toISOString().split('T')[0] : null,
        precision: this.determinePrecision(result),
        display: formatted.display || result.text,
        edtf: formatted.edtf || '',
        dateSort: formatted.dateSort || parseInt(
          startDate.toISOString().split('T')[0].replace(/-/g, '')
        ),
        sentence,
        sentencePosition: result.index,
        parserConfidence: this.calculateParserConfidence(result),
        centuryBiasApplied: (result as any)._centuryBiasApplied || false,
        originalYearAmbiguous: (result as any)._originalYearAmbiguous || false,
        wasRelativeDate: wasRelative,
      });
    }

    return results;
  }

  /**
   * Classify the category of a date based on surrounding context
   */
  classifyCategory(sentence: string): CategoryResult {
    const lowerSentence = sentence.toLowerCase();
    let bestCategory: DateCategory = 'unknown';
    let bestConfidence = 0;
    let matchedKeywords: string[] = [];
    let closestDistance = Infinity;

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const keyword of keywords) {
        const index = lowerSentence.indexOf(keyword.toLowerCase());

        if (index !== -1) {
          matchedKeywords.push(keyword);

          // Calculate confidence based on keyword count
          const keywordCount = keywords.filter(kw =>
            lowerSentence.includes(kw.toLowerCase())
          ).length;

          const confidence = Math.min(keywordCount * 0.25, 1);

          if (confidence > bestConfidence) {
            bestCategory = category as DateCategory;
            bestConfidence = confidence;
            closestDistance = index;
          }
        }
      }
    }

    return {
      category: bestCategory,
      confidence: bestConfidence,
      matchedKeywords,
      keywordDistance: closestDistance === Infinity ? -1 : closestDistance,
    };
  }

  /**
   * Calculate overall confidence score
   */
  calculateOverallConfidence(
    parserConfidence: number,
    categoryConfidence: number,
    keywordDistance: number,
    sentencePositionType: 'beginning' | 'middle' | 'end'
  ): number {
    // Keyword distance score (closer is better)
    let kdScore = 0.2;
    if (keywordDistance >= 0) {
      if (keywordDistance <= 10) kdScore = 1.0;
      else if (keywordDistance <= 50) kdScore = 0.5;
    }

    // Sentence position score
    const spScore = {
      beginning: 1.0,
      middle: 0.7,
      end: 0.5,
    }[sentencePositionType];

    // Weighted average
    return (
      kdScore * 0.3 +
      spScore * 0.2 +
      categoryConfidence * 0.3 +
      parserConfidence * 0.2
    );
  }

  /**
   * Determine sentence position type
   */
  getSentencePositionType(
    sentencePosition: number,
    sentenceLength: number
  ): 'beginning' | 'middle' | 'end' {
    const ratio = sentencePosition / sentenceLength;

    if (ratio < 0.33) return 'beginning';
    if (ratio < 0.66) return 'middle';
    return 'end';
  }

  /**
   * Extract the sentence containing a date
   */
  private extractSentence(text: string, position: number): string {
    // Find sentence boundaries (. ! ? or newlines)
    const beforeText = text.substring(0, position);
    const afterText = text.substring(position);

    // Find start of sentence
    const sentenceStartMatch = beforeText.match(/[.!?\n]\s*([^.!?\n]*)$/);
    const sentenceStart = sentenceStartMatch
      ? position - sentenceStartMatch[1].length
      : Math.max(0, position - 200);

    // Find end of sentence
    const sentenceEndMatch = afterText.match(/^[^.!?\n]*[.!?\n]/);
    const sentenceEnd = sentenceEndMatch
      ? position + sentenceEndMatch[0].length
      : Math.min(text.length, position + 200);

    return text.substring(sentenceStart, sentenceEnd).trim();
  }

  /**
   * Determine date precision from chrono result
   */
  private determinePrecision(result: chrono.ParsedResult): string {
    const knownValues = result.start.knownValues;

    if (knownValues.day !== undefined) return 'exact';
    if (knownValues.month !== undefined) return 'month';
    if (knownValues.year !== undefined) return 'year';
    return 'unknown';
  }

  /**
   * Calculate parser confidence from chrono result
   */
  private calculateParserConfidence(result: chrono.ParsedResult): number {
    // More known values = higher confidence
    const knownCount = Object.keys(result.start.knownValues).length;
    return Math.min(knownCount / 3, 1);
  }

  /**
   * Generate extraction ID
   */
  async generateExtractionId(): Promise<string> {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2);
    const hash = await calculateHash(Buffer.from(timestamp + random));
    return hash.substring(0, 16);
  }
}

// Singleton instance
let dateEngineInstance: DateEngineService | null = null;

export function getDateEngine(): DateEngineService {
  if (!dateEngineInstance) {
    dateEngineInstance = new DateEngineService();
  }
  return dateEngineInstance;
}
```

---

## 5. Phase 3: Data Layer

### Step 3.1: Add Database Types

Edit `packages/desktop/electron/main/database.types.ts` and add:

```typescript
// Date Extraction types
export interface DateExtractionRow {
  extraction_id: string;
  source_type: string;
  source_id: string;
  locid: string | null;
  subid: string | null;
  raw_text: string;
  parsed_date: string | null;
  date_start: string | null;
  date_end: string | null;
  date_precision: string;
  date_display: string | null;
  date_edtf: string | null;
  date_sort: number | null;
  sentence: string;
  sentence_position: number | null;
  category: string;
  category_confidence: number;
  category_keywords: string | null;
  keyword_distance: number | null;
  sentence_position_type: string | null;
  source_age_days: number | null;
  overall_confidence: number;
  article_date: string | null;
  relative_date_anchor: string | null;
  was_relative_date: number;
  parser_name: string;
  parser_confidence: number;
  century_bias_applied: number;
  original_year_ambiguous: number;
  is_primary: number;
  merged_from_ids: string | null;
  duplicate_of_id: string | null;
  conflict_event_id: string | null;
  conflict_type: string | null;
  conflict_resolved: number;
  status: string;
  auto_approve_reason: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  timeline_event_id: string | null;
  converted_at: string | null;
  reverted_at: string | null;
  reverted_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface DatePatternRow {
  pattern_id: string;
  name: string;
  regex: string;
  category: string | null;
  priority: number;
  enabled: number;
  test_cases: string | null;
  created_at: string;
}

export interface DateLearningRow {
  id: number;
  category: string;
  keyword: string;
  approval_count: number;
  rejection_count: number;
  weight_modifier: number;
  last_updated: string | null;
}
```

### Step 3.2: Create Repository

Create file: `packages/desktop/electron/repositories/sqlite-date-extraction-repository.ts`

```typescript
/**
 * SQLite Date Extraction Repository
 * CRUD operations for date_extractions table
 */

import type { Database } from 'better-sqlite3';
import type { DateExtractionRow } from '../main/database.types';
import type { DateExtraction, DateExtractionInput } from '@au-archive/core';

export class SqliteDateExtractionRepository {
  constructor(private readonly db: Database) {}

  /**
   * Create a new extraction
   */
  create(input: DateExtractionInput & { extraction_id: string }): DateExtraction {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO date_extractions (
        extraction_id, source_type, source_id, locid, subid,
        raw_text, parsed_date, date_start, date_end, date_precision,
        date_display, date_edtf, date_sort, sentence, sentence_position,
        category, category_confidence, category_keywords,
        keyword_distance, sentence_position_type, source_age_days, overall_confidence,
        article_date, relative_date_anchor, was_relative_date,
        parser_name, parser_confidence, century_bias_applied, original_year_ambiguous,
        is_primary, merged_from_ids, duplicate_of_id,
        conflict_event_id, conflict_type, conflict_resolved,
        status, auto_approve_reason,
        created_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?
      )
    `);

    stmt.run(
      input.extraction_id, input.source_type, input.source_id, input.locid, input.subid,
      input.raw_text, input.parsed_date, input.date_start, input.date_end, input.date_precision,
      input.date_display, input.date_edtf, input.date_sort, input.sentence, input.sentence_position,
      input.category, input.category_confidence, input.category_keywords,
      input.keyword_distance, input.sentence_position_type, input.source_age_days, input.overall_confidence,
      input.article_date, input.relative_date_anchor, input.was_relative_date || 0,
      input.parser_name || 'chrono', input.parser_confidence, input.century_bias_applied || 0, input.original_year_ambiguous || 0,
      input.is_primary ?? 1, input.merged_from_ids, input.duplicate_of_id,
      input.conflict_event_id, input.conflict_type, input.conflict_resolved || 0,
      input.status || 'pending', input.auto_approve_reason,
      now
    );

    return this.findById(input.extraction_id)!;
  }

  /**
   * Find extraction by ID
   */
  findById(extractionId: string): DateExtraction | undefined {
    const row = this.db.prepare(
      'SELECT * FROM date_extractions WHERE extraction_id = ?'
    ).get(extractionId) as DateExtractionRow | undefined;

    return row ? this.rowToExtraction(row) : undefined;
  }

  /**
   * Find all extractions for a location
   */
  findByLocation(locid: string): DateExtraction[] {
    const rows = this.db.prepare(
      'SELECT * FROM date_extractions WHERE locid = ? ORDER BY date_sort ASC'
    ).all(locid) as DateExtractionRow[];

    return rows.map(r => this.rowToExtraction(r));
  }

  /**
   * Find pending extractions (global queue)
   */
  findPending(limit: number = 100): DateExtraction[] {
    const rows = this.db.prepare(`
      SELECT * FROM date_extractions
      WHERE status = 'pending' AND is_primary = 1
      ORDER BY overall_confidence DESC
      LIMIT ?
    `).all(limit) as DateExtractionRow[];

    return rows.map(r => this.rowToExtraction(r));
  }

  /**
   * Find extractions with conflicts
   */
  findWithConflicts(): DateExtraction[] {
    const rows = this.db.prepare(`
      SELECT * FROM date_extractions
      WHERE conflict_event_id IS NOT NULL AND conflict_resolved = 0
      ORDER BY created_at DESC
    `).all() as DateExtractionRow[];

    return rows.map(r => this.rowToExtraction(r));
  }

  /**
   * Update extraction status
   */
  updateStatus(
    extractionId: string,
    status: string,
    userId?: string,
    reason?: string
  ): void {
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE date_extractions
      SET status = ?, reviewed_at = ?, reviewed_by = ?,
          rejection_reason = CASE WHEN ? = 'rejected' THEN ? ELSE rejection_reason END,
          auto_approve_reason = CASE WHEN ? = 'auto_approved' THEN ? ELSE auto_approve_reason END,
          updated_at = ?
      WHERE extraction_id = ?
    `).run(status, now, userId, status, reason, status, reason, now, extractionId);
  }

  /**
   * Link extraction to timeline event
   */
  linkToTimeline(extractionId: string, eventId: string): void {
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE date_extractions
      SET timeline_event_id = ?, converted_at = ?, status = 'converted', updated_at = ?
      WHERE extraction_id = ?
    `).run(eventId, now, now, extractionId);
  }

  /**
   * Revert a conversion
   */
  revert(extractionId: string, userId: string): void {
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE date_extractions
      SET status = 'reverted', reverted_at = ?, reverted_by = ?,
          timeline_event_id = NULL, updated_at = ?
      WHERE extraction_id = ?
    `).run(now, userId, now, extractionId);
  }

  /**
   * Find duplicates for dedup
   */
  findDuplicates(locid: string, dateStart: string, category: string): DateExtraction[] {
    const rows = this.db.prepare(`
      SELECT * FROM date_extractions
      WHERE locid = ? AND date_start = ? AND category = ?
      ORDER BY overall_confidence DESC
    `).all(locid, dateStart, category) as DateExtractionRow[];

    return rows.map(r => this.rowToExtraction(r));
  }

  /**
   * Mark as duplicate
   */
  markAsDuplicate(extractionId: string, primaryId: string): void {
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE date_extractions
      SET is_primary = 0, duplicate_of_id = ?, updated_at = ?
      WHERE extraction_id = ?
    `).run(primaryId, now, extractionId);
  }

  /**
   * Get extraction statistics
   */
  getStats(): { pending: number; approved: number; rejected: number; converted: number } {
    const result = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status IN ('auto_approved', 'user_approved') THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as converted
      FROM date_extractions
    `).get() as any;

    return {
      pending: result.pending || 0,
      approved: result.approved || 0,
      rejected: result.rejected || 0,
      converted: result.converted || 0,
    };
  }

  /**
   * Convert row to domain object
   */
  private rowToExtraction(row: DateExtractionRow): DateExtraction {
    return {
      extraction_id: row.extraction_id,
      source_type: row.source_type as any,
      source_id: row.source_id,
      locid: row.locid,
      subid: row.subid,
      raw_text: row.raw_text,
      parsed_date: row.parsed_date,
      date_start: row.date_start,
      date_end: row.date_end,
      date_precision: row.date_precision,
      date_display: row.date_display,
      date_edtf: row.date_edtf,
      date_sort: row.date_sort,
      sentence: row.sentence,
      sentence_position: row.sentence_position,
      category: row.category as any,
      category_confidence: row.category_confidence,
      category_keywords: row.category_keywords,
      keyword_distance: row.keyword_distance,
      sentence_position_type: row.sentence_position_type,
      source_age_days: row.source_age_days,
      overall_confidence: row.overall_confidence,
      article_date: row.article_date,
      relative_date_anchor: row.relative_date_anchor,
      was_relative_date: row.was_relative_date,
      parser_name: row.parser_name,
      parser_confidence: row.parser_confidence,
      century_bias_applied: row.century_bias_applied,
      original_year_ambiguous: row.original_year_ambiguous,
      is_primary: row.is_primary,
      merged_from_ids: row.merged_from_ids,
      duplicate_of_id: row.duplicate_of_id,
      conflict_event_id: row.conflict_event_id,
      conflict_type: row.conflict_type,
      conflict_resolved: row.conflict_resolved,
      status: row.status as any,
      auto_approve_reason: row.auto_approve_reason,
      reviewed_at: row.reviewed_at,
      reviewed_by: row.reviewed_by,
      rejection_reason: row.rejection_reason,
      timeline_event_id: row.timeline_event_id,
      converted_at: row.converted_at,
      reverted_at: row.reverted_at,
      reverted_by: row.reverted_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
```

---

## 6. Phase 4: Processor Service

Create file: `packages/desktop/electron/services/date-extraction-processor.ts`

```typescript
/**
 * Date Extraction Processor
 * Orchestrates extraction, deduplication, conflict detection, and auto-approval
 */

import type { Database } from 'better-sqlite3';
import type { DateExtraction, DateCategory } from '@au-archive/core';
import { CATEGORY_TO_TIMELINE } from '@au-archive/core';
import { DateEngineService, getDateEngine } from './date-engine-service';
import { SqliteDateExtractionRepository } from '../repositories/sqlite-date-extraction-repository';

// Categories that auto-approve with high confidence
const AUTO_APPROVE_CATEGORIES: DateCategory[] = ['build_date', 'opening', 'demolition'];
const AUTO_APPROVE_THRESHOLD = 0.6;

export interface ProcessResult {
  extracted: number;
  duplicates: number;
  conflicts: number;
  autoApproved: number;
  errors: string[];
}

export class DateExtractionProcessor {
  private dateEngine: DateEngineService;
  private repository: SqliteDateExtractionRepository;
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.dateEngine = getDateEngine();
    this.repository = new SqliteDateExtractionRepository(db);
  }

  /**
   * Process text for date extraction
   */
  async processText(
    text: string,
    sourceType: 'web_source' | 'image_caption' | 'document' | 'manual',
    sourceId: string,
    locid?: string,
    subid?: string,
    articleDate?: string
  ): Promise<ProcessResult> {
    const result: ProcessResult = {
      extracted: 0,
      duplicates: 0,
      conflicts: 0,
      autoApproved: 0,
      errors: [],
    };

    try {
      // Extract dates
      const rawExtractions = this.dateEngine.extractDates(text, articleDate);

      for (const raw of rawExtractions) {
        try {
          // Classify category
          const categoryResult = this.dateEngine.classifyCategory(raw.sentence);

          // Calculate position type
          const positionType = this.dateEngine.getSentencePositionType(
            raw.sentencePosition,
            raw.sentence.length
          );

          // Calculate overall confidence
          const overallConfidence = this.dateEngine.calculateOverallConfidence(
            raw.parserConfidence,
            categoryResult.confidence,
            categoryResult.keywordDistance,
            positionType
          );

          // Generate ID
          const extractionId = await this.dateEngine.generateExtractionId();

          // Create extraction
          const extraction = this.repository.create({
            extraction_id: extractionId,
            source_type: sourceType,
            source_id: sourceId,
            locid: locid || null,
            subid: subid || null,
            raw_text: raw.rawText,
            parsed_date: raw.parsedDate,
            date_start: raw.dateStart,
            date_end: raw.dateEnd,
            date_precision: raw.precision,
            date_display: raw.display,
            date_edtf: raw.edtf,
            date_sort: raw.dateSort,
            sentence: raw.sentence,
            sentence_position: raw.sentencePosition,
            category: categoryResult.category,
            category_confidence: categoryResult.confidence,
            category_keywords: JSON.stringify(categoryResult.matchedKeywords),
            keyword_distance: categoryResult.keywordDistance,
            sentence_position_type: positionType,
            source_age_days: this.calculateSourceAge(articleDate),
            overall_confidence: overallConfidence,
            article_date: articleDate || null,
            relative_date_anchor: raw.wasRelativeDate ? articleDate : null,
            was_relative_date: raw.wasRelativeDate ? 1 : 0,
            parser_confidence: raw.parserConfidence,
            century_bias_applied: raw.centuryBiasApplied ? 1 : 0,
            original_year_ambiguous: raw.originalYearAmbiguous ? 1 : 0,
          });

          result.extracted++;

          // Check for duplicates
          if (locid && raw.dateStart) {
            const isDup = await this.checkAndMarkDuplicate(extraction);
            if (isDup) result.duplicates++;
          }

          // Check for conflicts
          if (locid) {
            const hasConflict = await this.checkTimelineConflict(extraction);
            if (hasConflict) result.conflicts++;
          }

          // Auto-approve if eligible
          if (this.shouldAutoApprove(extraction)) {
            this.repository.updateStatus(
              extraction.extraction_id,
              'auto_approved',
              'system',
              `High confidence ${extraction.category}`
            );
            result.autoApproved++;
          }
        } catch (err) {
          result.errors.push(`Failed to process date "${raw.rawText}": ${err}`);
        }
      }
    } catch (err) {
      result.errors.push(`Extraction failed: ${err}`);
    }

    return result;
  }

  /**
   * Check if extraction should be auto-approved
   */
  private shouldAutoApprove(extraction: DateExtraction): boolean {
    return (
      AUTO_APPROVE_CATEGORIES.includes(extraction.category as DateCategory) &&
      extraction.overall_confidence >= AUTO_APPROVE_THRESHOLD &&
      !extraction.conflict_event_id
    );
  }

  /**
   * Check and mark duplicates
   */
  private async checkAndMarkDuplicate(extraction: DateExtraction): Promise<boolean> {
    if (!extraction.locid || !extraction.date_start) return false;

    const duplicates = this.repository.findDuplicates(
      extraction.locid,
      extraction.date_start,
      extraction.category
    );

    if (duplicates.length > 1) {
      // Find the one with highest confidence (excluding current)
      const primary = duplicates.reduce((a, b) =>
        a.overall_confidence > b.overall_confidence ? a : b
      );

      // If current is not primary, mark it
      if (primary.extraction_id !== extraction.extraction_id) {
        this.repository.markAsDuplicate(extraction.extraction_id, primary.extraction_id);
        return true;
      }
    }

    return false;
  }

  /**
   * Check for timeline conflicts
   */
  private async checkTimelineConflict(extraction: DateExtraction): Promise<boolean> {
    if (!extraction.locid) return false;

    const mapping = CATEGORY_TO_TIMELINE[extraction.category as DateCategory];
    if (!mapping) return false;

    // Query timeline for matching event type
    const stmt = this.db.prepare(`
      SELECT event_id, date_start, date_display
      FROM location_timeline
      WHERE locid = ? AND event_type = ? AND event_subtype = ?
      LIMIT 1
    `);

    const existing = stmt.get(
      extraction.locid,
      mapping.type,
      mapping.subtype || null
    ) as any;

    if (existing && existing.date_start !== extraction.date_start) {
      // Conflict found - update extraction
      this.db.prepare(`
        UPDATE date_extractions
        SET conflict_event_id = ?, conflict_type = 'date_mismatch'
        WHERE extraction_id = ?
      `).run(existing.event_id, extraction.extraction_id);

      return true;
    }

    return false;
  }

  /**
   * Calculate source age in days
   */
  private calculateSourceAge(articleDate?: string): number | null {
    if (!articleDate) return null;

    const article = new Date(articleDate);
    const now = new Date();
    const diffMs = now.getTime() - article.getTime();

    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
}
```

---

## 7. Phase 5: IPC Layer

Create file: `packages/desktop/electron/main/ipc-handlers/date-engine.ts`

```typescript
/**
 * Date Engine IPC Handlers
 * Exposes Date Engine functionality to renderer
 */

import { ipcMain } from 'electron';
import type { Database } from 'better-sqlite3';
import { DateExtractionProcessor } from '../../services/date-extraction-processor';
import { SqliteDateExtractionRepository } from '../../repositories/sqlite-date-extraction-repository';
import { getDateEngine } from '../../services/date-engine-service';

export function registerDateEngineHandlers(db: Database): void {
  const repository = new SqliteDateExtractionRepository(db);
  const processor = new DateExtractionProcessor(db);
  const engine = getDateEngine();

  // Extract from text
  ipcMain.handle('dateEngine:extractFromText', async (_, text: string, options?: {
    sourceType?: string;
    sourceId?: string;
    locid?: string;
    subid?: string;
    articleDate?: string;
  }) => {
    return processor.processText(
      text,
      (options?.sourceType as any) || 'manual',
      options?.sourceId || 'manual-' + Date.now(),
      options?.locid,
      options?.subid,
      options?.articleDate
    );
  });

  // Get pending extractions (global queue)
  ipcMain.handle('dateEngine:getPendingReview', async (_, limit?: number) => {
    return repository.findPending(limit);
  });

  // Get extractions for location
  ipcMain.handle('dateEngine:getByLocation', async (_, locid: string) => {
    return repository.findByLocation(locid);
  });

  // Get conflicts
  ipcMain.handle('dateEngine:getConflicts', async () => {
    return repository.findWithConflicts();
  });

  // Approve extraction
  ipcMain.handle('dateEngine:approve', async (_, extractionId: string, userId: string) => {
    repository.updateStatus(extractionId, 'user_approved', userId);
    return repository.findById(extractionId);
  });

  // Reject extraction
  ipcMain.handle('dateEngine:reject', async (_, extractionId: string, userId: string, reason?: string) => {
    repository.updateStatus(extractionId, 'rejected', userId, reason);
    return repository.findById(extractionId);
  });

  // Convert to timeline
  ipcMain.handle('dateEngine:convertToTimeline', async (_, extractionId: string, userId: string) => {
    // Implementation connects to timeline service
    const extraction = repository.findById(extractionId);
    if (!extraction) throw new Error('Extraction not found');

    // TODO: Create timeline event and link
    // For now, just mark as converted
    repository.updateStatus(extractionId, 'converted', userId);
    return repository.findById(extractionId);
  });

  // Revert conversion
  ipcMain.handle('dateEngine:revert', async (_, extractionId: string, userId: string) => {
    repository.revert(extractionId, userId);
    return repository.findById(extractionId);
  });

  // Get statistics
  ipcMain.handle('dateEngine:getStats', async () => {
    return repository.getStats();
  });

  console.log('[IPC] Date Engine handlers registered');
}
```

Then register in `packages/desktop/electron/main/ipc-handlers/index.ts`:

```typescript
import { registerDateEngineHandlers } from './date-engine';

// In registerAllHandlers function:
registerDateEngineHandlers(db);
```

---

## 8. Phase 6: Integration

Add to `packages/desktop/electron/preload/preload.cjs`:

```javascript
// Date Engine API
dateEngine: {
  extractFromText: (text, options) => ipcRenderer.invoke('dateEngine:extractFromText', text, options),
  getPendingReview: (limit) => ipcRenderer.invoke('dateEngine:getPendingReview', limit),
  getByLocation: (locid) => ipcRenderer.invoke('dateEngine:getByLocation', locid),
  getConflicts: () => ipcRenderer.invoke('dateEngine:getConflicts'),
  approve: (extractionId, userId) => ipcRenderer.invoke('dateEngine:approve', extractionId, userId),
  reject: (extractionId, userId, reason) => ipcRenderer.invoke('dateEngine:reject', extractionId, userId, reason),
  convertToTimeline: (extractionId, userId) => ipcRenderer.invoke('dateEngine:convertToTimeline', extractionId, userId),
  revert: (extractionId, userId) => ipcRenderer.invoke('dateEngine:revert', extractionId, userId),
  getStats: () => ipcRenderer.invoke('dateEngine:getStats'),
},
```

---

## 9. Phases 7-15: Additional Features

Due to length, these are summarized. Full implementation follows the same patterns:

### Phase 7: Image Caption Extraction
- Query `web_source_images` for alt/caption text
- Process each with `DateExtractionProcessor`

### Phase 8-9: Review UI
- Create Svelte components using existing patterns
- Keyboard shortcuts via `on:keydown` handlers

### Phase 10: Backfill
- Query all web_sources with text
- Process in batches with progress events

### Phase 11: ML Learning
- Track approvals in `date_engine_learning`
- Adjust confidence scores based on historical accuracy

### Phase 12: OCR
- Use tesseract.js to extract text from documents
- Feed extracted text to processor

### Phase 13: Keyboard Shortcuts
- Add event listeners in review components
- Focus management with `tabindex`

### Phase 14: CSV Export
- Generate CSV with Papa Parse
- Import with validation

### Phase 15: Pattern Library
- CRUD for custom patterns
- Pattern testing UI

---

## 10. Testing

### Manual Testing Checklist

1. [ ] App starts without errors
2. [ ] Migration 76 runs successfully
3. [ ] Can extract dates from sample text
4. [ ] Categories are classified correctly
5. [ ] Duplicates are detected
6. [ ] Auto-approval works for build dates
7. [ ] Review UI shows pending extractions
8. [ ] Approve/reject updates status
9. [ ] Convert creates timeline event
10. [ ] Revert removes timeline event

### Sample Test Data

```typescript
const testText = `
The hospital was built in 1923 and served the community for decades.
It closed its doors in 1987 when the new facility opened.
The building was demolished in 2015.
I visited the site on March 15, 2020 and photographed the remains.
`;

// Expected extractions:
// - 1923: build_date
// - 1987: closure
// - 2015: demolition
// - March 15, 2020: site_visit
```

---

## 11. Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Migration fails | Check for syntax errors in SQL |
| chrono-node not found | Run `pnpm install` |
| IPC not working | Check handler registration |
| Preload error | Ensure CommonJS syntax |

### Debug Tips

1. Check console for migration messages
2. Use `db.prepare('SELECT * FROM date_extractions').all()` to inspect
3. Add `console.log` in processor for extraction flow
4. Check DevTools Network tab for IPC calls

---

## Summary

This guide covers the complete implementation of the Date Engine. Follow phases in order, testing each before moving to the next. The architecture follows existing patterns in the codebase for consistency.

Total estimated implementation time: 15-20 hours for experienced developer.
