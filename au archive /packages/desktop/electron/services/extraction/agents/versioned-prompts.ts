/**
 * Versioned Prompt Templates
 *
 * All prompts are versioned for A/B testing and rollback capability.
 * Store prompt_version with each extraction result for audit.
 *
 * DESIGN PRINCIPLES:
 * 1. Every date MUST have verb context - no orphan dates
 * 2. Preprocessing data from spaCy is passed into prompts
 * 3. Profile extraction uses normalized names for deduplication
 * 4. All prompts produce JSON-only output
 *
 * @version 2.0
 */

import type { VerbCategory } from '../preprocessing-types';

// =============================================================================
// PROMPT VERSION INTERFACE
// =============================================================================

/**
 * A versioned prompt configuration
 */
export interface PromptVersion {
  /** Semantic version string */
  version: string;
  /** System prompt (sets model behavior) */
  systemPrompt: string;
  /** User prompt template (includes placeholders) */
  userPrompt: string;
  /** Human-readable description */
  description: string;
  /** When this version was added */
  dateAdded: string;
  /** Whether this is deprecated */
  deprecated?: boolean;
  /** Optional notes about changes */
  changelog?: string;
}

/**
 * Prompt type categories
 */
export type PromptType =
  | 'date_extraction'
  | 'profile_extraction'
  | 'tldr'
  | 'combined'
  | 'conflict_detection';

// =============================================================================
// DATE EXTRACTION PROMPTS
// =============================================================================

/**
 * Date extraction prompts - focus on verb-context requirement
 */
