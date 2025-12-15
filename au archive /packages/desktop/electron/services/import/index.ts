/**
 * Import System v2.0
 *
 * 5-step pipeline for file import:
 * 1. Scanner - File discovery and analysis
 * 2. Hasher - Parallel BLAKE3 hashing
 * 3. Copier - Atomic file copy (OPT-082: pure copy only)
 * 4. Validator - Post-copy integrity verification
 * 5. Finalizer - Database commit and job queue population
 *
 * @module services/import
 */

// Shared types - single source of truth
export type { LocationInfo, MediaType, BaseFileInfo } from './types';

export { Scanner, getScanner, type ScannedFile, type ScanResult, type ScannerOptions } from './scanner';
export { Hasher, createHasher, type HashedFile, type HashResult, type HasherOptions } from './hasher';
export { Copier, createCopier, type CopiedFile, type CopyResult, type CopyStrategy, type CopierOptions } from './copier';
export { Validator, createValidator, type ValidatedFile, type ValidationResult, type ValidatorOptions } from './validator';
export { Finalizer, createFinalizer, type FinalizedFile, type FinalizationResult, type FinalizerOptions } from './finalizer';
export {
  ImportOrchestrator,
  createImportOrchestrator,
  type ImportStatus,
  type ImportProgress,
  type ImportResult,
  type ImportOptions,
} from './orchestrator';

// Unified job builder - SINGLE SOURCE OF TRUTH for image processing jobs
export {
  queueImageProcessingJobs,
  queueLocationPostProcessing,
  queueImageBatchProcessing,
  needsProcessing,
  type ImageJobParams,
  type ImageJobResult,
  type LocationJobParams,
  type LocationJobResult,
  type ProcessingStatus,
} from './job-builder';
