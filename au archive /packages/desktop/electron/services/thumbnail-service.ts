import sharp from 'sharp';
import fs from 'fs/promises';
import { MediaPathService } from './media-path-service';

/**
 * ThumbnailService - Generate multi-tier thumbnails for premium archive experience
 *
 * Core Rules (DO NOT BREAK):
 * 1. THREE sizes generated: 400px (grid), 800px (HiDPI), 1920px (preview)
 * 2. Output is ALWAYS JPEG - Browser compatibility, smaller than PNG
 * 3. Quality: 85% for thumbnails, 90% for previews
 * 4. Never throw, return null - Import must not fail because thumbnail failed
 * 5. Hash bucketing - Store as .thumbnails/a3/a3d5e8f9_400.jpg
 * 6. Sharp only - Do not add ImageMagick, GraphicsMagick, Jimp, etc.
 * 7. Aspect ratio preserved - No forced square crops
 */

export interface ThumbnailSet {
  thumb_sm: string | null;   // 400px - grid view (1x displays)
  thumb_lg: string | null;   // 800px - grid view (2x HiDPI)
  preview: string | null;    // 1920px - lightbox/detail view
}

export const THUMBNAIL_SIZES = {
  SMALL: 400,      // Grid view, 1x displays
  LARGE: 800,      // Grid view, 2x HiDPI displays
  PREVIEW: 1920,   // Lightbox, detail page hero
} as const;

export class ThumbnailService {
  private readonly THUMB_QUALITY = 85;
  private readonly PREVIEW_QUALITY = 90;

  constructor(private readonly mediaPathService: MediaPathService) {}

  /**
   * Generate all three thumbnail sizes for an image
   *
   * @param sourcePath - Absolute path to source image (or extracted preview for RAW)
   * @param hash - SHA256 hash of the original file (for naming)
   * @param force - If true, regenerate even if thumbnails exist
   * @returns ThumbnailSet with paths to all generated sizes
   */
  async generateAllSizes(sourcePath: string, hash: string, force: boolean = false): Promise<ThumbnailSet> {
    const result: ThumbnailSet = {
      thumb_sm: null,
      thumb_lg: null,
      preview: null,
    };

    try {
      // Get image metadata for aspect ratio calculation
      const metadata = await sharp(sourcePath).metadata();
      let { width, height } = metadata;

      if (!width || !height) {
        console.error(`[ThumbnailService] Cannot read dimensions for ${sourcePath}`);
        return result;
      }

      // EXIF orientation 5,6,7,8 require width/height swap for correct layout
      // (these are rotations that change portrait<->landscape)
      const orientation = metadata.orientation || 1;
      if (orientation >= 5 && orientation <= 8) {
        [width, height] = [height, width];
      }

      // Ensure bucket directory exists
      await this.mediaPathService.ensureBucketDir(
        this.mediaPathService.getThumbnailDir(),
        hash
      );

      // Generate all three sizes in parallel
      const [sm, lg, preview] = await Promise.all([
        this.generateSize(sourcePath, hash, THUMBNAIL_SIZES.SMALL, width, height, this.THUMB_QUALITY, force),
        this.generateSize(sourcePath, hash, THUMBNAIL_SIZES.LARGE, width, height, this.THUMB_QUALITY, force),
        this.generateSize(sourcePath, hash, THUMBNAIL_SIZES.PREVIEW, width, height, this.PREVIEW_QUALITY, force),
      ]);

      result.thumb_sm = sm;
      result.thumb_lg = lg;
      result.preview = preview;

    } catch (error) {
      console.error(`[ThumbnailService] Failed to generate thumbnails for ${sourcePath}:`, error);
    }

    return result;
  }

