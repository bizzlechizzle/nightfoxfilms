/**
 * Browser Image Capture Service
 *
 * Integrates with Electron's webContents to provide:
 * - Context menu "Find Original Image" functionality
 * - Network request monitoring for dynamically loaded images
 * - XHR/Fetch image interception
 *
 * All operations are offline-first per CLAUDE.md specs.
 *
 * @module services/image-downloader/browser-image-capture
 */

import { BrowserWindow, Menu, MenuItem, session, WebContents, ipcMain } from 'electron';
import { getLogger } from '../logger-service';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface CapturedImage {
  url: string;
  sourceUrl: string; // Page URL where image was found
  captureType: 'context_menu' | 'network' | 'xhr' | 'page_scan';
  timestamp: number;
  contentType?: string;
  contentLength?: number;
  fromCache?: boolean;
  referrer?: string;
}

export interface NetworkImageFilter {
  minSize?: number; // Minimum content-length in bytes
  allowedTypes?: string[]; // MIME types to capture
  excludePatterns?: RegExp[]; // URL patterns to exclude
  includePatterns?: RegExp[]; // URL patterns to include (if set, only these)
}

export interface ContextMenuOptions {
  findOriginalLabel?: string;
  analyzeQualityLabel?: string;
  saveToArchiveLabel?: string;
}

// Default filter settings
const DEFAULT_FILTER: NetworkImageFilter = {
  minSize: 5000, // Ignore tiny images (icons, spacers)
  allowedTypes: [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/avif',
    'image/tiff',
    'image/bmp',
  ],
  excludePatterns: [
    /favicon/i,
    /icon/i,
    /logo.*\d{2,}/i, // logo32, logo64, etc.
    /sprite/i,
    /tracking/i,
    /pixel\.gif/i,
    /spacer/i,
    /blank\.gif/i,
    /1x1/i,
    /beacon/i,
    /analytics/i,
  ],
};

// ============================================================================
// Network Request Monitor
// ============================================================================

/**
 * Monitors network requests for image loading
 * Captures URLs of images loaded via <img>, CSS, XHR, etc.
 */
export class NetworkImageMonitor {
  private capturedImages: Map<string, CapturedImage> = new Map();
  private filter: NetworkImageFilter;
  private isMonitoring = false;
  private sessionPartition?: string;

  constructor(filter: NetworkImageFilter = DEFAULT_FILTER) {
    this.filter = { ...DEFAULT_FILTER, ...filter };
  }

  /**
   * Start monitoring network requests for images
   */
  start(sessionPartition?: string): void {
    if (this.isMonitoring) return;

    this.sessionPartition = sessionPartition;
    const ses = sessionPartition
      ? session.fromPartition(sessionPartition)
      : session.defaultSession;

    // Monitor completed requests
    ses.webRequest.onCompleted(
      {
        urls: ['<all_urls>'],
        types: ['image', 'media', 'xhr'],
      },
      (details) => {
        this.handleCompletedRequest(details);
      }
    );

    // Monitor response headers for content info
    ses.webRequest.onHeadersReceived(
      {
        urls: ['<all_urls>'],
        types: ['image', 'media', 'xhr'],
      },
      (details, callback) => {
        this.handleHeaders(details);
        callback({ cancel: false });
      }
    );

    this.isMonitoring = true;
    logger.info('NetworkImageMonitor', 'Started monitoring network requests');
  }

  /**
   * Stop monitoring network requests
   */
  stop(): void {
    if (!this.isMonitoring) return;

    const ses = this.sessionPartition
      ? session.fromPartition(this.sessionPartition)
      : session.defaultSession;

    // Remove listeners by passing null
    ses.webRequest.onCompleted(null);
    ses.webRequest.onHeadersReceived(null);

    this.isMonitoring = false;
    logger.info('NetworkImageMonitor', 'Stopped monitoring network requests');
  }

  /**
   * Get all captured images
   */
  getCapturedImages(): CapturedImage[] {
    return Array.from(this.capturedImages.values());
  }

  /**
   * Get captured images for a specific page
   */
  getImagesForPage(pageUrl: string): CapturedImage[] {
    return Array.from(this.capturedImages.values()).filter(
      (img) => img.sourceUrl === pageUrl || img.referrer === pageUrl
    );
  }

  /**
   * Clear captured images
   */
  clear(): void {
    this.capturedImages.clear();
  }

