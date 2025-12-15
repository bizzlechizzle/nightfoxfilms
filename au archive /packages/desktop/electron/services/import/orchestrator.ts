/**
 * ImportOrchestrator - 5-step pipeline coordinator
 *
 * v2.2 SMB-OPTIMIZED: Network-aware import pipeline
 *
 * Per Import Spec v2.0 + ADR-046:
 * - Step coordination (1→2→3→4→5)
 * - Network source detection (SMB/NFS)
 * - Inline hashing for network sources (skip Step 2)
 * - Post-copy duplicate detection
 * - Weighted progress calculation
 * - Cancellation support
 * - Crash recovery (resume incomplete imports)
 * - Error aggregation and reporting
 * - IPC event emission
 *
 * Network Source Flow:
 *   1. Scan → 2. SKIP → 3. Copy+Hash → 4. Validate → 5. Finalize
 *
 * Local Source Flow:
 *   1. Scan → 2. Hash → 3. Copy → 4. Validate → 5. Finalize
 *
 * ADR: ADR-046-smb-optimized-import
 *
 * @module services/import/orchestrator
 */

import { generateId } from '../../main/ipc-validation';
import { promises as fs } from 'fs';
import type { Kysely } from 'kysely';
import type { Database } from '../../main/database.types';
import { Scanner, type ScanResult, type ScannerOptions } from './scanner';
import { Hasher, type HashResult, type HasherOptions } from './hasher';
import { Copier, type CopyResult, type CopierOptions, type LocationInfo, type CopiedFile } from './copier';
import { Validator, type ValidationResult, type ValidatorOptions } from './validator';
import { Finalizer, type FinalizationResult, type FinalizerOptions } from './finalizer';
import { getLogger } from '../logger-service';
import { getMetricsCollector, MetricNames } from '../monitoring/metrics-collector';
import { getTracer, OperationNames } from '../monitoring/tracer';
import { acquireLocationLock, releaseLocationLock } from './location-lock';
import { isNetworkPath, getStorageConfig, type StorageConfig } from './storage-detection';

const logger = getLogger();
const metrics = getMetricsCollector();
const tracer = getTracer();

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
  | 'failed';

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
  estimatedRemainingMs: number;
}

/**
 * Import result
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
  startedAt: string;  // ISO string for IPC serialization
  completedAt?: string;  // ISO string for IPC serialization
  totalDurationMs: number;
}

/**
 * Import options
 */
export interface ImportOptions {
  /**
   * Location to import into
   */
  location: LocationInfo;

  /**
   * Archive base path
   */
  archivePath: string;

  /**
   * User info for activity tracking
   */
  user?: {
    userId: string;
    username: string;
  };

  /**
   * Progress callback
   */
  onProgress?: (progress: ImportProgress) => void;

  /**
   * Abort signal for cancellation
   */
  signal?: AbortSignal;
}

/**
 * Step weights for progress calculation
 * Total: 100%
 */
const STEP_WEIGHTS = {
  scan: 5,      // 0-5%
  hash: 35,     // 5-40%
  copy: 40,     // 40-80%
  validate: 15, // 80-95%
  finalize: 5,  // 95-100%
} as const;

/**
 * Import orchestrator for coordinating the 5-step pipeline
 */
export class ImportOrchestrator {
  private scanner: Scanner;
  private hasher: Hasher;
  private copier: Copier;
  private validator: Validator;
  private finalizer: Finalizer;

  // Current import state
  private currentSessionId: string | null = null;
  private currentStatus: ImportStatus = 'pending';
  private abortController: AbortController | null = null;

  constructor(
    private readonly db: Kysely<Database>,
    archivePath: string
  ) {
    this.scanner = new Scanner();
    this.hasher = new Hasher(db);
    this.copier = new Copier(archivePath);
    this.validator = new Validator();
    this.finalizer = new Finalizer(db);
  }

  /**
   * Detect if source paths are on network storage (SMB/NFS)
   * Uses unified storage-detection utility
   */
  private detectNetworkSource(paths: string[]): boolean {
    if (paths.length === 0) return false;
    return isNetworkPath(paths[0]);
  }

  /**
   * Get storage configuration for source paths
   * Returns I/O settings (buffer size, concurrency, delays)
   */
  private getSourceStorageConfig(paths: string[]): StorageConfig {
    if (paths.length === 0) {
      return getStorageConfig('/'); // Default to local
    }
    return getStorageConfig(paths[0]);
  }

