/**
 * Export Service
 *
 * Handles exporting screenshots and video clips with optional
 * LUT application, audio normalization, and cropping.
 */

import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import type { AspectRatio, ExportInput } from '@nightfox/core';
import {
  extractFrame,
  extractClip,
  applyLut,
  normalizeAudio,
  cropToAspect,
  type ProgressCallback,
} from './ffmpeg-service';

/**
 * Screenshot export options
 */
export interface ScreenshotOptions {
  timeSeconds: number;
  outputPath: string;
  width?: number;
  height?: number;
  aspectRatio?: AspectRatio;
  lutPath?: string;
  quality?: number; // 1-100 for JPEG
}

/**
 * Clip export options
 */
export interface ClipOptions {
  startTime: number;
  endTime: number;
  outputPath: string;
  aspectRatio?: AspectRatio;
  lutPath?: string;
  normalizeAudio?: boolean;
  codec?: string;
  crf?: number;
  onProgress?: ProgressCallback;
}

/**
 * Export a screenshot from a video
 */
export async function exportScreenshot(
  inputPath: string,
  options: ScreenshotOptions
): Promise<string> {
  const {
    timeSeconds,
    outputPath,
    width,
    height,
    aspectRatio,
    lutPath,
    quality = 95,
  } = options;

  // Create output directory if needed
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Determine output format from extension
  const ext = path.extname(outputPath).toLowerCase();
  const isJpeg = ext === '.jpg' || ext === '.jpeg';

  // Build ffmpeg filter chain
  const filters: string[] = [];

  // Add crop filter if aspect ratio specified
  if (aspectRatio) {
    filters.push(buildCropFilter(aspectRatio));
  }

  // Add scale filter if dimensions specified
  if (width || height) {
    const w = width ?? -1;
    const h = height ?? -1;
    filters.push(`scale=${w}:${h}`);
  }

  // Add LUT filter if specified
  if (lutPath && fs.existsSync(lutPath)) {
    filters.push(`lut3d='${lutPath}'`);
  }

  // Build ffmpeg command
  const filterStr = filters.length > 0 ? filters.join(',') : null;
  await runScreenshotExtract(inputPath, outputPath, timeSeconds, filterStr, isJpeg ? quality : undefined);

  return outputPath;
}

/**
 * Export a video clip
 */
