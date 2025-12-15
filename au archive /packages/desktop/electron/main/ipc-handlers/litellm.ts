/**
 * LiteLLM IPC Handlers
 *
 * Handles LiteLLM proxy lifecycle management from the renderer.
 *
 * @version 1.0
 * @see docs/plans/litellm-integration-plan.md - Phase 2
 */

import { ipcMain } from 'electron';
import {
  LiteLLMLifecycle,
  ensureLiteLLMRunning,
  stopLiteLLM,
  reloadConfig,
  getLiteLLMStatus,
  getLiteLLMCosts,
  cleanupOrphanLiteLLM,
} from '../../services/litellm-lifecycle-service';
import { TestModelSchema } from './litellm-validation';
import { z } from 'zod';
import { getRawDatabase } from '../database';

// =============================================================================
// HANDLER REGISTRATION
// =============================================================================

/**
 * Register all LiteLLM-related IPC handlers.
 */
export function registerLiteLLMHandlers(): void {
  // -------------------------------------------------------------------------
  // litellm:status - Get proxy status
  // -------------------------------------------------------------------------
  ipcMain.handle('litellm:status', async () => {
    try {
      const status = await getLiteLLMStatus();
      return { success: true, status };
    } catch (error) {
      console.error('[LiteLLM IPC] Status error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // -------------------------------------------------------------------------
  // litellm:start - Start proxy
  // -------------------------------------------------------------------------
  ipcMain.handle('litellm:start', async () => {
    try {
      const started = await ensureLiteLLMRunning();
      if (started) {
        return { success: true };
      } else {
        const status = await getLiteLLMStatus();
        return {
          success: false,
          error: status.lastError || 'Failed to start LiteLLM proxy',
        };
      }
    } catch (error) {
      console.error('[LiteLLM IPC] Start error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // -------------------------------------------------------------------------
  // litellm:stop - Stop proxy
  // -------------------------------------------------------------------------
  ipcMain.handle('litellm:stop', async () => {
    try {
      stopLiteLLM();
      return { success: true };
    } catch (error) {
      console.error('[LiteLLM IPC] Stop error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // -------------------------------------------------------------------------
  // litellm:reload - Reload config (after credential changes)
  // -------------------------------------------------------------------------
  ipcMain.handle('litellm:reload', async () => {
    try {
      const success = await reloadConfig();
      return { success };
    } catch (error) {
      console.error('[LiteLLM IPC] Reload error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // -------------------------------------------------------------------------
  // litellm:test - Test a model with a simple prompt
  // -------------------------------------------------------------------------
  ipcMain.handle('litellm:test', async (_, modelName: string) => {
    try {
      // Validate input
      const validated = TestModelSchema.parse({ model: modelName });

      // Ensure proxy is running
      if (!(await ensureLiteLLMRunning())) {
        return {
          success: false,
          error: 'LiteLLM proxy not running',
        };
      }

      const status = await getLiteLLMStatus();

      // Test the model
      const response = await fetch(
        `http://localhost:${status.port}/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: validated.model,
            messages: [
              {
                role: 'user',
                content: 'Say "test successful" in exactly 2 words.',
              },
            ],
            max_tokens: 10,
            temperature: 0,
          }),
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Model test failed: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || 'No response';

      // Reset idle timer since we made a request
      LiteLLMLifecycle.resetIdleTimer();

      return {
        success: true,
        response: content,
        model: data.model,
        usage: data.usage,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { success: false, error: 'Invalid model name' };
      }
      console.error('[LiteLLM IPC] Test error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // -------------------------------------------------------------------------
  // litellm:costs - Get usage costs
  // -------------------------------------------------------------------------
  ipcMain.handle('litellm:costs', async () => {
    try {
      const costs = await getLiteLLMCosts();
      if (costs) {
        return { success: true, costs };
      } else {
        return {
          success: false,
          error: 'Cost tracking not available (proxy not running or no cost data)',
        };
      }
    } catch (error) {
      console.error('[LiteLLM IPC] Costs error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // -------------------------------------------------------------------------
  // litellm:models - List available models
  // -------------------------------------------------------------------------
  ipcMain.handle('litellm:models', async () => {
    try {
      const status = await getLiteLLMStatus();

      if (!status.running) {
        return {
          success: true,
          models: status.configuredModels,
          running: false,
        };
      }

      // Try to get models from running proxy
      try {
        const response = await fetch(
          `http://localhost:${status.port}/models`,
          { signal: AbortSignal.timeout(5000) }
        );

        if (response.ok) {
          const data = await response.json();
          return {
            success: true,
            models: data.data?.map((m: any) => m.id) || status.configuredModels,
            running: true,
          };
        }
      } catch {
        // Fall back to configured models
      }

      return {
        success: true,
        models: status.configuredModels,
        running: true,
      };
    } catch (error) {
      console.error('[LiteLLM IPC] Models error:', error);
      return {
        success: false,
        models: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // -------------------------------------------------------------------------
  // litellm:settings:get - Get LiteLLM settings
  // -------------------------------------------------------------------------
  ipcMain.handle('litellm:settings:get', async () => {
    try {
      const db = getRawDatabase();
      const rows = db
        .prepare('SELECT key, value FROM litellm_settings')
        .all() as { key: string; value: string }[];

      const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      return { success: true, settings };
    } catch (error) {
      console.error('[LiteLLM IPC] Settings get error:', error);
      return {
        success: false,
        settings: {},
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // -------------------------------------------------------------------------
  // litellm:settings:set - Update LiteLLM settings
  // -------------------------------------------------------------------------
  ipcMain.handle(
    'litellm:settings:set',
    async (_, key: string, value: string) => {
      try {
        const db = getRawDatabase();
        const now = new Date().toISOString();

        db.prepare(
          `INSERT INTO litellm_settings (key, value, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        ).run(key, value, now);

        return { success: true };
      } catch (error) {
        console.error('[LiteLLM IPC] Settings set error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  console.log('[IPC] LiteLLM handlers registered');
}

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Shutdown LiteLLM on app exit.
 */
export function shutdownLiteLLM(): void {
  stopLiteLLM();
}

// =============================================================================
// EXPORTS
// =============================================================================

export { cleanupOrphanLiteLLM };
export default registerLiteLLMHandlers;
