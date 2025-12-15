/**
 * Ollama Lifecycle IPC Handlers
 *
 * Exposes Ollama lifecycle management to the renderer process.
 * Used for status monitoring and manual control (admin).
 *
 * @see docs/plans/OPT-125-ollama-lifecycle-service.md
 */

import { ipcMain } from 'electron';
import {
  getOllamaLifecycleStatus,
  ensureOllamaRunning,
  stopOllama,
  isOllamaInstalled,
  findOllamaBinary,
} from '../../services/ollama-lifecycle-service';

/**
 * Register Ollama lifecycle IPC handlers.
 */
export function registerOllamaLifecycleHandlers(): void {
  /**
   * Get current Ollama lifecycle status.
   * @returns OllamaLifecycleStatus
   */
  ipcMain.handle('ollama:getStatus', async () => {
    try {
      return await getOllamaLifecycleStatus();
    } catch (error) {
      console.error('[OllamaLifecycle IPC] Error getting status:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });

  /**
   * Ensure Ollama is running (starts if needed).
   * @returns { success: boolean; error?: string }
   */
  ipcMain.handle('ollama:ensureRunning', async () => {
    try {
      const success = await ensureOllamaRunning();
      return { success };
    } catch (error) {
      console.error('[OllamaLifecycle IPC] Error ensuring running:', error);
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  /**
   * Stop Ollama (only if we started it).
   * Admin operation - typically not needed.
   */
  ipcMain.handle('ollama:stop', async () => {
    try {
      stopOllama();
      return { success: true };
    } catch (error) {
      console.error('[OllamaLifecycle IPC] Error stopping:', error);
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  /**
   * Check if Ollama is installed on this system.
   * @returns { installed: boolean; path?: string }
   */
  ipcMain.handle('ollama:checkInstalled', async () => {
    try {
      const path = findOllamaBinary();
      return {
        installed: path !== null,
        path: path || undefined,
      };
    } catch (error) {
      console.error('[OllamaLifecycle IPC] Error checking installed:', error);
      return { installed: false };
    }
  });

  console.log('[IPC] Ollama lifecycle handlers registered');
}
