/**
 * Shell and Dialog IPC Handlers
 * Handles shell:* and dialog:* IPC channels
 */
import { ipcMain, shell, dialog } from 'electron';
import { z } from 'zod';

export function registerShellHandlers() {
  ipcMain.handle('shell:openExternal', async (_event, url: unknown) => {
    try {
      const validatedUrl = z.string().url().parse(url);
      // Security: Only allow http, https, and mailto protocols
      if (!validatedUrl.match(/^(https?|mailto):/)) {
        throw new Error('Only http, https, and mailto URLs are allowed');
      }
      await shell.openExternal(validatedUrl);
    } catch (error) {
      console.error('Error opening external URL:', error);
      if (error instanceof z.ZodError) {
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });
}

export function registerDialogHandlers() {
  ipcMain.handle('dialog:selectFolder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Archive Folder',
        buttonLabel: 'Select Folder',
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return result.filePaths[0];
    } catch (error) {
      console.error('Error selecting folder:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });
}
