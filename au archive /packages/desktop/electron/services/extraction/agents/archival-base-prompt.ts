/**
 * Archival Base Prompt
 *
 * Universal instructions for ALL LLM extraction agents in the archival system.
 * This ensures consistent behavior, fact-checking rules, and output quality
 * across all extraction tasks (dates, people, companies, addresses, summaries).
 *
 * IMPORTANT: Every extraction agent MUST import and use this base prompt.
 * The base prompt establishes archival standards that cannot be overridden.
 *
 * @version 1.0
 * @since LLM Tools Overhaul (December 2025)
 */

// =============================================================================
// CORE ARCHIVAL RULES - ALL AGENTS MUST FOLLOW
// =============================================================================

/**
 * The foundational system prompt for ALL archival LLM agents.
 * Import this in every agent and prepend to agent-specific instructions.
 */
export const ARCHIVAL_BASE_SYSTEM_PROMPT = `You are an archive historian assistant for the Abandoned Archive, a research tool documenting abandoned and historical places. Your extractions become part of a permanent archive that historians will rely on for decades.

## ABSOLUTE RULES FOR ARCHIVAL EXTRACTION

### 1. NEVER FABRICATE
- Extract ONLY information explicitly stated in the source document
- Never infer, guess, or assume facts not directly written
- If information is ambiguous, say so - do not pick the "most likely" option
- "I don't know" is a valid and valuable response

### 2. EXPRESS UNCERTAINTY
- Every extracted fact MUST have a confidence score (0.0 to 1.0)
- Confidence reflects how explicit and unambiguous the source is:
  - 0.95-1.0: Explicit, unambiguous statement with full context
  - 0.80-0.94: Clear statement with good context
  - 0.60-0.79: Reasonable inference with some ambiguity
  - 0.40-0.59: Possible interpretation, needs human review
  - Below 0.40: Too uncertain - do not extract, note as "needs_review"

### 3. CITE SOURCES
- Every extracted fact MUST reference its source sentence(s)
- Provide the exact quote or paraphrase that supports each claim
- Context is mandatory - isolated facts without context are rejected
- Use "context" field to capture the relevant sentence(s)

### 4. DISTINGUISH DATA TYPES
All extracted data falls into one of three verification tiers:
- **verified**: Confirmed by multiple sources OR from primary documents (official records, newspapers, death certificates)
- **extracted**: Single-source extraction, appears accurate but needs human review
- **inferred**: Logical deduction from context - LOWEST confidence, flag for review

Mark the appropriate tier in your output. When in doubt, use "extracted" (never "verified").

### 5. DATE REQUIREMENTS
Dates are the most critical extraction for timeline construction.

**Verb-Date Rule**: A date is ONLY timeline-relevant if it has VERB CONTEXT:
- Timeline verbs: built, opened, closed, demolished, abandoned, founded, established, constructed, razed, renovated, restored, acquired, purchased, sold
- A bare date without a verb (e.g., "1923") is NOT a timeline event - it's just a date mention
- Employee counts, measurements, and statistics are NEVER dates: "500 workers", "50 feet", "$1,923"

**Date Categories** (require matching verb):
| Category | Verbs | Timeline Relevance |
|----------|-------|-------------------|
| build_date | built, constructed, erected, established, founded, completed | HIGH |
| opening | opened, inaugurated, began operations, launched | HIGH |
| closure | closed, shut down, ceased, abandoned, vacated | HIGH |
| demolition | demolished, razed, torn down, destroyed | HIGH |
| renovation | renovated, restored, rebuilt, refurbished, expanded | MEDIUM |
| event | burned, flooded, exploded, collapsed, damaged | HIGH |
| ownership | acquired, purchased, sold, transferred, donated | MEDIUM |
| visit | visited, explored, photographed, documented | LOW (for timeline) |
| publication | published, reported, written, posted | LOW (metadata only) |

**Date Format**: Use ISO 8601
- Full date: YYYY-MM-DD (e.g., 1923-03-15)
- Month precision: YYYY-MM (e.g., 1923-03)
- Year precision: YYYY (e.g., 1923)
- Mark approximate dates with isApproximate: true

### 6. ENTITY REQUIREMENTS
For people and organizations:
- **Normalize names**: Store both original spelling AND normalized version
- **Track aliases**: Multiple mentions of same entity should be consolidated
- **Role context**: What relationship did they have to the location?
- **Date range**: When were they associated with this location?

### 7. CONFLICT HANDLING
When sources disagree:
- NEVER auto-resolve conflicts - surface them for human review
- Flag with: has_conflict: true, conflict_type: "date_mismatch" | "fact_mismatch"
- Provide reasoning for which source seems more authoritative
- Let the human make the final decision

### 8. OUTPUT FORMAT
- Return ONLY valid JSON - no markdown, no commentary, no explanations outside JSON
- All string fields must be properly escaped
- Empty arrays [] for categories with no results (not null, not omitted)
- Confidence scores are numbers, not strings
- Dates are strings in ISO format, not Date objects

## WHAT NOT TO EXTRACT

Never extract these as dates:
- Employee/visitor counts: "500 workers", "thousands of visitors"
- Measurements: "50 feet tall", "1,500 square feet"
- Currency: "$1,923", "2,000 dollars"
- Times: "9:00 AM", "4:30 PM"
- Phone numbers: "555-1234"
- Route/highway numbers: "Route 66", "Highway 1"
- Building/room numbers: "Building 5", "Room 123"
- Percentages: "50%", "20 percent"
- GPS coordinates: "42.1234, -73.5678"
- Serial numbers, model numbers, addresses with numbers

Never fabricate:
- Names of people not mentioned
- Organizations not described
- Events not documented
- Dates not stated or strongly implied

## REMEMBER

You serve researchers who need VERIFIED historical data. Every extraction becomes part of a permanent archive. ACCURACY OVER COMPLETENESS - it is better to extract nothing than to extract something wrong.

When in doubt: flag for human review (needs_review: true).`;

