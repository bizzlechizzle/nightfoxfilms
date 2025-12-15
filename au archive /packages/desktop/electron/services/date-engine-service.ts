/**
 * Date Engine Service v3
 * Hybrid Chrono-Node Implementation
 *
 * Architecture:
 * 1. PRE-FILTER: Mask false positives before parsing
 * 2. PATTERN EXTRACTION: High-confidence explicit patterns
 * 3. CHRONO-NODE: Complex/informal date expressions
 * 4. POST-FILTER: Keyword proximity validation
 * 5. DEDUPLICATION: Merge overlapping extractions
 *
 * @version 3.0
 * @author Claude Code
 */

import * as chrono from 'chrono-node';
import type { ParsedResult, Refiner } from 'chrono-node';
import type {
  DateCategory,
  DatePrecision,
  ExtractionResult,
  SentencePositionType,
} from '@au-archive/core';
import {
  CATEGORY_KEYWORDS,
  AUTO_APPROVE_CATEGORIES,
  AUTO_APPROVE_MIN_CONFIDENCE,
} from '@au-archive/core';

// =============================================================================
// Types
// =============================================================================

interface DateCandidate {
  raw_text: string;
  index: number;
  year: number;
  month: number | null;
  day: number | null;
  end_year?: number;
  end_month?: number | null;
  end_day?: number | null;
  pattern_type: 'full_date' | 'month_year' | 'year_keyword' | 'year_context' | 'chrono';
  pattern_confidence: number;
  extraction_method: 'pattern' | 'chrono';
  is_approximate: boolean;
  chrono_tags?: Record<string, unknown>;
}

interface MaskRegion {
  start: number;
  end: number;
  original: string;
  reason: string;
}

interface PreFilterResult {
  filtered: string;
  masks: MaskRegion[];
}

// =============================================================================
// PHASE 1: PRE-FILTER (False Positive Masking)
// =============================================================================

/**
 * Patterns that indicate a number is NOT a date
 * These are masked BEFORE any date parsing
 */
