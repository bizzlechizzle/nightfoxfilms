/**
 * Import Pipeline Types
 *
 * Shared type definitions for the network-safe import system.
 * Used by storage-detection, copy-service, validator-service, and orchestrator.
 *
 * @module services/import/types
 */

import type { FileType, Medium, FootageType } from '@nightfox/core';

/**
 * Storage type classification
 */
export type StorageType = 'local' | 'network';

/**
 * I/O configuration for different storage types
 */
export interface StorageConfig {
  /** Storage classification */
  type: StorageType;
  /** Recommended buffer size for streams (bytes) */
  bufferSize: number;
  /** Recommended concurrency for parallel operations */
  concurrency: number;
  /** Delay between sequential operations (ms) */
  operationDelayMs: number;
  /** Human-readable description */
  description: string;
}

/**
 * Import session status
 */
export type ImportStatus =
  | 'pending'
  | 'scanning'
  | 'hashing'
  | 'copying'
  | 'validating'
  | 'finalizing'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'paused'; // Network failure - resumable

/**
 * Base file info from scanner (Step 1)
 */
export interface ScannedFile {
  /** Unique ID for tracking through pipeline */
  id: string;
  /** Original filename */
  filename: string;
  /** Original full path */
  originalPath: string;
  /** File extension (without dot) */
  extension: string;
  /** File size in bytes */
  size: number;
  /** Detected file type */
  fileType: FileType;
}

/**
 * File with hash (Step 2)
 * Hash may be null for network sources (computed during copy)
 */
export interface HashedFile extends ScannedFile {
  /** BLAKE3 hash (16 lowercase hex chars) or null if pending */
  hash: string | null;
  /** Hash computation error if failed */
  hashError: string | null;
  /** Whether file is duplicate of existing */
  isDuplicate: boolean;
  /** Table where duplicate exists (if isDuplicate) */
  duplicateIn: string | null;
}

/**
 * File after copy (Step 3)
 */
export interface CopiedFile extends HashedFile {
  /** Path in managed storage (null if copy failed or skipped) */
  archivePath: string | null;
  /** Copy error message if failed */
  copyError: string | null;
  /** Number of retry attempts */
  retryCount: number;
  /** Detected medium from metadata */
  medium: Medium;
  /** Camera ID if matched */
  cameraId: number | null;
  /** Camera slug for folder naming */
  cameraSlug: string | null;
}

/**
 * File after validation (Step 4)
 */
export interface ValidatedFile extends CopiedFile {
  /** Whether hash verification passed */
  isValid: boolean;
  /** Validation error message if failed */
  validationError: string | null;
}

/**
 * File after finalization (Step 5)
 */
export interface FinalizedFile extends ValidatedFile {
  /** Database record ID */
  dbRecordId: number | null;
  /** Footage type determined from recording date */
  footageType: FootageType;
  /** Detected camera make from metadata */
  detectedMake: string | null;
  /** Detected camera model from metadata */
  detectedModel: string | null;
  /** Recording timestamp */
  recordedAt: string | null;
}

/**
 * Scan result summary
 */
export interface ScanResult {
  files: ScannedFile[];
  totalFiles: number;
  totalBytes: number;
  videoFiles: number;
  sidecarFiles: number;
  audioFiles: number;
}

/**
 * Hash result summary
 */
export interface HashResult {
  files: HashedFile[];
  totalHashed: number;
  totalDuplicates: number;
  totalErrors: number;
  hashingTimeMs: number;
}

/**
 * Copy result summary
 */
export interface CopyResult {
  files: CopiedFile[];
  totalCopied: number;
  totalBytes: number;
  totalErrors: number;
  totalRetried: number;
  copyTimeMs: number;
  /** Copy strategy used */
  strategy: 'parallel' | 'sequential';
}

/**
 * Validation result summary
 */
export interface ValidationResult {
  files: ValidatedFile[];
  totalValidated: number;
  totalValid: number;
  totalInvalid: number;
  totalRolledBack: number;
  totalRetried: number;
  validationTimeMs: number;
}

/**
 * Finalization result summary
 */
export interface FinalizationResult {
  files: FinalizedFile[];
  totalFinalized: number;
  totalErrors: number;
  finalizeTimeMs: number;
}

/**
 * Import progress event
 */
export interface ImportProgress {
  sessionId: string;
  status: ImportStatus;
  step: number;
  totalSteps: number;
  percent: number;
  currentFile: string;
  filesProcessed: number;
  filesTotal: number;
  bytesProcessed: number;
  bytesTotal: number;
  duplicatesFound: number;
  errorsFound: number;
}

/**
 * Import session (stored in database)
 */
export interface ImportSession {
  sessionId: string;
  coupleId: number | null;
  status: ImportStatus;
  lastStep: number;
  canResume: boolean;
  sourcePaths: string[];
  archivePath: string | null;
  totalFiles: number;
  processedFiles: number;
  duplicateFiles: number;
  errorFiles: number;
  totalBytes: number;
  processedBytes: number;
  scanResult: ScanResult | null;
  hashResults: HashResult | null;
  copyResults: CopyResult | null;
  validationResults: ValidationResult | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

/**
 * Import options
 */
export interface ImportOptions {
  /** Couple ID to associate files with */
  coupleId?: number | null;
  /** Whether to copy files to managed storage (default: true) */
  copyToManaged?: boolean;
  /** Base path for managed storage */
  managedStoragePath?: string;
  /** Progress callback */
  onProgress?: (progress: ImportProgress) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Complete import result
 */
export interface ImportResult {
  sessionId: string;
  status: ImportStatus;
  scanResult?: ScanResult;
  hashResult?: HashResult;
  copyResult?: CopyResult;
  validationResult?: ValidationResult;
  finalizationResult?: FinalizationResult;
  error?: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs: number;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  delays: number[];
  retryableErrors: string[];
}

/**
 * Default retry configuration for network operations
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  delays: [1000, 3000, 5000], // Exponential backoff
  retryableErrors: [
    'EAGAIN',       // Resource temporarily unavailable
    'ECONNRESET',   // Connection reset
    'ETIMEDOUT',    // Connection timed out
    'EBUSY',        // Resource busy
    'EIO',          // I/O error
    'ENETUNREACH',  // Network unreachable
    'EPIPE',        // Broken pipe
    'ENOTCONN',     // Socket not connected (SMB disconnect)
    'EHOSTDOWN',    // Host is down
    'EHOSTUNREACH', // No route to host
    'ENETDOWN',     // Network is down
    'ECONNABORTED', // Connection aborted
    'ESTALE',       // Stale file handle (NFS)
  ],
};

/**
 * Timeout constants
 */
export const TIMEOUTS = {
  /** Per-file copy timeout (ms) */
  COPY_TIMEOUT_MS: 300000, // 5 minutes
  /** Per-file validation timeout (ms) */
  VALIDATION_TIMEOUT_MS: 120000, // 2 minutes
};

/**
 * Network abort threshold - abort after this many consecutive network errors
 */
export const NETWORK_ABORT_THRESHOLD = 5;
