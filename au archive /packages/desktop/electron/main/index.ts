import { app, BrowserWindow, dialog, session, protocol, net } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDatabase, closeDatabase } from './database';
import { registerIpcHandlers } from './ipc-handlers';
import { getHealthMonitor } from '../services/health-monitor';
import { getRecoverySystem } from '../services/recovery-system';
import { getConfigService } from '../services/config-service';
import { getLogger } from '../services/logger-service';
// OPT-037: Import integrity checker for GPS/address gap repair
import { getIntegrityChecker } from '../services/integrity-checker';
import { getBackupScheduler } from '../services/backup-scheduler';
import { initBrowserViewManager, destroyBrowserViewManager } from '../services/browser-view-manager';
import { startBookmarkAPIServer, stopBookmarkAPIServer } from '../services/bookmark-api-server';
import { startWebSocketServer, stopWebSocketServer } from '../services/websocket-server';
import { terminateDetachedBrowser } from '../services/detached-browser-service';
import { getDatabaseArchiveService } from '../services/database-archive-service';
import { stopOllama } from '../services/ollama-lifecycle-service';
import { stopLiteLLM } from '../services/litellm-lifecycle-service';
import { getPreprocessingService } from '../services/extraction/preprocessing-service';
import { SQLiteWebSourcesRepository } from '../repositories/sqlite-websources-repository';
import { SQLiteLocationRepository } from '../repositories/sqlite-location-repository';
import { SQLiteSubLocationRepository } from '../repositories/sqlite-sublocation-repository';

/**
 * OPT-045: GPU mitigation flags for macOS Leaflet/map rendering
 * Addresses Chromium Skia overlay mailbox errors that cause beachball freezes
 * These errors appear as:
 *   [ERROR:shared_image_manager.cc] ProduceOverlay: non-existent mailbox
 *   [ERROR:skia_output_device_buffer_queue.cc] Invalid mailbox
 *
 * Disabling problematic GPU features improves Atlas map rendering stability
 */
if (process.platform === 'darwin') {
  // Disable CanvasOopRasterization which can cause overlay issues with Leaflet
  app.commandLine.appendSwitch('disable-features', 'CanvasOopRasterization');
  // Use software rendering for 2D canvas (Leaflet relies on canvas)
  app.commandLine.appendSwitch('disable-accelerated-2d-canvas');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';

// Register custom protocol for serving media files securely
// This allows the renderer to load local files without file:// restrictions
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  },
]);

// Crash handlers - log errors before exiting
// OPT-080: Enhanced error logging for structured clone debugging
process.on('uncaughtException', (error: Error) => {
  console.error('=== UNCAUGHT EXCEPTION ===');
  console.error('Message:', error.message);
  console.error('Name:', error.name);
  console.error('Stack:', error.stack);
  try {
    console.error('Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
  } catch (e) {
    console.error('Could not stringify error:', e);
  }

  try {
    getLogger().error('Main', 'Uncaught exception', error);
  } catch {
    // Logger might not be initialized yet
  }

  dialog.showErrorBox(
    'Application Error',
    `An unexpected error occurred:\n\n${error.message}\n\nThe application will now exit.`
  );

  app.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('=== UNHANDLED REJECTION ===');
  console.error('Reason:', reason);
  if (reason instanceof Error) {
    console.error('Message:', reason.message);
    console.error('Name:', reason.name);
    console.error('Stack:', reason.stack);
    try {
      console.error('Full error:', JSON.stringify(reason, Object.getOwnPropertyNames(reason), 2));
    } catch (e) {
      console.error('Could not stringify error:', e);
    }
  }

  const error = reason instanceof Error ? reason : new Error(String(reason));
  try {
    getLogger().error('Main', 'Unhandled promise rejection', error);
  } catch {
    // Logger might not be initialized yet
  }

  dialog.showErrorBox(
    'Application Error',
    `An unexpected error occurred:\n\n${error.message}\n\nThe application will now exit.`
  );

  app.exit(1);
});

let mainWindow: BrowserWindow | null = null;

/**
 * FIX 5.4: Send event to renderer process
 * Used for backup notifications and other main->renderer communication
 */
export function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

// Single instance lock - prevent multiple instances of the app
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  console.log('Another instance is already running. Exiting...');
  app.quit();
} else {
  // Handle second instance attempt - focus existing window
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'AU Archive',
    // macOS: Hide title bar, show traffic lights inline with content
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 12 },
    webPreferences: {
      // CRITICAL: Use .cjs extension for preload script
      // This ensures Node.js treats it as CommonJS regardless of "type": "module" in package.json
      preload: path.join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      // Sandbox disabled to allow preload's webUtils.getPathForFile() to work with drag-drop files.
      // This is acceptable for a trusted desktop app that doesn't load external content.
      sandbox: false,
      webviewTag: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // SECURITY: Set Content Security Policy for production
  // Allows map tile providers (ESRI, OSM, OpenTopo, Carto) and Nominatim geocoding
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob: https://server.arcgisonline.com https://*.tile.openstreetmap.org https://*.tile.opentopomap.org https://*.basemaps.cartocdn.com; " +
            "font-src 'self'; " +
            "connect-src 'self' https://server.arcgisonline.com https://*.tile.openstreetmap.org https://*.tile.opentopomap.org https://*.basemaps.cartocdn.com https://nominatim.openstreetmap.org; " +
            "frame-ancestors 'none';"
          ],
        },
      });
    });
  }

  // SECURITY: Handle permission requests - deny all by default except essential ones
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['clipboard-read', 'clipboard-sanitized-write'];
    const isAllowed = allowedPermissions.includes(permission);

    if (!isAllowed) {
      console.log(`Permission denied: ${permission}`);
    }

    callback(isAllowed);
  });

  // SECURITY: Block navigation to external URLs from main window
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const validOrigins = isDev
      ? ['http://localhost:5173', 'file://']
      : ['file://'];

    const isValid = validOrigins.some(origin => url.startsWith(origin));

    if (!isValid) {
      console.warn('Blocked navigation to:', url);
      event.preventDefault();
    }
  });

  // SECURITY: Block new window creation from main window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.warn('Blocked new window from main:', url);
    return { action: 'deny' };
  });
}