const FALSE_POSITIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Numeric ranges (CRITICAL: "110 to 130")
  { pattern: /\b\d+\s+to\s+\d+\b/gi, reason: 'numeric_range' },

  // Dashed ranges without date format
  { pattern: /\b\d{1,3}\s*-\s*\d{1,3}(?=\s*(?:employees?|workers?|people|persons?|staff|members?|units?|rooms?|beds?|floors?|stories))/gi, reason: 'range_with_unit' },

  // Formatted numbers with commas
  { pattern: /\b\d{1,3},\d{3}(?:,\d{3})?\b/g, reason: 'formatted_number' },

  // Measurements - distance
  { pattern: /\b\d+(?:\.\d+)?\s*(?:feet|foot|ft|meters?|m|inches?|in|yards?|yd|miles?|mi|km|kilometers?)\b/gi, reason: 'measurement_distance' },

  // Measurements - weight
  { pattern: /\b\d+(?:\.\d+)?\s*(?:pounds?|lbs?|ounces?|oz|kilograms?|kg|grams?|g|tons?)\b/gi, reason: 'measurement_weight' },

  // Measurements - area
  { pattern: /\b\d+(?:\.\d+)?\s*(?:acres?|hectares?|ha|sqft|sq\s*ft|square\s*feet|square\s*meters?|sq\s*m)\b/gi, reason: 'measurement_area' },

  // Counts - people
  { pattern: /\b\d+\s*(?:employees?|workers?|people|persons?|staff|members?|residents?|students?|patients?|visitors?)\b/gi, reason: 'count_people' },

  // Counts - objects
  { pattern: /\b\d+\s*(?:units?|rooms?|beds?|floors?|stories|buildings?|houses?|apartments?|cars?|vehicles?)\b/gi, reason: 'count_objects' },

  // Currency - dollar sign
  { pattern: /\$\s*[\d,]+(?:\.\d{2})?/g, reason: 'currency_dollar' },

  // Currency - words
  { pattern: /\b\d+(?:,\d{3})*\s*(?:dollars?|cents?|bucks?|USD|EUR|GBP)\b/gi, reason: 'currency_word' },

  // Times (must come before date parsing)
  { pattern: /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm|AM|PM|a\.m\.|p\.m\.)?\b/g, reason: 'time' },

  // Time ranges - require at least one time indicator (colon or am/pm) to avoid matching dates like 03-15
  { pattern: /\b\d{1,2}:\d{2}\s*(?:am|pm|AM|PM|a\.m\.|p\.m\.)?\s*(?:to|-)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM|a\.m\.|p\.m\.)?\b/gi, reason: 'time_range' },
  { pattern: /\b\d{1,2}\s*(?:am|pm|AM|PM|a\.m\.|p\.m\.)\s*(?:to|-)\s*\d{1,2}\s*(?:am|pm|AM|PM|a\.m\.|p\.m\.)?\b/gi, reason: 'time_range' },

  // Phone numbers - US format
  { pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, reason: 'phone_number' },
  { pattern: /\(\d{3}\)\s*\d{3}[-.\s]?\d{4}/g, reason: 'phone_number' },

  // Route/Highway numbers
  { pattern: /\b(?:route|rt|rte|hwy|highway|interstate|i-|us-|sr-|state\s+route)\s*#?\s*\d+\b/gi, reason: 'route_number' },

  // Building identifiers
  { pattern: /\b(?:room|rm|building|bldg|suite|ste|apt|apartment|unit|floor|fl|lot|parcel)\s*#?\s*\d+\b/gi, reason: 'building_id' },

  // Percentages
  { pattern: /\b\d+(?:\.\d+)?\s*%/g, reason: 'percentage' },

  // Hashtags
  { pattern: /#\d+\b/g, reason: 'hashtag' },

  // Coordinates (high precision decimals)
  { pattern: /\b-?\d{1,3}\.\d{4,}\b/g, reason: 'coordinate' },

  // Age references
  { pattern: /\b\d+\s*(?:years?\s+old|year-old|-year-old|yo)\b/gi, reason: 'age' },

  // Version numbers
  { pattern: /\bv(?:ersion)?\s*\d+(?:\.\d+)*\b/gi, reason: 'version' },

  // Model numbers (alphanumeric)
  { pattern: /\b[A-Z]{1,3}-?\d{3,}\b/g, reason: 'model_number' },

  // ZIP codes (5 or 9 digit) - be careful not to mask years
  { pattern: /\b\d{5}-\d{4}\b/g, reason: 'zipcode' },

  // Dimensions (LxWxH)
  { pattern: /\b\d+\s*[xX×]\s*\d+(?:\s*[xX×]\s*\d+)?\b/g, reason: 'dimensions' },
];

/**
 * Pre-filter text by masking false positive patterns
 * Returns filtered text and mask regions for position mapping
 */
function preFilterText(text: string): PreFilterResult {
  const masks: MaskRegion[] = [];
  let filtered = text;
  let offset = 0;

  // Collect all matches first, then sort by position
  const allMatches: Array<{ match: RegExpExecArray; reason: string }> = [];

  for (const { pattern, reason } of FALSE_POSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      allMatches.push({ match, reason });
    }
  }

  // Sort by position (start index)
  allMatches.sort((a, b) => a.match.index - b.match.index);

  // Remove overlapping matches (keep first)
  const nonOverlapping: Array<{ match: RegExpExecArray; reason: string }> = [];
  let lastEnd = -1;
  for (const item of allMatches) {
    if (item.match.index >= lastEnd) {
      nonOverlapping.push(item);
      lastEnd = item.match.index + item.match[0].length;
    }
  }

  // Apply masks
  for (const { match, reason } of nonOverlapping) {
    const start = match.index;
    const end = start + match[0].length;
    const original = match[0];

    masks.push({ start, end, original, reason });

    // Replace with mask characters (preserve length for position mapping)
    const mask = '█'.repeat(original.length);
    const adjustedStart = start + offset;
    filtered = filtered.slice(0, adjustedStart) + mask + filtered.slice(adjustedStart + original.length);
  }

  return { filtered, masks };
}

/**
 * Check if a position falls within a masked region
 */
function isInMaskedRegion(index: number, masks: MaskRegion[]): boolean {
  return masks.some(m => index >= m.start && index < m.end);
}

// =============================================================================
// PHASE 2: EXPLICIT PATTERN EXTRACTION
// =============================================================================

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_PATTERN = Object.keys(MONTH_NAMES).join('|');

/**
 * Extract explicit date patterns (highest confidence)
 */
function extractExplicitPatterns(text: string, masks: MaskRegion[]): DateCandidate[] {
  const candidates: DateCandidate[] = [];

  // Pattern 1: MM/DD/YYYY or MM-DD-YYYY
  const fullDatePattern1 = /\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\b/g;
  let match;
  while ((match = fullDatePattern1.exec(text)) !== null) {
    if (isInMaskedRegion(match.index, masks)) continue;
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1800 && year <= 2099) {
      candidates.push({
        raw_text: match[0],
        index: match.index,
        year, month, day,
        pattern_type: 'full_date',
        pattern_confidence: 1.0,
        extraction_method: 'pattern',
        is_approximate: false,
      });
    }
  }

  // Pattern 2: YYYY-MM-DD (ISO format)
  const fullDatePattern2 = /\b(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})\b/g;
  while ((match = fullDatePattern2.exec(text)) !== null) {
    if (isInMaskedRegion(match.index, masks)) continue;
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1800 && year <= 2099) {
      candidates.push({
        raw_text: match[0],
        index: match.index,
        year, month, day,
        pattern_type: 'full_date',
        pattern_confidence: 1.0,
        extraction_method: 'pattern',
        is_approximate: false,
      });
    }
  }

  // Pattern 3: Month Day, Year (March 15, 1968)
  const monthDayYearPattern = new RegExp(
    `\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
    'gi'
  );
  while ((match = monthDayYearPattern.exec(text)) !== null) {
    if (isInMaskedRegion(match.index, masks)) continue;
    const month = MONTH_NAMES[match[1].toLowerCase()];
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    if (month && day >= 1 && day <= 31 && year >= 1800 && year <= 2099) {
      candidates.push({
        raw_text: match[0],
        index: match.index,
        year, month, day,
        pattern_type: 'full_date',
        pattern_confidence: 1.0,
        extraction_method: 'pattern',
        is_approximate: false,
      });
    }
  }

  // Pattern 4: Day Month Year (15 March 1968, 15th of March 1968)
  const dayMonthYearPattern = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_PATTERN})\\.?,?\\s+(\\d{4})\\b`,
    'gi'
  );
  while ((match = dayMonthYearPattern.exec(text)) !== null) {
    if (isInMaskedRegion(match.index, masks)) continue;
    const day = parseInt(match[1], 10);
    const month = MONTH_NAMES[match[2].toLowerCase()];
    const year = parseInt(match[3], 10);
    if (month && day >= 1 && day <= 31 && year >= 1800 && year <= 2099) {
      candidates.push({
        raw_text: match[0],
        index: match.index,
        year, month, day,
        pattern_type: 'full_date',
        pattern_confidence: 1.0,
        extraction_method: 'pattern',
        is_approximate: false,
      });
    }
  }

  // Pattern 5: Month Year (March 1968, September, 1923)
  const monthYearPattern = new RegExp(
    `\\b(${MONTH_PATTERN})\\.?,?\\s+(?:of\\s+)?(\\d{4})\\b`,
    'gi'
  );
  while ((match = monthYearPattern.exec(text)) !== null) {
    if (isInMaskedRegion(match.index, masks)) continue;
    const month = MONTH_NAMES[match[1].toLowerCase()];
    const year = parseInt(match[2], 10);
    if (month && year >= 1800 && year <= 2099) {
      // Check if this is already covered by a more specific pattern
      const alreadyMatched = candidates.some(
        c => c.index <= match!.index && c.index + c.raw_text.length >= match!.index + match![0].length
      );
      if (!alreadyMatched) {
        candidates.push({
          raw_text: match[0],
          index: match.index,
          year, month, day: null,
          pattern_type: 'month_year',
          pattern_confidence: 0.85,
          extraction_method: 'pattern',
          is_approximate: false,
        });
      }
    }
  }

  // Pattern 6: Year with strong keyword (built in 1923, established 1895)
  const strongKeywords = [
    'built', 'constructed', 'erected', 'established', 'founded', 'completed',
    'opened', 'inaugurated', 'began operations', 'began',
    'closed its doors', 'closed', 'shut down', 'abandoned',
    'demolished', 'torn down', 'razed', 'destroyed',
    'dates from', 'dating from', 'dates back to',
  ];
  const yearKeywordPattern = new RegExp(
    `\\b(${strongKeywords.join('|')})\\s+(?:in\\s+)?(\\d{4})\\b`,
    'gi'
  );
  while ((match = yearKeywordPattern.exec(text)) !== null) {
    if (isInMaskedRegion(match.index, masks)) continue;
    const year = parseInt(match[2], 10);
    if (year >= 1800 && year <= 2099) {
      candidates.push({
        raw_text: match[0],
        index: match.index,
        year, month: null, day: null,
        pattern_type: 'year_keyword',
        pattern_confidence: 0.75,
        extraction_method: 'pattern',
        is_approximate: false,
      });
    }
  }

  return candidates;
}

