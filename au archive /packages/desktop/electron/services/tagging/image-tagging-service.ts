/**
 * Image Tagging Service
 *
 * Two-stage background image tagging pipeline:
 * - Stage 0: SigLIP scene classification (view type detection)
 * - Stage 1: Florence-2 context-aware tagging
 *
 * Per CLAUDE.md Rule 9: Local LLMs for background tasks only.
 * This service is NEVER called for user-facing queries.
 *
 * @module services/tagging/image-tagging-service
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { app } from 'electron';
import { getLogger } from '../logger-service';
import {
  normalizeTags,
  detectViewType,
  suggestLocationType,
  suggestEra,
  detectConditions,
  filterRelevantTags,
  type NormalizedTag,
  type ViewTypeResult,
  type LocationTypeSuggestion,
  type EraSuggestion,
} from './urbex-taxonomy';
import {
  getSceneClassifier,
  type ViewType,
  type SceneClassificationResult,
} from './scene-classifier';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = getLogger();

// ============================================================================
// Type Definitions
// ============================================================================

export interface RawTagResult {
  tags: string[];
  confidence: Record<string, number>;
  caption?: string;  // Florence-2 provides captions
  quality_score?: number;  // Florence-2 provides quality score
  duration_ms: number;
}

export interface EnhancedTagResult {
  // Raw results from tagger
  rawTags: string[];
  rawConfidence: Record<string, number>;

  // Normalized urbex tags
  tags: string[];
  normalizedTags: NormalizedTag[];
  confidence: Record<string, number>;

  // Stage 0: Scene classification (SigLIP)
  sceneClassification?: SceneClassificationResult;

  // View classification (from Stage 0 if available, else taxonomy detection)
  viewType: ViewTypeResult;

  // Location insights
  suggestedType: LocationTypeSuggestion | null;
  suggestedEra: EraSuggestion | null;

  // Condition indicators
  conditions: {
    hasGraffiti: boolean;
    hasEquipment: boolean;
    hasDecay: boolean;
    hasNatureReclaim: boolean;
    conditionScore: number;
  };

  // Quality score (0-1) for hero selection
  qualityScore: number;

  // Caption from Florence-2 (if available)
  caption?: string;

  // Timing
  duration_ms: number;
  source: 'florence' | 'ram++' | 'local';
  model: string;
}

export interface TaggingContext {
  /** View type from Stage 0 scene classifier */
  viewType?: ViewType;
  /** Location type from database (hospital, factory, etc.) */
  locationType?: string;
  /** State/region from database */
  state?: string;
}

export interface TaggingConfig {
  // Stage 0: Scene classification
  enableSceneClassification?: boolean;  // Default: true

  // Stage 1: Tagging model
  taggerModel?: 'florence' | 'ram++';  // Default: florence

  // Local inference
  pythonPath?: string;          // Path to python with models installed
  device?: 'cuda' | 'mps' | 'cpu';

  // Processing
  confidenceThreshold?: number; // Min confidence to include tag (0.5)
  maxTags?: number;             // Max tags per image (30)
  timeout?: number;             // Timeout in ms (60000)
}

// ============================================================================
// Image Tagging Service
// ============================================================================

export class ImageTaggingService {
  private config: Required<TaggingConfig>;
  private initialized = false;
  private florenceAvailable = false;
  private ramppAvailable = false;

  constructor(config: TaggingConfig = {}) {
    this.config = {
      enableSceneClassification: config.enableSceneClassification ?? true,
      taggerModel: config.taggerModel ?? 'florence',
      pythonPath: config.pythonPath ?? 'python3',
      device: config.device ?? (process.platform === 'darwin' ? 'mps' : 'cuda'),
      confidenceThreshold: config.confidenceThreshold ?? 0.5,
      maxTags: config.maxTags ?? 30,
      timeout: config.timeout ?? 60000,
    };
  }

