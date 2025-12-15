/**
 * Ollama Provider
 *
 * Connects to Ollama running locally OR on any network host.
 * This is the key insight: same code works for:
 * - localhost:11434 (local Ollama)
 * - 192.168.1.100:11434 (Ollama on your M2 Ultra from Windows)
 * - my-server.local:11434 (remote server)
 *
 * Recommended models for M2 Ultra 64GB:
 * - qwen2.5:32b (Q8_0) - Best balance of speed and quality
 * - qwen2.5:7b - Faster, good for quick extractions
 *
 * @version 1.0
 */

import { BaseExtractionProvider, formatBytes } from './base-provider';
import {
  buildDateExtractionPrompt,
  buildSummaryTitlePrompt,
  buildCombinedPrompt,
  parseStructuredResponse,
  validateExtractions,
  recalibrateConfidence,
  DATE_EXTRACTION_SYSTEM_PROMPT,
  SUMMARY_TITLE_SYSTEM_PROMPT,
} from '../agents/prompt-templates';
import type {
  ExtractionInput,
  ExtractionResult,
  ProviderConfig,
  ProviderStatus,
  ExtractedDate,
} from '../extraction-types';
import {
  ensureOllamaRunning,
  resetIdleTimer,
} from '../../ollama-lifecycle-service';

/**
 * Ollama API response types
 */
interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    format: string;
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

/**
 * Ollama Provider implementation
 */
export class OllamaProvider extends BaseExtractionProvider {
  private baseUrl: string;
  private modelLoaded = false;
  private isLocalhostHost: boolean;

  constructor(config: ProviderConfig) {
    super(config);

    const host = config.settings.host || 'localhost';
    const port = config.settings.port || 11434;

    // Track if this is a localhost connection (for lifecycle management)
    this.isLocalhostHost = host === 'localhost' || host === '127.0.0.1';

    // Support both http and hostname-only formats
    if (host.startsWith('http://') || host.startsWith('https://')) {
      this.baseUrl = host;
      // Check if URL points to localhost
      try {
        const url = new URL(host);
        this.isLocalhostHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      } catch {
        // Keep original detection
      }
    } else {
      this.baseUrl = `http://${host}:${port}`;
    }
  }

  /**
   * Check if this provider is configured for localhost.
   * Used to determine if we should manage Ollama lifecycle.
   */
  isLocalhost(): boolean {
    return this.isLocalhostHost;
  }

  /**
   * Check if Ollama is reachable and has the required model
   */
  async checkAvailability(): Promise<ProviderStatus> {
    const timeout = Math.min(this.getTimeout(), 10000); // Max 10s for health check
    const startTime = Date.now();

    try {
      // Check if Ollama is running
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET' },
        timeout
      );

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }

      const data = (await response.json()) as OllamaTagsResponse;
      const models = data.models || [];

      // Check if configured model is available
      const configuredModel = this.getModelName();
      const modelMatch = models.find(
        (m: OllamaModel) =>
          m.name === configuredModel ||
          m.name.startsWith(configuredModel.split(':')[0])
      );

      const responseTimeMs = Date.now() - startTime;

      this.status = {
        id: this.config.id,
        available: !!modelMatch,
        lastCheck: new Date().toISOString(),
        responseTimeMs,
        modelInfo: modelMatch
          ? {
              name: modelMatch.name,
              size: formatBytes(modelMatch.size),
              quantization: modelMatch.details?.quantization_level,
            }
          : undefined,
        lastError: modelMatch
          ? undefined
          : `Model '${configuredModel}' not found. Available: ${models.map((m: OllamaModel) => m.name).join(', ')}`,
      };