// =============================================================================
// PHASE 3: CHRONO-NODE PARSING
// =============================================================================

/**
 * Custom chrono refiner for historical year bias
 * Converts 2-digit years 20-99 to 1920-1999 (urbex context)
 * ONLY applies when text contains actual 2-digit year (e.g., '25 or 25 alone),
 * NOT when a full 4-digit year is present.
 */
function createHistoricalBiasRefiner(): Refiner {
  return {
    refine: (_context: { text: string }, results: ParsedResult[]): ParsedResult[] => {
      for (const result of results) {
        const year = result.start.get('year');

        // Check if this looks like a 2-digit year that was auto-expanded to 2000s
        if (year && year >= 2020 && year <= 2099) {
          // CRITICAL: Only apply bias if original text has a 2-digit year, NOT a 4-digit year
          // A 4-digit year in the text means chrono parsed it correctly
          const has4DigitYear = /\b(19|20)\d{2}\b/.test(result.text);
          if (has4DigitYear) {
            // Text contains explicit 4-digit year - DO NOT apply century bias
            continue;
          }

          // Look for apostrophe-prefixed 2-digit year (e.g., '25, '95)
          const twoDigitMatch = result.text.match(/[''](\d{2})\b/);
          if (twoDigitMatch) {
            const twoDigit = parseInt(twoDigitMatch[1], 10);
            if (twoDigit >= 20 && twoDigit <= 99) {
              result.start.assign('year', 1900 + twoDigit);
              (result as unknown as Record<string, unknown>)._centuryBiasApplied = true;
            }
          }
        }

        // Also handle end dates in ranges
        if (result.end) {
          const endYear = result.end.get('year');
          if (endYear && endYear >= 2020 && endYear <= 2099) {
            // Only apply if no 4-digit year in text
            const has4DigitYear = /\b(19|20)\d{2}\b/.test(result.text);
            if (has4DigitYear) continue;

            const matches = result.text.match(/[''](\d{2})\b/g);
            if (matches && matches.length > 1) {
              const twoDigit = parseInt(matches[1].replace(/['']/g, ''), 10);
              if (twoDigit >= 20 && twoDigit <= 99) {
                result.end.assign('year', 1900 + twoDigit);
              }
            }
          }
        }
      }
      return results;
    },
  };
}

