/**
 * Thumbnail Service
 *
 * Generates thumbnails for imported video files.
 * Creates:
 *   - Primary thumbnail at 25% (for grid display)
 *   - Gallery thumbnails at 25%, 50%, 75% (for preview)
 *
 * Output structure:
 *   {working_path}/{folder_name}/thumbnails/{hash}.jpg
 *   {working_path}/{folder_name}/gallery/{hash}_25.jpg
 *   {working_path}/{folder_name}/gallery/{hash}_50.jpg
 *   {working_path}/{folder_name}/gallery/{hash}_75.jpg
 *
 * @module services/thumbnail-service
 */

import { promises as fs, existsSync } from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

/**
 * Thumbnail generation options
 */
export interface ThumbnailOptions {
  /** Width in pixels (height auto-calculated to maintain aspect) */
  width?: number;
  /** JPEG quality (1-100) */
  quality?: number;
  /** Optional LUT file path (e.g., for S-Log to Rec.709 conversion) */
  lutPath?: string;
}

/**
 * Gallery thumbnail options
 */
export interface GalleryOptions extends ThumbnailOptions {
  /** Percentages through video to capture (default: [25, 50, 75]) */
  percentages?: number[];
}

/**
 * Result of thumbnail generation
 */
export interface ThumbnailResult {
  success: boolean;
  thumbnailPath: string | null;
  error: string | null;
}

/**
 * Result of gallery generation
 */
export interface GalleryResult {
  success: boolean;
  galleryPaths: string[];
  errors: string[];
}

/**
 * Default thumbnail settings
 */
const DEFAULT_THUMBNAIL_WIDTH = 320;
const DEFAULT_GALLERY_WIDTH = 640;
const DEFAULT_QUALITY = 85;
const DEFAULT_GALLERY_PERCENTAGES = [25, 50, 75];

/**
 * Get video duration using ffprobe
 */
async function getVideoDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to probe video: ${err.message}`));
        return;
      }
      resolve(metadata.format.duration ?? 0);
    });
  });
}

/**
 * Generate a single thumbnail at a specific percentage
 */
async function generateThumbnailAtPercent(
  inputPath: string,
  outputPath: string,
  percent: number,
  options: ThumbnailOptions = {}
): Promise<void> {
  const { width = DEFAULT_THUMBNAIL_WIDTH, quality = DEFAULT_QUALITY, lutPath } = options;

  const duration = await getVideoDuration(inputPath);
  const seekTime = duration * (percent / 100);

  // Build filter chain: scale first, then LUT if provided
  const filters: string[] = [`scale=${width}:-1`];
  if (lutPath && existsSync(lutPath)) {
    filters.push(`lut3d='${lutPath}'`);
    console.log(`[ThumbnailService] Applying LUT: ${lutPath}`);
  }
  const filterStr = filters.join(',');

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(seekTime)
      .frames(1)
      .outputOptions([
        `-vf ${filterStr}`,
        `-q:v ${Math.round((100 - quality) / 3.3)}`, // Convert quality to FFmpeg's q:v scale (2-31)
      ])
      .output(outputPath)
      .on('error', (error) => reject(new Error(`Failed to generate thumbnail: ${error.message}`)))
      .on('end', () => resolve())
      .run();
  });
}

/**
 * Generate primary thumbnail for a video file
 * Captures at 25% through the video
 *
 * @param inputPath - Source video file path
 * @param outputDir - Directory to save thumbnail (e.g., {couple_folder}/thumbnails)
 * @param hash - BLAKE3 hash of the file (used as filename)
 * @param options - Thumbnail options
 * @returns ThumbnailResult with path to generated thumbnail
 */
export async function generateFileThumbnail(
  inputPath: string,
  outputDir: string,
  hash: string,
  options: ThumbnailOptions = {}
): Promise<ThumbnailResult> {
  try {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, `${hash}.jpg`);

    // Generate at 25% - typically a good representative frame
    await generateThumbnailAtPercent(inputPath, outputPath, 25, {
      width: options.width ?? DEFAULT_THUMBNAIL_WIDTH,
      quality: options.quality ?? DEFAULT_QUALITY,
      lutPath: options.lutPath,
    });

    console.log(`[ThumbnailService] Generated thumbnail: ${outputPath}`);

    return {
      success: true,
      thumbnailPath: outputPath,
      error: null,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[ThumbnailService] Failed to generate thumbnail for ${inputPath}: ${errorMsg}`);
    return {
      success: false,
      thumbnailPath: null,
      error: errorMsg,
    };
  }
}

