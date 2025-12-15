import path from 'path';
import fs from 'fs/promises';
import { CryptoService } from './crypto-service';
import { ExifToolService } from './exiftool-service';
import { FFmpegService } from './ffmpeg-service';
import { PathValidator } from './path-validator';
import { GPSValidator } from './gps-validator';
import { getLogger } from './logger-service';
// FIX 3.3: Import geocoding for #import_address
import { GeocodingService } from './geocoding-service';
// FIX 3.4: Import GPX/KML parser for map files
import { GPXKMLParser, type MapFileData } from './gpx-kml-parser';
// Kanye5: Import preview/thumbnail services for on-import extraction
import { MediaPathService } from './media-path-service';
// DECISION-018: Import region calculation for auto-population
import { calculateRegionFields } from './region-service';
// Centralized enrichment service - THE canonical way to enrich locations from GPS
import { LocationEnrichmentService } from './location-enrichment-service';
import { LocationEntity } from '@au-archive/core';
import { ThumbnailService } from './thumbnail-service';
import { PreviewExtractorService } from './preview-extractor-service';
import { PosterFrameService } from './poster-frame-service';
// OPT-053: Import video proxy service for instant playback (Immich model)
import { generateProxy as generateVideoProxy } from './video-proxy-service';
// OPT-055: Import SRT telemetry service for DJI drone video metadata
import {
  isDjiTelemetry,
  parseDjiSrt,
  findMatchingVideoHash,
  type TelemetrySummary,
} from './srt-telemetry-service';
import { SQLiteMediaRepository } from '../repositories/sqlite-media-repository';
import { SQLiteImportRepository } from '../repositories/sqlite-import-repository';
import { SQLiteLocationRepository } from '../repositories/sqlite-location-repository';
// Migration 69: Timeline service for visit event creation on media import
import { getTimelineService } from '../main/ipc-handlers/timeline';
import type { ImgsTable, VidsTable, DocsTable } from '../main/database.types';
import type { Kysely } from 'kysely';
import type { Database } from '../main/database.types';

export interface ImportFileInput {
  filePath: string;
  originalName: string;
  locid: string;
  subid?: string | null;
  auth_imp: string | null;
  // Migration 25: Activity tracking
  imported_by_id?: string | null;
  imported_by?: string | null;
  media_source?: string | null;
  // Migration 26: Contributor tracking
  is_contributed?: number;           // 0 = author, 1 = contributor
  contribution_source?: string | null; // e.g., "John Smith via text"
}

export interface ImportResult {
  success: boolean;
  hash: string;
  type: 'image' | 'video' | 'map' | 'document' | 'skipped' | 'sidecar';  // 'sidecar' for metadata-only imports
  duplicate: boolean;
  skipped?: boolean;  // True if file was skipped (e.g., .aae, .psd)
  sidecarOnly?: boolean;  // True if only XML metadata was imported, not the media file
  archivePath?: string;
  error?: string;
  gpsWarning?: {
    message: string;
    distance: number;
    severity: 'minor' | 'major';
    locationGPS: { lat: number; lng: number };
    mediaGPS: { lat: number; lng: number };
  };
  // OPT-012: Track non-fatal warnings during import
  warnings?: string[];
  // FIX-PROGRESS: GPS data for post-import enrichment (Steps 8a-8b)
  // Returned from transaction so enrichment can run outside critical path
  _gpsForEnrichment?: { lat: number; lng: number } | null;
  _locid?: string;
  // OPT-059: Video proxy data for post-transaction generation (fixes SQLite deadlock)
  // Proxy generation moved outside transaction because it writes to video_proxies table
  // using main db connection, which would deadlock waiting for transaction to release write lock
  // OPT-077: Added rotation for aspect ratio correction
  _videoProxyData?: {
    vidhash: string;
    archivePath: string;
    width: number;
    height: number;
    rotation?: number | null;
  } | null;
  // Migration 69: Timeline data for visit event creation (post-transaction)
  _timelineData?: {
    locid: string;
    subid: string | null;
    mediaHash: string;
    dateTaken: string | null;
    cameraMake: string | null;
    cameraModel: string | null;
  } | null;
}

export interface ImportSessionResult {
  total: number;
  imported: number;
  duplicates: number;
  skipped: number;     // Files with excluded extensions (.aae, .psd, etc.)
  sidecarOnly: number; // Files where only XML metadata was imported (no media copied)
  errors: number;
  results: ImportResult[];
  importId: string;
}

/**
 * Service for importing media files into the archive
 *
 * @deprecated Use Import v2 system (services/import/) instead.
 * This legacy service will be removed in v1.0.
 *
 * Migration guide:
 * - Import orchestration: Use ImportOrchestrator from services/import/orchestrator.ts
 * - File scanning: Use Scanner from services/import/scanner.ts
 * - Hashing: Use Hasher from services/import/hasher.ts (uses BLAKE3)
 * - File copying: Use Copier from services/import/copier.ts
 * - Validation: Use Validator from services/import/validator.ts
 * - DB commits: Use Finalizer from services/import/finalizer.ts
 * - Job queue: Use JobQueue from services/job-queue.ts
 *
 * Key differences in v2:
 * - 5-step pipeline (Scan → Hash → Copy → Validate → Finalize)
 * - BLAKE3 hashing (16-char) instead of SHA-256 (64-char)
 * - Session-based resume support
 * - Background job queue for post-import processing
 * - Proper exponential backoff for retries
 */
export class FileImportService {
  // Extensions to skip entirely during import (not copied, not logged)
  // .aae = Apple photo adjustments (sidecar metadata, not actual media)
  // .psd/.psb = Photoshop project files (large, not archival media)
  // .acr = Adobe Camera Raw settings (sidecar metadata, not actual media)
  private readonly SKIP_EXTENSIONS = [
    '.aae',                            // Apple photo adjustment sidecar
    '.psd', '.psb',                    // Photoshop project files
    '.acr',                            // Adobe Camera Raw settings
  ];

  // OPT-060: Metadata sidecar extensions - import but auto-hide
  // These files are archived for completeness but hidden from UI by default
  // They contain technical metadata about their parent media files
  // Hidden BEFORE commit to prevent orphan visible metadata files
  private readonly METADATA_EXTENSIONS = [
    '.srt',                            // DJI drone telemetry subtitles
    '.lrf',                            // DJI low-resolution reference frames
    '.thm',                            // Thumbnail/preview files
  ];

