/**
 * Cost Tracking Service
 *
 * Tracks LLM usage costs for cloud providers (Anthropic, OpenAI, Google).
 * Provides aggregation, reporting, and budget alerts.
 *
 * Pricing (as of Dec 2024):
 * - Claude 3.5 Sonnet: $3/1M input, $15/1M output
 * - GPT-4o: $2.50/1M input, $10/1M output
 * - Gemini 1.5 Pro: $1.25/1M input, $5/1M output
 *
 * @version 1.0
 * @see docs/plans/litellm-completion-guide.md
 */

import type { Database as SqliteDatabase } from 'better-sqlite3';
import { randomUUID } from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export interface CostEntry {
  cost_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  locid?: string;
  source_type?: string;
  source_id?: string;
  operation?: string;
  duration_ms?: number;
  success: boolean;
  error_message?: string;
  created_at: string;
}

export interface RecordCostInput {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  locid?: string;
  sourceType?: string;
  sourceId?: string;
  operation?: string;
  durationMs?: number;
  success?: boolean;
  errorMessage?: string;
}

export interface CostSummary {
  totalCost: number;
  totalTokens: number;
  byProvider: Record<string, { cost: number; tokens: number; requests: number }>;
  byModel: Record<string, { cost: number; tokens: number; requests: number }>;
  period: {
    start: string;
    end: string;
  };
}

export interface DailyCost {
  date: string;
  cost: number;
  tokens: number;
  requests: number;
}

// =============================================================================
// PRICING CONFIGURATION
// =============================================================================

// Pricing per 1M tokens (multiply by 1e-6 for per-token cost)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.25, output: 1.25 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'o1': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 3.0, output: 12.0 },
  // Google
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash-exp': { input: 0.1, output: 0.4 },
  // Groq (very low cost due to inference optimization)
  'llama-3.1-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
  'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },
};

// Default pricing for unknown models (conservative estimate)
const DEFAULT_PRICING = { input: 5.0, output: 15.0 };

// =============================================================================
// SERVICE
// =============================================================================

export class CostTrackingService {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  // ---------------------------------------------------------------------------
  // COST CALCULATION
  // ---------------------------------------------------------------------------

