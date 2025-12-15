/**
 * VLM Enhancement Service (Stage 2)
 *
 * Optional deep analysis using Qwen2.5-VL or similar large vision-language model.
 * Only run for high-value images (hero candidates, manual trigger).
 *
 * Routes through LiteLLM proxy for consistent cost tracking and model switching.
 *
 * Provides:
 * - Rich captions and descriptions
 * - Detailed architectural analysis
 * - Historical period estimation
 * - Condition assessment narrative
 *
 * Per CLAUDE.md Rule 9: Local LLMs for background tasks only.
 *
 * @module services/tagging/vlm-enhancement-service
 */

import path from 'path';
import fs from 'fs/promises';
import { getLogger } from '../logger-service';
import { LiteLLMLifecycle, resetIdleTimer } from '../litellm-lifecycle-service';
import type { ViewType } from './scene-classifier';

const logger = getLogger();

// ============================================================================
// Type Definitions
// ============================================================================

export interface VLMEnhancementResult {
  /** Rich natural language description */
  description: string;

  /** Short caption suitable for alt text */
  caption: string;

  /** Architectural style detected (Art Deco, Mid-Century, Industrial, etc.) */
  architecturalStyle?: string;

  /** Estimated construction period */
  estimatedPeriod?: {
    start: number;
    end: number;
    confidence: number;
    reasoning: string;
  };

  /** Detailed condition assessment */
  conditionAssessment?: {
    overall: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
    score: number;  // 0-1
    details: string;
    observations: string[];
  };

  /** Notable features detected */
  notableFeatures: string[];

  /** Suggested search keywords */
  searchKeywords: string[];

  /** Processing metadata */
  duration_ms: number;
  model: string;
  device: string;
}

export interface VLMEnhancementContext {
  /** View type from Stage 0 */
  viewType?: ViewType;

  /** Tags from Stage 1 */
  tags?: string[];

  /** Location type from database */
  locationType?: string;

  /** Location name for context */
  locationName?: string;

  /** State/region */
  state?: string;
}

export interface VLMEnhancementConfig {
  /** Model alias for LiteLLM (default: vlm-local) */
  model?: string;

  /** Max tokens for response */
  maxTokens?: number;

  /** Timeout in milliseconds */
  timeout?: number;

  /** Temperature for generation */
  temperature?: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default model alias - routes through LiteLLM to Ollama qwen2.5-vl */
const DEFAULT_MODEL = 'vlm-local';

/** System prompt for architectural analysis */
const SYSTEM_PROMPT = `You are an expert at analyzing photographs of abandoned buildings and urban exploration sites.
Your task is to provide detailed analysis of images focusing on:
1. Architectural features and style
2. Building condition and decay
3. Notable objects and equipment
4. Historical period estimation based on visual clues
5. Search keywords for archival purposes

Always respond in valid JSON format.`;

// ============================================================================
// VLM Enhancement Service
// ============================================================================

export class VLMEnhancementService {
  private config: Required<VLMEnhancementConfig>;
  private initialized = false;
  private modelAvailable = false;

  constructor(config: VLMEnhancementConfig = {}) {
    this.config = {
      model: config.model ?? DEFAULT_MODEL,
      maxTokens: config.maxTokens ?? 1024,
      timeout: config.timeout ?? 120000, // VLMs are slower, 2 min timeout
      temperature: config.temperature ?? 0.3,
    };
  }

  /**
   * Initialize the service - check for LiteLLM availability
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Check if LiteLLM is installed (not necessarily running)
      const installed = await LiteLLMLifecycle.isInstalled();
      this.modelAvailable = installed;

      if (installed) {
        logger.info('VLMEnhancement', 'LiteLLM available for VLM enhancement');
      } else {
        logger.warn('VLMEnhancement', 'LiteLLM not installed - Stage 2 disabled. Run: ./scripts/setup-litellm.sh');
      }
    } catch (error) {
      logger.warn('VLMEnhancement', `LiteLLM check failed: ${error instanceof Error ? error.message : error}`);
      this.modelAvailable = false;
    }

    this.initialized = true;
  }

  /**
   * Check if VLM enhancement is available
   */
  async isAvailable(): Promise<boolean> {
    await this.initialize();
    return this.modelAvailable;
  }

  /**
   * Get service status
   */
  async getStatus(): Promise<{
    available: boolean;
    model: string;
    lastCheck: string;
    error?: string;
    litellmStatus?: {
      running: boolean;
      port: number;
    };
  }> {
    await this.initialize();

    let litellmStatus: { running: boolean; port: number } | undefined;
    try {
      const status = await LiteLLMLifecycle.getStatus();
      litellmStatus = {
        running: status.running,
        port: status.port,
      };
    } catch {
      // Ignore status errors
    }

    return {
      available: this.modelAvailable,
      model: this.modelAvailable ? this.config.model : 'none',
      lastCheck: new Date().toISOString(),
      error: this.modelAvailable ? undefined : 'LiteLLM not installed',
      litellmStatus,
    };
  }

