/**
 * Import Service
 *
 * Handles the complete file import workflow:
 * 1. Hash files with BLAKE3
 * 2. Extract metadata (exiftool + ffprobe)
 * 3. Match to camera profiles
 * 4. Insert into database
 * 5. Optionally copy to managed storage
 *
 * Supports progress reporting and cancellation.
 */

import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import type {
  ImportResult,
  ImportBatchResult,
  ImportProgress,
  FileType,
  Medium,
  CameraWithPatterns,
} from '@nightfox/core';

import { calculateHash } from './hash-service';
import { getVideoInfo, getFFprobeJson } from './ffprobe-service';
import { getMetadataJson, getMediaInfo } from './exiftool-service';
import { matchFileWithDefault, detectMediumFromMetadata } from './camera-matcher-service';

/**
 * Import options
 */
export interface ImportOptions {
  coupleId?: number | null;
  copyToManaged?: boolean;
  managedStoragePath?: string;
  cameras?: CameraWithPatterns[];
  onProgress?: (progress: ImportProgress) => void;
}

/**
 * Import state for tracking active imports
 */
interface ImportState {
  id: string;
  files: string[];
  current: number;
  total: number;
  cancelled: boolean;
  results: ImportResult[];
}

/**
 * Import service class
 */
export class ImportService extends EventEmitter {
  private activeImports: Map<string, ImportState> = new Map();

  /**
   * Determine file type from extension
   */
  getFileType(filePath: string): FileType {
    const ext = path.extname(filePath).toLowerCase();

    // Video extensions
    const videoExts = [
      '.mp4', '.mov', '.avi', '.mkv', '.mts', '.m2ts', '.mxf',
      '.tod', '.mod', '.3gp', '.webm', '.wmv', '.flv', '.m4v',
      '.mpg', '.mpeg', '.vob', '.dv', '.r3d', '.braw',
    ];

    // Sidecar extensions
    const sidecarExts = [
      '.xml', '.xmp', '.srt', '.vtt', '.edl', '.fcpxml',
      '.aaf', '.omf', '.mhl', '.md5',
    ];

    // Audio extensions
    const audioExts = [
      '.wav', '.mp3', '.aac', '.flac', '.m4a', '.aiff',
      '.ogg', '.wma',
    ];

    if (videoExts.includes(ext)) return 'video';
    if (sidecarExts.includes(ext)) return 'sidecar';
    if (audioExts.includes(ext)) return 'audio';
    return 'other';
  }

  /**
   * Check if file is supported for import
   */
  isSupportedFile(filePath: string): boolean {
    const fileType = this.getFileType(filePath);
    return fileType === 'video' || fileType === 'sidecar' || fileType === 'audio';
  }

