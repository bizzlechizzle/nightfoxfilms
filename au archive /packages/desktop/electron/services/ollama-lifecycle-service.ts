/**
 * Ollama Lifecycle Service
 *
 * Seamlessly starts/stops Ollama in the background, controlled by the app.
 * Zero user prompts, zero dock icons, zero manual intervention.
 *
 * Key features:
 * - Auto-detect Ollama binary location
 * - Start Ollama headlessly when needed
 * - Track whether WE started it (don't kill user's instance)
 * - Idle timeout - stop after 5 minutes of no requests
 * - Clean shutdown on app quit
 * - Orphan process cleanup on startup
 *
 * @see docs/plans/OPT-125-ollama-lifecycle-service.md
 * @version 1.0
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

// =============================================================================
// TYPES
// =============================================================================

export interface OllamaLifecycleStatus {
  /** Is Ollama binary installed on this system? */
  installed: boolean;
  /** Path to Ollama binary (null if not found) */
  binaryPath: string | null;
  /** Is Ollama currently running (any instance)? */
  running: boolean;
  /** Did we start the current instance? */
  managedByApp: boolean;
  /** Idle timeout in ms (0 = disabled) */
  idleTimeoutMs: number;
  /** Time until idle shutdown (null if not applicable) */
  idleTimeRemainingMs: number | null;
  /** Last error message (null if none) */
  lastError: string | null;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const OLLAMA_API_URL = 'http://127.0.0.1:11434';
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const STARTUP_TIMEOUT_MS = 30 * 1000; // 30 seconds max to wait for startup
const STARTUP_POLL_INTERVAL_MS = 1000; // Check every second

/** Common Ollama binary locations by platform */
const OLLAMA_BINARY_PATHS: Record<string, string[]> = {
  darwin: [
    '/opt/homebrew/bin/ollama', // Homebrew Apple Silicon
    '/usr/local/bin/ollama', // Homebrew Intel
    `${process.env.HOME}/.ollama/bin/ollama`, // Manual install
  ],
  linux: [
    '/usr/local/bin/ollama',
    '/usr/bin/ollama',
    `${process.env.HOME}/.ollama/bin/ollama`,
  ],
  win32: [
    'C:\\Program Files\\Ollama\\ollama.exe',
    `${process.env.LOCALAPPDATA}\\Ollama\\ollama.exe`,
  ],
};

// =============================================================================
// STATE
// =============================================================================

let ollamaProcess: ChildProcess | null = null;
let weStartedIt = false;
let idleTimer: NodeJS.Timeout | null = null;
let idleTimerStartedAt: number | null = null;
let lastError: string | null = null;
let cachedBinaryPath: string | null | undefined = undefined; // undefined = not checked yet

// =============================================================================
// BINARY DETECTION
// =============================================================================

/**
 * Find the Ollama binary on this system.
 * Returns the path if found, null if not installed.
 * Result is cached after first call.
 */
export function findOllamaBinary(): string | null {
  // Return cached result
  if (cachedBinaryPath !== undefined) {
    return cachedBinaryPath;
  }

  // Check platform-specific common paths
  const paths = OLLAMA_BINARY_PATHS[process.platform] || [];
  for (const p of paths) {
    if (existsSync(p)) {
      cachedBinaryPath = p;
      console.log(`[OllamaLifecycle] Found binary at: ${p}`);
      return p;
    }
  }

  // Fall back to which/where command
  try {
    const cmd = process.platform === 'win32' ? 'where ollama' : 'which ollama';
    const result = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
    if (result && existsSync(result)) {
      cachedBinaryPath = result;
      console.log(`[OllamaLifecycle] Found binary via ${cmd}: ${result}`);
      return result;
    }
  } catch {
    // Command failed - binary not in PATH
  }

  cachedBinaryPath = null;
  console.log('[OllamaLifecycle] Binary not found');
  return null;
}

/**
 * Check if Ollama is installed on this system.
 */
export function isOllamaInstalled(): boolean {
  return findOllamaBinary() !== null;
}

// =============================================================================
// RUNNING STATE DETECTION
// =============================================================================

/**
 * Check if Ollama API is responding (any instance - ours or user's).
 */
