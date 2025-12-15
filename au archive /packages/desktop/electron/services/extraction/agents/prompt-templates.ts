/**
 * Agent Prompt Templates
 *
 * Carefully crafted prompts for the specialized extraction agents:
 * 1. Date Extraction Agent - Extracts dates with category and confidence
 * 2. Summary/Title Agent - Generates titles and summaries
 * 3. Combined Extraction - Single-pass extraction for efficiency
 *
 * Key design decisions:
 * - All agents inherit from ARCHIVAL_BASE_SYSTEM_PROMPT (archival-base-prompt.ts)
 * - Verb-centric date extraction (DATE must have VERB to be timeline-relevant)
 * - Explicit JSON schema in prompts
 * - Few-shot examples for consistency
 * - Historical context awareness for urbex documents
 *
 * @version 2.0 - LLM Tools Overhaul (December 2025)
 */

import {
  ARCHIVAL_BASE_SYSTEM_PROMPT,
  TIMELINE_VERB_CATEGORIES,
  formatPromptWithPreprocessing,
} from './archival-base-prompt';

import type {
  ExtractedDate,
  ExtractedPerson,
  ExtractedOrganization,
  ExtractedLocation,
  ExtractedSummary,
  ExtractionResult,
  DateCategory,
  DatePrecision,
  PersonRole,
  OrganizationType,
  LocationRefType,
  SuggestedLocationType,
  SuggestedEra,
} from '../extraction-types';

// =============================================================================
// DATE EXTRACTION AGENT PROMPT
// =============================================================================

/**
 * System prompt for the date extraction agent
 * Builds on ARCHIVAL_BASE_SYSTEM_PROMPT with date-specific instructions
 */
export const DATE_EXTRACTION_SYSTEM_PROMPT = `${ARCHIVAL_BASE_SYSTEM_PROMPT}

## DATE EXTRACTION TASK

You are extracting dates from historical documents about abandoned places. Your task is to find ALL dates mentioned and categorize them correctly based on their VERB CONTEXT.

### VERB-DATE RULE (CRITICAL)
A date is ONLY timeline-relevant if it has a timeline verb:
- "built in 1923" → category: build_date, isTimelineRelevant: true
- "closed in 2008" → category: closure, isTimelineRelevant: true
- "in 1923" (no verb) → category: unknown, isTimelineRelevant: false
- "500 workers in 1960" → NOT A DATE (employee count)

### Timeline Verb Categories
${Object.entries(TIMELINE_VERB_CATEGORIES)
  .map(([cat, config]) => `- ${cat}: ${config.verbs.slice(0, 5).join(', ')}... (weight: ${config.weight})`)
  .join('\n')}

You return ONLY valid JSON matching the exact schema provided. No explanations or commentary.`;

/**
 * Main prompt template for date extraction
 */
