/**
 * Credential Service
 *
 * Secure storage for API keys using Electron's safeStorage.
 * Keys are encrypted at rest using OS-level encryption:
 * - macOS: Keychain
 * - Windows: DPAPI
 * - Linux: libsecret
 *
 * SECURITY: Keys are NEVER exposed to the renderer process.
 * Only the main process can retrieve decrypted keys.
 *
 * @version 1.0
 * @see docs/plans/litellm-integration-plan.md
 */

import { safeStorage } from 'electron';
import { getRawDatabase } from '../main/database';
import type Database from 'better-sqlite3';

// =============================================================================
// TYPES
// =============================================================================

export interface StoredCredential {
  provider: string;
  encryptedKey: string;
  createdAt: string;
  lastUsedAt: string;
}

export type CredentialProvider = 'anthropic' | 'openai' | 'google' | 'groq';

// =============================================================================
// DATABASE OPERATIONS
// =============================================================================

/**
 * Store an encrypted API key for a provider.
 * Overwrites existing key if provider already exists.
 */
export async function storeCredential(
  provider: CredentialProvider,
  apiKey: string
): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Encryption not available on this system. Cannot store API keys securely.'
    );
  }

  const db = getRawDatabase();
  const encrypted = safeStorage.encryptString(apiKey);
  const encryptedBase64 = encrypted.toString('base64');
  const now = new Date().toISOString();

  // Upsert: insert or update if exists
  const stmt = db.prepare(`
    INSERT INTO credentials (provider, encrypted_key, created_at, last_used_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      encrypted_key = excluded.encrypted_key,
      last_used_at = excluded.last_used_at
  `);

  stmt.run(provider, encryptedBase64, now, now);
  console.log(`[CredentialService] Stored encrypted key for ${provider}`);
}

/**
 * Retrieve and decrypt an API key for a provider.
 * Returns null if no key exists.
 *
 * WARNING: Only call from main process. Never expose to renderer.
 */
export async function retrieveCredential(
  provider: CredentialProvider
): Promise<string | null> {
  const db = getRawDatabase();

  const row = db
    .prepare('SELECT encrypted_key FROM credentials WHERE provider = ?')
    .get(provider) as { encrypted_key: string } | undefined;

  if (!row) {
    return null;
  }

  try {
    const buffer = Buffer.from(row.encrypted_key, 'base64');
    const decrypted = safeStorage.decryptString(buffer);

    // Update last_used_at
    db.prepare('UPDATE credentials SET last_used_at = ? WHERE provider = ?').run(
      new Date().toISOString(),
      provider
    );

    return decrypted;
  } catch (error) {
    console.error(`[CredentialService] Failed to decrypt key for ${provider}:`, error);
    return null;
  }
}

/**
 * Check if a credential exists for a provider.
 */
export async function hasCredential(provider: CredentialProvider): Promise<boolean> {
  const db = getRawDatabase();

  const row = db
    .prepare('SELECT 1 FROM credentials WHERE provider = ?')
    .get(provider);

  return !!row;
}

/**
 * Delete a credential for a provider.
 */
export async function deleteCredential(provider: CredentialProvider): Promise<void> {
  const db = getRawDatabase();

  db.prepare('DELETE FROM credentials WHERE provider = ?').run(provider);
  console.log(`[CredentialService] Deleted credential for ${provider}`);
}

/**
 * List all providers that have stored credentials.
 */
export async function listCredentialProviders(): Promise<CredentialProvider[]> {
  const db = getRawDatabase();

  const rows = db
    .prepare('SELECT provider FROM credentials ORDER BY provider')
    .all() as { provider: string }[];

  return rows.map((r) => r.provider as CredentialProvider);
}

/**
 * Get credential metadata (without the actual key).
 */
export async function getCredentialInfo(
  provider: CredentialProvider
): Promise<Omit<StoredCredential, 'encryptedKey'> | null> {
  const db = getRawDatabase();

  const row = db
    .prepare('SELECT provider, created_at, last_used_at FROM credentials WHERE provider = ?')
    .get(provider) as { provider: string; created_at: string; last_used_at: string } | undefined;

  if (!row) {
    return null;
  }

  return {
    provider: row.provider,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/**
 * Check if encryption is available on this system.
 */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

/**
 * Credential service singleton for convenient imports.
 */
export const CredentialService = {
  store: storeCredential,
  retrieve: retrieveCredential,
  has: hasCredential,
  delete: deleteCredential,
  list: listCredentialProviders,
  getInfo: getCredentialInfo,
  isEncryptionAvailable,
};

export default CredentialService;