  // Comprehensive format support based on ExifTool capabilities
  private readonly IMAGE_EXTENSIONS = [
    // Standard formats
    '.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.gif', '.bmp', '.tiff', '.tif', '.webp',
    '.jp2', '.jpx', '.j2k', '.j2c',    // JPEG 2000
    '.jxl',                            // JPEG XL
    '.heic', '.heif', '.hif',          // Apple HEIF/HEVC
    '.avif',                           // AV1 Image
    // Removed: .psd, .psb - now in SKIP_EXTENSIONS
    '.ai', '.eps', '.epsf',            // Adobe Illustrator/PostScript
    '.svg', '.svgz',                   // Vector
    '.ico', '.cur',                    // Icons
    '.pcx', '.dcx',                    // PC Paintbrush
    '.ppm', '.pgm', '.pbm', '.pnm',    // Netpbm
    '.tga', '.icb', '.vda', '.vst',    // Targa
    '.dds',                            // DirectDraw Surface
    '.exr',                            // OpenEXR
    '.hdr',                            // Radiance HDR
    '.dpx', '.cin',                    // Digital Picture Exchange
    '.fits', '.fit', '.fts',           // Flexible Image Transport
    // RAW camera formats (ExifTool supported - comprehensive list)
    '.nef', '.nrw',                    // Nikon
    '.cr2', '.cr3', '.crw', '.ciff',   // Canon
    '.arw', '.arq', '.srf', '.sr2',    // Sony
    '.dng',                            // Adobe DNG (universal)
    '.orf', '.ori',                    // Olympus
    '.raf',                            // Fujifilm
    '.rw2', '.raw', '.rwl',            // Panasonic/Leica
    '.pef', '.ptx',                    // Pentax
    '.srw',                            // Samsung
    '.x3f',                            // Sigma
    '.3fr', '.fff',                    // Hasselblad
    '.dcr', '.k25', '.kdc',            // Kodak
    '.mef', '.mos',                    // Mamiya/Leaf
    '.mrw',                            // Minolta
    '.erf',                            // Epson
    '.iiq',                            // Phase One
    '.rwz',                            // Rawzor
    '.gpr',                            // GoPro RAW
  ];
  // Comprehensive video format support based on FFprobe/FFmpeg capabilities
  private readonly VIDEO_EXTENSIONS = [
    '.mp4', '.m4v', '.m4p',            // MPEG-4
    '.mov', '.qt',                     // QuickTime
    '.avi', '.divx',                   // AVI
    '.mkv', '.mka', '.mks', '.mk3d',   // Matroska
    '.webm',                           // WebM
    '.wmv', '.wma', '.asf',            // Windows Media
    '.flv', '.f4v', '.f4p', '.f4a', '.f4b', // Flash Video
    '.mpg', '.mpeg', '.mpe', '.mpv', '.m2v', // MPEG
    '.ts', '.mts', '.m2ts', '.tsv', '.tsa', // MPEG Transport Stream
    '.vob', '.ifo',                    // DVD Video
    '.3gp', '.3g2',                    // 3GPP
    '.ogv', '.ogg', '.ogm', '.oga', '.ogx', '.spx', '.opus', // Ogg/Vorbis
    '.rm', '.rmvb', '.rv',             // RealMedia
    '.dv', '.dif',                     // DV Video
    '.mxf',                            // Material eXchange Format
    '.gxf',                            // General eXchange Format
    '.nut',                            // NUT
    '.roq',                            // id RoQ
    '.nsv',                            // Nullsoft
    '.amv',                            // AMV
    '.swf',                            // Flash
    '.yuv', '.y4m',                    // Raw YUV
    '.bik', '.bk2',                    // Bink
    '.smk',                            // Smacker
    '.dpg',                            // Nintendo DS
    '.pva',                            // TechnoTrend PVA
  ];
  private readonly DOCUMENT_EXTENSIONS = [
    '.pdf',                            // Portable Document Format
    '.doc', '.docx', '.docm',          // Microsoft Word
    '.xls', '.xlsx', '.xlsm', '.xlsb', // Microsoft Excel
    '.ppt', '.pptx', '.pptm',          // Microsoft PowerPoint
    '.odt', '.ods', '.odp', '.odg',    // OpenDocument
    '.rtf',                            // Rich Text Format
    '.txt', '.text', '.log',           // Plain text
    '.csv', '.tsv',                    // Data files
    '.epub', '.mobi', '.azw', '.azw3', // E-books
    '.djvu', '.djv',                   // DjVu
    '.xps', '.oxps',                   // XML Paper Specification
  ];
  // Map-specific extensions (historical maps, floor plans, etc.)
  // These are images but stored separately for organizational purposes
  private readonly MAP_EXTENSIONS = [
    '.geotiff', '.gtiff',              // GeoTIFF
    '.gpx',                            // GPS Exchange Format
    '.kml', '.kmz',                    // Google Earth
    '.shp', '.shx', '.dbf', '.prj',    // Shapefile components
    '.geojson', '.topojson',           // GeoJSON
    '.osm',                            // OpenStreetMap
    '.mbtiles',                        // MapBox Tiles
    '.sid', '.ecw',                    // MrSID, ECW compressed imagery
  ];

  // FIX 3.4: GPX/KML parser for map files
  private readonly gpxKmlParser: GPXKMLParser;

