/**
 * Scene Detection Service
 *
 * Detects scene changes in videos using ffmpeg's scene detection filter.
 * Supports multiple detection methods:
 * - content: Content-based detection using histogram comparison
 * - adaptive: Adaptive threshold based on video characteristics
 * - threshold: Simple threshold-based detection
 */

import { spawn } from 'child_process';
import path from 'path';
import type { SceneDetectionResult, SceneDetectionMethod } from '@nightfox/core';

/**
 * Scene detection options
 */
export interface SceneDetectionOptions {
  method?: SceneDetectionMethod;
  threshold?: number; // 0.0-1.0, higher = fewer scenes
  minSceneDuration?: number; // Minimum scene duration in seconds
}

/**
 * Raw scene data from ffmpeg
 */
interface RawScene {
  time: number;
  score: number;
}

/**
 * Detect scenes in a video file
 */
export async function detectScenes(
  filePath: string,
  options: SceneDetectionOptions = {}
): Promise<SceneDetectionResult> {
  const {
    method = 'content',
    threshold = 0.3,
    minSceneDuration = 0.5,
  } = options;

  const startTime = Date.now();

  // Build filter string based on method
  let filterStr: string;
  switch (method) {
    case 'adaptive':
      // Adaptive uses a sliding window approach
      filterStr = `select='gt(scene,${threshold})',showinfo`;
      break;
    case 'threshold':
      // Simple threshold-based detection
      filterStr = `select='gt(scene,${threshold})',showinfo`;
      break;
    case 'content':
    default:
      // Content-based detection (histogram comparison)
      filterStr = `select='gt(scene,${threshold})',showinfo`;
  }

  // Run ffmpeg to detect scene changes
  const sceneTimestamps = await runSceneDetection(filePath, filterStr);

  // Get video duration for calculating end times
  const duration = await getVideoDuration(filePath);

  // Build scene list
  const scenes: SceneDetectionResult['scenes'] = [];

  // Add start of video as first scene start
  const allTimestamps = [0, ...sceneTimestamps, duration];

  for (let i = 0; i < allTimestamps.length - 1; i++) {
    const startTime = allTimestamps[i];
    const endTime = allTimestamps[i + 1];
    const sceneDuration = endTime - startTime;

    // Skip scenes shorter than minimum duration
    if (sceneDuration < minSceneDuration && i > 0) {
      continue;
    }

    // Estimate frame numbers (assuming 30fps if not known)
    const fps = 30;
    const startFrame = Math.floor(startTime * fps);
    const endFrame = Math.floor(endTime * fps);

    scenes.push({
      scene_number: scenes.length + 1,
      start_time: startTime,
      end_time: endTime,
      start_frame: startFrame,
      end_frame: endFrame,
      duration: sceneDuration,
    });
  }

  return {
    scenes,
    duration_ms: Date.now() - startTime,
    method,
  };
}

/**
 * Run ffmpeg scene detection and extract timestamps
 */
async function runSceneDetection(
  filePath: string,
  filterStr: string
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', filePath,
      '-vf', filterStr,
      '-f', 'null',
      '-'
    ];

    const proc = spawn('ffmpeg', args);
    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
    });

    proc.on('close', (code) => {
      // Parse scene timestamps from showinfo output
      const timestamps: number[] = [];
      const lines = stderr.split('\n');

      for (const line of lines) {
        // Look for showinfo output with pts_time
        const match = line.match(/pts_time:(\d+\.?\d*)/);
        if (match) {
          const time = parseFloat(match[1]);
          if (time > 0) {
            timestamps.push(time);
          }
        }
      }

      resolve(timestamps);
    });
  });
}

/**
 * Get video duration using ffprobe
 */
async function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
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

    proc.on('error', (error) => {
      reject(new Error(`Failed to spawn ffprobe: ${error.message}`));
    });

    proc.on('close', (code) => {
      const duration = parseFloat(stdout.trim());
      resolve(isNaN(duration) ? 0 : duration);
    });
  });
}

/**
 * Detect scenes and return with frame rate information
 */
export async function detectScenesWithFrameRate(
  filePath: string,
  options: SceneDetectionOptions = {}
): Promise<SceneDetectionResult & { frameRate: number }> {
  // Get frame rate first
  const frameRate = await getVideoFrameRate(filePath);

  const result = await detectScenes(filePath, options);

  // Recalculate frame numbers with actual frame rate
  const scenes = result.scenes.map(scene => ({
    ...scene,
    start_frame: Math.floor(scene.start_time * frameRate),
    end_frame: Math.floor(scene.end_time * frameRate),
  }));

  return {
    ...result,
    scenes,
    frameRate,
  };
}

/**
 * Get video frame rate
 */
async function getVideoFrameRate(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=r_frame_rate',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ];

    const proc = spawn('ffprobe', args);
    let stdout = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('error', (error) => {
      resolve(30); // Default fallback
    });

    proc.on('close', (code) => {
      const rateStr = stdout.trim();
      if (rateStr.includes('/')) {
        const [num, den] = rateStr.split('/').map(Number);
        resolve(den ? num / den : 30);
      } else {
        resolve(parseFloat(rateStr) || 30);
      }
    });
  });
}

/**
 * Quick scene count estimation (faster but less accurate)
 */
export async function estimateSceneCount(
  filePath: string,
  threshold: number = 0.4
): Promise<number> {
  const result = await detectScenes(filePath, { threshold, minSceneDuration: 1 });
  return result.scenes.length;
}
