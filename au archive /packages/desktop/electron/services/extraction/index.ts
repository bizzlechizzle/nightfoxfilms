/**
 * Extraction Service Public API
 *
 * This module exports the complete extraction system for use in the Electron main process.
 *
 * Usage:
 *   import { getExtractionService, ExtractionInput } from './services/extraction';
 *
 *   const service = getExtractionService(db);
 *   await service.initialize();
 *
 *   const result = await service.extract({
 *     text: 'The factory was built in 1923...',
 *     sourceType: 'web_source',
 *     sourceId: 'ws-123',
 *   });
 *
 * @version 1.0
 */

// =============================================================================
// SERVICE
// =============================================================================

export {
  ExtractionService,
  getExtractionService,
  shutdownExtractionService,
} from './extraction-service';

export {
  ExtractionQueueService,
  getExtractionQueueService,
  shutdownExtractionQueueService,
} from './extraction-queue-service';

export type {
  QueueJob,
  ExtractionQueueConfig,
} from './extraction-queue-service';

export {
  AutoTaggerService,
  getAutoTaggerService,
} from './auto-tagger-service';

export type {
  LocationType,
  Era,
  LocationStatus,
  TagResult,
} from './auto-tagger-service';

// =============================================================================
// TYPES
// =============================================================================

export type {
  // Input/Output
  ExtractionInput,
  ExtractionResult,
  ExtractionOptions,
  BatchExtractionRequest,
  BatchExtractionResult,

  // Date types
  ExtractedDate,
  DatePrecision,
  DateCategory,

  // Entity types
  ExtractedPerson,
  PersonRole,
  ExtractedOrganization,
  OrganizationType,
  ExtractedLocation,
  LocationRefType,

  // Summary types
  ExtractedSummary,

  // Provider types
  ProviderConfig,
  ProviderSettings,
  ProviderStatus,
  ProviderType,

  // Agent types
  AgentConfig,
  AgentType,

  // Job types
  ExtractionJob,
  JobStatus,

  // Storage types
  StoredExtraction,
  StoredSummary,
  ExtractionStatus,
  EntityType,

  // Health
  HealthCheckResult,
} from './extraction-types';

// =============================================================================
// PROVIDERS
// =============================================================================

export { BaseExtractionProvider } from './providers/base-provider';
export { OllamaProvider } from './providers/ollama-provider';
export { SpacyProvider } from './providers/spacy-provider';

// =============================================================================
// AGENTS
// =============================================================================

export {
  // Legacy Prompts (deprecated)
  DATE_EXTRACTION_SYSTEM_PROMPT,
  DATE_EXTRACTION_PROMPT,
  SUMMARY_TITLE_SYSTEM_PROMPT,
  SUMMARY_TITLE_PROMPT,
  COMBINED_EXTRACTION_PROMPT,

  // Legacy Builders (deprecated - use versioned prompts)
  buildDateExtractionPrompt,
  buildSummaryTitlePrompt,
  buildCombinedPrompt,

  // Parsing
  parseStructuredResponse,
  validateExtractions,
  recalibrateConfidence,
} from './agents/prompt-templates';

// =============================================================================
// VERSIONED PROMPTS (NEW)
// =============================================================================

export {
  // Prompt Registry
  getPrompt,
  getOllamaPrompt,
  getAllVersions,
  getDefaultVersion,
  setDefaultVersion,
  getPromptMetadata,
  getActiveVersions,
  getAllPromptRegistries,
  getPromptsSummary,

  // Prompt Builders
  buildDateExtractionPrompt as buildVersionedDatePrompt,
  buildProfileExtractionPrompt,
  buildTLDRPrompt,
  buildCombinedPrompt as buildVersionedCombinedPrompt,
  buildConflictDetectionPrompt,

  // Prompt Constants
  DATE_EXTRACTION_PROMPTS,
  PROFILE_EXTRACTION_PROMPTS,
  TLDR_PROMPTS,
  COMBINED_EXTRACTION_PROMPTS,
  CONFLICT_DETECTION_PROMPTS,
} from './agents/versioned-prompts';

export type {
  PromptVersion,
  PromptType,
  DateExtractionPlaceholders,
  ProfileExtractionPlaceholders,
  TLDRPlaceholders,
  CombinedPlaceholders,
  ConflictDetectionPlaceholders,
} from './agents/versioned-prompts';

// =============================================================================
// PREPROCESSING SERVICE
// =============================================================================

export {
  PreprocessingService,
  getPreprocessingService,
  normalizeName,
  normalizeOrgName,
  getPrimarVerbCategory,
  isTimelineRelevant,
  hasStrongTimelineIndicators,
  formatDateWithContext,
} from './preprocessing-service';

// =============================================================================
// PREPROCESSING TYPES
// =============================================================================

export type {
  PreprocessingResult,
  PreprocessedSentence,
  ProfileCandidates,
  DocumentStats,
  VerbCategory,
  VerbMatch,
  EntityMatch,
  SentenceRelevancy,
  SpacyEntityType,
  PersonProfileCandidate,
  OrgProfileCandidate,
  PreprocessingOptions,
  PreprocessRequest,
  PreprocessResponse,
} from './preprocessing-types';

export {
  DEFAULT_PREPROCESSING_OPTIONS,
} from './preprocessing-types';

// =============================================================================
// PROFILE TYPES
// =============================================================================

export type {
  PersonProfile,
  CompanyProfile,
  PersonProfileInput,
  CompanyProfileInput,
  PersonRole as ProfilePersonRole,
  OrganizationType as ProfileOrgType,
  CompanyRelationship,
  ProfileStatus,
  SocialLinks,
  ProfileMergeResult,
  ProfileSearchOptions,
  CrossLocationRef,
  ProfileWithCrossRefs,
} from './profile-types';

// =============================================================================
// CONFLICT TYPES
// =============================================================================

export type {
  FactConflict,
  FactConflictInput,
  ConflictClaim,
  ConflictType,
  ConflictResolution,
  ConflictResolutionInput,
  ConflictDetectionResult,
  ConflictDetectionOptions,
  ConflictSummary,
  SourceAuthority,
  ExtractionInput as ExtractionInputRecord,
} from './conflict-types';

export {
  DEFAULT_CONFLICT_OPTIONS,
  DEFAULT_AUTHORITY_TIERS,
  getDefaultTier,
} from './conflict-types';