  /**
   * Clear images older than specified age
   */
  clearOld(maxAgeMs: number = 3600000): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleared = 0;

    for (const [url, image] of this.capturedImages.entries()) {
      if (image.timestamp < cutoff) {
        this.capturedImages.delete(url);
        cleared++;
      }
    }

    return cleared;
  }

  private handleCompletedRequest(
    details: Electron.OnCompletedListenerDetails
  ): void {
    // Only process successful requests
    if (details.statusCode < 200 || details.statusCode >= 400) return;

    // Check if it's an image by content type or URL
    const contentType = this.getHeader(details.responseHeaders, 'content-type');
    const isImage = this.isImageRequest(details.url, contentType);

    if (!isImage) return;

    // Apply filters
    if (!this.passesFilter(details.url, contentType, details)) return;

    // Determine capture type
    // Note: In Electron, fetch requests appear as 'xhr' type
    let captureType: CapturedImage['captureType'] = 'network';
    if (details.resourceType === 'xhr') {
      captureType = 'xhr';
    }

    const contentLength = parseInt(
      this.getHeader(details.responseHeaders, 'content-length') || '0',
      10
    );

    const captured: CapturedImage = {
      url: details.url,
      sourceUrl: details.referrer || details.url,
      captureType,
      timestamp: Date.now(),
      contentType: contentType || undefined,
      contentLength: contentLength || undefined,
      fromCache: details.fromCache,
      referrer: details.referrer,
    };

    this.capturedImages.set(details.url, captured);

    logger.debug('NetworkImageMonitor', 'Captured image', {
      url: details.url.substring(0, 100),
      type: captureType,
      size: contentLength,
    });
  }

  private handleHeaders(
    details: Electron.OnHeadersReceivedListenerDetails
  ): void {
    // Pre-capture headers for size filtering before completion
    // This allows early rejection of small images
  }

  private isImageRequest(url: string, contentType?: string): boolean {
    // Check content type first
    if (contentType) {
      const type = contentType.toLowerCase();
      if (type.startsWith('image/')) return true;
    }

    // Fallback to URL extension
    const urlLower = url.toLowerCase();
    const imageExtensions = [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.webp',
      '.avif',
      '.tiff',
      '.tif',
      '.bmp',
      '.svg',
    ];

    for (const ext of imageExtensions) {
      if (urlLower.includes(ext)) return true;
    }

    return false;
  }

  private passesFilter(
    url: string,
    contentType: string | undefined,
    details: Electron.OnCompletedListenerDetails
  ): boolean {
    // Check content type
    if (this.filter.allowedTypes && contentType) {
      const type = contentType.toLowerCase().split(';')[0].trim();
      if (!this.filter.allowedTypes.includes(type)) return false;
    }

    // Check size
    if (this.filter.minSize) {
      const contentLength = parseInt(
        this.getHeader(details.responseHeaders, 'content-length') || '0',
        10
      );
      if (contentLength > 0 && contentLength < this.filter.minSize) return false;
    }

    // Check exclude patterns
    if (this.filter.excludePatterns) {
      for (const pattern of this.filter.excludePatterns) {
        if (pattern.test(url)) return false;
      }
    }

    // Check include patterns (if set, URL must match at least one)
    if (this.filter.includePatterns && this.filter.includePatterns.length > 0) {
      let matches = false;
      for (const pattern of this.filter.includePatterns) {
        if (pattern.test(url)) {
          matches = true;
          break;
        }
      }
      if (!matches) return false;
    }

    return true;
  }

  private getHeader(
    headers: Record<string, string[]> | undefined,
    name: string
  ): string | undefined {
    if (!headers) return undefined;

    // Headers can be case-insensitive
    const lowerName = name.toLowerCase();
    for (const [key, values] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerName && values.length > 0) {
        return values[0];
      }
    }
    return undefined;
  }
}

// ============================================================================
// Context Menu Integration
// ============================================================================

/**
 * Adds "Find Original Image" and related options to context menu
 */
export class ImageContextMenu {
  private options: ContextMenuOptions;

  constructor(options: ContextMenuOptions = {}) {
    this.options = {
      findOriginalLabel: options.findOriginalLabel || 'Find Original Image',
      analyzeQualityLabel: options.analyzeQualityLabel || 'Analyze Image Quality',
      saveToArchiveLabel: options.saveToArchiveLabel || 'Save to Archive',
    };
  }

