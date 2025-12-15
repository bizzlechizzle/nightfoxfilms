/**
 * Research Browser IPC Handlers
 * Handles research:* IPC channels for the external browser feature
 *
 * Uses the zero-detection detached browser service which launches
 * Ungoogled Chromium as an independent process with NO automation
 * framework connection (no puppeteer, no CDP, no navigator.webdriver).
 *
 * Channel naming follows CLAUDE.md convention: domain:action
 */
import { ipcMain } from 'electron';
import {
  launchDetachedBrowser,
  terminateDetachedBrowser,
  getDetachedBrowserStatus,
} from '../../services/detached-browser-service';
import {
  isExtensionConnected,
  navigateTo,
  openNewTab,
  getActiveTab,
  getAllTabs,
  captureScreenshot,
  pingExtension,
} from '../../services/browser-command-service';

/**
 * Register all Research Browser IPC handlers
 */
export function registerResearchBrowserHandlers(): void {
  // research:launch - Launch the Ungoogled Chromium browser (zero-detection)
  ipcMain.handle('research:launch', async () => {
    try {
      return await launchDetachedBrowser();
    } catch (error) {
      console.error('Error launching research browser:', error);
      return { success: false, error: String(error) };
    }
  });

  // research:close - Terminate the browser
  ipcMain.handle('research:close', async () => {
    try {
      await terminateDetachedBrowser();
      return { success: true };
    } catch (error) {
      console.error('Error closing research browser:', error);
      return { success: false, error: String(error) };
    }
  });

  // research:status - Get browser status including extension connection
  ipcMain.handle('research:status', async () => {
    try {
      const status = getDetachedBrowserStatus();
      return {
        running: status.running,
        pid: status.pid,
        extensionConnected: status.extensionConnected,
        activeTabUrl: status.activeTabUrl,
        activeTabTitle: status.activeTabTitle,
      };
    } catch (error) {
      console.error('Error getting research browser status:', error);
      return { running: false, extensionConnected: false };
    }
  });

  // ============================================================================
  // Browser Command Handlers - Send commands to browser via extension
  // ============================================================================

  // research:navigate - Navigate the active tab to a URL
  ipcMain.handle('research:navigate', async (_event, url: string) => {
    try {
      if (!isExtensionConnected()) {
        return { success: false, error: 'Extension not connected' };
      }
      const success = await navigateTo(url);
      return { success };
    } catch (error) {
      console.error('Error navigating:', error);
      return { success: false, error: String(error) };
    }
  });

  // research:newTab - Open a new tab with optional URL
  ipcMain.handle('research:newTab', async (_event, url?: string) => {
    try {
      if (!isExtensionConnected()) {
        return { success: false, error: 'Extension not connected' };
      }
      return await openNewTab(url);
    } catch (error) {
      console.error('Error opening new tab:', error);
      return { success: false, error: String(error) };
    }
  });

  // research:getActiveTab - Get info about the active tab
  ipcMain.handle('research:getActiveTab', async () => {
    try {
      if (!isExtensionConnected()) {
        return { success: false, error: 'Extension not connected' };
      }
      const tab = await getActiveTab();
      return { success: true, tab };
    } catch (error) {
      console.error('Error getting active tab:', error);
      return { success: false, error: String(error) };
    }
  });

  // research:getTabs - Get all open tabs
  ipcMain.handle('research:getTabs', async () => {
    try {
      if (!isExtensionConnected()) {
        return { success: false, error: 'Extension not connected' };
      }
      const tabs = await getAllTabs();
      return { success: true, tabs };
    } catch (error) {
      console.error('Error getting tabs:', error);
      return { success: false, error: String(error) };
    }
  });

  // research:screenshot - Capture screenshot of active tab
  ipcMain.handle('research:screenshot', async () => {
    try {
      if (!isExtensionConnected()) {
        return { success: false, error: 'Extension not connected' };
      }
      const dataUrl = await captureScreenshot();
      return { success: !!dataUrl, dataUrl };
    } catch (error) {
      console.error('Error capturing screenshot:', error);
      return { success: false, error: String(error) };
    }
  });

  // research:ping - Check if extension is responsive
  ipcMain.handle('research:ping', async () => {
    try {
      const connected = await pingExtension();
      return { success: true, connected };
    } catch (error) {
      return { success: false, connected: false };
    }
  });
}
