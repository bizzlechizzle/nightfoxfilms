/**
 * Copy Service
 *
 * Network-safe file copy with verification for wedding video imports.
 * Mirrors au archive's proven patterns adapted for wedding film workflow.
 *
 * Features:
 * - Atomic temp-then-rename for crash safety
 * - Inline BLAKE3 hashing for network sources (single read)
 * - Exponential backoff retry for transient errors
 * - Network abort threshold for sustained failures
 * - 1MB buffer for SMB efficiency
 * - Progress callbacks per-file
 *
 * Folder organization:
 * {working_path}/{couple.folder_name}/source/{medium}/{camera}/{hash}.{ext}
 *
 * @module services/import/copy-service
 */

import { promises as fs, createReadStream, createWriteStream, statSync } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import { createHash as createBlake3Hash } from 'blake3';
import type {
  CopiedFile,
  HashedFile,
  CopyResult,
  StorageConfig,
  RetryConfig,
} from './types';
import {
  DEFAULT_RETRY_CONFIG,
  NETWORK_ABORT_THRESHOLD,
} from './types';
import { isNetworkPath, getStorageConfig } from './storage-detection';

/**
 * BLAKE3 hash length (16 hex chars = 64 bits)
 */
const HASH_LENGTH = 16;

/**
 * Network failure error - allows orchestrator to pause (resumable) vs fail
 */
export class NetworkFailureError extends Error {
  constructor(
    message: string,
    public readonly consecutiveErrors: number,
    public readonly lastError: string
  ) {
    super(message);
    this.name = 'NetworkFailureError';
  }
}

/**
 * Check if an error code indicates a network failure
 */
function isNetworkError(errorCode: string | undefined): boolean {
  if (!errorCode) return false;
  return DEFAULT_RETRY_CONFIG.retryableErrors.includes(errorCode);
}

/**
 * Generate unique ID for temp files
 */
