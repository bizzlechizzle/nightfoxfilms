/**
 * Validator Service
 *
 * Post-copy integrity verification for wedding video imports.
 * Re-hashes destination files and compares against expected hash.
 *
 * Features:
 * - BLAKE3 re-hash of destination files
 * - Auto-rollback of invalid (mismatched) files
 * - Retry with exponential backoff for network errors
 * - Network abort threshold for sustained failures
 * - Per-file timeout (2 minutes)
 *
 * @module services/import/validator-service
 */

import { promises as fs } from 'fs';
import type {
  CopiedFile,
  ValidatedFile,
  ValidationResult,
  RetryConfig,
} from './types';
import {
  DEFAULT_RETRY_CONFIG,
  NETWORK_ABORT_THRESHOLD,
  TIMEOUTS,
} from './types';
import { isNetworkPath, getStorageConfig } from './storage-detection';
import { calculateHash } from '../hash-service';
import { NetworkFailureError } from './copy-service';

/**
 * Validator options
 */
export interface ValidatorOptions {
  /** Progress callback */
  onProgress?: (current: number, total: number, currentFile: string) => void;
  /** Callback after each file validates */
  onFileComplete?: (file: ValidatedFile, index: number, total: number) => void | Promise<void>;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Whether to auto-delete invalid files (default: true) */
  autoRollback?: boolean;
  /** Override retry config */
  retryConfig?: RetryConfig;
}

/**
 * Check if an error code indicates a retryable network error
 */
function isRetryableError(errorMessage: string): boolean {
  if (!errorMessage) return false;
  const upper = errorMessage.toUpperCase();
  return DEFAULT_RETRY_CONFIG.retryableErrors.some(code => upper.includes(code));
}

/**
 * Validator Service class
 *
 * Verifies copied files by re-hashing and comparing to expected hash.
 */
export class ValidatorService {
  private consecutiveErrors: number = 0;
  private lastError: string = '';