/**
 * Startup Orchestrator
 * Sequential initialization with proper error handling
 */
async function startupOrchestrator(): Promise<void> {
  const startTime = Date.now();
  const logger = getLogger();
  logger.info('Main', 'Starting application initialization');

  try {
    // Step 1: Load configuration
    logger.info('Main', 'Step 1/5: Loading configuration');
    const configService = getConfigService();
    await configService.load();
    logger.info('Main', 'Configuration loaded successfully');

    // Step 2: Initialize database
    logger.info('Main', 'Step 2/5: Initializing database');
    getDatabase();
    logger.info('Main', 'Database initialized successfully');

    // Step 3: Initialize health monitoring
    logger.info('Main', 'Step 3/5: Initializing health monitoring');
    const healthMonitor = getHealthMonitor();
    await healthMonitor.initialize();
    logger.info('Main', 'Health monitoring initialized successfully');

    // Step 4: Check database health and recover if needed
    logger.info('Main', 'Step 4/5: Checking database health');
    const recoverySystem = getRecoverySystem();
    const recoveryResult = await recoverySystem.checkAndRecover();

    if (recoveryResult) {
      logger.info('Main', 'Recovery performed', { action: recoveryResult.action });
      if (!recoveryResult.success) {
        logger.error('Main', 'Recovery failed, application may not function correctly');
        // Note: showRecoveryDialog doesn't exist, recovery is handled internally
      }
    } else {
      logger.info('Main', 'Database health check passed, no recovery needed');
    }

    // OPT-037: Step 4b - Check and fix GPS/address consistency gaps
    logger.info('Main', 'Step 4b: Checking GPS/address consistency');
    try {
      const integrityChecker = getIntegrityChecker();
      const gpsCheck = await integrityChecker.checkGpsAddressConsistency();
      if (gpsCheck.found > 0) {
        logger.info('Main', `Fixed ${gpsCheck.fixed}/${gpsCheck.found} GPS/address gaps`);
      } else {
        logger.info('Main', 'No GPS/address gaps found');
      }
    } catch (gpsCheckError) {
      // Non-fatal: log warning but continue startup
      logger.warn('Main', 'GPS/address consistency check failed', { message: (gpsCheckError as Error).message, stack: (gpsCheckError as Error).stack });
    }

    // Step 5: Register IPC handlers
    logger.info('Main', 'Step 5/6: Registering IPC handlers');
    registerIpcHandlers();
    logger.info('Main', 'IPC handlers registered successfully');

    // Step 5b: Start Bookmark API Server for Research Browser extension
    // OPT-109: Uses WebSourcesRepository (replaces deprecated BookmarksRepository)
    logger.info('Main', 'Starting Bookmark API Server');
    const db = getDatabase();
    const webSourcesRepo = new SQLiteWebSourcesRepository(db);
    const locationsRepo = new SQLiteLocationRepository(db);
    const subLocationsRepo = new SQLiteSubLocationRepository(db);
    try {
      await startBookmarkAPIServer(webSourcesRepo, locationsRepo, subLocationsRepo, db);
      logger.info('Main', 'Bookmark API Server started successfully');
    } catch (error) {
      // Non-fatal: log warning but continue startup (research browser feature may not work)
      logger.warn('Main', 'Failed to start Bookmark API Server', { message: (error as Error).message, stack: (error as Error).stack });
    }

    // Step 5c: Start WebSocket Server for real-time extension updates
    logger.info('Main', 'Starting WebSocket Server');
    try {
      await startWebSocketServer();
      logger.info('Main', 'WebSocket Server started successfully');
    } catch (error) {
      // Non-fatal: extension will work without real-time updates
      logger.warn('Main', 'Failed to start WebSocket Server', { message: (error as Error).message, stack: (error as Error).stack });
    }

    // FIX 5.1: Step 6 - Auto backup on startup (if enabled)
    const config = configService.get();
    const backupScheduler = getBackupScheduler();
    await backupScheduler.initialize();

    if (config.backup.enabled && config.backup.backupOnStartup) {
      logger.info('Main', 'Step 6/7: Creating startup backup');
      try {
        const backupResult = await backupScheduler.createAndVerifyBackup();
        if (backupResult) {
          logger.info('Main', 'Startup backup created successfully', { path: backupResult.filePath, verified: backupResult.verified });
        }
      } catch (backupError) {
        // Non-fatal: log warning but continue startup
        logger.warn('Main', 'Failed to create startup backup', { message: (backupError as Error).message, stack: (backupError as Error).stack });
      }
    } else {
      logger.info('Main', 'Step 6/7: Startup backup skipped (disabled in config)');
    }

    // FIX 5.3: Step 7 - Start scheduled backups (if enabled)
    if (config.backup.enabled && config.backup.scheduledBackup) {
      const intervalMs = config.backup.scheduledBackupIntervalHours * 60 * 60 * 1000;
      logger.info('Main', 'Step 7/7: Starting scheduled backups', { intervalHours: config.backup.scheduledBackupIntervalHours });
      backupScheduler.startScheduledBackups(intervalMs);
    } else {
      logger.info('Main', 'Step 7/7: Scheduled backups disabled');
    }

    const duration = Date.now() - startTime;
    logger.info('Main', 'Application initialization complete', { duration });
  } catch (error) {
    logger.error('Main', 'Fatal error during startup', error as Error);
    console.error('Fatal startup error:', error);

    await dialog.showErrorBox(
      'Startup Error',
      `Failed to initialize application:\n\n${(error as Error).message}\n\nThe application will now exit.`
    );

    app.exit(1);
  }
}

