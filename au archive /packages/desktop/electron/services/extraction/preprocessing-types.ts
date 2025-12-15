/**
 * Preprocessing Types
 *
 * Types for spaCy preprocessing output and LLM input packages.
 * These match the Python preprocessor output structure.
 *
 * @version 1.0
 */

// =============================================================================
// VERB DETECTION TYPES
// =============================================================================

/**
 * Timeline verb categories
 */
export type VerbCategory =
  | 'build_date'
  | 'opening'
  | 'closure'
  | 'demolition'
  | 'renovation'
  | 'event'
  | 'visit'
  | 'publication'
  | 'ownership';

/**
 * A verb match found in text
 */
export interface VerbMatch {
  /** The verb text */
  text: string;
  /** Timeline category of the verb */
  category: VerbCategory;
  /** Position in the sentence */
  position: number;
}

// =============================================================================
// ENTITY TYPES
// =============================================================================

/**
 * spaCy entity types we care about
 */
export type SpacyEntityType = 'PERSON' | 'ORG' | 'DATE' | 'GPE' | 'LOC' | 'FAC';

/**
 * An entity match found by spaCy
 */
export interface EntityMatch {
  /** Entity text */
  text: string;
  /** spaCy entity type */
  type: SpacyEntityType;
  /** Start position in sentence */
  start: number;
  /** End position in sentence */
  end: number;
}

// =============================================================================
// SENTENCE TYPES
// =============================================================================

/**
 * Sentence relevancy classification
 */
export type SentenceRelevancy = 'timeline' | 'timeline_possible' | 'profile' | 'context';

/**
 * A preprocessed sentence with analysis
 */
export interface PreprocessedSentence {
  /** Original sentence text */
  text: string;
  /** Relevancy classification */
  relevancy: SentenceRelevancy;
  /** Specific relevancy type (verb category for timeline) */
  relevancy_type: VerbCategory | null;
  /** Timeline verbs found in sentence */
  verbs: VerbMatch[];
  /** Named entities found in sentence */
  entities: EntityMatch[];
  /** Confidence score 0-1 */
  confidence: number;
  /** Has a date entity */
  has_date: boolean;
  /** Has a person entity */
  has_person: boolean;
  /** Has an organization entity */
  has_org: boolean;
}

// =============================================================================
// PROFILE CANDIDATE TYPES
// =============================================================================

/**
 * A person profile candidate from preprocessing
 */
export interface PersonProfileCandidate {
  /** Original name as found */
  name: string;
  /** Normalized name for deduplication */
  normalized_name: string;
  /** Context sentences where mentioned */
  contexts: string[];
  /** Primary inferred role */
  implied_role: string | null;
  /** All roles found */
  all_roles: string[];
  /** Number of mentions */
  mention_count: number;
}

/**
 * An organization profile candidate from preprocessing
 */
export interface OrgProfileCandidate {
  /** Organization name as found */
  name: string;
  /** Normalized name for deduplication */
  normalized_name: string;
  /** Context sentences where mentioned */
  contexts: string[];
  /** Primary inferred type */
  implied_type: string | null;
  /** All types found */
  all_types: string[];
  /** Primary relationship to location */
  implied_relationship: string | null;
  /** All relationships found */
  all_relationships: string[];
  /** Number of mentions */
  mention_count: number;
}

/**
 * Profile candidates container
 */
export interface ProfileCandidates {
  people: PersonProfileCandidate[];
  organizations: OrgProfileCandidate[];
}

// =============================================================================
// DOCUMENT STATS
// =============================================================================

/**
 * Document statistics from preprocessing
 */
export interface DocumentStats {
  /** Total sentences processed */
  total_sentences: number;
  /** Sentences with timeline relevancy */
  timeline_relevant: number;
  /** Sentences with profile relevancy */
  profile_relevant: number;
  /** Total unique people found */
  total_people: number;
  /** Total unique organizations found */
  total_organizations: number;
}

// =============================================================================
// PREPROCESSING RESULT
// =============================================================================

/**
 * Complete preprocessing result from spaCy service
 */
export interface PreprocessingResult {
  /** Document statistics */
  document_stats: DocumentStats;
  /** All processed sentences */
  sentences: PreprocessedSentence[];
  /** Timeline-relevant sentences only */
  timeline_candidates: PreprocessedSentence[];
  /** Profile candidates */
  profile_candidates: ProfileCandidates;
  /** Condensed context string for LLM */
  llm_context: string;
  /** Article date if provided */
  article_date: string | null;
  /** Processing time in milliseconds */
  processing_time_ms: number;
}

// =============================================================================
// PREPROCESSING OPTIONS
// =============================================================================

/**
 * Options for preprocessing behavior
 */
export interface PreprocessingOptions {
  /** Whether to use preprocessing (default: true) */
  usePreprocessing: boolean;
  /** Preprocessing mode */
  preprocessingMode: 'full' | 'verbs_only' | 'entities_only';
  /** Fall back to raw text if preprocessing fails */
  fallbackToRawText: boolean;
  /** Maximum sentences to include in LLM context */
  maxSentences: number;
}

/**
 * Default preprocessing options
 */
export const DEFAULT_PREPROCESSING_OPTIONS: PreprocessingOptions = {
  usePreprocessing: true,
  preprocessingMode: 'full',
  fallbackToRawText: true,
  maxSentences: 20,
};

// =============================================================================
// REQUEST/RESPONSE TYPES
// =============================================================================

/**
 * Request to preprocess endpoint
 */
export interface PreprocessRequest {
  text: string;
  articleDate?: string;
  maxSentences?: number;
}

/**
 * Response from preprocess endpoint
 */
export type PreprocessResponse = PreprocessingResult;