export async function exportClip(
  inputPath: string,
  options: ClipOptions
): Promise<string> {
  const {
    startTime,
    endTime,
    outputPath,
    aspectRatio,
    lutPath,
    normalizeAudio: shouldNormalize = false,
    codec = 'libx264',
    crf = 23,
    onProgress,
  } = options;

  // Create output directory if needed
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Create temp path for intermediate processing
  const tempDir = path.join(outputDir, '.temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  let currentInput = inputPath;
  let tempFiles: string[] = [];

  try {
    // Step 1: Extract clip
    const tempClip = path.join(tempDir, `clip_${Date.now()}.mp4`);
    await extractClip(currentInput, tempClip, startTime, endTime, {
      codec,
      crf,
      onProgress: onProgress ? (p) => onProgress(p * 0.33) : undefined,
    });
    currentInput = tempClip;
    tempFiles.push(tempClip);

    // Step 2: Apply crop if needed
    if (aspectRatio) {
      const tempCrop = path.join(tempDir, `crop_${Date.now()}.mp4`);
      await cropToAspect(currentInput, tempCrop, aspectRatio, {
        onProgress: onProgress ? (p) => onProgress(33 + p * 0.22) : undefined,
      });
      currentInput = tempCrop;
      tempFiles.push(tempCrop);
    }

    // Step 3: Apply LUT if specified
    if (lutPath && fs.existsSync(lutPath)) {
      const tempLut = path.join(tempDir, `lut_${Date.now()}.mp4`);
      await applyLut(currentInput, tempLut, lutPath, {
        onProgress: onProgress ? (p) => onProgress(55 + p * 0.22) : undefined,
      });
      currentInput = tempLut;
      tempFiles.push(tempLut);
    }

    // Step 4: Normalize audio if needed
    if (shouldNormalize) {
      const tempAudio = path.join(tempDir, `audio_${Date.now()}.mp4`);
      await normalizeAudio(currentInput, tempAudio, {
        onProgress: onProgress ? (p) => onProgress(77 + p * 0.23) : undefined,
      });
      currentInput = tempAudio;
      tempFiles.push(tempAudio);
    }

    // Move final output to destination
    if (currentInput !== outputPath) {
      fs.copyFileSync(currentInput, outputPath);
    }

    if (onProgress) {
      onProgress(100);
    }

    return outputPath;
  } finally {
    // Clean up temp files
    for (const tempFile of tempFiles) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch {
        // Ignore cleanup errors
      }
    }

    // Try to remove temp directory
    try {
      if (fs.existsSync(tempDir) && fs.readdirSync(tempDir).length === 0) {
        fs.rmdirSync(tempDir);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Run ffmpeg to extract a screenshot with filters
 */
async function runScreenshotExtract(
  inputPath: string,
  outputPath: string,
  timeSeconds: number,
  filterStr: string | null,
  jpegQuality?: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-ss', timeSeconds.toString(),
      '-i', inputPath,
      '-vframes', '1',
    ];

    if (filterStr) {
      args.push('-vf', filterStr);
    }

    if (jpegQuality) {
      args.push('-q:v', Math.round((100 - jpegQuality) / 100 * 31 + 1).toString());
    }

    args.push('-y', outputPath);

    const proc = spawn('ffmpeg', args);
    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Build crop filter for aspect ratio
 */
function buildCropFilter(aspectRatio: AspectRatio): string {
  const [w, h] = aspectRatio.split(':').map(Number);
  const ratio = w / h;

  // Use ffmpeg crop filter with expression
  // This crops to center by default
  return `crop=if(gt(ih*${ratio}\\,iw)\\,iw\\,ih*${ratio}):if(gt(ih*${ratio}\\,iw)\\,iw/${ratio}\\,ih)`;
}

/**
 * Generate a thumbnail for a video with advanced options
 */
export async function generateVideoThumbnail(
  inputPath: string,
  outputPath: string,
  options: {
    seekPercent?: number;
    width?: number;
    aspectRatio?: AspectRatio;
    lutPath?: string;
  } = {}
): Promise<string> {
  const {
    seekPercent = 0.5,
    width = 320,
    aspectRatio,
    lutPath,
  } = options;

  // Get video duration
  const duration = await getVideoDuration(inputPath);
  const timeSeconds = duration * seekPercent;

  return exportScreenshot(inputPath, {
    timeSeconds,
    outputPath,
    width,
    aspectRatio,
    lutPath,
    quality: 85,
  });
}

/**
 * Get video duration
 */
async function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ];

    const proc = spawn('ffprobe', args);
    let stdout = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('error', () => resolve(0));

    proc.on('close', () => {
      const duration = parseFloat(stdout.trim());
      resolve(isNaN(duration) ? 0 : duration);
    });
  });
}

/**
 * Batch export screenshots for all scenes
 */
export async function exportSceneScreenshots(
  inputPath: string,
  scenes: Array<{ start_time: number; end_time: number; scene_number: number }>,
  outputDir: string,
  options: Omit<ScreenshotOptions, 'timeSeconds' | 'outputPath'> = {}
): Promise<string[]> {
  const outputs: string[] = [];

  for (const scene of scenes) {
    // Use middle of scene for screenshot
    const timeSeconds = (scene.start_time + scene.end_time) / 2;
    const filename = `scene_${scene.scene_number.toString().padStart(3, '0')}.jpg`;
    const outputPath = path.join(outputDir, filename);

    try {
      await exportScreenshot(inputPath, {
        ...options,
        timeSeconds,
        outputPath,
      });
      outputs.push(outputPath);
    } catch (error) {
      console.error(`Failed to export screenshot for scene ${scene.scene_number}:`, error);
    }
  }

  return outputs;
}