  /**
   * Generate a single size thumbnail
   * Size is applied to the SHORT edge to maintain aspect ratio
   *
   * @param orientedWidth - Width AFTER EXIF rotation is applied
   * @param orientedHeight - Height AFTER EXIF rotation is applied
   * @param force - If true, regenerate even if thumbnail exists
   */
  private async generateSize(
    sourcePath: string,
    hash: string,
    targetSize: 400 | 800 | 1920,
    orientedWidth: number,
    orientedHeight: number,
    quality: number,
    force: boolean = false
  ): Promise<string | null> {
    try {
      const thumbPath = this.mediaPathService.getThumbnailPath(hash, targetSize);

      // Check if already exists (skip if force=true)
      if (!force) {
        try {
          await fs.access(thumbPath);
          return thumbPath;
        } catch {
          // Doesn't exist, continue
        }
      }

      // Calculate resize dimensions (target size on short edge)
      // Uses ORIENTED dimensions so portrait images resize correctly
      const isLandscape = orientedWidth > orientedHeight;
      const resizeOptions = isLandscape
        ? { height: targetSize }
        : { width: targetSize };

      // Don't upscale - if source is smaller than target, skip
      // Uses ORIENTED dimensions for accurate check
      const shortEdge = isLandscape ? orientedHeight : orientedWidth;
      if (shortEdge < targetSize) {
        console.log(`[ThumbnailService] Skipping ${targetSize}px for ${hash}: source too small (${shortEdge}px < ${targetSize}px)`);
        return null;
      }

      await sharp(sourcePath)
        .rotate()  // Auto-rotate based on EXIF orientation
        .resize(resizeOptions)
        .jpeg({ quality })
        .toFile(thumbPath);

      return thumbPath;
    } catch (error) {
      console.error(`[ThumbnailService] Failed to generate ${targetSize}px for ${hash}:`, error);
      return null;
    }
  }

  /**
   * Generate legacy 256px thumbnail (backwards compatibility)
   * @deprecated Use generateAllSizes instead
   */
  async generateThumbnail(sourcePath: string, hash: string): Promise<string | null> {
    try {
      const thumbPath = this.mediaPathService.getThumbnailPath(hash);

      try {
        await fs.access(thumbPath);
        return thumbPath;
      } catch {
        // Continue
      }

      await this.mediaPathService.ensureBucketDir(
        this.mediaPathService.getThumbnailDir(),
        hash
      );

      await sharp(sourcePath)
        .rotate()  // Auto-rotate based on EXIF orientation
        .resize(256, 256, { fit: 'cover', position: 'center' })
        .jpeg({ quality: 80 })
        .toFile(thumbPath);

      return thumbPath;
    } catch (error) {
      console.error(`[ThumbnailService] Failed to generate thumbnail for ${sourcePath}:`, error);
      return null;
    }
  }

  /**
   * Generate thumbnails for multiple images
   */
  async generateBatch(
    items: Array<{ sourcePath: string; hash: string }>
  ): Promise<Map<string, ThumbnailSet>> {
    const results = new Map<string, ThumbnailSet>();

    for (const item of items) {
      const result = await this.generateAllSizes(item.sourcePath, item.hash);
      results.set(item.hash, result);
    }

    return results;
  }

  /**
   * Check if all thumbnail sizes exist for a hash
   */
  async allThumbnailsExist(hash: string): Promise<boolean> {
    try {
      await Promise.all([
        fs.access(this.mediaPathService.getThumbnailPath(hash, 400)),
        fs.access(this.mediaPathService.getThumbnailPath(hash, 800)),
        fs.access(this.mediaPathService.getThumbnailPath(hash, 1920)),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete all thumbnails for a hash
   */
  async deleteAllThumbnails(hash: string): Promise<void> {
    const paths = [
      this.mediaPathService.getThumbnailPath(hash),       // Legacy 256px
      this.mediaPathService.getThumbnailPath(hash, 400),
      this.mediaPathService.getThumbnailPath(hash, 800),
      this.mediaPathService.getThumbnailPath(hash, 1920),
    ];

    await Promise.all(
      paths.map(p => fs.unlink(p).catch(() => {}))
    );
  }
}
