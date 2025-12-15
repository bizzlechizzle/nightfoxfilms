/**
 * Sharpness Service
 *
 * Analyzes frame sharpness using Laplacian variance method.
 * Used to find the sharpest frame within a scene for thumbnails.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { SharpnessResult } from '@nightfox/core';

/**
 * Sharpness analysis options
 */
export interface SharpnessOptions {
  sampleInterval?: number; // Seconds between samples
  startTime?: number;
  endTime?: number;
  maxSamples?: number;
}

/**
 * Analyze sharpness of frames in a video segment
 */
export async function analyzeSharpness(
  filePath: string,
  options: SharpnessOptions = {}
): Promise<SharpnessResult[]> {
  const {
    sampleInterval = 1,
    startTime = 0,
    endTime,
    maxSamples = 100,
  } = options;

  // Get video duration if end time not specified
  const actualEndTime = endTime ?? await getVideoDuration(filePath);
  const results: SharpnessResult[] = [];

  // Calculate sample times
  const sampleTimes: number[] = [];
  let currentTime = startTime;
  while (currentTime < actualEndTime && sampleTimes.length < maxSamples) {
    sampleTimes.push(currentTime);
    currentTime += sampleInterval;
  }

  // Analyze each sample
  for (const time of sampleTimes) {
    try {
      const sharpness = await analyzeFrameSharpness(filePath, time);
      if (sharpness !== null) {
        // Estimate frame number (30fps default)
        const frameNumber = Math.floor(time * 30);
        results.push({
          frame_number: frameNumber,
          time_seconds: time,
          sharpness,
        });
      }
    } catch (error) {
      // Skip frames that fail analysis
      console.warn(`Failed to analyze frame at ${time}s:`, error);
    }
  }

  return results;
}

/**
 * Analyze sharpness of a single frame using Laplacian variance
 */
async function analyzeFrameSharpness(
  filePath: string,
  timeSeconds: number
): Promise<number | null> {
  return new Promise((resolve) => {
    // Use ffmpeg to extract frame and compute Laplacian variance
    // The blur detection filter gives us variance which indicates sharpness
    const args = [
      '-ss', timeSeconds.toString(),
      '-i', filePath,
      '-vframes', '1',
      '-vf', 'format=gray,laplacian=scale=1:delta=0:flags=accurate_rnd',
      '-f', 'null',
      '-'
    ];

    // Alternative: Use signalstats filter for blur detection
    const args2 = [
      '-ss', timeSeconds.toString(),
      '-i', filePath,
      '-vframes', '1',
      '-vf', 'signalstats=stat=tout+vrep+brng,metadata=print',
      '-f', 'null',
      '-'
    ];

    // Simplest approach: Use the blur filter score
    const blurArgs = [
      '-ss', timeSeconds.toString(),
      '-i', filePath,
      '-vframes', '1',
      '-vf', 'format=gray,convolution="0 -1 0 -1 4 -1 0 -1 0:0 -1 0 -1 4 -1 0 -1 0:0 -1 0 -1 4 -1 0 -1 0:0 -1 0 -1 4 -1 0 -1 0"',
      '-f', 'rawvideo',
      '-pix_fmt', 'gray',
      '-'
    ];

    const proc = spawn('ffmpeg', blurArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];

    proc.stdout.on('data', (data) => {
      chunks.push(data);
    });

    proc.on('error', () => {
      resolve(null);
    });

    proc.on('close', (code) => {
      if (code !== 0 || chunks.length === 0) {
        resolve(null);
        return;
      }

      // Calculate variance of pixel values (Laplacian variance)
      const data = Buffer.concat(chunks);
      const variance = calculateVariance(data);
      resolve(variance);
    });
  });
}

/**
 * Calculate variance of pixel values
 */
function calculateVariance(buffer: Buffer): number {
  if (buffer.length === 0) return 0;

  // Calculate mean
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i];
  }
  const mean = sum / buffer.length;

  // Calculate variance
  let varianceSum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const diff = buffer[i] - mean;
    varianceSum += diff * diff;
  }

  return varianceSum / buffer.length;
}

/**
 * Find the sharpest frame in a video segment
 */
export async function findSharpestFrame(
  filePath: string,
  options: SharpnessOptions = {}
): Promise<SharpnessResult | null> {
  const results = await analyzeSharpness(filePath, options);

  if (results.length === 0) return null;

  // Find frame with highest sharpness
  let maxSharpness = -1;
  let sharpestFrame: SharpnessResult | null = null;

  for (const result of results) {
    if (result.sharpness > maxSharpness) {
      maxSharpness = result.sharpness;
      sharpestFrame = result;
    }
  }

  return sharpestFrame;
}

/**
 * Find sharpest frame within a specific time range
 */
export async function findSharpestFrameInRange(
  filePath: string,
  startTime: number,
  endTime: number,
  sampleCount: number = 10
): Promise<SharpnessResult | null> {
  const duration = endTime - startTime;
  const interval = duration / sampleCount;

  return findSharpestFrame(filePath, {
    startTime,
    endTime,
    sampleInterval: interval,
    maxSamples: sampleCount,
  });
}

/**
 * Score frame sharpness on a 0-100 scale
 */
export function normalizeSharpnessScore(
  variance: number,
  baseline: number = 500
): number {
  // Normalize to 0-100 scale based on baseline
  // Higher variance = sharper image
  const score = (variance / baseline) * 100;
  return Math.min(100, Math.max(0, score));
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
 * Quick sharpness score for a single timestamp
 */
export async function getSharpnessScore(
  filePath: string,
  timeSeconds: number
): Promise<number | null> {
  const sharpness = await analyzeFrameSharpness(filePath, timeSeconds);
  if (sharpness === null) return null;
  return normalizeSharpnessScore(sharpness);
}
