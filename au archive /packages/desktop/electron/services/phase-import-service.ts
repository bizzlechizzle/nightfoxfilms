/**
 * Phase-Based Import Service
 *
 * Implements the whereswaldo11.md spec:
 * LOG IT -> SERIALIZE IT -> COPY & NAME IT -> DUMP
 *
 * Key improvements over file-import-service.ts:
 * - Manifest-driven for recovery/audit
 * - Batch SHA256 calculation (parallel)
 * - Batch ExifTool extraction (single process call)
 * - Single DB transaction at end
 */

import path from 'path';
import fs from 'fs/promises';
import { Worker } from 'worker_threads';
import { CryptoService } from './crypto-service';
import { ExifToolService } from './exiftool-service';
import { FFmpegService } from './ffmpeg-service';
import { PathValidator } from './path-validator';
import { GPSValidator } from './gps-validator';
import { GeocodingService } from './geocoding-service';
import { GPXKMLParser } from './gpx-kml-parser';
import { ImportManifest, type FileType, type ManifestLocation, type ManifestFileEntry, type ManifestSummary } from './import-manifest';
import { SQLiteMediaRepository } from '../repositories/sqlite-media-repository';
import { SQLiteImportRepository } from '../repositories/sqlite-import-repository';
import { SQLiteLocationRepository } from '../repositories/sqlite-location-repository';
import type { Kysely } from 'kysely';
import type { Database } from '../main/database.types';
import { generateId } from '../main/ipc-validation';

export interface PhaseImportInput {
  filePath: string;
  originalName: string;
  locid: string;
  subid?: string | null;
  auth_imp: string | null;
}

export interface PhaseImportOptions {
  verifyChecksums?: boolean;
}

export interface PhaseImportProgress {
  phase: 'log' | 'serialize' | 'copy' | 'dump' | 'complete';
  phaseProgress: number; // 0-100
  currentFile?: string;
  filesProcessed: number;
  totalFiles: number;
}

export interface PhaseImportResult {
  success: boolean;
  importId: string;
  manifestPath: string;
  summary: ManifestSummary;
  errors: string[];
}

// Comprehensive format support
const IMAGE_EXTENSIONS = [
  '.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.gif', '.bmp', '.tiff', '.tif', '.webp',
  '.jp2', '.jpx', '.j2k', '.j2c', '.jxl', '.heic', '.heif', '.hif', '.avif',
  '.psd', '.psb', '.ai', '.eps', '.epsf', '.svg', '.svgz', '.ico', '.cur',
  '.pcx', '.dcx', '.ppm', '.pgm', '.pbm', '.pnm', '.tga', '.icb', '.vda', '.vst',
  '.dds', '.exr', '.hdr', '.dpx', '.cin', '.fits', '.fit', '.fts',
  '.nef', '.nrw', '.cr2', '.cr3', '.crw', '.ciff', '.arw', '.arq', '.srf', '.sr2',
  '.dng', '.orf', '.ori', '.raf', '.rw2', '.raw', '.rwl', '.pef', '.ptx', '.srw',
  '.x3f', '.3fr', '.fff', '.dcr', '.k25', '.kdc', '.mef', '.mos', '.mrw', '.erf',
  '.iiq', '.rwz', '.gpr',
];

const VIDEO_EXTENSIONS = [
  '.mp4', '.m4v', '.m4p', '.mov', '.qt', '.avi', '.divx', '.mkv', '.mka', '.mks',
  '.mk3d', '.webm', '.wmv', '.wma', '.asf', '.flv', '.f4v', '.f4p', '.f4a', '.f4b',
  '.mpg', '.mpeg', '.mpe', '.mpv', '.m2v', '.ts', '.mts', '.m2ts', '.tsv', '.tsa',
  '.vob', '.ifo', '.3gp', '.3g2', '.ogv', '.ogg', '.ogm', '.oga', '.ogx', '.spx',
  '.opus', '.rm', '.rmvb', '.rv', '.dv', '.dif', '.mxf', '.gxf', '.nut', '.roq',
  '.nsv', '.amv', '.swf', '.yuv', '.y4m', '.bik', '.bk2', '.smk', '.dpg', '.pva',
];