export async function isOllamaRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${OLLAMA_API_URL}/api/tags`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

// =============================================================================
// PROCESS MANAGEMENT
// =============================================================================

/**
 * Get the PID file path for orphan tracking.
 */
function getPidFilePath(): string {
  return join(app.getPath('userData'), 'ollama.pid');
}

/**
 * Save our Ollama process PID to disk for orphan cleanup.
 */
function savePid(pid: number | undefined): void {
  if (!pid) return;

  try {
    writeFileSync(getPidFilePath(), String(pid), 'utf8');
  } catch (error) {
    console.warn('[OllamaLifecycle] Could not save PID file:', error);
  }
}

/**
 * Remove the PID file.
 */
function removePidFile(): void {
  const pidFile = getPidFilePath();
  if (existsSync(pidFile)) {
    try {
      unlinkSync(pidFile);
    } catch {
      // Ignore - file might already be gone
    }
  }
}

/**
 * Clean up orphan Ollama process from previous app crash.
 * Call this on app startup.
 */
export function cleanupOrphanOllama(): void {
  const pidFile = getPidFilePath();

  if (!existsSync(pidFile)) {
    return;
  }

  try {
    const pidStr = readFileSync(pidFile, 'utf8').trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      removePidFile();
      return;
    }

    // Check if process exists (signal 0 doesn't kill, just checks)
    try {
      process.kill(pid, 0);

      // Process exists - kill it
      process.kill(pid, 'SIGTERM');
      console.log(`[OllamaLifecycle] Killed orphan process ${pid}`);
    } catch {
      // Process doesn't exist - just clean up file
    }

    removePidFile();
  } catch (error) {
    console.warn('[OllamaLifecycle] Error cleaning up orphan:', error);
    removePidFile();
  }
}

/**
 * Start Ollama as a headless background process.
 * Returns true if started successfully or already running.
 */
export async function startOllama(): Promise<boolean> {
  lastError = null;

  // Already running?
  if (await isOllamaRunning()) {
    console.log('[OllamaLifecycle] Already running (external instance)');
    return true;
  }

  // Find binary
  const binaryPath = findOllamaBinary();
  if (!binaryPath) {
    lastError = 'Ollama not installed. Download from https://ollama.ai';
    console.warn(`[OllamaLifecycle] ${lastError}`);
    return false;
  }

  console.log(`[OllamaLifecycle] Starting Ollama from ${binaryPath}`);

  try {
    // Spawn headless - no dock icon, no console window
    ollamaProcess = spawn(binaryPath, ['serve'], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        OLLAMA_HOST: '127.0.0.1:11434', // Bind to localhost only
      },
    });

    // Don't block app exit
    ollamaProcess.unref();

    // Track that we started it
    weStartedIt = true;
    savePid(ollamaProcess.pid);

    // Handle unexpected exit
    ollamaProcess.on('exit', (code) => {
      console.log(`[OllamaLifecycle] Process exited with code ${code}`);
      ollamaProcess = null;
      weStartedIt = false;
      removePidFile();
    });

    // Wait for startup
    const startTime = Date.now();
    while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, STARTUP_POLL_INTERVAL_MS));

      if (await isOllamaRunning()) {
        console.log(
          `[OllamaLifecycle] Started successfully in ${Date.now() - startTime}ms`
        );
        return true;
      }
    }

    // Timeout
    lastError = `Ollama failed to start within ${STARTUP_TIMEOUT_MS / 1000}s`;
    console.error(`[OllamaLifecycle] ${lastError}`);

    // Clean up failed process
    if (ollamaProcess) {
      ollamaProcess.kill('SIGKILL');
      ollamaProcess = null;
    }
    weStartedIt = false;
    removePidFile();

    return false;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error('[OllamaLifecycle] Failed to start:', lastError);
    return false;
  }
}

/**
 * Stop Ollama - but only if WE started it.
 * Safe to call multiple times.
 */
export function stopOllama(): void {
  // Clear idle timer
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
    idleTimerStartedAt = null;
  }

  // Only kill if WE started it
  if (!weStartedIt) {
    console.log('[OllamaLifecycle] Not our instance - skipping shutdown');
    return;
  }

  if (ollamaProcess) {
    try {
      ollamaProcess.kill('SIGTERM');
      console.log('[OllamaLifecycle] Sent SIGTERM to process');
    } catch (error) {
      console.warn('[OllamaLifecycle] Error killing process:', error);
    }
    ollamaProcess = null;
  }

  weStartedIt = false;
  removePidFile();
  console.log('[OllamaLifecycle] Stopped');
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Ensure Ollama is running. This is the main entry point.
 * - Starts Ollama if not running
 * - Resets idle timer
 * - Returns true if ready for requests
 */
export async function ensureOllamaRunning(): Promise<boolean> {
  // Already running?
  if (await isOllamaRunning()) {
    resetIdleTimer();
    return true;
  }

  // Try to start
  const started = await startOllama();
  if (started) {
    resetIdleTimer();
  }
  return started;
}

// =============================================================================
// IDLE TIMEOUT
// =============================================================================

/**
 * Reset the idle timer. Call this after each Ollama request.
 * After IDLE_TIMEOUT_MS of no calls, Ollama will be stopped.
 */
export function resetIdleTimer(): void {
  // Only manage timer if we started Ollama
  if (!weStartedIt) return;

  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  idleTimerStartedAt = Date.now();

  idleTimer = setTimeout(() => {
    console.log('[OllamaLifecycle] Idle timeout - stopping Ollama');
    stopOllama();
  }, IDLE_TIMEOUT_MS);
}

// =============================================================================
// STATUS
// =============================================================================

/**
 * Get current Ollama lifecycle status.
 */
export async function getOllamaLifecycleStatus(): Promise<OllamaLifecycleStatus> {
  const binaryPath = findOllamaBinary();
  const running = await isOllamaRunning();

  let idleTimeRemainingMs: number | null = null;
  if (weStartedIt && idleTimerStartedAt) {
    const elapsed = Date.now() - idleTimerStartedAt;
    idleTimeRemainingMs = Math.max(0, IDLE_TIMEOUT_MS - elapsed);
  }

  return {
    installed: binaryPath !== null,
    binaryPath,
    running,
    managedByApp: weStartedIt,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    idleTimeRemainingMs,
    lastError,
  };
}

// =============================================================================
// SINGLETON EXPORTS
// =============================================================================

/**
 * Module-level exports for singleton pattern.
 * No class needed - functions manage shared state.
 */
export const OllamaLifecycle = {
  findBinary: findOllamaBinary,
  isInstalled: isOllamaInstalled,
  isRunning: isOllamaRunning,
  start: startOllama,
  stop: stopOllama,
  ensure: ensureOllamaRunning,
  resetIdleTimer,
  cleanupOrphan: cleanupOrphanOllama,
  getStatus: getOllamaLifecycleStatus,
};

export default OllamaLifecycle;
