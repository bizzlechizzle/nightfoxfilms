/**
 * spaCy Provider
 *
 * Fast, offline NER extraction using spaCy + dateparser.
 * Runs a Python FastAPI service as a child process.
 *
 * Key features:
 * - Offline: No internet required
 * - Fast: ~100ms per extraction
 * - Pre-filtering: Masks false positives before dateparser
 * - Good for dates, people, organizations, locations
 * - CANNOT generate summaries/titles (use Ollama for that)
 *
 * @version 1.0
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { BaseExtractionProvider, timestamp } from './base-provider';
import type {
  ExtractionInput,
  ExtractionResult,
  ProviderConfig,
  ProviderStatus,
  ExtractedDate,
  ExtractedPerson,
  ExtractedOrganization,
  ExtractedLocation,
} from '../extraction-types';

/**
 * Response format from the spaCy service
 */
interface SpacyResponse {
  dates: Array<{
    rawText: string;
    parsedDate: string | null;
    precision: string;
    category: string;
    confidence: number;
    context: string;
    isApproximate: boolean;
  }>;
  people: Array<{
    name: string;
    role: string;
    mentions: string[];
    confidence: number;
  }>;
  organizations: Array<{
    name: string;
    type: string;
    mentions: string[];
    confidence: number;
  }>;
  locations: Array<{
    name: string;
    type: string;
    confidence: number;
  }>;
  maskedPatterns?: Array<{
    original: string;
    reason: string;
    position: number;
  }>;
  processingTimeMs: number;
}

/**
 * spaCy Provider implementation
 */