  /**
   * Build the user prompt with context
   */
  private buildUserPrompt(context?: VLMEnhancementContext): string {
    const parts: string[] = [];

    parts.push('Analyze this photograph of an abandoned location.');

    if (context?.viewType && context.viewType !== 'unknown') {
      parts.push(`This is an ${context.viewType} view.`);
    }

    if (context?.locationType) {
      parts.push(`The building type is: ${context.locationType}.`);
    }

    if (context?.locationName) {
      parts.push(`Location name: ${context.locationName}.`);
    }

    if (context?.state) {
      parts.push(`Located in: ${context.state}.`);
    }

    if (context?.tags && context.tags.length > 0) {
      parts.push(`Auto-detected tags: ${context.tags.slice(0, 15).join(', ')}.`);
    }

    parts.push(`
Provide your analysis as JSON with this structure:
{
  "description": "Rich natural language description (2-3 sentences)",
  "caption": "Short caption suitable for alt text (1 sentence)",
  "architectural_style": "Detected style (Art Deco, Mid-Century, Industrial, Victorian, etc.) or null",
  "estimated_period": {
    "start": year_number,
    "end": year_number,
    "confidence": 0.0-1.0,
    "reasoning": "Brief explanation of dating evidence"
  } or null,
  "condition_assessment": {
    "overall": "excellent|good|fair|poor|critical",
    "score": 0.0-1.0,
    "details": "Detailed condition description",
    "observations": ["specific observation 1", "observation 2", ...]
  },
  "notable_features": ["feature 1", "feature 2", ...],
  "search_keywords": ["keyword 1", "keyword 2", ...]
}`);

    return parts.join('\n');
  }

  /**
   * Read image as base64 data URL
   */
  private async imageToBase64(imagePath: string): Promise<string> {
    const buffer = await fs.readFile(imagePath);
    const ext = path.extname(imagePath).toLowerCase();

    let mimeType = 'image/jpeg';
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.gif') mimeType = 'image/gif';
    else if (ext === '.webp') mimeType = 'image/webp';

    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  /**
   * Enhance an image with deep VLM analysis via LiteLLM
   *
   * @param imagePath - Absolute path to image
   * @param context - Optional context from previous stages
   * @returns Enhanced analysis result
   */
  async enhanceImage(
    imagePath: string,
    context?: VLMEnhancementContext
  ): Promise<VLMEnhancementResult> {
    await this.initialize();

    if (!this.modelAvailable) {
      throw new Error('VLM enhancement not available - LiteLLM not installed. Run: ./scripts/setup-litellm.sh');
    }

    const startTime = Date.now();

    // Ensure LiteLLM is running
    const proxyStarted = await LiteLLMLifecycle.ensure();
    if (!proxyStarted) {
      throw new Error('Failed to start LiteLLM proxy');
    }

    // Reset idle timer
    resetIdleTimer();

    // Get LiteLLM port
    const status = await LiteLLMLifecycle.getStatus();
    const url = `http://localhost:${status.port}/chat/completions`;

    // Read image as base64
    const imageBase64 = await this.imageToBase64(imagePath);

    // Build messages with vision content
    const userPrompt = this.buildUserPrompt(context);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: imageBase64 } },
        ],
      },
    ];

    // Make request to LiteLLM
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LiteLLM error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      // Parse JSON response
      const result = this.parseResponse(content);
      const duration = Date.now() - startTime;

      logger.info('VLMEnhancement',
        `Enhanced ${path.basename(imagePath)} via LiteLLM in ${duration}ms - ${result.notableFeatures.length} features found`
      );

      return {
        ...result,
        duration_ms: duration,
        model: data.model || this.config.model,
        device: 'litellm', // LiteLLM handles device selection
      };
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('VLM enhancement timed out');
      }

      logger.error('VLMEnhancement', `Failed to enhance ${path.basename(imagePath)}: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }

  /**
   * Parse and validate LLM JSON response
   */
  private parseResponse(content: string): Omit<VLMEnhancementResult, 'duration_ms' | 'model' | 'device'> {
    // Clean markdown code blocks if present
    let cleaned = content.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }

    try {
      const parsed = JSON.parse(cleaned);

      return {
        description: parsed.description || '',
        caption: parsed.caption || '',
        architecturalStyle: parsed.architectural_style || undefined,
        estimatedPeriod: parsed.estimated_period ? {
          start: parsed.estimated_period.start,
          end: parsed.estimated_period.end,
          confidence: parsed.estimated_period.confidence ?? 0.5,
          reasoning: parsed.estimated_period.reasoning || '',
        } : undefined,
        conditionAssessment: parsed.condition_assessment ? {
          overall: parsed.condition_assessment.overall || 'fair',
          score: parsed.condition_assessment.score ?? 0.5,
          details: parsed.condition_assessment.details || '',
          observations: parsed.condition_assessment.observations || [],
        } : undefined,
        notableFeatures: parsed.notable_features || [],
        searchKeywords: parsed.search_keywords || [],
      };
    } catch (error) {
      logger.error('VLMEnhancement', `Failed to parse VLM response: ${content.slice(0, 500)}`);
      throw new Error(`Invalid VLM response: ${error instanceof Error ? error.message : 'Parse error'}`);
    }
  }

  /**
   * Batch enhance multiple images
   */
  async enhanceBatch(
    images: Array<{ path: string; context?: VLMEnhancementContext }>,
    onProgress?: (current: number, total: number) => void
  ): Promise<Map<string, VLMEnhancementResult | Error>> {
    const results = new Map<string, VLMEnhancementResult | Error>();
    const total = images.length;

    for (let i = 0; i < images.length; i++) {
      const { path: imagePath, context } = images[i];

      try {
        const result = await this.enhanceImage(imagePath, context);
        results.set(imagePath, result);
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        results.set(imagePath, error);
        logger.warn('VLMEnhancement', `Failed to enhance ${imagePath}: ${error.message}`);
      }

      onProgress?.(i + 1, total);
    }

    return results;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: VLMEnhancementService | null = null;

/**
 * Get the VLM enhancement service singleton
 */
export function getVLMEnhancementService(): VLMEnhancementService {
  if (!instance) {
    instance = new VLMEnhancementService();
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetVLMEnhancementService(): void {
  instance = null;
}