// Create custom chrono parser with historical bias
const historicalChrono = chrono.casual.clone();
historicalChrono.refiners.push(createHistoricalBiasRefiner());

/**
 * Extract dates using chrono-node (for complex/informal expressions)
 */
function extractWithChrono(
  text: string,
  masks: MaskRegion[],
  articleDate?: string | null
): DateCandidate[] {
  const candidates: DateCandidate[] = [];

  // Use article date as reference for relative dates
  const referenceDate = articleDate ? new Date(articleDate) : new Date();

  // Parse with chrono using historical bias
  const chronoResults = historicalChrono.parse(text, referenceDate, {
    forwardDate: false,
  });

  for (const result of chronoResults) {
    // Skip if in masked region
    if (isInMaskedRegion(result.index, masks)) continue;

    const year = result.start.get('year');
    const month = result.start.get('month');
    const day = result.start.get('day');

    // Skip if no year (chrono sometimes returns partial results)
    if (!year || year < 1800 || year > 2099) continue;

    // Determine if this is an approximate date
    const isApproximate = Boolean(
      result.text.match(/\b(?:circa|c\.|ca\.|around|about|approximately|roughly|late|early|mid|the\s+\d{4}s)\b/i) ||
      (result as unknown as Record<string, unknown>)._centuryBiasApplied
    );

    // Determine pattern confidence based on what chrono found
    let patternConfidence = 0.6;
    if (month !== null && day !== null) {
      patternConfidence = 0.9; // Full date
    } else if (month !== null) {
      patternConfidence = 0.75; // Month + year
    } else if (isApproximate) {
      patternConfidence = 0.5; // Approximate
    }

    candidates.push({
      raw_text: result.text,
      index: result.index,
      year,
      month: month ?? null,
      day: day ?? null,
      end_year: result.end?.get('year') ?? undefined,
      end_month: result.end?.get('month') ?? undefined,
      end_day: result.end?.get('day') ?? undefined,
      pattern_type: 'chrono',
      pattern_confidence: patternConfidence,
      extraction_method: 'chrono',
      is_approximate: isApproximate,
      chrono_tags: (result as unknown as Record<string, unknown>).tags as Record<string, unknown> | undefined,
    });
  }

  return candidates;
}

