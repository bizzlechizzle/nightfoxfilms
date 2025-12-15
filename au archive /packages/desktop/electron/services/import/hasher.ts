/**
 * Hasher - Parallel BLAKE3 hashing (Step 2)
 *
 * Per Import Spec v2.0:
 * - Parallel hashing using WorkerPool
 * - Batch duplicate detection (single WHERE IN query)
 * - Progress reporting (5-40%)
 *
 * @module services/import/hasher
 */

import type { Kysely } from 'kysely';
import type { Database } from '../../main/database.types';
import type { ScannedFile } from './scanner';
import { getWorkerPool, type WorkerPool } from '../worker-pool';

/**
 * Hash result for a single file
 */
export interface HashedFile extends ScannedFile {
  hash: string | null;
  hashError: string | null;
  isDuplicate: boolean;
  duplicateIn: 'imgs' | 'vids' | 'docs' | 'maps' | null;
}

/**
 * Hashing result summary
 */
export interface HashResult {
  files: HashedFile[];
  totalHashed: number;
  totalDuplicates: number;
  totalErrors: number;
  hashingTimeMs: number;
}

/**
 * Hasher options
 */
export interface HasherOptions {
  /**
   * Progress callback (5-40% range)
   * ADR-050: Added filesHashed parameter for incremental progress tracking
   */
  onProgress?: (percent: number, currentFile: string, filesHashed?: number) => void;

  /**
   * Abort signal for cancellation
   */
  signal?: AbortSignal;

  /**
   * FIX 6: Streaming callback - called after each file is hashed
   * Allows incremental result persistence to avoid memory bloat
   */
  onFileComplete?: (file: HashedFile, index: number, total: number) => void | Promise<void>;
}

/**
 * Hasher class for parallel file hashing
 */
export class Hasher {
  private pool: WorkerPool | null = null;

  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Initialize the worker pool
   */
  async initialize(): Promise<void> {
    if (!this.pool) {
      this.pool = await getWorkerPool();
    }
  }

  /**
   * Hash all files and check for duplicates
   */
  async hash(files: ScannedFile[], options?: HasherOptions): Promise<HashResult> {
    await this.initialize();

    const startTime = Date.now();
    const totalFiles = files.length;
    let completedFiles = 0;
    let totalDuplicates = 0;
    let totalErrors = 0;

    // Filter out files that should be skipped
    const filesToHash = files.filter(f => !f.shouldSkip);
    const results: HashedFile[] = [];

    // Hash files in parallel batches
    const batchSize = 50; // Process 50 files at a time for progress updates

    for (let i = 0; i < filesToHash.length; i += batchSize) {
      if (options?.signal?.aborted) {
        throw new Error('Hashing cancelled');
      }

      const batch = filesToHash.slice(i, i + batchSize);
      const batchPaths = batch.map(f => f.originalPath);

      // Hash the batch
      const hashResults = await this.pool!.hashBatch(batchPaths);

      // Map results back to files
      for (let j = 0; j < batch.length; j++) {
        const file = batch[j];
        const hashResult = hashResults[j];

        const hashedFile: HashedFile = {
          ...file,
          hash: hashResult.hash ?? null,
          hashError: hashResult.error ?? null,
          isDuplicate: false,
          duplicateIn: null,
        };

        if (hashResult.error) {
          totalErrors++;
        }

        results.push(hashedFile);
        completedFiles++;

        // Report progress (5-40% range)
        // ADR-050: Pass completedFiles for incremental progress tracking
        if (options?.onProgress) {
          const percent = 5 + ((completedFiles / totalFiles) * 35);
          options.onProgress(percent, file.filename, completedFiles);
        }

        // FIX 6: Stream result to caller for incremental persistence
        if (options?.onFileComplete) {
          await options.onFileComplete(hashedFile, completedFiles - 1, totalFiles);
        }
      }
    }

    // Add skipped files to results
    for (const file of files) {
      if (file.shouldSkip) {
        results.push({
          ...file,
          hash: null,
          hashError: 'Skipped',
          isDuplicate: false,
          duplicateIn: null,
        });
      }
    }

    // Check for duplicates in batch
    const hashedFiles = results.filter(f => f.hash !== null);
    if (hashedFiles.length > 0) {
      const duplicates = await this.checkDuplicatesBatch(hashedFiles);
      totalDuplicates = duplicates;
    }

    const hashingTimeMs = Date.now() - startTime;

    return {
      files: results,
      totalHashed: results.filter(f => f.hash !== null).length,
      totalDuplicates,
      totalErrors,
      hashingTimeMs,
    };
  }

  /**
   * Check for duplicates using batch WHERE IN query
   */
  private async checkDuplicatesBatch(files: HashedFile[]): Promise<number> {
    let duplicateCount = 0;

    // Group files by media type
    const imageHashes = files.filter(f => f.mediaType === 'image' && f.hash).map(f => f.hash!);
    const videoHashes = files.filter(f => f.mediaType === 'video' && f.hash).map(f => f.hash!);
    const docHashes = files.filter(f => f.mediaType === 'document' && f.hash).map(f => f.hash!);
    const mapHashes = files.filter(f => f.mediaType === 'map' && f.hash).map(f => f.hash!);

    // Check images
    if (imageHashes.length > 0) {
      const existingImages = await this.db
        .selectFrom('imgs')
        .select('imghash')
        .where('imghash', 'in', imageHashes)
        .execute();

      const existingSet = new Set(existingImages.map(r => r.imghash));
      for (const file of files) {
        if (file.mediaType === 'image' && file.hash && existingSet.has(file.hash)) {
          file.isDuplicate = true;
          file.duplicateIn = 'imgs';
          duplicateCount++;
        }
      }
    }

    // Check videos
    if (videoHashes.length > 0) {
      const existingVideos = await this.db
        .selectFrom('vids')
        .select('vidhash')
        .where('vidhash', 'in', videoHashes)
        .execute();

      const existingSet = new Set(existingVideos.map(r => r.vidhash));
      for (const file of files) {
        if (file.mediaType === 'video' && file.hash && existingSet.has(file.hash)) {
          file.isDuplicate = true;
          file.duplicateIn = 'vids';
          duplicateCount++;
        }
      }
    }

    // Check documents
    if (docHashes.length > 0) {
      const existingDocs = await this.db
        .selectFrom('docs')
        .select('dochash')
        .where('dochash', 'in', docHashes)
        .execute();

      const existingSet = new Set(existingDocs.map(r => r.dochash));
      for (const file of files) {
        if (file.mediaType === 'document' && file.hash && existingSet.has(file.hash)) {
          file.isDuplicate = true;
          file.duplicateIn = 'docs';
          duplicateCount++;
        }
      }
    }

    // Check maps
    if (mapHashes.length > 0) {
      const existingMaps = await this.db
        .selectFrom('maps')
        .select('maphash')
        .where('maphash', 'in', mapHashes)
        .execute();

      const existingSet = new Set(existingMaps.map(r => r.maphash));
      for (const file of files) {
        if (file.mediaType === 'map' && file.hash && existingSet.has(file.hash)) {
          file.isDuplicate = true;
          file.duplicateIn = 'maps';
          duplicateCount++;
        }
      }
    }

    return duplicateCount;
  }
}

/**
 * Create a Hasher instance
 */
export function createHasher(db: Kysely<Database>): Hasher {
  return new Hasher(db);
}