  /**
   * Start a new import
   */
  async import(paths: string[], options: ImportOptions): Promise<ImportResult> {
    const sessionId = generateId();
    const startedAt = new Date();
    this.currentSessionId = sessionId;
    this.abortController = new AbortController();

    // Acquire location lock to prevent concurrent imports to same location
    // This serializes imports to the same location, preventing race conditions
    const locid = options.location.locid;
    try {
      await acquireLocationLock(locid, sessionId, {
        waitIfLocked: false,
        user: options.user?.username,
      });
    } catch (lockError) {
      // Lock acquisition failed - location is already being imported to
      logger.warn('ImportOrchestrator', 'Failed to acquire location lock', {
        sessionId,
        locationId: locid,
        error: lockError instanceof Error ? lockError.message : String(lockError),
      });
      return {
        sessionId,
        status: 'failed',
        error: lockError instanceof Error ? lockError.message : 'Location is currently being imported to',
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        totalDurationMs: Date.now() - startedAt.getTime(),
      };
    }

    // Start import session trace
    const importSpan = tracer.startSpan(OperationNames.IMPORT_SESSION, {
      sessionId,
      locationId: locid,
      pathCount: paths.length,
    });

    // Record import started
    logger.info('ImportOrchestrator', 'Import started', {
      sessionId,
      locationId: locid,
      pathCount: paths.length,
    });
    metrics.incrementCounter(MetricNames.IMPORT_STARTED, 1, { locationId: locid });

    // Merge signals
    const signal = options.signal
      ? this.mergeAbortSignals(options.signal, this.abortController.signal)
      : this.abortController.signal;

    let scanResult: ScanResult | undefined;
    let hashResult: HashResult | undefined;
    let copyResult: CopyResult | undefined;
    let validationResult: ValidationResult | undefined;
    let finalizationResult: FinalizationResult | undefined;
    let error: string | undefined;

    const progress: ImportProgress = {
      sessionId,
      status: 'pending',
      step: 0,
      totalSteps: 5,
      percent: 0,
      currentFile: '',
      filesProcessed: 0,
      filesTotal: 0,
      bytesProcessed: 0,
      bytesTotal: 0,
      duplicatesFound: 0,
      errorsFound: 0,
      estimatedRemainingMs: 0,
    };

    const emitProgress = () => {
      options.onProgress?.({ ...progress });
    };

    // Timers for each step
    let scanTimer: ReturnType<typeof metrics.timer> | undefined;
    let hashTimer: ReturnType<typeof metrics.timer> | undefined;
    let copyTimer: ReturnType<typeof metrics.timer> | undefined;
    let validateTimer: ReturnType<typeof metrics.timer> | undefined;
    let finalizeTimer: ReturnType<typeof metrics.timer> | undefined;

    try {
      // Step 1: Scan
      this.currentStatus = 'scanning';
      progress.status = 'scanning';
      progress.step = 1;
      emitProgress();

      scanTimer = metrics.timer(MetricNames.IMPORT_SCAN_DURATION, { sessionId });
      const scanSpan = importSpan.child(OperationNames.IMPORT_SCAN);

      scanResult = await this.scanner.scan(paths, {
        signal,
        archivePath: options.archivePath,
        onProgress: (percent, currentPath) => {
          progress.percent = percent;
          progress.currentFile = currentPath;
          progress.filesTotal = scanResult?.totalFiles ?? 0;
          progress.bytesTotal = scanResult?.totalBytes ?? 0;
          progress.estimatedRemainingMs = scanResult?.estimatedDurationMs ?? 0;
          emitProgress();
        },
      });

      scanTimer.end();
      scanSpan.end('success', { filesFound: scanResult.totalFiles, bytesTotal: scanResult.totalBytes });

      progress.filesTotal = scanResult.totalFiles;
      progress.bytesTotal = scanResult.totalBytes;
      metrics.incrementCounter(MetricNames.IMPORT_FILES_SCANNED, scanResult.totalFiles, { sessionId });

      logger.info('ImportOrchestrator', 'Scan completed', {
        sessionId,
        filesFound: scanResult.totalFiles,
        bytesTotal: scanResult.totalBytes,
      });

      // Save scan results to DB session (enables resume from step 2)
      await this.saveSessionStateWithResults(sessionId, 'scanning', 1, options.location.locid, scanResult);

      // Step 2: Hash (or skip for network sources)
      // Network sources use inline hashing during copy (single read per file)
      const isNetworkSource = this.detectNetworkSource(paths);

      this.currentStatus = 'hashing';
      progress.status = 'hashing';
      progress.step = 2;
      emitProgress();

      hashTimer = metrics.timer(MetricNames.IMPORT_HASH_DURATION, { sessionId });
      const hashSpan = importSpan.child(OperationNames.IMPORT_HASH);

      if (isNetworkSource) {
        // NETWORK SOURCE: Skip separate hash step - copier will compute inline
        // This halves network I/O (single read per file instead of double)
        logger.info('ImportOrchestrator', 'Network source detected - using inline hashing (skip Step 2)', {
          sessionId,
          filesTotal: scanResult.files.length,
        });

        // Convert ScannedFiles to HashedFiles with null hash (computed during copy)
        hashResult = {
          files: scanResult.files.map(f => ({
            ...f,
            hash: null,
            hashError: null,
            isDuplicate: false,
            duplicateIn: null,
          })),
          totalHashed: 0,
          totalDuplicates: 0,
          totalErrors: 0,
          hashingTimeMs: 0,
        };

        hashTimer.end();
        hashSpan.end('success', { mode: 'inline', skipped: true });

        // Progress jumps to 40% (end of hash phase)
        progress.percent = 40;
        emitProgress();
      } else {
        // LOCAL SOURCE: Use parallel hasher (fast for local disk)
        // ADR-050: Track filesProcessed incrementally during hashing
      let hashFilesProcessed = 0;
      hashResult = await this.hasher.hash(scanResult.files, {
          signal,
          onProgress: (percent, currentFile, filesHashed) => {
            progress.percent = percent;
            progress.currentFile = currentFile;
            progress.duplicatesFound = hashResult?.totalDuplicates ?? 0;
            // ADR-050: Update filesProcessed with real count during hash step
            if (filesHashed !== undefined) {
              hashFilesProcessed = filesHashed;
              progress.filesProcessed = filesHashed;
            }
            emitProgress();
          },
        });

        hashTimer.end();
        hashSpan.end('success', {
          filesHashed: hashResult.files.length,
          duplicates: hashResult.totalDuplicates,
          errors: hashResult.totalErrors,
        });

        progress.duplicatesFound = hashResult.totalDuplicates;
        progress.errorsFound = hashResult.totalErrors;
        metrics.incrementCounter(MetricNames.IMPORT_FILES_DUPLICATES, hashResult.totalDuplicates, { sessionId });

        logger.info('ImportOrchestrator', 'Hashing completed', {
          sessionId,
          filesHashed: hashResult.files.length,
          duplicates: hashResult.totalDuplicates,
        });
      }

      // Save hash results to DB session (enables resume from step 3)
      await this.saveSessionStateWithResults(sessionId, 'hashing', 2, options.location.locid, scanResult, hashResult);

      // Step 3: Copy
      this.currentStatus = 'copying';
      progress.status = 'copying';
      progress.step = 3;
      emitProgress();

      copyTimer = metrics.timer(MetricNames.IMPORT_COPY_DURATION, { sessionId });
      const copySpan = importSpan.child(OperationNames.IMPORT_COPY);

      // ADR-050: Track filesProcessed incrementally during copy
      copyResult = await this.copier.copy(hashResult.files, options.location, {
        signal,
        onProgress: (percent, currentFile, bytesCopied, totalBytes, filesCopied) => {
          progress.percent = percent;
          progress.currentFile = currentFile;
          progress.bytesProcessed = bytesCopied;
          // ADR-050: Update filesProcessed with real count during copy step
          if (filesCopied !== undefined) {
            progress.filesProcessed = filesCopied;
          }
          emitProgress();
        },
      });

      copyTimer.end();
      copySpan.end('success', {
        filesCopied: copyResult.files.length,
        bytesCopied: copyResult.totalBytes,
        strategy: copyResult.strategy,
      });

      progress.bytesProcessed = copyResult.totalBytes;
      progress.errorsFound += copyResult.totalErrors;
      metrics.incrementCounter(MetricNames.IMPORT_BYTES_PROCESSED, copyResult.totalBytes, { sessionId });

      logger.info('ImportOrchestrator', 'Copy completed', {
        sessionId,
        filesCopied: copyResult.files.length,
        bytesCopied: copyResult.totalBytes,
        strategy: copyResult.strategy,
      });

      // Post-copy duplicate detection (for network source mode)
      // Inline hashing means duplicates are detected AFTER copy, then removed
      if (isNetworkSource) {
        const duplicatesRemoved = await this.detectAndRemoveDuplicatesPostCopy(copyResult, sessionId);
        progress.duplicatesFound = duplicatesRemoved;

        logger.info('ImportOrchestrator', 'Post-copy duplicate detection', {
          sessionId,
          duplicatesRemoved,
        });
      }

      // Save copy results to DB session (enables resume from step 4)
      await this.saveSessionStateWithResults(sessionId, 'copying', 3, options.location.locid, scanResult, hashResult, copyResult);

      // Step 4: Validate
      this.currentStatus = 'validating';
      progress.status = 'validating';
      progress.step = 4;
      emitProgress();

      validateTimer = metrics.timer(MetricNames.IMPORT_VALIDATE_DURATION, { sessionId });
      const validateSpan = importSpan.child(OperationNames.IMPORT_VALIDATE);

      validationResult = await this.validator.validate(copyResult.files, {
        signal,
        autoRollback: true,
        onProgress: (percent, currentFile) => {
          progress.percent = percent;
          progress.currentFile = currentFile;
          emitProgress();
        },
      });

      validateTimer.end();
      validateSpan.end('success', {
        filesValid: validationResult.totalValid,
        filesInvalid: validationResult.totalInvalid,
      });

      progress.errorsFound += validationResult.totalInvalid;

      logger.info('ImportOrchestrator', 'Validation completed', {
        sessionId,
        valid: validationResult.totalValid,
        invalid: validationResult.totalInvalid,
      });

      // Save validation results to DB session (enables resume from step 5)
      await this.saveSessionStateWithResults(sessionId, 'validating', 4, options.location.locid, scanResult, hashResult, copyResult, validationResult);

      // Step 5: Finalize
      this.currentStatus = 'finalizing';
      progress.status = 'finalizing';
      progress.step = 5;
      emitProgress();

      finalizeTimer = metrics.timer(MetricNames.IMPORT_FINALIZE_DURATION, { sessionId });
      const finalizeSpan = importSpan.child(OperationNames.IMPORT_FINALIZE);

      finalizationResult = await this.finalizer.finalize(validationResult.files, options.location, {
        signal,
        user: options.user,
        scanResult,
        onProgress: (percent, phase) => {
          progress.percent = percent;
          progress.currentFile = phase;
          emitProgress();
        },
      });

      finalizeTimer.end();
      finalizeSpan.end('success', {
        filesFinalized: finalizationResult.totalFinalized,
        jobsQueued: finalizationResult.jobsQueued,
      });

      progress.filesProcessed = finalizationResult.totalFinalized;
      progress.errorsFound += finalizationResult.totalErrors;
      metrics.incrementCounter(MetricNames.IMPORT_FILES_PROCESSED, finalizationResult.totalFinalized, { sessionId });

      logger.info('ImportOrchestrator', 'Finalization completed', {
        sessionId,
        filesFinalized: finalizationResult.totalFinalized,
        jobsQueued: finalizationResult.jobsQueued,
      });

      // Complete
      this.currentStatus = 'completed';
      progress.status = 'completed';
      progress.percent = 100;
      emitProgress();

      await this.saveSessionState(sessionId, 'completed', 5, options.location.locid, paths);

      // Record successful completion
      metrics.incrementCounter(MetricNames.IMPORT_COMPLETED, 1, { locationId: options.location.locid });
      importSpan.end('success', {
        totalFiles: finalizationResult.totalFinalized,
        totalBytes: copyResult.totalBytes,
        duplicates: hashResult.totalDuplicates,
      });

      logger.info('ImportOrchestrator', 'Import completed successfully', {
        sessionId,
        totalFiles: finalizationResult.totalFinalized,
        totalBytes: copyResult.totalBytes,
        duplicates: hashResult.totalDuplicates,
      });

    } catch (err) {
      if (signal.aborted) {
        this.currentStatus = 'cancelled';
        progress.status = 'cancelled';
        error = 'Import cancelled';
        logger.warn('ImportOrchestrator', 'Import cancelled', { sessionId });
      } else {
        this.currentStatus = 'failed';
        progress.status = 'failed';
        error = err instanceof Error ? err.message : String(err);
        logger.error('ImportOrchestrator', 'Import failed', err as Error, { sessionId, step: progress.step });
        metrics.incrementCounter(MetricNames.IMPORT_FAILED, 1, { locationId: options.location.locid });
        metrics.incrementCounter(MetricNames.ERRORS_COUNT, 1, { component: 'ImportOrchestrator', type: 'import_failure' });
      }

      importSpan.log('Import error', { error, step: progress.step });
      importSpan.end('error', { error, step: progress.step });

      emitProgress();
      await this.saveSessionState(sessionId, this.currentStatus, progress.step, options.location.locid, paths, error);
    } finally {
      // Always release the location lock when import completes (success, error, or cancel)
      releaseLocationLock(locid, sessionId);
      logger.debug('ImportOrchestrator', 'Location lock released', { sessionId, locid });
    }

    const completedAt = new Date();
    const totalDurationMs = completedAt.getTime() - startedAt.getTime();

    // Record total duration
    metrics.histogram(MetricNames.IMPORT_DURATION, totalDurationMs, { sessionId });

    // Calculate throughput if we have bytes
    if (copyResult && totalDurationMs > 0) {
      const throughputMbps = (copyResult.totalBytes / 1024 / 1024) / (totalDurationMs / 1000);
      metrics.gauge(MetricNames.IMPORT_THROUGHPUT_MBPS, throughputMbps, { sessionId });
    }

    return {
      sessionId,
      status: this.currentStatus,
      scanResult,
      hashResult,
      copyResult,
      validationResult,
      finalizationResult,
      error,
      startedAt: startedAt.toISOString(),  // OPT-080: Convert to string for IPC serialization
      completedAt: completedAt.toISOString(),  // OPT-080: Convert to string for IPC serialization
      totalDurationMs,
    };
  }

