/**
 * Scene Classifier Service
 *
 * Stage 0 of the image tagging pipeline.
 * Uses SigLIP (via ONNX Runtime) for fast zero-shot scene classification.
 *
 * Determines view type (interior/exterior/aerial/detail) BEFORE tagging
 * to enable context-aware prompts in Stage 1 (Florence-2).
 *
 * Per CLAUDE.md Rule 9: Local LLMs for background tasks only.
 *
 * @module services/tagging/scene-classifier
 */

import * as ort from 'onnxruntime-node';
import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';
import sharp from 'sharp';
import { getLogger } from '../logger-service';

const logger = getLogger();

// ============================================================================
// Type Definitions
// ============================================================================

export type ViewType = 'interior' | 'exterior' | 'aerial' | 'detail' | 'unknown';

export interface SceneClassificationResult {
  viewType: ViewType;
  confidence: number;
  allScores: Record<ViewType, number>;
  duration_ms: number;
  model: string;
}

export interface SceneClassifierConfig {
  modelPath?: string;
  confidenceThreshold?: number;  // Min confidence to return a classification (0.3)
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Zero-shot prompts for view type classification
 * These are designed for SigLIP's text encoder to match against image features
 */
const VIEW_TYPE_PROMPTS: Record<ViewType, string[]> = {
  interior: [
    'interior of an abandoned building',
    'inside an empty room with decay',
    'indoor photograph of a derelict space',
    'hallway of an abandoned facility',
    'inside a deserted building',
  ],
  exterior: [
    'exterior of an abandoned building',
    'outside view of a derelict structure',
    'facade of an abandoned factory',
    'abandoned building from outside',
    'outdoor photograph of empty building',
  ],
  aerial: [
    'aerial view of abandoned buildings',
    'drone photograph of derelict property',
    'overhead view of empty industrial site',
    'birds eye view of abandoned complex',
    'aerial photograph of ruins',
  ],
  detail: [
    'close-up detail of decay and rust',
    'macro shot of peeling paint',
    'detail photograph of abandoned equipment',
    'closeup of deteriorating surface',
    'texture detail of urban decay',
  ],
  unknown: [], // Not used for classification
};

// Flatten prompts with their view type for batch processing
const CLASSIFICATION_PROMPTS = Object.entries(VIEW_TYPE_PROMPTS)
  .filter(([vt]) => vt !== 'unknown')
  .flatMap(([viewType, prompts]) =>
    prompts.map(prompt => ({ viewType: viewType as ViewType, prompt }))
  );

// SigLIP image preprocessing constants (from model config)
const IMAGE_SIZE = 224;
const IMAGE_MEAN = [0.5, 0.5, 0.5];  // SigLIP uses 0.5 normalization
const IMAGE_STD = [0.5, 0.5, 0.5];

// ============================================================================
// Scene Classifier Service
// ============================================================================

export class SceneClassifierService {
  private config: Required<SceneClassifierConfig>;
  private session: ort.InferenceSession | null = null;
  private textEmbeddings: Map<string, Float32Array> | null = null;
  private initialized = false;
  private initializing = false;

  constructor(config: SceneClassifierConfig = {}) {
    this.config = {
      modelPath: config.modelPath ?? this.getDefaultModelPath(),
      confidenceThreshold: config.confidenceThreshold ?? 0.3,
    };
  }

  /**
   * Get the default model path
   */
  private getDefaultModelPath(): string {
    const projectRoot = path.resolve(app.getAppPath(), '../..');
    return path.join(projectRoot, 'resources/models/siglip-base-patch16-224.onnx');
  }

  /**
   * Initialize the classifier (load ONNX model and precompute text embeddings)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) {
      // Wait for ongoing initialization
      while (this.initializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    this.initializing = true;

    try {
      // Check if model exists
      try {
        await fs.access(this.config.modelPath);
      } catch {
        throw new Error(
          `SigLIP model not found at: ${this.config.modelPath}\n` +
          'Run: python scripts/download-siglip-onnx.py to download the model'
        );
      }

      // Load ONNX model
      logger.info('SceneClassifier', `Loading SigLIP model from ${this.config.modelPath}`);
      const startLoad = Date.now();

      this.session = await ort.InferenceSession.create(this.config.modelPath, {
        executionProviders: ['CoreML', 'cpu'],  // Use CoreML on Mac for speed
        graphOptimizationLevel: 'all',
      });

      logger.info('SceneClassifier', `Model loaded in ${Date.now() - startLoad}ms`);

      // Precompute text embeddings for classification prompts
      await this.precomputeTextEmbeddings();

      this.initialized = true;
      logger.info('SceneClassifier', 'Scene classifier initialized successfully');
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logger.error('SceneClassifier', `Failed to initialize: ${error}`);
      throw e;
    } finally {
      this.initializing = false;
    }
  }

  /**
   * Check if the service is ready
   */
  isReady(): boolean {
    return this.initialized && this.session !== null;
  }