app.whenReady().then(async () => {
  // Register the media:// protocol handler
  // Converts media://path/to/file.jpg to actual file access
  protocol.handle('media', async (request) => {
    try {
      // Extract file path from URL: media:///path/to/file -> /path/to/file
      const url = new URL(request.url);
      let filePath = decodeURIComponent(url.pathname);

      // On Windows, pathname starts with / before drive letter, e.g., /C:/...
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1);
      }

      // Security: Verify file exists before serving
      if (!fs.existsSync(filePath)) {
        console.error('[media protocol] File not found:', filePath);
        return new Response('File not found', { status: 404 });
      }

      const stats = fs.statSync(filePath);
      const fileSize = stats.size;

      // Check if this is a video file (for range request handling)
      const ext = filePath.toLowerCase().split('.').pop();
      const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'].includes(ext || '');

      // Handle Range requests for videos (enables scrubbing)
      const rangeHeader = request.headers.get('range');
      if (isVideo && rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
          const chunkSize = end - start + 1;

          // Create readable stream for the requested range
          const fsPromises = await import('fs/promises');
          const fileHandle = await fsPromises.open(filePath, 'r');
          const stream = fileHandle.createReadStream({ start, end, autoClose: true });

          // Convert Node stream to Web ReadableStream
          const webStream = new ReadableStream({
            start(controller) {
              stream.on('data', (chunk) => controller.enqueue(chunk));
              stream.on('end', () => controller.close());
              stream.on('error', (err) => controller.error(err));
            },
            cancel() {
              stream.destroy();
            }
          });

          return new Response(webStream, {
            status: 206,
            statusText: 'Partial Content',
            headers: {
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(chunkSize),
              'Content-Type': ext === 'mp4' || ext === 'm4v' ? 'video/mp4' :
                              ext === 'mov' ? 'video/quicktime' :
                              ext === 'webm' ? 'video/webm' : 'video/mp4',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
            },
          });
        }
      }

      // For videos without range header, return with Accept-Ranges to enable scrubbing
      if (isVideo) {
        const fsPromises = await import('fs/promises');
        const fileHandle = await fsPromises.open(filePath, 'r');
        const stream = fileHandle.createReadStream({ autoClose: true });

        const webStream = new ReadableStream({
          start(controller) {
            stream.on('data', (chunk) => controller.enqueue(chunk));
            stream.on('end', () => controller.close());
            stream.on('error', (err) => controller.error(err));
          },
          cancel() {
            stream.destroy();
          }
        });

        return new Response(webStream, {
          status: 200,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(fileSize),
            'Content-Type': ext === 'mp4' || ext === 'm4v' ? 'video/mp4' :
                            ext === 'mov' ? 'video/quicktime' :
                            ext === 'webm' ? 'video/webm' : 'video/mp4',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        });
      }

      // CRITICAL: No-cache headers required! See DECISION-021-protocol-caching.md
      // Electron's net.fetch caches file:// responses internally. Without these headers,
      // regenerated thumbnails appear stale even though files on disk are correct.
      // DO NOT REMOVE these headers - it will break thumbnail regeneration.
      const response = await net.fetch(`file://${filePath}`);

      // Clone response with cache-busting headers
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      });
    } catch (error) {
      console.error('[media protocol] Error serving file:', error);
      return new Response('Internal error', { status: 500 });
    }
  });

  await startupOrchestrator();

  createWindow();

  // Initialize browser view manager for embedded web browser
  if (mainWindow) {
    initBrowserViewManager(mainWindow);
    getLogger().info('Main', 'Browser view manager initialized');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (mainWindow) {
        initBrowserViewManager(mainWindow);
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  // Export database to archive folder before quit
  try {
    const archiveService = getDatabaseArchiveService();
    const archiveConfigured = await archiveService.isArchiveConfigured();

    if (archiveConfigured) {
      console.log('Exporting database to archive before quit...');
      const result = await archiveService.exportToArchive();
      if (result.success) {
        console.log('Database exported to archive successfully');
      } else {
        console.error('Database archive export failed:', result.error);
      }
    }
  } catch (error) {
    console.error('Failed to export database to archive:', error);
  }

  // Close research browser (external Ungoogled Chromium - zero-detection mode)
  try {
    await terminateDetachedBrowser();
    console.log('Research browser closed successfully');
  } catch (error) {
    console.error('Failed to close research browser:', error);
  }

  // Stop Bookmark API Server
  try {
    await stopBookmarkAPIServer();
    console.log('Bookmark API Server stopped successfully');
  } catch (error) {
    console.error('Failed to stop Bookmark API Server:', error);
  }

  // Stop WebSocket Server
  try {
    await stopWebSocketServer();
    console.log('WebSocket Server stopped successfully');
  } catch (error) {
    console.error('Failed to stop WebSocket Server:', error);
  }

  // Destroy browser view manager
  try {
    destroyBrowserViewManager();
    console.log('Browser view manager destroyed successfully');
  } catch (error) {
    console.error('Failed to destroy browser view manager:', error);
  }

  // Shutdown health monitoring
  try {
    const healthMonitor = getHealthMonitor();
    await healthMonitor.shutdown();
    console.log('Health monitoring shut down successfully');
  } catch (error) {
    console.error('Failed to shutdown health monitoring:', error);
  }

  // OPT-125: Stop Ollama if we started it (seamless lifecycle management)
  try {
    stopOllama();
    console.log('Ollama stopped successfully');
  } catch (error) {
    console.error('Failed to stop Ollama:', error);
  }

  // Migration 86: Stop LiteLLM proxy if we started it
  try {
    await stopLiteLLM();
    console.log('LiteLLM proxy stopped successfully');
  } catch (error) {
    console.error('Failed to stop LiteLLM proxy:', error);
  }

  // Stop spaCy preprocessing server if we started it
  try {
    const preprocessingService = getPreprocessingService();
    await preprocessingService.shutdown();
    console.log('spaCy preprocessing server stopped successfully');
  } catch (error) {
    console.error('Failed to stop spaCy preprocessing server:', error);
  }

  closeDatabase();
});