  // Kanye5: Services for on-import preview/thumbnail extraction
  private readonly mediaPathService: MediaPathService;
  private readonly thumbnailService: ThumbnailService;
  private readonly previewExtractorService: PreviewExtractorService;
  private readonly posterFrameService: PosterFrameService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly cryptoService: CryptoService,
    private readonly exifToolService: ExifToolService,
    private readonly ffmpegService: FFmpegService,
    private readonly mediaRepo: SQLiteMediaRepository,
    private readonly importRepo: SQLiteImportRepository,
    private readonly locationRepo: SQLiteLocationRepository,
    private readonly archivePath: string,
    private readonly allowedImportDirs: string[] = [], // User's home dir, downloads, etc.
    // FIX 3.3: Optional geocoding service for #import_address
    private readonly geocodingService?: GeocodingService
  ) {
    // FIX 3.4: Initialize GPX/KML parser
    this.gpxKmlParser = new GPXKMLParser();

    // Kanye5: Initialize preview/thumbnail services for on-import extraction
    this.mediaPathService = new MediaPathService(archivePath);
    this.thumbnailService = new ThumbnailService(this.mediaPathService);
    this.previewExtractorService = new PreviewExtractorService(this.mediaPathService, exifToolService);
    this.posterFrameService = new PosterFrameService(this.mediaPathService, ffmpegService);
  }

  /**
   * Import multiple files in a batch
   * FIX 2.2: Per-file transactions - each file is committed independently
   * This allows partial success: if file 5 fails, files 1-4 are already saved
   * FIX 4.3: Supports abort signal for cancellation
   *
   * @deprecated Use ImportOrchestrator.import() instead.
   * Example migration:
   * ```typescript
   * // Old:
   * const result = await fileImportService.importFiles(files, onProgress, abortSignal);
   *
   * // New:
   * const orchestrator = new ImportOrchestrator(db, archivePath);
   * const result = await orchestrator.import(filePaths, location, {
   *   onProgress: (percent, phase) => onProgress(Math.floor(percent * total / 100), total, phase),
   *   signal: abortSignal,
   *   user: { userId, username },
   * });
   * ```
   */
  async importFiles(
    files: ImportFileInput[],
    // FIX 4.1: Progress callback now includes filename
    onProgress?: (current: number, total: number, filename?: string) => void,
    // FIX 4.3: Abort signal for cancellation
    abortSignal?: AbortSignal
  ): Promise<ImportSessionResult> {
    // Validate all file paths before starting
    for (const file of files) {
      if (!PathValidator.isPathSafe(file.filePath, this.archivePath)) {
        // Check if file is in allowed import directories
        const isAllowed = this.allowedImportDirs.length === 0 ||
          this.allowedImportDirs.some(dir => PathValidator.isPathSafe(file.filePath, dir));

        if (!isAllowed) {
          throw new Error(`Security: File path not allowed: ${file.filePath}`);
        }
      }
    }

    const logger = getLogger();
    const startTime = Date.now();

    // FIX 11: PRE-FETCH location ONCE before starting any file imports
    // All files in one import go to the same location, so we only need to fetch it once
    // CRITICAL: This MUST happen BEFORE any transactions to avoid SQLite deadlock
    // (whereswaldo11 identified this as the root cause of the import hang)
    const locid = files[0]?.locid;
    if (!locid) {
      throw new Error('No location ID provided');
    }

    const location = await this.locationRepo.findById(locid);
    if (!location) {
      throw new Error(`Location not found: ${locid}`);
    }

    logger.info('FileImport', `Starting batch import of ${files.length} files to ${location.locnam}`);

    // FIX 2.2: Per-file transactions instead of wrapping all files in one transaction
    const results: ImportResult[] = [];
    let imported = 0;
    let duplicates = 0;
    let errors = 0;
    let skipped = 0;  // Files with excluded extensions (.aae, .psd, etc.)
    let sidecarOnly = 0;  // Files where only XML metadata was imported (no media copied)

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // FIX 4.3: Check for cancellation before each file
      if (abortSignal?.aborted) {
        logger.info('FileImport', `Import cancelled by user after ${i} files`);
        break;
      }

      try {
        // FIX 2.2: Each file gets its own transaction - committed on success, rolled back on failure
        // FIX 11: Pass pre-fetched location to avoid DB calls inside transaction (prevents deadlock)
        const result = await this.db.transaction().execute(async (trx) => {
          return await this.importSingleFile(file, trx, location);
        });
        results.push(result);

        if (result.success) {
          if (result.skipped) {
            skipped++;
          } else if (result.sidecarOnly) {
            sidecarOnly++;
          } else if (result.duplicate) {
            duplicates++;
          } else {
            imported++;
          }
        } else {
          errors++;
        }

        // FIX 1.2 & 4.1: Report progress AFTER work completes with filename
        if (onProgress) {
          onProgress(i + 1, files.length, file.originalName);
        }

        // FIX-PROGRESS: Run Steps 8a-8b as fire-and-forget AFTER progress fires
        // Per docs/workflows/import.md: "Background job for metadata extraction (doesn't block)"
        if (result.success && !result.duplicate && result._gpsForEnrichment && result._locid) {
          this.runPostImportEnrichment(result._locid, result._gpsForEnrichment, location).catch(err => {
            logger.warn('FileImport', 'Post-import enrichment failed (non-blocking)', { error: String(err) });
          });
        }

        // OPT-059: Generate video proxy fire-and-forget AFTER progress fires
        // CRITICAL: This runs OUTSIDE the transaction to avoid SQLite deadlock
        // The proxy generation writes to video_proxies table using main db connection
        // OPT-077: Pass rotation for aspect ratio correction
        if (result.success && !result.duplicate && result._videoProxyData) {
          const proxyData = result._videoProxyData;
          generateVideoProxy(
            this.db,
            this.archivePath,
            proxyData.vidhash,
            proxyData.archivePath,
            { width: proxyData.width, height: proxyData.height, rotation: proxyData.rotation }
          ).then(proxyResult => {
            if (!proxyResult.success) {
              logger.warn('FileImport', 'Video proxy generation failed (non-fatal)', { error: proxyResult.error });
            }
          }).catch(err => {
            logger.warn('FileImport', 'Video proxy generation error (non-fatal)', { error: String(err) });
          });
        }

        // Migration 69: Create/update visit event for timeline fire-and-forget
        // CRITICAL: This runs OUTSIDE the transaction to avoid SQLite deadlock
        // Creates or updates visit events based on media date taken
        if (result.success && !result.duplicate && result._timelineData) {
          const timelineData = result._timelineData;
          const timelineService = getTimelineService();

          // DEBUG: Log timeline service state
          if (!timelineService) {
            logger.warn('FileImport', 'Timeline service not initialized - visit event skipped', {
              locid: timelineData.locid,
              dateTaken: timelineData.dateTaken,
            });
          } else if (!timelineData.dateTaken) {
            logger.debug('FileImport', 'No date taken - visit event skipped', {
              locid: timelineData.locid,
              mediaHash: timelineData.mediaHash,
            });
          }

          if (timelineService && timelineData.dateTaken) {
            timelineService.handleMediaImport(
              timelineData.locid,
              timelineData.subid,
              timelineData.mediaHash,
              timelineData.dateTaken,
              timelineData.cameraMake,
              timelineData.cameraModel,
              file.imported_by_id || undefined
            ).then(event => {
              if (event) {
                logger.info('FileImport', `Timeline visit event ${event.user_approved ? 'created/updated (approved)' : 'pending approval'} for date ${event.date_display}`);
              }
            }).catch(err => {
              logger.warn('FileImport', 'Timeline event creation failed (non-fatal)', { error: String(err) });
            });
          }
        }
      } catch (error) {
        logger.error('FileImport', `Error importing file ${file.originalName}`, error instanceof Error ? error : undefined);
        // FIX 1.1: Use 'document' instead of 'unknown' (valid type union value)
        results.push({
          success: false,
          hash: '',
          type: 'document',
          duplicate: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        errors++;

        // FIX 1.2 & 4.1: Report progress on error too with filename
        if (onProgress) {
          onProgress(i + 1, files.length, file.originalName);
        }
      }

      // FIX 2.1: Yield to event loop between files to prevent UI freeze
      await new Promise(resolve => setImmediate(resolve));
    }

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info('FileImport', `Batch complete: ${imported} imported, ${duplicates} duplicates, ${skipped} skipped, ${errors} errors (${durationSec}s)`);

    // Create import record in separate transaction (after all files processed)
    // NOTE: locid already pre-fetched at line 204, use auth_imp from first file
    const auth_imp = files[0]?.auth_imp || null;
    const imgCount = results.filter((r) => r.type === 'image' && !r.duplicate).length;
    const vidCount = results.filter((r) => r.type === 'video' && !r.duplicate).length;
    const mapCount = results.filter((r) => r.type === 'map' && !r.duplicate).length;
    const docCount = results.filter((r) => r.type === 'document' && !r.duplicate).length;

    // Create import record in its own transaction
    const importId = await this.db.transaction().execute(async (trx) => {
      return await this.createImportRecordInTransaction(trx, {
        locid,
        auth_imp,
        img_count: imgCount,
        vid_count: vidCount,
        map_count: mapCount,
        doc_count: docCount,
        notes: `Imported ${imported} files, ${duplicates} duplicates, ${skipped} skipped, ${sidecarOnly} sidecar-only, ${errors} errors`,
      });
    });

    // Auto-detect and hide Live Photo videos and SDR duplicates
    // Runs after all files imported so we can match pairs
    console.log('[FileImport] Step 10: Detecting Live Photos and SDR duplicates...');
    await this.detectAndHideLivePhotosAndSDR(locid);

    // OPT-055: Process SRT telemetry files and link to matching videos
    // Runs after all files imported so SRT can find its matching video
    console.log('[FileImport] Step 10b: Processing SRT telemetry files (OPT-055)...');
    await this.processSrtTelemetryFiles(locid);

    // Step 11: Auto-set hero image if location has no hero and we imported images
    // This ensures dashboard thumbnails appear immediately after first import
    if (imported > 0) {
      try {
        const locationForHero = await this.locationRepo.findById(locid);
        if (locationForHero && !locationForHero.hero_imghash) {
          // Find the first successfully imported image (not duplicate, not skipped)
          const firstImage = results.find(r => r.type === 'image' && r.success && !r.duplicate && !r.skipped);
          if (firstImage && firstImage.hash) {
            await this.db
              .updateTable('locs')
              .set({ hero_imghash: firstImage.hash })
              .where('locid', '=', locid)
              .execute();
            console.log('[FileImport] Step 11: Auto-set hero image:', firstImage.hash.slice(0, 12) + '...');
          }
        }
      } catch (heroError) {
        // Non-fatal - don't fail import if auto-hero fails
        console.warn('[FileImport] Step 11: Auto-hero failed (non-fatal):', heroError);
      }
    }

    // Step 11b: Auto-set hero image for sub-location (OPT-061)
    // When importing to a sub-location, also set the sub-location's hero image
    // This ensures sub-location thumbnails appear on the host location page immediately
    const subid = files[0]?.subid;
    if (subid && imported > 0) {
      try {
        const subLocation = await this.db
          .selectFrom('slocs')
          .select(['subid', 'hero_imghash'])
          .where('subid', '=', subid)
          .executeTakeFirst();

        if (subLocation && !subLocation.hero_imghash) {
          // Find the first successfully imported image (not duplicate, not skipped)
          const firstImage = results.find(r => r.type === 'image' && r.success && !r.duplicate && !r.skipped);
          if (firstImage && firstImage.hash) {
            await this.db
              .updateTable('slocs')
              .set({ hero_imghash: firstImage.hash })
              .where('subid', '=', subid)
              .execute();
            console.log('[FileImport] Step 11b: Auto-set sub-location hero image:', firstImage.hash.slice(0, 12) + '...');
          }
        }
      } catch (subHeroError) {
        // Non-fatal - don't fail import if sub-location auto-hero fails
        console.warn('[FileImport] Step 11b: Sub-location auto-hero failed (non-fatal):', subHeroError);
      }
    }

    return {
      total: files.length,
      imported,
      duplicates,
      skipped,
      sidecarOnly,
      errors,
      results,
      importId,
    };
  }

  /**
   * Detect and auto-hide Live Photo videos and SDR duplicates for a location
   * - iPhone Live Photos: .MOV with matching .HEIC/.JPG filename
   * - Android Motion Photos: .mp4 with matching image (YYYYMMDD_HHMMSS pattern)
   * - SDR duplicates: Files with _SDR suffix when HDR version exists
   */
  private async detectAndHideLivePhotosAndSDR(locid: string): Promise<void> {
    try {
      // Get all images and videos for this location
      const images = await this.mediaRepo.getImageFilenamesByLocation(locid);
      const videos = await this.mediaRepo.getVideoFilenamesByLocation(locid);

      console.log(`[FileImport] Scanning ${images.length} images and ${videos.length} videos for Live Photos/SDR`);

      // Build set of image base names (without extension) for fast lookup
      const imageBaseNames = new Map<string, string>(); // baseName -> imghash
      for (const img of images) {
        const baseName = this.getBaseFilename(img.imgnamo);
        imageBaseNames.set(baseName.toLowerCase(), img.imghash);
      }

      // Detect Live Photo videos (MOV/MP4 with matching image)
      let livePhotosHidden = 0;
      for (const vid of videos) {
        const ext = path.extname(vid.vidnamo).toLowerCase();
        // iPhone: .MOV, Android: .mp4
        if (ext === '.mov' || ext === '.mp4') {
          const baseName = this.getBaseFilename(vid.vidnamo).toLowerCase();
          // Check if there's a matching image
          if (imageBaseNames.has(baseName)) {
            // This is a Live Photo video - hide it and mark both as live photo
            await this.mediaRepo.setVideoHidden(vid.vidhash, true, 'live_photo');
            await this.mediaRepo.setVideoLivePhoto(vid.vidhash, true);
            // Also mark the image as a live photo (but don't hide it)
            const imghash = imageBaseNames.get(baseName);
            if (imghash) {
              await this.mediaRepo.setImageLivePhoto(imghash, true);
            }
            livePhotosHidden++;
            console.log(`[FileImport] Live Photo detected: ${vid.vidnamo} -> hidden`);
          }
        }
      }

      // Detect SDR duplicates (files with _SDR when HDR exists)
      let sdrHidden = 0;
      for (const img of images) {
        const filename = img.imgnamo;
        // Check for _SDR suffix (case insensitive)
        if (/_sdr\./i.test(filename)) {
          // Check if HDR version exists
          const hdrFilename = filename.replace(/_sdr\./i, '.');
          const hdrBaseName = this.getBaseFilename(hdrFilename).toLowerCase();
          // Also check for explicit _HDR version
          const hdrExplicitFilename = filename.replace(/_sdr\./i, '_HDR.');
          const hdrExplicitBaseName = this.getBaseFilename(hdrExplicitFilename).toLowerCase();

          if (imageBaseNames.has(hdrBaseName) || imageBaseNames.has(hdrExplicitBaseName)) {
            await this.mediaRepo.setImageHidden(img.imghash, true, 'sdr_duplicate');
            sdrHidden++;
            console.log(`[FileImport] SDR duplicate detected: ${filename} -> hidden`);
          }
        }
      }

      // Check EXIF for Android Motion Photos (MotionPhoto=1)
      // This is an info flag, not hiding (video is embedded, nothing to hide)
      for (const img of images) {
        try {
          // Query the raw EXIF data from database
          const imgData = await this.mediaRepo.findImageByHash(img.imghash);
          if (imgData?.meta_exiftool) {
            const exif = JSON.parse(imgData.meta_exiftool);
            if (exif.MotionPhoto === 1 || exif.MicroVideo || exif.MicroVideoOffset) {
              await this.mediaRepo.setImageLivePhoto(img.imghash, true);
              console.log(`[FileImport] Android Motion Photo detected: ${img.imgnamo}`);
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      }

      console.log(`[FileImport] Detection complete: ${livePhotosHidden} Live Photo videos hidden, ${sdrHidden} SDR duplicates hidden`);
    } catch (error) {
      console.warn('[FileImport] Live Photo/SDR detection failed (non-fatal):', error);
    }
  }

  /**
   * OPT-055: Process SRT telemetry files and link to matching videos
   * OPT-060: Also ensures all metadata files (.srt, .lrf) are hidden
   * - Finds all .srt/.lrf documents for the location
   * - Ensures they are hidden (safety net for pre-existing data)
   * - Checks if SRTs are DJI telemetry format
   * - Parses telemetry and stores summary on matching video record
   * - Hides files REGARDLESS of telemetry parse success (they're still metadata)
   */
  private async processSrtTelemetryFiles(locid: string): Promise<void> {
    try {
      // Get all documents for this location (metadata files are imported as documents)
      const docs = await this.db
        .selectFrom('docs')
        .select(['dochash', 'docnam', 'docnamo', 'docloc', 'hidden'])
        .where('locid', '=', locid)
        .execute();

      // Filter to metadata files (.srt, .lrf, .thm)
      const metadataDocs = docs.filter(doc => {
        const ext = path.extname(doc.docnamo).toLowerCase();
        return this.METADATA_EXTENSIONS.includes(ext);
      });

      if (metadataDocs.length === 0) {
        console.log('[FileImport] No metadata sidecar files found for location');
        return;
      }

      console.log(`[FileImport] Found ${metadataDocs.length} metadata sidecar files to process`);

      // OPT-060: First, ensure ALL metadata files are hidden (safety net)
      // This catches any files that weren't hidden during import (pre-existing data)
      let hiddenCount = 0;
      for (const doc of metadataDocs) {
        if (!doc.hidden) {
          await this.db
            .updateTable('docs')
            .set({ hidden: 1, hidden_reason: 'metadata_sidecar' })
            .where('dochash', '=', doc.dochash)
            .execute();
          hiddenCount++;
          console.log(`[FileImport] OPT-060: Hidden metadata file (safety net): ${doc.docnamo}`);
        }
      }
      if (hiddenCount > 0) {
        console.log(`[FileImport] OPT-060: Hidden ${hiddenCount} previously visible metadata files`);
      }

      // Filter to just .srt files for telemetry processing
      const srtDocs = metadataDocs.filter(doc =>
        doc.docnamo.toLowerCase().endsWith('.srt')
      );

      if (srtDocs.length === 0) {
        console.log('[FileImport] No SRT files to check for telemetry');
        return;
      }

      // Get all videos for this location (for matching by filename)
      const videos = await this.db
        .selectFrom('vids')
        .select(['vidhash', 'vidnamo'])
        .where('locid', '=', locid)
        .execute();

      if (videos.length === 0) {
        console.log('[FileImport] No videos found for location, skipping SRT telemetry linking');
        return;
      }

      let telemetryLinked = 0;

      for (const srtDoc of srtDocs) {
        try {
          // Read SRT file content
          const content = await fs.readFile(srtDoc.docloc, 'utf-8');

          // Check if it's DJI telemetry format
          if (!isDjiTelemetry(content)) {
            console.log(`[FileImport] SRT is standard subtitle format (not telemetry): ${srtDoc.docnamo}`);
            // File is still hidden (done above), just not telemetry
            continue;
          }

          console.log(`[FileImport] DJI telemetry detected: ${srtDoc.docnamo}`);

          // Parse telemetry
          const telemetry = parseDjiSrt(content, srtDoc.docnamo);

          // Find matching video by filename (DJI_0001.SRT -> DJI_0001.MP4)
          const matchingVidsha = findMatchingVideoHash(srtDoc.docnamo, videos);

          if (!matchingVidsha) {
            console.log(`[FileImport] No matching video found for SRT: ${srtDoc.docnamo}`);
            // File is still hidden (done above), just no matching video
            continue;
          }

          // Store telemetry summary on video record
          await this.db
            .updateTable('vids')
            .set({ srt_telemetry: JSON.stringify(telemetry) })
            .where('vidhash', '=', matchingVidsha)
            .execute();

          telemetryLinked++;
          console.log(`[FileImport] Telemetry linked: ${srtDoc.docnamo} -> video (${telemetry.frames} frames, ${telemetry.duration_sec}s)`);

          // Log GPS bounds if available
          if (telemetry.gps_bounds) {
            const bounds = telemetry.gps_bounds;
            console.log(`[FileImport]   GPS bounds: (${bounds.min_lat.toFixed(4)}, ${bounds.min_lng.toFixed(4)}) to (${bounds.max_lat.toFixed(4)}, ${bounds.max_lng.toFixed(4)})`);
          }
          if (telemetry.altitude_range) {
            console.log(`[FileImport]   Altitude: ${telemetry.altitude_range.min_m}m - ${telemetry.altitude_range.max_m}m`);
          }
        } catch (srtError) {
          // OPT-060: Even if telemetry parsing fails, file stays hidden (done above)
          console.warn(`[FileImport] Failed to process SRT file ${srtDoc.docnamo} (file remains hidden):`, srtError);
          // Continue with other SRT files
        }
      }

      console.log(`[FileImport] SRT telemetry processing complete: ${telemetryLinked} files linked to videos`);
    } catch (error) {
      console.warn('[FileImport] SRT telemetry processing failed (non-fatal):', error);
    }
  }

  /**
   * Get base filename without extension
   */
  private getBaseFilename(filename: string): string {
    const ext = path.extname(filename);
    return path.basename(filename, ext);
  }

  /**
   * Import a single file with transaction support
   * CRITICAL: Validates path, checks GPS mismatch, uses transaction
   * FIX 11: Location is now passed as parameter (pre-fetched in importFiles) to avoid SQLite deadlock
   */
  private async importSingleFile(
    file: ImportFileInput,
    trx: any, // Transaction context
    location: any // FIX 11: Pre-fetched location from importFiles() - do NOT fetch again inside transaction!
  ): Promise<ImportResult> {
    const logger = getLogger();

    // FIX 11: Location is now pre-fetched in importFiles() and passed as parameter
    // This prevents SQLite deadlock that occurred when fetching inside a transaction

    // 1. Validate file path security
    const sanitizedName = PathValidator.sanitizeFilename(file.originalName);

    // 1b. Check for skipped extensions (e.g., .aae, .psd)
    const fileExt = path.extname(sanitizedName).toLowerCase();
    if (this.shouldSkipFile(fileExt)) {
      return {
        success: true,
        hash: '',
        type: 'skipped',
        duplicate: false,
        skipped: true,
      };
    }

    // 1c. Check for XML sidecar - if found, import metadata only (no media file)
    const xmlSidecar = await this.findXmlSidecar(file.filePath);
    if (xmlSidecar) {
      const mediaType = this.getFileType(fileExt);
      return await this.importSidecarOnly(trx, file, xmlSidecar, mediaType);
    }

    // 2. Calculate SHA256 hash (only once)
    const hash = await this.cryptoService.calculateSHA256(file.filePath);

    // 3. Determine file type (image -> video -> map -> document)
    // We accept ALL files - unknown extensions default to 'document'
    const ext = path.extname(sanitizedName).toLowerCase();
    const type = this.getFileType(ext);

    // 4. Check for duplicates
    const isDuplicate = await this.checkDuplicateInTransaction(trx, hash, type);

    if (isDuplicate) {
      return {
        success: true,
        hash,
        type,
        duplicate: true,
      };
    }

    // 5. Extract metadata
    let metadata: any = null;
    let gpsWarning: ImportResult['gpsWarning'] = undefined;
    // OPT-012: Track non-fatal warnings during import
    const warnings: string[] = [];

    try {
      // FIX 3.1 & 3.2: Extract metadata from ALL file types using ExifTool
      // ExifTool works on images, videos (GPS from dashcams), documents (PDF metadata), and maps
      const exifData = await this.exifToolService.extractMetadata(file.filePath);

      if (type === 'image') {
        metadata = exifData;
      } else if (type === 'video') {
        // For videos, also get FFmpeg data for duration, codec, etc.
        const ffmpegData = await this.ffmpegService.extractMetadata(file.filePath);

        // Merge: FFmpeg data + GPS from ExifTool
        metadata = {
          ...ffmpegData,
          gps: exifData?.gps || null,
          rawExif: exifData?.rawExif || null,
        };
      } else if (type === 'map') {
        // FIX 3.4: Parse GPX/KML files for GPS data
        const ext = path.extname(file.filePath).toLowerCase();
        if (ext === '.gpx' || ext === '.kml' || ext === '.kmz') {
          console.log('[FileImport] Parsing GPX/KML file...');
          const mapData = await this.gpxKmlParser.parseFile(file.filePath);
          console.log('[FileImport] GPX/KML parsed:', this.gpxKmlParser.getSummary(mapData));

          metadata = {
            ...exifData,
            mapData,
            gps: mapData.centerPoint ? { lat: mapData.centerPoint.lat, lng: mapData.centerPoint.lng } : null,
          };
        } else {
          // Other map formats (GeoTIFF, etc.) - just use ExifTool
          metadata = exifData;
        }
      } else if (type === 'document') {
        // FIX 3.1: Store ExifTool metadata for documents
        metadata = exifData;
      }

      // Check GPS mismatch for types with GPS data (images, videos, and maps can have GPS)
      if (type === 'image' || type === 'video' || type === 'map') {
        const gps = metadata?.gps || exifData?.gps;
        if (gps && GPSValidator.isValidGPS(gps.lat, gps.lng)) {
          console.log('[FileImport] Step 5b: Checking GPS mismatch...');

          // DECISION-013: Always check GPS mismatch when both location and media have GPS
          // This allows users to see when media has better GPS data than the location
          if (location.gps?.lat && location.gps?.lng) {
            const mismatch = GPSValidator.checkGPSMismatch(
              { lat: location.gps.lat, lng: location.gps.lng },
              { lat: gps.lat, lng: gps.lng },
              10000 // 10km threshold
            );

            if (mismatch.mismatch && mismatch.distance) {
              gpsWarning = {
                message: `GPS coordinates differ by ${GPSValidator.formatDistance(mismatch.distance)}`,
                distance: mismatch.distance,
                severity: mismatch.severity as 'minor' | 'major',
                locationGPS: { lat: location.gps.lat, lng: location.gps.lng },
                mediaGPS: { lat: gps.lat, lng: gps.lng },
              };
            }
          }
          console.log('[FileImport] GPS check complete');

          // NOTE: Geocoding moved to Step 8 (after file copy) per spec: LOG IT → SERIALIZE IT → COPY & NAME IT → DUMP
          // GPS → Address is part of DUMP phase, not metadata extraction phase
        }
      }
    } catch (error) {
      // OPT-012: Track metadata extraction failure as warning
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn('[FileImport] Failed to extract metadata:', errorMsg);
      warnings.push(`Metadata extraction failed: ${errorMsg}`);
      // Continue without metadata
    }

    // Store GPS data for post-copy geocoding (Step 8)
    const gpsForGeocode = (type === 'image' || type === 'video' || type === 'map')
      ? (metadata?.gps || null)
      : null;

    // Kanye5/Kanye3: Step 5d - Extract preview for RAW files and generate multi-tier thumbnails
    let rawPreviewPath: string | null = null;
    let thumbPathSm: string | null = null;
    let thumbPathLg: string | null = null;
    let previewPath: string | null = null;

    if (type === 'image') {
      // Extract embedded JPEG preview from RAW files
      if (this.previewExtractorService.isRawFormat(file.filePath)) {
        console.log('[FileImport] Step 5d: Extracting RAW preview...');
        const previewStart = Date.now();
        try {
          rawPreviewPath = await this.previewExtractorService.extractPreview(file.filePath, hash);
          if (rawPreviewPath) {
            console.log('[FileImport] Preview extracted in', Date.now() - previewStart, 'ms:', rawPreviewPath);
          } else {
            console.log('[FileImport] No embedded preview found (will use original for viewing)');
          }
        } catch (previewError) {
          // OPT-012: Track preview extraction failure as warning
          const errMsg = previewError instanceof Error ? previewError.message : String(previewError);
          console.warn('[FileImport] Preview extraction failed:', errMsg);
          warnings.push(`RAW preview extraction failed: ${errMsg}`);
        }
      }

      // Kanye3: Generate multi-tier thumbnails (400px, 800px, 1920px)
      console.log('[FileImport] Step 5e: Generating multi-tier thumbnails (Premium Archive)...');
      const thumbStart = Date.now();
      try {
        const sourceForThumb = rawPreviewPath || file.filePath;
        const thumbnails = await this.thumbnailService.generateAllSizes(sourceForThumb, hash);
        thumbPathSm = thumbnails.thumb_sm;
        thumbPathLg = thumbnails.thumb_lg;
        previewPath = thumbnails.preview;
        console.log('[FileImport] Multi-tier thumbnails generated in', Date.now() - thumbStart, 'ms');
        console.log(`  - thumb_sm (400px): ${thumbPathSm ? 'OK' : 'NULL'}`);
        console.log(`  - thumb_lg (800px): ${thumbPathLg ? 'OK' : 'NULL'}`);
        console.log(`  - preview (1920px): ${previewPath ? 'OK' : 'NULL'}`);
      } catch (thumbError) {
        // OPT-012: Track thumbnail generation failure as warning
        const errMsg = thumbError instanceof Error ? thumbError.message : String(thumbError);
        console.warn('[FileImport] Multi-tier thumbnail generation failed:', errMsg);
        warnings.push(`Thumbnail generation failed: ${errMsg}`);
      }
    } else if (type === 'video') {
      // Generate poster frame for videos, then generate multi-tier from poster
      console.log('[FileImport] Step 5d: Generating video poster frame...');
      const posterStart = Date.now();
      try {
        const posterPath = await this.posterFrameService.generatePoster(file.filePath, hash);
        if (posterPath) {
          console.log('[FileImport] Poster frame generated in', Date.now() - posterStart, 'ms:', posterPath);
          // Generate multi-tier thumbnails from poster frame
          const thumbnails = await this.thumbnailService.generateAllSizes(posterPath, hash);
          thumbPathSm = thumbnails.thumb_sm;
          thumbPathLg = thumbnails.thumb_lg;
          previewPath = thumbnails.preview;
        }
      } catch (posterError) {
        // OPT-012: Track poster frame generation failure as warning
        const errMsg = posterError instanceof Error ? posterError.message : String(posterError);
        console.warn('[FileImport] Poster frame generation failed:', errMsg);
        warnings.push(`Video poster frame generation failed: ${errMsg}`);
      }
    } else if (type === 'map') {
      // Maps can have thumbnails too (for image-based maps like scans)
      const isImageMap = /\.(jpg|jpeg|png|gif|webp|tiff?)$/i.test(file.filePath);
      if (isImageMap) {
        console.log('[FileImport] Step 5d: Generating map thumbnails...');
        try {
          const thumbnails = await this.thumbnailService.generateAllSizes(file.filePath, hash);
          thumbPathSm = thumbnails.thumb_sm;
          thumbPathLg = thumbnails.thumb_lg;
          previewPath = thumbnails.preview;
        } catch (thumbError) {
          // OPT-012: Track map thumbnail generation failure as warning
          const errMsg = thumbError instanceof Error ? thumbError.message : String(thumbError);
          console.warn('[FileImport] Map thumbnail generation failed:', errMsg);
          warnings.push(`Map thumbnail generation failed: ${errMsg}`);
        }
      }
    }

    // 6. Organize file to archive (validate path)
    // Pass pre-fetched location to avoid another DB call inside transaction
    console.log('[FileImport] Step 6: Organizing file to archive...');
    const organizeStart = Date.now();
    const { path: archivePath, fileSizeBytes } = await this.organizeFileWithLocation(file, hash, ext, type, location);
    console.log('[FileImport] Step 6 complete in', Date.now() - organizeStart, 'ms, path:', archivePath, 'size:', fileSizeBytes);

    // 7. Insert record in database using transaction
    console.log('[FileImport] Step 7: Inserting database record...');
    const insertStart = Date.now();
    await this.insertMediaRecordInTransaction(
      trx,
      file,
      hash,
      type,
      archivePath,
      sanitizedName,
      metadata,
      // Kanye3: Multi-tier thumbnail paths
      thumbPathSm,
      thumbPathLg,
      previewPath,
      rawPreviewPath,  // For RAW files
      // OPT-047: File size for archive size tracking
      fileSizeBytes,
      // OPT-060: Extension for metadata file auto-hide detection
      ext
    );
    console.log('[FileImport] Step 7 complete in', Date.now() - insertStart, 'ms');

    // OPT-059: Video proxy data prepared for post-transaction generation
    // CRITICAL: Proxy generation moved OUTSIDE transaction to fix SQLite deadlock
    // The deadlock occurred because generateVideoProxy writes to video_proxies table
    // using the main db connection while the transaction holds the write lock
    // Now we return metadata and generate proxy fire-and-forget after progress fires
    // OPT-077: Added rotation for aspect ratio correction
    let videoProxyData: ImportResult['_videoProxyData'] = null;
    if (type === 'video' && metadata?.width && metadata?.height) {
      videoProxyData = {
        vidhash: hash,
        archivePath: archivePath,
        width: metadata.width,
        height: metadata.height,
        rotation: metadata.rotation ?? null,
      };
      console.log('[FileImport] Step 7b: Video proxy data prepared for post-transaction generation');
    }

    // FIX-PROGRESS: Steps 8a-8b (GPS enrichment, geocoding) moved to importFiles()
    // These run AFTER progress fires so UI updates immediately on DB insert
    // See docs/workflows/import.md: "Background job for metadata extraction (doesn't block)"

    console.log('[FileImport] File import COMPLETE:', file.originalName);
    return {
      success: true,
      hash,
      type,
      duplicate: false,
      archivePath,
      gpsWarning,
      // OPT-012: Include warnings in result (only if non-empty)
      warnings: warnings.length > 0 ? warnings : undefined,
      // FIX-PROGRESS: Return GPS data for post-import enrichment (Steps 8a-8b)
      // Processed outside transaction after progress fires
      _gpsForEnrichment: gpsForGeocode,
      _locid: file.locid,
      // OPT-059: Return video proxy data for post-transaction generation
      // Fixes SQLite deadlock by moving proxy write outside transaction
      _videoProxyData: videoProxyData,
      // Migration 69: Timeline data for visit event creation
      // Only for images/videos with date taken - creates/updates visit events
      _timelineData: (type === 'image' || type === 'video') ? {
        locid: file.locid,
        subid: file.subid || null,
        mediaHash: hash,
        dateTaken: metadata?.dateTaken || null,
        cameraMake: metadata?.cameraMake || null,
        cameraModel: metadata?.cameraModel || null,
      } : null,
    };
  }

  /**
   * FIX-PROGRESS: Run Steps 8a-8b as fire-and-forget post-import enrichment
   * These are non-blocking enrichments that run after progress fires.
   * Per docs/workflows/import.md: "Background job for metadata extraction (doesn't block)"
   */
  private async runPostImportEnrichment(
    locid: string,
    gps: { lat: number; lng: number },
    location: any
  ): Promise<void> {
    // Only enrich if location has no GPS - use centralized enrichment service
    // This ensures GPS + address + region fields are all updated together
    if (!location.gps?.lat || !location.gps?.lng) {
      console.log('[FileImport] Auto-enriching location GPS from media EXIF via centralized service...');

      // Create enrichment service on-demand (geocodingService may be undefined)
      if (!this.geocodingService) {
        // No geocoding service - just update GPS and regions directly
        try {
          const regionFields = calculateRegionFields({
            state: location.address_state,
            county: location.address_county,
            lat: gps.lat,
            lng: gps.lng,
          });

          await this.db
            .updateTable('locs')
            .set({
              gps_lat: gps.lat,
              gps_lng: gps.lng,
              gps_source: 'media_gps',
              census_region: regionFields.censusRegion,
              census_division: regionFields.censusDivision,
              state_direction: regionFields.stateDirection,
              cultural_region: regionFields.culturalRegion ?? location.cultural_region,
              country_cultural_region: regionFields.countryCulturalRegion ?? location.country_cultural_region,
            })
            .where('locid', '=', locid)
            .execute();

          console.log('[FileImport] Location GPS + regions updated (no geocoding available)');
          location.gps = { lat: gps.lat, lng: gps.lng };
        } catch (dbError) {
          console.warn('[FileImport] Failed to update GPS:', dbError);
        }
        return;
      }

      // Use centralized enrichment service for GPS + address + regions
      const enrichmentService = new LocationEnrichmentService(this.db, this.geocodingService);

      // Skip geocoding if location already has address
      const hasAddress = location.address_street || location.address_city;

      const enrichResult = await enrichmentService.enrichFromGPS(locid, {
        lat: gps.lat,
        lng: gps.lng,
        source: 'media_gps',
        skipGeocode: hasAddress,
      });

      if (enrichResult.success) {
        // Update location cache so subsequent files don't re-run this
        location.gps = { lat: gps.lat, lng: gps.lng };
        if (enrichResult.address && !hasAddress) {
          location.address_street = enrichResult.address.street;
          location.address_city = enrichResult.address.city;
        }
        console.log(`[FileImport] Location enriched: GPS=true, address=${enrichResult.updated.address}, regions=${enrichResult.updated.regions}`);
      } else {
        console.warn('[FileImport] Enrichment failed:', enrichResult.error);
      }
    }
  }

  /**
   * Check if file should be skipped entirely during import
   * Skipped files: .aae (Apple photo adjustments), .psd/.psb (Photoshop projects)
   */
  private shouldSkipFile(ext: string): boolean {
    return this.SKIP_EXTENSIONS.includes(ext);
  }

  /**
   * OPT-060: Check if file is a metadata sidecar that should be auto-hidden
   * These files are imported for archive completeness but hidden from UI
   * Examples: .srt (DJI telemetry), .lrf (DJI low-res reference), .thm (thumbnails)
   */
  private isMetadataFile(ext: string): boolean {
    return this.METADATA_EXTENSIONS.includes(ext);
  }

  /**
   * Check if a media file has a matching XML sidecar
   * Looks for: filename.xml or filename.jpg.xml patterns
   */
  private async findXmlSidecar(filePath: string): Promise<string | null> {
    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);
    const filenameNoExt = path.basename(filePath, path.extname(filePath));

    // Try different XML sidecar naming conventions
    const possiblePaths = [
      path.join(dir, `${filenameNoExt}.xml`),     // IMG_1234.xml for IMG_1234.jpg
      path.join(dir, `${filename}.xml`),           // IMG_1234.jpg.xml
    ];

    for (const xmlPath of possiblePaths) {
      try {
        await fs.access(xmlPath);
        console.log('[FileImport] Found XML sidecar:', xmlPath);
        return xmlPath;
      } catch {
        // File doesn't exist, try next
      }
    }

    return null;
  }

  /**
   * Import a sidecar record (metadata only, no media file copied)
   * Stores the XML content and parsed metadata in sidecar_imports table
   */
  private async importSidecarOnly(
    trx: any,
    file: ImportFileInput,
    xmlPath: string,
    mediaType: string
  ): Promise<ImportResult> {
    const sidecarId = generateId();
    const timestamp = new Date().toISOString();

    // Read XML content
    let xmlContent: string | null = null;
    let parsedMetadata: string | null = null;

    try {
      xmlContent = await fs.readFile(xmlPath, 'utf-8');
      // Basic XML to JSON conversion (user can parse specific format later)
      parsedMetadata = JSON.stringify({
        _note: 'Raw XML imported. Parse according to your specific XML format.',
        _xmlLength: xmlContent.length,
        _importedAt: timestamp,
      });
    } catch (err) {
      console.warn('[FileImport] Failed to read XML sidecar:', err);
    }

    // Insert into sidecar_imports table
    await trx
      .insertInto('sidecar_imports')
      .values({
        sidecar_id: sidecarId,
        original_filename: file.originalName,
        original_path: file.filePath,
        xml_filename: path.basename(xmlPath),
        xml_path: xmlPath,
        xml_content: xmlContent,
        parsed_metadata: parsedMetadata,
        media_type: mediaType,
        import_date: timestamp,
        imported_by: file.imported_by || file.auth_imp || null,
        imported_by_id: file.imported_by_id || null,
        locid: file.locid,
        subid: file.subid || null,
      })
      .execute();

    console.log('[FileImport] Sidecar import complete:', file.originalName, '-> XML metadata stored');

    return {
      success: true,
      hash: sidecarId,  // Use sidecar ID as "hash" for tracking
      type: 'sidecar',
      duplicate: false,
      sidecarOnly: true,
    };
  }

  /**
   * Determine file type from extension
   * Logic: image -> video -> map -> default to document
   * We accept ALL files - if it's not image/video/map, catalog it as a document
   */
  private getFileType(ext: string): 'image' | 'video' | 'map' | 'document' {
    if (this.IMAGE_EXTENSIONS.includes(ext)) return 'image';
    if (this.VIDEO_EXTENSIONS.includes(ext)) return 'video';
    if (this.MAP_EXTENSIONS.includes(ext)) return 'map';
    // Default to document - we accept and catalog everything
    return 'document';
  }

  /**
   * Check if file is a duplicate within transaction
   */
  private async checkDuplicateInTransaction(
    trx: any,
    hash: string,
    type: 'image' | 'video' | 'map' | 'document'
  ): Promise<boolean> {
    if (type === 'image') {
      const result = await trx
        .selectFrom('imgs')
        .select('imghash')
        .where('imghash', '=', hash)
        .executeTakeFirst();
      return !!result;
    } else if (type === 'video') {
      const result = await trx
        .selectFrom('vids')
        .select('vidhash')
        .where('vidhash', '=', hash)
        .executeTakeFirst();
      return !!result;
    } else if (type === 'map') {
      const result = await trx
        .selectFrom('maps')
        .select('maphash')
        .where('maphash', '=', hash)
        .executeTakeFirst();
      return !!result;
    } else if (type === 'document') {
      const result = await trx
        .selectFrom('docs')
        .select('dochash')
        .where('dochash', '=', hash)
        .executeTakeFirst();
      return !!result;
    }
    return false;
  }

  /**
   * Organize file to archive folder with path validation
   * ADR-046: Archive structure: [archivePath]/locations/[STATE]/[LOCID]/data/org-[type]/[HASH].[ext]
   * Sub-location structure: [archivePath]/locations/[STATE]/[LOCID]/data/sloc-[SUBID]/org-[type]/[HASH].[ext]
   *
   * IMPORTANT: This version accepts pre-fetched location to avoid DB calls inside transaction
   */
  private async organizeFileWithLocation(
    file: ImportFileInput,
    hash: string,
    ext: string,
    type: 'image' | 'video' | 'map' | 'document',
    location: any, // Pre-fetched location from Step 0
    subid?: string | null // Optional sub-location ID
  ): Promise<{ path: string; fileSizeBytes: number }> {
    console.log('[organizeFile] Starting for:', file.originalName);
    console.log('[organizeFile] Using pre-fetched location:', location.locnam);

    // ADR-046: Build new folder structure
    // [STATE] folder (use "XX" for unknown state)
    const state = (location.address?.state || location.address_state || 'XX').toUpperCase();

    // [LOCID] folder (16-char BLAKE3 hash)
    const locid = location.locid;

    // org-[type] folder (no loc12 suffix anymore)
    const typePrefixMap: Record<string, string> = { image: 'img', video: 'vid', map: 'map', document: 'doc' };
    const typePrefix = typePrefixMap[type] || 'doc';
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

    // CRITICAL: Validate target path doesn't escape archive
    if (!PathValidator.validateArchivePath(targetPath, this.archivePath)) {
      throw new Error(`Security: Target path escapes archive directory: ${targetPath}`);
    }

    // Ensure directory exists
    await fs.mkdir(targetDir, { recursive: true });

    // Copy file
    await fs.copyFile(file.filePath, targetPath);

    // Verify integrity after copy
    const verifyHash = await this.cryptoService.calculateSHA256(targetPath);

    if (verifyHash !== hash) {
      // Delete corrupted file
      await fs.unlink(targetPath).catch(() => {});
      throw new Error(`Integrity check failed: file corrupted during copy`);
    }

    // OPT-047: Capture file size for archive size tracking
    // Per data-ownership.md: "Every media file's provenance... is auditable at any time"
    const fileStats = await fs.stat(targetPath);
    const fileSizeBytes = fileStats.size;

    return { path: targetPath, fileSizeBytes };
  }

  /**
   * Sanitize folder name - remove unsafe characters
   */
  private sanitizeFolderName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50); // Limit length
  }


  /**
   * Insert media record in database within transaction
   * Kanye3: Multi-tier thumbnails (400px, 800px, 1920px)
   * OPT-047: file_size_bytes for archive size tracking
   * OPT-060: Auto-hide metadata sidecars BEFORE commit (transaction-safe)
   */
  private async insertMediaRecordInTransaction(
    trx: any,
    file: ImportFileInput,
    hash: string,
    type: 'image' | 'video' | 'map' | 'document',
    archivePath: string,
    originalName: string,
    metadata: any,
    thumbPathSm: string | null = null,
    thumbPathLg: string | null = null,
    previewPath: string | null = null,
    rawPreviewPath: string | null = null,
    fileSizeBytes: number | null = null,
    fileExtension: string = ''  // OPT-060: Extension for metadata file detection
  ): Promise<void> {
    const timestamp = new Date().toISOString();

    if (type === 'image') {
      await trx
        .insertInto('imgs')
        .values({
          imghash: hash,
          imgnam: path.basename(archivePath),
          imgnamo: originalName,
          imgloc: archivePath,
          imgloco: file.filePath,
          locid: file.locid,
          subid: file.subid || null,
          auth_imp: file.auth_imp,
          imgadd: timestamp,
          meta_exiftool: metadata?.rawExif || null,
          meta_width: metadata?.width || null,
          meta_height: metadata?.height || null,
          meta_date_taken: metadata?.dateTaken || null,
          meta_camera_make: metadata?.cameraMake || null,
          meta_camera_model: metadata?.cameraModel || null,
          meta_gps_lat: metadata?.gps?.lat || null,
          meta_gps_lng: metadata?.gps?.lng || null,
          // Kanye3: Multi-tier thumbnail paths
          thumb_path_sm: thumbPathSm,
          thumb_path_lg: thumbPathLg,
          // For RAW files, use extracted preview (full resolution); otherwise use generated thumbnail
          preview_path: rawPreviewPath || previewPath,
          // FIX: Set preview_extracted flag when preview exists
          preview_extracted: (rawPreviewPath || previewPath) ? 1 : 0,
          // Legacy column for backwards compatibility
          thumb_path: thumbPathSm,
          // Migration 25: Activity tracking
          imported_by_id: file.imported_by_id || null,
          imported_by: file.imported_by || null,
          media_source: file.media_source || null,
          // Migration 26: Contributor tracking
          is_contributed: file.is_contributed ?? 0,
          contribution_source: file.contribution_source || null,
          // OPT-047: File size for archive size tracking
          file_size_bytes: fileSizeBytes,
        })
        .execute();
    } else if (type === 'video') {
      await trx
        .insertInto('vids')
        .values({
          vidhash: hash,
          vidnam: path.basename(archivePath),
          vidnamo: originalName,
          vidloc: archivePath,
          vidloco: file.filePath,
          locid: file.locid,
          subid: file.subid || null,
          auth_imp: file.auth_imp,
          vidadd: timestamp,
          meta_ffmpeg: metadata?.rawMetadata || null,
          // FIX 3.2: Store ExifTool data and GPS from videos
          meta_exiftool: metadata?.rawExif || null,
          meta_duration: metadata?.duration || null,
          meta_width: metadata?.width || null,
          meta_height: metadata?.height || null,
          meta_codec: metadata?.codec || null,
          meta_fps: metadata?.fps || null,
          meta_date_taken: metadata?.dateTaken || null,
          // FIX 3.2: Store GPS extracted from video metadata
          meta_gps_lat: metadata?.gps?.lat || null,
          meta_gps_lng: metadata?.gps?.lng || null,
          // Kanye3: Multi-tier thumbnail paths
          thumb_path_sm: thumbPathSm,
          thumb_path_lg: thumbPathLg,
          preview_path: previewPath,
          // Legacy column for backwards compatibility
          thumb_path: thumbPathSm,
          // Migration 25: Activity tracking
          imported_by_id: file.imported_by_id || null,
          imported_by: file.imported_by || null,
          media_source: file.media_source || null,
          // Migration 26: Contributor tracking
          is_contributed: file.is_contributed ?? 0,
          contribution_source: file.contribution_source || null,
          // OPT-047: File size for archive size tracking
          file_size_bytes: fileSizeBytes,
        })
        .execute();
    } else if (type === 'map') {
      // FIX 3.4: Store parsed GPX/KML data in meta_map
      const mapDataJson = metadata?.mapData ? JSON.stringify(metadata.mapData) : null;

      await trx
        .insertInto('maps')
        .values({
          maphash: hash,
          mapnam: path.basename(archivePath),
          mapnamo: originalName,
          maploc: archivePath,
          maploco: file.filePath,
          locid: file.locid,
          subid: file.subid || null,
          auth_imp: file.auth_imp,
          mapadd: timestamp,
          meta_exiftool: metadata?.rawExif || null,
          // FIX 3.4: Store parsed GPX/KML data
          meta_map: mapDataJson,
          // Store GPS center point for map files
          meta_gps_lat: metadata?.mapData?.centerPoint?.lat || metadata?.gps?.lat || null,
          meta_gps_lng: metadata?.mapData?.centerPoint?.lng || metadata?.gps?.lng || null,
          reference: null,
          map_states: null,
          map_verified: 0,
          // Kanye3: Multi-tier thumbnail paths (for image-based maps)
          thumb_path_sm: thumbPathSm,
          thumb_path_lg: thumbPathLg,
          preview_path: previewPath,
          // Migration 25: Activity tracking
          imported_by_id: file.imported_by_id || null,
          imported_by: file.imported_by || null,
          media_source: file.media_source || null,
          // OPT-047: File size for archive size tracking
          file_size_bytes: fileSizeBytes,
        })
        .execute();
    } else if (type === 'document') {
      // FIX 3.1: Store ExifTool metadata for documents
      // OPT-060: Auto-hide metadata sidecars BEFORE commit (transaction-safe)
      // This ensures metadata files (.srt, .lrf, .thm) are never visible as documents
      const isMetadata = this.isMetadataFile(fileExtension);
      if (isMetadata) {
        console.log(`[FileImport] OPT-060: Auto-hiding metadata file: ${originalName} (${fileExtension})`);
      }

      await trx
        .insertInto('docs')
        .values({
          dochash: hash,
          docnam: path.basename(archivePath),
          docnamo: originalName,
          docloc: archivePath,
          docloco: file.filePath,
          locid: file.locid,
          subid: file.subid || null,
          auth_imp: file.auth_imp,
          docadd: timestamp,
          meta_exiftool: metadata?.rawExif || null,
          meta_page_count: null, // ExifTool doesn't provide this consistently
          meta_author: null,     // Could extract from exif if available
          meta_title: null,      // Could extract from exif if available
          // OPT-060: Auto-hide metadata sidecars BEFORE commit
          // Hidden in INSERT, not as a separate UPDATE, ensuring atomic transaction
          hidden: isMetadata ? 1 : 0,
          hidden_reason: isMetadata ? 'metadata_sidecar' : null,
          // Migration 25: Activity tracking
          imported_by_id: file.imported_by_id || null,
          imported_by: file.imported_by || null,
          media_source: file.media_source || null,
          // OPT-047: File size for archive size tracking
          file_size_bytes: fileSizeBytes,
        })
        .execute();
    }
  }

  /**
   * Create import record within transaction
   */
  private async createImportRecordInTransaction(
    trx: any,
    input: {
      locid: string | null;
      auth_imp: string | null;
      img_count: number;
      vid_count: number;
      map_count: number;
      doc_count: number;
      notes: string;
    }
  ): Promise<string> {
    const importId = generateId();
    const importDate = new Date().toISOString();

    await trx
      .insertInto('imports')
      .values({
        import_id: importId,
        locid: input.locid,
        import_date: importDate,
        auth_imp: input.auth_imp,
        img_count: input.img_count,
        vid_count: input.vid_count,
        doc_count: input.doc_count,
        map_count: input.map_count,
        notes: input.notes,
      })
      .execute();

    return importId;
  }

  // NOTE: recalculateRegionsForLocation was removed - now handled by LocationEnrichmentService
}

// ADR-049: Import generateId for 16-char hex IDs
import { generateId } from '../main/ipc-validation';