export const DATE_EXTRACTION_PROMPTS: Record<string, PromptVersion> = {
  'v1.0': {
    version: 'v1.0',
    description: 'Original date extraction prompt (legacy)',
    dateAdded: '2025-11-01',
    deprecated: true,
    changelog: 'Superseded by v2.0 with verb-context requirement',
    systemPrompt: `You are an expert historian specializing in extracting dates from historical documents about abandoned places.

Your task is to find ALL dates mentioned in documents and categorize them correctly. You understand that:
- "built in 1923" is a BUILD_DATE
- "closed in 2008" is a CLOSURE date
- Numbers like "110 to 130 employees" are NOT dates

Return ONLY valid JSON matching the schema provided.`,
    userPrompt: `Extract ALL dates from this document about an abandoned/historical location.

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
  ]
}

Return ONLY the JSON object. No markdown, no explanation.`,
  },

  'v2.0': {
    version: 'v2.0',
    description: 'Verb-context required date extraction (current)',
    dateAdded: '2025-12-14',
    changelog: 'Added verb context requirement, spaCy preprocessing integration',
    systemPrompt: `You are an archive historian extracting FACTUAL dates from documents about abandoned places.

CRITICAL EXTRACTION RULES:
1. ONLY extract dates that have EXPLICIT VERB CONTEXT in the same sentence
2. A date without a verb is NOT a timeline event - skip it
3. Numbers without date context are NEVER dates (employee counts, measurements, currency)

VERB-DATE LINKAGE REQUIREMENT:
- "built in 1923" → VALID (verb: built, category: build_date)
- "1923" alone → INVALID (no verb context)
- "around 1920" → VALID only if verb present in same sentence
- "The factory dates from 1923" → VALID (verb: dates from, category: build_date)

VERB CATEGORIES (use these exactly):
- build_date: built, constructed, erected, established, founded, completed, dating from
- opening: opened, inaugurated, began operations, started operations, dedicated
- closure: closed, shut down, shuttered, abandoned, ceased operations, vacated
- demolition: demolished, torn down, razed, destroyed, bulldozed, leveled
- renovation: renovated, restored, refurbished, rebuilt, expanded, converted
- event: burned, flooded, collapsed, exploded, damaged, fire, accident
- visit: visited, explored, photographed, toured, documented
- publication: published, posted, written, updated, reported

AUDIT RULE: If you cannot identify the specific verb that gives the date meaning, DO NOT extract it.

Return ONLY valid JSON. No markdown, no commentary.`,
    userPrompt: `Extract dates from this preprocessed document.

## PREPROCESSING ANALYSIS (from spaCy):
The following sentences have been identified as timeline-relevant.
Each includes detected verbs and their categories.

### Timeline-Relevant Sentences:
{preprocessed_sentences}

### Document Statistics:
- Total sentences: {total_sentences}
- Timeline-relevant: {timeline_relevant}
- Profile-relevant: {profile_relevant}

## ORIGINAL DOCUMENT (for verification):
---
{text}
---

## REQUIRED OUTPUT FORMAT (JSON):
{
  "dates": [
    {
      "rawText": "exact quote from document",
      "parsedDate": "YYYY-MM-DD or YYYY-MM or YYYY",
      "parsedDateEnd": "for date ranges only, otherwise null",
      "precision": "exact|month|year|decade|approximate",
      "category": "build_date|opening|closure|demolition|visit|publication|renovation|event|unknown",
      "verbContext": "the specific verb giving this date meaning",
      "confidence": 0.0 to 1.0,
      "context": "the full sentence containing this date",
      "isApproximate": true or false
    }
  ],
  "extractionNotes": "brief note about extraction decisions"
}

REMEMBER:
- Every date MUST have a verbContext field
- Only extract from timeline-relevant sentences when possible
- Cross-reference with original document for accuracy
- No verb = no extraction

Return ONLY the JSON object.`,
  },

  'v2.1': {
    version: 'v2.1',
    description: 'Enhanced preprocessing with Ollama optimization',
    dateAdded: '2025-12-14',
    changelog: 'Shorter prompts for local LLM efficiency, same rules',
    systemPrompt: `You are extracting dates from historical documents. RULES:
1. Dates MUST have verb context (built, opened, closed, demolished, etc.)
2. No verb = skip the date
3. Return JSON only

Categories: build_date, opening, closure, demolition, renovation, event, visit, publication, unknown`,
    userPrompt: `Extract dates with verb context.

TIMELINE SENTENCES:
{preprocessed_sentences}

FULL TEXT:
{text}

OUTPUT FORMAT:
{
  "dates": [{
    "rawText": "quote",
    "parsedDate": "YYYY-MM-DD or YYYY",
    "parsedDateEnd": null,
    "precision": "exact|month|year|decade|approximate",
    "category": "build_date|opening|closure|demolition|...",
    "verbContext": "the verb",
    "confidence": 0.0-1.0,
    "context": "full sentence",
    "isApproximate": boolean
  }]
}

JSON only, no explanation.`,
  },
};

// =============================================================================
// PROFILE EXTRACTION PROMPTS
// =============================================================================

/**
 * Profile extraction prompts for people and organizations
 */
