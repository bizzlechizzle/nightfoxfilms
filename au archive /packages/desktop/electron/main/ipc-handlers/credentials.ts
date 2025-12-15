/**
 * Credentials IPC Handlers
 *
 * Handles secure API key storage for cloud LLM providers.
 * Keys are encrypted using Electron's safeStorage and stored in SQLite.
 *
 * SECURITY:
 * - Keys are NEVER sent to the renderer process
 * - Only main process can retrieve decrypted keys
 * - All inputs are validated with Zod before processing
 *
 * @version 1.1 - Added auto-enable on credential store
 * @see docs/plans/litellm-integration-plan.md - Phase 1
 */

import { ipcMain } from 'electron';
import {
  storeCredential,
  hasCredential,
  deleteCredential,
  listCredentialProviders,
  getCredentialInfo,
  isEncryptionAvailable,
} from '../../services/credential-service';
import {
  StoreCredentialSchema,
  ProviderIdSchema,
  type ProviderId,
} from './litellm-validation';
import { z } from 'zod';
import { getRawDatabase } from '../database';

// =============================================================================
// PROVIDER CONNECTION TESTING
// =============================================================================

/**
 * Test API key connection for a provider.
 * Makes a minimal API call to verify the key works.
 */
async function testProviderConnection(
  provider: ProviderId,
  apiKey: string
): Promise<{ success: boolean; error?: string; responseTimeMs?: number }> {
  const startTime = Date.now();

  try {
    switch (provider) {
      case 'anthropic': {
        // Anthropic: Use messages endpoint with minimal request
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }],
          }),
        });

        if (response.ok || response.status === 400) {
          // 400 is OK - means key is valid but request was invalid (expected)
          return { success: true, responseTimeMs: Date.now() - startTime };
        }
        if (response.status === 401) {
          return { success: false, error: 'Invalid API key' };
        }
        return { success: false, error: `HTTP ${response.status}` };
      }

      case 'openai': {
        // OpenAI: Use models endpoint (no body needed)
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });

        if (response.ok) {
          return { success: true, responseTimeMs: Date.now() - startTime };
        }
        if (response.status === 401) {
          return { success: false, error: 'Invalid API key' };
        }
        return { success: false, error: `HTTP ${response.status}` };
      }

      case 'google': {
        // Google: Use models list endpoint
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
        );

        if (response.ok) {
          return { success: true, responseTimeMs: Date.now() - startTime };
        }
        if (response.status === 400 || response.status === 403) {
          return { success: false, error: 'Invalid API key' };
        }
        return { success: false, error: `HTTP ${response.status}` };
      }

      case 'groq': {
        // Groq: Use models endpoint
        const response = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });

        if (response.ok) {
          return { success: true, responseTimeMs: Date.now() - startTime };
        }
        if (response.status === 401) {
          return { success: false, error: 'Invalid API key' };
        }
        return { success: false, error: `HTTP ${response.status}` };
      }

      default:
        return { success: false, error: 'Unknown provider' };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

/**
 * Enable a provider in the extraction_providers table.
 */
function enableProvider(provider: ProviderId): void {
  const db = getRawDatabase();

  // Map provider to extraction provider ID
  const providerIdMap: Record<ProviderId, string> = {
    anthropic: 'anthropic-claude',
    openai: 'openai-gpt',
    google: 'google-gemini',
    groq: 'groq-llama', // Add if we have Groq provider
  };

  const providerId = providerIdMap[provider];
  if (!providerId) return;

  try {
    // Check if provider exists
    const existing = db
      .prepare('SELECT provider_id FROM extraction_providers WHERE provider_id = ?')
      .get(providerId);

    if (existing) {
      // Enable existing provider
      db.prepare('UPDATE extraction_providers SET enabled = 1, updated_at = datetime(\'now\') WHERE provider_id = ?')
        .run(providerId);
      console.log(`[Credentials] Enabled existing provider: ${providerId}`);
    }
    // If provider doesn't exist, it will be created by DEFAULT_PROVIDERS on next init
  } catch (error) {
    console.warn(`[Credentials] Could not enable provider ${providerId}:`, error);
  }
}

/**
 * Disable a provider when its credentials are deleted.
 */
function disableProvider(provider: ProviderId): void {
  const db = getRawDatabase();

  const providerIdMap: Record<ProviderId, string> = {
    anthropic: 'anthropic-claude',
    openai: 'openai-gpt',
    google: 'google-gemini',
    groq: 'groq-llama',
  };

  const providerId = providerIdMap[provider];
  if (!providerId) return;

  try {
    db.prepare('UPDATE extraction_providers SET enabled = 0, updated_at = datetime(\'now\') WHERE provider_id = ?')
      .run(providerId);
    console.log(`[Credentials] Disabled provider: ${providerId}`);
  } catch (error) {
    console.warn(`[Credentials] Could not disable provider ${providerId}:`, error);
  }
}

// =============================================================================
// HANDLER REGISTRATION
// =============================================================================

/**
 * Register all credential-related IPC handlers.
 */
