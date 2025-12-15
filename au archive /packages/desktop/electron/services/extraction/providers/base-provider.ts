/**
 * Base Provider Interface
 *
 * Every extraction provider must extend this class.
 * This ensures consistent behavior across spaCy, Ollama, and cloud providers.
 *
 * @version 1.0
 */

import type {
  ExtractionInput,
  ExtractionResult,
  ProviderConfig,
  ProviderStatus,
} from '../extraction-types';

/**
 * Abstract base class for all extraction providers
 */
export abstract class BaseExtractionProvider {
  /** Provider configuration */
  protected config: ProviderConfig;

  /** Last known status */
  protected status: ProviderStatus;

  /** Cache timeout in ms (30 seconds) */
  protected readonly STATUS_CACHE_TTL = 30000;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.status = {
      id: config.id,
      available: false,
      lastCheck: new Date(0).toISOString(), // Force initial check
    };
  }

  // ============================================================
  // ABSTRACT METHODS (must be implemented by each provider)
  // ============================================================

  /**
   * Check if this provider is available and ready to use.
   * For Ollama: can we connect to the server?
   * For spaCy: is the executable present and working?
   * For cloud: is the API key valid?
   */
  abstract checkAvailability(): Promise<ProviderStatus>;

  /**
   * Perform the actual extraction.
   * This is where the magic happens.
   */
  abstract extract(input: ExtractionInput): Promise<ExtractionResult>;

  /**
   * Get information about the model being used.
   * Useful for displaying to the user.
   */
  abstract getModelInfo(): Promise<{ name: string; size?: string; description?: string }>;

  // ============================================================
  // SHARED METHODS (inherited by all providers)
  // ============================================================

  /**
   * Get provider ID
   */
  getId(): string {
    return this.config.id;
  }

  /**
   * Get provider display name
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * Get provider type
   */
  getType(): string {
    return this.config.type;
  }

  /**
   * Check if provider is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get priority (lower = higher priority)
   */
  getPriority(): number {
    return this.config.priority;
  }

  /**
   * Get the current configuration
   */
  getConfig(): ProviderConfig {
    return { ...this.config };
  }

  /**
   * Quick availability check using cached status
   * (Use checkAvailability() for fresh check)
   */
  async isAvailable(): Promise<boolean> {
    const lastCheck = new Date(this.status.lastCheck);
    const now = new Date();
    const ageMs = now.getTime() - lastCheck.getTime();

    // If last check was more than TTL ago, refresh
    if (ageMs > this.STATUS_CACHE_TTL) {
      this.status = await this.checkAvailability();
    }

    return this.status.available;
  }

  /**
   * Force a fresh availability check
   */
  async refreshStatus(): Promise<ProviderStatus> {
    this.status = await this.checkAvailability();
    return this.status;
  }

  /**
   * Get last known status
   */
  getStatus(): ProviderStatus {
    return { ...this.status };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...updates };

    // Merge settings if provided
    if (updates.settings) {
      this.config.settings = { ...this.config.settings, ...updates.settings };
    }

    // Force availability recheck on next call
    this.status.lastCheck = new Date(0).toISOString();
  }

  /**
   * Get timeout setting with default
   */
  protected getTimeout(): number {
    return this.config.settings.timeout ?? 120000; // 2 minutes default
  }

  /**
   * Get temperature setting with default
   */
  protected getTemperature(): number {
    return this.config.settings.temperature ?? 0.1; // Low for extraction
  }

  /**
   * Get max tokens setting with default
   */
  protected getMaxTokens(): number {
    return this.config.settings.maxTokens ?? 4096;
  }

  /**
   * Create a fetch with timeout
   */
  protected async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs?: number
  ): Promise<Response> {
    const timeout = timeoutMs ?? this.getTimeout();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Log a message with provider context
   */
  protected log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    const prefix = `[${this.config.type}:${this.config.id}]`;
    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (data) {
      logFn(prefix, message, data);
    } else {
      logFn(prefix, message);
    }
  }

  /**
   * Optional shutdown hook for cleanup
   * Override in subclasses if needed
   */
  async shutdown(): Promise<void> {
    // Default: no-op
  }
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Create a timestamp for logging
 */
export function timestamp(): string {
  return new Date().toISOString();
}
