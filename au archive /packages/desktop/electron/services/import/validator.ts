/**
 * Validator - Post-copy integrity verification (Step 4)
 *
 * v2.3 PROPERLY ARCHITECTED: Unified storage detection, retry, timeout
 *
 * Per Import Spec v2.0 + ADR-046:
 * - Parallel re-hash using WorkerPool
 * - Hash comparison (BLAKE3)
 * - Rollback on mismatch (auto-delete invalid files)
 * - Continue-on-error (don't abort batch)
 * - Progress reporting (80-95%)
 * - SMB-aware: throttled concurrency for network archives
 * - Retry with exponential backoff for network errors
 * - Per-file timeout to prevent hangs
 *
 * Integrity guarantee per NDSA/Library of Congress standards:
 * - Re-hash destination file after copy
 * - Compare against source hash
 * - Invalid files automatically removed
 *
 * ADR: ADR-046-smb-optimized-import
 *
 * @module services/import/validator
 */

import { promises as fs } from 'fs';
import PQueue from 'p-queue';
import type { CopiedFile } from './copier';
import { getWorkerPool, type WorkerPool, type HashResult } from '../worker-pool';
import { getHardwareProfile } from '../hardware-profile';
import { isNetworkPath, getStorageConfig } from './storage-detection';

/**
 * Validation result for a single file
 */
export interface ValidatedFile extends CopiedFile {
  isValid: boolean;
  validationError: string | null;
  retryCount?: number;
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
 * Validator options
 */
export interface ValidatorOptions {
  /**
   * Progress callback (80-95% range)
   */
  onProgress?: (percent: number, currentFile: string) => void;

  /**
   * Abort signal for cancellation
   */
  signal?: AbortSignal;

  /**
   * Whether to automatically rollback invalid files
   */
  autoRollback?: boolean;

  /**
   * FIX 6: Streaming callback - called after each file is validated
   * Allows incremental result persistence to avoid memory bloat
   */
  onFileComplete?: (file: ValidatedFile, index: number, total: number) => void | Promise<void>;
}

/**
 * Retry configuration for network operations
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  delays: [1000, 3000, 5000], // Exponential backoff
  retryableErrors: [
    'EAGAIN',      // Resource temporarily unavailable
    'ECONNRESET',  // Connection reset
    'ETIMEDOUT',   // Connection timed out
    'EBUSY',       // Resource busy
    'EIO',         // I/O error
    'ENETUNREACH', // Network unreachable
    'EPIPE',       // Broken pipe
    'timed out',   // Worker timeout
  ],
};

/**
 * Per-file validation timeout (ms)
 * Large files on slow networks need more time
 */
const VALIDATION_TIMEOUT_MS = 120000; // 2 minutes per file

/**
 * Validator class for integrity verification
 * v2.3: Unified storage detection, retry logic, per-file timeout
 */
export class Validator {
  private pool: WorkerPool | null = null;

