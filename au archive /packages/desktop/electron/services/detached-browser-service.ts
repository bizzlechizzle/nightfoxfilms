/**
 * detached-browser-service.ts
 *
 * Zero-detection Research Browser launcher.
 * Launches Ungoogled Chromium as a completely independent process with NO
 * Chrome DevTools Protocol (CDP) connection, eliminating all automation
 * fingerprints that trigger bot detection.
 *
 * Key differences from puppeteer-based approach:
 * - Uses child_process.spawn() instead of puppeteer.launch()
 * - NO DevTools Protocol connection = no navigator.webdriver
 * - NO CDP artifacts (cdc_ variables, etc.)
 * - Browser behaves exactly like user-launched instance
 * - Status detection via extension heartbeat, not CDP
 *
 * Communication with browser happens exclusively through:
 * - AU Archive Clipper extension (already installed)
 * - WebSocket server on port 47124
 * - HTTP API server on port 47123
 */
import { spawn, ChildProcess, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { app } from 'electron';
import { getLogger } from './logger-service';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = getLogger();

// Browser process reference
let browserProcess: ChildProcess | null = null;

// Extension connection tracking
let extensionConnected = false;
let lastExtensionHeartbeat: number = 0;
const HEARTBEAT_TIMEOUT_MS = 10000; // 10 seconds

// Active tab info (updated via extension events)
let activeTabInfo: { url: string; title: string; tabId: number } | null = null;

/**
 * Browser status interface
 */
export interface BrowserStatus {
  running: boolean;
  pid?: number;
  extensionConnected: boolean;
  activeTabUrl?: string;
  activeTabTitle?: string;
}

/**
 * Get the path to the Ungoogled Chromium executable
 * based on the current platform
 */
function getChromiumPath(): string {
  const platform = process.platform;
  const arch = process.arch;

  // In development, look in resources/browsers/
  // In production, look in app.getPath('exe')/../resources/browsers/
  const isDev = !app.isPackaged;

  let basePath: string;
  if (isDev) {
    basePath = path.join(__dirname, '../../../../resources/browsers/ungoogled-chromium');
  } else {
    basePath = path.join(process.resourcesPath, 'browsers/ungoogled-chromium');
  }

  switch (platform) {
    case 'darwin': {
      // macOS - both arm64 and x64 use .app bundle
      const macArch = arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
      return path.join(basePath, macArch, 'Archive Browser.app/Contents/MacOS/Chromium');
    }

    case 'win32':
      return path.join(basePath, 'win-x64', 'chrome.exe');

    case 'linux':
      return path.join(basePath, 'linux-x64', 'chrome');

    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Get the path to store browser profile data
 * This persists logins, cookies, extensions, etc.
 */
function getProfilePath(): string {
  return path.join(app.getPath('userData'), 'research-browser');
}

/**
 * Get the path to our browser extension
 */
function getExtensionPath(): string {
  const isDev = !app.isPackaged;

  if (isDev) {
    return path.join(__dirname, '../../../../resources/extension');
  } else {
    return path.join(process.resourcesPath, 'extension');
  }
}

/**
 * Check if a process with given PID is still running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Signal 0 doesn't actually send a signal, just checks if process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Launch the Research Browser as a detached process
 *
 * This launches Chromium WITHOUT any automation framework connection,
 * making it indistinguishable from a user-launched browser.
 */
export async function launchDetachedBrowser(): Promise<{ success: boolean; pid?: number; error?: string }> {
  // If already running, return success
  if (browserProcess && browserProcess.pid && isProcessRunning(browserProcess.pid)) {
    logger.info('DetachedBrowser', 'Browser already running', { pid: browserProcess.pid });
    return { success: true, pid: browserProcess.pid };
  }

  const chromiumPath = getChromiumPath();
  const profilePath = getProfilePath();
  const extensionPath = getExtensionPath();

  // Verify browser executable exists
  if (!fs.existsSync(chromiumPath)) {
    const error = `Browser executable not found: ${chromiumPath}`;
    logger.error('DetachedBrowser', error);
    return { success: false, error };
  }

  // Verify extension exists
  if (!fs.existsSync(extensionPath)) {
    const error = `Extension not found: ${extensionPath}`;
    logger.error('DetachedBrowser', error);
    return { success: false, error };
  }

  logger.info('DetachedBrowser', 'Launching browser', {
    chromiumPath,
    profilePath,
    extensionPath,
  });

  try {
    // Browser launch arguments
    // CRITICAL: NO --remote-debugging-port flag (no CDP)
    // CRITICAL: NO --enable-automation flag
    const args = [
      `--user-data-dir=${profilePath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=MediaRouter', // Remove Cast button
      // Start with DuckDuckGo as default page
      'https://duckduckgo.com',
    ];

    // Spawn browser as detached process
    browserProcess = spawn(chromiumPath, args, {
      detached: true, // Run independently of parent
      stdio: 'ignore', // Don't pipe stdio (fully independent)
      env: {
        ...process.env,
        // Ensure no automation environment variables leak through
        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: undefined,
        PUPPETEER_EXECUTABLE_PATH: undefined,
      },
    });

    // Allow parent to exit without waiting for browser
    browserProcess.unref();

    // Handle process exit
    browserProcess.on('exit', (code, signal) => {
      logger.info('DetachedBrowser', 'Browser process exited', { code, signal });
      browserProcess = null;
      extensionConnected = false;
      activeTabInfo = null;
    });

    browserProcess.on('error', (error) => {
      logger.error('DetachedBrowser', 'Browser process error', error);
      browserProcess = null;
    });

    const pid = browserProcess.pid;
    logger.info('DetachedBrowser', 'Browser launched successfully', { pid });

    // OPT-114: Removed auto-keystroke for side panel (required Accessibility permission)
    // Users can open the side panel manually with Alt+Shift+A

    return { success: true, pid };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('DetachedBrowser', 'Launch failed', error as Error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Terminate the Research Browser
 */
export async function terminateDetachedBrowser(): Promise<void> {
  if (!browserProcess) {
    logger.info('DetachedBrowser', 'No browser process to terminate');
    return;
  }

  const pid = browserProcess.pid;

  try {
    // On macOS/Linux, we can send SIGTERM to the process group
    if (process.platform !== 'win32' && pid) {
      try {
        // Kill the process group (negative PID)
        process.kill(-pid, 'SIGTERM');
      } catch {
        // If process group kill fails, try direct kill
        browserProcess.kill('SIGTERM');
      }
    } else {
      browserProcess.kill('SIGTERM');
    }

    logger.info('DetachedBrowser', 'Sent SIGTERM to browser', { pid });
  } catch (error) {
    logger.warn('DetachedBrowser', 'Error sending SIGTERM', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  browserProcess = null;
  extensionConnected = false;
  activeTabInfo = null;
}

/**
 * Check if the browser is currently running
 */
export function isDetachedBrowserRunning(): boolean {
  if (!browserProcess || !browserProcess.pid) {
    return false;
  }
  return isProcessRunning(browserProcess.pid);
}

/**
 * Get comprehensive browser status
 */
export function getDetachedBrowserStatus(): BrowserStatus {
  const running = isDetachedBrowserRunning();
  const extConnected = extensionConnected && (Date.now() - lastExtensionHeartbeat < HEARTBEAT_TIMEOUT_MS);

  return {
    running,
    pid: browserProcess?.pid,
    extensionConnected: running && extConnected,
    activeTabUrl: activeTabInfo?.url,
    activeTabTitle: activeTabInfo?.title,
  };
}

/**
 * Update extension connection status
 * Called by WebSocket server when extension sends heartbeat
 */
export function updateExtensionHeartbeat(): void {
  extensionConnected = true;
  lastExtensionHeartbeat = Date.now();
}

/**
 * Update active tab information
 * Called by WebSocket server when extension reports tab changes
 */
export function updateActiveTab(tabInfo: { url: string; title: string; tabId: number }): void {
  activeTabInfo = tabInfo;
}

/**
 * Mark extension as disconnected
 * Called by WebSocket server when extension connection closes
 */
export function markExtensionDisconnected(): void {
  extensionConnected = false;
}

/**
 * Legacy alias for backward compatibility with existing code
 * Maps to new function names
 */
export const launchResearchBrowser = launchDetachedBrowser;
export const closeResearchBrowser = terminateDetachedBrowser;
export const isResearchBrowserRunning = isDetachedBrowserRunning;
export const getResearchBrowserStatus = getDetachedBrowserStatus;