export const PROFILE_EXTRACTION_PROMPTS: Record<string, PromptVersion> = {
  'v1.0': {
    version: 'v1.0',
    description: 'Initial profile extraction with normalized names',
    dateAdded: '2025-12-14',
    changelog: 'First version with full profile schema',
    systemPrompt: `You are an archive researcher building mini-profiles of people and organizations mentioned in historical documents about abandoned places.

FOR PEOPLE - Extract:
- Full name (as displayed in document)
- Normalized name (lowercase, first last format)
- Role: owner, architect, developer, employee, founder, visitor, photographer, historian, unknown
- Date range of involvement (if explicitly stated)
- Key facts (max 3, must be explicitly stated in source)
- Aliases (other name variations used in document)

FOR ORGANIZATIONS - Extract:
- Full name (as displayed in document)
- Normalized name (lowercase, no Inc/LLC/etc)
- Type: company, government, school, hospital, church, nonprofit, military, unknown
- Industry/sector (if identifiable from context)
- Relationship to location: owner, operator, tenant, builder, demolisher, unknown
- Date range of operation (if explicitly stated)
- Key facts (max 3, must be explicitly stated in source)
- Aliases (other names used in document)

CRITICAL RULES:
1. Only include facts EXPLICITLY stated in the document
2. Never infer, assume, or add information from general knowledge
3. If a fact is not stated, leave the field empty/null
4. Normalize names for deduplication (lowercase, consistent format)
5. Include all name variations as aliases

Return ONLY valid JSON. No markdown, no commentary.`,
    userPrompt: `Extract profiles from this document about an abandoned/historical location.

## PROFILE CANDIDATES (detected by spaCy):
### People Mentioned:
{people_candidates}

### Organizations Mentioned:
{organization_candidates}

## FULL DOCUMENT:
---
{text}
---

## REQUIRED OUTPUT FORMAT (JSON):
{
  "people": [
    {
      "fullName": "John Sterling",
      "normalizedName": "john sterling",
      "role": "founder|owner|architect|developer|employee|visitor|photographer|historian|unknown",
      "dateStart": "YYYY or null",
      "dateEnd": "YYYY or null",
      "keyFacts": ["Fact explicitly stated 1", "Fact explicitly stated 2"],
      "aliases": ["J. Sterling", "Mr. Sterling"],
      "context": "sentence where most significant mention appears",
      "confidence": 0.0 to 1.0
    }
  ],
  "organizations": [
    {
      "fullName": "Sterling Steel Factory",
      "normalizedName": "sterling steel factory",
      "orgType": "company|government|school|hospital|church|nonprofit|military|unknown",
      "industry": "steel manufacturing or null",
      "relationship": "owner|operator|tenant|builder|demolisher|unknown",
      "dateStart": "YYYY or null",
      "dateEnd": "YYYY or null",
      "keyFacts": ["Fact explicitly stated 1", "Fact explicitly stated 2"],
      "aliases": ["Sterling Steel", "The Sterling Factory"],
      "context": "sentence where most significant mention appears",
      "confidence": 0.0 to 1.0
    }
  ],
  "extractionNotes": "brief note about extraction decisions"
}

REMEMBER:
- Start with the profile candidates from spaCy
- Verify each candidate appears in the document
- Only add facts that are explicitly written
- Use normalized names for future deduplication

Return ONLY the JSON object.`,
  },

  'v1.1': {
    version: 'v1.1',
    description: 'Ollama-optimized profile extraction',
    dateAdded: '2025-12-14',
    changelog: 'Shorter prompt for local LLM efficiency',
    systemPrompt: `Extract people and organization profiles from documents.

PEOPLE: name, role, dates, facts
ORGANIZATIONS: name, type, industry, dates, facts

Rules:
1. Only explicit facts from document
2. Normalize names (lowercase)
3. Include aliases
4. JSON output only`,
    userPrompt: `Extract profiles.

CANDIDATES:
People: {people_candidates}
Organizations: {organization_candidates}

TEXT:
{text}

OUTPUT:
{
  "people": [{
    "fullName": "Name",
    "normalizedName": "name",
    "role": "owner|founder|...|unknown",
    "dateStart": null,
    "dateEnd": null,
    "keyFacts": [],
    "aliases": [],
    "confidence": 0.0-1.0
  }],
  "organizations": [{
    "fullName": "Name",
    "normalizedName": "name",
    "orgType": "company|...|unknown",
    "industry": null,
    "relationship": "owner|...|unknown",
    "dateStart": null,
    "dateEnd": null,
    "keyFacts": [],
    "aliases": [],
    "confidence": 0.0-1.0
  }]
}

JSON only.`,
  },
};

// =============================================================================
// TLDR / SUMMARY PROMPTS
// =============================================================================

/**
 * TLDR and title generation prompts
 */
