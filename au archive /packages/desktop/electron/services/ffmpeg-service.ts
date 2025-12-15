import fs from 'fs/promises';
import fsSync from 'fs';
import { execSync, spawn } from 'child_process';
import pathModule from 'path';

// Common FFmpeg installation paths on macOS
const FFMPEG_PATHS = [
  '/opt/homebrew/bin/ffmpeg',      // Homebrew on Apple Silicon
  '/usr/local/bin/ffmpeg',          // Homebrew on Intel Mac / manual install
  '/usr/bin/ffmpeg',                // System install
];

const FFPROBE_PATHS = [
  '/opt/homebrew/bin/ffprobe',
  '/usr/local/bin/ffprobe',
  '/usr/bin/ffprobe',
];

/**
 * Find a binary path
 * Checks PATH first via 'which', then common installation directories
 */
function findBinaryPath(name: string, commonPaths: string[]): string | null {
  // Try 'which' first (works if in PATH)
  try {
    const result = execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
    if (result) return result;
  } catch {
    // Not in PATH, continue to check common paths
  }

  // Check common installation paths
  for (const binPath of commonPaths) {
    try {
      fsSync.accessSync(binPath);
      return binPath;
    } catch {
      // Not at this path, continue
    }
  }

  return null;
}

// Detect FFmpeg and FFprobe paths on module load
const detectedFfmpegPath = findBinaryPath('ffmpeg', FFMPEG_PATHS);
const detectedFfprobePath = findBinaryPath('ffprobe', FFPROBE_PATHS);

if (detectedFfmpegPath) {
  console.log(`[FFmpegService] Found FFmpeg at: ${detectedFfmpegPath}`);
} else {
  console.error('[FFmpegService] WARNING: FFmpeg not found! Video processing will fail.');
}

if (detectedFfprobePath) {
  console.log(`[FFmpegService] Found FFprobe at: ${detectedFfprobePath}`);
} else {
  console.error('[FFmpegService] WARNING: FFprobe not found! Metadata extraction will fail.');
}

export interface VideoMetadata {
  duration: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  fps: number | null;
  dateTaken: string | null;
  rawMetadata: string;
  // OPT-077: Rotation metadata for aspect ratio correction
  // 0, 90, 180, 270 degrees - null if not present
  rotation: number | null;
}

/**
 * Service for extracting metadata from videos using FFmpeg
 * Uses direct spawn calls instead of fluent-ffmpeg to avoid ES module compatibility issues
 */
export class FFmpegService {
  /**
   * Extract metadata from a video file using ffprobe
   * @param filePath - Absolute path to the video file
   * @returns Promise resolving to extracted metadata
   */
  async extractMetadata(filePath: string): Promise<VideoMetadata> {
    if (!detectedFfprobePath) {
      throw new Error('FFprobe not found. Please install FFmpeg.');
    }

    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ];