export const DATE_EXTRACTION_PROMPT = `Extract ALL dates from this document about an abandoned/historical location.

## DOCUMENT:
---
{text}
---

## REQUIRED OUTPUT FORMAT (JSON):
{
  "dates": [
    {
      "rawText": "exact quote from document containing the date",
      "parsedDate": "YYYY-MM-DD or YYYY-MM or YYYY",
      "parsedDateEnd": "YYYY-MM-DD for ranges, otherwise null",
      "precision": "exact|month|year|decade|approximate",
      "category": "build_date|opening|closure|demolition|visit|publication|renovation|event|unknown",
      "confidence": 0.0 to 1.0,
      "context": "the full sentence containing this date",
      "isApproximate": true or false
    }
  ]
}

## EXTRACTION RULES:

### What IS a date:
- Full dates: "March 15, 1968", "03/15/1968", "1968-03-15"
- Month + Year: "March 1968", "Sept. 1923"
- Year with context: "built in 1923", "closed 2008"
- Approximate: "circa 1920", "late 1800s", "the 1920s"
- Ranges: "from 1920 to 1940", "1920-1940"

### What is NOT a date (DO NOT EXTRACT):
- Employee counts: "110 to 130 employees", "500 workers"
- Measurements: "50 feet", "1,500 square feet"
- Currency: "$1,923", "1,500 dollars"
- Times: "9:00 AM", "4:30 PM"
- Phone numbers: "555-1234"
- Route numbers: "Route 66", "Highway 1"
- Room/building numbers: "Room 123", "Building 5"
- Percentages: "50%"
- Coordinates: "42.1234, -73.5678"

### Category Keywords:
- build_date: built, constructed, erected, established, founded, completed, dating from
- opening: opened, inaugurated, grand opening, began operations
- closure: closed, shut down, abandoned, ceased operations, shuttered
- demolition: demolished, torn down, razed, destroyed, bulldozed
- visit: visited, explored, photographed, toured, expedition
- publication: published, posted, written, updated, article dated
- renovation: renovated, restored, refurbished, rebuilt
- event: fire, flood, accident, incident, disaster

### Confidence Scoring:
- 0.95-1.0: Explicit full date with clear context ("opened March 15, 1968")
- 0.80-0.94: Clear date with good context ("built in 1923")
- 0.60-0.79: Date with some context ("in 1923")
- 0.40-0.59: Ambiguous context or approximate ("around 1920")
- Below 0.40: Do not include - too uncertain

### Precision Levels:
- exact: Full date (YYYY-MM-DD)
- month: Month and year (YYYY-MM)
- year: Year only (YYYY)
- decade: Decade reference ("the 1920s")
- approximate: Circa, about, around

## EXAMPLES:

INPUT: "The Sterling Steel Factory was built in 1923. It employed 500 workers and closed in 2008."
OUTPUT:
{
  "dates": [
    {
      "rawText": "built in 1923",
      "parsedDate": "1923",
      "parsedDateEnd": null,
      "precision": "year",
      "category": "build_date",
      "confidence": 0.92,
      "context": "The Sterling Steel Factory was built in 1923.",
      "isApproximate": false
    },
    {
      "rawText": "closed in 2008",
      "parsedDate": "2008",
      "parsedDateEnd": null,
      "precision": "year",
      "category": "closure",
      "confidence": 0.90,
      "context": "It employed 500 workers and closed in 2008.",
      "isApproximate": false
    }
  ]
}
NOTE: "500 workers" is NOT a date - it's an employee count.

INPUT: "This Victorian mansion dates from the late 1800s, circa 1885. It was demolished in March 2010."
OUTPUT:
{
  "dates": [
    {
      "rawText": "late 1800s, circa 1885",
      "parsedDate": "1885",
      "parsedDateEnd": null,
      "precision": "approximate",
      "category": "build_date",
      "confidence": 0.75,
      "context": "This Victorian mansion dates from the late 1800s, circa 1885.",
      "isApproximate": true
    },
    {
      "rawText": "demolished in March 2010",
      "parsedDate": "2010-03",
      "parsedDateEnd": null,
      "precision": "month",
      "category": "demolition",
      "confidence": 0.95,
      "context": "It was demolished in March 2010.",
      "isApproximate": false
    }
  ]
}

Return ONLY the JSON object. No markdown, no explanation.`;

// =============================================================================
// SUMMARY/TITLE AGENT PROMPT
// =============================================================================

/**
 * System prompt for the summary/title agent
 * Builds on ARCHIVAL_BASE_SYSTEM_PROMPT with summary-specific instructions
 */
export const SUMMARY_TITLE_SYSTEM_PROMPT = `${ARCHIVAL_BASE_SYSTEM_PROMPT}

## SUMMARY/TITLE GENERATION TASK

You are generating titles and summaries for documents about abandoned/historical locations.

### Title Requirements (TLDR Title)
- 6-10 words, maximum 60 characters
- Specific to THIS location (not generic)
- Format: WHO did WHAT WHEN (if applicable)
- Include location type when known: "Factory", "Hospital", "School"
- Focus on the most notable fact

Good: "Sterling Steel Factory: 85 Years of Industrial History"
Bad: "Abandoned Place Article" (too generic)

### Summary Requirements (TLDR)
- 1-3 sentences maximum
- WHO did WHAT WHEN format
- Lead with the most important fact
- Include dates if available
- Written for researchers, not tourists

### Key Facts
- 3-5 specific, verifiable facts
- Each must be traceable to source text
- Prioritize: dates, names, numbers
- No speculation or opinions

### Suggested Metadata
- suggestedLocationType: Infer from content (factory, hospital, school, etc.)
- suggestedEra: Infer from dates (industrial, victorian, art_deco, etc.)

You return ONLY valid JSON matching the exact schema provided.`;

