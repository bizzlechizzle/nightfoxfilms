/**
 * Extraction Service (Orchestrator)
 *
 * The main entry point for document intelligence extraction.
 * Manages multiple providers, handles fallbacks, and routes requests
 * to the appropriate agent (Date Extraction or Summary/Title).
 *
 * Provider Priority (default):
 * 1. spaCy - Fast, offline, good for dates/entities
 * 2. Ollama - Local LLM, good for everything
 * 3. Cloud (if configured) - Fallback
 *
 * Usage:
 *   const service = new ExtractionService(db);
 *   await service.initialize();
 *   const result = await service.extract({ text: '...', sourceType: 'web_source', sourceId: '123' });
 *
 * @version 1.0
 */

import type { Database as SqliteDatabase } from 'better-sqlite3';
import { BaseExtractionProvider } from './providers/base-provider';
import { OllamaProvider } from './providers/ollama-provider';
import { SpacyProvider } from './providers/spacy-provider';
import { LiteLLMProvider } from './providers/litellm-provider';
import type {
  ExtractionInput,
  ExtractionResult,
  ExtractionOptions,
  ProviderConfig,
  ProviderStatus,
  HealthCheckResult,
  BatchExtractionRequest,
  BatchExtractionResult,
  AgentType,
} from './extraction-types';

// =============================================================================
// DEFAULT CONFIGURATIONS
// =============================================================================

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  // ==========================================================================
  // LOCAL PROVIDERS (enabled by default)
  // ==========================================================================
  {
    id: 'spacy-local',
    name: 'spaCy (Offline)',
    type: 'spacy',
    enabled: true,
    priority: 1,
    settings: {
      port: 8234,
      executablePath: 'python3',
      timeout: 30000,
    },
  },
  {
    id: 'ollama-mac-studio',
    name: 'Ollama (Mac Studio)',
    type: 'ollama',
    enabled: true,
    priority: 2,
    settings: {
      host: '192.168.1.254',
      port: 11434,
      model: 'qwen2.5:32b',
      timeout: 120000,
      temperature: 0.1,
      maxTokens: 4096,
    },
  },
  // ==========================================================================
  // CLOUD PROVIDERS (disabled until credentials configured)
  // All route through LiteLLM proxy for unified access
  // ==========================================================================
  {
    id: 'anthropic-claude',
    name: 'Anthropic Claude',
    type: 'anthropic',
    enabled: false,
    priority: 10,
    settings: {
      cloudModel: 'claude-sonnet-4-20250514',
      timeout: 120000,
      temperature: 0.1,
      maxTokens: 4096,
    },
  },
  {
    id: 'openai-gpt',
    name: 'OpenAI GPT',
    type: 'openai',
    enabled: false,
    priority: 11,
    settings: {
      cloudModel: 'gpt-4o',
      timeout: 120000,
      temperature: 0.1,
      maxTokens: 4096,
    },
  },
  {
    id: 'google-gemini',
    name: 'Google Gemini',
    type: 'google',
    enabled: false,
    priority: 12,
    settings: {
      cloudModel: 'gemini-1.5-pro',
      timeout: 120000,
      temperature: 0.1,
      maxTokens: 4096,
    },
  },
];

// =============================================================================
// EXTRACTION SERVICE
// =============================================================================