export const TLDR_PROMPTS: Record<string, PromptVersion> = {
  'v1.0': {
    version: 'v1.0',
    description: 'Timeline-optimized TLDR generation',
    dateAdded: '2025-12-14',
    changelog: 'Initial version focused on timeline events',
    systemPrompt: `You are an archivist creating timeline-optimized summaries for documents about abandoned places.

TLDR FORMAT (for timeline events):
- Maximum 100 characters
- Focus on WHO did WHAT in WHEN
- Use past tense
- Be specific, not generic
- No speculation

TITLE FORMAT (for web sources):
- Maximum 60 characters
- Include location type if known (Factory, Hospital, School)
- Include key identifier (name, city, unique feature)
- Focus on historical significance

KEY FACTS:
- 3-5 specific, verifiable facts
- Prioritize dates, numbers, names
- Each fact should be distinct
- No opinions or speculation

Return ONLY valid JSON.`,
    userPrompt: `Generate TLDR and title for this document.

## CONTEXT:
- Location Name: {locationName}
- Key Dates Found: {dates}
- Key People Found: {people}
- Key Organizations Found: {organizations}

## DOCUMENT:
---
{text}
---

## REQUIRED OUTPUT FORMAT (JSON):
{
  "title": "Short descriptive title under 60 chars",
  "tldr": "WHO did WHAT in WHEN - under 100 chars",
  "keyFacts": [
    "Specific fact 1",
    "Specific fact 2",
    "Specific fact 3"
  ],
  "suggestedLocationType": "factory|hospital|school|church|hotel|prison|military|residential|commercial|unknown",
  "suggestedEra": "pre-civil-war|gilded-age|progressive|roaring-20s|depression|ww2|post-war|cold-war|modern|unknown",
  "confidence": 0.0 to 1.0
}

TITLE EXAMPLES (good):
- "Sterling Steel: 85 Years of Industrial History"
- "Riverside Hospital Closure (1923-2008)"
- "The Fall of Millbrook Textile Mill"

TITLE EXAMPLES (bad - too generic):
- "Abandoned Place"
- "Old Building History"
- "Exploration Article"

Return ONLY the JSON object.`,
  },

  'v1.1': {
    version: 'v1.1',
    description: 'Ollama-optimized TLDR',
    dateAdded: '2025-12-14',
    changelog: 'Shorter prompt for local LLM',
    systemPrompt: `Create titles and summaries. Title under 60 chars. TLDR under 100 chars. JSON only.`,
    userPrompt: `Generate title and TLDR.

Location: {locationName}
Dates: {dates}
People: {people}
Orgs: {organizations}

Text:
{text}

Output:
{
  "title": "Under 60 chars",
  "tldr": "WHO did WHAT WHEN - under 100 chars",
  "keyFacts": ["Fact 1", "Fact 2", "Fact 3"],
  "suggestedLocationType": "factory|hospital|...|unknown",
  "suggestedEra": "gilded-age|depression|...|unknown",
  "confidence": 0.0-1.0
}

JSON only.`,
  },
};

// =============================================================================
// COMBINED EXTRACTION PROMPTS
// =============================================================================

/**
 * Combined prompts for single-pass extraction (minimizes API calls)
 */
export const COMBINED_EXTRACTION_PROMPTS: Record<string, PromptVersion> = {
  'v1.0': {
    version: 'v1.0',
    description: 'Full extraction in single pass',
    dateAdded: '2025-12-14',
    changelog: 'Combines date, profile, and TLDR extraction',
    systemPrompt: `You are an archive historian performing complete extraction from documents about abandoned places.

EXTRACT IN ONE PASS:
1. DATES - with verb context (built, opened, closed, demolished, etc.)
2. PEOPLE - name, role, key facts
3. ORGANIZATIONS - name, type, key facts
4. TLDR - title and summary

RULES:
- Dates MUST have verb context
- Only extract explicit facts
- Normalize names for deduplication
- Return structured JSON

Categories for dates: build_date, opening, closure, demolition, renovation, event, visit, publication, unknown`,
    userPrompt: `Complete extraction from this document.

## PREPROCESSING:
{preprocessed_sentences}

## DOCUMENT:
{text}

## OUTPUT FORMAT:
{
  "dates": [{
    "rawText": "quote",
    "parsedDate": "YYYY-MM-DD or YYYY",
    "parsedDateEnd": null,
    "precision": "exact|month|year|decade|approximate",
    "category": "build_date|opening|closure|demolition|...",
    "verbContext": "the verb",
    "confidence": 0.0-1.0,
    "context": "sentence",
    "isApproximate": boolean
  }],
  "people": [{
    "fullName": "Name",
    "normalizedName": "name",
    "role": "owner|founder|...|unknown",
    "keyFacts": [],
    "confidence": 0.0-1.0
  }],
  "organizations": [{
    "fullName": "Name",
    "normalizedName": "name",
    "orgType": "company|...|unknown",
    "relationship": "owner|...|unknown",
    "keyFacts": [],
    "confidence": 0.0-1.0
  }],
  "summary": {
    "title": "Under 60 chars",
    "tldr": "Under 100 chars",
    "keyFacts": ["Fact 1", "Fact 2", "Fact 3"],
    "confidence": 0.0-1.0
  }
}

JSON only.`,
  },
};