// =============================================================================
// PHASE 4: POST-FILTER (Keyword Validation)
// =============================================================================

/**
 * Context keywords for validation
 * These must be present near year-only extractions
 */
const CONTEXT_KEYWORDS = [
  // Build/Construction
  'built', 'constructed', 'erected', 'established', 'founded', 'completed',
  'construction', 'dating from', 'dates from', 'dates back to', 'dating to',
  // Opening
  'opened', 'inaugurated', 'began operations', 'first opened', 'doors opened',
  'grand opening', 'ribbon cutting', 'opening',
  // Closure
  'closed', 'shut down', 'abandoned', 'ceased operations', 'shuttered',
  'went out of business', 'closed its doors', 'closure', 'closing',
  // Demolition
  'demolished', 'torn down', 'razed', 'destroyed', 'bulldozed', 'leveled',
  'demolition', 'wrecking',
  // Temporal indicators
  'in', 'from', 'since', 'circa', 'c.', 'ca.', 'around', 'about',
  'during', 'by', 'before', 'after', 'until', 'through',
  // Visit/Documentation
  'visited', 'explored', 'photographed', 'documented', 'recorded',
  // Publication
  'published', 'posted', 'written', 'updated', 'dated',
];

/**
 * Find closest keyword to a position
 */
function findClosestKeyword(
  text: string,
  position: number,
  searchRadius: number = 100
): { keyword: string; distance: number } | null {
  const lowerText = text.toLowerCase();
  const searchStart = Math.max(0, position - searchRadius);
  const searchEnd = Math.min(text.length, position + searchRadius);
  const searchRegion = lowerText.slice(searchStart, searchEnd);

  let closest: { keyword: string; distance: number } | null = null;

  for (const keyword of CONTEXT_KEYWORDS) {
    const keywordLower = keyword.toLowerCase();
    let idx = searchRegion.indexOf(keywordLower);

    while (idx !== -1) {
      const absoluteIdx = searchStart + idx;
      const distance = Math.abs(absoluteIdx - position);

      if (!closest || distance < closest.distance) {
        closest = { keyword, distance };
      }

      idx = searchRegion.indexOf(keywordLower, idx + 1);
    }
  }

  return closest;
}

/**
 * Post-filter candidates based on keyword proximity and validation rules
 */
function postFilterCandidates(
  candidates: DateCandidate[],
  originalText: string,
  minConfidence: number = 0.3
): DateCandidate[] {
  const filtered: DateCandidate[] = [];

  for (const candidate of candidates) {
    // Find closest keyword
    const keywordResult = findClosestKeyword(originalText, candidate.index);

    // Year-only extractions MUST have keyword context
    if (candidate.month === null && candidate.day === null) {
      if (!keywordResult || keywordResult.distance > 100) {
        // Skip year-only without keyword (unless it's from explicit pattern with keyword)
        if (candidate.pattern_type !== 'year_keyword') {
          continue;
        }
      }
    }

    // Calculate confidence
    const confidence = calculateConfidence(candidate, keywordResult, candidate.year);

    // Skip if below minimum confidence
    if (confidence < minConfidence) {
      continue;
    }

    // Attach confidence info
    (candidate as unknown as Record<string, unknown>)._keywordDistance = keywordResult?.distance ?? null;
    (candidate as unknown as Record<string, unknown>)._overallConfidence = confidence;

    filtered.push(candidate);
  }

  return filtered;
}

// =============================================================================
// PHASE 5: DEDUPLICATION
// =============================================================================

/**
 * Deduplicate candidates by merging overlapping extractions
 */
function deduplicateCandidates(candidates: DateCandidate[]): DateCandidate[] {
  if (candidates.length === 0) return [];

  // Sort by index, then by confidence (descending)
  const sorted = [...candidates].sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    const confA = (a as unknown as Record<string, unknown>)._overallConfidence as number || a.pattern_confidence;
    const confB = (b as unknown as Record<string, unknown>)._overallConfidence as number || b.pattern_confidence;
    return confB - confA;
  });

  const deduplicated: DateCandidate[] = [];
  let lastEnd = -1;

  for (const candidate of sorted) {
    const candidateEnd = candidate.index + candidate.raw_text.length;

    // Check for overlap with previous
    if (candidate.index < lastEnd) {
      // Overlapping - check if this is a better match
      const prevCandidate = deduplicated[deduplicated.length - 1];
      const prevConf = (prevCandidate as unknown as Record<string, unknown>)._overallConfidence as number || prevCandidate.pattern_confidence;
      const currConf = (candidate as unknown as Record<string, unknown>)._overallConfidence as number || candidate.pattern_confidence;

      // Only replace if significantly better (>10% improvement)
      if (currConf > prevConf * 1.1) {
        deduplicated[deduplicated.length - 1] = candidate;
        lastEnd = candidateEnd;
      }
      // Otherwise keep previous (already higher confidence)
    } else {
      // No overlap - add
      deduplicated.push(candidate);
      lastEnd = candidateEnd;
    }
  }

  return deduplicated;
}