// =============================================================================
// VERB CATEGORIES FOR TIMELINE RELEVANCE
// =============================================================================

/**
 * Timeline-relevant verb categories and their weights.
 * Used by agents to determine if a date should appear on the timeline.
 */
export const TIMELINE_VERB_CATEGORIES = {
  build_date: {
    weight: 1.0,
    verbs: ['built', 'construct', 'constructed', 'erect', 'erected', 'establish', 'established', 'found', 'founded', 'complete', 'completed', 'dating from'],
    description: 'Construction or founding events',
    timelineRelevant: true,
  },
  opening: {
    weight: 0.95,
    verbs: ['open', 'opened', 'inaugurate', 'inaugurated', 'launch', 'launched', 'began operations', 'start', 'started', 'commence', 'commenced'],
    description: 'Opening or beginning of operations',
    timelineRelevant: true,
  },
  closure: {
    weight: 0.95,
    verbs: ['close', 'closed', 'shut', 'shut down', 'cease', 'ceased', 'discontinue', 'discontinued', 'terminate', 'terminated', 'end', 'ended', 'abandon', 'abandoned', 'vacate', 'vacated'],
    description: 'Closing or cessation of operations',
    timelineRelevant: true,
  },
  demolition: {
    weight: 1.0,
    verbs: ['demolish', 'demolished', 'destroy', 'destroyed', 'raze', 'razed', 'tear down', 'torn down', 'dismantle', 'dismantled', 'collapse', 'collapsed', 'burn', 'burned', 'burnt'],
    description: 'Destruction or demolition events',
    timelineRelevant: true,
  },
  renovation: {
    weight: 0.85,
    verbs: ['renovate', 'renovated', 'restore', 'restored', 'repair', 'repaired', 'rebuild', 'rebuilt', 'remodel', 'remodeled', 'refurbish', 'refurbished', 'modernize', 'modernized', 'upgrade', 'upgraded', 'expand', 'expanded', 'convert', 'converted'],
    description: 'Renovation or restoration events',
    timelineRelevant: true,
  },
  event: {
    weight: 0.9,
    verbs: ['occur', 'occurred', 'happen', 'happened', 'fire', 'fired', 'explode', 'exploded', 'flood', 'flooded', 'strike', 'struck', 'damage', 'damaged', 'injure', 'injured', 'kill', 'killed'],
    description: 'Notable incidents or disasters',
    timelineRelevant: true,
  },
  ownership: {
    weight: 0.8,
    verbs: ['acquire', 'acquired', 'purchase', 'purchased', 'buy', 'bought', 'sell', 'sold', 'transfer', 'transferred', 'donate', 'donated', 'inherit', 'inherited', 'own', 'owned', 'lease', 'leased'],
    description: 'Ownership changes',
    timelineRelevant: true,
  },
  visit: {
    weight: 0.6,
    verbs: ['visit', 'visited', 'explore', 'explored', 'tour', 'toured', 'photograph', 'photographed', 'document', 'documented', 'investigate', 'investigated'],
    description: 'Visits or documentation (lower timeline priority)',
    timelineRelevant: false, // Visit dates go to visit events, not main timeline
  },
  publication: {
    weight: 0.5,
    verbs: ['publish', 'published', 'report', 'reported', 'announce', 'announced', 'write', 'written', 'post', 'posted', 'article dated'],
    description: 'Publication dates (metadata, not timeline)',
    timelineRelevant: false, // Publication dates are source metadata
  },
} as const;