/**
 * Main prompt template for summary/title generation
 */
export const SUMMARY_TITLE_PROMPT = `Generate a title and summary for this document about an abandoned/historical location.

## LOCATION NAME (if known): {locationName}

## DOCUMENT:
---
{text}
---

## REQUIRED OUTPUT FORMAT (JSON):
{
  "title": "6-10 word TLDR title under 60 characters",
  "summary": "1-3 sentence TLDR summary (WHO did WHAT WHEN)",
  "keyFacts": [
    "Specific verifiable fact 1",
    "Specific verifiable fact 2",
    "Specific verifiable fact 3"
  ],
  "suggestedLocationType": "factory|hospital|school|asylum|prison|church|hotel|theater|military|residential|commercial|industrial|unknown",
  "suggestedEra": "colonial|victorian|industrial|art_deco|mid_century|modern|unknown",
  "confidence": 0.0 to 1.0
}

## TITLE GUIDELINES (TLDR Title):
- 6-10 words, maximum 60 characters
- Format: [Location Name]: [Key Historical Fact] OR [WHO] [VERB] [WHAT] [WHEN]
- Include location type: "Factory", "Hospital", "School", etc.
- Focus on the single most notable fact
- Avoid generic phrases

Good titles:
- "Sterling Steel Factory: 85-Year Industrial History Ends 2008"
- "Riverside State Hospital Closure After 75 Years"
- "John Sterling's Textile Mill Falls to Competition"

Bad titles:
- "Abandoned Place Article" (no specifics)
- "Old Building History" (too generic)
- "Exploration Report" (not about the location)

## SUMMARY GUIDELINES (TLDR):
- 1-3 sentences MAXIMUM (50-100 words ideal)
- WHO did WHAT WHEN format
- Lead with the most important fact
- Include build date and closure date if available
- Written for researchers, not tourists
- Past tense for historical facts

## KEY FACTS GUIDELINES:
- 3-5 specific, verifiable facts ONLY
- Each fact MUST be traceable to the source text
- Prioritize: dates, names, numbers, measurements
- NO opinions, speculation, or inferences

## LOCATION TYPE (infer from content):
- factory, mill, plant → "industrial" or specific type
- hospital, asylum, sanatorium → "hospital" or "asylum"
- school, college, university → "school"
- prison, jail, penitentiary → "prison"
- hotel, resort, inn → "hotel"
- church, cathedral, chapel → "church"
- theater, cinema, opera → "theater"
- military base, fort, armory → "military"
- house, mansion, estate → "residential"
- store, mall, office → "commercial"

## ERA (infer from dates):
- Before 1800 → "colonial"
- 1800-1900 → "victorian"
- 1900-1940 → "industrial"
- 1920-1940 → "art_deco"
- 1945-1970 → "mid_century"
- After 1970 → "modern"
- Cannot determine → "unknown"

## CONFIDENCE SCORING:
- 0.90-1.0: Rich document with clear facts, dates, and names
- 0.70-0.89: Good document with key information
- 0.50-0.69: Limited information, basic summary possible
- Below 0.50: Very little usable content

## EXAMPLE:

INPUT (locationName: "Sterling Steel Factory"):
"The Sterling Steel Factory was built in 1923 by John Sterling. At its peak, it employed over 500 workers and produced steel for the automotive industry. The factory closed in 2008 due to foreign competition and has sat abandoned since."

OUTPUT:
{
  "title": "Sterling Steel Factory: 85 Years of Production Ends 2008",
  "summary": "John Sterling built the Sterling Steel Factory in 1923 to serve the automotive industry. The facility employed over 500 workers at peak before closing in 2008 due to foreign competition.",
  "keyFacts": [
    "Built in 1923 by John Sterling",
    "Employed over 500 workers at peak",
    "Produced steel for automotive industry",
    "Closed in 2008 due to foreign competition"
  ],
  "suggestedLocationType": "factory",
  "suggestedEra": "industrial",
  "confidence": 0.92
}

Return ONLY the JSON object. No markdown, no explanation.`;

