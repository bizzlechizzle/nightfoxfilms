/**
 * Conflict Types
 *
 * Types for fact conflict detection and resolution.
 * Used when multiple sources provide contradictory information.
 *
 * @version 1.0
 */

// =============================================================================
// CONFLICT CLASSIFICATION
// =============================================================================

/**
 * Type of conflict detected
 */
export type ConflictType =
  | 'date_mismatch'      // Two sources claim different dates for same event
  | 'name_mismatch'      // Different names for same entity
  | 'fact_mismatch'      // Contradictory facts
  | 'role_mismatch'      // Different roles attributed to same person
  | 'type_mismatch';     // Different types attributed to same org

/**
 * Conflict resolution options
 */
export type ConflictResolution =
  | 'claim_a'            // First claim is correct
  | 'claim_b'            // Second claim is correct
  | 'both_valid'         // Both claims are valid (e.g., different time periods)
  | 'neither'            // Neither claim is correct
  | 'merged';            // Claims were merged into single fact

// =============================================================================
// CONFLICT CLAIM
// =============================================================================

/**
 * A single claim in a conflict
 */
export interface ConflictClaim {
  /** The claimed value */
  value: string;
  /** Source reference (web_source ID) */
  source_ref: string;
  /** Extraction confidence */
  confidence: number;
  /** Context sentence */
  context?: string;
  /** Source domain for authority scoring */
  source_domain?: string;
  /** Source authority tier */
  source_tier?: number;
}

// =============================================================================
// FACT CONFLICT
// =============================================================================

/**
 * A detected fact conflict between two sources
 */
export interface FactConflict {
  /** Unique conflict ID */
  conflict_id: string;
  /** Associated location ID */
  locid: string;
  /** Type of conflict */
  conflict_type: ConflictType;
  /** Field name in conflict (e.g., 'build_date', 'founder_name') */
  field_name: string;

  /** First claim */
  claim_a: ConflictClaim;
  /** Second claim */
  claim_b: ConflictClaim;

  /** Whether conflict has been resolved */
  resolved: boolean;
  /** Resolution if resolved */
  resolution?: ConflictResolution;
  /** Notes about resolution */
  resolution_notes?: string;
  /** Who resolved it */
  resolved_by?: string;
  /** When resolved */
  resolved_at?: string;

  /** When detected */
  created_at: string;
}

/**
 * Input for creating a fact conflict record
 */
export interface FactConflictInput {
  locid: string;
  conflict_type: ConflictType;
  field_name: string;
  claim_a: ConflictClaim;
  claim_b: ConflictClaim;
}

/**
 * Input for resolving a conflict
 */
export interface ConflictResolutionInput {
  conflict_id: string;
  resolution: ConflictResolution;
  resolution_notes?: string;
  resolved_by?: string;
}

// =============================================================================
// CONFLICT DETECTION
// =============================================================================

/**
 * Result of conflict detection analysis
 */
export interface ConflictDetectionResult {
  /** New conflicts found */
  new_conflicts: FactConflict[];
  /** Existing conflicts updated */
  updated_conflicts: string[];
  /** Total conflicts for location */
  total_conflicts: number;
  /** Unresolved conflicts count */
  unresolved_count: number;
}

/**
 * Options for conflict detection
 */
export interface ConflictDetectionOptions {
  /** Minimum confidence difference to consider a conflict */
  minConfidenceDelta?: number;
  /** Fields to check for conflicts */
  checkFields?: string[];
  /** Whether to include resolved conflicts in count */
  includeResolved?: boolean;
}

/**
 * Default conflict detection options
 */
export const DEFAULT_CONFLICT_OPTIONS: ConflictDetectionOptions = {
  minConfidenceDelta: 0.1,
  checkFields: ['build_date', 'closure_date', 'demolition_date', 'founder_name', 'owner_name'],
  includeResolved: false,
};

// =============================================================================
// SOURCE AUTHORITY
// =============================================================================

/**
 * Source authority configuration
 */
