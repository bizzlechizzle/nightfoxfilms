# Date Engine v3 - Hybrid Chrono-Node Implementation Guide

**Version:** 3.0
**Date:** 2025-12-13
**Status:** Implementation Guide

---

## Executive Summary

The Date Engine v3 implements a **hybrid pipeline** that combines:
1. **Pre-filtering** to remove false positives BEFORE parsing
2. **Pattern extraction** for high-confidence explicit date formats
3. **Chrono-node parsing** for complex/informal date expressions
4. **Post-filtering** with keyword proximity validation
5. **Deduplication** to merge overlapping extractions

This approach maximizes recall (finds more dates) while minimizing false positives (rejects garbage like "110 to 130").

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        TEXT INPUT                                │
│  "The factory was built in 1923 and employed 110 to 130 people" │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: PRE-FILTER (Mask False Positives)                     │
│                                                                  │
│  Input:  "...employed 110 to 130 people..."                     │
│  Output: "...employed ███████████ people..."                    │
│                                                                  │
│  • Numeric ranges (X to Y)                                      │
│  • Formatted numbers (1,500)                                    │
│  • Measurements (50 feet, 20 employees)                         │
│  • Currency ($1,923)                                            │
│  • Times (9:00 to 5:00)                                         │
│  • Phone numbers, route numbers, percentages                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 2: EXPLICIT PATTERN EXTRACTION (High Confidence)         │
│                                                                  │
│  Patterns (confidence 1.0):                                     │
│  • MM/DD/YYYY, YYYY-MM-DD                                       │
│  • "March 15, 1968", "15 March 1968"                            │
│  • "March 1968", "September, 1923"                              │
│                                                                  │
│  These bypass chrono-node entirely (already precise)            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 3: CHRONO-NODE PARSING (Edge Cases)                      │
│                                                                  │
│  Custom Configuration:                                          │
│  • Historical bias refiner (2-digit years → 1900s)              │
│  • Strict mode disabled for "circa", "late", etc.               │
│                                                                  │
│  Handles:                                                       │
│  • "3rd of March 1968" → 1968-03-03                             │
│  • "circa 1920" → ~1920                                         │
│  • "late 1800s" → ~1890                                         │
│  • "the 1920s" → 1920-1929                                      │
│  • "mid-century" → ~1950                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 4: POST-FILTER (Validation)                              │
│                                                                  │
│  For EACH candidate:                                            │
│  1. Check keyword proximity (within 50 chars)                   │
│  2. Detect category (build_date, opening, closure, etc.)        │
│  3. Calculate confidence score                                  │
│  4. REJECT if:                                                  │
│     • Year-only with no keyword context                         │
│     • Confidence < 0.3                                          │
│     • Year outside 1800-2099                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 5: DEDUPLICATION                                         │
│                                                                  │
│  • Merge overlapping extractions at same position               │
│  • Keep highest confidence version                              │
│  • Combine context from multiple sources                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FINAL EXTRACTIONS                          │
│  [{ raw: "built in 1923", year: 1923, category: "build_date" }] │
└─────────────────────────────────────────────────────────────────┘
```

---

## Confidence Scoring Algorithm

### Formula

```
Overall Confidence = (Pattern × 0.35) + (Keyword × 0.35) + (Historical × 0.15) + (Specificity × 0.15)
```

### Pattern Confidence (35%)

| Pattern Type | Confidence |
|-------------|------------|
| Full date (MM/DD/YYYY, March 15, 1968) | 1.0 |
| Month + Year (March 1968) | 0.85 |
| Year with keyword ("built in 1923") | 0.7 |
| Chrono informal ("circa 1920") | 0.6 |
| Chrono decade ("the 1920s") | 0.5 |
| Year with proximity only | 0.4 |

### Keyword Proximity Confidence (35%)

| Distance | Confidence |
|----------|------------|
| Adjacent (0-10 chars) | 1.0 |
| Near (11-30 chars) | 0.8 |
| Same sentence (31-100 chars) | 0.5 |
| Distant (100+ chars) | 0.2 |
| No keyword found | 0.0 |

### Historical Plausibility (15%)

| Year Range | Confidence | Rationale |
|-----------|------------|-----------|
| 1800-1920 | 1.0 | Prime historical period |
| 1921-1970 | 0.95 | Core urbex period |
| 1971-2000 | 0.8 | Modern abandonment |
| 2001-2020 | 0.6 | Recent |
| 2021-present | 0.4 | Very recent |
| Outside 1800-2099 | 0.0 | Reject |

### Specificity Bonus (15%)

| Specificity | Confidence |
|------------|------------|
| Exact date (YYYY-MM-DD) | 1.0 |
| Month precision (YYYY-MM) | 0.8 |
| Year precision (YYYY) | 0.6 |
| Decade (1920s) | 0.4 |
| Approximate (circa, late) | 0.3 |

---

## Category Detection

### Keywords by Category

| Category | Keywords | Auto-Approve Threshold |
|----------|----------|----------------------|
| `build_date` | built, constructed, erected, established, founded, completed, construction, dating from | 0.7 |
| `opening` | opened, inaugurated, grand opening, began operations, ribbon cutting, doors opened | 0.7 |
| `closure` | closed, shut down, abandoned, ceased operations, shuttered, went out of business | 0.6 (manual) |
| `demolition` | demolished, torn down, razed, destroyed, bulldozed, leveled, wrecking ball | 0.7 |
| `site_visit` | visited, explored, photographed, toured, expedition, urbex | 0.0 (never auto) |
| `publication` | published, posted, article, updated, written, reported | 0.0 (never auto) |
| `obituary` | died, passed away, obituary, death, funeral, memorial | 0.0 (never auto) |
| `unknown` | (no keywords matched) | N/A (reject if year-only) |

---

## False Positive Patterns (Blacklist)

### Numeric Ranges
```regex
\b\d+\s+to\s+\d+\b          # "110 to 130"
\b\d{1,3}\s*-\s*\d{1,3}\b   # "20-30" (but not dates)
```

### Formatted Numbers
```regex
\b\d{1,3},\d{3}\b           # "1,500"
\b\d{1,3},\d{3},\d{3}\b     # "1,500,000"
```

### Measurements
```regex
\b\d+\s*(?:feet|foot|ft|meters?|m|inches?|in|yards?|yd|miles?|mi)\b
\b\d+\s*(?:pounds?|lbs?|ounces?|oz|kilograms?|kg|grams?|g)\b
\b\d+\s*(?:acres?|hectares?|ha|sqft|sq\s*ft|square\s*feet)\b
\b\d+\s*(?:employees?|workers?|people|persons?|staff|members?)\b
\b\d+\s*(?:units?|rooms?|beds?|floors?|stories)\b
```

### Currency
```regex
\$\s*[\d,]+(?:\.\d{2})?     # "$1,500.00"
\b\d+\s*(?:dollars?|cents?|bucks?)\b
```

### Times
```regex
\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm|AM|PM)?\b
```

### Identifiers
```regex
\b(?:route|rt|hwy|highway|interstate|i-)\s*\d+\b
\b(?:room|rm|building|bldg|suite|ste|apt|unit|floor|fl)\s*#?\s*\d+\b
\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b   # Phone numbers
#\d+\b                               # Hashtags
```

### Other
```regex
\b\d+(?:\.\d+)?\s*%         # Percentages
\b-?\d{1,3}\.\d{4,}\b       # Coordinates
\b\d+\s*(?:years?\s+old|year-old|yo)\b  # Ages
```

---

## Chrono-Node Configuration

### Historical Bias Refiner

```typescript
function createHistoricalBiasRefiner(): Refiner {
  return {
    refine: (context, results) => {
      for (const result of results) {
        const year = result.start.get('year');

        // Convert 2-digit years 20-99 to 1920-1999
        if (year && year >= 2020 && year <= 2099) {
          const twoDigitMatch = result.text.match(/\b(\d{2})\b/);
          if (twoDigitMatch) {
            const twoDigit = parseInt(twoDigitMatch[1], 10);
            if (twoDigit >= 20 && twoDigit <= 99) {
              result.start.assign('year', 1900 + twoDigit);
            }
          }
        }
      }
      return results;
    },
  };
}
```

### Circa/Approximate Handler

Chrono-node handles these natively, but we tag them:
- "circa 1920" → year: 1920, approximate: true
- "late 1800s" → year: 1890, approximate: true, precision: 'decade'
- "early 20th century" → year: 1910, approximate: true, precision: 'decade'

---

## API Contract

### Input

```typescript
interface ExtractDatesInput {
  text: string;                    // Full text to extract from
  articleDate?: string | null;     // ISO date for relative date anchoring
  options?: {
    minConfidence?: number;        // Default: 0.3
    requireKeyword?: boolean;      // Default: true for year-only
    includeApproximate?: boolean;  // Default: true
  };
}
```

### Output

```typescript
interface ExtractionResult {
  // Core date info
  raw_text: string;              // "built in 1923"
  parsed_date: string | null;    // "1923"
  date_start: string | null;     // "1923" or "1923-03-15"
  date_end: string | null;       // For ranges
  date_precision: DatePrecision; // 'exact' | 'month' | 'year' | 'decade' | 'approximate'
  date_display: string | null;   // "1923" or "March 15, 1923"
  date_edtf: string | null;      // "1923" or "1923-03-15"
  date_sort: number | null;      // 19230101

