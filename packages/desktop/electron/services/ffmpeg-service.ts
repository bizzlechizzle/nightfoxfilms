/**
 * FFmpeg Service
 *
 * Video processing using FFmpeg via fluent-ffmpeg.
 * Handles transcoding, screenshots, clips, and filters.
 */

import ffmpeg from 'fluent-ffmpeg';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Check if FFmpeg is available
 */
export async function isFFmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version']);
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Progress callback type
 */
export type ProgressCallback = (percent: number) => void;

/**
 * Extract a frame as an image
 */
export async function extractFrame(
  inputPath: string,
  outputPath: string,
  timeSeconds: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(timeSeconds)
      .frames(1)
      .output(outputPath)
      .on('error', (err) => reject(new Error(`Failed to extract frame: ${err.message}`)))
      .on('end', () => resolve())
      .run();
  });
}

/**
 * Extract multiple frames at specified times
 */
export async function extractFrames(
  inputPath: string,
  outputDir: string,
  times: number[],
  filenamePrefix = 'frame'
): Promise<string[]> {
  const outputPaths: string[] = [];

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (let i = 0; i < times.length; i++) {
    const outputPath = path.join(outputDir, `${filenamePrefix}_${i.toString().padStart(4, '0')}.jpg`);
    await extractFrame(inputPath, outputPath, times[i]);
    outputPaths.push(outputPath);
  }

  return outputPaths;
}

/**
 * Generate thumbnail at middle of video
 */
export async function generateThumbnail(
  inputPath: string,
  outputPath: string,
  options?: {
    width?: number;
    height?: number;
    seekPercent?: number;
  }
): Promise<void> {
  const { width = 320, height = -1, seekPercent = 0.5 } = options ?? {};

  return new Promise((resolve, reject) => {
    // First get duration
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to probe video: ${err.message}`));
        return;
      }

      const duration = metadata.format.duration ?? 0;
      const seekTime = duration * seekPercent;

      ffmpeg(inputPath)
        .seekInput(seekTime)
        .frames(1)
        .size(`${width}x${height === -1 ? '?' : height}`)
        .output(outputPath)
        .on('error', (error) => reject(new Error(`Failed to generate thumbnail: ${error.message}`)))
        .on('end', () => resolve())
        .run();
    });
  });
}

/**
 * Extract a clip from a video
 */
export async function extractClip(
  inputPath: string,
  outputPath: string,
  startTime: number,
  endTime: number,
  options?: {
    codec?: string;
    crf?: number;
    onProgress?: ProgressCallback;
  }
): Promise<void> {
  const { codec = 'libx264', crf = 23, onProgress } = options ?? {};
  const duration = endTime - startTime;

  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath)
      .seekInput(startTime)
      .duration(duration)
      .videoCodec(codec)
      .outputOptions([`-crf ${crf}`])
      .output(outputPath);

    if (onProgress) {
      command.on('progress', (progress) => {
        const percent = progress.percent ?? 0;
        onProgress(Math.min(100, Math.max(0, percent)));
      });
    }

    command
      .on('error', (err) => reject(new Error(`Failed to extract clip: ${err.message}`)))
      .on('end', () => resolve())
      .run();
  });
}

/**
 * Apply a LUT (Look-Up Table) to a video
 */
export async function applyLut(
  inputPath: string,
  outputPath: string,
  lutPath: string,
  options?: {
    onProgress?: ProgressCallback;
  }
): Promise<void> {
  const { onProgress } = options ?? {};

  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath)
      .videoFilter(`lut3d='${lutPath}'`)
      .output(outputPath);

    if (onProgress) {
      command.on('progress', (progress) => {
        const percent = progress.percent ?? 0;
        onProgress(Math.min(100, Math.max(0, percent)));
      });
    }

    command
      .on('error', (err) => reject(new Error(`Failed to apply LUT: ${err.message}`)))
      .on('end', () => resolve())
      .run();
  });
}

/**
 * Normalize audio levels
 */
export async function normalizeAudio(
  inputPath: string,
  outputPath: string,
  options?: {
    targetLoudness?: number; // LUFS, default -16
    onProgress?: ProgressCallback;
  }
): Promise<void> {
  const { targetLoudness = -16, onProgress } = options ?? {};

  return new Promise((resolve, reject) => {
    // Two-pass loudnorm
    const command = ffmpeg(inputPath)
      .audioFilter(`loudnorm=I=${targetLoudness}:TP=-1.5:LRA=11`)
      .output(outputPath);

    if (onProgress) {
      command.on('progress', (progress) => {
        const percent = progress.percent ?? 0;
        onProgress(Math.min(100, Math.max(0, percent)));
      });
    }

    command
      .on('error', (err) => reject(new Error(`Failed to normalize audio: ${err.message}`)))
      .on('end', () => resolve())
      .run();
  });
}

/**
 * Crop video to aspect ratio
 */
export async function cropToAspect(
  inputPath: string,
  outputPath: string,
  aspect: '16:9' | '9:16' | '1:1' | '4:5' | '4:3',
  options?: {
    x?: number;
    y?: number;
    onProgress?: ProgressCallback;
  }
): Promise<void> {
  const { x, y, onProgress } = options ?? {};

  // Parse aspect ratio
  const [aspectW, aspectH] = aspect.split(':').map(Number);

  return new Promise((resolve, reject) => {
    // Get video dimensions first
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to probe video: ${err.message}`));
        return;
      }

      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      if (!videoStream) {
        reject(new Error('No video stream found'));
        return;
      }

      const srcWidth = videoStream.width ?? 0;
      const srcHeight = videoStream.height ?? 0;

      // Calculate crop dimensions
      let cropWidth: number;
      let cropHeight: number;
      let cropX: number;
      let cropY: number;

      if (srcWidth / srcHeight > aspectW / aspectH) {
        // Video is wider than target
        cropHeight = srcHeight;
        cropWidth = Math.floor(srcHeight * (aspectW / aspectH));
        cropX = x ?? Math.floor((srcWidth - cropWidth) / 2);
        cropY = y ?? 0;
      } else {
        // Video is taller than target
        cropWidth = srcWidth;
        cropHeight = Math.floor(srcWidth * (aspectH / aspectW));
        cropX = x ?? 0;
        cropY = y ?? Math.floor((srcHeight - cropHeight) / 2);
      }

      const command = ffmpeg(inputPath)
        .videoFilter(`crop=${cropWidth}:${cropHeight}:${cropX}:${cropY}`)
        .output(outputPath);

      if (onProgress) {
        command.on('progress', (progress) => {
          const percent = progress.percent ?? 0;
          onProgress(Math.min(100, Math.max(0, percent)));
        });
      }

      command
        .on('error', (error) => reject(new Error(`Failed to crop video: ${error.message}`)))
        .on('end', () => resolve())
        .run();
    });
  });
}