  /**
   * Initialize the service
   * Checks for available models and scene classifier
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const projectRoot = this.getProjectRoot();

    // Check for Florence-2 tagger
    const florencePath = path.join(projectRoot, 'scripts/florence_tagger.py');
    try {
      await fs.access(florencePath);
      this.florenceAvailable = true;
      logger.info('ImageTagging', 'Florence-2 tagger available');
    } catch {
      logger.warn('ImageTagging', 'Florence-2 tagger not found, falling back to RAM++');
    }

    // Check for RAM++ tagger (fallback)
    const ramppPath = path.join(projectRoot, 'scripts/ram_tagger.py');
    try {
      await fs.access(ramppPath);
      this.ramppAvailable = true;
      logger.debug('ImageTagging', 'RAM++ tagger available as fallback');
    } catch {
      logger.debug('ImageTagging', 'RAM++ tagger not found');
    }

    // Initialize scene classifier if enabled
    if (this.config.enableSceneClassification) {
      try {
        const classifier = getSceneClassifier();
        if (await classifier.isModelAvailable()) {
          logger.info('ImageTagging', 'SigLIP scene classifier available');
        } else {
          logger.warn('ImageTagging', 'SigLIP model not found - run scripts/download-siglip-onnx.py');
        }
      } catch (e) {
        logger.warn('ImageTagging', `Scene classifier init failed: ${e}`);
      }
    }

    this.initialized = true;
  }

  /**
   * Check if the service is ready
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Get current service status
   */
  async getStatus(): Promise<{
    available: boolean;
    model: string;
    sceneClassifier: boolean;
    lastCheck: string;
    error?: string;
  }> {
    await this.initialize();

    const model = this.florenceAvailable ? 'florence-2' :
                  this.ramppAvailable ? 'ram++' : 'none';

    const sceneClassifier = await getSceneClassifier().isModelAvailable();

    return {
      available: model !== 'none',
      model,
      sceneClassifier,
      lastCheck: new Date().toISOString(),
      error: model === 'none' ? 'No tagging model available' : undefined,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): TaggingConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TaggingConfig>): void {
    Object.assign(this.config, config);
    this.initialized = false;
  }

  /**
   * Get project root path (reliable anchor point)
   */
  private getProjectRoot(): string {
    return path.resolve(app.getAppPath(), '../..');
  }

  /**
   * Get the Python executable path, preferring venv if available
   */
  private async getPythonPath(): Promise<string> {
    const projectRoot = this.getProjectRoot();
    const venvPython = path.join(projectRoot, 'scripts/ram-server/venv/bin/python3');

    try {
      await fs.access(venvPython);
      return venvPython;
    } catch {
      return this.config.pythonPath;
    }
  }

  /**
   * Tag a single image with full two-stage pipeline
   *
   * Stage 0: Scene classification (if enabled)
   * Stage 1: Context-aware tagging
   *
   * @param imagePath - Absolute path to image file
   * @param context - Optional context from database (location type, state)
   * @returns EnhancedTagResult with tags, insights, and quality score
   */
  async tagImage(imagePath: string, context?: TaggingContext): Promise<EnhancedTagResult> {
    await this.initialize();

    const startTime = Date.now();
    let sceneResult: SceneClassificationResult | undefined;
    let viewType: ViewType | undefined = context?.viewType;

    // Stage 0: Scene Classification (if enabled and no view type provided)
    if (this.config.enableSceneClassification && !viewType) {
      try {
        const classifier = getSceneClassifier();
        if (await classifier.isModelAvailable()) {
          sceneResult = await classifier.classifyImage(imagePath);
          viewType = sceneResult.viewType;
          logger.debug('ImageTagging', `Stage 0: ${viewType} (${(sceneResult.confidence * 100).toFixed(0)}%)`);
        }
      } catch (e) {
        logger.warn('ImageTagging', `Scene classification failed: ${e}`);
      }
    }

    // Stage 1: Tagging
    let rawResult: RawTagResult;
    let source: 'florence' | 'ram++' | 'local';
    let model: string;

    if (this.florenceAvailable && this.config.taggerModel === 'florence') {
      rawResult = await this.tagViaFlorence(imagePath, {
        viewType,
        locationType: context?.locationType,
        state: context?.state,
      });
      source = 'florence';
      model = 'florence-2-large';
    } else if (this.ramppAvailable) {
      rawResult = await this.tagViaRampp(imagePath);
      source = 'ram++';
      model = 'ram++-swin-large';
    } else {
      throw new Error('No tagging model available');
    }

    // Enhance with urbex taxonomy
    const enhanced = this.enhanceResults(rawResult, source, model, Date.now() - startTime, sceneResult);

    logger.debug('ImageTagging',
      `Tagged ${path.basename(imagePath)}: ${enhanced.tags.length} tags, ` +
      `view=${enhanced.viewType.type}, quality=${enhanced.qualityScore.toFixed(2)}`
    );

    return enhanced;
  }