  /**
   * Cancel the current import
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Get current import status
   */
  getStatus(): { sessionId: string | null; status: ImportStatus } {
    return {
      sessionId: this.currentSessionId,
      status: this.currentStatus,
    };
  }

  /**
   * Resume an incomplete import session
   * Parses saved results from each step and continues from where it left off
   */
  async resume(sessionId: string, options: ImportOptions): Promise<ImportResult> {
    // Get session state from DB
    const session = await this.db
      .selectFrom('import_sessions')
      .selectAll()
      .where('session_id', '=', sessionId)
      .where('can_resume', '=', 1)
      .executeTakeFirst();

    if (!session) {
      throw new Error(`Session ${sessionId} not found or cannot be resumed`);
    }

    // Parse source paths
    const paths = JSON.parse(session.source_paths) as string[];

    // Parse saved results from previous run
    const savedScanResult = session.scan_result ? JSON.parse(session.scan_result) as ScanResult : null;
    const savedHashResults = session.hash_results ? JSON.parse(session.hash_results) as HashResult : null;
    const savedCopyResults = session.copy_results ? JSON.parse(session.copy_results) as CopyResult : null;
    const savedValidationResults = session.validation_results ? JSON.parse(session.validation_results) as ValidationResult : null;

    console.log(`[Orchestrator] Resuming session ${sessionId} from step ${session.last_step}`);

    // Resume from the appropriate step
    switch (session.last_step) {
      case 1:
        // Scan completed, resume from hash
        if (!savedScanResult) {
          console.log('[Orchestrator] No scan results saved, restarting from beginning');
          return this.import(paths, options);
        }
        return this.resumeFromHash(sessionId, savedScanResult, options);

      case 2:
        // Hash completed, resume from copy
        if (!savedScanResult || !savedHashResults) {
          console.log('[Orchestrator] Missing scan/hash results, restarting from beginning');
          return this.import(paths, options);
        }
        return this.resumeFromCopy(sessionId, savedScanResult, savedHashResults, options);

      case 3:
        // Copy completed, resume from validate
        if (!savedScanResult || !savedHashResults || !savedCopyResults) {
          console.log('[Orchestrator] Missing results, restarting from beginning');
          return this.import(paths, options);
        }
        return this.resumeFromValidate(sessionId, savedScanResult, savedHashResults, savedCopyResults, options);

      case 4:
        // Validate completed, resume from finalize
        if (!savedScanResult || !savedHashResults || !savedCopyResults || !savedValidationResults) {
          console.log('[Orchestrator] Missing results, restarting from beginning');
          return this.import(paths, options);
        }
        return this.resumeFromFinalize(sessionId, savedScanResult, savedHashResults, savedCopyResults, savedValidationResults, options);

      default:
        // Step 0 or unknown, restart from beginning
        console.log('[Orchestrator] Unknown step, restarting from beginning');
        return this.import(paths, options);
    }
  }

