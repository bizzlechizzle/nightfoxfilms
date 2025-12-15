import { BrowserView, BrowserWindow, ipcMain, shell, session } from 'electron';

/**
 * BrowserViewManager - Manages an embedded browser view for the application.
 * Per spec page_web-browser.md: embedded browser with right side toolbar
 */
export class BrowserViewManager {
  private browserView: BrowserView | null = null;
  private mainWindow: BrowserWindow;
  private isInitialized = false;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  initialize(): void {
    if (this.isInitialized) return;
    this.setupIpcHandlers();
    this.isInitialized = true;
  }

  private setupIpcHandlers(): void {
    ipcMain.handle('browser:navigate', async (_event, url: string) => {
      try {
        if (!this.browserView) {
          this.createBrowserView();
        }
        // Validate URL
        const validatedUrl = this.validateUrl(url);
        if (!validatedUrl) {
          return { success: false, error: 'Invalid URL' };
        }
        await this.browserView!.webContents.loadURL(validatedUrl);
        return { success: true };
      } catch (error) {
        console.error('Browser navigate error:', error);
        return { success: false, error: String(error) };
      }
    });

    ipcMain.handle('browser:show', async (_event, bounds: { x: number; y: number; width: number; height: number }) => {
      try {
        if (!this.browserView) {
          this.createBrowserView();
        }
        // Apply bounds with validation
        const validBounds = {
          x: Math.max(0, Math.round(bounds.x)),
          y: Math.max(0, Math.round(bounds.y)),
          width: Math.max(100, Math.round(bounds.width)),
          height: Math.max(100, Math.round(bounds.height)),
        };
        this.browserView!.setBounds(validBounds);

        // Add to window if not already added
        const views = this.mainWindow.getBrowserViews();
        if (!views.includes(this.browserView!)) {
          this.mainWindow.addBrowserView(this.browserView!);
        }
        return { success: true };
      } catch (error) {
        console.error('Browser show error:', error);
        return { success: false, error: String(error) };
      }
    });

    ipcMain.handle('browser:hide', async () => {
      try {
        if (this.browserView) {
          this.mainWindow.removeBrowserView(this.browserView);
        }
        return { success: true };
      } catch (error) {
        console.error('Browser hide error:', error);
        return { success: false, error: String(error) };
      }
    });

    ipcMain.handle('browser:getUrl', async () => {
      return this.browserView?.webContents.getURL() || '';
    });

    ipcMain.handle('browser:getTitle', async () => {
      return this.browserView?.webContents.getTitle() || '';
    });

    ipcMain.handle('browser:goBack', async () => {
      if (this.browserView?.webContents.canGoBack()) {
        this.browserView.webContents.goBack();
        return true;
      }
      return false;
    });

    ipcMain.handle('browser:goForward', async () => {
      if (this.browserView?.webContents.canGoForward()) {
        this.browserView.webContents.goForward();
        return true;
      }
      return false;
    });

    ipcMain.handle('browser:reload', async () => {
      this.browserView?.webContents.reload();
    });

    ipcMain.handle('browser:captureScreenshot', async () => {
      if (!this.browserView) return null;
      try {
        const image = await this.browserView.webContents.capturePage();
        return image.toDataURL();
      } catch (error) {
        console.error('Screenshot capture error:', error);
        return null;
      }
    });
  }

  private validateUrl(url: string): string | null {
    try {
      // Add protocol if missing
      let validatedUrl = url.trim();
      if (!validatedUrl.startsWith('http://') && !validatedUrl.startsWith('https://')) {
        validatedUrl = 'https://' + validatedUrl;
      }
      // Validate URL format
      const parsed = new URL(validatedUrl);
      // Only allow http and https protocols
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      return validatedUrl;
    } catch {
      return null;
    }
  }

  private createBrowserView(): void {
    // Use isolated session partition to prevent conflicts with main window
    const browserPartition = 'persist:browser';

    this.browserView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Disable features that could be security risks
        webviewTag: false,
        allowRunningInsecureContent: false,
        // Isolated session prevents cookie/state conflicts with main app
        partition: browserPartition,
      },
    });

    // FIX: Set user agent to current Chrome on macOS
    // Cloudflare and other services check User-Agent for bot detection
    const chromeUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    this.browserView.webContents.setUserAgent(chromeUserAgent);

    // FIX: Add Client Hints and Accept headers to mimic real Chrome browser
    // Cloudflare's bot detection checks for these headers
    const browserSession = session.fromPartition(browserPartition);
    browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = details.requestHeaders;
      // Client Hints - Modern Chrome sends these
      headers['sec-ch-ua'] = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
      headers['sec-ch-ua-mobile'] = '?0';
      headers['sec-ch-ua-platform'] = '"macOS"';
      // Standard Accept headers
      if (!headers['Accept-Language']) {
        headers['Accept-Language'] = 'en-US,en;q=0.9';
      }
      if (!headers['Accept']) {
        headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
      }
      callback({ requestHeaders: headers });
    });

    // Forward navigation events to renderer
    this.browserView.webContents.on('did-navigate', (_event, url) => {
      this.mainWindow.webContents.send('browser:navigated', url);
    });

    this.browserView.webContents.on('did-navigate-in-page', (_event, url) => {
      this.mainWindow.webContents.send('browser:navigated', url);
    });

    this.browserView.webContents.on('page-title-updated', (_event, title) => {
      this.mainWindow.webContents.send('browser:titleChanged', title);
    });

    this.browserView.webContents.on('did-start-loading', () => {
      this.mainWindow.webContents.send('browser:loadingChanged', true);
    });

    this.browserView.webContents.on('did-stop-loading', () => {
      this.mainWindow.webContents.send('browser:loadingChanged', false);
    });

    // Handle new window requests - open in default browser instead
    // SECURITY: Validate URL before opening externally
    this.browserView.webContents.setWindowOpenHandler(({ url }) => {
      const validatedUrl = this.validateUrl(url);
      if (validatedUrl) {
        shell.openExternal(validatedUrl);
      } else {
        console.warn('Blocked opening invalid URL:', url);
      }
      return { action: 'deny' };
    });
  }

  destroy(): void {
    if (this.browserView) {
      this.mainWindow.removeBrowserView(this.browserView);
      // Destroy the webContents
      if (!this.browserView.webContents.isDestroyed()) {
        this.browserView.webContents.close();
      }
      this.browserView = null;
    }
  }
}

let browserViewManager: BrowserViewManager | null = null;

export function initBrowserViewManager(mainWindow: BrowserWindow): BrowserViewManager {
  if (!browserViewManager) {
    browserViewManager = new BrowserViewManager(mainWindow);
    browserViewManager.initialize();
  }
  return browserViewManager;
}

export function getBrowserViewManager(): BrowserViewManager | null {
  return browserViewManager;
}

export function destroyBrowserViewManager(): void {
  if (browserViewManager) {
    browserViewManager.destroy();
    browserViewManager = null;
  }
}