export class ExtractionService {
  private db: SqliteDatabase;
  private configs: ProviderConfig[] = [];
  private providers: Map<string, BaseExtractionProvider> = new Map();
  private initialized = false;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  /**
   * Initialize the service
   * - Loads configs from database
   * - Creates provider instances
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load configs from database or use defaults
    this.configs = this.loadConfigsFromDatabase();

    // Initialize providers
    await this.initializeProviders();

    this.initialized = true;
    console.log(`[ExtractionService] Initialized with ${this.providers.size} providers`);
  }

  /**
   * Load provider configurations from database
   */
  private loadConfigsFromDatabase(): ProviderConfig[] {
    try {
      const rows = this.db.prepare(`
        SELECT provider_id, name, type, enabled, priority, settings_json
        FROM extraction_providers
        ORDER BY priority ASC
      `).all() as Array<{
        provider_id: string;
        name: string;
        type: string;
        enabled: number;
        priority: number;
        settings_json: string | null;
      }>;

      if (rows.length === 0) {
        // First run - insert defaults
        for (const config of DEFAULT_PROVIDERS) {
          this.saveConfigToDatabase(config);
        }
        return [...DEFAULT_PROVIDERS];
      }

      return rows.map((row) => ({
        id: row.provider_id,
        name: row.name,
        type: row.type as ProviderConfig['type'],
        enabled: Boolean(row.enabled),
        priority: row.priority,
        settings: JSON.parse(row.settings_json || '{}'),
      }));
    } catch (error) {
      // Table might not exist yet - use defaults
      console.log('[ExtractionService] Using default configs (table not ready)');
      return [...DEFAULT_PROVIDERS];
    }
  }