  /**
   * Resume from Step 2 (Hashing)
   */
  private async resumeFromHash(
    sessionId: string,
    scanResult: ScanResult,
    options: ImportOptions
  ): Promise<ImportResult> {
    const startedAt = new Date();
    this.currentSessionId = sessionId;
    this.abortController = new AbortController();
    const locid = options.location.locid;

    // Acquire location lock for resumed import
    try {
      await acquireLocationLock(locid, sessionId, {
        waitIfLocked: false,
        user: options.user?.username,
      });
    } catch (lockError) {
      return {
        sessionId,
        status: 'failed',
        error: lockError instanceof Error ? lockError.message : 'Location is currently being imported to',
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        totalDurationMs: Date.now() - startedAt.getTime(),
      };
    }

    const signal = options.signal
      ? this.mergeAbortSignals(options.signal, this.abortController.signal)
      : this.abortController.signal;

    let hashResult: HashResult | undefined;
    let copyResult: CopyResult | undefined;
    let validationResult: ValidationResult | undefined;
    let finalizationResult: FinalizationResult | undefined;
    let error: string | undefined;

    const progress = this.createProgressObject(sessionId, scanResult);
    const emitProgress = () => options.onProgress?.({ ...progress });

    try {
      // Step 2: Hash (resume point)
      this.currentStatus = 'hashing';
      progress.status = 'hashing';
      progress.step = 2;
      progress.percent = 5; // Start at 5% (scan was completed)
      emitProgress();

      hashResult = await this.hasher.hash(scanResult.files, {
        signal,
        onProgress: (percent, currentFile) => {
          progress.percent = percent;
          progress.currentFile = currentFile;
          emitProgress();
        },
      });

      await this.saveSessionStateWithResults(sessionId, 'hashing', 2, locid, scanResult, hashResult);

      // Continue with remaining steps...
      ({ copyResult, validationResult, finalizationResult } = await this.executeCopyValidateFinalize(
        sessionId, scanResult, hashResult, options, progress, emitProgress, signal
      ));

    } catch (err) {
      error = this.handleError(err, signal, progress);
      emitProgress();
      await this.saveSessionState(sessionId, this.currentStatus, progress.step, locid, [], error);
    } finally {
      releaseLocationLock(locid, sessionId);
    }

    return this.buildResult(sessionId, startedAt, scanResult, hashResult, copyResult, validationResult, finalizationResult, error);
  }

