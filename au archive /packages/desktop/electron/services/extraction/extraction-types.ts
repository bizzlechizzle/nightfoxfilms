/**
 * Extraction Types
 *
 * Core type definitions for the Document Intelligence extraction system.
 * These types define the contract between the extraction service and all providers.
 *
 * @version 1.0
 */

// =============================================================================
// INPUT TYPES
// =============================================================================

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

  /** Associated sub-location (optional) */
  subid?: string;

  /** What to extract (if not specified, extract everything) */
  extractTypes?: Array<'dates' | 'people' | 'organizations' | 'locations' | 'summary' | 'title'>;

  /** Article/document date for relative date resolution */
  articleDate?: string;

  /** Location name for context (helps with title generation) */
  locationName?: string;
}

// =============================================================================
// OUTPUT TYPES - DATES
// =============================================================================

/**
 * Date precision levels
 */
export type DatePrecision = 'exact' | 'month' | 'year' | 'decade' | 'approximate' | 'range';

/**
 * Date category types
 */
export type DateCategory =
  | 'build_date'
  | 'opening'
  | 'closure'
  | 'demolition'
  | 'visit'
  | 'publication'
  | 'renovation'
  | 'event'
  | 'unknown';

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
  precision: DatePrecision;

  /** What kind of date is this? */
  category: DateCategory;

  /** 0-1 confidence score */
  confidence: number;

  /** Surrounding sentence for context */
  context: string;

  /** Is this approximate? (circa, about, etc.) */
  isApproximate: boolean;

  /** Display-friendly date format */
  dateDisplay?: string;

  /** EDTF format for archival purposes */
  dateEdtf?: string;
}

// =============================================================================
// OUTPUT TYPES - ENTITIES
// =============================================================================

/**
 * Person role in relation to the location
 */
export type PersonRole =
  | 'owner'
  | 'architect'
  | 'developer'
  | 'employee'
  | 'founder'
  | 'visitor'
  | 'photographer'
  | 'historian'
  | 'unknown';

/**
 * A single extracted person
 */
export interface ExtractedPerson {
  /** Full name as found */
  name: string;

  /** Role in relation to the location */
  role: PersonRole;

  /** All text mentions of this person */
  mentions: string[];

  /** Confidence score 0-1 */
  confidence: number;
}

/**
 * Organization type
 */
export type OrganizationType =
  | 'company'
  | 'government'
  | 'school'
  | 'hospital'
  | 'church'
  | 'nonprofit'
  | 'military'
  | 'unknown';

/**
 * A single extracted organization
 */
export interface ExtractedOrganization {
  /** Organization name */
  name: string;

  /** Type of organization */
  type: OrganizationType;

  /** All text mentions */
  mentions: string[];

  /** Confidence score 0-1 */
  confidence: number;
}

/**
 * Location reference type
 */
export type LocationRefType =
  | 'city'
  | 'state'
  | 'country'
  | 'address'
  | 'landmark'
  | 'region'
  | 'neighborhood'
  | 'unknown';

/**
 * A single extracted location reference
 */
export interface ExtractedLocation {
  /** Location name or address */
  name: string;

  /** Type: city, address, landmark, etc. */
  type: LocationRefType;

  /** Confidence score 0-1 */
  confidence: number;
}

// =============================================================================
// OUTPUT TYPES - SUMMARY & TITLE
// =============================================================================

/**
 * Suggested location type (inferred from content)
 */
export type SuggestedLocationType =
  | 'factory'
  | 'hospital'
  | 'school'
  | 'asylum'
  | 'prison'
  | 'church'
  | 'hotel'
  | 'theater'
  | 'military'
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'unknown';

/**
 * Suggested era (inferred from dates)
 */
export type SuggestedEra =
  | 'colonial'
  | 'victorian'
  | 'industrial'
  | 'art_deco'
  | 'mid_century'
  | 'modern'
  | 'unknown';

/**
 * Document summary with title
 */
export interface ExtractedSummary {
  /** Short TLDR title (6-10 words, max 60 chars) */
  title: string;

  /** TL;DR summary (1-3 sentences, WHO did WHAT WHEN format) */
  summary: string;

  /** Key facts as bullet points (3-5 verifiable facts) */
  keyFacts: string[];