  // Context
  sentence: string;              // Containing sentence
  sentence_position: number;     // Index in original text
  category: DateCategory;        // 'build_date', 'opening', etc.
  category_confidence: number;   // 0-1
  category_keywords: string[];   // ["built", "construction"]

  // Confidence details
  keyword_distance: number | null;
  sentence_position_type: SentencePositionType;
  pattern_confidence: number;
  overall_confidence: number;

  // Parsing metadata
  extraction_method: 'pattern' | 'chrono';
  is_approximate: boolean;
  century_bias_applied: boolean;
  was_relative_date: boolean;
  relative_date_anchor: string | null;
}
```

---

## Test Cases

### Must Extract

| Input | Expected Output | Category | Confidence |
|-------|-----------------|----------|------------|
| "The factory was built in 1923" | 1923 | build_date | ≥0.7 |
| "Opened March 15, 1968" | 1968-03-15 | opening | ≥0.9 |
| "circa 1895" | ~1895 | build_date | ≥0.5 |
| "the late 1800s" | ~1890 | unknown | ≥0.4 |
| "from 1920 to 1935" | 1920-1935 | build_date | ≥0.6 |
| "3rd of March 1968" | 1968-03-03 | unknown | ≥0.8 |
| "Published: 04/28/2025" | 2025-04-28 | publication | ≥0.9 |
| "Established 1895 by John Smith" | 1895 | build_date | ≥0.7 |
| "dates from 1887" | 1887 | build_date | ≥0.7 |
| "closed its doors in 2008" | 2008 | closure | ≥0.7 |
| "abandoned since the 1970s" | ~1975 | closure | ≥0.5 |

### Must Reject

| Input | Reason |
|-------|--------|
| "110 to 130 employees" | Numeric range |
| "1,500 square feet" | Formatted number with unit |
| "Open 9:00 to 5:00" | Time range |
| "$1,923 in damages" | Currency |
| "Take Route 1923 north" | Route number |
| "1923" (alone) | No keyword context |
| "20-30 employees" | Range with unit |
| "The building is 50 years old" | Age reference |
| "Room 1923" | Room number |

---

## File Changes

### Primary File
`packages/desktop/electron/services/date-engine-service.ts` - Complete rewrite (~600 lines)

### No Changes Required
- `packages/core/src/domain/date-extraction.ts` - Types sufficient
- `packages/desktop/electron/services/date-extraction-processor.ts` - Uses service
- UI components - No changes needed

---

## Implementation Checklist

- [ ] Phase 1: Pre-filter implementation
- [ ] Phase 2: Explicit pattern extraction
- [ ] Phase 3: Chrono-node integration with historical bias
- [ ] Phase 4: Post-filter with keyword proximity
- [ ] Phase 5: Deduplication
- [ ] Confidence scoring algorithm
- [ ] Category detection
- [ ] Test suite (all 22 test cases)
- [ ] Integration verification
- [ ] Documentation update

---

## Success Criteria

1. **Zero false positives** on numeric ranges, measurements, currency
2. **High recall** on explicit dates (≥95%)
3. **Good recall** on informal dates like "circa", "late 1800s" (≥80%)
4. **Accurate categorization** based on keyword proximity
5. **Appropriate confidence scores** reflecting extraction quality
6. **No regression** from v2 functionality