// =============================================================================
// CONFLICT DETECTION PROMPTS
// =============================================================================

/**
 * Prompts for detecting fact conflicts between sources
 */
export const CONFLICT_DETECTION_PROMPTS: Record<string, PromptVersion> = {
  'v1.0': {
    version: 'v1.0',
    description: 'Detect conflicts between extraction results',
    dateAdded: '2025-12-14',
    changelog: 'Initial conflict detection prompt',
    systemPrompt: `You are a fact checker comparing extractions from multiple sources about the same location.

DETECT CONFLICTS:
- date_mismatch: Two sources claim different dates for same event type
- name_mismatch: Different names for same entity
- fact_mismatch: Contradictory facts
- role_mismatch: Different roles attributed to same person

RULES:
1. Only flag clear contradictions (not missing data)
2. Consider precision (1923 vs 1923-05 are compatible)
3. Note which source is likely more authoritative
4. Suggest resolution if obvious

Return structured JSON.`,
    userPrompt: `Compare these extractions for conflicts.

## SOURCE A:
{source_a_json}

## SOURCE B:
{source_b_json}

## OUTPUT FORMAT:
{
  "conflicts": [
    {
      "conflictType": "date_mismatch|name_mismatch|fact_mismatch|role_mismatch",
      "fieldName": "e.g., build_date, closure_date, founder_name",
      "claimA": {
        "value": "value from source A",
        "context": "quote from source A"
      },
      "claimB": {
        "value": "value from source B",
        "context": "quote from source B"
      },
      "suggestedResolution": "claim_a|claim_b|both_valid|neither|needs_review",
      "reasoning": "why this resolution is suggested"
    }
  ],
  "noConflicts": ["list of fields that match or are compatible"]
}

JSON only.`,
  },
};

// =============================================================================
// PROMPT REGISTRY AND SELECTION
// =============================================================================

/**
 * Registry mapping prompt types to their version collections
 */
const PROMPT_REGISTRIES: Record<PromptType, Record<string, PromptVersion>> = {
  date_extraction: DATE_EXTRACTION_PROMPTS,
  profile_extraction: PROFILE_EXTRACTION_PROMPTS,
  tldr: TLDR_PROMPTS,
  combined: COMBINED_EXTRACTION_PROMPTS,
  conflict_detection: CONFLICT_DETECTION_PROMPTS,
};

/**
 * Default versions for each prompt type
 * Can be overridden in settings for A/B testing
 */
let DEFAULT_VERSIONS: Record<PromptType, string> = {
  date_extraction: 'v2.0',
  profile_extraction: 'v1.0',
  tldr: 'v1.0',
  combined: 'v1.0',
  conflict_detection: 'v1.0',
};

/**
 * Ollama-optimized versions (shorter prompts)
 */
const OLLAMA_VERSIONS: Record<PromptType, string> = {
  date_extraction: 'v2.1',
  profile_extraction: 'v1.1',
  tldr: 'v1.1',
  combined: 'v1.0', // No Ollama version yet
  conflict_detection: 'v1.0', // No Ollama version yet
};