export type TimelineVerbCategory = keyof typeof TIMELINE_VERB_CATEGORIES;

/**
 * Check if a verb indicates timeline relevance
 */
export function isTimelineRelevantVerb(verb: string): { relevant: boolean; category?: TimelineVerbCategory; weight?: number } {
  const normalizedVerb = verb.toLowerCase().trim();

  for (const [category, config] of Object.entries(TIMELINE_VERB_CATEGORIES)) {
    if (config.verbs.some(v => normalizedVerb.includes(v) || v.includes(normalizedVerb))) {
      return {
        relevant: config.timelineRelevant,
        category: category as TimelineVerbCategory,
        weight: config.weight,
      };
    }
  }

  return { relevant: false };
}

/**
 * Get all verbs for a specific category
 */
export function getVerbsForCategory(category: TimelineVerbCategory): string[] {
  return [...TIMELINE_VERB_CATEGORIES[category].verbs];
}

// =============================================================================
// DATA VERIFICATION TYPES
// =============================================================================

/**
 * Verification status for extracted data
 */
export type DataVerificationStatus = 'verified' | 'extracted' | 'inferred';

/**
 * Extracted fact with full provenance
 */
export interface ExtractedFact {
  /** The extracted value */
  value: string;
  /** Verification tier */
  status: DataVerificationStatus;
  /** Confidence score 0-1 */
  confidence: number;
  /** Source reference (web source ID, document hash, etc.) */
  sourceRef: string;
  /** The sentence(s) that support this fact */
  contextSentence: string;
  /** Verb that triggered extraction (for timeline relevance) */
  verbContext?: string;
  /** Whether human review is needed */
  needsReview: boolean;
}

// =============================================================================
// CONFIDENCE CALIBRATION
// =============================================================================

/**
 * Calibrate confidence based on extraction characteristics
 */
export function calibrateConfidence(
  baseConfidence: number,
  options: {
    hasExplicitVerb?: boolean;
    hasExactDate?: boolean;
    isApproximate?: boolean;
    categoryUnknown?: boolean;
    shortContext?: boolean;
    multipleSourcesAgree?: boolean;
  }
): number {
  let confidence = baseConfidence;

  // Boosts
  if (options.hasExplicitVerb) {
    confidence = Math.min(1.0, confidence + 0.1);
  }
  if (options.hasExactDate) {
    confidence = Math.min(1.0, confidence + 0.1);
  }
  if (options.multipleSourcesAgree) {
    confidence = Math.min(1.0, confidence + 0.15);
  }

  // Penalties
  if (options.isApproximate) {
    confidence = Math.max(0.1, confidence - 0.05);
  }
  if (options.categoryUnknown) {
    confidence = Math.max(0.1, confidence - 0.1);
  }
  if (options.shortContext) {
    confidence = Math.max(0.1, confidence - 0.1);
  }

  return Math.round(confidence * 100) / 100;
}

// =============================================================================
// PROMPT UTILITIES
// =============================================================================

/**
 * Format the base prompt with optional additions
 */
export function formatBasePrompt(additionalInstructions?: string): string {
  if (!additionalInstructions) {
    return ARCHIVAL_BASE_SYSTEM_PROMPT;
  }

  return `${ARCHIVAL_BASE_SYSTEM_PROMPT}

## ADDITIONAL TASK-SPECIFIC INSTRUCTIONS

${additionalInstructions}`;
}

/**
 * Create a prompt with preprocessing context
 */
export function formatPromptWithPreprocessing(
  taskPrompt: string,
  preprocessing?: {
    timelineSentences?: string;
    profileCandidates?: string;
    gpeEntities?: string;
  }
): string {
  let preprocessingSection = '';

  if (preprocessing?.timelineSentences) {
    preprocessingSection += `
## SPACY PREPROCESSING: Timeline-Relevant Sentences
These sentences contain dates with timeline verbs (built, closed, demolished, etc.):
${preprocessing.timelineSentences}
`;
  }

  if (preprocessing?.profileCandidates) {
    preprocessingSection += `
## SPACY PREPROCESSING: Profile Candidates
Named entities detected (PERSON, ORG):
${preprocessing.profileCandidates}
`;
  }

  if (preprocessing?.gpeEntities) {
    preprocessingSection += `
## SPACY PREPROCESSING: Location/Address Entities
GPE (Geopolitical) and LOC (Location) entities:
${preprocessing.gpeEntities}
`;
  }

  if (preprocessingSection) {
    return `${taskPrompt}

${preprocessingSection}`;
  }

  return taskPrompt;
}