  /**
   * Calculate cost for a given model and token counts.
   */
  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;
    const inputCost = (inputTokens * pricing.input) / 1_000_000;
    const outputCost = (outputTokens * pricing.output) / 1_000_000;
    return Number((inputCost + outputCost).toFixed(6));
  }

  /**
   * Get pricing info for a model.
   */
  getModelPricing(model: string): { input: number; output: number; isDefault: boolean } {
    const pricing = MODEL_PRICING[model];
    return {
      input: pricing?.input ?? DEFAULT_PRICING.input,
      output: pricing?.output ?? DEFAULT_PRICING.output,
      isDefault: !pricing,
    };
  }

  // ---------------------------------------------------------------------------
  // RECORDING
  // ---------------------------------------------------------------------------

  /**
   * Record a cost entry for an LLM call.
   */
  recordCost(input: RecordCostInput): CostEntry {
    const costUsd = this.calculateCost(input.model, input.inputTokens, input.outputTokens);
    const costId = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO extraction_costs (
        cost_id, provider, model, input_tokens, output_tokens,
        cost_usd, locid, source_type, source_id, operation,
        duration_ms, success, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      costId,
      input.provider,
      input.model,
      input.inputTokens,
      input.outputTokens,
      costUsd,
      input.locid || null,
      input.sourceType || null,
      input.sourceId || null,
      input.operation || null,
      input.durationMs || null,
      input.success !== false ? 1 : 0,
      input.errorMessage || null,
      now
    );

    console.log(`[CostTracking] Recorded: ${input.provider}/${input.model} - $${costUsd.toFixed(6)} (${input.inputTokens}+${input.outputTokens} tokens)`);

    return {
      cost_id: costId,
      provider: input.provider,
      model: input.model,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      total_tokens: input.inputTokens + input.outputTokens,
      cost_usd: costUsd,
      locid: input.locid,
      source_type: input.sourceType,
      source_id: input.sourceId,
      operation: input.operation,
      duration_ms: input.durationMs,
      success: input.success !== false,
      error_message: input.errorMessage,
      created_at: now,
    };
  }

  // ---------------------------------------------------------------------------
  // QUERYING
  // ---------------------------------------------------------------------------

  /**
   * Get cost summary for a time period.
   */
  getSummary(startDate?: string, endDate?: string): CostSummary {
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const end = endDate || new Date().toISOString();

    // Get totals
    const totals = this.db.prepare(`
      SELECT
        COALESCE(SUM(cost_usd), 0) as total_cost,
        COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens
      FROM extraction_costs
      WHERE created_at >= ? AND created_at <= ?
    `).get(start, end) as { total_cost: number; total_tokens: number };

    // Get by provider
    const byProvider = this.db.prepare(`
      SELECT
        provider,
        SUM(cost_usd) as cost,
        SUM(input_tokens + output_tokens) as tokens,
        COUNT(*) as requests
      FROM extraction_costs
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY provider
    `).all(start, end) as { provider: string; cost: number; tokens: number; requests: number }[];

    // Get by model
    const byModel = this.db.prepare(`
      SELECT
        model,
        SUM(cost_usd) as cost,
        SUM(input_tokens + output_tokens) as tokens,
        COUNT(*) as requests
      FROM extraction_costs
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY model
    `).all(start, end) as { model: string; cost: number; tokens: number; requests: number }[];

    return {
      totalCost: totals.total_cost,
      totalTokens: totals.total_tokens,
      byProvider: Object.fromEntries(
        byProvider.map(p => [p.provider, { cost: p.cost, tokens: p.tokens, requests: p.requests }])
      ),
      byModel: Object.fromEntries(
        byModel.map(m => [m.model, { cost: m.cost, tokens: m.tokens, requests: m.requests }])
      ),
      period: { start, end },
    };
  }

  /**
   * Get daily cost breakdown.
   */
  getDailyCosts(days: number = 30): DailyCost[] {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    return this.db.prepare(`
      SELECT
        DATE(created_at) as date,
        SUM(cost_usd) as cost,
        SUM(input_tokens + output_tokens) as tokens,
        COUNT(*) as requests
      FROM extraction_costs
      WHERE created_at >= ?
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `).all(startDate) as DailyCost[];
  }

  /**
   * Get total cost for current month.
   */
  getCurrentMonthCost(): number {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const result = this.db.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0) as total
      FROM extraction_costs
      WHERE created_at >= ?
    `).get(startOfMonth.toISOString()) as { total: number };

    return result.total;
  }

  /**
   * Get costs for a specific location.
   */
  getLocationCosts(locid: string): CostEntry[] {
    return this.db.prepare(`
      SELECT *,
        (input_tokens + output_tokens) as total_tokens
      FROM extraction_costs
      WHERE locid = ?
      ORDER BY created_at DESC
    `).all(locid) as CostEntry[];
  }

  /**
   * Get recent cost entries.
   */
  getRecentEntries(limit: number = 100): CostEntry[] {
    return this.db.prepare(`
      SELECT *,
        (input_tokens + output_tokens) as total_tokens
      FROM extraction_costs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as CostEntry[];
  }

  // ---------------------------------------------------------------------------
  // BUDGET ALERTS
  // ---------------------------------------------------------------------------

  /**
   * Check if current month cost exceeds budget.
   */
  checkBudget(monthlyBudget: number): {
    exceeded: boolean;
    current: number;
    budget: number;
    percentUsed: number;
  } {
    const current = this.getCurrentMonthCost();
    const percentUsed = monthlyBudget > 0 ? (current / monthlyBudget) * 100 : 0;

    return {
      exceeded: current > monthlyBudget,
      current,
      budget: monthlyBudget,
      percentUsed: Number(percentUsed.toFixed(1)),
    };
  }

  // ---------------------------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------------------------

  /**
   * Delete old cost entries (for data retention).
   */
  cleanupOldEntries(olderThanDays: number = 365): number {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

    const result = this.db.prepare(`
      DELETE FROM extraction_costs
      WHERE created_at < ?
    `).run(cutoff);

    console.log(`[CostTracking] Cleaned up ${result.changes} entries older than ${olderThanDays} days`);
    return result.changes;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let costTrackingService: CostTrackingService | null = null;

export function getCostTrackingService(db: SqliteDatabase): CostTrackingService {
  if (!costTrackingService) {
    costTrackingService = new CostTrackingService(db);
  }
  return costTrackingService;
}

export function resetCostTrackingService(): void {
  costTrackingService = null;
}