/**
 * Get a prompt by type and optional version
 *
 * @param type - The prompt type
 * @param version - Specific version (defaults to DEFAULT_VERSIONS)
 * @returns The prompt configuration
 */
export function getPrompt(type: PromptType, version?: string): PromptVersion {
  const registry = PROMPT_REGISTRIES[type];

  if (!registry) {
    throw new Error(`Unknown prompt type: ${type}`);
  }

  const targetVersion = version || DEFAULT_VERSIONS[type];

  if (!registry[targetVersion]) {
    console.warn(`Prompt version ${targetVersion} not found for ${type}, using default`);
    return registry[DEFAULT_VERSIONS[type]];
  }

  return registry[targetVersion];
}

/**
 * Get an Ollama-optimized prompt (shorter for local inference)
 *
 * @param type - The prompt type
 * @returns The Ollama-optimized prompt or default if none exists
 */
export function getOllamaPrompt(type: PromptType): PromptVersion {
  const ollamaVersion = OLLAMA_VERSIONS[type];
  return getPrompt(type, ollamaVersion);
}

/**
 * Get all available versions for a prompt type
 *
 * @param type - The prompt type
 * @returns Array of version strings
 */
export function getAllVersions(type: PromptType): string[] {
  const registry = PROMPT_REGISTRIES[type];
  return registry ? Object.keys(registry) : [];
}

/**
 * Get the current default version for a prompt type
 *
 * @param type - The prompt type
 * @returns The default version string
 */
export function getDefaultVersion(type: PromptType): string {
  return DEFAULT_VERSIONS[type];
}

/**
 * Set the default version for a prompt type (runtime override)
 *
 * @param type - The prompt type
 * @param version - The version to set as default
 * @returns true if successful, false if version doesn't exist
 */
export function setDefaultVersion(type: PromptType, version: string): boolean {
  const registry = PROMPT_REGISTRIES[type];

  if (!registry || !registry[version]) {
    return false;
  }

  DEFAULT_VERSIONS[type] = version;
  return true;
}

/**
 * Get prompt metadata without the full prompt text
 *
 * @param type - The prompt type
 * @param version - Optional specific version
 * @returns Metadata object
 */
export function getPromptMetadata(
  type: PromptType,
  version?: string
): { version: string; description: string; dateAdded: string; deprecated?: boolean } {
  const prompt = getPrompt(type, version);
  return {
    version: prompt.version,
    description: prompt.description,
    dateAdded: prompt.dateAdded,
    deprecated: prompt.deprecated,
  };
}

/**
 * List all non-deprecated versions for a prompt type
 *
 * @param type - The prompt type
 * @returns Array of active version strings
 */
export function getActiveVersions(type: PromptType): string[] {
  const registry = PROMPT_REGISTRIES[type];
  if (!registry) return [];

  return Object.entries(registry)
    .filter(([_, prompt]) => !prompt.deprecated)
    .map(([version]) => version);
}

// =============================================================================
// PROMPT BUILDERS
// =============================================================================

/**
 * Placeholder definitions for prompt templates
 */
export interface DateExtractionPlaceholders {
  text: string;
  preprocessed_sentences?: string;
  total_sentences?: number;
  timeline_relevant?: number;
  profile_relevant?: number;
}

export interface ProfileExtractionPlaceholders {
  text: string;
  people_candidates?: string;
  organization_candidates?: string;
}

export interface TLDRPlaceholders {
  text: string;
  locationName?: string;
  dates?: string;
  people?: string;
  organizations?: string;
}

export interface CombinedPlaceholders extends DateExtractionPlaceholders, ProfileExtractionPlaceholders, TLDRPlaceholders {}

export interface ConflictDetectionPlaceholders {
  source_a_json: string;
  source_b_json: string;
}

/**
 * Build a date extraction prompt with placeholders filled
 */