      this.modelLoaded = !!modelMatch;
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      let errorMessage = 'Connection failed';

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = `Connection timed out after ${timeout}ms`;
        } else if (error.message.includes('ECONNREFUSED')) {
          errorMessage = `Cannot connect to Ollama at ${this.baseUrl}. Is Ollama running? Start with: ollama serve`;
        } else if (error.message.includes('ENOTFOUND')) {
          errorMessage = `Host not found: ${this.baseUrl}. Check the hostname/IP address.`;
        } else {
          errorMessage = error.message;
        }
      }

      this.status = {
        id: this.config.id,
        available: false,
        lastCheck: new Date().toISOString(),
        responseTimeMs,
        lastError: errorMessage,
      };

      this.modelLoaded = false;
    }

    return this.status;
  }

  /**
   * Get the configured model name
   */
  private getModelName(): string {
    return this.config.settings.model || 'qwen2.5:32b';
  }

  /**
   * Ensure model is loaded before making extraction request
   */
  private async ensureModelLoaded(): Promise<void> {
    if (this.modelLoaded) return;

    const model = this.getModelName();

    try {
      // Trigger model loading by calling /api/show
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/show`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model }),
        },
        30000 // 30 second timeout for model loading
      );

      if (response.ok) {
        this.modelLoaded = true;
        this.log('info', `Model ${model} is loaded`);
      } else {
        const error = await response.text();
        this.log('warn', `Model ${model} may not be ready: ${error}`);
      }
    } catch (error) {
      this.log('warn', `Could not verify model ${model}:`, error);
    }
  }

  /**
   * Main extraction method
   */
  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const model = this.getModelName();
    const startTime = Date.now();

    // OPT-125: For localhost, ensure Ollama is running (auto-start if needed)
    if (this.isLocalhostHost) {
      const started = await ensureOllamaRunning();
      if (!started) {
        throw new Error(
          'Could not start Ollama. Is it installed? Download from https://ollama.ai'
        );
      }
    }

    // Ensure model is loaded
    await this.ensureModelLoaded();

    // Determine which prompt to use based on what's requested
    const needsTitle = input.extractTypes?.includes('title') || input.extractTypes?.includes('summary');
    const needsDates = !input.extractTypes || input.extractTypes.includes('dates');

    let prompt: string;
    let systemPrompt: string;

    if (needsTitle && needsDates) {
      // Use combined prompt
      prompt = buildCombinedPrompt(input.text, input.locationName);
      systemPrompt = DATE_EXTRACTION_SYSTEM_PROMPT; // Use date system prompt as primary
    } else if (needsTitle) {
      prompt = buildSummaryTitlePrompt(input.text, input.locationName);
      systemPrompt = SUMMARY_TITLE_SYSTEM_PROMPT;
    } else {
      prompt = buildDateExtractionPrompt(input.text);
      systemPrompt = DATE_EXTRACTION_SYSTEM_PROMPT;
    }

    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt,
            system: systemPrompt,
            stream: false,
            format: 'json',
            options: {
              temperature: this.getTemperature(),
              num_predict: this.getMaxTokens(),
              stop: ['\n\n\n', '```\n\n', 'Human:', 'Assistant:'],
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw this.handleApiError(response.status, errorText, model);
      }

      const data = (await response.json()) as OllamaGenerateResponse;
      const processingTimeMs = Date.now() - startTime;

      // Validate response has content
      if (!data.response || data.response.trim() === '') {
        throw new Error('Ollama returned empty response');
      }

      // Parse the response
      const parsed = parseStructuredResponse(data.response);

      // Validate extractions against source text
      const validated = validateExtractions(input, parsed);

      // Recalibrate confidence scores for dates
      const calibratedDates = validated.dates.map((date) => ({
        ...date,
        confidence: recalibrateConfidence(date, input.text),
      }));

      // Build result
      const result: ExtractionResult = {
        provider: 'ollama',
        model,
        dates: calibratedDates,
        people: validated.people,
        organizations: validated.organizations,
        locations: validated.locations,
        summaryData: validated.summaryData,
        summary: validated.summaryData?.summary,
        keyFacts: validated.summaryData?.keyFacts,
        processingTimeMs,
        warnings: validated.warnings.length > 0 ? validated.warnings : undefined,
        rawResponse: data.response,
      };

      this.log('info', `Extraction complete in ${processingTimeMs}ms: ${calibratedDates.length} dates, ${validated.people.length} people`);

      // OPT-125: Reset idle timer after successful extraction (keeps Ollama warm)
      if (this.isLocalhostHost) {
        resetIdleTimer();
      }

      return result;
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;

      // OPT-125: Still reset idle timer on error (Ollama was used)
      if (this.isLocalhostHost) {
        resetIdleTimer();
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Extraction timed out after ${this.getTimeout() / 1000}s. ` +
          `Try a smaller model or increase timeout in settings.`
        );
      }

      throw error;
    }
  }

  /**
   * Handle Ollama API errors with helpful messages
   */
  private handleApiError(status: number, errorText: string, model: string): Error {
    if (status === 404) {
      return new Error(`Model '${model}' not found. Run: ollama pull ${model}`);
    }
    if (status === 500 && errorText.includes('loading')) {
      return new Error(`Model '${model}' is still loading. Please wait and retry.`);
    }
    if (status === 500 && errorText.includes('CUDA')) {
      return new Error(`GPU error with model '${model}'. Try: ollama run ${model} to diagnose.`);
    }
    return new Error(`Ollama error (${status}): ${errorText}`);
  }

  /**
   * Get model info
   */
  async getModelInfo(): Promise<{ name: string; size?: string; description?: string }> {
    const model = this.getModelName();

    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/show`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model }),
        },
        10000
      );

      if (response.ok) {
        const data = await response.json() as { size?: number; modelfile?: string };
        return {
          name: model,
          size: data.size ? formatBytes(data.size) : undefined,
          description: data.modelfile?.split('\n')[0] || `Ollama model at ${this.baseUrl}`,
        };
      }
    } catch {
      // Fall through to default
    }

    return {
      name: model,
      description: `Ollama model at ${this.baseUrl}`,
    };
  }

  /**
   * Get the base URL (useful for debugging)
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Test connection and return detailed status
   */
  async testConnection(): Promise<{
    connected: boolean;
    responseTimeMs: number;
    ollamaVersion?: string;
    availableModels: string[];
    configuredModelAvailable: boolean;
    error?: string;
  }> {
    const startTime = Date.now();

    try {
      // Get version
      const versionResponse = await this.fetchWithTimeout(
        `${this.baseUrl}/api/version`,
        { method: 'GET' },
        5000
      );

      const versionData = versionResponse.ok
        ? (await versionResponse.json() as { version?: string })
        : null;

      // Get models
      const tagsResponse = await this.fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET' },
        5000
      );

      if (!tagsResponse.ok) {
        throw new Error(`Failed to get models: ${tagsResponse.status}`);
      }

      const tagsData = (await tagsResponse.json()) as OllamaTagsResponse;
      const availableModels = (tagsData.models || []).map((m: OllamaModel) => m.name);

      const configuredModel = this.getModelName();
      const configuredModelAvailable = availableModels.some(
        (m) => m === configuredModel || m.startsWith(configuredModel.split(':')[0])
      );

      return {
        connected: true,
        responseTimeMs: Date.now() - startTime,
        ollamaVersion: versionData?.version,
        availableModels,
        configuredModelAvailable,
      };
    } catch (error) {
      return {
        connected: false,
        responseTimeMs: Date.now() - startTime,
        availableModels: [],
        configuredModelAvailable: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Pull a model (trigger download)
   */
  async pullModel(modelName?: string): Promise<{ success: boolean; message: string }> {
    const model = modelName || this.getModelName();

    try {
      this.log('info', `Pulling model: ${model}`);

      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/pull`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model, stream: false }),
        },
        300000 // 5 minute timeout for downloads
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, message: `Pull failed: ${error}` };
      }

      return { success: true, message: `Model ${model} pulled successfully` };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Pull failed',
      };
    }
  }
}