  /**
   * Hash a file with retry logic and timeout
   */
  private async hashWithRetry(
    filePath: string,
    retryConfig: RetryConfig
  ): Promise<{ hash: string | null; error: string | null; retryCount: number }> {
    let lastError: string | null = null;
    let retryCount = 0;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        // Create timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Validation timed out')), TIMEOUTS.VALIDATION_TIMEOUT_MS);
        });

        // Race hash against timeout
        const hashPromise = calculateHash(filePath);
        const result = await Promise.race([hashPromise, timeoutPromise]);

        // Success
        return { hash: result.hash, error: null, retryCount };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (isRetryableError(errorMsg) && attempt < retryConfig.maxRetries) {
          // Retryable error - wait and try again
          lastError = errorMsg;
          retryCount++;
          const delay = retryConfig.delays[attempt] || retryConfig.delays[retryConfig.delays.length - 1];
          console.log(`[Validator] Retryable error on ${filePath}, retry ${attempt + 1}/${retryConfig.maxRetries} after ${delay}ms: ${errorMsg}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Non-retryable or max retries exceeded
        return { hash: null, error: errorMsg, retryCount };
      }
    }

    // Max retries exceeded
    return { hash: null, error: lastError || 'Max retries exceeded', retryCount };
  }

  /**
   * Validate a single copied file
   */
  async validateFile(
    file: CopiedFile,
    options?: ValidatorOptions
  ): Promise<ValidatedFile> {
    const retryConfig = options?.retryConfig || DEFAULT_RETRY_CONFIG;
    const autoRollback = options?.autoRollback !== false;

    const result: ValidatedFile = {
      ...file,
      isValid: false,
      validationError: null,
    };

    // Skip files that weren't copied
    if (!file.archivePath || file.copyError) {
      result.validationError = file.copyError || 'Not copied';
      return result;
    }

    // Check cancellation
    if (options?.signal?.aborted) {
      result.validationError = 'Cancelled';
      return result;
    }

    // Hash the destination file
    const { hash, error, retryCount } = await this.hashWithRetry(file.archivePath, retryConfig);

    if (error) {
      result.validationError = `Re-hash failed: ${error}`;

      // Track consecutive network errors
      if (isRetryableError(error)) {
        this.consecutiveErrors++;
        this.lastError = error;
        console.log(`[Validator] Network error #${this.consecutiveErrors}: ${error}`);

        if (this.consecutiveErrors >= NETWORK_ABORT_THRESHOLD) {
          throw new NetworkFailureError(
            `Network appears down - ${this.consecutiveErrors} consecutive errors. Last: ${this.lastError}`,
            this.consecutiveErrors,
            this.lastError
          );
        }
      }

      // Rollback on error if requested
      if (autoRollback) {
        await this.rollback(file.archivePath);
      }

      return result;
    }

    // Compare hashes
    if (hash !== file.hash) {
      result.validationError = `Hash mismatch: expected ${file.hash}, got ${hash}`;

      // Hash mismatch is data corruption, not network - reset counter
      this.consecutiveErrors = 0;

      // Rollback invalid file
      if (autoRollback) {
        await this.rollback(file.archivePath);
      }

      return result;
    }

    // Valid file - reset error counter
    this.consecutiveErrors = 0;
    result.isValid = true;

    return result;
  }

  /**
   * Validate multiple copied files
   */
  async validateFiles(
    files: CopiedFile[],
    options?: ValidatorOptions
  ): Promise<ValidationResult> {
    const startTime = Date.now();
    const results: ValidatedFile[] = [];

    // Reset error tracking
    this.consecutiveErrors = 0;
    this.lastError = '';

    // Filter to files that were actually copied
    const filesToValidate = files.filter(f => f.archivePath && !f.copyError);

    if (filesToValidate.length === 0) {
      // No files to validate
      const skippedResults: ValidatedFile[] = files.map(file => ({
        ...file,
        isValid: false,
        validationError: file.copyError || 'Not copied',
      }));

      return {
        files: skippedResults,
        totalValidated: 0,
        totalValid: 0,
        totalInvalid: 0,
        totalRolledBack: 0,
        totalRetried: 0,
        validationTimeMs: 0,
      };
    }

    // Detect if archive is on network for logging
    const isNetworkArchive = isNetworkPath(filesToValidate[0].archivePath!);

    console.log(`[Validator] Starting validation: ${filesToValidate.length} files (network: ${isNetworkArchive})`);

    let validCount = 0;
    let invalidCount = 0;
    let rolledBackCount = 0;
    let totalRetried = 0;

    // Validate files sequentially (network-safe)
    for (let i = 0; i < filesToValidate.length; i++) {
      const file = filesToValidate[i];

      // Check cancellation
      if (options?.signal?.aborted) {
        // Mark remaining as cancelled
        for (let j = i; j < filesToValidate.length; j++) {
          results.push({
            ...filesToValidate[j],
            isValid: false,
            validationError: 'Cancelled',
          });
        }
        break;
      }

      // Progress callback
      if (options?.onProgress) {
        options.onProgress(i + 1, filesToValidate.length, file.filename);
      }

      try {
        const validated = await this.validateFile(file, options);
        results.push(validated);

        if (validated.isValid) {
          validCount++;
        } else {
          invalidCount++;
          if (validated.validationError?.includes('Hash mismatch') || validated.validationError?.includes('Re-hash failed')) {
            if (options?.autoRollback !== false) {
              rolledBackCount++;
            }
          }
        }

        // Per-file callback
        if (options?.onFileComplete) {
          await options.onFileComplete(validated, i, filesToValidate.length);
        }

      } catch (error) {
        // NetworkFailureError - re-throw for orchestrator to handle
        if (error instanceof NetworkFailureError) {
          throw error;
        }

        // Other error - mark file as invalid
        results.push({
          ...file,
          isValid: false,
          validationError: error instanceof Error ? error.message : String(error),
        });
        invalidCount++;
      }
    }

    // Add files that weren't copied to results
    for (const file of files) {
      if (!file.archivePath || file.copyError) {
        results.push({
          ...file,
          isValid: false,
          validationError: file.copyError || 'Not copied',
        });
      }
    }

    const validationTimeMs = Date.now() - startTime;

    console.log(`[Validator] Completed: ${validCount} valid, ${invalidCount} invalid, ${rolledBackCount} rolled back in ${(validationTimeMs / 1000).toFixed(1)}s`);

    return {
      files: results,
      totalValidated: results.filter(f => f.archivePath && !f.copyError).length,
      totalValid: validCount,
      totalInvalid: invalidCount,
      totalRolledBack: rolledBackCount,
      totalRetried: totalRetried,
      validationTimeMs,
    };
  }

  /**
   * Rollback a file (delete from archive)
   */
  private async rollback(archivePath: string): Promise<void> {
    try {
      await fs.unlink(archivePath);
      console.log(`[Validator] Rolled back: ${archivePath}`);
    } catch (error) {
      console.warn(`[Validator] Failed to rollback: ${archivePath}`, error);
    }
  }
}

/**
 * Create a ValidatorService instance
 */
export function createValidatorService(): ValidatorService {
  return new ValidatorService();
}