// =============================================================================
// COMBINED EXTRACTION PROMPT (for single-pass extraction)
// =============================================================================

/**
 * Combined prompt for extracting both dates and summary in one pass
 * Use when you want to minimize API calls
 */
export const COMBINED_EXTRACTION_PROMPT = `Extract all dates and generate a summary for this document about an abandoned/historical location.

## LOCATION NAME (if known): {locationName}

## DOCUMENT:
---
{text}
---

## REQUIRED OUTPUT FORMAT (JSON):
{
  "dates": [
    {
      "rawText": "exact quote containing the date",
      "parsedDate": "YYYY-MM-DD or YYYY-MM or YYYY",
      "parsedDateEnd": "for ranges only, otherwise null",
      "precision": "exact|month|year|decade|approximate",
      "category": "build_date|opening|closure|demolition|visit|publication|renovation|event|unknown",
      "confidence": 0.0 to 1.0,
      "context": "the sentence containing this date",
      "isApproximate": true or false
    }
  ],
  "people": [
    {
      "name": "Full Name",
      "role": "owner|architect|developer|employee|founder|visitor|photographer|historian|unknown",
      "mentions": ["all name variations in text"],
      "confidence": 0.0 to 1.0
    }
  ],
  "organizations": [
    {
      "name": "Organization Name",
      "type": "company|government|school|hospital|church|nonprofit|military|unknown",
      "mentions": ["all name variations in text"],
      "confidence": 0.0 to 1.0
    }
  ],
  "locations": [
    {
      "name": "Location Name",
      "type": "city|state|country|address|landmark|region|neighborhood|unknown",
      "confidence": 0.0 to 1.0
    }
  ],
  "summaryData": {
    "title": "Short title under 60 chars",
    "summary": "2-3 sentence summary",
    "keyFacts": ["Fact 1", "Fact 2", "Fact 3"],
    "confidence": 0.0 to 1.0
  }
}

## IMPORTANT RULES:
1. Extract ONLY information explicitly stated in the document
2. Numbers like "500 workers", "50 feet", "$1,923" are NOT dates
3. Confidence scores must reflect how explicit the information is
4. If nothing found for a category, use empty array []
5. Focus on historical significance and verifiable facts

Return ONLY the JSON object. No markdown, no explanation.`;

// =============================================================================
// RESPONSE PARSING
// =============================================================================

/**
 * Parse the LLM's JSON response into our structured types
 * Handles common LLM mistakes: markdown blocks, trailing text, malformed JSON
 */
export function parseStructuredResponse(response: string): {
  dates: ExtractedDate[];
  people: ExtractedPerson[];
  organizations: ExtractedOrganization[];
  locations: ExtractedLocation[];
  summaryData?: ExtractedSummary;
  warnings: string[];
} {
  const warnings: string[] = [];
  let jsonStr = response.trim();

  // Step 1: Remove markdown code blocks
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Step 2: Find JSON object boundaries
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
  let parsed: Record<string, unknown>;
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

  // Remove JavaScript-style comments
  fixed = fixed.replace(/\/\/.*$/gm, '');
  fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');

  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

  // Fix unquoted keys (common LLM mistake)
  fixed = fixed.replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

  // Fix single quotes to double quotes (be careful with apostrophes in text)
  // Only replace quotes that are clearly string delimiters
  fixed = fixed.replace(/:\s*'([^']*?)'/g, ': "$1"');

  return fixed;
}

/**
 * Attempt to extract partial data from malformed JSON
 */