const MAP_EXTENSIONS = [
  '.geotiff', '.gtiff', '.gpx', '.kml', '.kmz', '.shp', '.shx', '.dbf', '.prj',
  '.geojson', '.topojson', '.osm', '.mbtiles', '.sid', '.ecw',
];

/**
 * Phase-Based Import Service
 */
export class PhaseImportService {
  private readonly gpxKmlParser: GPXKMLParser;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly cryptoService: CryptoService,
    private readonly exifToolService: ExifToolService,
    private readonly ffmpegService: FFmpegService,
    private readonly mediaRepo: SQLiteMediaRepository,
    private readonly importRepo: SQLiteImportRepository,
    private readonly locationRepo: SQLiteLocationRepository,
    private readonly archivePath: string,
    private readonly allowedImportDirs: string[] = [],
    private readonly geocodingService?: GeocodingService
  ) {
    this.gpxKmlParser = new GPXKMLParser();
  }

  /**
   * Execute a full phase-based import
   */
  async importFiles(
    files: PhaseImportInput[],
    options: PhaseImportOptions = {},
    onProgress?: (progress: PhaseImportProgress) => void,
    abortSignal?: AbortSignal
  ): Promise<PhaseImportResult> {
    const errors: string[] = [];
    const manifest = new ImportManifest(this.archivePath);

    try {
      // Validate files before starting
      for (const file of files) {
        if (!PathValidator.isPathSafe(file.filePath, this.archivePath)) {
          const isAllowed = this.allowedImportDirs.length === 0 ||
            this.allowedImportDirs.some(dir => PathValidator.isPathSafe(file.filePath, dir));
          if (!isAllowed) {
            throw new Error(`Security: File path not allowed: ${file.filePath}`);
          }
        }
      }

      // Get location (BEFORE any transactions - prevents SQLite deadlock)
      const locid = files[0]?.locid;
      if (!locid) throw new Error('No location ID provided');

      console.log('[PhaseImport] Pre-fetching location for locid:', locid);
      const location = await this.locationRepo.findById(locid);
      if (!location) throw new Error(`Location not found: ${locid}`);

      // ADR-046: ManifestLocation no longer needs loc12/slocnam for folder paths
      const manifestLocation: ManifestLocation = {
        locid: location.locid,
        locnam: location.locnam,
        state: location.address?.state || null,
        category: location.category || null,
        gps: location.gps?.lat && location.gps?.lng
          ? { lat: location.gps.lat, lng: location.gps.lng }
          : null,
        address: {
          street: location.address?.street || null,
          city: location.address?.city || null,
          county: location.address?.county || null,
          state: location.address?.state || null,
          zipcode: location.address?.zipcode || null,
        },
      };

      // ====== PHASE 1: LOG IT ======
      console.log('[PhaseImport] ====== PHASE 1: LOG IT ======');
      onProgress?.({
        phase: 'log',
        phaseProgress: 0,
        filesProcessed: 0,
        totalFiles: files.length,
      });

      await manifest.initializePhase1(
        manifestLocation,
        files.map(f => ({ filePath: f.filePath, originalName: f.originalName })),
        {
          verify_checksums: options.verifyChecksums ?? true,
        }
      );

      onProgress?.({
        phase: 'log',
        phaseProgress: 100,
        filesProcessed: files.length,
        totalFiles: files.length,
      });

      if (abortSignal?.aborted) {
        await manifest.fail('Cancelled by user');
        return this.buildResult(manifest, false, ['Import cancelled']);
      }

      // ====== PHASE 2: SERIALIZE IT ======
      console.log('[PhaseImport] ====== PHASE 2: SERIALIZE IT ======');
      await manifest.transitionToPhase2();

      await this.executePhase2(manifest, manifestLocation, files, onProgress, abortSignal);

      if (abortSignal?.aborted) {
        await manifest.fail('Cancelled by user');
        return this.buildResult(manifest, false, ['Import cancelled']);
      }

      // ====== PHASE 3: COPY & NAME IT ======
      console.log('[PhaseImport] ====== PHASE 3: COPY & NAME IT ======');
      await manifest.transitionToPhase3();

      await this.executePhase3(manifest, manifestLocation, files, onProgress, abortSignal);

      if (abortSignal?.aborted) {
        await manifest.fail('Cancelled by user');
        return this.buildResult(manifest, false, ['Import cancelled']);
      }

      // ====== PHASE 4: DUMP ======
      console.log('[PhaseImport] ====== PHASE 4: DUMP ======');
      await manifest.transitionToPhase4();

      await this.executePhase4(manifest, files, onProgress);

      // ====== COMPLETE ======
      await manifest.complete();
      onProgress?.({
        phase: 'complete',
        phaseProgress: 100,
        filesProcessed: files.length,
        totalFiles: files.length,
      });

      return this.buildResult(manifest, true, errors);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(errorMsg);
      await manifest.fail(errorMsg);
      return this.buildResult(manifest, false, errors);
    }
  }

  /**
   * Phase 2: SERIALIZE IT - Batch hash + batch metadata extraction
   */
  private async executePhase2(
    manifest: ImportManifest,
    location: ManifestLocation,
    files: PhaseImportInput[],
    onProgress?: (progress: PhaseImportProgress) => void,
    abortSignal?: AbortSignal
  ): Promise<void> {
    const data = manifest.getData();
    const totalFiles = data.files.length;

    // Step 2.1: Classify files by type
    console.log('[PhaseImport] Phase 2.1: Classifying files...');
    for (let i = 0; i < data.files.length; i++) {
      const file = data.files[i];
      const ext = path.extname(file.original_name).toLowerCase();
      const type = this.getFileType(ext);
      manifest.updateFileMetadata(i, { type });
    }

    // Step 2.2: Batch calculate SHA256 hashes (parallel)
    console.log('[PhaseImport] Phase 2.2: Calculating SHA256 hashes in parallel...');
    const hashPromises = data.files.map(async (file, index) => {
      if (abortSignal?.aborted) return;

      try {
        const hash = await this.cryptoService.calculateSHA256(file.original_path);
        manifest.updateFileMetadata(index, { sha256: hash });

        onProgress?.({
          phase: 'serialize',
          phaseProgress: Math.round(((index + 1) / totalFiles) * 40), // 0-40%
          currentFile: file.original_name,
          filesProcessed: index + 1,
          totalFiles,
        });
      } catch (error) {
        manifest.updateFileMetadata(index, {
          status: 'error',
          error: `Hash failed: ${error instanceof Error ? error.message : 'Unknown'}`,
        });
      }
    });

    await Promise.all(hashPromises);

    // Step 2.3: Check for duplicates
    console.log('[PhaseImport] Phase 2.3: Checking for duplicates...');
    for (let i = 0; i < data.files.length; i++) {
      const file = data.files[i];
      if (!file.sha256 || file.status === 'error') continue;

      const isDuplicate = await this.checkDuplicate(file.sha256, file.type!);
      if (isDuplicate) {
        manifest.updateFileMetadata(i, { is_duplicate: true, status: 'duplicate' });
      }
    }

    // Step 2.4: Batch extract metadata (ExifTool for all, FFmpeg for videos)
    console.log('[PhaseImport] Phase 2.4: Extracting metadata...');
    const nonDuplicateFiles = data.files.filter(f => !f.is_duplicate && f.status !== 'error');

    for (let i = 0; i < nonDuplicateFiles.length; i++) {
      if (abortSignal?.aborted) return;

      const file = nonDuplicateFiles[i];
      const fileIndex = data.files.findIndex(f => f.original_path === file.original_path);

      try {
        const metadata = await this.extractMetadata(file.original_path, file.type!);

        manifest.updateFileMetadata(fileIndex, {
          metadata,
          status: 'serialized',
        });

        // DECISION-013: Always check GPS mismatch when both location and media have GPS
        // This allows users to see when media has better GPS data than the location
        if (metadata?.gps && location.gps) {
          const mismatch = GPSValidator.checkGPSMismatch(
            location.gps,
            metadata.gps,
            10000 // 10km threshold
          );

          if (mismatch.mismatch && mismatch.distance) {
            manifest.updateFileMetadata(fileIndex, {
              gps_warning: {
                message: `GPS differs by ${GPSValidator.formatDistance(mismatch.distance)}`,
                distance: mismatch.distance,
                severity: mismatch.severity as 'minor' | 'major',
                location_gps: location.gps,
                media_gps: metadata.gps,
              },
            });
          }
        }

        onProgress?.({
          phase: 'serialize',
          phaseProgress: 40 + Math.round(((i + 1) / nonDuplicateFiles.length) * 60), // 40-100%
          currentFile: file.original_name,
          filesProcessed: i + 1,
          totalFiles: nonDuplicateFiles.length,
        });

      } catch (error) {
        // Non-fatal - continue without metadata
        console.warn('[PhaseImport] Metadata extraction failed for:', file.original_name, error);
        manifest.updateFileMetadata(fileIndex, { status: 'serialized' });
      }
    }

    await manifest.save();
  }

  /**
   * Phase 3: COPY & NAME IT - Copy files to archive, verify integrity
   */
  private async executePhase3(
    manifest: ImportManifest,
    location: ManifestLocation,
    files: PhaseImportInput[],
    onProgress?: (progress: PhaseImportProgress) => void,
    abortSignal?: AbortSignal
  ): Promise<void> {
    const data = manifest.getData();
    const nonDuplicateFiles = data.files.filter(f => !f.is_duplicate && f.status !== 'error');

    for (let i = 0; i < nonDuplicateFiles.length; i++) {
      if (abortSignal?.aborted) return;

      const file = nonDuplicateFiles[i];
      const fileIndex = data.files.findIndex(f => f.original_path === file.original_path);
      const inputFile = files.find(f => f.filePath === file.original_path);

      if (!file.sha256 || !file.type) continue;

      try {
        const ext = path.extname(file.original_name).toLowerCase();
        const archivePath = await this.copyFileToArchive(
          file.original_path,
          file.sha256,
          ext,
          file.type,
          location,
          inputFile?.subid || null
        );

        // Verify integrity
        let verified = true;
        if (manifest.getData().options.verify_checksums) {
          const verifyHash = await this.cryptoService.calculateSHA256(archivePath);
          verified = verifyHash === file.sha256;

          if (!verified) {
            await fs.unlink(archivePath).catch(() => {});
            throw new Error('Integrity check failed');
          }
        }

        manifest.updateFileCopy(fileIndex, {
          archive_path: archivePath,
          archive_name: path.basename(archivePath),
          verified,
          status: 'verified',
        });

        onProgress?.({
          phase: 'copy',
          phaseProgress: Math.round(((i + 1) / nonDuplicateFiles.length) * 100),
          currentFile: file.original_name,
          filesProcessed: i + 1,
          totalFiles: nonDuplicateFiles.length,
        });

      } catch (error) {
        manifest.updateFileCopy(fileIndex, {
          status: 'error',
          error: `Copy failed: ${error instanceof Error ? error.message : 'Unknown'}`,
        });
      }

      // Yield to event loop
      await new Promise(resolve => setImmediate(resolve));
    }

    await manifest.save();
  }

  /**
   * Phase 4: DUMP - Single database transaction for all records
   */
  private async executePhase4(
    manifest: ImportManifest,
    files: PhaseImportInput[],
    onProgress?: (progress: PhaseImportProgress) => void
  ): Promise<void> {
    const data = manifest.getData();
    const verifiedFiles = data.files.filter(f => f.status === 'verified');

    console.log('[PhaseImport] Phase 4: Inserting', verifiedFiles.length, 'records in single transaction');

    onProgress?.({
      phase: 'dump',
      phaseProgress: 0,
      filesProcessed: 0,
      totalFiles: verifiedFiles.length,
    });

    // Single transaction for all inserts
    await this.db.transaction().execute(async (trx) => {
      for (let i = 0; i < verifiedFiles.length; i++) {
        const file = verifiedFiles[i];
        const fileIndex = data.files.findIndex(f => f.original_path === file.original_path);
        const inputFile = files.find(f => f.filePath === file.original_path);

        if (!file.sha256 || !file.type || !file.archive_path) continue;

        try {
          await this.insertMediaRecord(
            trx,
            inputFile!,
            file.sha256,
            file.type,
            file.archive_path,
            file.archive_name!,
            file.metadata || null
          );

          manifest.updateFileDump(fileIndex, {
            database_id: file.sha256, // Using hash as ID
            status: 'complete',
          });

        } catch (error) {
          console.error('[PhaseImport] Insert failed for:', file.original_name, error);
          manifest.updateFileDump(fileIndex, {
            status: 'error',
          });
        }
      }

      // Create import record
      const summary = manifest.getSummary();
      const importId = manifest.getImportId();
      const importDate = new Date().toISOString();
      const locid = data.location.locid;
      const auth_imp = files[0]?.auth_imp || null;

      await trx
        .insertInto('imports')
        .values({
          import_id: importId,
          locid,
          import_date: importDate,
          auth_imp,
          img_count: summary.images,
          vid_count: summary.videos,
          doc_count: summary.documents,
          map_count: summary.maps,
          notes: `Phase import: ${summary.imported} imported, ${summary.duplicates} duplicates, ${summary.errors} errors`,
        })
        .execute();
    });

    onProgress?.({
      phase: 'dump',
      phaseProgress: 100,
      filesProcessed: verifiedFiles.length,
      totalFiles: verifiedFiles.length,
    });

    await manifest.save();
  }

  /**
   * Build final result from manifest
   */
  private buildResult(
    manifest: ImportManifest,
    success: boolean,
    errors: string[]
  ): PhaseImportResult {
    return {
      success,
      importId: manifest.getImportId(),
      manifestPath: manifest.getManifestPath() || '',
      summary: manifest.getSummary(),
      errors,
    };
  }

  /**
   * Get file type from extension
   */
  private getFileType(ext: string): FileType {
    if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
    if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
    if (MAP_EXTENSIONS.includes(ext)) return 'map';
    return 'document';
  }

  /**
   * Check for duplicate file in database
   */
  private async checkDuplicate(hash: string, type: FileType): Promise<boolean> {
    const table = type === 'image' ? 'imgs'
      : type === 'video' ? 'vids'
      : type === 'map' ? 'maps'
      : 'docs';

    const column = type === 'image' ? 'imghash'
      : type === 'video' ? 'vidhash'
      : type === 'map' ? 'maphash'
      : 'dochash';

    const result = await this.db
      .selectFrom(table as any)
      .select(column as any)
      .where(column as any, '=', hash)
      .executeTakeFirst();

    return !!result;
  }

  /**
   * Extract metadata from file
   */
  private async extractMetadata(
    filePath: string,
    type: FileType
  ): Promise<ManifestFileEntry['metadata']> {
    const metadata: ManifestFileEntry['metadata'] = {};

    try {
      // ExifTool for all file types
      const exifData = await this.exifToolService.extractMetadata(filePath);

      metadata.width = exifData.width;
      metadata.height = exifData.height;
      metadata.date_taken = exifData.dateTaken;
      metadata.camera_make = exifData.cameraMake;
      metadata.camera_model = exifData.cameraModel;
      metadata.gps = exifData.gps;
      metadata.raw_exif = exifData.rawExif;

      // FFmpeg for videos
      if (type === 'video') {
        try {
          const ffmpegData = await this.ffmpegService.extractMetadata(filePath);
          metadata.duration = ffmpegData.duration;
          metadata.codec = ffmpegData.codec;
          metadata.fps = ffmpegData.fps;
          metadata.raw_ffmpeg = JSON.stringify(ffmpegData);
        } catch (error) {
          console.warn('[PhaseImport] FFmpeg extraction failed:', error);
        }
      }

      // GPX/KML for maps
      if (type === 'map') {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.gpx' || ext === '.kml' || ext === '.kmz') {
          try {
            const mapData = await this.gpxKmlParser.parseFile(filePath);
            metadata.map_data = mapData;
            if (mapData.centerPoint) {
              metadata.gps = { lat: mapData.centerPoint.lat, lng: mapData.centerPoint.lng };
            }
          } catch (error) {
            console.warn('[PhaseImport] GPX/KML parsing failed:', error);
          }
        }
      }

    } catch (error) {
      console.warn('[PhaseImport] Metadata extraction failed:', error);
    }

    return metadata;
  }

  /**
   * Copy file to archive with proper folder structure
   * ADR-046: New format: [archive]/locations/[STATE]/[LOCID]/data/org-[type]/
   * Sub-location: [archive]/locations/[STATE]/[LOCID]/data/sloc-[SUBID]/org-[type]/
   */
  private async copyFileToArchive(
    sourcePath: string,
    hash: string,
    ext: string,
    type: FileType,
    location: ManifestLocation,
    subid: string | null
  ): Promise<string> {
    // ADR-046: Build new folder structure
    const state = (location.state || 'XX').toUpperCase();
    const locid = location.locid;

    const typePrefixMap: Record<FileType, string> = {
      image: 'img',
      video: 'vid',
      map: 'map',
      document: 'doc',
    };
    const typePrefix = typePrefixMap[type];
    const mediaFolder = `org-${typePrefix}`;

    // Build path based on whether we have a sub-location
    let targetDir: string;
    if (subid) {
      // Sub-location: [archive]/locations/[STATE]/[LOCID]/data/sloc-[SUBID]/org-[type]/
      targetDir = path.join(
        this.archivePath,
        'locations',
        state,
        locid,
        'data',
        `sloc-${subid}`,
        mediaFolder
      );
    } else {
      // Main location: [archive]/locations/[STATE]/[LOCID]/data/org-[type]/
      targetDir = path.join(
        this.archivePath,
        'locations',
        state,
        locid,
        'data',
        mediaFolder
      );
    }

    const targetPath = path.join(targetDir, `${hash}${ext}`);

    // Validate path doesn't escape archive
    if (!PathValidator.validateArchivePath(targetPath, this.archivePath)) {
      throw new Error(`Security: Target path escapes archive: ${targetPath}`);
    }

    // Create directory and copy
    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(sourcePath, targetPath);

    return targetPath;
  }

  /**
   * Insert media record into database
   */
  private async insertMediaRecord(
    trx: any,
    file: PhaseImportInput,
    hash: string,
    type: FileType,
    archivePath: string,
    archiveName: string,
    metadata: ManifestFileEntry['metadata'] | null
  ): Promise<void> {
    const timestamp = new Date().toISOString();

    if (type === 'image') {
      await trx.insertInto('imgs').values({
        imghash: hash,
        imgnam: archiveName,
        imgnamo: file.originalName,
        imgloc: archivePath,
        imgloco: file.filePath,
        locid: file.locid,
        subid: file.subid || null,
        auth_imp: file.auth_imp,
        imgadd: timestamp,
        meta_exiftool: metadata?.raw_exif || null,
        meta_width: metadata?.width || null,
        meta_height: metadata?.height || null,
        meta_date_taken: metadata?.date_taken || null,
        meta_camera_make: metadata?.camera_make || null,
        meta_camera_model: metadata?.camera_model || null,
        meta_gps_lat: metadata?.gps?.lat || null,
        meta_gps_lng: metadata?.gps?.lng || null,
      }).execute();

    } else if (type === 'video') {
      await trx.insertInto('vids').values({
        vidhash: hash,
        vidnam: archiveName,
        vidnamo: file.originalName,
        vidloc: archivePath,
        vidloco: file.filePath,
        locid: file.locid,
        subid: file.subid || null,
        auth_imp: file.auth_imp,
        vidadd: timestamp,
        meta_ffmpeg: metadata?.raw_ffmpeg || null,
        meta_exiftool: metadata?.raw_exif || null,
        meta_duration: metadata?.duration || null,
        meta_width: metadata?.width || null,
        meta_height: metadata?.height || null,
        meta_codec: metadata?.codec || null,
        meta_fps: metadata?.fps || null,
        meta_date_taken: metadata?.date_taken || null,
        meta_gps_lat: metadata?.gps?.lat || null,
        meta_gps_lng: metadata?.gps?.lng || null,
      }).execute();

    } else if (type === 'map') {
      await trx.insertInto('maps').values({
        maphash: hash,
        mapnam: archiveName,
        mapnamo: file.originalName,
        maploc: archivePath,
        maploco: file.filePath,
        locid: file.locid,
        subid: file.subid || null,
        auth_imp: file.auth_imp,
        mapadd: timestamp,
        meta_exiftool: metadata?.raw_exif || null,
        meta_map: metadata?.map_data ? JSON.stringify(metadata.map_data) : null,
        meta_gps_lat: metadata?.gps?.lat || null,
        meta_gps_lng: metadata?.gps?.lng || null,
        reference: null,
        map_states: null,
        map_verified: 0,
      }).execute();

    } else if (type === 'document') {
      await trx.insertInto('docs').values({
        dochash: hash,
        docnam: archiveName,
        docnamo: file.originalName,
        docloc: archivePath,
        docloco: file.filePath,
        locid: file.locid,
        subid: file.subid || null,
        auth_imp: file.auth_imp,
        docadd: timestamp,
        meta_exiftool: metadata?.raw_exif || null,
        meta_page_count: null,
        meta_author: null,
        meta_title: null,
      }).execute();
    }
  }

  /**
   * Sanitize folder name
   */
  private sanitizeFolderName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }

  /**
   * Generate short location name
   */
  private generateSlocnam(locnam: string): string {
    return this.sanitizeFolderName(locnam).substring(0, 20);
  }

  /**
   * Resume a failed import from manifest
   */
  async resumeImport(
    manifestPath: string,
    onProgress?: (progress: PhaseImportProgress) => void
  ): Promise<PhaseImportResult> {
    const manifest = await ImportManifest.load(manifestPath, this.archivePath);
    const data = manifest.getData();

    console.log('[PhaseImport] Resuming import from phase:', data.status);

    // Reconstruct input files from manifest
    const files: PhaseImportInput[] = data.files.map(f => ({
      filePath: f.original_path,
      originalName: f.original_name,
      locid: data.location.locid,
      subid: null,
      auth_imp: null,
    }));

    // Resume from appropriate phase
    switch (data.status) {
      case 'phase_1_log':
        await manifest.transitionToPhase2();
        // Fall through to phase 2
      case 'phase_2_serialize':
        await this.executePhase2(manifest, data.location, files, onProgress);
        await manifest.transitionToPhase3();
        // Fall through to phase 3
      case 'phase_3_copy':
        await this.executePhase3(manifest, data.location, files, onProgress);
        await manifest.transitionToPhase4();
        // Fall through to phase 4
      case 'phase_4_dump':
        await this.executePhase4(manifest, files, onProgress);
        await manifest.complete();
        break;
      default:
        throw new Error(`Cannot resume from status: ${data.status}`);
    }

    return this.buildResult(manifest, true, []);
  }
}
