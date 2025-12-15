/**
 * Media Processing IPC Handlers
 * Handles media viewing, thumbnails, previews, caching, and XMP operations
 * ADR-046: Updated locid/subid validation from UUID to BLAKE3 16-char hex
 */
import { ipcMain, shell } from 'electron';
import { z } from 'zod';
import { Blake3IdSchema } from '../ipc-validation';
import path from 'path';
import fs from 'fs/promises';
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';
import { SQLiteMediaRepository } from '../../repositories/sqlite-media-repository';
import { ExifToolService } from '../../services/exiftool-service';
import { FFmpegService } from '../../services/ffmpeg-service';
import { MediaPathService } from '../../services/media-path-service';
import { ThumbnailService } from '../../services/thumbnail-service';
import { PreviewExtractorService } from '../../services/preview-extractor-service';
import { PosterFrameService } from '../../services/poster-frame-service';
import { MediaCacheService } from '../../services/media-cache-service';
import { PreloadService } from '../../services/preload-service';
import { XmpService } from '../../services/xmp-service';
import { generateProxy, getProxyPath, proxyExistsForVideo } from '../../services/video-proxy-service';
// OPT-053: Removed purgeOldProxies, clearAllProxies, touchLocationProxies - proxies are now permanent
import { getCacheStats, getVideosNeedingProxies } from '../../services/proxy-cache-service';