  /**
   * Resume from Step 3 (Copying)
   */
  private async resumeFromCopy(
    sessionId: string,
    scanResult: ScanResult,
    hashResult: HashResult,
    options: ImportOptions
  ): Promise<ImportResult> {
    const startedAt = new Date();
    this.currentSessionId = sessionId;
    this.abortController = new AbortController();
    const locid = options.location.locid;

    // Acquire location lock for resumed import
    try {
      await acquireLocationLock(locid, sessionId, {
        waitIfLocked: false,
        user: options.user?.username,
      });
    } catch (lockError) {
      return {
        sessionId,
        status: 'failed',
        error: lockError instanceof Error ? lockError.message : 'Location is currently being imported to',
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        totalDurationMs: Date.now() - startedAt.getTime(),
      };
    }

    const signal = options.signal
      ? this.mergeAbortSignals(options.signal, this.abortController.signal)
      : this.abortController.signal;

    let copyResult: CopyResult | undefined;
    let validationResult: ValidationResult | undefined;
    let finalizationResult: FinalizationResult | undefined;
    let error: string | undefined;

    const progress = this.createProgressObject(sessionId, scanResult);
    progress.duplicatesFound = hashResult.totalDuplicates;
    const emitProgress = () => options.onProgress?.({ ...progress });

    try {
      // Continue from copy step
      ({ copyResult, validationResult, finalizationResult } = await this.executeCopyValidateFinalize(
        sessionId, scanResult, hashResult, options, progress, emitProgress, signal
      ));

    } catch (err) {
      error = this.handleError(err, signal, progress);
      emitProgress();
      await this.saveSessionState(sessionId, this.currentStatus, progress.step, locid, [], error);
    } finally {
      releaseLocationLock(locid, sessionId);
    }

    return this.buildResult(sessionId, startedAt, scanResult, hashResult, copyResult, validationResult, finalizationResult, error);
  }

  /**
   * Resume from Step 4 (Validation)
   */
  private async resumeFromValidate(
    sessionId: string,
    scanResult: ScanResult,
    hashResult: HashResult,
    copyResult: CopyResult,
    options: ImportOptions
  ): Promise<ImportResult> {
    const startedAt = new Date();
    this.currentSessionId = sessionId;
    this.abortController = new AbortController();
    const locid = options.location.locid;

    // Acquire location lock for resumed import
    try {
      await acquireLocationLock(locid, sessionId, {
        waitIfLocked: false,
        user: options.user?.username,
      });
    } catch (lockError) {
      return {
        sessionId,
        status: 'failed',
        error: lockError instanceof Error ? lockError.message : 'Location is currently being imported to',
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        totalDurationMs: Date.now() - startedAt.getTime(),
      };
    }

    const signal = options.signal
      ? this.mergeAbortSignals(options.signal, this.abortController.signal)
      : this.abortController.signal;

    let validationResult: ValidationResult | undefined;
    let finalizationResult: FinalizationResult | undefined;
    let error: string | undefined;

    const progress = this.createProgressObject(sessionId, scanResult);
    progress.duplicatesFound = hashResult.totalDuplicates;
    progress.bytesProcessed = copyResult.totalBytes;
    const emitProgress = () => options.onProgress?.({ ...progress });

    try {
      // Step 4: Validate (resume point)
      this.currentStatus = 'validating';
      progress.status = 'validating';
      progress.step = 4;
      progress.percent = 80;
      emitProgress();

      validationResult = await this.validator.validate(copyResult.files, {
        signal,
        autoRollback: true,
        onProgress: (percent, currentFile) => {
          progress.percent = percent;
          progress.currentFile = currentFile;
          emitProgress();
        },
      });

      await this.saveSessionStateWithResults(sessionId, 'validating', 4, locid, scanResult, hashResult, copyResult, validationResult);

      // Step 5: Finalize
      finalizationResult = await this.executeFinalize(sessionId, scanResult, validationResult, options, progress, emitProgress, signal);

    } catch (err) {
      error = this.handleError(err, signal, progress);
      emitProgress();
      await this.saveSessionState(sessionId, this.currentStatus, progress.step, locid, [], error);
    } finally {
      releaseLocationLock(locid, sessionId);
    }

    return this.buildResult(sessionId, startedAt, scanResult, hashResult, copyResult, validationResult, finalizationResult, error);
  }

