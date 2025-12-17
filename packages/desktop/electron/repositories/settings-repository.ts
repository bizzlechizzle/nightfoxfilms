/**
 * Settings Repository
 *
 * Key-value store for application settings.
 */

import { getDatabase } from '../main/database';
import type { Setting } from '@nightfox/core';

export class SettingsRepository {
  /**
   * Get a setting by key
   */
  get(key: string): string | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string | null } | undefined;
    return row?.value ?? null;
  }

  /**
   * Get all settings
   */
  getAll(): Record<string, string | null> {
    const db = getDatabase();
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string | null;
    }>;

    const settings: Record<string, string | null> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  }

  /**
   * Set a setting value
   */
  set(key: string, value: string | null): void {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    ).run(key, value);
  }

  /**
   * Delete a setting
   */
  delete(key: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    return result.changes > 0;
  }

  /**
   * Get storage path setting
   */
  getStoragePath(): string | null {
    return this.get('storage_path');
  }

  /**
   * Set storage path setting
   */
  setStoragePath(path: string): void {
    this.set('storage_path', path);
  }

  /**
   * Get LiteLLM configuration
   */
  getLiteLLMConfig(): { url: string; modelVlm: string; modelLlm: string } {
    return {
      url: this.get('litellm_url') || 'http://localhost:4000',
      modelVlm: this.get('litellm_model_vlm') || 'local-vlm',
      modelLlm: this.get('litellm_model_llm') || 'local-llm',
    };
  }

}

export const settingsRepository = new SettingsRepository();