  /**
   * Setup context menu for a BrowserWindow
   */
  setupForWindow(window: BrowserWindow): void {
    window.webContents.on('context-menu', (event, params) => {
      this.handleContextMenu(window.webContents, params);
    });

    logger.info('ImageContextMenu', 'Context menu setup for window', {
      windowId: window.id,
    });
  }

  /**
   * Setup context menu for any webContents (including webviews)
   */
  setupForWebContents(webContents: WebContents): void {
    webContents.on('context-menu', (event, params) => {
      this.handleContextMenu(webContents, params);
    });
  }

  private handleContextMenu(
    webContents: WebContents,
    params: Electron.ContextMenuParams
  ): void {
    // Only show custom menu if right-clicking on an image
    if (params.mediaType !== 'image' || !params.srcURL) {
      return; // Let default menu handle non-image contexts
    }

    const menu = new Menu();

    // Find Original Image
    menu.append(
      new MenuItem({
        label: this.options.findOriginalLabel!,
        click: () => {
          this.handleFindOriginal(webContents, params.srcURL, params.pageURL);
        },
      })
    );

    // Analyze Image Quality
    menu.append(
      new MenuItem({
        label: this.options.analyzeQualityLabel!,
        click: () => {
          this.handleAnalyzeQuality(webContents, params.srcURL);
        },
      })
    );

    // Separator
    menu.append(new MenuItem({ type: 'separator' }));

    // Save to Archive
    menu.append(
      new MenuItem({
        label: this.options.saveToArchiveLabel!,
        click: () => {
          this.handleSaveToArchive(webContents, params.srcURL, params.pageURL);
        },
      })
    );

    // Separator
    menu.append(new MenuItem({ type: 'separator' }));

    // Standard image options
    menu.append(
      new MenuItem({
        label: 'Copy Image URL',
        click: () => {
          const { clipboard } = require('electron');
          clipboard.writeText(params.srcURL);
        },
      })
    );

    menu.append(
      new MenuItem({
        label: 'Open Image in New Tab',
        click: () => {
          const { shell } = require('electron');
          shell.openExternal(params.srcURL);
        },
      })
    );

    menu.popup({ window: BrowserWindow.fromWebContents(webContents) || undefined });
  }

  private handleFindOriginal(
    webContents: WebContents,
    imageUrl: string,
    pageUrl: string
  ): void {
    // Emit event for IPC handler to process
    webContents.send('image-capture:findOriginal', {
      imageUrl,
      pageUrl,
      timestamp: Date.now(),
    });

    logger.info('ImageContextMenu', 'Find original requested', {
      imageUrl: imageUrl.substring(0, 100),
    });
  }

  private handleAnalyzeQuality(webContents: WebContents, imageUrl: string): void {
    webContents.send('image-capture:analyzeQuality', {
      imageUrl,
      timestamp: Date.now(),
    });

    logger.info('ImageContextMenu', 'Analyze quality requested', {
      imageUrl: imageUrl.substring(0, 100),
    });
  }

  private handleSaveToArchive(
    webContents: WebContents,
    imageUrl: string,
    pageUrl: string
  ): void {
    webContents.send('image-capture:saveToArchive', {
      imageUrl,
      pageUrl,
      timestamp: Date.now(),
    });

    logger.info('ImageContextMenu', 'Save to archive requested', {
      imageUrl: imageUrl.substring(0, 100),
    });
  }
}

// ============================================================================
// Page Image Scanner
// ============================================================================

/**
 * Scans a page's DOM for all images using webContents.executeJavaScript
 */