      const proc = spawn(detectedFfprobePath, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          console.error('Error extracting video metadata:', stderr);
          reject(new Error(`FFprobe exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const metadata = JSON.parse(stdout);
          const videoStream = metadata.streams?.find((s: any) => s.codec_type === 'video');

          // Extract creation time from format tags or stream tags
          const creationTime =
            metadata.format?.tags?.creation_time ||
            videoStream?.tags?.creation_time ||
            null;

          // OPT-077: Extract rotation for aspect ratio correction
          const rotation = this.parseRotation(videoStream);

          resolve({
            duration: metadata.format?.duration ? parseFloat(metadata.format.duration) : null,
            width: videoStream?.width || null,
            height: videoStream?.height || null,
            codec: videoStream?.codec_name || null,
            fps: videoStream?.r_frame_rate
              ? this.parseFrameRate(videoStream.r_frame_rate)
              : null,
            dateTaken: creationTime ? new Date(creationTime).toISOString() : null,
            rawMetadata: JSON.stringify(metadata, null, 2),
            rotation,
          });
        } catch (parseError) {
          reject(new Error(`Failed to parse FFprobe output: ${parseError}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn FFprobe: ${err.message}`));
      });
    });
  }

  /**
   * Parse frame rate string (e.g., "30000/1001") to number
   */
  private parseFrameRate(frameRate: string): number | null {
    try {
      const parts = frameRate.split('/');
      if (parts.length === 2) {
        const numerator = parseInt(parts[0], 10);
        const denominator = parseInt(parts[1], 10);
        if (denominator === 0) return null;
        return numerator / denominator;
      }
      return parseFloat(frameRate);
    } catch {
      return null;
    }
  }

  /**
   * OPT-077: Parse rotation metadata from video stream
   * Mobile devices record portrait video as landscape pixels + rotation metadata.
   * FFprobe stores rotation in different places depending on the video format:
   * - stream.tags.rotate (older format)
   * - stream.side_data_list[].rotation (newer format)
   * - stream.side_data_list[].displaymatrix (contains "rotation of X degrees")
   *
   * @param videoStream - The video stream object from ffprobe
   * @returns Rotation in degrees (0, 90, 180, 270) or null if not present
   */
  private parseRotation(videoStream: any): number | null {
    if (!videoStream) return null;

    // Check tags.rotate (older videos, common on Android)
    if (videoStream.tags?.rotate) {
      const rotation = parseInt(videoStream.tags.rotate, 10);
      if (!isNaN(rotation)) {
        console.log(`[FFmpegService] Found rotation in tags.rotate: ${rotation}°`);
        return this.normalizeRotation(rotation);
      }
    }

    // Check side_data_list (newer videos, common on iPhone)
    const sideData = videoStream.side_data_list;
    if (Array.isArray(sideData)) {
      for (const sd of sideData) {
        // Direct rotation value
        if (sd.rotation !== undefined) {
          const rotation = typeof sd.rotation === 'number' ? sd.rotation : parseFloat(sd.rotation);
          if (!isNaN(rotation)) {
            console.log(`[FFmpegService] Found rotation in side_data.rotation: ${rotation}°`);
            return this.normalizeRotation(rotation);
          }
        }

        // Parse displaymatrix string (e.g., "rotation of -90.00 degrees")
        if (sd.displaymatrix && typeof sd.displaymatrix === 'string') {
          const match = sd.displaymatrix.match(/rotation of ([-\d.]+)/i);
          if (match) {
            const rotation = parseFloat(match[1]);
            if (!isNaN(rotation)) {
              console.log(`[FFmpegService] Found rotation in displaymatrix: ${rotation}°`);
              return this.normalizeRotation(rotation);
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Normalize rotation to 0, 90, 180, or 270 degrees
   * Handles negative values and values outside 0-360 range
   */
  private normalizeRotation(degrees: number): number {
    // Round to nearest integer
    let rotation = Math.round(degrees);
    // Handle negative rotations (-90 -> 270)
    rotation = ((rotation % 360) + 360) % 360;
    // Snap to nearest 90-degree increment
    if (rotation >= 315 || rotation < 45) return 0;
    if (rotation >= 45 && rotation < 135) return 90;
    if (rotation >= 135 && rotation < 225) return 180;
    return 270;
  }

  /**
   * Extract a single frame from a video at a specific timestamp
   *
   * @param sourcePath - Absolute path to video file
   * @param outputPath - Absolute path for output JPEG
   * @param timestampSeconds - Time offset in seconds (default: 1)
   * @param maxSize - Maximum dimension in pixels, preserves aspect ratio (default: 1920)
   * @returns Promise that resolves when frame is extracted
   */
  async extractFrame(
    sourcePath: string,
    outputPath: string,
    timestampSeconds: number = 1,
    maxSize: number = 1920
  ): Promise<void> {
    if (!detectedFfmpegPath) {
      throw new Error('FFmpeg not found. Please install FFmpeg.');
    }

    // Check if source file exists BEFORE calling FFmpeg
    try {
      await fs.access(sourcePath);
    } catch {
      throw new Error(`Source file not found: ${sourcePath}`);
    }

    // Ensure output directory exists
    const outputDir = pathModule.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });

    return new Promise((resolve, reject) => {
      // Scale to fit within maxSize while preserving aspect ratio
      // -1 means "calculate automatically to preserve aspect ratio"
      const args = [
        '-ss', String(timestampSeconds),
        '-i', sourcePath,
        '-frames:v', '1',
        '-vf', `scale='min(${maxSize},iw)':'-1'`,
        '-q:v', '2',
        '-update', '1',
        '-y',  // Overwrite output file
        outputPath
      ];

      console.log(`[FFmpegService] Running: ${detectedFfmpegPath} ${args.join(' ')}`);

      const proc = spawn(detectedFfmpegPath, args);
      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          console.error('[FFmpegService] extractFrame failed:', stderr);
          console.error('[FFmpegService] Source:', sourcePath);
          console.error('[FFmpegService] Output:', outputPath);
          reject(new Error(`FFmpeg exited with code ${code}`));
          return;
        }

        // Verify output file was created
        if (!fsSync.existsSync(outputPath)) {
          reject(new Error(`FFmpeg completed but output file was not created: ${outputPath}`));
          return;
        }

        resolve();
      });

      proc.on('error', (err) => {
        console.error('[FFmpegService] Failed to spawn FFmpeg:', err.message);
        reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
      });
    });
  }
}
