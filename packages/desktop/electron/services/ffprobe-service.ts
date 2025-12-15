/**
 * FFprobe Service
 *
 * Video metadata extraction using ffprobe.
 * Extracts duration, resolution, codec, framerate, etc.
 */

import { spawn } from 'child_process';
import type { FFProbeResult, FFProbeFormat, FFProbeStream } from '@nightfox/core';

/**
 * Run ffprobe command and return JSON output
 */
async function runFFprobe(filePath: string): Promise<FFProbeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];

    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      reject(new Error(`Failed to spawn ffprobe: ${error.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result as FFProbeResult);
      } catch (error) {
        reject(new Error(`Failed to parse ffprobe output: ${error}`));
      }
    });
  });
}

/**
 * Check if ffprobe is available
 */
export async function isFFprobeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', ['-version']);
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Get video metadata using ffprobe
 */
export async function getVideoMetadata(filePath: string): Promise<FFProbeResult> {
  return runFFprobe(filePath);
}

/**
 * Extract key video info from ffprobe result
 */
export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  codec: string;
  bitrate: number | null;
  audioCodec: string | null;
  audioChannels: number | null;
  audioSampleRate: number | null;
}

/**
 * Parse ffprobe result into simplified VideoInfo
 */
export function parseVideoInfo(result: FFProbeResult): VideoInfo {
  // Find video stream
  const videoStream = result.streams.find((s) => s.codec_type === 'video');
  const audioStream = result.streams.find((s) => s.codec_type === 'audio');

  // Parse frame rate (e.g., "30000/1001" -> 29.97)
  let frameRate = 0;
  if (videoStream?.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    frameRate = den ? num / den : num;
  } else if (videoStream?.avg_frame_rate) {
    const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
    frameRate = den ? num / den : num;
  }

  // Parse duration
  let duration = 0;
  if (result.format.duration) {
    duration = parseFloat(result.format.duration);
  } else if (videoStream?.duration) {
    duration = parseFloat(videoStream.duration);
  }

  // Parse bitrate
  let bitrate: number | null = null;
  if (result.format.bit_rate) {
    bitrate = parseInt(result.format.bit_rate, 10);
  }

  return {
    duration,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    frameRate,
    codec: videoStream?.codec_name ?? 'unknown',
    bitrate,
    audioCodec: audioStream?.codec_name ?? null,
    audioChannels: audioStream?.channels ?? null,
    audioSampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : null,
  };
}

/**
 * Get simplified video info for a file
 */
export async function getVideoInfo(filePath: string): Promise<VideoInfo> {
  const result = await getVideoMetadata(filePath);
  return parseVideoInfo(result);
}

/**
 * Get video duration in seconds
 */
export async function getVideoDuration(filePath: string): Promise<number> {
  const result = await getVideoMetadata(filePath);
  if (result.format.duration) {
    return parseFloat(result.format.duration);
  }
  return 0;
}

/**
 * Check if file is a valid video
 */
export async function isValidVideo(filePath: string): Promise<boolean> {
  try {
    const result = await getVideoMetadata(filePath);
    const hasVideoStream = result.streams.some((s) => s.codec_type === 'video');
    return hasVideoStream;
  } catch {
    return false;
  }
}

/**
 * Get raw ffprobe JSON output as string (for storage)
 */
export async function getFFprobeJson(filePath: string): Promise<string> {
  const result = await getVideoMetadata(filePath);
  return JSON.stringify(result);
}