// =============================================================================
// CONFIDENCE SCORING
// =============================================================================

/**
 * Calculate overall confidence score
 *
 * Formula: (Pattern × 0.35) + (Keyword × 0.35) + (Historical × 0.15) + (Specificity × 0.15)
 */
function calculateConfidence(
  candidate: DateCandidate,
  keywordResult: { keyword: string; distance: number } | null,
  year: number
): number {
  const PATTERN_WEIGHT = 0.35;
  const KEYWORD_WEIGHT = 0.35;
  const HISTORICAL_WEIGHT = 0.15;
  const SPECIFICITY_WEIGHT = 0.15;

  // Pattern confidence (already calculated)
  const patternScore = candidate.pattern_confidence;

  // Keyword proximity score
  let keywordScore = 0;
  if (keywordResult) {
    if (keywordResult.distance <= 10) {
      keywordScore = 1.0;
    } else if (keywordResult.distance <= 30) {
      keywordScore = 0.8;
    } else if (keywordResult.distance <= 100) {
      keywordScore = 0.5;
    } else {
      keywordScore = 0.2;
    }
  }

  // Historical plausibility score
  let historicalScore = 0.5;
  if (year >= 1800 && year <= 1920) {
    historicalScore = 1.0;
  } else if (year >= 1921 && year <= 1970) {
    historicalScore = 0.95;
  } else if (year >= 1971 && year <= 2000) {
    historicalScore = 0.8;
  } else if (year >= 2001 && year <= 2020) {
    historicalScore = 0.6;
  } else if (year >= 2021) {
    historicalScore = 0.4;
  }

  // Specificity score
  let specificityScore = 0.6;
  if (candidate.day !== null && candidate.month !== null) {
    specificityScore = 1.0; // Exact date
  } else if (candidate.month !== null) {
    specificityScore = 0.8; // Month precision
  } else if (candidate.is_approximate) {
    specificityScore = 0.3; // Approximate
  }

  const overall =
    patternScore * PATTERN_WEIGHT +
    keywordScore * KEYWORD_WEIGHT +
    historicalScore * HISTORICAL_WEIGHT +
    specificityScore * SPECIFICITY_WEIGHT;

  return Math.round(overall * 100) / 100;
}

// =============================================================================
// SENTENCE EXTRACTION
// =============================================================================

/**
 * Extract the sentence containing a date from text
 */
export function extractSentence(text: string, dateIndex: number): string {
  const terminators = /[.!?]\s+|[\n\r]{2,}/g;

  let sentenceStart = 0;
  let match;

  terminators.lastIndex = 0;

  while ((match = terminators.exec(text)) !== null) {
    if (match.index + match[0].length <= dateIndex) {
      sentenceStart = match.index + match[0].length;
    } else {
      break;
    }
  }

  terminators.lastIndex = dateIndex;
  const endMatch = terminators.exec(text);
  const sentenceEnd = endMatch ? endMatch.index + 1 : text.length;

  let sentence = text.slice(sentenceStart, sentenceEnd).trim();

  if (sentence.length > 500) {
    const relativeDate = dateIndex - sentenceStart;
    if (relativeDate < 250) {
      sentence = sentence.slice(0, 500) + '...';
    } else {
      sentence = '...' + sentence.slice(-500);
    }
  }

  return sentence;
}

/**
 * Determine position type within sentence
 */
export function getSentencePositionType(
  sentenceLength: number,
  datePosition: number
): SentencePositionType {
  const relative = datePosition / sentenceLength;
  if (relative <= 0.33) return 'beginning';
  if (relative <= 0.66) return 'middle';
  return 'end';
}

// =============================================================================
// CATEGORY DETECTION
// =============================================================================

/**
 * Detect category based on keyword proximity
 */