export interface SourceAuthority {
  /** Domain name */
  domain: string;
  /** Authority tier (1 = highest) */
  tier: 1 | 2 | 3 | 4;
  /** Notes about this source */
  notes?: string;
  /** When added */
  created_at?: string;
  /** When last updated */
  updated_at?: string;
}

/**
 * Default authority tiers
 */
export const DEFAULT_AUTHORITY_TIERS: Record<number, string> = {
  1: 'Official/Primary (gov, edu, historical societies, newspapers of record)',
  2: 'Authoritative (Wikipedia, local news, museum sites, genealogy)',
  3: 'Community (enthusiast sites, blogs with citations)',
  4: 'User-generated (forums, social media, uncited sources)',
};

/**
 * Get default tier for a domain
 */
export function getDefaultTier(domain: string): number {
  const lowerDomain = domain.toLowerCase();

  // Tier 1: Official sources
  if (lowerDomain.endsWith('.gov') || lowerDomain.endsWith('.edu')) {
    return 1;
  }

  // Tier 2: Known authoritative sources
  const tier2Domains = [
    'wikipedia.org',
    'newspapers.com',
    'findagrave.com',
    'ancestry.com',
    'loc.gov',
    'archives.gov',
    'nps.gov',
  ];
  if (tier2Domains.some((d) => lowerDomain.includes(d))) {
    return 2;
  }

  // Tier 4: Known user-generated sources
  const tier4Domains = [
    'reddit.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'instagram.com',
  ];
  if (tier4Domains.some((d) => lowerDomain.includes(d))) {
    return 4;
  }

  // Default to Tier 3
  return 3;
}

// =============================================================================
// CONFLICT SUMMARY
// =============================================================================

/**
 * Summary of conflicts for a location
 */
export interface ConflictSummary {
  /** Location ID */
  locid: string;
  /** Total conflicts */
  total: number;
  /** Unresolved conflicts */
  unresolved: number;
  /** Conflicts by type */
  by_type: Record<ConflictType, number>;
  /** Conflicts by field */
  by_field: Record<string, number>;
  /** Most recent conflict */
  most_recent?: string;
}

// =============================================================================
// EXTRACTION INPUT STORAGE
// =============================================================================

/**
 * Stored extraction input for replay capability
 */
export interface ExtractionInput {
  /** Unique input ID */
  input_id: string;
  /** Source type */
  source_type: string;
  /** Source ID */
  source_id: string;
  /** Location ID if associated */
  locid?: string;
  /** Raw text input */
  raw_text: string;
  /** Preprocessing result JSON */
  preprocessing_json?: string;
  /** Extraction result JSON */
  extraction_json?: string;
  /** Prompt version used */
  prompt_version?: string;
  /** Provider used */
  provider?: string;
  /** When stored */
  created_at: string;
}

/**
 * Input for storing extraction input
 */
export interface ExtractionInputRecord {
  source_type: string;
  source_id: string;
  locid?: string;
  raw_text: string;
  preprocessing_json?: string;
  extraction_json?: string;
  prompt_version?: string;
  provider?: string;
}

// =============================================================================
// LLM CONFLICT RESOLUTION (LLM Tools Overhaul)
// =============================================================================

/**
 * LLM-suggested resolution with detailed reasoning
 * Per LLM Tools Overhaul: Three-strategy approach
 */
export interface ConflictResolutionSuggestion {
  /** Suggested resolution */
  suggestedResolution: 'claim_a' | 'claim_b' | 'both_valid' | 'needs_review';
  /** Detailed reasoning from LLM or rule-based analysis */
  reasoning: string;
  /** Confidence in the suggestion (0.0-1.0) */
  confidence: number;
  /** Which strategy was used */
  strategy: 'source_authority' | 'llm_analysis' | 'confidence_based' | 'manual_required';
  /** Suggested merged value if both_valid */
  suggestedMergedValue?: string;
  /** Additional context for human reviewer */
  reviewNotes?: string;
}

/**
 * Conflict with resolution suggestion attached
 */
export interface FactConflictWithSuggestion extends FactConflict {
  suggestion?: ConflictResolutionSuggestion;
}