  /** Confidence in the summary quality 0-1 */
  confidence: number;

  /** Suggested location type inferred from content */
  suggestedLocationType?: SuggestedLocationType;

  /** Suggested era inferred from dates */
  suggestedEra?: SuggestedEra;
}

// =============================================================================
// COMPLETE EXTRACTION RESULT
// =============================================================================

/**
 * Complete extraction result from a provider
 */
export interface ExtractionResult {
  /** Which provider produced this result */
  provider: string;

  /** Model used (e.g., "qwen2.5:32b", "en_core_web_lg", "claude-sonnet-4") */
  model: string;

  /** Extracted dates */
  dates: ExtractedDate[];

  /** Extracted people */
  people: ExtractedPerson[];

  /** Extracted organizations */
  organizations: ExtractedOrganization[];

  /** Extracted location references */
  locations: ExtractedLocation[];

  /** Document summary and title */
  summaryData?: ExtractedSummary;

  /** Legacy: TL;DR text (deprecated, use summaryData) */
  summary?: string;

  /** Legacy: Key facts (deprecated, use summaryData) */
  keyFacts?: string[];

  /** Processing time in milliseconds */
  processingTimeMs: number;

  /** Any warnings or notes */
  warnings?: string[];

  /** Raw response from provider (for debugging) */
  rawResponse?: string;
}

// =============================================================================
// PROVIDER TYPES
// =============================================================================

/**
 * Provider type enumeration
 */
export type ProviderType = 'spacy' | 'ollama' | 'anthropic' | 'google' | 'openai' | 'litellm';

/**
 * Provider configuration (stored in settings/database)
 */
export interface ProviderConfig {
  /** Unique provider ID */
  id: string;

  /** Display name */
  name: string;

  /** Provider type */
  type: ProviderType;

  /** Is this provider enabled? */
  enabled: boolean;

  /** Priority (lower = tried first) */
  priority: number;

  /** Provider-specific settings */
  settings: ProviderSettings;
}

/**
 * Provider-specific settings
 */
export interface ProviderSettings {
  /** For spaCy: path to executable */
  executablePath?: string;

  /** For spaCy: port to run on */
  port?: number;

  /** For Ollama: host (e.g., "localhost", "192.168.1.100") */
  host?: string;

  /** For Ollama: model name */
  model?: string;

  /** For cloud providers: API key */
  apiKey?: string;

  /** For cloud providers: model name */
  cloudModel?: string;

  /** Request timeout in ms */
  timeout?: number;

  /** Temperature for LLM (0-1, lower = more deterministic) */
  temperature?: number;

  /** Max tokens to generate */
  maxTokens?: number;
}

/**
 * Provider status (runtime state)
 */
export interface ProviderStatus {
  /** Provider ID */
  id: string;

  /** Is the provider available right now? */
  available: boolean;

  /** When was availability last checked? */
  lastCheck: string;

  /** Last error message (if unavailable) */
  lastError?: string;

  /** Model information */
  modelInfo?: {
    name: string;
    size?: string;
    quantization?: string;
    description?: string;
  };

  /** Response time from last check (ms) */
  responseTimeMs?: number;
}

// =============================================================================
// AGENT TYPES
// =============================================================================

/**
 * Agent type enumeration
 */
export type AgentType = 'date_extraction' | 'summary_title';

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Agent type */
  type: AgentType;

  /** Display name */
  name: string;

  /** Preferred provider ID (null = use priority order) */
  preferredProviderId?: string;

  /** Agent-specific prompt template */
  promptTemplate: string;

  /** System prompt for the agent */
  systemPrompt: string;

  /** Whether this agent requires LLM (vs spaCy) */
  requiresLLM: boolean;

  /** Minimum confidence threshold for results */
  minConfidence: number;
}

// =============================================================================
// JOB TRACKING
// =============================================================================

/**
 * Extraction job status
 */
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

/**
 * Extraction job record
 */
export interface ExtractionJob {
  /** Unique job ID */
  jobId: string;

  /** Source type */
  sourceType: string;

  /** Source ID */
  sourceId: string;

  /** Location ID */
  locid?: string;

  /** Job status */
  status: JobStatus;

