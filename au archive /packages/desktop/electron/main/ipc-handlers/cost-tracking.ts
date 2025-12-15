/**
 * Cost Tracking IPC Handlers
 *
 * Handles LLM usage cost tracking, reporting, and budget management.
 *
 * @version 1.0
 * @see docs/plans/litellm-completion-guide.md - Phase 5
 */

import { ipcMain } from 'electron';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import {
  getCostTrackingService,
  type RecordCostInput,
  type CostSummary,
  type DailyCost,
  type CostEntry,
} from '../../services/extraction/cost-tracking-service';
import { z } from 'zod';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const RecordCostSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  locid: z.string().optional(),
  sourceType: z.string().optional(),
  sourceId: z.string().optional(),
  operation: z.string().optional(),
  durationMs: z.number().int().min(0).optional(),
  success: z.boolean().optional(),
  errorMessage: z.string().optional(),
});

const GetSummarySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const GetDailyCostsSchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
});

const CheckBudgetSchema = z.object({
  monthlyBudget: z.number().min(0),
});

const GetLocationCostsSchema = z.object({
  locid: z.string().min(1),
});

const GetRecentEntriesSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
});

const CleanupSchema = z.object({
  olderThanDays: z.number().int().min(1).optional(),
});

// =============================================================================
// HANDLER REGISTRATION
// =============================================================================

export function registerCostTrackingHandlers(db: SqliteDatabase): void {
  const service = getCostTrackingService(db);

  // ---------------------------------------------------------------------------
  // costs:record - Record a new cost entry
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    'costs:record',
    async (_, input: RecordCostInput): Promise<{ success: boolean; entry?: CostEntry; error?: string }> => {
      try {
        const validated = RecordCostSchema.parse(input);
        const entry = service.recordCost(validated);
        return { success: true, entry };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return { success: false, error: error.errors[0]?.message || 'Validation failed' };
        }
        console.error('[CostTracking IPC] Record error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // costs:getSummary - Get cost summary for a period
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    'costs:getSummary',
    async (_, input?: { startDate?: string; endDate?: string }): Promise<{ success: boolean; summary?: CostSummary; error?: string }> => {
      try {
        const validated = GetSummarySchema.parse(input || {});
        const summary = service.getSummary(validated.startDate, validated.endDate);
        return { success: true, summary };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return { success: false, error: error.errors[0]?.message || 'Validation failed' };
        }
        console.error('[CostTracking IPC] GetSummary error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // costs:getDailyCosts - Get daily cost breakdown
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    'costs:getDailyCosts',
    async (_, input?: { days?: number }): Promise<{ success: boolean; costs?: DailyCost[]; error?: string }> => {
      try {
        const validated = GetDailyCostsSchema.parse(input || {});
        const costs = service.getDailyCosts(validated.days);
        return { success: true, costs };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return { success: false, error: error.errors[0]?.message || 'Validation failed' };
        }
        console.error('[CostTracking IPC] GetDailyCosts error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // costs:getCurrentMonth - Get current month's total cost
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    'costs:getCurrentMonth',
    async (): Promise<{ success: boolean; cost?: number; error?: string }> => {
      try {
        const cost = service.getCurrentMonthCost();
        return { success: true, cost };
      } catch (error) {
        console.error('[CostTracking IPC] GetCurrentMonth error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // costs:checkBudget - Check if current month exceeds budget
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    'costs:checkBudget',
    async (_, input: { monthlyBudget: number }): Promise<{
      success: boolean;
      exceeded?: boolean;
      current?: number;
      budget?: number;
      percentUsed?: number;
      error?: string;
    }> => {
      try {
        const validated = CheckBudgetSchema.parse(input);
        const result = service.checkBudget(validated.monthlyBudget);
        return { success: true, ...result };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return { success: false, error: error.errors[0]?.message || 'Validation failed' };
        }
        console.error('[CostTracking IPC] CheckBudget error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // costs:getLocationCosts - Get costs for a specific location
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    'costs:getLocationCosts',
    async (_, input: { locid: string }): Promise<{ success: boolean; costs?: CostEntry[]; error?: string }> => {
      try {
        const validated = GetLocationCostsSchema.parse(input);
        const costs = service.getLocationCosts(validated.locid);
        return { success: true, costs };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return { success: false, error: error.errors[0]?.message || 'Validation failed' };
        }
        console.error('[CostTracking IPC] GetLocationCosts error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // costs:getRecent - Get recent cost entries
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    'costs:getRecent',
    async (_, input?: { limit?: number }): Promise<{ success: boolean; entries?: CostEntry[]; error?: string }> => {
      try {
        const validated = GetRecentEntriesSchema.parse(input || {});
        const entries = service.getRecentEntries(validated.limit);
        return { success: true, entries };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return { success: false, error: error.errors[0]?.message || 'Validation failed' };
        }
        console.error('[CostTracking IPC] GetRecent error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // costs:getModelPricing - Get pricing info for a model
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    'costs:getModelPricing',
    async (_, model: string): Promise<{
      success: boolean;
      pricing?: { input: number; output: number; isDefault: boolean };
      error?: string;
    }> => {
      try {
        if (!model || typeof model !== 'string') {
          return { success: false, error: 'Model name required' };
        }
        const pricing = service.getModelPricing(model);
        return { success: true, pricing };
      } catch (error) {
        console.error('[CostTracking IPC] GetModelPricing error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // costs:cleanup - Delete old cost entries
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    'costs:cleanup',
    async (_, input?: { olderThanDays?: number }): Promise<{ success: boolean; deleted?: number; error?: string }> => {
      try {
        const validated = CleanupSchema.parse(input || {});
        const deleted = service.cleanupOldEntries(validated.olderThanDays);
        return { success: true, deleted };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return { success: false, error: error.errors[0]?.message || 'Validation failed' };
        }
        console.error('[CostTracking IPC] Cleanup error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  console.log('[IPC] Cost tracking handlers registered');
}

export default registerCostTrackingHandlers;