export function registerMediaProcessingHandlers(
  db: Kysely<Database>,
  mediaRepo: SQLiteMediaRepository,
  exifToolService: ExifToolService,
  ffmpegService: FFmpegService
) {
  const mediaCacheService = new MediaCacheService();
  const preloadService = new PreloadService(mediaCacheService);

  const getArchivePath = async (): Promise<string> => {
    const result = await db.selectFrom('settings').select('value').where('key', '=', 'archive_folder').executeTakeFirst();
    if (!result?.value) throw new Error('Archive path not configured');
    return result.value;
  };

  /**
   * OPT-094: Find media by location with optional sub-location filtering
   * Supports both old API (string locid) and new API (object with subid)
   * ADR-046: locid/subid are 16-char BLAKE3 hex IDs
   * - Old: media:findByLocation(locid) - returns all media (backward compatible)
   * - New: media:findByLocation({ locid, subid: null }) - returns host media only
   * - New: media:findByLocation({ locid, subid: '<blake3-id>' }) - returns sub-location media only
   */
  ipcMain.handle('media:findByLocation', async (_event, params: unknown) => {
    try {
      let locid: string;
      let subid: string | null | undefined;

      // Support both old (string) and new (object) call signatures
      if (typeof params === 'string') {
        // Backward compatible: media:findByLocation(locid)
        locid = Blake3IdSchema.parse(params);
        subid = undefined; // Return all media
      } else {
        // New API: media:findByLocation({ locid, subid })
        const schema = z.object({
          locid: Blake3IdSchema,
          subid: Blake3IdSchema.nullable().optional(),
        });
        const validated = schema.parse(params);
        locid = validated.locid;
        subid = validated.subid;
      }

      return await mediaRepo.findAllMediaByLocation(locid, { subid });
    } catch (error) {
      console.error('Error finding media by location:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * OPT-039: Paginated image loading for locations with many images
   * OPT-094: Added subid filtering support
   * Returns a chunk of images plus total count and hasMore flag
   */
  ipcMain.handle('media:findImagesPaginated', async (_event, params: unknown) => {
    try {
      const schema = z.object({
        locid: Blake3IdSchema,
        limit: z.number().min(1).max(500).default(50),
        offset: z.number().min(0).default(0),
        subid: Blake3IdSchema.nullable().optional(), // OPT-094
      });
      const { locid, limit, offset, subid } = schema.parse(params);
      return await mediaRepo.findImagesByLocationPaginated(locid, limit, offset, { subid });
    } catch (error) {
      console.error('Error finding paginated images:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('media:findImageByHash', async (_event, hash: unknown) => {
    try {
      const validatedHash = z.string().length(16).regex(/^[a-f0-9]+$/).parse(hash);
      const img = await mediaRepo.findImageByHash(validatedHash);
      return img ? { thumb_path: img.thumb_path, thumb_path_sm: img.thumb_path_sm, thumb_path_lg: img.thumb_path_lg, preview_path: img.preview_path } : null;
    } catch (error) {
      console.error('Error finding image by hash:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('media:openFile', async (_event, filePath: unknown) => {
    try {
      const validatedPath = z.string().min(1).max(4096).parse(filePath);
      const archivePath = await db.selectFrom('settings').select('value').where('key', '=', 'archive_folder').executeTakeFirst();

      if (!archivePath?.value) throw new Error('Archive folder not configured');

      const normalizedFilePath = path.resolve(validatedPath);
      const normalizedArchivePath = path.resolve(archivePath.value);

      if (!normalizedFilePath.startsWith(normalizedArchivePath + path.sep)) {
        throw new Error('Access denied: file is outside the archive folder');
      }

      await shell.openPath(validatedPath);
      return { success: true };
    } catch (error) {
      console.error('Error opening file:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Show file in Finder (Mac) / Files (Linux)
  ipcMain.handle('media:showInFolder', async (_event, filePath: unknown) => {
    try {
      const validatedPath = z.string().min(1).max(4096).parse(filePath);
      const archivePath = await db.selectFrom('settings').select('value').where('key', '=', 'archive_folder').executeTakeFirst();

      if (!archivePath?.value) throw new Error('Archive folder not configured');

      const normalizedFilePath = path.resolve(validatedPath);
      const normalizedArchivePath = path.resolve(archivePath.value);

      if (!normalizedFilePath.startsWith(normalizedArchivePath + path.sep)) {
        throw new Error('Access denied: file is outside the archive folder');
      }

      shell.showItemInFolder(validatedPath);
      return { success: true };
    } catch (error) {
      console.error('Error showing file in folder:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Get full metadata (ExifTool/FFprobe) for a media item
  // Used by MediaViewer's enhanced info panel
  ipcMain.handle('media:getFullMetadata', async (_event, hash: unknown, mediaType: unknown) => {
    try {
      const validHash = z.string().min(1).parse(hash);
      const validType = z.enum(['image', 'video', 'document']).parse(mediaType);

      let result: { meta_exiftool: string | null; meta_ffmpeg?: string | null } | undefined;

      if (validType === 'image') {
        result = await db
          .selectFrom('imgs')
          .select(['meta_exiftool'])
          .where('imghash', '=', validHash)
          .executeTakeFirst();
      } else if (validType === 'video') {
        result = await db
          .selectFrom('vids')
          .select(['meta_exiftool', 'meta_ffmpeg'])
          .where('vidhash', '=', validHash)
          .executeTakeFirst();
      } else if (validType === 'document') {
        result = await db
          .selectFrom('docs')
          .select(['meta_exiftool'])
          .where('dochash', '=', validHash)
          .executeTakeFirst();
      }

      if (!result) {
        return { success: false, error: 'Media not found' };
      }

      // Parse JSON strings into objects
      let exiftool = null;
      let ffmpeg = null;

      if (result.meta_exiftool) {
        try {
          exiftool = JSON.parse(result.meta_exiftool);
        } catch {
          console.warn('Failed to parse meta_exiftool JSON');
        }
      }

      if ('meta_ffmpeg' in result && result.meta_ffmpeg) {
        try {
          ffmpeg = JSON.parse(result.meta_ffmpeg);
        } catch {
          console.warn('Failed to parse meta_ffmpeg JSON');
        }
      }

      return { success: true, exiftool, ffmpeg };
    } catch (error) {
      console.error('Error getting full metadata:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  ipcMain.handle('media:generateThumbnail', async (_event, sourcePath: unknown, hash: unknown) => {
    try {
      const validPath = z.string().min(1).parse(sourcePath);
      const validHash = z.string().min(1).parse(hash);
      const archivePath = await getArchivePath();
      const mediaPathService = new MediaPathService(archivePath);
      const thumbnailService = new ThumbnailService(mediaPathService);
      return await thumbnailService.generateThumbnail(validPath, validHash);
    } catch (error) {
      console.error('Error generating thumbnail:', error);
      return null;
    }
  });

  ipcMain.handle('media:extractPreview', async (_event, sourcePath: unknown, hash: unknown) => {
    try {
      const validPath = z.string().min(1).parse(sourcePath);
      const validHash = z.string().min(1).parse(hash);
      const archivePath = await getArchivePath();
      const mediaPathService = new MediaPathService(archivePath);
      const previewService = new PreviewExtractorService(mediaPathService, exifToolService);
      return await previewService.extractPreview(validPath, validHash);
    } catch (error) {
      console.error('Error extracting preview:', error);
      return null;
    }
  });

  ipcMain.handle('media:generatePoster', async (_event, sourcePath: unknown, hash: unknown) => {
    try {
      const validPath = z.string().min(1).parse(sourcePath);
      const validHash = z.string().min(1).parse(hash);
      const archivePath = await getArchivePath();
      const mediaPathService = new MediaPathService(archivePath);
      const posterService = new PosterFrameService(mediaPathService, ffmpegService);
      return await posterService.generatePoster(validPath, validHash);
    } catch (error) {
      console.error('Error generating poster:', error);
      return null;
    }
  });

  ipcMain.handle('media:getCached', async (_event, key: unknown) => {
    try {
      const validKey = z.string().min(1).parse(key);
      const data = mediaCacheService.get(validKey);
      return data ? data.toString('base64') : null;
    } catch (error) {
      console.error('Error getting cached media:', error);
      return null;
    }
  });

  ipcMain.handle('media:preload', async (_event, mediaList: unknown, currentIndex: unknown) => {
    try {
      const validList = z.array(z.object({ hash: z.string(), path: z.string() })).parse(mediaList);
      const validIndex = z.number().int().nonnegative().parse(currentIndex);
      preloadService.setMediaList(validList);
      preloadService.setCurrentIndex(validIndex);
      return { success: true };
    } catch (error) {
      console.error('Error preloading media:', error);
      return { success: false };
    }
  });

  ipcMain.handle('media:readXmp', async (_event, mediaPath: unknown) => {
    try {
      const validPath = z.string().min(1).parse(mediaPath);
      const archivePath = await getArchivePath();
      const mediaPathService = new MediaPathService(archivePath);
      const xmpService = new XmpService(mediaPathService);
      const xmpPath = mediaPathService.getXmpPath(validPath);
      return await xmpService.readXmp(xmpPath);
    } catch (error) {
      console.error('Error reading XMP:', error);
      return null;
    }
  });

  ipcMain.handle('media:writeXmp', async (_event, mediaPath: unknown, data: unknown) => {
    try {
      const validPath = z.string().min(1).parse(mediaPath);
      const validData = z.object({
        rating: z.number().optional(),
        label: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        title: z.string().optional(),
        description: z.string().optional()
      }).parse(data);
      const archivePath = await getArchivePath();
      const mediaPathService = new MediaPathService(archivePath);
      const xmpService = new XmpService(mediaPathService);
      const xmpPath = mediaPathService.getXmpPath(validPath);
      await xmpService.writeXmp(xmpPath, validData);
      return { success: true };
    } catch (error) {
      console.error('Error writing XMP:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Kanye6: Regenerate multi-tier thumbnails for all images missing thumb_path_sm
  // When force=true, regenerates ALL thumbnails (useful after fixing extraction bugs)
  ipcMain.handle('media:regenerateAllThumbnails', async (_event, options?: unknown) => {
    const opts = z.object({ force: z.boolean().optional() }).optional().parse(options);
    const force = opts?.force ?? false;

    try {
      const archivePath = await getArchivePath();
      const mediaPathService = new MediaPathService(archivePath);
      const thumbnailService = new ThumbnailService(mediaPathService);
      const previewService = new PreviewExtractorService(mediaPathService, exifToolService);

      // Get images to process - all images if force=true, otherwise just missing
      const images = force
        ? await mediaRepo.getAllImages()
        : await mediaRepo.getImagesWithoutThumbnails();
      let generated = 0;
      let failed = 0;

      console.log(`[Kanye6] Regenerating thumbnails for ${images.length} images (force=${force})...`);

      for (const img of images) {
        try {
          // For RAW/HEIC files, extract preview first (sharp can't decode these directly)
          // For other files, ALWAYS use original when force=true to fix rotation
          let sourcePath = img.imgloc;
          const needsPreviewExtraction = /\.(nef|cr2|cr3|arw|srf|sr2|orf|pef|dng|rw2|raf|raw|rwl|3fr|fff|iiq|mrw|x3f|erf|mef|mos|kdc|dcr|heic|heif)$/i.test(img.imgloc);

          if (needsPreviewExtraction) {
            // Always re-extract preview when force=true (picks highest resolution)
            const preview = await previewService.extractPreview(img.imgloc, img.imghash, force);
            if (preview) {
              sourcePath = preview;
              await mediaRepo.updateImagePreviewPath(img.imghash, preview);
            }
          } else if (!force && img.preview_path) {
            // Only use existing preview when NOT forcing regeneration
            // When force=true, use original to apply correct EXIF rotation
            sourcePath = img.preview_path;
          }

          // Generate multi-tier thumbnails (400px, 800px, 1920px)
          const result = await thumbnailService.generateAllSizes(sourcePath, img.imghash, force);

          if (result.thumb_sm) {
            // Update database with all thumbnail paths
            // FIX: Preserve RAW/HEIC preview_path, don't overwrite with thumbnail preview
            await db
              .updateTable('imgs')
              .set({
                thumb_path_sm: result.thumb_sm,
                thumb_path_lg: result.thumb_lg,
                // For RAW/HEIC files, keep extracted preview; for others, use thumbnail preview
                preview_path: needsPreviewExtraction ? (sourcePath !== img.imgloc ? sourcePath : img.preview_path) : (result.preview || img.preview_path),
              })
              .where('imghash', '=', img.imghash)
              .execute();

            generated++;
          } else {
            failed++;
          }
        } catch (err) {
          console.error(`[Kanye6] Failed to regenerate thumbnails for ${img.imghash}:`, err);
          failed++;
        }
      }

      console.log(`[Kanye6] Thumbnail regeneration complete: ${generated} generated, ${failed} failed`);

      // Kanye9: Also process RAW files that have thumbnails but no preview
      // These files can't be displayed in MediaViewer without a preview
      const rawWithoutPreviews = await mediaRepo.getImagesWithoutPreviews();
      let previewsExtracted = 0;
      let previewsFailed = 0;

      console.log(`[Kanye9] Extracting previews for ${rawWithoutPreviews.length} RAW files missing previews...`);

      for (const img of rawWithoutPreviews) {
        try {
          const preview = await previewService.extractPreview(img.imgloc, img.imghash);
          if (preview) {
            await mediaRepo.updateImagePreviewPath(img.imghash, preview);
            previewsExtracted++;
            console.log(`[Kanye9] Extracted preview for ${img.imghash}`);
          } else {
            previewsFailed++;
            console.warn(`[Kanye9] No preview available for ${img.imgloc}`);
          }
        } catch (err) {
          console.error(`[Kanye9] Failed to extract preview for ${img.imghash}:`, err);
          previewsFailed++;
        }
      }

      console.log(`[Kanye9] Preview extraction complete: ${previewsExtracted} extracted, ${previewsFailed} failed`);

      return {
        generated,
        failed,
        total: images.length,
        previewsExtracted,
        previewsFailed,
        rawTotal: rawWithoutPreviews.length
      };
    } catch (error) {
      console.error('Error regenerating thumbnails:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // DECISION-020: Regenerate video thumbnails (poster frames)
  // Generates poster frame from video, then multi-tier thumbnails from poster
  ipcMain.handle('media:regenerateVideoThumbnails', async (_event, options?: unknown) => {
    const opts = z.object({ force: z.boolean().optional() }).optional().parse(options);
    const force = opts?.force ?? false;

    try {
      const archivePath = await getArchivePath();
      const mediaPathService = new MediaPathService(archivePath);
      const thumbnailService = new ThumbnailService(mediaPathService);
      const posterService = new PosterFrameService(mediaPathService, ffmpegService);

      // Get videos without thumbnails (or all if force)
      const videos = force
        ? await mediaRepo.getAllVideos()
        : await mediaRepo.getVideosWithoutThumbnails();

      let generated = 0;
      let failed = 0;

      console.log(`[DECISION-020] Regenerating thumbnails for ${videos.length} videos (force=${force})...`);

      for (const vid of videos) {
        try {
          // Step 1: Generate poster frame from video
          const posterPath = await posterService.generatePoster(vid.vidloc, vid.vidhash);

          if (!posterPath) {
            console.warn(`[DECISION-020] No poster generated for ${vid.vidhash}`);
            failed++;
            continue;
          }

          // Step 2: Generate multi-tier thumbnails from poster
          const result = await thumbnailService.generateAllSizes(posterPath, vid.vidhash, force);

          if (result.thumb_sm) {
            // Update database with thumbnail paths
            await db
              .updateTable('vids')
              .set({
                thumb_path_sm: result.thumb_sm,
                thumb_path_lg: result.thumb_lg,
                preview_path: result.preview,
              })
              .where('vidhash', '=', vid.vidhash)
              .execute();

            generated++;
            console.log(`[DECISION-020] Generated thumbnails for video ${vid.vidhash}`);
          } else {
            failed++;
          }
        } catch (err) {
          console.error(`[DECISION-020] Failed to generate thumbnails for ${vid.vidhash}:`, err);
          failed++;
        }
      }

      console.log(`[DECISION-020] Video thumbnail regeneration complete: ${generated} generated, ${failed} failed`);

      return { generated, failed, total: videos.length };
    } catch (error) {
      console.error('Error regenerating video thumbnails:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Kanye11: Regenerate preview/thumbnails for a single file
  // Used when MediaViewer can't display a file due to missing preview
  ipcMain.handle('media:regenerateSingleFile', async (_event, hash: unknown, filePath: unknown) => {
    try {
      const validHash = z.string().min(1).parse(hash);
      const validPath = z.string().min(1).parse(filePath);

      const archivePath = await getArchivePath();
      const mediaPathService = new MediaPathService(archivePath);
      const thumbnailService = new ThumbnailService(mediaPathService);
      const previewService = new PreviewExtractorService(mediaPathService, exifToolService);

      let sourcePath = validPath;
      let previewPath: string | null = null;

      // For RAW/HEIC files, extract preview first (sharp can't decode these directly)
      const needsPreviewExtraction = /\.(nef|cr2|cr3|arw|srf|sr2|orf|pef|dng|rw2|raf|raw|rwl|3fr|fff|iiq|mrw|x3f|erf|mef|mos|kdc|dcr|heic|heif)$/i.test(validPath);

      if (needsPreviewExtraction) {
        console.log(`[Kanye11] Extracting preview for RAW/HEIC file: ${validHash}`);
        previewPath = await previewService.extractPreview(validPath, validHash);
        if (previewPath) {
          sourcePath = previewPath;
          console.log(`[Kanye11] Preview extracted: ${previewPath}`);
        } else {
          console.warn(`[Kanye11] No embedded preview found in RAW/HEIC file`);
          return { success: false, error: 'No embedded preview found in RAW/HEIC file' };
        }
      }

      // Generate multi-tier thumbnails
      console.log(`[Kanye11] Generating thumbnails from: ${sourcePath}`);
      const result = await thumbnailService.generateAllSizes(sourcePath, validHash);

      if (result.thumb_sm) {
        // Update database
        await db
          .updateTable('imgs')
          .set({
            preview_path: previewPath || result.preview,
            thumb_path_sm: result.thumb_sm,
            thumb_path_lg: result.thumb_lg,
          })
          .where('imghash', '=', validHash)
          .execute();

        console.log(`[Kanye11] Regeneration complete for ${validHash}`);
        return {
          success: true,
          previewPath: previewPath || result.preview,
          thumbPathSm: result.thumb_sm,
          thumbPathLg: result.thumb_lg,
        };
      }

      return { success: false, error: 'Failed to generate thumbnails' };
    } catch (error) {
      console.error('Error regenerating single file:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Set hidden status for media items (user-initiated hide/unhide)
  ipcMain.handle('media:setHidden', async (_event, input: unknown) => {
    try {
      const validInput = z.object({
        hash: z.string().min(1),
        type: z.enum(['image', 'video', 'document']),
        hidden: z.boolean(),
        reason: z.string().optional(),
      }).parse(input);

      const { hash, type, hidden, reason } = validInput;

      if (type === 'image') {
        await mediaRepo.setImageHidden(hash, hidden, reason ?? 'user');
      } else if (type === 'video') {
        await mediaRepo.setVideoHidden(hash, hidden, reason ?? 'user');
      } else if (type === 'document') {
        await mediaRepo.setDocumentHidden(hash, hidden, reason ?? 'user');
      }

      console.log(`[media:setHidden] ${type} ${hash} hidden=${hidden} reason=${reason ?? 'user'}`);
      return { success: true };
    } catch (error) {
      console.error('Error setting hidden status:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Scan location for Live Photos and SDR duplicates (one-time or manual trigger)
  ipcMain.handle('media:detectLivePhotosAndSDR', async (_event, locid: unknown) => {
    try {
      const validLocid = Blake3IdSchema.parse(locid);

      // Get all images and videos for this location
      const images = await mediaRepo.getImageFilenamesByLocation(validLocid);
      const videos = await mediaRepo.getVideoFilenamesByLocation(validLocid);

      console.log(`[media:detectLivePhotosAndSDR] Scanning ${images.length} images and ${videos.length} videos`);

      // Build set of image base names for fast lookup
      const imageBaseNames = new Map<string, string>();
      for (const img of images) {
        const ext = path.extname(img.imgnamo);
        const baseName = path.basename(img.imgnamo, ext).toLowerCase();
        imageBaseNames.set(baseName, img.imghash);
      }

      let livePhotosHidden = 0;
      let sdrHidden = 0;

      // Detect Live Photo videos
      for (const vid of videos) {
        const ext = path.extname(vid.vidnamo).toLowerCase();
        if (ext === '.mov' || ext === '.mp4') {
          const baseName = path.basename(vid.vidnamo, ext).toLowerCase();
          if (imageBaseNames.has(baseName)) {
            await mediaRepo.setVideoHidden(vid.vidhash, true, 'live_photo');
            await mediaRepo.setVideoLivePhoto(vid.vidhash, true);
            const imghash = imageBaseNames.get(baseName);
            if (imghash) {
              await mediaRepo.setImageLivePhoto(imghash, true);
            }
            livePhotosHidden++;
          }
        }
      }

      // Detect SDR duplicates
      for (const img of images) {
        if (/_sdr\./i.test(img.imgnamo)) {
          const hdrBaseName = path.basename(img.imgnamo.replace(/_sdr\./i, '.'), path.extname(img.imgnamo)).toLowerCase();
          if (imageBaseNames.has(hdrBaseName)) {
            await mediaRepo.setImageHidden(img.imghash, true, 'sdr_duplicate');
            sdrHidden++;
          }
        }
      }

      // Check for Android Motion Photos (EXIF flag)
      for (const img of images) {
        try {
          const imgData = await mediaRepo.findImageByHash(img.imghash);
          if (imgData?.meta_exiftool) {
            const exif = JSON.parse(imgData.meta_exiftool);
            if (exif.MotionPhoto === 1 || exif.MicroVideo || exif.MicroVideoOffset) {
              await mediaRepo.setImageLivePhoto(img.imghash, true);
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      console.log(`[media:detectLivePhotosAndSDR] Done: ${livePhotosHidden} Live Photo videos, ${sdrHidden} SDR duplicates`);
      return { success: true, livePhotosHidden, sdrHidden };
    } catch (error) {
      console.error('Error detecting Live Photos/SDR:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Migration 30: Regenerate DNG previews using LibRaw for full-quality rendering
  // This fixes "potato quality" drone shots where embedded preview is tiny (960x720 for 5376x3956 image)
  ipcMain.handle('media:regenerateDngPreviews', async (_event) => {
    try {
      const archivePath = await getArchivePath();
      const mediaPathService = new MediaPathService(archivePath);
      const previewService = new PreviewExtractorService(mediaPathService, exifToolService);

      // Get DNG files that need LibRaw rendering
      const dngFiles = await mediaRepo.getDngImagesNeedingLibraw();
      let rendered = 0;
      let failed = 0;

      console.log(`[Migration30] Found ${dngFiles.length} DNG files needing LibRaw rendering...`);

      for (const img of dngFiles) {
        try {
          // Use extractPreviewWithQuality which automatically uses LibRaw when embedded preview is low-quality
          const result = await previewService.extractPreviewWithQuality(
            img.imgloc,
            img.imghash,
            img.meta_width,
            img.meta_height,
            true  // force re-extraction
          );

          if (result.previewPath) {
            await mediaRepo.updateImagePreviewWithQuality(img.imghash, result.previewPath, result.qualityLevel);
            rendered++;
            console.log(`[Migration30] Rendered ${img.imghash}: quality=${result.qualityLevel}`);
          } else {
            failed++;
            console.warn(`[Migration30] No preview generated for ${img.imghash}`);
          }
        } catch (err) {
          console.error(`[Migration30] Failed to render ${img.imghash}:`, err);
          failed++;
        }
      }

      console.log(`[Migration30] DNG rendering complete: ${rendered} rendered, ${failed} failed`);
      return { success: true, rendered, failed, total: dngFiles.length };
    } catch (error) {
      console.error('Error regenerating DNG previews:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // ============================================
  // Video Proxy Handlers (Migration 36)
  // Per video-proxy-system-plan.md
  // ============================================

  // Generate proxy for a single video
  ipcMain.handle('media:generateProxy', async (_event, vidhash: unknown, sourcePath: unknown, metadata: unknown) => {
    try {
      const validVidhash = z.string().min(1).parse(vidhash);
      const validPath = z.string().min(1).parse(sourcePath);
      const validMeta = z.object({
        width: z.number().positive(),
        height: z.number().positive()
      }).parse(metadata);

      const archivePath = await getArchivePath();
      return await generateProxy(db, archivePath, validVidhash, validPath, validMeta);
    } catch (error) {
      console.error('Error generating proxy:', error);
      if (error instanceof z.ZodError) {
        return { success: false, error: `Validation error: ${error.errors.map(e => e.message).join(', ')}` };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get proxy path for a video (returns null if not exists)
  ipcMain.handle('media:getProxyPath', async (_event, vidhash: unknown) => {
    try {
      const validVidhash = z.string().min(1).parse(vidhash);
      return await getProxyPath(db, validVidhash);
    } catch (error) {
      console.error('Error getting proxy path:', error);
      return null;
    }
  });

  // Get cache statistics
  ipcMain.handle('media:getProxyCacheStats', async () => {
    try {
      return await getCacheStats(db);
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return { totalCount: 0, totalSizeBytes: 0, totalSizeMB: 0, oldestAccess: null, newestAccess: null };
    }
  });

  // OPT-053: DEPRECATED - Proxies are now permanent (Immich model), no purge needed
  // Kept for backwards compatibility but always returns empty result
  ipcMain.handle('media:purgeOldProxies', async () => {
    console.log('[media:purgeOldProxies] DEPRECATED: Proxies are permanent per OPT-053');
    return { deleted: 0, freedBytes: 0, freedMB: 0 };
  });

  // OPT-053: DEPRECATED - Proxies are now permanent (Immich model), no clear needed
  // Kept for backwards compatibility but always returns empty result
  ipcMain.handle('media:clearAllProxies', async () => {
    console.log('[media:clearAllProxies] DEPRECATED: Proxies are permanent per OPT-053');
    return { deleted: 0, freedBytes: 0, freedMB: 0 };
  });

  // OPT-053: DEPRECATED - No last_accessed tracking (Immich model)
  // Kept for backwards compatibility but always returns 0
  ipcMain.handle('media:touchLocationProxies', async () => {
    console.log('[media:touchLocationProxies] DEPRECATED: No last_accessed tracking per OPT-053');
    return 0;
  });

  // OPT-053: New handler - check if proxy exists by filesystem (fast, no DB)
  ipcMain.handle('media:proxyExists', async (_event, videoPath: unknown, vidhash: unknown) => {
    try {
      const validPath = z.string().min(1).parse(videoPath);
      const validVidhash = z.string().min(1).parse(vidhash);
      return await proxyExistsForVideo(validPath, validVidhash);
    } catch (error) {
      console.error('Error checking proxy exists:', error);
      return false;
    }
  });

  // Location-specific image fix: thumbnails + rotations + DNG quality for one location
  ipcMain.handle('media:fixLocationImages', async (_event, locid: unknown) => {
    try {
      const validLocid = Blake3IdSchema.parse(locid);
      const archivePath = await getArchivePath();
      const mediaPathService = new MediaPathService(archivePath);
      const thumbnailService = new ThumbnailService(mediaPathService);
      const previewService = new PreviewExtractorService(mediaPathService, exifToolService);

      // Get images for this location only
      const images = await mediaRepo.getImagesByLocation(validLocid);
      let fixed = 0;
      let errors = 0;

      console.log(`[media:fixLocationImages] Processing ${images.length} images for location ${validLocid}...`);

      for (const img of images) {
        try {
          let sourcePath = img.imgloc;
          const needsPreviewExtraction = /\.(nef|cr2|cr3|arw|srf|sr2|orf|pef|dng|rw2|raf|raw|rwl|3fr|fff|iiq|mrw|x3f|erf|mef|mos|kdc|dcr|heic|heif)$/i.test(img.imgloc);

          if (needsPreviewExtraction) {
            const preview = await previewService.extractPreview(img.imgloc, img.imghash, true);
            if (preview) {
              sourcePath = preview;
              await mediaRepo.updateImagePreviewPath(img.imghash, preview);
            }
          }

          const result = await thumbnailService.generateAllSizes(sourcePath, img.imghash, true);

          if (result.thumb_sm) {
            await db
              .updateTable('imgs')
              .set({
                thumb_path_sm: result.thumb_sm,
                thumb_path_lg: result.thumb_lg,
                preview_path: needsPreviewExtraction ? (sourcePath !== img.imgloc ? sourcePath : img.preview_path) : (result.preview || img.preview_path),
              })
              .where('imghash', '=', img.imghash)
              .execute();
            fixed++;
          } else {
            errors++;
          }
        } catch (err) {
          console.error(`[media:fixLocationImages] Failed for ${img.imghash}:`, err);
          errors++;
        }
      }

      console.log(`[media:fixLocationImages] Complete: ${fixed} fixed, ${errors} errors`);
      return { fixed, errors, total: images.length };
    } catch (error) {
      console.error('Error fixing location images:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => e.message).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Helper: Search for video file by hash in archive (fallback when stored path fails)
  async function findVideoByHash(archivePath: string, hash: string, ext: string): Promise<string | null> {
    const locationsDir = path.join(archivePath, 'locations');
    const filename = `${hash}${ext}`;

    async function searchDir(dir: string): Promise<string | null> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = await searchDir(fullPath);
            if (found) return found;
          } else if (entry.name === filename) {
            return fullPath;
          }
        }
      } catch {
        // Directory not accessible, skip
      }
      return null;
    }

    return searchDir(locationsDir);
  }

  // Location-specific video fix: poster frames + thumbnails for one location
  ipcMain.handle('media:fixLocationVideos', async (_event, locid: unknown) => {
    try {
      const validLocid = Blake3IdSchema.parse(locid);
      const archivePath = await getArchivePath();
      const mediaPathService = new MediaPathService(archivePath);
      const thumbnailService = new ThumbnailService(mediaPathService);
      const posterService = new PosterFrameService(mediaPathService, ffmpegService);

      // Get videos for this location only
      const videos = await mediaRepo.getVideosByLocation(validLocid);
      let fixed = 0;
      let errors = 0;
      let pathsRepaired = 0;

      console.log(`[media:fixLocationVideos] Processing ${videos.length} videos for location ${validLocid}...`);

      for (const vid of videos) {
        try {
          let sourcePath = vid.vidloc;

          // Check if source file exists at stored path
          try {
            await fs.access(sourcePath);
          } catch {
            // File not at stored path - search by hash
            console.log(`[media:fixLocationVideos] File not found at stored path, searching by hash: ${vid.vidhash.slice(0, 12)}...`);
            const foundPath = await findVideoByHash(archivePath, vid.vidhash, path.extname(vid.vidloc));
            if (foundPath) {
              sourcePath = foundPath;
              // Update database with correct path
              await db.updateTable('vids').set({ vidloc: foundPath }).where('vidhash', '=', vid.vidhash).execute();
              console.log(`[media:fixLocationVideos] Path repaired: ${foundPath}`);
              pathsRepaired++;
            } else {
              console.error(`[media:fixLocationVideos] Video file not found on disk: ${vid.vidhash}`);
              errors++;
              continue;
            }
          }

          // Generate poster frame
          const posterPath = await posterService.generatePoster(sourcePath, vid.vidhash);

          if (!posterPath) {
            console.warn(`[media:fixLocationVideos] No poster generated for ${vid.vidhash}`);
            errors++;
            continue;
          }

          // Generate thumbnails from poster
          const result = await thumbnailService.generateAllSizes(posterPath, vid.vidhash, true);

          if (result.thumb_sm) {
            await db
              .updateTable('vids')
              .set({
                thumb_path_sm: result.thumb_sm,
                thumb_path_lg: result.thumb_lg,
                preview_path: result.preview,
              })
              .where('vidhash', '=', vid.vidhash)
              .execute();
            fixed++;
          } else {
            errors++;
          }
        } catch (err) {
          console.error(`[media:fixLocationVideos] Failed for ${vid.vidhash}:`, err);
          errors++;
        }
      }

      console.log(`[media:fixLocationVideos] Complete: ${fixed} fixed, ${pathsRepaired} paths repaired, ${errors} errors`);
      return { fixed, errors, pathsRepaired, total: videos.length };
    } catch (error) {
      console.error('Error fixing location videos:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => e.message).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Count untagged images for a location
  ipcMain.handle('media:countUntaggedImages', async (_event, locid: unknown) => {
    try {
      const validLocid = Blake3IdSchema.parse(locid);

      const result = await db
        .selectFrom('imgs')
        .select(eb => [eb.fn.count<number>('imghash').as('count')])
        .where('locid', '=', validLocid)
        .where('hidden', '=', 0)
        .where(eb => eb.or([
          eb('auto_tags', 'is', null),
          eb('auto_tags', '=', ''),
        ]))
        .executeTakeFirst();

      return Number(result?.count ?? 0);
    } catch (error) {
      console.error('Error counting untagged images:', error);
      return 0;
    }
  });

  // Generate proxies for all videos in a location (background batch)
  ipcMain.handle('media:generateProxiesForLocation', async (event, locid: unknown) => {
    try {
      const validLocid = Blake3IdSchema.parse(locid);
      const archivePath = await getArchivePath();

      // Get videos without proxies
      const videos = await getVideosNeedingProxies(db, validLocid);

      if (videos.length === 0) {
        return { generated: 0, failed: 0, total: 0 };
      }

      console.log(`[VideoProxy] Generating proxies for ${videos.length} videos in location ${validLocid}...`);

      // Log each video that needs a proxy
      for (const v of videos) {
        console.log(`[VideoProxy]   Queued: ${v.vidhash.slice(0, 12)} - ${v.vidloc.split('/').pop()} (${v.meta_width || 1920}x${v.meta_height || 1080})`);
      }

      let generated = 0;
      let failed = 0;

      for (const video of videos) {
        console.log(`[VideoProxy] Processing ${generated + failed + 1}/${videos.length}: ${video.vidhash.slice(0, 12)}`);

        const result = await generateProxy(
          db,
          archivePath,
          video.vidhash,
          video.vidloc,
          { width: video.meta_width || 1920, height: video.meta_height || 1080 }
        );

        if (result.success) {
          generated++;
          console.log(`[VideoProxy] ✓ Proxy generated: ${video.vidhash.slice(0, 12)}`);
        } else {
          failed++;
          console.error(`[VideoProxy] ✗ Proxy failed: ${video.vidhash.slice(0, 12)} - ${result.error}`);
        }

        // Emit progress to renderer
        event.sender.send('media:proxyProgress', {
          locid: validLocid,
          generated,
          failed,
          total: videos.length
        });
      }

      console.log(`[VideoProxy] Batch complete: ${generated} generated, ${failed} failed`);
      return { generated, failed, total: videos.length };
    } catch (error) {
      console.error('Error generating proxies for location:', error);
      return { generated: 0, failed: 0, total: 0 };
    }
  });

  // Delete a media file (removes from DB and deletes file from disk)
  ipcMain.handle('media:delete', async (_event, input: unknown) => {
    try {
      const validInput = z.object({
        hash: z.string().min(1),
        type: z.enum(['image', 'video', 'document']),
      }).parse(input);

      const { hash, type } = validInput;
      let filePath: string | null = null;
      let thumbPath: string | null = null;
      let previewPath: string | null = null;

      // Get file info before deleting from DB
      if (type === 'image') {
        const img = await mediaRepo.findImageByHash(hash);
        filePath = img?.imgloc || null;
        thumbPath = img?.thumb_path || null;
        previewPath = img?.preview_path || null;
        await mediaRepo.deleteImage(hash);
      } else if (type === 'video') {
        const vid = await mediaRepo.findVideoByHash(hash);
        filePath = vid?.vidloc || null;
        thumbPath = vid?.thumb_path || null;
        previewPath = vid?.preview_path || null;
        await mediaRepo.deleteVideo(hash);
      } else if (type === 'document') {
        const doc = await mediaRepo.findDocumentByHash(hash);
        filePath = doc?.docloc || null;
        await mediaRepo.deleteDocument(hash);
      }

      // Delete physical files
      const deletedFiles: string[] = [];
      const failedFiles: string[] = [];

      if (filePath) {
        try {
          await fs.unlink(filePath);
          deletedFiles.push(filePath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            failedFiles.push(filePath);
          }
        }
      }

      if (thumbPath) {
        try {
          await fs.unlink(thumbPath);
          deletedFiles.push(thumbPath);
        } catch {
          // Thumbnail deletion failure is not critical
        }
      }

      if (previewPath) {
        try {
          await fs.unlink(previewPath);
          deletedFiles.push(previewPath);
        } catch {
          // Preview deletion failure is not critical
        }
      }

      // For videos, also try to delete proxy file
      if (type === 'video' && filePath) {
        const dirPath = path.dirname(filePath);
        const proxyPath = path.join(dirPath, `.${hash}.proxy.mp4`);
        try {
          await fs.unlink(proxyPath);
          deletedFiles.push(proxyPath);
        } catch {
          // Proxy deletion failure is not critical
        }
      }

      console.log(`[media:delete] Deleted ${type} ${hash}, files: ${deletedFiles.length}`);
      return { success: true, deletedFiles, failedFiles };
    } catch (error) {
      console.error('Error deleting media:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // Move a media file to a different sub-location (DB only, files stay in place)
  ipcMain.handle('media:moveToSubLocation', async (_event, input: unknown) => {
    try {
      const validInput = z.object({
        hash: z.string().min(1),
        type: z.enum(['image', 'video', 'document']),
        subid: Blake3IdSchema.nullable(),
      }).parse(input);

      const { hash, type, subid } = validInput;

      if (type === 'image') {
        await mediaRepo.moveImageToSubLocation(hash, subid);
      } else if (type === 'video') {
        await mediaRepo.moveVideoToSubLocation(hash, subid);
      } else if (type === 'document') {
        await mediaRepo.moveDocumentToSubLocation(hash, subid);
      }

      console.log(`[media:moveToSubLocation] Moved ${type} ${hash} to sub-location ${subid || 'host'}`);
      return { success: true };
    } catch (error) {
      console.error('Error moving media to sub-location:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  // OPT-105: Backfill RAW preview paths from existing .previews/ directory
  // Fixes ARW/NEF/CR3/etc files where preview was extracted but path wasn't stored in DB
  ipcMain.handle('media:backfillRawPreviews', async (_event) => {
    try {
      const archivePath = await getArchivePath();
      const mediaPathService = new MediaPathService(archivePath);

      // Find all RAW images with missing preview_path but have thumb_path_sm (thumbnail was generated from preview)
      const rawPattern = /\.(nef|cr2|cr3|arw|srf|sr2|orf|pef|dng|rw2|raf|raw|rwl|3fr|fff|iiq|mrw|x3f|erf|mef|mos|kdc|dcr|heic|heif)$/i;

      // Get all images with null preview_path
      const allImages = await db
        .selectFrom('imgs')
        .select(['imghash', 'imgloc', 'preview_path', 'thumb_path_sm'])
        .where('preview_path', 'is', null)
        .execute();

      // Filter to RAW files that have thumbnails (meaning preview was extracted)
      const rawImages = allImages.filter(img =>
        rawPattern.test(img.imgloc) && img.thumb_path_sm !== null
      );

      console.log(`[OPT-105] Found ${rawImages.length} RAW images with missing preview_path`);

      let fixed = 0;
      let notFound = 0;

      for (const img of rawImages) {
        // Check if preview file exists on disk
        const expectedPreviewPath = mediaPathService.getPreviewPath(img.imghash);

        try {
          await fs.access(expectedPreviewPath);
          // Preview exists on disk, update DB
          await db
            .updateTable('imgs')
            .set({
              preview_path: expectedPreviewPath,
              preview_extracted: 1,
            })
            .where('imghash', '=', img.imghash)
            .execute();
          fixed++;
          console.log(`[OPT-105] Fixed preview_path for ${img.imghash.slice(0, 12)}`);
        } catch {
          // Preview doesn't exist on disk
          notFound++;
        }
      }

      console.log(`[OPT-105] Backfill complete: ${fixed} fixed, ${notFound} previews not found on disk`);
      return { fixed, notFound, total: rawImages.length };
    } catch (error) {
      console.error('Error backfilling RAW previews:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

}