export async function scanPageForImages(
  webContents: WebContents
): Promise<Array<{
  src: string;
  srcset?: string;
  alt?: string;
  width?: number;
  height?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  loading?: string;
  dataSrc?: string;
}>> {
  try {
    const script = `
      (function() {
        const images = [];

        // Get all <img> elements
        document.querySelectorAll('img').forEach(img => {
          images.push({
            src: img.src || '',
            srcset: img.srcset || '',
            alt: img.alt || '',
            width: img.width || 0,
            height: img.height || 0,
            naturalWidth: img.naturalWidth || 0,
            naturalHeight: img.naturalHeight || 0,
            loading: img.loading || '',
            dataSrc: img.dataset.src || img.dataset.original || img.dataset.lazySrc || '',
          });
        });

        // Get background images
        document.querySelectorAll('[style*="background"]').forEach(el => {
          const style = window.getComputedStyle(el);
          const bgImage = style.backgroundImage;
          if (bgImage && bgImage !== 'none') {
            const match = bgImage.match(/url\\(["']?([^"')]+)["']?\\)/);
            if (match && match[1]) {
              images.push({
                src: match[1],
                alt: 'Background image',
                width: el.offsetWidth || 0,
                height: el.offsetHeight || 0,
              });
            }
          }
        });

        // Get <picture> source elements
        document.querySelectorAll('picture source').forEach(source => {
          if (source.srcset) {
            images.push({
              src: source.srcset.split(',')[0].trim().split(' ')[0],
              srcset: source.srcset,
              alt: 'Picture source',
            });
          }
        });

        // Get meta og:image and twitter:image
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage && ogImage.content) {
          images.push({
            src: ogImage.content,
            alt: 'OpenGraph image',
          });
        }

        const twitterImage = document.querySelector('meta[name="twitter:image"]');
        if (twitterImage && twitterImage.content) {
          images.push({
            src: twitterImage.content,
            alt: 'Twitter image',
          });
        }

        return images;
      })();
    `;

    const result = await webContents.executeJavaScript(script);
    return result || [];
  } catch (error) {
    logger.error('BrowserImageCapture', 'Failed to scan page for images', error as Error);
    return [];
  }
}

// ============================================================================
// IPC Event Registration
// ============================================================================

/**
 * Register IPC handlers for browser image capture
 */
export function registerBrowserImageCaptureHandlers(): void {
  // Handler for getting network-captured images
  ipcMain.handle('browser:getCapturedImages', async (_event, pageUrl?: string) => {
    const monitor = getGlobalMonitor();
    if (!monitor) {
      return { success: false, error: 'Network monitor not initialized' };
    }

    const images = pageUrl
      ? monitor.getImagesForPage(pageUrl)
      : monitor.getCapturedImages();

    return {
      success: true,
      images,
      count: images.length,
    };
  });

  // Handler for scanning current page
  ipcMain.handle('browser:scanPageImages', async (event) => {
    try {
      const webContents = event.sender;
      const images = await scanPageForImages(webContents);

      return {
        success: true,
        images,
        count: images.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Handler for clearing captured images
  ipcMain.handle('browser:clearCapturedImages', async (_event, maxAgeMs?: number) => {
    const monitor = getGlobalMonitor();
    if (!monitor) {
      return { success: false, error: 'Network monitor not initialized' };
    }

    if (maxAgeMs) {
      const cleared = monitor.clearOld(maxAgeMs);
      return { success: true, cleared };
    } else {
      monitor.clear();
      return { success: true, cleared: 'all' };
    }
  });

  logger.info('BrowserImageCapture', 'IPC handlers registered');
}

// ============================================================================
// Global Instance Management
// ============================================================================

let globalMonitor: NetworkImageMonitor | null = null;
let globalContextMenu: ImageContextMenu | null = null;

/**
 * Initialize global browser image capture services
 */
export function initializeBrowserImageCapture(options?: {
  filter?: NetworkImageFilter;
  contextMenuOptions?: ContextMenuOptions;
  sessionPartition?: string;
}): void {
  // Create network monitor
  globalMonitor = new NetworkImageMonitor(options?.filter);
  globalMonitor.start(options?.sessionPartition);

  // Create context menu handler
  globalContextMenu = new ImageContextMenu(options?.contextMenuOptions);

  // Register IPC handlers
  registerBrowserImageCaptureHandlers();

  logger.info('BrowserImageCapture', 'Initialized browser image capture');
}

/**
 * Cleanup browser image capture services
 */
export function cleanupBrowserImageCapture(): void {
  if (globalMonitor) {
    globalMonitor.stop();
    globalMonitor = null;
  }

  globalContextMenu = null;

  logger.info('BrowserImageCapture', 'Cleaned up browser image capture');
}

/**
 * Get global network monitor instance
 */
export function getGlobalMonitor(): NetworkImageMonitor | null {
  return globalMonitor;
}

/**
 * Get global context menu instance
 */
export function getGlobalContextMenu(): ImageContextMenu | null {
  return globalContextMenu;
}

/**
 * Setup context menu for a window
 */
export function setupContextMenuForWindow(window: BrowserWindow): void {
  if (!globalContextMenu) {
    globalContextMenu = new ImageContextMenu();
  }
  globalContextMenu.setupForWindow(window);
}