  /**
   * Initialize the worker pool
   */
  async initialize(): Promise<void> {
    if (!this.pool) {
      this.pool = await getWorkerPool();
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: string): boolean {
    const lowerError = error.toLowerCase();
    return RETRY_CONFIG.retryableErrors.some(e => lowerError.includes(e.toLowerCase()));
  }

  /**
   * Hash a file with retry logic
   */
  private async hashWithRetry(
    filePath: string,
    maxRetries: number = RETRY_CONFIG.maxRetries
  ): Promise<{ result: HashResult; retryCount: number }> {
    let lastError: string | null = null;
    let retryCount = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Add timeout wrapper
      const timeoutPromise = new Promise<HashResult>((_, reject) => {
        setTimeout(() => reject(new Error('Validation timed out')), VALIDATION_TIMEOUT_MS);
      });

      try {
        const hashPromise = this.pool!.hash(filePath);
        const result = await Promise.race([hashPromise, timeoutPromise]);

        if (result.error && this.isRetryableError(result.error) && attempt < maxRetries) {
          // Retryable error - wait and try again
          lastError = result.error;
          retryCount++;
          const delay = RETRY_CONFIG.delays[attempt] || RETRY_CONFIG.delays[RETRY_CONFIG.delays.length - 1];
          console.log(`[Validator] Retryable error on ${filePath}, retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${result.error}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        return { result, retryCount };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (this.isRetryableError(errorMsg) && attempt < maxRetries) {
          lastError = errorMsg;
          retryCount++;
          const delay = RETRY_CONFIG.delays[attempt] || RETRY_CONFIG.delays[RETRY_CONFIG.delays.length - 1];
          console.log(`[Validator] Exception on ${filePath}, retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${errorMsg}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Non-retryable error or max retries exceeded
        return {
          result: { filePath, error: errorMsg },
          retryCount,
        };
      }
    }

    // Max retries exceeded
    return {
      result: { filePath, error: lastError || 'Max retries exceeded' },
      retryCount,
    };
  }

  /**
   * Validate all copied files by re-hashing and comparing
   * v2.3: Uses unified storage detection, retry, timeout
   */
  async validate(files: CopiedFile[], options?: ValidatorOptions): Promise<ValidationResult> {
    await this.initialize();

    const startTime = Date.now();

    // Filter files that were actually copied
    const filesToValidate = files.filter(f => f.archivePath !== null && !f.copyError);

    if (filesToValidate.length === 0) {
      // No files to validate - return early with skipped files
      const results: ValidatedFile[] = files.map(file => ({
        ...file,
        isValid: false,
        validationError: file.copyError || 'Not copied',
      }));

      return {
        files: results,
        totalValidated: 0,
        totalValid: 0,
        totalInvalid: 0,
        totalRolledBack: 0,
        totalRetried: 0,
        validationTimeMs: 0,
      };
    }

    // Detect if archive is on network using unified utility
    const isNetworkArchive = isNetworkPath(filesToValidate[0].archivePath!);
    const storageConfig = getStorageConfig(filesToValidate[0].archivePath!);
    const hw = getHardwareProfile();

    // SMB-aware concurrency: use network settings for SMB, full hash workers for local
    const concurrency = isNetworkArchive ? hw.copyWorkersNetwork : hw.hashWorkers;
    const queue = new PQueue({ concurrency });

    console.log(`[Validator] Starting validation: ${filesToValidate.length} files, ${concurrency} workers (network: ${isNetworkArchive}, buffer: ${storageConfig.bufferSize / 1024}KB)`);

    const totalFiles = filesToValidate.length;
    let validatedCount = 0;
    let validCount = 0;
    let invalidCount = 0;
    let rolledBackCount = 0;
    let totalRetried = 0;

    const results: ValidatedFile[] = [];

    // Queue ALL files for validation with controlled concurrency
    const validatePromises = filesToValidate.map((file) =>
      queue.add(async () => {
        // Check cancellation
        if (options?.signal?.aborted) {
          throw new Error('Validation cancelled');
        }

        // Hash the file with retry logic
        const { result: hashResult, retryCount } = await this.hashWithRetry(file.archivePath!);
        totalRetried += retryCount;

        const validatedFile: ValidatedFile = {
          ...file,
          isValid: false,
          validationError: null,
          retryCount,
        };

        if (hashResult.error) {
          validatedFile.validationError = `Re-hash failed: ${hashResult.error}`;
          invalidCount++;

          // Rollback if requested
          if (options?.autoRollback !== false) {
            await this.rollback(file.archivePath!);
            rolledBackCount++;
          }
        } else if (hashResult.hash !== file.hash) {
          validatedFile.validationError = `Hash mismatch: expected ${file.hash}, got ${hashResult.hash}`;
          invalidCount++;

          // Rollback invalid file
          if (options?.autoRollback !== false) {
            await this.rollback(file.archivePath!);
            rolledBackCount++;
          }
        } else {
          validatedFile.isValid = true;
          validCount++;
        }

        results.push(validatedFile);
        validatedCount++;

        // Log progress every 10 files or on errors (matches Copier pattern)
        if (validatedCount % 10 === 0 || validatedFile.validationError) {
          const pct = ((validatedCount / totalFiles) * 100).toFixed(1);
          const retryInfo = retryCount > 0 ? ` (${retryCount} retries)` : '';
          console.log(`[Validator] Progress: ${validatedCount}/${totalFiles} files (${pct}%)${retryInfo}${validatedFile.validationError ? ` ERROR: ${validatedFile.validationError}` : ''}`);
        }

        // Report progress (80-95% range)
        if (options?.onProgress && totalFiles > 0) {
          const percent = 80 + ((validatedCount / totalFiles) * 15);
          options.onProgress(percent, file.filename);
        }

        // Stream result to caller for incremental persistence
        if (options?.onFileComplete) {
          await options.onFileComplete(validatedFile, validatedCount - 1, totalFiles);
        }

        return validatedFile;
      })
    );

    // Wait for all validations to complete
    await Promise.all(validatePromises);

    // Add files that weren't copied (duplicates, errors) to results
    for (const file of files) {
      if (file.archivePath === null || file.copyError) {
        results.push({
          ...file,
          isValid: false,
          validationError: file.copyError || 'Not copied',
        });
      }
    }

    const validationTimeMs = Date.now() - startTime;

    console.log(`[Validator] Completed: ${validCount} valid, ${invalidCount} invalid, ${rolledBackCount} rolled back, ${totalRetried} retries in ${(validationTimeMs / 1000).toFixed(1)}s`);

    return {
      files: results,
      totalValidated: validatedCount,
      totalValid: validCount,
      totalInvalid: invalidCount,
      totalRolledBack: rolledBackCount,
      totalRetried,
      validationTimeMs,
    };
  }

  /**
   * Rollback a single file (delete from archive)
   */
  private async rollback(archivePath: string): Promise<void> {
    try {
      await fs.unlink(archivePath);
      console.log(`[Validator] Rolled back invalid file: ${archivePath}`);
    } catch (error) {
      console.warn(`[Validator] Failed to rollback file: ${archivePath}`, error);
    }
  }
}

/**
 * Create a Validator instance
 */
export function createValidator(): Validator {
  return new Validator();
}