export function registerCredentialHandlers(): void {
  // -------------------------------------------------------------------------
  // credentials:store - Store encrypted API key with auto-test and enable
  // -------------------------------------------------------------------------
  ipcMain.handle(
    'credentials:store',
    async (_, input: { provider: string; apiKey: string }) => {
      try {
        // Validate input
        const validated = StoreCredentialSchema.parse(input);

        // Check encryption availability
        if (!isEncryptionAvailable()) {
          return {
            success: false,
            error: 'Encryption not available on this system. Cannot store API keys securely.',
          };
        }

        // Test connection before storing
        console.log(`[Credentials IPC] Testing connection for ${validated.provider}...`);
        const testResult = await testProviderConnection(
          validated.provider as ProviderId,
          validated.apiKey
        );

        if (!testResult.success) {
          console.warn(`[Credentials IPC] Connection test failed for ${validated.provider}: ${testResult.error}`);
          return {
            success: false,
            error: `Connection test failed: ${testResult.error}`,
            testFailed: true,
          };
        }

        console.log(`[Credentials IPC] Connection test passed (${testResult.responseTimeMs}ms)`);

        // Store encrypted key
        await storeCredential(validated.provider as ProviderId, validated.apiKey);

        // Auto-enable the provider
        enableProvider(validated.provider as ProviderId);

        console.log(`[Credentials IPC] Stored and enabled ${validated.provider}`);
        return {
          success: true,
          autoEnabled: true,
          responseTimeMs: testResult.responseTimeMs,
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          const message = error.errors[0]?.message || 'Validation failed';
          console.warn('[Credentials IPC] Validation error:', message);
          return { success: false, error: message };
        }
        console.error('[Credentials IPC] Store error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // credentials:has - Check if provider has stored key
  // -------------------------------------------------------------------------
  ipcMain.handle('credentials:has', async (_, input: { provider: string }) => {
    try {
      // Validate provider
      const validatedProvider = ProviderIdSchema.parse(input.provider);

      const hasKey = await hasCredential(validatedProvider as ProviderId);
      return { success: true, hasKey };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { success: false, hasKey: false, error: 'Invalid provider' };
      }
      console.error('[Credentials IPC] Has error:', error);
      return {
        success: false,
        hasKey: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // -------------------------------------------------------------------------
  // credentials:delete - Remove stored key and disable provider
  // -------------------------------------------------------------------------
  ipcMain.handle('credentials:delete', async (_, input: { provider: string }) => {
    try {
      // Validate provider
      const validatedProvider = ProviderIdSchema.parse(input.provider);

      await deleteCredential(validatedProvider as ProviderId);

      // Disable the provider
      disableProvider(validatedProvider as ProviderId);

      console.log(`[Credentials IPC] Deleted key and disabled ${validatedProvider}`);
      return { success: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { success: false, error: 'Invalid provider' };
      }
      console.error('[Credentials IPC] Delete error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // -------------------------------------------------------------------------
  // credentials:list - List providers with stored keys
  // -------------------------------------------------------------------------
  ipcMain.handle('credentials:list', async () => {
    try {
      const providers = await listCredentialProviders();
      return { success: true, providers };
    } catch (error) {
      console.error('[Credentials IPC] List error:', error);
      return {
        success: false,
        providers: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // -------------------------------------------------------------------------
  // credentials:info - Get credential metadata (without key)
  // -------------------------------------------------------------------------
  ipcMain.handle('credentials:info', async (_, input: { provider: string }) => {
    try {
      // Validate provider
      const validatedProvider = ProviderIdSchema.parse(input.provider);

      const info = await getCredentialInfo(validatedProvider as ProviderId);
      return { success: true, info };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { success: false, info: null, error: 'Invalid provider' };
      }
      console.error('[Credentials IPC] Info error:', error);
      return {
        success: false,
        info: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // -------------------------------------------------------------------------
  // credentials:encryptionAvailable - Check if encryption is available
  // -------------------------------------------------------------------------
  ipcMain.handle('credentials:encryptionAvailable', async () => {
    return { success: true, available: isEncryptionAvailable() };
  });

  // -------------------------------------------------------------------------
  // credentials:test - Test connection with stored credentials
  // -------------------------------------------------------------------------
  ipcMain.handle('credentials:test', async (_, input: { provider: string }) => {
    try {
      // Validate provider
      const validatedProvider = ProviderIdSchema.parse(input.provider);
      const providerId = validatedProvider as ProviderId;

      // Get stored credential
      const { retrieveCredential } = await import('../../services/credential-service');
      const apiKey = await retrieveCredential(providerId);

      if (!apiKey) {
        return {
          success: false,
          error: 'No API key stored for this provider',
        };
      }

      // Test connection
      const result = await testProviderConnection(providerId, apiKey);

      return {
        success: result.success,
        error: result.error,
        responseTimeMs: result.responseTimeMs,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { success: false, error: 'Invalid provider' };
      }
      console.error('[Credentials IPC] Test error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  console.log('[IPC] Credentials handlers registered');
}

// =============================================================================
// EXPORTS
// =============================================================================

export default registerCredentialHandlers;