export class SpacyProvider extends BaseExtractionProvider {
  private process: ChildProcess | null = null;
  private startupPromise: Promise<void> | null = null;
  private port: number;
  private pythonPath: string;
  private serviceDir: string;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);

    this.port = config.settings.port || 8234;

    // Service script location (relative to electron directory)
    this.serviceDir = join(__dirname, '..', '..', '..', 'python', 'spacy-service');

    // Use venv Python if available, otherwise fall back to system python3
    const venvPython = join(this.serviceDir, 'venv', 'bin', 'python');
    this.pythonPath = config.settings.executablePath || venvPython;

    this.baseUrl = `http://localhost:${this.port}`;
  }

  /**
   * Check if spaCy service is available
   */
  async checkAvailability(): Promise<ProviderStatus> {
    const startTime = Date.now();

    try {
      // First check if the service is already running
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/health`,
        { method: 'GET' },
        5000
      );

      if (response.ok) {
        const data = (await response.json()) as {
          status: string;
          model: string;
          version?: string;
        };

        this.status = {
          id: this.config.id,
          available: true,
          lastCheck: new Date().toISOString(),
          responseTimeMs: Date.now() - startTime,
          modelInfo: {
            name: data.model || 'en_core_web_lg',
            description: 'spaCy NER + dateparser',
          },
        };

        return this.status;
      }
    } catch {
      // Service not running - that's expected, we'll start it
    }

    // Check if Python and requirements exist
    const canStart = await this.checkRequirements();

    this.status = {
      id: this.config.id,
      available: canStart,
      lastCheck: new Date().toISOString(),
      responseTimeMs: Date.now() - startTime,
      lastError: canStart
        ? 'Service not running (will start on first use)'
        : 'Python or spaCy not available',
    };

    return this.status;
  }

  /**
   * Check if Python and spaCy are available
   */
  private async checkRequirements(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.pythonPath, ['-c', 'import spacy; import dateparser; print("ok")']);
      let output = '';

      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        resolve(code === 0 && output.includes('ok'));
      });

      proc.on('error', () => {
        resolve(false);
      });

      // Timeout
      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 10000);
    });
  }

  /**
   * Ensure the spaCy service is running
   */
  private async ensureServiceRunning(): Promise<void> {
    // If already running and healthy, return
    if (this.process && !this.process.killed) {
      try {
        const response = await this.fetchWithTimeout(
          `${this.baseUrl}/health`,
          { method: 'GET' },
          2000
        );
        if (response.ok) return;
      } catch {
        // Process died, need to restart
        this.process = null;
      }
    }

    // If another call is already starting the service, wait for it
    if (this.startupPromise) {
      return this.startupPromise;
    }

    // We're the first caller, start the service
    this.startupPromise = this.doStartService();

    try {
      await this.startupPromise;
    } finally {
      this.startupPromise = null;
    }
  }

  /**
   * Actually start the Python service
   */
  private async doStartService(): Promise<void> {
    const serviceScript = join(this.serviceDir, 'main.py');

    // Check if script exists
    if (!existsSync(serviceScript)) {
      throw new Error(
        `spaCy service script not found at ${serviceScript}. ` +
        `Please run the setup script to install the Python service.`
      );
    }

    this.log('info', `Starting spaCy service on port ${this.port}...`);

    this.process = spawn(this.pythonPath, [
      '-u', // Unbuffered output
      serviceScript,
      '--port', String(this.port),
    ], {
      cwd: this.serviceDir,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    // Log output
    this.process.stdout?.on('data', (data: Buffer) => {
      this.log('info', `[spacy] ${data.toString().trim()}`);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      // Filter out uvicorn startup messages
      if (!msg.includes('Uvicorn running') && !msg.includes('Started server')) {
        this.log('warn', `[spacy] ${msg}`);
      }
    });

    this.process.on('error', (error) => {
      this.log('error', 'spaCy service failed to start', error);
      this.process = null;
    });

    this.process.on('close', (code) => {
      this.log('info', `spaCy service exited with code ${code}`);
      this.process = null;
    });

    // Wait for service to be ready (max 30 seconds)
    const maxWait = 30000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      try {
        const response = await this.fetchWithTimeout(
          `${this.baseUrl}/health`,
          { method: 'GET' },
          2000
        );
        if (response.ok) {
          this.log('info', 'spaCy service is ready');
          return;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(
      `spaCy service failed to start within ${maxWait / 1000}s. ` +
      `Check Python dependencies: pip install spacy dateparser uvicorn fastapi`
    );
  }

  /**
   * Main extraction method
   */
  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    // spaCy cannot generate summaries/titles
    const needsSummary =
      input.extractTypes?.includes('summary') ||
      input.extractTypes?.includes('title');

    if (needsSummary && !input.extractTypes?.includes('dates')) {
      throw new Error(
        'spaCy provider cannot generate summaries or titles. Use an LLM provider instead.'
      );
    }

    const startTime = Date.now();

    // Ensure service is running
    await this.ensureServiceRunning();

    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/extract`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: input.text,
            articleDate: input.articleDate,
            extractTypes: input.extractTypes || ['dates', 'people', 'organizations', 'locations'],
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`spaCy service error: ${error}`);
      }

      const data = (await response.json()) as SpacyResponse;
      const processingTimeMs = Date.now() - startTime;

      // Map to our result format
      const result: ExtractionResult = {
        provider: 'spacy',
        model: 'en_core_web_lg',
        dates: data.dates.map((d) => ({
          rawText: d.rawText,
          parsedDate: d.parsedDate,
          precision: d.precision as ExtractedDate['precision'],
          category: d.category as ExtractedDate['category'],
          confidence: d.confidence,
          context: d.context,
          isApproximate: d.isApproximate,
        })),
        people: data.people.map((p) => ({
          name: p.name,
          role: p.role as ExtractedPerson['role'],
          mentions: p.mentions,
          confidence: p.confidence,
        })),
        organizations: data.organizations.map((o) => ({
          name: o.name,
          type: o.type as ExtractedOrganization['type'],
          mentions: o.mentions,
          confidence: o.confidence,
        })),
        locations: data.locations.map((l) => ({
          name: l.name,
          type: l.type as ExtractedLocation['type'],
          confidence: l.confidence,
        })),
        processingTimeMs,
        warnings:
          needsSummary && input.extractTypes?.includes('dates')
            ? ['Summary/title generation requires an LLM provider']
            : undefined,
      };

      this.log(
        'info',
        `spaCy extraction complete in ${processingTimeMs}ms: ` +
        `${result.dates.length} dates, ${result.people.length} people`
      );

      return result;
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      this.log('error', `spaCy extraction failed after ${processingTimeMs}ms`, error);
      throw error;
    }
  }

  /**
   * Get model info
   */
  async getModelInfo(): Promise<{ name: string; size?: string; description?: string }> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/health`,
        { method: 'GET' },
        5000
      );

      if (response.ok) {
        const data = (await response.json()) as {
          model: string;
          version?: string;
        };
        return {
          name: data.model || 'en_core_web_lg',
          description: `spaCy NER model v${data.version || 'unknown'}`,
        };
      }
    } catch {
      // Service not running
    }

    return {
      name: 'en_core_web_lg',
      description: 'spaCy English NER model (offline)',
    };
  }

  /**
   * Shutdown the spaCy service
   */
  async shutdown(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.log('info', 'Shutting down spaCy service...');

      // Try graceful shutdown first
      try {
        await this.fetchWithTimeout(
          `${this.baseUrl}/shutdown`,
          { method: 'POST' },
          2000
        );
      } catch {
        // Ignore - may already be dead
      }

      // Give it a moment to shutdown
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Force kill if still running
      if (!this.process.killed) {
        this.process.kill('SIGTERM');
        await new Promise((resolve) => setTimeout(resolve, 1000));

        if (!this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }

      this.process = null;
      this.log('info', 'spaCy service stopped');
    }
  }

  /**
   * Check if service is currently running
   */
  isServiceRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}