export function detectCategory(
  sentence: string,
  datePosition: number
): { category: DateCategory; confidence: number; keywords: string[]; distance: number | null } {
  const lowerSentence = sentence.toLowerCase();

  let bestCategory: DateCategory = 'unknown';
  let bestConfidence = 0;
  let bestKeywords: string[] = [];
  let bestDistance: number | null = null;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [DateCategory, string[]][]) {
    if (category === 'unknown') continue;

    let categoryScore = 0;
    const matchedKeywords: string[] = [];
    let closestDistance: number | null = null;

    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      const keywordIndex = lowerSentence.indexOf(keywordLower);

      if (keywordIndex !== -1) {
        matchedKeywords.push(keyword);

        const distance = Math.abs(keywordIndex - datePosition);
        if (closestDistance === null || distance < closestDistance) {
          closestDistance = distance;
        }

        let proximityScore: number;
        if (distance <= 10) {
          proximityScore = 1.0;
        } else if (distance <= 30) {
          proximityScore = 0.8;
        } else if (distance <= 100) {
          proximityScore = 0.5;
        } else {
          proximityScore = 0.2;
        }

        categoryScore += proximityScore;
      }
    }

    if (categoryScore > bestConfidence) {
      bestConfidence = categoryScore;
      bestCategory = category;
      bestKeywords = matchedKeywords;
      bestDistance = closestDistance;
    }
  }

  const normalizedConfidence = Math.min(bestConfidence / 2, 1);

  return {
    category: bestCategory,
    confidence: normalizedConfidence,
    keywords: bestKeywords,
    distance: bestDistance,
  };
}

// =============================================================================
// DATE FORMATTING UTILITIES
// =============================================================================