  /** Which provider is processing/processed this */
  providerId?: string;

  /** Agent used */
  agentType?: AgentType;

  /** When the job started */
  startedAt?: string;

  /** When the job completed */
  completedAt?: string;

  /** Error message if failed */
  errorMessage?: string;

  /** Processing time in ms */
  processingTimeMs?: number;

  /** When the job was created */
  createdAt: string;
}

// =============================================================================
// STORED EXTRACTION TYPES
// =============================================================================

/**
 * Entity extraction review status
 */
export type ExtractionStatus = 'pending' | 'approved' | 'rejected' | 'corrected';

/**
 * Entity type for unified storage
 */
export type EntityType = 'date' | 'person' | 'organization' | 'location' | 'summary';

/**
 * Stored entity extraction
 */
export interface StoredExtraction {
  /** Unique extraction ID */
  extractionId: string;

  /** Source type */
  sourceType: string;

  /** Source ID */
  sourceId: string;

  /** Location ID */
  locid?: string;

  /** Entity type */
  entityType: EntityType;

  /** Raw text that was extracted */
  rawText: string;

  /** Normalized/parsed value */
  normalizedValue?: string;

  /** For dates: start date */
  dateStart?: string;

  /** For dates: end date */
  dateEnd?: string;

  /** For dates: precision */
  datePrecision?: DatePrecision;

  /** For dates: category */
  dateCategory?: DateCategory;

  /** Is approximate */
  isApproximate?: boolean;

  /** For people/orgs: role/subtype */
  entityRole?: string;

  /** For people/orgs: subtype */
  entitySubtype?: string;

  /** JSON array of mentions */
  mentions?: string;

  /** Overall confidence 0-1 */
  overallConfidence: number;

  /** Provider that extracted this */
  providerId?: string;

  /** Model used */
  modelUsed?: string;

  /** Context sentence */
  contextSentence?: string;

  /** Review status */
  status: ExtractionStatus;

  /** When reviewed */
  reviewedAt?: string;

  /** Who reviewed */
  reviewedBy?: string;

  /** User's correction (if corrected) */
  userCorrection?: string;

  /** When created */
  createdAt: string;
}

/**
 * Stored document summary
 */
export interface StoredSummary {
  /** Unique summary ID */
  summaryId: string;

  /** Source type */
  sourceType: string;

  /** Source ID */
  sourceId: string;

  /** Location ID */
  locid?: string;

  /** Generated title */
  title: string;

  /** Summary text */
  summaryText: string;

  /** Key facts (JSON array) */
  keyFacts?: string;

  /** Provider that generated this */
  providerId?: string;

  /** Model used */
  modelUsed?: string;

  /** Confidence 0-1 */
  confidence: number;

  /** Review status */
  status: ExtractionStatus;

  /** When created */
  createdAt: string;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Extraction options for the orchestrator
 */
export interface ExtractionOptions {
  /** Prefer a specific provider */
  preferProvider?: string;

  /** Require summary generation (skips spaCy) */
  needsSummary?: boolean;

  /** Require title generation (skips spaCy) */
  needsTitle?: boolean;

  /** Minimum confidence threshold */
  minConfidence?: number;

  /** Maximum retries per provider */
  maxRetries?: number;

  /** Agents to run */
  agents?: AgentType[];
}

/**
 * Batch extraction request
 */
export interface BatchExtractionRequest {
  /** Items to extract */
  items: ExtractionInput[];

  /** Options for all items */
  options?: ExtractionOptions;

  /** Run in parallel (default: true) */
  parallel?: boolean;

  /** Max concurrent extractions */
  concurrency?: number;
}

/**
 * Batch extraction result
 */
export interface BatchExtractionResult {
  /** Total items processed */
  total: number;

  /** Successful extractions */
  successful: number;

  /** Failed extractions */
  failed: number;

  /** Results per item (keyed by sourceId) */
  results: Record<string, ExtractionResult | { error: string }>;

  /** Total processing time */
  totalTimeMs: number;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  /** Overall healthy */
  healthy: boolean;

  /** Provider statuses */
  providers: ProviderStatus[];

  /** System info */
  system: {
    ollamaAvailable: boolean;
    spacyAvailable: boolean;
    memoryUsage: number;
  };
}