/**
 * Deinterlace video
 */
export async function deinterlace(
  inputPath: string,
  outputPath: string,
  options?: {
    method?: 'yadif' | 'bwdif';
    onProgress?: ProgressCallback;
  }
): Promise<void> {
  const { method = 'yadif', onProgress } = options ?? {};

  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath)
      .videoFilter(method)
      .output(outputPath);

    if (onProgress) {
      command.on('progress', (progress) => {
        const percent = progress.percent ?? 0;
        onProgress(Math.min(100, Math.max(0, percent)));
      });
    }

    command
      .on('error', (err) => reject(new Error(`Failed to deinterlace: ${err.message}`)))
      .on('end', () => resolve())
      .run();
  });
}

/**
 * Get frame at specific time (for analysis)
 */
export async function getFrameBuffer(inputPath: string, timeSeconds: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    ffmpeg(inputPath)
      .seekInput(timeSeconds)
      .frames(1)
      .format('image2pipe')
      .videoCodec('mjpeg')
      .pipe()
      .on('data', (chunk: Buffer) => chunks.push(chunk))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', (err) => reject(new Error(`Failed to get frame: ${err.message}`)));
  });
}

/**
 * Concatenate multiple videos
 */
export async function concatenateVideos(
  inputPaths: string[],
  outputPath: string,
  options?: {
    onProgress?: ProgressCallback;
  }
): Promise<void> {
  const { onProgress } = options ?? {};

  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    // Add all inputs
    for (const inputPath of inputPaths) {
      command.input(inputPath);
    }

    command
      .complexFilter([
        `concat=n=${inputPaths.length}:v=1:a=1[outv][outa]`,
      ])
      .outputOptions([
        '-map [outv]',
        '-map [outa]',
      ])
      .output(outputPath);

    if (onProgress) {
      command.on('progress', (progress) => {
        const percent = progress.percent ?? 0;
        onProgress(Math.min(100, Math.max(0, percent)));
      });
    }

    command
      .on('error', (err) => reject(new Error(`Failed to concatenate videos: ${err.message}`)))
      .on('end', () => resolve())
      .run();
  });
}