  /**
   * Tag via Florence-2 (Stage 1 primary)
   */
  private async tagViaFlorence(
    imagePath: string,
    context: { viewType?: ViewType; locationType?: string; state?: string }
  ): Promise<RawTagResult> {
    const startTime = Date.now();
    const projectRoot = this.getProjectRoot();
    const scriptPath = path.join(projectRoot, 'scripts/florence_tagger.py');
    const pythonPath = await this.getPythonPath();

    return new Promise((resolve, reject) => {
      const args = [
        scriptPath,
        '--image', imagePath,
        '--device', this.config.device,
        '--max-tags', String(this.config.maxTags),
        '--output', 'json',
      ];

      // Add context parameters
      if (context.viewType && context.viewType !== 'unknown') {
        args.push('--view-type', context.viewType);
      }
      if (context.locationType) {
        args.push('--location-type', context.locationType);
      }
      if (context.state) {
        args.push('--state', context.state);
      }

      const proc = spawn(pythonPath, args, {
        env: {
          ...process.env,
          PYTORCH_ENABLE_MPS_FALLBACK: '1',
        },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error('Florence-2 inference timed out'));
      }, this.config.timeout);

      proc.on('close', (code) => {
        clearTimeout(timeout);

        if (code !== 0) {
          const error = new Error(`Florence-2 inference failed (exit code ${code}): ${stderr}`);
          logger.error('ImageTagging', error.message);
          reject(error);
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve({
            tags: result.tags ?? [],
            confidence: result.confidence ?? {},
            caption: result.caption,
            quality_score: result.quality_score,
            duration_ms: result.duration_ms ?? (Date.now() - startTime),
          });
        } catch (e) {
          const error = new Error(`Failed to parse Florence-2 output: ${stdout.slice(0, 500)}`);
          logger.error('ImageTagging', error.message);
          reject(error);
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Florence-2 process: ${err.message}`));
      });
    });
  }

  /**
   * Tag via RAM++ (fallback)
   */
  private async tagViaRampp(imagePath: string): Promise<RawTagResult> {
    const startTime = Date.now();
    const projectRoot = this.getProjectRoot();
    const scriptPath = path.join(projectRoot, 'scripts/ram_tagger.py');
    const pythonPath = await this.getPythonPath();

    return new Promise((resolve, reject) => {
      const args = [
        scriptPath,
        '--image', imagePath,
        '--device', this.config.device,
        '--max-tags', String(this.config.maxTags),
        '--output', 'json',
      ];

      const proc = spawn(pythonPath, args, {
        env: {
          ...process.env,
          PYTORCH_ENABLE_MPS_FALLBACK: '1',
        },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error('RAM++ inference timed out'));
      }, this.config.timeout);

      proc.on('close', (code) => {
        clearTimeout(timeout);

        if (code !== 0) {
          const error = new Error(`RAM++ inference failed (exit code ${code}): ${stderr}`);
          logger.error('ImageTagging', error.message);
          reject(error);
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve({
            tags: result.tags ?? [],
            confidence: result.confidence ?? {},
            duration_ms: result.duration_ms ?? (Date.now() - startTime),
          });
        } catch (e) {
          const error = new Error(`Failed to parse RAM++ output: ${stdout.slice(0, 500)}`);
          logger.error('ImageTagging', error.message);
          reject(error);
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn RAM++ process: ${err.message}`));
      });
    });
  }

  /**
   * Enhance raw results with urbex taxonomy
   */
  private enhanceResults(
    raw: RawTagResult,
    source: 'florence' | 'ram++' | 'local',
    model: string,
    totalDuration: number,
    sceneResult?: SceneClassificationResult
  ): EnhancedTagResult {
    // Normalize tags through urbex taxonomy
    const normalizedTags = normalizeTags(raw.tags);

    // Filter to relevant urbex tags
    const relevantTags = filterRelevantTags(raw.tags, 0.5);

    // Include high-confidence raw tags not in taxonomy
    for (const tag of raw.tags) {
      const conf = raw.confidence[tag] ?? 0;
      if (conf >= 0.7 && !relevantTags.includes(tag.toLowerCase())) {
        relevantTags.push(tag.toLowerCase());
      }
    }

    // Build confidence map for normalized tags
    const confidence: Record<string, number> = {};
    for (const nt of normalizedTags) {
      const rawConf = raw.confidence[nt.original] ?? raw.confidence[nt.normalized] ?? 0.5;
      confidence[nt.normalized] = rawConf * nt.confidence;
    }

    // Use scene classification for view type if available, otherwise detect from tags
    let viewType: ViewTypeResult;
    if (sceneResult && sceneResult.viewType !== 'unknown') {
      viewType = {
        type: sceneResult.viewType,
        confidence: sceneResult.confidence,
      };
    } else {
      viewType = detectViewType(raw.tags);
    }

    // Get location insights
    const suggestedType = suggestLocationType(raw.tags);
    const suggestedEra = suggestEra(raw.tags);

    // Detect conditions
    const conditions = detectConditions(raw.tags);

    // Use Florence-2's quality score if available, otherwise calculate
    const qualityScore = raw.quality_score ??
      this.calculateQualityScore(viewType, conditions, normalizedTags, raw.confidence);

    return {
      rawTags: raw.tags,
      rawConfidence: raw.confidence,
      tags: relevantTags,
      normalizedTags,
      confidence,
      sceneClassification: sceneResult,
      viewType,
      suggestedType,
      suggestedEra,
      conditions,
      qualityScore,
      caption: raw.caption,
      duration_ms: totalDuration,
      source,
      model,
    };
  }

  /**
   * Calculate quality score for hero image selection
   */
  private calculateQualityScore(
    viewType: ViewTypeResult,
    conditions: ReturnType<typeof detectConditions>,
    normalizedTags: NormalizedTag[],
    rawConfidence: Record<string, number>
  ): number {
    let score = 0.5;

    // View type bonus
    switch (viewType.type) {
      case 'exterior':
        score += 0.2 * viewType.confidence;
        break;
      case 'aerial':
        score += 0.15 * viewType.confidence;
        break;
      case 'interior':
        score += 0.1 * viewType.confidence;
        break;
      case 'detail':
        score += 0.05;
        break;
    }

    // Confidence bonus
    const confidences = Object.values(rawConfidence).sort((a, b) => b - a).slice(0, 5);
    const avgConfidence = confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0.5;
    score += 0.1 * avgConfidence;

    // Condition modifiers
    if (conditions.conditionScore > 0 && conditions.conditionScore < 0.7) {
      score += 0.1;
    }
    if (conditions.conditionScore > 0.8) {
      score -= 0.15;
    }
    if (conditions.hasGraffiti) {
      score -= 0.05;
    }
    if (conditions.hasEquipment) {
      score += 0.05;
    }
    if (conditions.hasNatureReclaim) {
      score += 0.1;
    }

    // Tag diversity bonus
    const uniqueCategories = new Set(normalizedTags.map(t => t.category)).size;
    score += 0.02 * Math.min(uniqueCategories, 5);

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Batch tag multiple images
   */
  async tagBatch(
    imagePaths: string[],
    context?: TaggingContext,
    onProgress?: (current: number, total: number, failed: number) => void
  ): Promise<Map<string, EnhancedTagResult>> {
    const results = new Map<string, EnhancedTagResult>();
    const total = imagePaths.length;
    let failed = 0;

    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];

      try {
        const result = await this.tagImage(imagePath, context);
        results.set(imagePath, result);
      } catch (e) {
        failed++;
        const error = e instanceof Error ? e.message : String(e);
        logger.error('ImageTagging', `Failed to tag ${imagePath}: ${error}`);
      }

      onProgress?.(i + 1, total, failed);
    }

    logger.info('ImageTagging', `Batch complete: ${results.size}/${total} succeeded, ${failed} failed`);
    return results;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: ImageTaggingService | null = null;

/**
 * Get the image tagging service singleton
 */
export function getImageTaggingService(): ImageTaggingService {
  if (!instance) {
    instance = new ImageTaggingService();
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetImageTaggingService(): void {
  instance = null;
}

// ============================================================================
// Backwards Compatibility (deprecated - will be removed)
// ============================================================================

/** @deprecated Use ImageTaggingService instead */
export const RamTaggingService = ImageTaggingService;

/** @deprecated Use getImageTaggingService() instead */
export function getRamTaggingService(): ImageTaggingService {
  return getImageTaggingService();
}

/** @deprecated Use resetImageTaggingService() instead */
export function resetRamTaggingService(): void {
  resetImageTaggingService();
}