  /**
   * Save a provider configuration to database
   */
  private saveConfigToDatabase(config: ProviderConfig): void {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO extraction_providers
        (provider_id, name, type, enabled, priority, settings_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        config.id,
        config.name,
        config.type,
        config.enabled ? 1 : 0,
        config.priority,
        JSON.stringify(config.settings)
      );
    } catch (error) {
      console.warn('[ExtractionService] Could not save config to database:', error);
    }
  }

  /**
   * Initialize provider instances
   */
  private async initializeProviders(): Promise<void> {
    for (const config of this.configs) {
      if (!config.enabled) continue;

      try {
        let provider: BaseExtractionProvider;

        switch (config.type) {
          case 'ollama':
            provider = new OllamaProvider(config);
            break;
          case 'spacy':
            provider = new SpacyProvider(config);
            break;
          case 'litellm':
          case 'anthropic':
          case 'openai':
          case 'google':
            // All cloud providers route through LiteLLM proxy
            provider = new LiteLLMProvider(config);
            break;
          default:
            console.warn(`[ExtractionService] Unknown provider type: ${config.type}`);
            continue;
        }

        this.providers.set(config.id, provider);
        console.log(`[ExtractionService] Registered provider: ${config.id}`);
      } catch (error) {
        console.error(`[ExtractionService] Failed to initialize ${config.id}:`, error);
      }
    }
  }

  /**
   * Main extraction method
   *
   * @param input What to extract from
   * @param options Extraction options
   * @returns Extraction result with provider info
   */
  async extract(
    input: ExtractionInput,
    options?: ExtractionOptions
  ): Promise<ExtractionResult & { providerId: string }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const {
      preferProvider,
      needsSummary = false,
      needsTitle = false,
      minConfidence = 0.3,
      maxRetries = 2,
    } = options || {};

    // Determine what agents to run
    const agents: AgentType[] = options?.agents || [];
    if (agents.length === 0) {
      // Default: run date extraction, optionally summary
      agents.push('date_extraction');
      if (needsSummary || needsTitle || input.extractTypes?.includes('summary')) {
        agents.push('summary_title');
      }
    }

    // Determine which providers can handle this request
    const requiresLLM = agents.includes('summary_title');

    // Get providers in priority order
    let providers: Array<[string, BaseExtractionProvider]>;

    if (preferProvider && this.providers.has(preferProvider)) {
      // Use preferred provider first, then fallbacks
      const preferred = this.providers.get(preferProvider)!;
      providers = [[preferProvider, preferred]];

      // Add fallbacks
      for (const [id, provider] of this.providers) {
        if (id !== preferProvider) {
          providers.push([id, provider]);
        }
      }
    } else {
      // Use all providers in priority order
      providers = Array.from(this.providers.entries());
    }

    // Filter out spaCy if we need summaries
    if (requiresLLM) {
      providers = providers.filter(([, provider]) => provider.getType() !== 'spacy');
    }

    if (providers.length === 0) {
      throw new Error(
        requiresLLM
          ? 'No LLM providers available. Configure Ollama or a cloud provider.'
          : 'No extraction providers available.'
      );
    }

    // Try each provider
    const errors: string[] = [];

    for (const [id, provider] of providers) {
      let lastError: Error | null = null;

      // Retry loop for transient failures
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Check availability
          if (!(await provider.isAvailable())) {
            lastError = new Error(`Provider ${provider.getName()} not available`);
            break; // Don't retry availability issues
          }

          console.log(
            `[ExtractionService] Attempting extraction with ${provider.getName()} (attempt ${attempt}/${maxRetries})...`
          );

          // Add extract types based on agents
          const extractTypes = [...(input.extractTypes || ['dates', 'people', 'organizations', 'locations'])];
          if (agents.includes('summary_title') && !extractTypes.includes('summary')) {
            extractTypes.push('summary', 'title');
          }

          const result = await provider.extract({
            ...input,
            extractTypes,
          });

          // Validate result has useful data
          if (this.isValidResult(result, minConfidence)) {
            return { ...result, providerId: id };
          }

          lastError = new Error('Extraction returned no useful data');
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          // Don't retry certain errors
          if (this.isNonRetryableError(lastError)) {
            break;
          }

          // Exponential backoff before retry
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            console.log(`[ExtractionService] Retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      errors.push(`${provider.getName()}: ${lastError?.message || 'Unknown error'}`);
    }

    throw new Error(
      `All providers failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`
    );
  }

  /**
   * Check if result has useful data above threshold
   */
  private isValidResult(result: ExtractionResult, minConfidence: number): boolean {
    // Check dates
    const validDates = result.dates.filter((d) => d.confidence >= minConfidence);
    if (validDates.length > 0) return true;

    // Check people
    const validPeople = result.people.filter((p) => p.confidence >= minConfidence);
    if (validPeople.length > 0) return true;

    // Check organizations
    const validOrgs = result.organizations.filter((o) => o.confidence >= minConfidence);
    if (validOrgs.length > 0) return true;

    // Check summary
    if (result.summaryData && result.summaryData.summary.length > 10) return true;
    if (result.summary && result.summary.length > 10) return true;

    return false;
  }

  /**
   * Check if error should not be retried
   */
  private isNonRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('not found') ||
      message.includes('api key') ||
      message.includes('invalid') ||
      message.includes('unauthorized') ||
      message.includes('cannot generate summary')
    );
  }

  /**
   * Batch extraction
   */
  async extractBatch(request: BatchExtractionRequest): Promise<BatchExtractionResult> {
    const startTime = Date.now();
    const results: Record<string, ExtractionResult | { error: string }> = {};
    let successful = 0;
    let failed = 0;

    const { parallel = true, concurrency = 3 } = request;

    if (parallel && request.items.length > 1) {
      // Process in parallel with concurrency limit
      const chunks: ExtractionInput[][] = [];
      for (let i = 0; i < request.items.length; i += concurrency) {
        chunks.push(request.items.slice(i, i + concurrency));
      }

      for (const chunk of chunks) {
        const promises = chunk.map(async (item) => {
          try {
            const result = await this.extract(item, request.options);
            results[item.sourceId] = result;
            successful++;
          } catch (error) {
            results[item.sourceId] = {
              error: error instanceof Error ? error.message : 'Unknown error',
            };
            failed++;
          }
        });

        await Promise.all(promises);
      }
    } else {
      // Process sequentially
      for (const item of request.items) {
        try {
          const result = await this.extract(item, request.options);
          results[item.sourceId] = result;
          successful++;
        } catch (error) {
          results[item.sourceId] = {
            error: error instanceof Error ? error.message : 'Unknown error',
          };
          failed++;
        }
      }
    }

    return {
      total: request.items.length,
      successful,
      failed,
      results,
      totalTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Get all provider statuses
   */
  async getProviderStatuses(): Promise<ProviderStatus[]> {
    const statuses: ProviderStatus[] = [];

    for (const [, provider] of this.providers) {
      const status = await provider.refreshStatus();
      statuses.push(status);
    }

    return statuses;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const providers = await this.getProviderStatuses();
    const ollamaAvailable = providers.some(
      (p) => p.id.includes('ollama') && p.available
    );
    const spacyAvailable = providers.some(
      (p) => p.id.includes('spacy') && p.available
    );

    return {
      healthy: ollamaAvailable || spacyAvailable,
      providers,
      system: {
        ollamaAvailable,
        spacyAvailable,
        memoryUsage: process.memoryUsage().heapUsed,
      },
    };
  }

  /**
   * Update provider configuration
   */
  async updateProviderConfig(
    providerId: string,
    updates: Partial<ProviderConfig>
  ): Promise<ProviderConfig | null> {
    const provider = this.providers.get(providerId);
    if (!provider) return null;

    // Update config
    const currentConfig = provider.getConfig();
    const newConfig = { ...currentConfig, ...updates };

    if (updates.settings) {
      newConfig.settings = { ...currentConfig.settings, ...updates.settings };
    }

    // Save to database
    this.saveConfigToDatabase(newConfig);

    // Update provider
    provider.updateConfig(newConfig);

    // Update local cache
    const idx = this.configs.findIndex((c) => c.id === providerId);
    if (idx >= 0) {
      this.configs[idx] = newConfig;
    }

    return newConfig;
  }

  /**
   * Get provider configuration
   */
  getProviderConfig(providerId: string): ProviderConfig | null {
    const provider = this.providers.get(providerId);
    return provider ? provider.getConfig() : null;
  }

  /**
   * Get all configurations
   */
  getAllConfigs(): ProviderConfig[] {
    return [...this.configs];
  }

  /**
   * Add a new provider
   */
  async addProvider(config: ProviderConfig): Promise<void> {
    // Save to database
    this.saveConfigToDatabase(config);

    // Add to configs
    this.configs.push(config);

    // Sort by priority
    this.configs.sort((a, b) => a.priority - b.priority);

    // Create provider instance
    if (config.enabled) {
      let provider: BaseExtractionProvider;

      switch (config.type) {
        case 'ollama':
          provider = new OllamaProvider(config);
          break;
        case 'spacy':
          provider = new SpacyProvider(config);
          break;
        case 'litellm':
        case 'anthropic':
        case 'openai':
        case 'google':
          // All cloud providers route through LiteLLM proxy
          provider = new LiteLLMProvider(config);
          break;
        default:
          throw new Error(`Unknown provider type: ${config.type}`);
      }

      this.providers.set(config.id, provider);
    }
  }

  /**
   * Remove a provider
   */
  async removeProvider(providerId: string): Promise<void> {
    // Shutdown provider
    const provider = this.providers.get(providerId);
    if (provider) {
      await provider.shutdown();
      this.providers.delete(providerId);
    }

    // Remove from configs
    this.configs = this.configs.filter((c) => c.id !== providerId);

    // Remove from database
    try {
      this.db.prepare('DELETE FROM extraction_providers WHERE provider_id = ?').run(providerId);
    } catch {
      // Ignore if table doesn't exist
    }
  }

  /**
   * Test a specific provider
   */
  async testProvider(providerId: string, testText: string): Promise<ExtractionResult> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    return provider.extract({
      text: testText,
      sourceType: 'note',
      sourceId: 'test',
      extractTypes: ['dates', 'people', 'organizations', 'locations'],
    });
  }

  /**
   * Shutdown all providers
   */
  async shutdown(): Promise<void> {
    console.log('[ExtractionService] Shutting down...');

    for (const [id, provider] of this.providers) {
      try {
        await provider.shutdown();
        console.log(`[ExtractionService] Shutdown ${id}`);
      } catch (error) {
        console.error(`[ExtractionService] Error shutting down ${id}:`, error);
      }
    }

    this.providers.clear();
    this.initialized = false;
  }
}

/**
 * Singleton instance
 */
let instance: ExtractionService | null = null;

/**
 * Get or create the extraction service instance
 */
export function getExtractionService(db: SqliteDatabase): ExtractionService {
  if (!instance) {
    instance = new ExtractionService(db);
  }
  return instance;
}

/**
 * Shutdown the singleton instance
 */
export async function shutdownExtractionService(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}
