/**
 * LiteLLM Provider
 *
 * Routes extraction requests through the LiteLLM proxy server.
 * Supports local (Ollama) and cloud (Anthropic, OpenAI, Google, Groq) models.
 *
 * Features:
 * - Auto-starts LiteLLM proxy when needed
 * - Applies privacy sanitization for cloud models
 * - Integrates spaCy preprocessing data into prompts
 * - Validates responses with Zod schemas
 *
 * @version 1.0
 * @see docs/plans/litellm-integration-plan.md - Phase 4
 */

import { BaseExtractionProvider } from './base-provider';
import { LiteLLMLifecycle, resetIdleTimer } from '../../litellm-lifecycle-service';
import {
  sanitizeForCloud,
  getPrivacySettings,
  isCloudModel,
  type PrivacySettings,
} from '../../privacy-sanitizer';
import { getPreprocessingService } from '../preprocessing-service';
import { DATE_EXTRACTION_PROMPTS, PROFILE_EXTRACTION_PROMPTS, COMBINED_EXTRACTION_PROMPTS } from '../agents/versioned-prompts';
import {
  validateLiteLLMResponse,
  LiteLLMResponseSchema,
} from '../../../main/ipc-handlers/litellm-validation';
import type {
  ExtractionInput,
  ExtractionResult,
  ProviderConfig,
  ProviderStatus,
  ExtractedDate,
  ExtractedPerson,
  ExtractedOrganization,
} from '../extraction-types';

// =============================================================================
// TYPES
// =============================================================================

interface LiteLLMChatResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

type ExtractionType = 'date' | 'profile' | 'combined';

// =============================================================================
// PROVIDER IMPLEMENTATION
// =============================================================================

/**
 * LiteLLM Provider - Routes through LiteLLM proxy to access multiple LLM backends
 */
