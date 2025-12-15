/**
 * Import Controller
 *
 * Coordinates imports between the ImportService and database repositories.
 * Handles duplicate detection, database insertion, and progress events.
 */

import { BrowserWindow } from 'electron';
import type {
  ImportBatchResult,
  ImportProgress,
  ImportResult,
} from '@nightfox/core';

import { importService, type ImportOptions } from './import-service';
import { filesRepository } from '../repositories/files-repository';
import { camerasRepository } from '../repositories/cameras-repository';

/**
 * Extended import options for controller
 */
export interface ImportControllerOptions extends Omit<ImportOptions, 'cameras' | 'onProgress'> {
  window?: BrowserWindow;
}

/**
 * Import controller class
 */
export class ImportController {
  private activeImportId: string | null = null;

  /**
   * Start importing files
   */
  async importFiles(
    filePaths: string[],
    options: ImportControllerOptions = {}
  ): Promise<ImportBatchResult> {
    const { coupleId, copyToManaged, managedStoragePath, window } = options;

    // Load all cameras with patterns for matching
    const cameras = camerasRepository.findAllWithPatterns();

    // Create progress handler
    const onProgress = (progress: ImportProgress) => {
      // Emit progress to renderer
      if (window && !window.isDestroyed()) {
        window.webContents.send('import:progress', progress);
      }
    };

    // Start the import
    const { importId, promise } = await importService.importFiles(filePaths, {
      coupleId,
      copyToManaged,
      managedStoragePath,
      cameras,
      onProgress,
    });

    this.activeImportId = importId;

    // Wait for results
    const batchResult = await promise;

    // Process results and insert into database
    const processedFiles: ImportResult[] = [];

    for (const result of batchResult.files) {
      if (!result.success) {
        processedFiles.push(result);
        continue;
      }

      // Check for internal data
      const fileData = (result as any)._fileData;
      const metadataData = (result as any)._metadataData;

      if (!fileData) {
        processedFiles.push(result);
        continue;
      }

      // Check for duplicate
      const existingFile = filesRepository.findByHash(fileData.blake3);
      if (existingFile) {
        processedFiles.push({
          ...result,
          duplicate: true,
        });
        continue;
      }

      // Insert into database
      try {
        const insertedFile = filesRepository.create(fileData);

        // Insert metadata if available
        if (metadataData && (metadataData.exiftool_json || metadataData.ffprobe_json)) {
          filesRepository.saveMetadata(
            insertedFile.id,
            metadataData.exiftool_json,
            metadataData.ffprobe_json
          );
        }

        // Remove internal data from result
        const { _fileData: _, _metadataData: __, ...cleanResult } = result as any;
        processedFiles.push(cleanResult);
      } catch (error) {
        // Remove internal data and add error
        const { _fileData: _, _metadataData: __, ...cleanResult } = result as any;
        processedFiles.push({
          ...cleanResult,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Recalculate counts based on processed results
    let imported = 0;
    let duplicates = 0;
    let skipped = 0;
    let errors = 0;

    for (const result of processedFiles) {
      if (result.success) {
        if (result.duplicate) {
          duplicates++;
        } else {
          imported++;
        }
      } else if (result.skipped) {
        skipped++;
      } else {
        errors++;
      }
    }

    this.activeImportId = null;

    // Notify completion
    if (window && !window.isDestroyed()) {
      window.webContents.send('import:complete', {
        total: batchResult.total,
        imported,
        duplicates,
        skipped,
        errors,
      });
    }

    return {
      total: batchResult.total,
      imported,
      duplicates,
      skipped,
      errors,
      files: processedFiles,
    };
  }

  /**
   * Import a directory
   */
  async importDirectory(
    dirPath: string,
    options: ImportControllerOptions = {}
  ): Promise<ImportBatchResult> {
    // Scan directory for files
    const files = await importService.scanDirectory(dirPath);

    if (files.length === 0) {
      return {
        total: 0,
        imported: 0,
        duplicates: 0,
        skipped: 0,
        errors: 0,
        files: [],
      };
    }

    return this.importFiles(files, options);
  }

  /**
   * Cancel the current import
   */
  cancelImport(): boolean {
    if (!this.activeImportId) return false;
    return importService.cancelImport(this.activeImportId);
  }

  /**
   * Get current import status
   */
  getStatus(): { active: boolean; importId: string | null } {
    return {
      active: this.activeImportId !== null,
      importId: this.activeImportId,
    };
  }

  /**
   * Scan a directory and return statistics
   */
  async scanDirectory(dirPath: string): Promise<{
    files: string[];
    stats: {
      totalFiles: number;
      videoFiles: number;
      sidecarFiles: number;
      audioFiles: number;
      otherFiles: number;
      totalSize: number;
    };
  }> {
    const files = await importService.scanDirectory(dirPath);
    const stats = await importService.getDirectoryStats(dirPath);

    return { files, stats };
  }
}

// Singleton instance
export const importController = new ImportController();