function attemptPartialParse(json: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {
    dates: [],
    people: [],
    organizations: [],
    locations: [],
  };

  const patterns: Record<string, RegExp> = {
    dates: /"dates"\s*:\s*\[([\s\S]*?)\]/,
    people: /"people"\s*:\s*\[([\s\S]*?)\]/,
    organizations: /"organizations"\s*:\s*\[([\s\S]*?)\]/,
    locations: /"locations"\s*:\s*\[([\s\S]*?)\]/,
    summaryData: /"summaryData"\s*:\s*(\{[\s\S]*?\})/,
    title: /"title"\s*:\s*"([^"]*)"/,
    summary: /"summary"\s*:\s*"([^"]*)"/,
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = json.match(pattern);
    if (match) {
      try {
        if (key === 'title' || key === 'summary') {
          result[key] = match[1];
        } else if (key === 'summaryData') {
          result[key] = JSON.parse(match[1]);
        } else {
          const arrayContent = match[1].trim();
          if (arrayContent) {
            result[key] = JSON.parse(`[${arrayContent}]`);
          }
        }
      } catch {
        // Keep empty/default value
      }
    }
  }

  // Check if we got anything useful
  const hasData =
    (result.dates as unknown[]).length > 0 ||
    (result.people as unknown[]).length > 0 ||
    (result.organizations as unknown[]).length > 0 ||
    (result.locations as unknown[]).length > 0 ||
    result.summaryData ||
    result.title ||
    result.summary;

  return hasData ? result : null;
}

/**
 * Normalize and validate the parsed result
 */
function normalizeResult(
  parsed: Record<string, unknown>,
  warnings: string[]
): {
  dates: ExtractedDate[];
  people: ExtractedPerson[];
  organizations: ExtractedOrganization[];
  locations: ExtractedLocation[];
  summaryData?: ExtractedSummary;
  warnings: string[];
} {
  // Validate and normalize dates
  const dates: ExtractedDate[] = ((parsed.dates as unknown[]) || [])
    .filter((d: unknown): d is Record<string, unknown> => d !== null && typeof d === 'object' && 'rawText' in d)
    .map((d) => ({
      rawText: String(d.rawText || ''),
      parsedDate: d.parsedDate ? String(d.parsedDate) : null,
      parsedDateEnd: d.parsedDateEnd ? String(d.parsedDateEnd) : undefined,
      precision: validateEnum<DatePrecision>(
        d.precision,
        ['exact', 'month', 'year', 'decade', 'approximate'],
        'year'
      ),
      category: validateEnum<DateCategory>(
        d.category,
        ['build_date', 'opening', 'closure', 'demolition', 'visit', 'publication', 'renovation', 'event', 'unknown'],
        'unknown'
      ),
      confidence: normalizeConfidence(d.confidence),
      context: String(d.context || d.rawText || ''),
      isApproximate: Boolean(d.isApproximate),
    }));

  // Validate and normalize people
  const people: ExtractedPerson[] = ((parsed.people as unknown[]) || [])
    .filter((p: unknown): p is Record<string, unknown> => p !== null && typeof p === 'object' && 'name' in p)
    .map((p) => ({
      name: String(p.name || ''),
      role: validateEnum<PersonRole>(
        p.role,
        ['owner', 'architect', 'developer', 'employee', 'founder', 'visitor', 'photographer', 'historian', 'unknown'],
        'unknown'
      ),
      mentions: Array.isArray(p.mentions) ? (p.mentions as unknown[]).map(String) : [String(p.name || '')],
      confidence: normalizeConfidence(p.confidence),
    }));

  // Validate and normalize organizations
  const organizations: ExtractedOrganization[] = ((parsed.organizations as unknown[]) || [])
    .filter((o: unknown): o is Record<string, unknown> => o !== null && typeof o === 'object' && 'name' in o)
    .map((o) => ({
      name: String(o.name || ''),
      type: validateEnum<OrganizationType>(
        o.type,
        ['company', 'government', 'school', 'hospital', 'church', 'nonprofit', 'military', 'unknown'],
        'unknown'
      ),
      mentions: Array.isArray(o.mentions) ? (o.mentions as unknown[]).map(String) : [String(o.name || '')],
      confidence: normalizeConfidence(o.confidence),
    }));

  // Validate and normalize locations
  const locations: ExtractedLocation[] = ((parsed.locations as unknown[]) || [])
    .filter((l: unknown): l is Record<string, unknown> => l !== null && typeof l === 'object' && 'name' in l)
    .map((l) => ({
      name: String(l.name || ''),
      type: validateEnum<LocationRefType>(
        l.type,
        ['city', 'state', 'country', 'address', 'landmark', 'region', 'neighborhood', 'unknown'],
        'unknown'
      ),
      confidence: normalizeConfidence(l.confidence),
    }));

  // Validate and normalize summary
  let summaryData: ExtractedSummary | undefined;
  const summarySource = parsed.summaryData as Record<string, unknown> | undefined;

  if (summarySource || parsed.title || parsed.summary) {
    // Get location type and era from either summaryData or root level
    const locationType = summarySource?.suggestedLocationType || parsed.suggestedLocationType;
    const era = summarySource?.suggestedEra || parsed.suggestedEra;

    summaryData = {
      title: String(summarySource?.title || parsed.title || ''),
      summary: String(summarySource?.summary || parsed.summary || ''),
      keyFacts: Array.isArray(summarySource?.keyFacts || parsed.keyFacts)
        ? ((summarySource?.keyFacts || parsed.keyFacts) as unknown[]).map(String)
        : [],
      confidence: normalizeConfidence((summarySource?.confidence || parsed.confidence) as unknown),
      suggestedLocationType: locationType
        ? validateEnum<SuggestedLocationType>(
            locationType,
            ['factory', 'hospital', 'school', 'asylum', 'prison', 'church', 'hotel', 'theater', 'military', 'residential', 'commercial', 'industrial', 'unknown'],
            'unknown'
          )
        : undefined,
      suggestedEra: era
        ? validateEnum<SuggestedEra>(
            era,
            ['colonial', 'victorian', 'industrial', 'art_deco', 'mid_century', 'modern', 'unknown'],
            'unknown'
          )
        : undefined,
    };

    // Filter out empty summary
    if (!summaryData.title && !summaryData.summary) {
      summaryData = undefined;
    }
  }

  return { dates, people, organizations, locations, summaryData, warnings };
}