function formatDate(year: number, month: number | null, day: number | null): string {
  if (month === null) {
    return year.toString();
  }
  const mm = month.toString().padStart(2, '0');
  if (day === null) {
    return `${year}-${mm}`;
  }
  const dd = day.toString().padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function getPrecision(
  month: number | null,
  day: number | null,
  isApproximate: boolean,
  hasEndDate: boolean
): DatePrecision {
  if (hasEndDate) return 'range';
  if (isApproximate) return 'approximate' as DatePrecision;
  if (month !== null && day !== null) return 'exact';
  if (month !== null) return 'month';
  return 'year';
}

function calculateDateSort(year: number, month: number | null, day: number | null): number {
  const m = month ?? 1;
  const d = day ?? 1;
  return year * 10000 + m * 100 + d;
}

function formatDisplay(
  year: number,
  month: number | null,
  day: number | null,
  isApproximate: boolean
): string {
  const monthNames = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const prefix = isApproximate ? 'c. ' : '';

  if (month === null) {
    return `${prefix}${year}`;
  }
  if (day === null) {
    return `${prefix}${monthNames[month]} ${year}`;
  }
  return `${prefix}${monthNames[month]} ${day}, ${year}`;
}

function toEdtf(
  year: number,
  month: number | null,
  day: number | null,
  isApproximate: boolean,
  endYear?: number,
  endMonth?: number | null,
  endDay?: number | null
): string {
  const startDate = formatDate(year, month, day);

  if (endYear) {
    const endDate = formatDate(endYear, endMonth ?? null, endDay ?? null);
    return `${startDate}/${endDate}`;
  }

  if (isApproximate) {
    return `${startDate}~`;
  }

  return startDate;
}

// =============================================================================
// MAIN EXTRACTION FUNCTION
// =============================================================================

/**
 * Extract dates from text using hybrid approach
 *
 * Pipeline:
 * 1. Pre-filter: Mask false positives
 * 2. Pattern extraction: High-confidence explicit patterns
 * 3. Chrono-node: Complex/informal expressions
 * 4. Post-filter: Keyword validation
 * 5. Deduplication: Merge overlaps
 *
 * @param text Full text to extract dates from
 * @param articleDate Optional article publication date for relative date anchoring
 * @returns Array of extraction results
 */
export function extractDates(
  text: string,
  articleDate?: string | null
): ExtractionResult[] {
  // Phase 1: Pre-filter (mask false positives)
  const { filtered, masks } = preFilterText(text);

  // Phase 2: Extract explicit patterns (on filtered text)
  const explicitCandidates = extractExplicitPatterns(filtered, masks);

  // Phase 3: Extract with chrono-node (on filtered text)
  const chronoCandidates = extractWithChrono(filtered, masks, articleDate);

  // Combine candidates
  const allCandidates = [...explicitCandidates, ...chronoCandidates];

  // Phase 4: Post-filter with keyword validation
  const validatedCandidates = postFilterCandidates(allCandidates, text);

  // Phase 5: Deduplicate
  const finalCandidates = deduplicateCandidates(validatedCandidates);

  // Convert to ExtractionResult format
  const results: ExtractionResult[] = [];

  for (const candidate of finalCandidates) {
    // Extract sentence context
    const sentence = extractSentence(text, candidate.index);
    const sentenceStart = text.indexOf(sentence);
    const localPosition = candidate.index - (sentenceStart >= 0 ? sentenceStart : 0);
    const positionType = getSentencePositionType(sentence.length, Math.max(0, localPosition));

    // Detect category
    const categoryResult = detectCategory(sentence, Math.max(0, localPosition));

    // Get stored confidence values
    const keywordDistance = (candidate as unknown as Record<string, unknown>)._keywordDistance as number | null;
    const overallConfidence = (candidate as unknown as Record<string, unknown>)._overallConfidence as number ||
      calculateConfidence(candidate, keywordDistance ? { keyword: '', distance: keywordDistance } : null, candidate.year);

    // Format date strings
    const dateStart = formatDate(candidate.year, candidate.month, candidate.day);
    const dateEnd = candidate.end_year
      ? formatDate(candidate.end_year, candidate.end_month ?? null, candidate.end_day ?? null)
      : null;
    const precision = getPrecision(
      candidate.month,
      candidate.day,
      candidate.is_approximate,
      !!candidate.end_year
    );

    results.push({
      raw_text: candidate.raw_text,
      parsed_date: dateStart,
      date_start: dateStart,
      date_end: dateEnd,
      date_precision: precision,
      date_display: formatDisplay(candidate.year, candidate.month, candidate.day, candidate.is_approximate),
      date_edtf: toEdtf(
        candidate.year, candidate.month, candidate.day, candidate.is_approximate,
        candidate.end_year, candidate.end_month, candidate.end_day
      ),
      date_sort: calculateDateSort(candidate.year, candidate.month, candidate.day),
      sentence,
      sentence_position: candidate.index,
      category: categoryResult.category,
      category_confidence: categoryResult.confidence,
      category_keywords: categoryResult.keywords,
      keyword_distance: keywordDistance,
      sentence_position_type: positionType,
      parser_confidence: candidate.pattern_confidence,
      century_bias_applied: !!(candidate.chrono_tags as Record<string, unknown> | undefined)?._centuryBiasApplied,
      original_year_ambiguous: false,
      was_relative_date: Boolean(candidate.raw_text.match(/\b(ago|last|next|yesterday|tomorrow|recently)\b/i)),
      relative_date_anchor: articleDate || null,
      overall_confidence: overallConfidence,
    });
  }

  return results;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if an extraction should be auto-approved
 */
export function shouldAutoApprove(
  category: DateCategory,
  overallConfidence: number
): boolean {
  return (
    AUTO_APPROVE_CATEGORIES.includes(category) &&
    overallConfidence >= AUTO_APPROVE_MIN_CONFIDENCE
  );
}

/**
 * Get auto-approve reason text
 */
export function getAutoApproveReason(
  category: DateCategory,
  confidence: number
): string {
  return `Category "${category}" with confidence ${(confidence * 100).toFixed(0)}% meets auto-approval threshold`;
}

/**
 * Test a regex pattern against sample text
 */
export function testPattern(
  pattern: string,
  testText: string
): { success: boolean; matches: string[]; error?: string } {
  try {
    const regex = new RegExp(pattern, 'gi');
    const matches: string[] = [];
    let match;

    const startTime = Date.now();
    const TIMEOUT_MS = 1000;

    while ((match = regex.exec(testText)) !== null) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        return {
          success: false,
          matches: [],
          error: 'Pattern execution timed out (possible ReDoS)',
        };
      }
      matches.push(match[0]);
    }

    return { success: true, matches };
  } catch (error) {
    return {
      success: false,
      matches: [],
      error: error instanceof Error ? error.message : 'Invalid regex pattern',
    };
  }
}

/**
 * Validate a regex pattern
 */
export function validatePattern(pattern: string): { valid: boolean; error?: string } {
  if (pattern.length > 500) {
    return { valid: false, error: 'Pattern exceeds maximum length of 500 characters' };
  }

  try {
    new RegExp(pattern);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid regex pattern',
    };
  }
}

// =============================================================================
// EXPORTS FOR TESTING
// =============================================================================

export const __test__ = {
  preFilterText,
  extractExplicitPatterns,
  extractWithChrono,
  postFilterCandidates,
  deduplicateCandidates,
  calculateConfidence,
  findClosestKeyword,
  FALSE_POSITIVE_PATTERNS,
};
