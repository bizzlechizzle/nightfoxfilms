/**
 * Import Controller
 *
 * Orchestrates the network-safe import pipeline:
 * 1. Scan - enumerate files, detect types
 * 2. Hash - compute BLAKE3 (or skip for network sources)
 * 3. Copy - copy to managed storage with network safety
 * 4. Validate - re-hash and verify integrity
 * 5. Finalize - insert to database, link sidecars
 *
 * Features:
 * - Network source detection with appropriate I/O settings
 * - Session persistence for crash recovery
 * - Resume capability for paused imports
 * - NetworkFailureError handling -> paused state
 * - Backward compatible catalog-only mode (copyToManaged = false)
 */

import { BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import type {
  ImportBatchResult,
  ImportProgress,
  ImportResult,
  FootageType,
  Couple,
  Medium,
  CameraWithPatterns,
} from '@nightfox/core';

import { importService, type ImportOptions } from './import-service';
import { filesRepository } from '../repositories/files-repository';
import { camerasRepository } from '../repositories/cameras-repository';
import { couplesRepository } from '../repositories/couples-repository';
import { getDatabase } from '../main/database';

// Import new network-safe services
import {
  isNetworkPath,
  getStorageConfig,
  createCopyService,
  createValidatorService,
  NetworkFailureError,
  type CouplePathInfo,
  type HashedFile,
  type CopiedFile,
  type ImportStatus,
} from './import';

import { calculateHash } from './hash-service';
import { matchFileWithDefault, detectMediumFromMetadata } from './camera-matcher-service';
import { getVideoInfo, getFFprobeJson, getVideoMetadata, parseCreationTime } from './ffprobe-service';
import { getMetadataJson, getMediaInfo } from './exiftool-service';
import { writeSidecar } from './sidecar-service';
import { syncCoupleDocuments, updateManifestAfterImport } from './document-sync-service';
import { generateAllThumbnails } from './thumbnail-service';
import { generateCameraProxy } from './proxy-service';
import { isXmlSidecar, parseXmlSidecars, type XmlSidecarData } from './xml-sidecar-service';
import { settingsRepository } from '../repositories/settings-repository';

/**
 * Determine footage type based on recording date vs couple's key dates
 *
 * Logic:
 * - If recorded on date_night_date -> 'date_night'
 * - If recorded day before wedding -> 'rehearsal'
 * - If recorded on or after wedding_date -> 'wedding'
 * - Otherwise -> 'other'
 */
function determineFootageType(
  recordedAt: string | null,
  couple: Couple | null
): FootageType {
  if (!recordedAt || !couple?.wedding_date) {
    return 'other';
  }

  // Parse dates (strip time, compare just dates)
  const recorded = new Date(recordedAt);
  recorded.setHours(0, 0, 0, 0);

  const wedding = new Date(couple.wedding_date);
  wedding.setHours(0, 0, 0, 0);

  // Check date night first (if couple has one)
  if (couple.date_night_date) {
    const dateNight = new Date(couple.date_night_date);
    dateNight.setHours(0, 0, 0, 0);
    if (recorded.getTime() === dateNight.getTime()) {
      return 'date_night';
    }
  }

  // Check rehearsal (day before wedding)
  const rehearsal = new Date(wedding);
  rehearsal.setDate(rehearsal.getDate() - 1);
  if (recorded.getTime() === rehearsal.getTime()) {
    return 'rehearsal';
  }

  // Check wedding day or after
  if (recorded.getTime() >= wedding.getTime()) {
    return 'wedding';
  }

  return 'other';
}

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
  return `import_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Generate camera slug from camera name
 */
function generateCameraSlug(cameraName: string | null): string {
  if (!cameraName) return 'unknown';
  return cameraName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extended import options for controller
 */
export interface ImportControllerOptions extends Omit<ImportOptions, 'cameras' | 'onProgress'> {
  window?: BrowserWindow;
  /** Override auto-detected footage type (wedding, date_night, rehearsal, other) */
  footageTypeOverride?: FootageType;
}

/**
 * Import session data for persistence
 */
interface SessionData {
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
  error: string | null;
}

/**
 * Import controller class with network-safe orchestration
 */
export class ImportController {
  private activeImportId: string | null = null;
  private abortController: AbortController | null = null;

  /**
   * Save session to database
   */
  private saveSession(session: SessionData): void {
    const db = getDatabase();
    db.prepare(`
      INSERT OR REPLACE INTO import_sessions (
        session_id, couple_id, status, last_step, can_resume,
        source_paths, archive_path, total_files, processed_files,
        duplicate_files, error_files, total_bytes, processed_bytes, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.sessionId,
      session.coupleId,
      session.status,
      session.lastStep,
      session.canResume ? 1 : 0,
      JSON.stringify(session.sourcePaths),
      session.archivePath,
      session.totalFiles,
      session.processedFiles,
      session.duplicateFiles,
      session.errorFiles,
      session.totalBytes,
      session.processedBytes,
      session.error
    );
  }

  /**
   * Complete session
   */
  private completeSession(sessionId: string, status: ImportStatus): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE import_sessions
      SET status = ?, completed_at = CURRENT_TIMESTAMP
      WHERE session_id = ?
    `).run(status, sessionId);
  }

  /**
   * Import files with network-safe copy (full pipeline)
   */
  async importFilesWithCopy(
    filePaths: string[],
    options: ImportControllerOptions = {}
  ): Promise<ImportBatchResult> {
    const { coupleId, managedStoragePath, window, footageTypeOverride } = options;

    // Generate session ID
    const sessionId = generateSessionId();
    this.activeImportId = sessionId;
    this.abortController = new AbortController();

    // Load couple data
    const couple = coupleId ? couplesRepository.findById(coupleId) : null;
    if (!couple) {
      throw new Error('Couple not found - required for copy import');
    }

    // Determine working path - try in order: explicit option, couple's working_path, global storage_path
    const globalStoragePath = settingsRepository.getStoragePath();
    const workingPath = managedStoragePath || couple.working_path || globalStoragePath;
    if (!workingPath) {
      throw new Error('No storage path configured. Please set storage path in Settings first.');
    }

    // Load cameras for matching
    const cameras = camerasRepository.findAllWithPatterns();

    // Detect if source is network
    const isNetworkSource = filePaths.length > 0 && isNetworkPath(filePaths[0]);
    const storageConfig = getStorageConfig(filePaths[0] || '/');

    console.log(`[ImportController] Starting copy import: ${filePaths.length} files, network=${isNetworkSource}`);

    // Initialize session
    const session: SessionData = {
      sessionId,
      coupleId: coupleId ?? null,
      status: 'scanning',
      lastStep: 0,
      canResume: true,
      sourcePaths: filePaths,
      archivePath: path.join(workingPath, couple.folder_name || 'unknown'),
      totalFiles: filePaths.length,
      processedFiles: 0,
      duplicateFiles: 0,
      errorFiles: 0,
      totalBytes: 0,
      processedBytes: 0,
      error: null,
    };
    this.saveSession(session);

    // Progress helper
    const emitProgress = (progress: Partial<ImportProgress>) => {
      if (window && !window.isDestroyed()) {
        const fullProgress = {
          sessionId,
          status: session.status,
          // Ensure required fields have defaults
          current: progress.filesProcessed ?? 0,
          total: progress.filesTotal ?? 0,
          filename: progress.currentFile ?? '',
          ...progress,
        };
        console.log(`[ImportController] Progress: ${fullProgress.status} - ${fullProgress.filesProcessed ?? fullProgress.current}/${fullProgress.filesTotal ?? fullProgress.total} - ${fullProgress.currentFile ?? fullProgress.filename}`);
        window.webContents.send('import:progress', fullProgress);
      }
    };

    try {
      // ========================================
      // STEP 1: SCAN - Enumerate files
      // ========================================
      session.status = 'scanning';
      this.saveSession(session);
      emitProgress({ status: 'scanning', step: 1, totalSteps: 5, percent: 5 });

      let scannedFiles: HashedFile[] = [];
      let totalBytes = 0;

      for (const filePath of filePaths) {
        if (this.abortController.signal.aborted) break;

        const fileType = importService.getFileType(filePath);
        if (fileType === 'other') continue;

        const stat = await import('fs').then(fs => fs.promises.stat(filePath));
        totalBytes += stat.size;

        scannedFiles.push({
          id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          filename: path.basename(filePath),
          originalPath: filePath,
          extension: path.extname(filePath).toLowerCase().slice(1),
          size: stat.size,
          fileType,
          hash: null, // Will be computed in step 2 or during copy
          hashError: null,
          isDuplicate: false,
          duplicateIn: null,
        });
      }

      session.totalBytes = totalBytes;
      session.totalFiles = scannedFiles.length;
      session.lastStep = 1;
      this.saveSession(session);

      // Parse XML sidecars and create lookup map (by video filename)
      // Check by extension directly - more reliable than fileType
      const xmlExtensions = ['.xml', '.xmp', '.fcpxml'];
      const xmlFiles = scannedFiles.filter(f => {
        const ext = path.extname(f.originalPath).toLowerCase();
        return xmlExtensions.includes(ext);
      });
      let xmlSidecarMap = new Map<string, XmlSidecarData>();

      if (xmlFiles.length > 0) {
        console.log(`[ImportController] Found ${xmlFiles.length} XML sidecar files - parsing metadata, NOT copying`);
        try {
          xmlSidecarMap = await parseXmlSidecars(xmlFiles.map(f => f.originalPath));
          console.log(`[ImportController] Parsed XML sidecars, linked to ${xmlSidecarMap.size} video files`);
        } catch (e) {
          console.warn('[ImportController] XML sidecar parsing failed (non-fatal):', e);
        }
      }

      // Remove ALL XML/XMP files from scannedFiles - we've extracted their metadata,
      // they should NOT be copied or stored. This is a wedding app, not an archive.
      const xmlFilePaths = new Set(xmlFiles.map(f => f.originalPath));
      const originalCount = scannedFiles.length;
      scannedFiles = scannedFiles.filter(f => !xmlFilePaths.has(f.originalPath));
      if (originalCount !== scannedFiles.length) {
        console.log(`[ImportController] EXCLUDED ${originalCount - scannedFiles.length} XML files from import (metadata extracted, files NOT copied)`);
        // Update session totals
        session.totalFiles = scannedFiles.length;
      }

      // ========================================
      // STEP 2: HASH (skip for network sources)
      // ========================================
      session.status = 'hashing';
      this.saveSession(session);

      if (isNetworkSource) {
        // Network: skip hashing, will be done inline during copy
        console.log(`[ImportController] Network source - skipping separate hash step`);
        emitProgress({ status: 'hashing', step: 2, totalSteps: 5, percent: 20, currentFile: 'Skipped for network source' });
      } else {
        // Local: hash files to enable duplicate detection before copy
        for (let i = 0; i < scannedFiles.length; i++) {
          if (this.abortController.signal.aborted) break;

          const file = scannedFiles[i];
          emitProgress({
            status: 'hashing',
            step: 2,
            totalSteps: 5,
            percent: 20 + ((i / scannedFiles.length) * 20),
            currentFile: file.filename,
            filesProcessed: i,
            filesTotal: scannedFiles.length,
          });

          try {
            const hashResult = await calculateHash(file.originalPath);
            file.hash = hashResult.hash;

            // Check for duplicate
            const existing = filesRepository.findByHash(hashResult.hash);
            if (existing) {
              file.isDuplicate = true;
              file.duplicateIn = 'files';
              session.duplicateFiles++;
            }
          } catch (error) {
            file.hashError = error instanceof Error ? error.message : String(error);
            session.errorFiles++;
          }
        }
      }

      session.lastStep = 2;
      this.saveSession(session);

      // ========================================
      // STEP 3: COPY - Copy to managed storage
      // ========================================
      session.status = 'copying';
      this.saveSession(session);
      emitProgress({ status: 'copying', step: 3, totalSteps: 5, percent: 40 });

      // Determine the correct base storage path
      // The couple's working_path should be the FULL path to the couple folder
      // e.g., /Volumes/nightfox/weddings/2025/12-31 Julia & Sven
      // We need to extract the base path (parent of couple folder) for CopyService
      const folderName = couple.folder_name || 'unknown';
      let baseStoragePath: string;

      // The couple's working_path contains the FULL path including subdirectories
      // e.g., /Volumes/nightfox/weddings/2025/12-31 Julia & Sven
      // We need to strip the folder_name to get the parent directory
      if (workingPath.endsWith(folderName)) {
        // working_path ends with folder_name - strip it to get parent
        baseStoragePath = workingPath.slice(0, -folderName.length);
        // Remove trailing separator if present
        if (baseStoragePath.endsWith(path.sep)) {
          baseStoragePath = baseStoragePath.slice(0, -1);
        }
      } else if (workingPath.endsWith(path.sep + folderName)) {
        // working_path ends with /folder_name - use dirname
        baseStoragePath = path.dirname(workingPath);
      } else {
        // working_path doesn't contain folder_name - use globalStoragePath or working_path as fallback
        // This handles cases where working_path IS the storage root
        baseStoragePath = globalStoragePath || workingPath;
      }

      const coupleInfo: CouplePathInfo = {
        workingPath: baseStoragePath,
        folderName: folderName,
      };

      // Log all path components for debugging
      console.log(`[ImportController] Copy path setup:`);
      console.log(`  globalStoragePath: ${globalStoragePath}`);
      console.log(`  workingPath (from couple): ${workingPath}`);
      console.log(`  couple.folder_name: ${folderName}`);
      console.log(`  workingPath.endsWith(folderName): ${workingPath.endsWith(folderName)}`);
      console.log(`  baseStoragePath (final): ${baseStoragePath}`);
      console.log(`  Expected dest: ${path.join(baseStoragePath, folderName, 'media')}/...`);

      // Verify storage path is accessible before starting copy
      try {
        const baseStats = await fs.promises.stat(baseStoragePath);
        console.log(`[ImportController] Base storage path exists: ${baseStoragePath}, isDirectory: ${baseStats.isDirectory()}`);

        // Check if couple folder exists, create if not
        const coupleFolderPath = path.join(baseStoragePath, folderName);
        try {
          const coupleStats = await fs.promises.stat(coupleFolderPath);
          console.log(`[ImportController] Couple folder exists: ${coupleFolderPath}, isDirectory: ${coupleStats.isDirectory()}`);
        } catch {
          console.log(`[ImportController] Couple folder does not exist, creating: ${coupleFolderPath}`);
          await fs.promises.mkdir(coupleFolderPath, { recursive: true });
          console.log(`[ImportController] Created couple folder: ${coupleFolderPath}`);
        }
      } catch (pathErr) {
        const e = pathErr as NodeJS.ErrnoException;
        console.error(`[ImportController] Base storage path NOT accessible: ${baseStoragePath}`);
        console.error(`[ImportController] Error: ${e.code} - ${e.message}`);
        throw new Error(`Storage path not accessible: ${baseStoragePath}. Error: ${e.message}`);
      }

      const copyService = createCopyService(coupleInfo, filePaths[0]);

      // Extract metadata and match cameras for each file
      const fileMetadata: Map<string, {
        medium: Medium;
        cameraSlug: string | null;
        cameraId: number | null;
        detectedMake: string | null;
        detectedModel: string | null;
        recordedAt: string | null;
        width: number | null;
        height: number | null;
        duration: number | null;
        frameRate: number | null;
        codec: string | null;
        bitrate: number | null;
        exiftoolJson: string | null;
        ffprobeJson: string | null;
      }> = new Map();

      // Extract metadata for all files first
      for (const file of scannedFiles) {
        if (file.isDuplicate || file.hashError) continue;
        if (file.fileType !== 'video') {
          // Non-video files: minimal metadata
          fileMetadata.set(file.id, {
            medium: 'modern',
            cameraSlug: null,
            cameraId: null,
            detectedMake: null,
            detectedModel: null,
            recordedAt: null,
            width: null,
            height: null,
            duration: null,
            frameRate: null,
            codec: null,
            bitrate: null,
            exiftoolJson: null,
            ffprobeJson: null,
          });
          continue;
        }

        // Video files: full metadata extraction
        let width: number | null = null;
        let height: number | null = null;
        let duration: number | null = null;
        let frameRate: number | null = null;
        let codec: string | null = null;
        let bitrate: number | null = null;
        let detectedMake: string | null = null;
        let detectedModel: string | null = null;
        let recordedAt: string | null = null;
        let exiftoolJson: string | null = null;
        let ffprobeJson: string | null = null;
        let ffprobeCreationTime: Date | null = null;

        try {
          const ffprobeResult = await getVideoMetadata(file.originalPath);
          ffprobeJson = JSON.stringify(ffprobeResult);
          const videoInfo = {
            duration: ffprobeResult.format.duration ? parseFloat(ffprobeResult.format.duration) : 0,
            width: ffprobeResult.streams.find(s => s.codec_type === 'video')?.width ?? 0,
            height: ffprobeResult.streams.find(s => s.codec_type === 'video')?.height ?? 0,
            frameRate: 0,
            codec: ffprobeResult.streams.find(s => s.codec_type === 'video')?.codec_name ?? 'unknown',
            bitrate: ffprobeResult.format.bit_rate ? parseInt(ffprobeResult.format.bit_rate, 10) : null,
          };
          // Parse frame rate
          const videoStream = ffprobeResult.streams.find(s => s.codec_type === 'video');
          if (videoStream?.r_frame_rate) {
            const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
            videoInfo.frameRate = den ? num / den : num;
          }
          width = videoInfo.width;
          height = videoInfo.height;
          duration = videoInfo.duration;
          frameRate = videoInfo.frameRate;
          codec = videoInfo.codec;
          bitrate = videoInfo.bitrate;
          // Extract creation_time from ffprobe as fallback for recorded_at
          ffprobeCreationTime = parseCreationTime(ffprobeResult);
        } catch (e) {
          console.warn(`[ImportController] FFprobe failed for ${file.filename}:`, e);
        }

        try {
          exiftoolJson = await getMetadataJson(file.originalPath);
          const mediaInfo = await getMediaInfo(file.originalPath);
          detectedMake = mediaInfo.make;
          detectedModel = mediaInfo.model;
          // Try ExifTool's createDate first, then fallback to ffprobe creation_time
          recordedAt = mediaInfo.createDate?.toISOString()
            || ffprobeCreationTime?.toISOString()
            || null;
          if (!width && mediaInfo.width) width = mediaInfo.width;
          if (!height && mediaInfo.height) height = mediaInfo.height;
          if (!duration && mediaInfo.duration) duration = mediaInfo.duration;
        } catch (e) {
          console.warn(`[ImportController] ExifTool failed for ${file.filename}:`, e);
          // Even if ExifTool fails, use ffprobe creation_time if available
          if (!recordedAt && ffprobeCreationTime) {
            recordedAt = ffprobeCreationTime.toISOString();
          }
        }

        // Check for XML sidecar data to supplement metadata
        const xmlSidecar = xmlSidecarMap.get(file.filename);
        if (xmlSidecar) {
          console.log(`[ImportController] Found XML sidecar for ${file.filename}`);
          // Use XML data as fallback if ExifTool/FFprobe didn't detect
          if (!detectedMake && xmlSidecar.make) {
            detectedMake = xmlSidecar.make;
          }
          if (!detectedModel && xmlSidecar.model) {
            detectedModel = xmlSidecar.model;
          }
          if (!recordedAt && xmlSidecar.recordedAt) {
            recordedAt = new Date(xmlSidecar.recordedAt).toISOString();
          }
          // Use XML duration/resolution if not detected
          if (!duration && xmlSidecar.duration) {
            duration = xmlSidecar.duration;
          }
          if (!width && xmlSidecar.width) {
            width = xmlSidecar.width;
          }
          if (!height && xmlSidecar.height) {
            height = xmlSidecar.height;
          }
          if (!frameRate && xmlSidecar.frameRate) {
            frameRate = xmlSidecar.frameRate;
          }
        }

        // Detect medium and match camera
        const medium = detectMediumFromMetadata(width, height, codec, frameRate);
        let cameraId: number | null = null;
        let cameraSlug: string | null = null;

        if (cameras.length > 0) {
          const match = matchFileWithDefault(
            file.originalPath,
            cameras,
            medium,
            detectedMake,
            detectedModel
          );
          if (match.camera_id > 0) {
            cameraId = match.camera_id;
            const camera = cameras.find(c => c.id === cameraId);
            cameraSlug = camera ? generateCameraSlug(camera.nickname || camera.name) : null;
          }
        }

        fileMetadata.set(file.id, {
          medium,
          cameraSlug,
          cameraId,
          detectedMake,
          detectedModel,
          recordedAt,
          width,
          height,
          duration,
          frameRate,
          codec,
          bitrate,
          exiftoolJson,
          ffprobeJson,
        });
      }

      // Copy files
      const copyResult = await copyService.copyFiles(
        scannedFiles,
        (file) => {
          const meta = fileMetadata.get(file.id);
          return {
            medium: meta?.medium || 'modern',
            cameraSlug: meta?.cameraSlug || null,
          };
        },
        {
          signal: this.abortController.signal,
          onProgress: (current, total, currentFile) => {
            session.processedFiles = current;
            emitProgress({
              status: 'copying',
              step: 3,
              totalSteps: 5,
              percent: 40 + ((current / total) * 30),
              currentFile,
              filesProcessed: current,
              filesTotal: total,
            });
          },
        }
      );

      session.lastStep = 3;
      this.saveSession(session);

      // ========================================
      // STEP 4: VALIDATE - Re-hash and verify
      // ========================================
      session.status = 'validating';
      this.saveSession(session);
      emitProgress({ status: 'validating', step: 4, totalSteps: 5, percent: 70 });

      const validatorService = createValidatorService();
      const validationResult = await validatorService.validateFiles(
        copyResult.files,
        {
          signal: this.abortController.signal,
          autoRollback: true,
          onProgress: (current, total, currentFile) => {
            emitProgress({
              status: 'validating',
              step: 4,
              totalSteps: 5,
              percent: 70 + ((current / total) * 20),
              currentFile,
              filesProcessed: current,
              filesTotal: total,
            });
          },
        }
      );

      session.lastStep = 4;
      this.saveSession(session);

      // ========================================
      // STEP 5: FINALIZE - Insert to database
      // ========================================
      session.status = 'finalizing';
      this.saveSession(session);
      emitProgress({ status: 'finalizing', step: 5, totalSteps: 5, percent: 90 });

      const processedFiles: ImportResult[] = [];
      let imported = 0;
      let duplicates = 0;
      let skipped = 0;
      let errors = 0;

      // Track earliest date_night recording for auto-setting couple.date_night_date
      let earliestDateNightRecording: string | null = null;

      for (const validatedFile of validationResult.files) {
        // Skip invalid files
        if (!validatedFile.isValid) {
          if (validatedFile.isDuplicate) {
            duplicates++;
          } else {
            errors++;
          }
          processedFiles.push({
            success: false,
            hash: validatedFile.hash || '',
            type: validatedFile.fileType as any,
            duplicate: validatedFile.isDuplicate,
            error: validatedFile.validationError || validatedFile.copyError || undefined,
          });
          continue;
        }

        // Get metadata for this file
        const meta = fileMetadata.get(validatedFile.id);
        if (!meta) {
          errors++;
          processedFiles.push({
            success: false,
            hash: validatedFile.hash || '',
            type: validatedFile.fileType as any,
            duplicate: false,
            error: 'Metadata not found',
          });
          continue;
        }

        // Check for duplicate (for network source where hash was computed during copy)
        if (validatedFile.hash) {
          const existing = filesRepository.findByHash(validatedFile.hash);
          if (existing) {
            duplicates++;
            processedFiles.push({
              success: true,
              hash: validatedFile.hash,
              type: validatedFile.fileType as any,
              duplicate: true,
            });
            continue;
          }
        }

        // Determine footage type (use override if provided, else auto-detect)
        const footageType = footageTypeOverride || determineFootageType(meta.recordedAt, couple);

        // Insert into database
        try {
          const fileData = {
            blake3: validatedFile.hash!,
            original_filename: validatedFile.filename,
            original_path: validatedFile.originalPath,
            managed_path: validatedFile.archivePath,
            extension: validatedFile.extension,
            file_size: validatedFile.size,
            couple_id: coupleId,
            camera_id: meta.cameraId,
            detected_make: meta.detectedMake,
            detected_model: meta.detectedModel,
            medium: meta.medium,
            file_type: validatedFile.fileType,
            footage_type: footageType,
            duration_seconds: meta.duration,
            width: meta.width,
            height: meta.height,
            frame_rate: meta.frameRate,
            codec: meta.codec,
            bitrate: meta.bitrate,
            recorded_at: meta.recordedAt,
          };

          const insertedFile = filesRepository.create(fileData);

          // Save metadata JSON
          if (meta.exiftoolJson || meta.ffprobeJson) {
            filesRepository.saveMetadata(
              insertedFile.id,
              meta.exiftoolJson,
              meta.ffprobeJson
            );
          }

          // Write sidecar JSON next to the file
          if (insertedFile.managed_path) {
            const fileMetadata = filesRepository.getMetadata(insertedFile.id);
            const camera = meta.cameraId ? cameras.find(c => c.id === meta.cameraId) : null;
            await writeSidecar(insertedFile, fileMetadata, camera || null, couple);
          }

          // Generate thumbnail for video files
          if (validatedFile.fileType === 'video' && insertedFile.managed_path) {
            // Derive couple dir from managed_path: /base/couple-folder/source/... -> /base/couple-folder
            const managedPathParts = insertedFile.managed_path.split(path.sep);
            const sourceIndex = managedPathParts.indexOf('media');
            const coupleDir = sourceIndex > 0
              ? managedPathParts.slice(0, sourceIndex).join(path.sep)
              : path.join(baseStoragePath, folderName);

            // Get camera for LUT path (auto-apply LUT from camera profile if available)
            const camera = meta.cameraId ? cameras.find(c => c.id === meta.cameraId) : null;
            const lutPath = camera?.lut_path || undefined;
            if (lutPath) {
              console.log(`[ImportController] Using camera LUT: ${lutPath} (${camera?.name})`);
            }

            // Generate thumbnail and gallery (25%, 50%, 75% frames) with LUT applied
            try {
              const allThumbnailsResult = await generateAllThumbnails(
                insertedFile.managed_path,
                coupleDir,
                insertedFile.blake3,
                { lutPath }
              );
              // Save primary thumbnail path to database
              if (allThumbnailsResult.thumbnail.success && allThumbnailsResult.thumbnail.thumbnailPath) {
                filesRepository.updateThumbnailPath(insertedFile.id, allThumbnailsResult.thumbnail.thumbnailPath);
                console.log(`[ImportController] Saved thumbnail: ${allThumbnailsResult.thumbnail.thumbnailPath}`);
              }
              // Log gallery results
              if (allThumbnailsResult.gallery.success) {
                console.log(`[ImportController] Generated ${allThumbnailsResult.gallery.galleryPaths.length} gallery images`);
              } else if (allThumbnailsResult.gallery.errors.length > 0) {
                console.warn(`[ImportController] Gallery errors: ${allThumbnailsResult.gallery.errors.join(', ')}`);
              }
            } catch (thumbError) {
              console.warn(`[ImportController] Thumbnail generation failed (non-fatal):`, thumbError);
            }

            // Generate 1080p proxy with LUT applied
            // Only exclude NX800 consumer cameras
            const isNx800 = camera?.model?.includes('NX800') || camera?.name?.includes('NX800');

            if (!isNx800) {
              try {
                console.log(`[ImportController] Generating 1080p proxy for ${validatedFile.filename}`);
                const proxyResult = await generateCameraProxy(
                  insertedFile.managed_path,
                  coupleDir,
                  insertedFile.blake3,
                  lutPath
                );
                // Save proxy path to database
                if (proxyResult.success && proxyResult.proxyPath) {
                  filesRepository.updateProxyPath(insertedFile.id, proxyResult.proxyPath);
                  console.log(`[ImportController] Saved proxy path: ${proxyResult.proxyPath} (${proxyResult.durationMs}ms)`);
                }
              } catch (proxyError) {
                console.warn(`[ImportController] Proxy generation failed (non-fatal):`, proxyError);
              }
            }
          }

          imported++;
          processedFiles.push({
            success: true,
            hash: validatedFile.hash!,
            type: validatedFile.fileType as any,
            duplicate: false,
          });

          // Track date_night recordings for auto-setting couple.date_night_date
          if (footageType === 'date_night' && meta.recordedAt) {
            if (!earliestDateNightRecording || meta.recordedAt < earliestDateNightRecording) {
              earliestDateNightRecording = meta.recordedAt;
            }
          }
        } catch (error) {
          errors++;
          processedFiles.push({
            success: false,
            hash: validatedFile.hash || '',
            type: validatedFile.fileType as any,
            duplicate: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Auto-update couple.date_night_date if date_night footage was imported
      // Only set if couple doesn't already have a date_night_date
      if (earliestDateNightRecording && couple && !couple.date_night_date) {
        try {
          // Extract just the date portion (YYYY-MM-DD) from the recorded_at timestamp
          const dateOnly = earliestDateNightRecording.split('T')[0];
          console.log(`[ImportController] Auto-setting date_night_date to ${dateOnly} for couple ${coupleId}`);
          couplesRepository.updateDateNightDate(couple.id, dateOnly);
        } catch (dateError) {
          console.warn(`[ImportController] Failed to update date_night_date (non-fatal):`, dateError);
        }
      }

      // Complete session
      session.status = 'completed';
      session.processedFiles = imported + duplicates;
      session.duplicateFiles = duplicates;
      session.errorFiles = errors;
      this.completeSession(sessionId, 'completed');

      // Sync documents folder (manifest.json, couple.json, cameras.json, etc.)
      if (coupleId && imported > 0) {
        try {
          console.log(`[ImportController] Syncing documents for couple ${coupleId}`);
          await syncCoupleDocuments(coupleId);
        } catch (docError) {
          console.warn(`[ImportController] Document sync failed (non-fatal):`, docError);
        }
      }

      // Notify completion
      if (window && !window.isDestroyed()) {
        window.webContents.send('import:complete', {
          sessionId,
          total: filePaths.length,
          imported,
          duplicates,
          skipped,
          errors,
        });
      }

      this.activeImportId = null;
      this.abortController = null;

      return {
        total: filePaths.length,
        imported,
        duplicates,
        skipped,
        errors,
        files: processedFiles,
      };

    } catch (error) {
      // Handle NetworkFailureError specially
      if (error instanceof NetworkFailureError) {
        console.log(`[ImportController] Network failure - pausing import`);
        session.status = 'paused';
        session.canResume = true;
        session.error = error.message;
        this.saveSession(session);

        if (window && !window.isDestroyed()) {
          window.webContents.send('import:paused', {
            sessionId,
            error: error.message,
            canResume: true,
          });
        }
      } else {
        // Other error - mark as failed
        session.status = 'failed';
        session.canResume = false;
        session.error = error instanceof Error ? error.message : String(error);
        this.completeSession(sessionId, 'failed');

        if (window && !window.isDestroyed()) {
          window.webContents.send('import:error', {
            sessionId,
            error: session.error,
          });
        }
      }

      this.activeImportId = null;
      this.abortController = null;

      throw error;
    }
  }

  /**
   * Import files (catalog only - backward compatible)
   */
  async importFiles(
    filePaths: string[],
    options: ImportControllerOptions = {}
  ): Promise<ImportBatchResult> {
    const { coupleId, copyToManaged, managedStoragePath, window } = options;

    // If copy is requested and we have a couple, use the full pipeline
    if (copyToManaged && coupleId) {
      return this.importFilesWithCopy(filePaths, options);
    }

    // Otherwise, use the original catalog-only flow
    const couple = coupleId ? couplesRepository.findById(coupleId) : null;
    const cameras = camerasRepository.findAllWithPatterns();

    const onProgress = (progress: ImportProgress) => {
      if (window && !window.isDestroyed()) {
        window.webContents.send('import:progress', progress);
      }
    };

    const { importId, promise } = await importService.importFiles(filePaths, {
      coupleId,
      copyToManaged: false,
      managedStoragePath,
      cameras,
      onProgress,
    });

    this.activeImportId = importId;

    const batchResult = await promise;

    // Process results and insert into database
    const processedFiles: ImportResult[] = [];

    for (const result of batchResult.files) {
      if (!result.success) {
        processedFiles.push(result);
        continue;
      }

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

      // Determine footage type
      const footageType = determineFootageType(fileData.recorded_at, couple);
      fileData.footage_type = footageType;

      // Insert into database
      try {
        const insertedFile = filesRepository.create(fileData);

        if (metadataData && (metadataData.exiftool_json || metadataData.ffprobe_json)) {
          filesRepository.saveMetadata(
            insertedFile.id,
            metadataData.exiftool_json,
            metadataData.ffprobe_json
          );
        }

        const { _fileData: _, _metadataData: __, ...cleanResult } = result as any;
        processedFiles.push(cleanResult);
      } catch (error) {
        const { _fileData: _, _metadataData: __, ...cleanResult } = result as any;
        processedFiles.push({
          ...cleanResult,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Recalculate counts
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

    if (this.abortController) {
      this.abortController.abort();
    }

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
