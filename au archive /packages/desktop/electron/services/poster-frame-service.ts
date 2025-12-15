import fs from 'fs/promises';
import { MediaPathService } from './media-path-service';
import { FFmpegService } from './ffmpeg-service';

/**
 * PosterFrameService - Generate poster frames (thumbnails) for videos using FFmpeg
 *
 * Core Rules (DO NOT BREAK):
 * 1. Extract at 1 second by default - First frame is often black/title
 * 2. Output is ALWAYS JPEG - Browser compatibility
 * 3. Never throw, return null - Import must not fail because poster failed
 * 4. Hash bucketing - Store as .posters/a3/a3d5e8f9...jpg
 * 5. FFmpeg only - Already installed, no additional dependencies
 */
export class PosterFrameService {
  private readonly DEFAULT_TIMESTAMP = 1; // seconds
  private readonly OUTPUT_SIZE = 1920; // Large enough to generate all thumbnail sizes (400, 800, 1920)

  constructor(
    private readonly mediaPathService: MediaPathService,
    private readonly ffmpegService: FFmpegService
  ) {}

  /**
   * Generate a poster frame for a video file
   *
   * @param sourcePath - Absolute path to video file
   * @param hash - SHA256 hash of the file (for naming)
   * @returns Absolute path to generated poster, or null on failure
   */
  async generatePoster(sourcePath: string, hash: string): Promise<string | null> {
    try {
      const posterPath = this.mediaPathService.getPosterPath(hash);

      // Check if poster already exists
      try {
        await fs.access(posterPath);
        return posterPath; // Already exists
      } catch {
        // Doesn't exist, continue to generate
      }

      // Ensure bucket directory exists
      await this.mediaPathService.ensureBucketDir(
        this.mediaPathService.getPosterDir(),
        hash
      );

      // Extract frame using FFmpeg
      await this.ffmpegService.extractFrame(
        sourcePath,
        posterPath,
        this.DEFAULT_TIMESTAMP,
        this.OUTPUT_SIZE
      );

      // Verify the poster was created
      await fs.access(posterPath);
      return posterPath;
    } catch (error) {
      // Log but don't throw - import should not fail due to poster failure
      console.error(`[PosterFrameService] Failed to generate poster for ${sourcePath}:`, error);
      return null;
    }
  }

  /**
   * Generate posters for multiple videos
   * Non-blocking - failures don't stop other posters
   */
  async generateBatch(
    items: Array<{ sourcePath: string; hash: string }>
  ): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();

    for (const item of items) {
      const result = await this.generatePoster(item.sourcePath, item.hash);
      results.set(item.hash, result);
    }

    return results;
  }
}