export class LiteLLMProvider extends BaseExtractionProvider {
  private baseUrl: string;
  private promptVersion: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = `http://localhost:${config.settings.port || 4000}`;
    this.promptVersion = config.settings.promptVersion || 'v2.0';
  }

  // ============================================================
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ============================================================

  /**
   * Check if LiteLLM proxy is available
   */
  async checkAvailability(): Promise<ProviderStatus> {
    const status = await LiteLLMLifecycle.getStatus();

    return {
      id: this.config.id,
      available: status.running,
      lastCheck: new Date().toISOString(),
      lastError: status.lastError || undefined,
      modelInfo: status.running
        ? {
            name: this.config.settings.cloudModel || 'extraction-local',
            description: 'LiteLLM proxy router',
          }
        : undefined,
    };
  }

  /**
   * Perform extraction through LiteLLM proxy
   */
  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const startTime = Date.now();

    // Ensure LiteLLM is running
    if (!(await LiteLLMLifecycle.ensure())) {
      throw new Error('LiteLLM proxy not available');
    }

    // Reset idle timer
    resetIdleTimer();

    // Get preprocessing data (if not already provided)
    let preprocessedData = input.preprocessedData;
    if (!preprocessedData && input.text.length > 100) {
      try {
        const preprocessingService = getPreprocessingService();
        if (preprocessingService) {
          preprocessedData = await preprocessingService.preprocess(input.text);
          this.log(
            'info',
            `spaCy preprocessing: ${preprocessedData.timelineRelevant} timeline sentences`
          );
        }
      } catch (error) {
        this.log('warn', 'spaCy preprocessing failed, continuing without', error);
      }
    }

    // Get privacy settings and determine if sanitization needed
    const privacySettings = await getPrivacySettings();
    const modelName = this.config.settings.cloudModel || 'extraction-local';
    const needsSanitization = isCloudModel(modelName) && privacySettings.enabled;

    // Apply sanitization if needed
    let textToProcess = input.text;
    let sanitizationInfo: { redactionCount: number; redactedTypes: string[] } | null = null;

    if (needsSanitization) {
      const result = sanitizeForCloud(input.text, privacySettings);
      textToProcess = result.text;
      sanitizationInfo = {
        redactionCount: result.redactionCount,
        redactedTypes: result.redactedTypes,
      };

      if (result.redactionCount > 0) {
        this.log(
          'info',
          `Privacy: Redacted ${result.redactionCount} items (${result.redactedTypes.join(', ')})`
        );
      }
    }

    // Determine extraction type
    const extractionType = this.determineExtractionType(input);

    // Build prompt with preprocessing data
    const { systemPrompt, userPrompt } = this.buildPrompt(textToProcess, {
      ...input,
      preprocessedData,
    }, extractionType);

    // Call LiteLLM proxy
    const response = await this.callLiteLLM(modelName, systemPrompt, userPrompt);

    // Parse response content
    const content = response.choices[0]?.message?.content || '';

    // Parse and validate
    const parsed = this.parseResponse(content);

    // Build result
    const result: ExtractionResult = {
      provider: this.config.id,
      model: response.model || modelName,
      dates: parsed.dates || [],
      people: parsed.people || [],
      organizations: parsed.organizations || [],
      locations: [],
      processingTimeMs: Date.now() - startTime,
      summaryData: parsed.summary
        ? {
            title: parsed.title || '',
            summary: parsed.summary,
            keyFacts: [],
            confidence: 0.8,
          }
        : undefined,
      warnings: [],
    };

    // Add sanitization warning if applicable
    if (sanitizationInfo && sanitizationInfo.redactionCount > 0) {
      result.warnings?.push(
        `Privacy: ${sanitizationInfo.redactionCount} items redacted before cloud processing`
      );
    }

    // Add usage info if available
    if (response.usage) {
      result.rawResponse = JSON.stringify({
        usage: response.usage,
        model: response.model,
      });
    }

    this.log('info', `Extraction complete: ${result.dates.length} dates, ${result.people.length} people in ${result.processingTimeMs}ms`);

    return result;
  }

  /**
   * Get model information
   */
  async getModelInfo(): Promise<{ name: string; size?: string; description?: string }> {
    const status = await LiteLLMLifecycle.getStatus();

    return {
      name: this.config.settings.cloudModel || 'extraction-local',
      description: `LiteLLM proxy (${status.running ? 'running' : 'stopped'})`,
    };
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  /**
   * Determine which extraction type to use based on input
   */
  private determineExtractionType(input: ExtractionInput): ExtractionType {
    if (input.extractTypes) {
      if (input.extractTypes.includes('dates') && input.extractTypes.includes('people')) {
        return 'combined';
      }
      if (input.extractTypes.includes('people') || input.extractTypes.includes('organizations')) {
        return 'profile';
      }
    }
    return 'date';
  }

  /**
   * Build prompt from versioned templates
   */
  private buildPrompt(
    text: string,
    input: ExtractionInput & { preprocessedData?: any },
    type: ExtractionType
  ): { systemPrompt: string; userPrompt: string } {
    // Select prompt template
    let prompts: Record<string, any>;
    switch (type) {
      case 'profile':
        prompts = PROFILE_EXTRACTION_PROMPTS || DATE_EXTRACTION_PROMPTS;
        break;
      case 'combined':
        prompts = COMBINED_EXTRACTION_PROMPTS || DATE_EXTRACTION_PROMPTS;
        break;
      default:
        prompts = DATE_EXTRACTION_PROMPTS;
    }

    const version = this.promptVersion;
    const template = prompts[version] || prompts['v2.0'] || Object.values(prompts)[0];

    if (!template) {
      throw new Error(`No prompt template found for version ${version}`);
    }

    // Build preprocessing context
    let preprocessedSentences = '';
    let totalSentences = 0;
    let timelineRelevant = 0;
    let profileRelevant = 0;

    if (input.preprocessedData) {
      const pd = input.preprocessedData;
      totalSentences = pd.sentences?.length || 0;
      timelineRelevant = pd.timelineSentences?.length || 0;
      profileRelevant = pd.profileSentences?.length || 0;

      // Format timeline sentences for prompt
      if (pd.timelineSentences && pd.timelineSentences.length > 0) {
        preprocessedSentences = pd.timelineSentences
          .map((s: any, i: number) => {
            const verbs = s.verbs?.map((v: any) => `${v.text} [${v.category}]`).join(', ') || 'none';
            const dates = s.dates?.join(', ') || 'none';
            return `${i + 1}. "${s.text}"\n   Verbs: ${verbs}\n   Dates found: ${dates}`;
          })
          .join('\n\n');
      } else {
        preprocessedSentences = '(No timeline-relevant sentences identified - extract from full text)';
      }
    } else {
      preprocessedSentences = '(No preprocessing available - analyze full text)';
    }

    // Replace placeholders
    const userPrompt = template.userPrompt
      .replace('{text}', text)
      .replace('{preprocessed_sentences}', preprocessedSentences)
      .replace('{total_sentences}', String(totalSentences))
      .replace('{timeline_relevant}', String(timelineRelevant))
      .replace('{profile_relevant}', String(profileRelevant))
      .replace('{location_name}', input.locationName || 'Unknown location')
      .replace('{article_date}', input.articleDate || 'Unknown');

    return {
      systemPrompt: template.systemPrompt,
      userPrompt,
    };
  }

  /**
   * Call LiteLLM proxy API
   */
  private async callLiteLLM(
    modelName: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<LiteLLMChatResponse> {
    const status = await LiteLLMLifecycle.getStatus();
    const url = `http://localhost:${status.port}/chat/completions`;

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.getTemperature(),
        max_tokens: this.getMaxTokens(),
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LiteLLM error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /**
   * Parse and validate LLM response
   */
  private parseResponse(content: string): {
    dates: ExtractedDate[];
    people: ExtractedPerson[];
    organizations: ExtractedOrganization[];
    summary?: string;
    title?: string;
  } {
    // Clean markdown code blocks if present
    let cleaned = content.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }

    try {
      const parsed = JSON.parse(cleaned);

      // Validate with Zod (applies defaults)
      const validated = validateLiteLLMResponse(parsed);

      // Map to our types
      return {
        dates: this.mapDates(validated.dates || []),
        people: this.mapPeople(validated.people || []),
        organizations: this.mapOrganizations(validated.organizations || []),
        summary: validated.summary,
        title: validated.title,
      };
    } catch (error) {
      this.log('error', 'Failed to parse LLM response', { content, error });
      throw new Error(`Invalid LLM response: ${error instanceof Error ? error.message : 'Parse error'}`);
    }
  }

  /**
   * Map validated dates to our type
   */
  private mapDates(dates: any[]): ExtractedDate[] {
    return dates.map((d) => ({
      rawText: d.rawText,
      parsedDate: d.parsedDate,
      parsedDateEnd: d.parsedDateEnd || null,
      precision: d.precision || 'year',
      category: d.category || 'unknown',
      confidence: d.confidence ?? 0.5,
      context: d.context || d.rawText,
      isApproximate: d.isApproximate || false,
    }));
  }

  /**
   * Map validated people to our type
   */
  private mapPeople(people: any[]): ExtractedPerson[] {
    return people.map((p) => ({
      name: p.name,
      role: (p.role as any) || 'unknown',
      mentions: p.mentions || [p.name],
      confidence: p.confidence ?? 0.5,
    }));
  }

  /**
   * Map validated organizations to our type
   */
  private mapOrganizations(orgs: any[]): ExtractedOrganization[] {
    return orgs.map((o) => ({
      name: o.name,
      type: (o.type as any) || 'unknown',
      mentions: o.mentions || [o.name],
      confidence: o.confidence ?? 0.5,
    }));
  }

  /**
   * Shutdown hook
   */
  async shutdown(): Promise<void> {
    // LiteLLM lifecycle is managed centrally, no per-provider cleanup needed
    this.log('info', 'Provider shutdown');
  }
}

export default LiteLLMProvider;