  /**
   * Resume from Step 5 (Finalization)
   */
  private async resumeFromFinalize(
    sessionId: string,
    scanResult: ScanResult,
    hashResult: HashResult,
    copyResult: CopyResult,
    validationResult: ValidationResult,
    options: ImportOptions
  ): Promise<ImportResult> {
    const startedAt = new Date();
    this.currentSessionId = sessionId;
    this.abortController = new AbortController();
    const locid = options.location.locid;

    // Acquire location lock for resumed import
    try {
      await acquireLocationLock(locid, sessionId, {
        waitIfLocked: false,
        user: options.user?.username,
      });
    } catch (lockError) {
      return {
        sessionId,
        status: 'failed',
        error: lockError instanceof Error ? lockError.message : 'Location is currently being imported to',
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        totalDurationMs: Date.now() - startedAt.getTime(),
      };
    }

    const signal = options.signal
      ? this.mergeAbortSignals(options.signal, this.abortController.signal)
      : this.abortController.signal;

    let finalizationResult: FinalizationResult | undefined;
    let error: string | undefined;

    const progress = this.createProgressObject(sessionId, scanResult);
    progress.duplicatesFound = hashResult.totalDuplicates;
    progress.bytesProcessed = copyResult.totalBytes;
    const emitProgress = () => options.onProgress?.({ ...progress });

    try {
      finalizationResult = await this.executeFinalize(sessionId, scanResult, validationResult, options, progress, emitProgress, signal);
    } catch (err) {
      error = this.handleError(err, signal, progress);
      emitProgress();
      await this.saveSessionState(sessionId, this.currentStatus, progress.step, locid, [], error);
    } finally {
      releaseLocationLock(locid, sessionId);
    }

    return this.buildResult(sessionId, startedAt, scanResult, hashResult, copyResult, validationResult, finalizationResult, error);
  }

  /**
   * Execute copy, validate, finalize steps (used by resume functions)
   */
  private async executeCopyValidateFinalize(
    sessionId: string,
    scanResult: ScanResult,
    hashResult: HashResult,
    options: ImportOptions,
    progress: ImportProgress,
    emitProgress: () => void,
    signal: AbortSignal
  ): Promise<{ copyResult: CopyResult; validationResult: ValidationResult; finalizationResult: FinalizationResult }> {
    // Step 3: Copy
    this.currentStatus = 'copying';
    progress.status = 'copying';
    progress.step = 3;
    progress.percent = 40;
    emitProgress();

    const copyResult = await this.copier.copy(hashResult.files, options.location, {
      signal,
      onProgress: (percent, currentFile, bytesCopied) => {
        progress.percent = percent;
        progress.currentFile = currentFile;
        progress.bytesProcessed = bytesCopied;
        emitProgress();
      },
    });

    await this.saveSessionStateWithResults(sessionId, 'copying', 3, options.location.locid, scanResult, hashResult, copyResult);

    // Step 4: Validate
    this.currentStatus = 'validating';
    progress.status = 'validating';
    progress.step = 4;
    progress.percent = 80;
    emitProgress();

    const validationResult = await this.validator.validate(copyResult.files, {
      signal,
      autoRollback: true,
      onProgress: (percent, currentFile) => {
        progress.percent = percent;
        progress.currentFile = currentFile;
        emitProgress();
      },
    });

    await this.saveSessionStateWithResults(sessionId, 'validating', 4, options.location.locid, scanResult, hashResult, copyResult, validationResult);

    // Step 5: Finalize
    const finalizationResult = await this.executeFinalize(sessionId, scanResult, validationResult, options, progress, emitProgress, signal);

    return { copyResult, validationResult, finalizationResult };
  }

  /**
   * Execute finalize step
   */
  private async executeFinalize(
    sessionId: string,
    scanResult: ScanResult,
    validationResult: ValidationResult,
    options: ImportOptions,
    progress: ImportProgress,
    emitProgress: () => void,
    signal: AbortSignal
  ): Promise<FinalizationResult> {
    this.currentStatus = 'finalizing';
    progress.status = 'finalizing';
    progress.step = 5;
    progress.percent = 95;
    emitProgress();

    const finalizationResult = await this.finalizer.finalize(validationResult.files, options.location, {
      signal,
      user: options.user,
      scanResult,
      onProgress: (percent, phase) => {
        progress.percent = percent;
        progress.currentFile = phase;
        emitProgress();
      },
    });

    // Complete
    this.currentStatus = 'completed';
    progress.status = 'completed';
    progress.percent = 100;
    progress.filesProcessed = finalizationResult.totalFinalized;
    emitProgress();

    await this.saveSessionState(sessionId, 'completed', 5, options.location.locid, []);

    return finalizationResult;
  }