export function buildDateExtractionPrompt(
  placeholders: DateExtractionPlaceholders,
  version?: string
): { systemPrompt: string; userPrompt: string; version: string } {
  const prompt = getPrompt('date_extraction', version);

  let userPrompt = prompt.userPrompt
    .replace('{text}', placeholders.text)
    .replace('{preprocessed_sentences}', placeholders.preprocessed_sentences || 'No preprocessing available')
    .replace('{total_sentences}', String(placeholders.total_sentences || 0))
    .replace('{timeline_relevant}', String(placeholders.timeline_relevant || 0))
    .replace('{profile_relevant}', String(placeholders.profile_relevant || 0));

  return {
    systemPrompt: prompt.systemPrompt,
    userPrompt,
    version: prompt.version,
  };
}

/**
 * Build a profile extraction prompt with placeholders filled
 */
export function buildProfileExtractionPrompt(
  placeholders: ProfileExtractionPlaceholders,
  version?: string
): { systemPrompt: string; userPrompt: string; version: string } {
  const prompt = getPrompt('profile_extraction', version);

  let userPrompt = prompt.userPrompt
    .replace('{text}', placeholders.text)
    .replace('{people_candidates}', placeholders.people_candidates || 'None detected')
    .replace('{organization_candidates}', placeholders.organization_candidates || 'None detected');

  return {
    systemPrompt: prompt.systemPrompt,
    userPrompt,
    version: prompt.version,
  };
}

/**
 * Build a TLDR prompt with placeholders filled
 */
export function buildTLDRPrompt(
  placeholders: TLDRPlaceholders,
  version?: string
): { systemPrompt: string; userPrompt: string; version: string } {
  const prompt = getPrompt('tldr', version);

  let userPrompt = prompt.userPrompt
    .replace('{text}', placeholders.text)
    .replace('{locationName}', placeholders.locationName || 'Unknown')
    .replace('{dates}', placeholders.dates || 'None extracted')
    .replace('{people}', placeholders.people || 'None extracted')
    .replace('{organizations}', placeholders.organizations || 'None extracted');

  return {
    systemPrompt: prompt.systemPrompt,
    userPrompt,
    version: prompt.version,
  };
}

/**
 * Build a combined extraction prompt
 */
export function buildCombinedPrompt(
  placeholders: CombinedPlaceholders,
  version?: string
): { systemPrompt: string; userPrompt: string; version: string } {
  const prompt = getPrompt('combined', version);

  let userPrompt = prompt.userPrompt
    .replace('{text}', placeholders.text)
    .replace('{preprocessed_sentences}', placeholders.preprocessed_sentences || 'No preprocessing');

  return {
    systemPrompt: prompt.systemPrompt,
    userPrompt,
    version: prompt.version,
  };
}

/**
 * Build a conflict detection prompt
 */
export function buildConflictDetectionPrompt(
  placeholders: ConflictDetectionPlaceholders,
  version?: string
): { systemPrompt: string; userPrompt: string; version: string } {
  const prompt = getPrompt('conflict_detection', version);

  let userPrompt = prompt.userPrompt
    .replace('{source_a_json}', placeholders.source_a_json)
    .replace('{source_b_json}', placeholders.source_b_json);

  return {
    systemPrompt: prompt.systemPrompt,
    userPrompt,
    version: prompt.version,
  };
}

// =============================================================================
// EXPORT SUMMARY
// =============================================================================

/**
 * Export all registries for debugging/inspection
 */
export function getAllPromptRegistries(): Record<PromptType, Record<string, PromptVersion>> {
  return { ...PROMPT_REGISTRIES };
}

/**
 * Get a summary of all prompts for logging
 */
export function getPromptsSummary(): Record<PromptType, { default: string; available: string[] }> {
  const result: Record<PromptType, { default: string; available: string[] }> = {} as Record<
    PromptType,
    { default: string; available: string[] }
  >;

  for (const type of Object.keys(PROMPT_REGISTRIES) as PromptType[]) {
    result[type] = {
      default: DEFAULT_VERSIONS[type],
      available: getAllVersions(type),
    };
  }

  return result;
}