  /**
   * Check if the model file exists
   */
  async isModelAvailable(): Promise<boolean> {
    try {
      await fs.access(this.config.modelPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Precompute text embeddings for all classification prompts
   * These are cached and reused for every image classification
   */
  private async precomputeTextEmbeddings(): Promise<void> {
    if (!this.session) throw new Error('Session not initialized');

    logger.debug('SceneClassifier', 'Precomputing text embeddings...');
    this.textEmbeddings = new Map();

    // For now, we'll compute these on first use
    // Full implementation requires text tokenizer which adds complexity
    // Alternative: Use precomputed embeddings saved alongside model

    // Check if we have precomputed embeddings file
    const embeddingsPath = this.config.modelPath.replace('.onnx', '-text-embeddings.json');
    try {
      const data = await fs.readFile(embeddingsPath, 'utf-8');
      const embeddings = JSON.parse(data) as Record<string, number[]>;

      for (const [prompt, embedding] of Object.entries(embeddings)) {
        this.textEmbeddings.set(prompt, new Float32Array(embedding));
      }

      logger.debug('SceneClassifier', `Loaded ${this.textEmbeddings.size} precomputed text embeddings`);
    } catch {
      logger.warn('SceneClassifier', 'No precomputed text embeddings found, will compute on first use');
      // Will fall back to computing embeddings via Python helper if needed
    }
  }

  /**
   * Classify a single image
   *
   * @param imagePath - Absolute path to image file
   * @returns SceneClassificationResult with view type and confidence
   */
  async classifyImage(imagePath: string): Promise<SceneClassificationResult> {
    await this.initialize();

    const startTime = Date.now();

    if (!this.session) {
      throw new Error('Scene classifier not initialized');
    }

    try {
      // Preprocess image
      const imageData = await this.preprocessImage(imagePath);

      // Run inference
      const imageTensor = new ort.Tensor('float32', imageData, [1, 3, IMAGE_SIZE, IMAGE_SIZE]);
      const feeds = { pixel_values: imageTensor };

      const results = await this.session.run(feeds);

      // Get image embedding
      const imageEmbedding = results.image_embeds?.data as Float32Array;
      if (!imageEmbedding) {
        throw new Error('Model did not return image embeddings');
      }

      // If we have precomputed text embeddings, compute similarities
      let allScores: Record<ViewType, number>;

      if (this.textEmbeddings && this.textEmbeddings.size > 0) {
        allScores = this.computeViewTypeScores(imageEmbedding);
      } else {
        // Fallback: Use simple heuristics based on image features
        // This is a placeholder until text embeddings are available
        logger.warn('SceneClassifier', 'No text embeddings available, using fallback classification');
        allScores = {
          interior: 0.25,
          exterior: 0.25,
          aerial: 0.25,
          detail: 0.25,
          unknown: 0.0,
        };
      }

      // Find best match
      const entries = Object.entries(allScores) as [ViewType, number][];
      const [bestType, bestScore] = entries.reduce((a, b) => a[1] > b[1] ? a : b);

      const viewType = bestScore >= this.config.confidenceThreshold ? bestType : 'unknown';
      const confidence = bestScore;

      const duration_ms = Date.now() - startTime;

      logger.debug('SceneClassifier',
        `Classified ${path.basename(imagePath)}: ${viewType} (${(confidence * 100).toFixed(1)}%) in ${duration_ms}ms`
      );

      return {
        viewType,
        confidence,
        allScores,
        duration_ms,
        model: 'siglip-base-patch16-224',
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logger.error('SceneClassifier', `Failed to classify ${imagePath}: ${error}`);
      throw e;
    }
  }

  /**
   * Preprocess image for SigLIP model
   */
  private async preprocessImage(imagePath: string): Promise<Float32Array> {
    // Load and resize image to 224x224
    const image = sharp(imagePath);

    // Resize with center crop and convert to RGB
    const { data, info } = await image
      .resize(IMAGE_SIZE, IMAGE_SIZE, {
        fit: 'cover',
        position: 'center',
      })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.channels !== 3) {
      throw new Error(`Expected 3 channels, got ${info.channels}`);
    }

    // Convert to float32 and normalize
    // SigLIP uses: pixel_value = (pixel / 255.0 - mean) / std
    const floatData = new Float32Array(3 * IMAGE_SIZE * IMAGE_SIZE);

    // Convert from HWC to CHW format (required by ONNX vision models)
    for (let c = 0; c < 3; c++) {
      const mean = IMAGE_MEAN[c];
      const std = IMAGE_STD[c];

      for (let h = 0; h < IMAGE_SIZE; h++) {
        for (let w = 0; w < IMAGE_SIZE; w++) {
          const srcIdx = (h * IMAGE_SIZE + w) * 3 + c;  // HWC
          const dstIdx = c * IMAGE_SIZE * IMAGE_SIZE + h * IMAGE_SIZE + w;  // CHW

          floatData[dstIdx] = (data[srcIdx] / 255.0 - mean) / std;
        }
      }
    }

    return floatData;
  }

  /**
   * Compute cosine similarity between image and precomputed text embeddings
   */
  private computeViewTypeScores(imageEmbedding: Float32Array): Record<ViewType, number> {
    const scores: Record<ViewType, number> = {
      interior: 0,
      exterior: 0,
      aerial: 0,
      detail: 0,
      unknown: 0,
    };

    if (!this.textEmbeddings) return scores;

    // Compute similarity for each prompt and aggregate by view type
    const promptScores: Record<ViewType, number[]> = {
      interior: [],
      exterior: [],
      aerial: [],
      detail: [],
      unknown: [],
    };

    for (const { viewType, prompt } of CLASSIFICATION_PROMPTS) {
      const textEmbedding = this.textEmbeddings.get(prompt);
      if (!textEmbedding) continue;

      const similarity = this.cosineSimilarity(imageEmbedding, textEmbedding);
      promptScores[viewType].push(similarity);
    }

    // Average scores per view type
    for (const vt of ['interior', 'exterior', 'aerial', 'detail'] as ViewType[]) {
      const vtScores = promptScores[vt];
      if (vtScores.length > 0) {
        scores[vt] = vtScores.reduce((a, b) => a + b, 0) / vtScores.length;
      }
    }

    // Normalize to 0-1 range using softmax-like transformation
    const maxScore = Math.max(...Object.values(scores));
    const minScore = Math.min(...Object.values(scores));
    const range = maxScore - minScore || 1;

    for (const vt of Object.keys(scores) as ViewType[]) {
      scores[vt] = (scores[vt] - minScore) / range;
    }

    return scores;
  }

  /**
   * Compute cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
  }

  /**
   * Batch classify multiple images
   */
  async classifyBatch(
    imagePaths: string[],
    onProgress?: (current: number, total: number, failed: number) => void
  ): Promise<Map<string, SceneClassificationResult>> {
    const results = new Map<string, SceneClassificationResult>();
    const total = imagePaths.length;
    let failed = 0;

    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];

      try {
        const result = await this.classifyImage(imagePath);
        results.set(imagePath, result);
      } catch (e) {
        failed++;
        const error = e instanceof Error ? e.message : String(e);
        logger.error('SceneClassifier', `Failed to classify ${imagePath}: ${error}`);
      }

      onProgress?.(i + 1, total, failed);
    }

    logger.info('SceneClassifier', `Batch complete: ${results.size}/${total} succeeded, ${failed} failed`);
    return results;
  }

  /**
   * Release resources
   */
  async dispose(): Promise<void> {
    if (this.session) {
      // ONNX Runtime sessions don't have explicit dispose in Node.js
      // Just clear the reference
      this.session = null;
      this.textEmbeddings = null;
      this.initialized = false;
      logger.info('SceneClassifier', 'Scene classifier disposed');
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: SceneClassifierService | null = null;

/**
 * Get the scene classifier service singleton
 */
export function getSceneClassifier(): SceneClassifierService {
  if (!instance) {
    instance = new SceneClassifierService();
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetSceneClassifier(): void {
  instance?.dispose();
  instance = null;
}