function generateTempId(): string {
  return `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Copy options
 */
export interface CopyOptions {
  /** Progress callback */
  onProgress?: (current: number, total: number, currentFile: string) => void;
  /** Callback after each file completes */
  onFileComplete?: (file: CopiedFile, index: number, total: number) => void | Promise<void>;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Override retry config */
  retryConfig?: RetryConfig;
}

/**
 * Wedding couple info for path construction
 */
export interface CouplePathInfo {
  /** Couple's working path base */
  workingPath: string;
  /** Couple's folder name (e.g., "2025-12-31-julia-sven") */
  folderName: string;
}

/**
 * Copy Service class
 *
 * Handles copying files to managed storage with network safety protocols.
 */
export class CopyService {
  private readonly config: StorageConfig;
  private readonly isNetworkSource: boolean;
  private consecutiveErrors: number = 0;
  private lastError: string = '';

  constructor(
    private readonly coupleInfo: CouplePathInfo,
    sourcePath?: string
  ) {
    // Detect if source is network to enable appropriate settings
    this.isNetworkSource = sourcePath ? isNetworkPath(sourcePath) : false;
    this.config = this.isNetworkSource
      ? getStorageConfig(sourcePath!)
      : getStorageConfig(coupleInfo.workingPath);

    console.log(`[CopyService] Initialized: source=${this.isNetworkSource ? 'network' : 'local'}, buffer=${this.config.bufferSize}B, concurrency=${this.config.concurrency}`);
  }

  /**
   * Build destination path for a file
   *
   * Format: {workingPath}/{folderName}/source/{medium}/{cameraSlug}/{hash}.{ext}
   */
  buildDestinationPath(
    file: HashedFile,
    hash: string,
    medium: string,
    cameraSlug: string | null
  ): string {
    const camera = cameraSlug || 'unknown';
    const filename = `${hash}.${file.extension}`;

    return path.join(
      this.coupleInfo.workingPath,
      this.coupleInfo.folderName,
      'source',
      medium,
      camera,
      filename
    );
  }

  /**
   * Copy a single file with inline hashing (network-safe)
   *
   * Streams file through BLAKE3 hasher while writing to destination.
   * Single read from source - critical for network performance.
   */
  private async copyFileStreaming(
    sourcePath: string,
    tempPath: string
  ): Promise<{ hash: string; bytesCopied: number }> {
    const hasher = createBlake3Hash();
    let bytesCopied = 0;

    // Use storage-appropriate buffer size
    const bufferSize = this.config.bufferSize;

    const source = createReadStream(sourcePath, { highWaterMark: bufferSize });
    const dest = createWriteStream(tempPath, { highWaterMark: bufferSize });

    // Hash bytes as they stream through
    source.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hasher.update(buf);
      bytesCopied += buf.length;
    });

    // Use pipeline for proper backpressure handling
    await pipeline(source, dest);

    // Get hash (truncated to 16 hex chars)
    const hash = hasher.digest('hex').substring(0, HASH_LENGTH);
    return { hash, bytesCopied };
  }

  /**
   * Copy a single file with retry logic
   */
  async copyFile(
    file: HashedFile,
    medium: string,
    cameraSlug: string | null,
    options?: CopyOptions
  ): Promise<CopiedFile> {
    const retryConfig = options?.retryConfig || DEFAULT_RETRY_CONFIG;

    const result: CopiedFile = {
      ...file,
      archivePath: null,
      copyError: null,
      retryCount: 0,
      medium: medium as any,
      cameraId: null,
      cameraSlug,
    };

    // Skip if already errored or is duplicate
    if (file.hashError || file.isDuplicate) {
      result.copyError = file.hashError || 'Duplicate';
      return result;
    }

    // Inline hashing mode: hash is null, compute during copy
    const useInlineHash = file.hash === null;

    // Create temp directory path
    const tempDir = path.join(
      this.coupleInfo.workingPath,
      this.coupleInfo.folderName,
      'source'
    );
    await fs.mkdir(tempDir, { recursive: true }).catch(() => {});
    const tempPath = path.join(tempDir, `${generateTempId()}.tmp`);

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        // Check cancellation
        if (options?.signal?.aborted) {
          result.copyError = 'Cancelled';
          return result;
        }

        let finalHash: string;
        let bytesCopied: number;

        if (useInlineHash) {
          // INLINE HASH MODE: Stream copy with hash computation (single read)
          const streamResult = await this.copyFileStreaming(file.originalPath, tempPath);
          finalHash = streamResult.hash;
          bytesCopied = streamResult.bytesCopied;
        } else {
          // PRE-HASHED MODE: Simple copy (hash already computed)
          await fs.copyFile(file.originalPath, tempPath);
          finalHash = file.hash!;
          bytesCopied = file.size;
        }

        // Build final destination path with the hash
        const destPath = this.buildDestinationPath(file, finalHash, medium, cameraSlug);

        // Ensure destination directory exists
        await fs.mkdir(path.dirname(destPath), { recursive: true }).catch(() => {});

        // Atomic rename from temp to final
        await fs.rename(tempPath, destPath);

        // Success - reset error counter and return
        this.consecutiveErrors = 0;
        result.hash = finalHash;
        result.archivePath = destPath;
        result.retryCount = attempt;

        return result;

      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        const errorCode = nodeError.code;
        const isRetryable = isNetworkError(errorCode);

        result.retryCount = attempt;

        if (isRetryable && attempt < retryConfig.maxRetries) {
          // Log retry
          const delay = retryConfig.delays[attempt] || retryConfig.delays[retryConfig.delays.length - 1];
          console.log(`[CopyService] Network error ${errorCode} on ${file.filename}, retry ${attempt + 1}/${retryConfig.maxRetries} after ${delay}ms`);

          // Clean up partial temp file
          await fs.unlink(tempPath).catch(() => {});

          // Wait with exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Non-retryable or max retries exceeded
        await fs.unlink(tempPath).catch(() => {});
        result.copyError = nodeError.message || String(error);

        // Track consecutive network errors
        if (isNetworkError(errorCode)) {
          this.consecutiveErrors++;
          this.lastError = result.copyError;

          if (this.consecutiveErrors >= NETWORK_ABORT_THRESHOLD) {
            throw new NetworkFailureError(
              `Network appears down - ${this.consecutiveErrors} consecutive errors. Last: ${this.lastError}`,
              this.consecutiveErrors,
              this.lastError
            );
          }
        }

        return result;
      }
    }

    return result;
  }

  /**
   * Copy multiple files with progress tracking
   */
  async copyFiles(
    files: HashedFile[],
    getMediumAndCamera: (file: HashedFile) => { medium: string; cameraSlug: string | null },
    options?: CopyOptions
  ): Promise<CopyResult> {
    const startTime = Date.now();
    const results: CopiedFile[] = [];

    // Filter out duplicates and errored files
    const filesToCopy = files.filter(f => !f.isDuplicate && !f.hashError);

    if (filesToCopy.length === 0) {
      // Handle skipped files
      const skippedResults: CopiedFile[] = files.map(file => ({
        ...file,
        archivePath: null,
        copyError: file.isDuplicate ? 'Duplicate' : file.hashError || 'Skipped',
        retryCount: 0,
        medium: 'modern' as const,
        cameraId: null,
        cameraSlug: null,
      }));

      return {
        files: skippedResults,
        totalCopied: 0,
        totalBytes: 0,
        totalErrors: 0,
        totalRetried: 0,
        copyTimeMs: 0,
        strategy: 'sequential',
      };
    }

    // Pre-create all destination directories
    await this.ensureDirectoriesBatch(filesToCopy, getMediumAndCamera);

    const totalBytes = filesToCopy.reduce((sum, f) => sum + f.size, 0);
    let bytesCopied = 0;
    let totalCopied = 0;
    let totalErrors = 0;
    let totalRetried = 0;

    console.log(`[CopyService] Starting copy: ${filesToCopy.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB, ${this.config.type} mode`);

    // Copy files sequentially (network-safe) or with controlled concurrency (local)
    // For simplicity, using sequential for now - can add p-queue later for local
    for (let i = 0; i < filesToCopy.length; i++) {
      const file = filesToCopy[i];
      const { medium, cameraSlug } = getMediumAndCamera(file);

      // Check cancellation
      if (options?.signal?.aborted) {
        // Mark remaining as cancelled
        for (let j = i; j < filesToCopy.length; j++) {
          results.push({
            ...filesToCopy[j],
            archivePath: null,
            copyError: 'Cancelled',
            retryCount: 0,
            medium: medium as any,
            cameraId: null,
            cameraSlug,
          });
        }
        break;
      }

      // Inter-operation delay for network stability
      if (this.config.operationDelayMs > 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, this.config.operationDelayMs));
      }

      // Progress callback
      if (options?.onProgress) {
        options.onProgress(i + 1, filesToCopy.length, file.filename);
      }

      // Copy the file
      const result = await this.copyFile(file, medium, cameraSlug, options);
      results.push(result);

      // Update counters
      if (result.copyError) {
        totalErrors++;
      } else {
        totalCopied++;
        bytesCopied += file.size;
      }
      if (result.retryCount > 0) {
        totalRetried++;
      }

      // Per-file callback
      if (options?.onFileComplete) {
        await options.onFileComplete(result, i, filesToCopy.length);
      }
    }

    // Add skipped files to results
    for (const file of files) {
      if (file.isDuplicate || file.hashError) {
        const { medium, cameraSlug } = getMediumAndCamera(file);
        results.push({
          ...file,
          archivePath: null,
          copyError: file.isDuplicate ? 'Duplicate' : file.hashError || 'Skipped',
          retryCount: 0,
          medium: medium as any,
          cameraId: null,
          cameraSlug,
        });
      }
    }

    const copyTimeMs = Date.now() - startTime;

    console.log(`[CopyService] Completed: ${totalCopied}/${filesToCopy.length} files, ${(bytesCopied / 1024 / 1024).toFixed(1)} MB in ${(copyTimeMs / 1000).toFixed(1)}s (${totalErrors} errors, ${totalRetried} retried)`);

    return {
      files: results,
      totalCopied,
      totalBytes: bytesCopied,
      totalErrors,
      totalRetried,
      copyTimeMs,
      strategy: this.config.concurrency === 1 ? 'sequential' : 'parallel',
    };
  }

  /**
   * Pre-create all destination directories
   */
  private async ensureDirectoriesBatch(
    files: HashedFile[],
    getMediumAndCamera: (file: HashedFile) => { medium: string; cameraSlug: string | null }
  ): Promise<void> {
    const dirs = new Set<string>();

    for (const file of files) {
      const { medium, cameraSlug } = getMediumAndCamera(file);
      const dirPath = path.join(
        this.coupleInfo.workingPath,
        this.coupleInfo.folderName,
        'source',
        medium,
        cameraSlug || 'unknown'
      );
      dirs.add(dirPath);
    }

    const dirList = Array.from(dirs);
    console.log(`[CopyService] Creating ${dirList.length} directories`);

    if (this.isNetworkSource) {
      // Network: sequential to avoid SMB overwhelm
      for (const dir of dirList) {
        await fs.mkdir(dir, { recursive: true }).catch(() => {});
      }
    } else {
      // Local: parallel is fine
      await Promise.all(dirList.map(dir =>
        fs.mkdir(dir, { recursive: true }).catch(() => {})
      ));
    }
  }

  /**
   * Rollback a copied file (delete from archive)
   */
  async rollback(archivePath: string): Promise<void> {
    try {
      await fs.unlink(archivePath);
      console.log(`[CopyService] Rolled back: ${archivePath}`);
    } catch {
      // Ignore errors during rollback
    }
  }
}

/**
 * Create a CopyService instance
 */
export function createCopyService(
  coupleInfo: CouplePathInfo,
  sourcePath?: string
): CopyService {
  return new CopyService(coupleInfo, sourcePath);
}