/**
 * Validate a value is one of the allowed enum values
 */
function validateEnum<T extends string>(value: unknown, allowed: T[], defaultValue: T): T {
  const str = String(value || '').toLowerCase();
  return allowed.includes(str as T) ? (str as T) : defaultValue;
}

/**
 * Normalize confidence to 0-1 range
 */
function normalizeConfidence(value: unknown): number {
  const num = Number(value);
  if (isNaN(num)) return 0.5;
  if (num > 1) return num / 100; // Handle percentages
  return Math.max(0, Math.min(1, num));
}

/**
 * Return empty result with warnings
 */
function emptyResult(warnings: string[]): {
  dates: ExtractedDate[];
  people: ExtractedPerson[];
  organizations: ExtractedOrganization[];
  locations: ExtractedLocation[];
  summaryData?: ExtractedSummary;
  warnings: string[];
} {
  return {
    dates: [],
    people: [],
    organizations: [],
    locations: [],
    warnings,
  };
}

// =============================================================================
// PROMPT BUILDERS
// =============================================================================

/**
 * Preprocessing context from spaCy server
 */
export interface PreprocessingContext {
  /** Timeline-relevant sentences (contain dates + verbs) */
  timelineSentences?: string;
  /** Profile candidates (PERSON, ORG entities with context) */
  profileCandidates?: string;
  /** GPE/LOC entities for address extraction */
  gpeEntities?: string;
}

/**
 * Build the date extraction prompt with text and optional preprocessing
 */
export function buildDateExtractionPrompt(
  text: string,
  preprocessing?: PreprocessingContext
): string {
  let prompt = DATE_EXTRACTION_PROMPT.replace('{text}', text);

  // Add preprocessing context if available
  if (preprocessing) {
    prompt = formatPromptWithPreprocessing(prompt, {
      timelineSentences: preprocessing.timelineSentences,
      profileCandidates: preprocessing.profileCandidates,
    });
  }

  return prompt;
}

/**
 * Build the summary/title prompt with text, location name, and optional preprocessing
 */