  /**
   * Generate unique import ID
   */
  generateImportId(): string {
    return `import_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Import a single file
   */
  async importFile(
    filePath: string,
    options: ImportOptions = {}
  ): Promise<ImportResult> {
    const { coupleId, cameras = [] } = options;

    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          hash: '',
          type: 'skipped',
          duplicate: false,
          error: 'File not found',
        };
      }

      // Determine file type
      const fileType = this.getFileType(filePath);
      if (fileType === 'other') {
        return {
          success: false,
          hash: '',
          type: 'skipped',
          duplicate: false,
          skipped: true,
          error: 'Unsupported file type',
        };
      }

      // Calculate BLAKE3 hash
      const hashResult = await calculateHash(filePath);
      const { hash, fileSize } = hashResult;

      // Initialize result data
      const result: ImportResult = {
        success: true,
        hash,
        type: fileType,
        duplicate: false,
      };

      // Extract metadata for video files
      let exiftoolJson: string | null = null;
      let ffprobeJson: string | null = null;
      let width: number | null = null;
      let height: number | null = null;
      let duration: number | null = null;
      let frameRate: number | null = null;
      let codec: string | null = null;
      let bitrate: number | null = null;
      let detectedMake: string | null = null;
      let detectedModel: string | null = null;
      let recordedAt: Date | null = null;
      let medium: Medium = 'modern';

      if (fileType === 'video') {
        try {
          // FFprobe metadata
          const videoInfo = await getVideoInfo(filePath);
          ffprobeJson = await getFFprobeJson(filePath);

          width = videoInfo.width;
          height = videoInfo.height;
          duration = videoInfo.duration;
          frameRate = videoInfo.frameRate;
          codec = videoInfo.codec;
          bitrate = videoInfo.bitrate;
        } catch (error) {
          result.warnings = result.warnings || [];
          result.warnings.push(`FFprobe failed: ${error}`);
        }

        try {
          // ExifTool metadata
          exiftoolJson = await getMetadataJson(filePath);
          const mediaInfo = await getMediaInfo(filePath);

          detectedMake = mediaInfo.make;
          detectedModel = mediaInfo.model;
          recordedAt = mediaInfo.createDate;

          // Fill in missing dimensions from ExifTool
          if (!width && mediaInfo.width) width = mediaInfo.width;
          if (!height && mediaInfo.height) height = mediaInfo.height;
          if (!duration && mediaInfo.duration) duration = mediaInfo.duration;
          if (!frameRate && mediaInfo.frameRate) frameRate = mediaInfo.frameRate;
        } catch (error) {
          result.warnings = result.warnings || [];
          result.warnings.push(`ExifTool failed: ${error}`);
        }

        // Detect medium from resolution
        medium = detectMediumFromMetadata(width, height, codec, frameRate);
      }

      // Match to camera
      let cameraId: number | null = null;
      if (cameras.length > 0) {
        const cameraMatch = matchFileWithDefault(
          filePath,
          cameras,
          medium,
          detectedMake,
          detectedModel
        );
        if (cameraMatch.camera_id > 0) {
          cameraId = cameraMatch.camera_id;
          medium = cameraMatch.medium;
        }
      }

      // Build file record data
      const fileData = {
        blake3: hash,
        original_filename: path.basename(filePath),
        original_path: filePath,
        extension: path.extname(filePath).toLowerCase().slice(1),
        file_size: fileSize,
        couple_id: coupleId ?? null,
        camera_id: cameraId,
        detected_make: detectedMake,
        detected_model: detectedModel,
        medium,
        file_type: fileType,
        duration_seconds: duration,
        width,
        height,
        frame_rate: frameRate,
        codec,
        bitrate,
        recorded_at: recordedAt?.toISOString() ?? null,
      };

      // Build metadata record
      const metadataData = {
        exiftool_json: exiftoolJson,
        ffprobe_json: ffprobeJson,
      };

      return {
        ...result,
        _fileData: fileData,
        _metadataData: metadataData,
      } as ImportResult & { _fileData: typeof fileData; _metadataData: typeof metadataData };
    } catch (error) {
      return {
        success: false,
        hash: '',
        type: 'skipped',
        duplicate: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Import multiple files
   */
  async importFiles(
    filePaths: string[],
    options: ImportOptions = {}
  ): Promise<{ importId: string; promise: Promise<ImportBatchResult> }> {
    const importId = this.generateImportId();
    const { onProgress } = options;

    // Initialize import state
    const state: ImportState = {
      id: importId,
      files: filePaths,
      current: 0,
      total: filePaths.length,
      cancelled: false,
      results: [],
    };
    this.activeImports.set(importId, state);

    // Create the import promise
    const promise = (async (): Promise<ImportBatchResult> => {
      const results: ImportResult[] = [];
      let imported = 0;
      let duplicates = 0;
      let skipped = 0;
      let errors = 0;

      for (let i = 0; i < filePaths.length; i++) {
        // Check for cancellation
        if (state.cancelled) {
          break;
        }

        const filePath = filePaths[i];
        state.current = i;

        // Report progress
        if (onProgress) {
          onProgress({
            current: i + 1,
            total: filePaths.length,
            filename: path.basename(filePath),
            status: 'hashing',
          });
        }

        // Import the file
        const result = await this.importFile(filePath, options);
        results.push(result);

        // Update counters
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

        state.results = results;
      }

      // Clean up
      this.activeImports.delete(importId);

      return {
        total: filePaths.length,
        imported,
        duplicates,
        skipped,
        errors,
        files: results,
      };
    })();

    return { importId, promise };
  }

  /**
   * Cancel an active import
   */
  cancelImport(importId: string): boolean {
    const state = this.activeImports.get(importId);
    if (!state) return false;

    state.cancelled = true;
    return true;
  }

  /**
   * Get status of an active import
   */
  getImportStatus(importId: string): ImportState | null {
    return this.activeImports.get(importId) ?? null;
  }

  /**
   * Check if any imports are active
   */
  hasActiveImports(): boolean {
    return this.activeImports.size > 0;
  }

  /**
   * Scan a directory for importable files
   */
  async scanDirectory(
    dirPath: string,
    options?: { recursive?: boolean }
  ): Promise<string[]> {
    const { recursive = true } = options ?? {};
    const files: string[] = [];

    const scan = async (currentPath: string): Promise<void> => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        // Skip hidden files and directories
        if (entry.name.startsWith('.')) continue;

        if (entry.isDirectory() && recursive) {
          await scan(fullPath);
        } else if (entry.isFile()) {
          if (this.isSupportedFile(fullPath)) {
            files.push(fullPath);
          }
        }
      }
    };

    await scan(dirPath);
    return files;
  }

  /**
   * Get file statistics for a directory
   */
  async getDirectoryStats(dirPath: string): Promise<{
    totalFiles: number;
    videoFiles: number;
    sidecarFiles: number;
    audioFiles: number;
    otherFiles: number;
    totalSize: number;
  }> {
    const files = await this.scanDirectory(dirPath);

    let videoFiles = 0;
    let sidecarFiles = 0;
    let audioFiles = 0;
    let otherFiles = 0;
    let totalSize = 0;

    for (const file of files) {
      const stat = fs.statSync(file);
      totalSize += stat.size;

      const fileType = this.getFileType(file);
      switch (fileType) {
        case 'video':
          videoFiles++;
          break;
        case 'sidecar':
          sidecarFiles++;
          break;
        case 'audio':
          audioFiles++;
          break;
        default:
          otherFiles++;
      }
    }

    return {
      totalFiles: files.length,
      videoFiles,
      sidecarFiles,
      audioFiles,
      otherFiles,
      totalSize,
    };
  }
}

// Singleton instance
export const importService = new ImportService();