/**
 * Generate gallery thumbnails for a video file
 * Captures at 25%, 50%, and 75% through the video
 *
 * @param inputPath - Source video file path
 * @param outputDir - Directory to save gallery images (e.g., {couple_folder}/gallery)
 * @param hash - BLAKE3 hash of the file (used in filename)
 * @param options - Gallery options
 * @returns GalleryResult with paths to generated images
 */
export async function generateFileGallery(
  inputPath: string,
  outputDir: string,
  hash: string,
  options: GalleryOptions = {}
): Promise<GalleryResult> {
  const {
    width = DEFAULT_GALLERY_WIDTH,
    quality = DEFAULT_QUALITY,
    percentages = DEFAULT_GALLERY_PERCENTAGES,
  } = options;

  const galleryPaths: string[] = [];
  const errors: string[] = [];

  try {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Generate thumbnail at each percentage
    for (const percent of percentages) {
      const filename = `${hash}_${percent}.jpg`;
      const outputPath = path.join(outputDir, filename);

      try {
        await generateThumbnailAtPercent(inputPath, outputPath, percent, { width, quality, lutPath: options.lutPath });
        galleryPaths.push(outputPath);
        console.log(`[ThumbnailService] Generated gallery image: ${outputPath}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`${percent}%: ${errorMsg}`);
      }
    }

    return {
      success: errors.length === 0,
      galleryPaths,
      errors,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      galleryPaths,
      errors: [errorMsg],
    };
  }
}

/**
 * Generate both thumbnail and gallery for a file
 *
 * @param inputPath - Source video file path
 * @param coupleDir - Couple folder path (working_path/folder_name)
 * @param hash - BLAKE3 hash of the file
 * @param options - Combined options
 * @returns Combined result
 */
export async function generateAllThumbnails(
  inputPath: string,
  coupleDir: string,
  hash: string,
  options: GalleryOptions = {}
): Promise<{
  thumbnail: ThumbnailResult;
  gallery: GalleryResult;
}> {
  const thumbnailDir = path.join(coupleDir, 'thumbnails');
  const galleryDir = path.join(coupleDir, 'gallery');

  // Generate both in parallel
  const [thumbnail, gallery] = await Promise.all([
    generateFileThumbnail(inputPath, thumbnailDir, hash, {
      width: options.width ?? DEFAULT_THUMBNAIL_WIDTH,
      quality: options.quality,
      lutPath: options.lutPath,
    }),
    generateFileGallery(inputPath, galleryDir, hash, {
      width: DEFAULT_GALLERY_WIDTH,
      quality: options.quality,
      percentages: options.percentages,
      lutPath: options.lutPath,
    }),
  ]);

  return { thumbnail, gallery };
}

/**
 * Check if thumbnail exists for a file
 */
export async function thumbnailExists(
  coupleDir: string,
  hash: string
): Promise<boolean> {
  const thumbnailPath = path.join(coupleDir, 'thumbnails', `${hash}.jpg`);
  try {
    await fs.access(thumbnailPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get thumbnail path for a file (doesn't check existence)
 */
export function getThumbnailPath(coupleDir: string, hash: string): string {
  return path.join(coupleDir, 'thumbnails', `${hash}.jpg`);
}

/**
 * Get gallery paths for a file (doesn't check existence)
 */
export function getGalleryPaths(
  coupleDir: string,
  hash: string,
  percentages: number[] = DEFAULT_GALLERY_PERCENTAGES
): string[] {
  return percentages.map((p) => path.join(coupleDir, 'gallery', `${hash}_${p}.jpg`));
}

/**
 * Batch generate thumbnails for multiple files
 *
 * @param files - Array of { inputPath, hash }
 * @param coupleDir - Couple folder path
 * @param options - Thumbnail options
 * @param onProgress - Progress callback (current, total, filename)
 * @returns Array of results
 */
export async function batchGenerateThumbnails(
  files: Array<{ inputPath: string; hash: string }>,
  coupleDir: string,
  options: ThumbnailOptions = {},
  onProgress?: (current: number, total: number, filename: string) => void
): Promise<ThumbnailResult[]> {
  const results: ThumbnailResult[] = [];
  const thumbnailDir = path.join(coupleDir, 'thumbnails');

  // Ensure directory exists
  await fs.mkdir(thumbnailDir, { recursive: true });

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i, files.length, path.basename(file.inputPath));

    const result = await generateFileThumbnail(
      file.inputPath,
      thumbnailDir,
      file.hash,
      options
    );
    results.push(result);
  }

  onProgress?.(files.length, files.length, 'Complete');

  return results;
}