export function buildSummaryTitlePrompt(
  text: string,
  locationName?: string,
  preprocessing?: PreprocessingContext
): string {
  let prompt = SUMMARY_TITLE_PROMPT
    .replace('{text}', text)
    .replace('{locationName}', locationName || 'Unknown');

  // Add preprocessing context if available
  if (preprocessing) {
    prompt = formatPromptWithPreprocessing(prompt, {
      profileCandidates: preprocessing.profileCandidates,
    });
  }

  return prompt;
}

/**
 * Build the combined extraction prompt with all preprocessing
 */
export function buildCombinedPrompt(
  text: string,
  locationName?: string,
  preprocessing?: PreprocessingContext
): string {
  let prompt = COMBINED_EXTRACTION_PROMPT
    .replace('{text}', text)
    .replace('{locationName}', locationName || 'Unknown');

  // Add all preprocessing context if available
  if (preprocessing) {
    prompt = formatPromptWithPreprocessing(prompt, {
      timelineSentences: preprocessing.timelineSentences,
      profileCandidates: preprocessing.profileCandidates,
      gpeEntities: preprocessing.gpeEntities,
    });
  }

  return prompt;
}

// =============================================================================
// VALIDATION & POST-PROCESSING
// =============================================================================

/**
 * Validate extractions against source text to catch hallucinations
 */
export function validateExtractions(
  input: { text: string },
  result: {
    dates: ExtractedDate[];
    people: ExtractedPerson[];
    organizations: ExtractedOrganization[];
    locations: ExtractedLocation[];
    summaryData?: ExtractedSummary;
    warnings: string[];
  }
): typeof result {
  const text = input.text.toLowerCase();
  const warnings = [...(result.warnings || [])];

  // Validate dates appear in source
  const validDates = result.dates.filter((date) => {
    const rawLower = date.rawText.toLowerCase();
    // Check if raw text or parsed year appears in source
    const yearStr = date.parsedDate?.split('-')[0];
    if (!text.includes(rawLower) && yearStr && !text.includes(yearStr)) {
      warnings.push(`Filtered hallucinated date: ${date.rawText}`);
      return false;
    }
    return true;
  });

  // Validate people appear in source
  const validPeople = result.people.filter((person) => {
    const nameParts = person.name.toLowerCase().split(' ');
    // Check if any significant part of name appears
    const found = nameParts.some((part) => part.length > 2 && text.includes(part));
    if (!found) {
      warnings.push(`Filtered hallucinated person: ${person.name}`);
      return false;
    }
    return true;
  });

  // Validate organizations appear in source
  const validOrgs = result.organizations.filter((org) => {
    const orgWords = org.name.toLowerCase().split(' ').filter((w) => w.length > 2);
    const found = orgWords.some((word) => text.includes(word));
    if (!found) {
      warnings.push(`Filtered hallucinated organization: ${org.name}`);
      return false;
    }
    return true;
  });

  return {
    dates: validDates,
    people: validPeople,
    organizations: validOrgs,
    locations: result.locations, // Locations are harder to validate
    summaryData: result.summaryData,
    warnings,
  };
}

/**
 * Recalibrate confidence scores based on extraction characteristics
 */
export function recalibrateConfidence(date: ExtractedDate, text: string): number {
  let confidence = date.confidence;

  // Boost: Explicit date format (MM/DD/YYYY, etc.)
  if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(date.rawText) || /\d{4}-\d{2}-\d{2}/.test(date.rawText)) {
    confidence = Math.min(1.0, confidence + 0.1);
  }

  // Boost: Strong keyword present in context
  const strongKeywords = ['built', 'constructed', 'established', 'founded', 'opened', 'closed', 'demolished'];
  const contextLower = (date.context || '').toLowerCase();
  if (strongKeywords.some((k) => contextLower.includes(k))) {
    confidence = Math.min(1.0, confidence + 0.1);
  }

  // Penalty: Very short context
  if (date.context && date.context.length < 20) {
    confidence = Math.max(0.1, confidence - 0.1);
  }

  // Penalty: Approximate date
  if (date.isApproximate) {
    confidence = Math.max(0.1, confidence - 0.05);
  }

  // Penalty: Unknown category
  if (date.category === 'unknown') {
    confidence = Math.max(0.1, confidence - 0.1);
  }

  return Math.round(confidence * 100) / 100;
}