  /**
   * Create initial progress object
   */
  private createProgressObject(sessionId: string, scanResult: ScanResult): ImportProgress {
    return {
      sessionId,
      status: 'pending',
      step: 0,
      totalSteps: 5,
      percent: 0,
      currentFile: '',
      filesProcessed: 0,
      filesTotal: scanResult.totalFiles,
      bytesProcessed: 0,
      bytesTotal: scanResult.totalBytes,
      duplicatesFound: 0,
      errorsFound: 0,
      estimatedRemainingMs: 0,
    };
  }

  /**
   * Handle error during import
   */
  private handleError(err: unknown, signal: AbortSignal, progress: ImportProgress): string {
    if (signal.aborted) {
      this.currentStatus = 'cancelled';
      progress.status = 'cancelled';
      return 'Import cancelled';
    } else {
      this.currentStatus = 'failed';
      progress.status = 'failed';
      return err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Build final result object
   */
  private buildResult(
    sessionId: string,
    startedAt: Date,
    scanResult?: ScanResult,
    hashResult?: HashResult,
    copyResult?: CopyResult,
    validationResult?: ValidationResult,
    finalizationResult?: FinalizationResult,
    error?: string
  ): ImportResult {
    const completedAt = new Date();
    return {
      sessionId,
      status: this.currentStatus,
      scanResult,
      hashResult,
      copyResult,
      validationResult,
      finalizationResult,
      error,
      startedAt: startedAt.toISOString(),  // Convert to string for IPC
      completedAt: completedAt.toISOString(),  // Convert to string for IPC
      totalDurationMs: completedAt.getTime() - startedAt.getTime(),
    };
  }

  /**
   * Get incomplete import sessions that can be resumed
   */
  async getResumableSessions(): Promise<Array<{
    sessionId: string;
    locid: string;
    status: ImportStatus;
    lastStep: number;
    startedAt: string;  // ISO string for IPC serialization
    totalFiles: number;
    processedFiles: number;
  }>> {
    const sessions = await this.db
      .selectFrom('import_sessions')
      .select([
        'session_id',
        'locid',
        'status',
        'last_step',
        'started_at',
        'total_files',
        'processed_files',
      ])
      .where('can_resume', '=', 1)
      .where('status', 'not in', ['completed', 'cancelled'])
      .orderBy('started_at', 'desc')
      .execute();

    return sessions.map(s => ({
      sessionId: s.session_id,
      locid: s.locid,
      status: s.status as ImportStatus,
      lastStep: s.last_step,
      startedAt: new Date(s.started_at).toISOString(),  // Convert to string for IPC
      totalFiles: s.total_files,
      processedFiles: s.processed_files,
    }));
  }

  /**
   * Detect and remove duplicates after copy (for network source inline-hash mode)
   *
   * When inline hashing is used, we don't know file hashes until after copy.
   * This method checks copied files against existing DB records and removes
   * any duplicates that were just copied.
   *
   * @returns Number of duplicate files removed
   */
  private async detectAndRemoveDuplicatesPostCopy(
    copyResult: CopyResult,
    sessionId: string
  ): Promise<number> {
    // Get files that were successfully copied and have a hash
    const copiedFiles = copyResult.files.filter(f => f.hash && f.archivePath && !f.copyError);
    if (copiedFiles.length === 0) return 0;

    let duplicatesRemoved = 0;

    // Group files by media type
    const imageFiles = copiedFiles.filter(f => f.mediaType === 'image');
    const videoFiles = copiedFiles.filter(f => f.mediaType === 'video');
    const docFiles = copiedFiles.filter(f => f.mediaType === 'document');
    const mapFiles = copiedFiles.filter(f => f.mediaType === 'map');

    // Check images
    if (imageFiles.length > 0) {
      const imageHashes = imageFiles.map(f => f.hash!);
      const existingImages = await this.db
        .selectFrom('imgs')
        .select('imghash')
        .where('imghash', 'in', imageHashes)
        .execute();

      const existingSet = new Set(existingImages.map(r => r.imghash));
      for (const file of imageFiles) {
        if (existingSet.has(file.hash!)) {
          await this.removeDuplicateFile(file, 'imgs', sessionId);
          duplicatesRemoved++;
        }
      }
    }

    // Check videos
    if (videoFiles.length > 0) {
      const videoHashes = videoFiles.map(f => f.hash!);
      const existingVideos = await this.db
        .selectFrom('vids')
        .select('vidhash')
        .where('vidhash', 'in', videoHashes)
        .execute();

      const existingSet = new Set(existingVideos.map(r => r.vidhash));
      for (const file of videoFiles) {
        if (existingSet.has(file.hash!)) {
          await this.removeDuplicateFile(file, 'vids', sessionId);
          duplicatesRemoved++;
        }
      }
    }

    // Check documents
    if (docFiles.length > 0) {
      const docHashes = docFiles.map(f => f.hash!);
      const existingDocs = await this.db
        .selectFrom('docs')
        .select('dochash')
        .where('dochash', 'in', docHashes)
        .execute();

      const existingSet = new Set(existingDocs.map(r => r.dochash));
      for (const file of docFiles) {
        if (existingSet.has(file.hash!)) {
          await this.removeDuplicateFile(file, 'docs', sessionId);
          duplicatesRemoved++;
        }
      }
    }

    // Check maps
    if (mapFiles.length > 0) {
      const mapHashes = mapFiles.map(f => f.hash!);
      const existingMaps = await this.db
        .selectFrom('maps')
        .select('maphash')
        .where('maphash', 'in', mapHashes)
        .execute();

      const existingSet = new Set(existingMaps.map(r => r.maphash));
      for (const file of mapFiles) {
        if (existingSet.has(file.hash!)) {
          await this.removeDuplicateFile(file, 'maps', sessionId);
          duplicatesRemoved++;
        }
      }
    }

    return duplicatesRemoved;
  }

  /**
   * Remove a duplicate file from disk after it was copied
   * Updates the file object to mark it as duplicate
   */
  private async removeDuplicateFile(
    file: CopiedFile,
    table: 'imgs' | 'vids' | 'docs' | 'maps',
    sessionId: string
  ): Promise<void> {
    if (!file.archivePath) return;

    try {
      await fs.unlink(file.archivePath);
      logger.debug('ImportOrchestrator', 'Removed duplicate file', {
        sessionId,
        hash: file.hash,
        table,
        path: file.archivePath,
      });

      // Mark the file as duplicate (mutate in place for copyResult)
      file.isDuplicate = true;
      file.duplicateIn = table;
      file.archivePath = null; // Clear path since file was deleted
    } catch (err) {
      // Non-fatal: file might already be gone, or permissions issue
      logger.warn('ImportOrchestrator', 'Failed to remove duplicate file', {
        sessionId,
        hash: file.hash,
        path: file.archivePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Save session state to database
   */
  private async saveSessionState(
    sessionId: string,
    status: ImportStatus,
    lastStep: number,
    locid: string,
    sourcePaths: string[],
    error?: string
  ): Promise<void> {
    const now = new Date().toISOString();

    // Check if session exists
    const existing = await this.db
      .selectFrom('import_sessions')
      .select('session_id')
      .where('session_id', '=', sessionId)
      .executeTakeFirst();

    if (existing) {
      // Update existing session
      await this.db
        .updateTable('import_sessions')
        .set({
          status,
          last_step: lastStep,
          error: error ?? null,
          completed_at: status === 'completed' || status === 'cancelled' || status === 'failed' ? now : null,
          can_resume: status === 'completed' || status === 'cancelled' ? 0 : 1,
        })
        .where('session_id', '=', sessionId)
        .execute();
    } else {
      // Insert new session
      await this.db
        .insertInto('import_sessions')
        .values({
          session_id: sessionId,
          locid,
          status,
          source_paths: JSON.stringify(sourcePaths),
          copy_strategy: null,
          total_files: 0,
          processed_files: 0,
          duplicate_files: 0,
          error_files: 0,
          total_bytes: 0,
          processed_bytes: 0,
          started_at: now,
          completed_at: null,
          error: error ?? null,
          can_resume: 1,
          last_step: lastStep,
          scan_result: null,
          hash_results: null,
          copy_results: null,
          validation_results: null,
        })
        .execute();
    }
  }

  /**
   * Save session state with step results for proper resume support
   * This enables resuming from any step without re-processing completed work
   */
  private async saveSessionStateWithResults(
    sessionId: string,
    status: ImportStatus,
    lastStep: number,
    locid: string,
    scanResult?: ScanResult,
    hashResult?: HashResult,
    copyResult?: CopyResult,
    validationResult?: ValidationResult
  ): Promise<void> {
    const now = new Date().toISOString();

    // Build update object with results
    const updateData: Record<string, unknown> = {
      status,
      last_step: lastStep,
      completed_at: status === 'completed' || status === 'cancelled' || status === 'failed' ? now : null,
      can_resume: status === 'completed' || status === 'cancelled' ? 0 : 1,
    };

    // Only save results for the current step to avoid oversized JSON
    // Each step's results are saved when that step completes
    if (scanResult && lastStep >= 1) {
      updateData.scan_result = JSON.stringify(scanResult);
      updateData.total_files = scanResult.totalFiles;
      updateData.total_bytes = scanResult.totalBytes;
    }
    if (hashResult && lastStep >= 2) {
      updateData.hash_results = JSON.stringify(hashResult);
      updateData.duplicate_files = hashResult.totalDuplicates;
      updateData.error_files = hashResult.totalErrors;
    }
    if (copyResult && lastStep >= 3) {
      updateData.copy_results = JSON.stringify(copyResult);
      updateData.copy_strategy = copyResult.strategy;
      updateData.processed_bytes = copyResult.totalBytes;
    }
    if (validationResult && lastStep >= 4) {
      updateData.validation_results = JSON.stringify(validationResult);
      updateData.processed_files = validationResult.totalValid;
    }

    await this.db
      .updateTable('import_sessions')
      .set(updateData)
      .where('session_id', '=', sessionId)
      .execute();
  }

  /**
   * Merge multiple abort signals into one
   */
  private mergeAbortSignals(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();

    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort();
        break;
      }

      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    return controller.signal;
  }
}

/**
 * Create an ImportOrchestrator instance
 */
export function createImportOrchestrator(db: Kysely<Database>, archivePath: string): ImportOrchestrator {
  return new ImportOrchestrator(db, archivePath);
}

// Re-export types for convenience
export type { ScanResult } from './scanner';
export type { HashResult } from './hasher';
export type { CopyResult, CopyStrategy, LocationInfo } from './copier';
export type { ValidationResult } from './validator';
export type { FinalizationResult } from './finalizer';
