/**
 * Captioning Service
 *
 * Generates AI captions for video frames and scenes.
 * Integrates with scene detection and sharpness analysis.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { litellmService, type CaptionResult, type LiteLLMSettings } from './litellm-service';
import { getFrameBuffer } from './ffmpeg-service';
import { findSharpestFrameInRange, type SharpnessOptions } from './sharpness-service';
// Minimal scene interface for captioning
interface MinimalScene {
  scene_number: number;
  start_time: number;
  end_time: number;
}

// =============================================================================
// TYPES
// =============================================================================

export interface SceneCaptionOptions {
  model?: string;
  useSharpestFrame?: boolean;
  sampleCount?: number;
  customPrompt?: string;
}

export interface SceneCaptionResult {
  sceneNumber: number;
  startTime: number;
  endTime: number;
  frameTime: number;
  caption: string;
  weddingMoment?: string;
  confidence?: number;
  durationMs: number;
}

export interface BatchCaptionProgress {
  current: number;
  total: number;
  sceneNumber: number;
  status: 'processing' | 'complete' | 'error';
  error?: string;
}

// =============================================================================
// CAPTIONING SERVICE
// =============================================================================

/**
 * Caption a single frame from a video
 */
export async function captionFrame(
  filePath: string,
  timeSeconds: number,
  options: {
    model?: string;
    prompt?: string;
  } = {}
): Promise<CaptionResult> {
  const { model = 'caption-local', prompt } = options;

  // Extract frame as buffer
  const frameBuffer = await getFrameBuffer(filePath, timeSeconds);
  const base64 = frameBuffer.toString('base64');

  // Caption with LiteLLM
  return litellmService.captionImage(base64, model, prompt);
}

/**
 * Caption a scene using the sharpest frame
 */
export async function captionScene(
  filePath: string,
  scene: { start_time: number; end_time: number; scene_number: number },
  options: SceneCaptionOptions = {}
): Promise<SceneCaptionResult> {
  const {
    model = 'caption-local',
    useSharpestFrame = true,
    sampleCount = 5,
    customPrompt,
  } = options;

  const startTime = Date.now();
  let frameTime: number;

  // Find best frame in scene
  if (useSharpestFrame) {
    const sharpest = await findSharpestFrameInRange(
      filePath,
      scene.start_time,
      scene.end_time,
      sampleCount
    );
    frameTime = sharpest?.time_seconds ?? (scene.start_time + scene.end_time) / 2;
  } else {
    // Use middle of scene
    frameTime = (scene.start_time + scene.end_time) / 2;
  }

  // Extract frame
  const frameBuffer = await getFrameBuffer(filePath, frameTime);
  const base64 = frameBuffer.toString('base64');

  // Generate caption
  const captionResult = await litellmService.captionImage(base64, model, customPrompt);

  // Detect wedding moment
  let weddingMoment: string | undefined;
  let confidence: number | undefined;

  try {
    const momentResult = await litellmService.detectWeddingMoment(base64, model);
    weddingMoment = momentResult.moment;
    confidence = momentResult.confidence;
  } catch (error) {
    console.warn(`[Captioning] Failed to detect wedding moment for scene ${scene.scene_number}:`, error);
  }

  return {
    sceneNumber: scene.scene_number,
    startTime: scene.start_time,
    endTime: scene.end_time,
    frameTime,
    caption: captionResult.caption,
    weddingMoment,
    confidence,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Caption all scenes in a video
 */
export async function captionAllScenes(
  filePath: string,
  scenes: MinimalScene[],
  options: SceneCaptionOptions & {
    onProgress?: (progress: BatchCaptionProgress) => void;
    maxConcurrent?: number;
  } = {}
): Promise<SceneCaptionResult[]> {
  const { onProgress, maxConcurrent = 1 } = options;
  const results: SceneCaptionResult[] = [];
  const total = scenes.length;

  // Process scenes sequentially (to avoid overwhelming the model)
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];

    if (onProgress) {
      onProgress({
        current: i + 1,
        total,
        sceneNumber: scene.scene_number,
        status: 'processing',
      });
    }

    try {
      const result = await captionScene(filePath, scene, options);
      results.push(result);

      if (onProgress) {
        onProgress({
          current: i + 1,
          total,
          sceneNumber: scene.scene_number,
          status: 'complete',
        });
      }
    } catch (error) {
      console.error(`[Captioning] Failed to caption scene ${scene.scene_number}:`, error);

      if (onProgress) {
        onProgress({
          current: i + 1,
          total,
          sceneNumber: scene.scene_number,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Add placeholder result
      results.push({
        sceneNumber: scene.scene_number,
        startTime: scene.start_time,
        endTime: scene.end_time,
        frameTime: (scene.start_time + scene.end_time) / 2,
        caption: '',
        durationMs: 0,
      });
    }
  }

  return results;
}

/**
 * Generate captions for key wedding moments
 */
export async function captionKeyMoments(
  filePath: string,
  scenes: MinimalScene[],
  options: {
    model?: string;
    targetMoments?: string[];
  } = {}
): Promise<Map<string, SceneCaptionResult>> {
  const {
    model = 'caption-local',
    targetMoments = [
      'ceremony',
      'first_kiss',
      'first_dance',
      'cake_cutting',
      'toasts',
    ],
  } = options;

  const momentMap = new Map<string, SceneCaptionResult>();

  for (const scene of scenes) {
    // Extract and analyze frame
    const frameTime = (scene.start_time + scene.end_time) / 2;
    const frameBuffer = await getFrameBuffer(filePath, frameTime);
    const base64 = frameBuffer.toString('base64');

    try {
      const momentResult = await litellmService.detectWeddingMoment(base64, model);

      // If this is a target moment and we haven't found a better one
      if (
        targetMoments.includes(momentResult.moment) &&
        (!momentMap.has(momentResult.moment) ||
          (momentMap.get(momentResult.moment)?.confidence || 0) < momentResult.confidence)
      ) {
        // Get full caption
        const captionResult = await litellmService.captionImage(base64, model);

        momentMap.set(momentResult.moment, {
          sceneNumber: scene.scene_number,
          startTime: scene.start_time,
          endTime: scene.end_time,
          frameTime,
          caption: captionResult.caption,
          weddingMoment: momentResult.moment,
          confidence: momentResult.confidence,
          durationMs: captionResult.durationMs,
        });
      }
    } catch (error) {
      console.warn(`[Captioning] Failed to analyze scene ${scene.scene_number}:`, error);
    }
  }

  return momentMap;
}

/**
 * Quick caption for a single timestamp
 */
export async function quickCaption(
  filePath: string,
  timeSeconds: number,
  model: string = 'caption-local'
): Promise<string> {
  const result = await captionFrame(filePath, timeSeconds, { model });
  return result.caption;
}

/**
 * Ensure LiteLLM is running before captioning
 */
export async function ensureCaptioningReady(
  settings: LiteLLMSettings
): Promise<boolean> {
  if (await litellmService.isRunning()) {
    return true;
  }

  return litellmService.start(settings);
}

// =============================================================================
// EXPORTS
// =============================================================================

export const captioningService = {
  captionFrame,
  captionScene,
  captionAllScenes,
  captionKeyMoments,
  quickCaption,
  ensureReady: ensureCaptioningReady,
};

export default captioningService;
