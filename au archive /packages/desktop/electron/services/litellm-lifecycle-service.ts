/**
 * LiteLLM Lifecycle Service
 *
 * Manages the LiteLLM proxy server as a subprocess.
 * Pattern follows ollama-lifecycle-service.ts:
 * - Auto-start when extraction needs cloud providers
 * - Idle timeout shutdown (10 minutes default)
 * - Config generation from stored credentials
 * - Health monitoring
 * - Orphan process cleanup
 *
 * @version 1.0
 * @see docs/plans/litellm-integration-plan.md - Phase 2
 * @see ollama-lifecycle-service.ts for pattern reference
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { app } from 'electron';
import { retrieveCredential, hasCredential, listCredentialProviders } from './credential-service';
import { getRawDatabase } from '../main/database';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// TYPES
// =============================================================================

export interface LiteLLMStatus {
  /** Is LiteLLM (pip package) installed on this system? */
  installed: boolean;
  /** Is the LiteLLM proxy currently running? */
  running: boolean;
  /** Did we start the current instance? */
  managedByApp: boolean;
  /** Current proxy port */
  port: number;
  /** Health check endpoint */
  healthEndpoint: string;
  /** Models configured in the proxy */
  configuredModels: string[];
  /** Idle timeout in ms */
  idleTimeoutMs: number;
  /** Time until idle shutdown (null if not applicable) */
  idleTimeRemainingMs: number | null;
  /** Last error message */
  lastError: string | null;
}

export interface LiteLLMModelConfig {
  modelName: string;
  litellmParams: {
    model: string;
    apiBase?: string;
    apiKey?: string;
  };
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_PORT = 4000;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const STARTUP_TIMEOUT_MS = 30 * 1000; // 30 seconds max
const STARTUP_POLL_INTERVAL_MS = 1000;
const HEALTH_CHECK_INTERVAL_MS = 30 * 1000;

// =============================================================================
// STATE
// =============================================================================

let litellmProcess: ChildProcess | null = null;
let weStartedIt = false;
let idleTimer: NodeJS.Timeout | null = null;
let idleTimerStartedAt: number | null = null;
let healthCheckInterval: NodeJS.Timeout | null = null;
let lastError: string | null = null;
let currentPort = DEFAULT_PORT;
let configuredModels: string[] = [];

// =============================================================================
// INSTALLATION DETECTION
// =============================================================================

/**
 * Get paths to check for bundled LiteLLM venv.
 */
function getVenvPaths(): string[] {
  return [
    // Production: in app resources
    join(app.getPath('userData'), 'litellm-venv', 'bin', 'python'),
    // Development: project root scripts folder (when running from packages/desktop)
    join(process.cwd(), '..', '..', 'scripts', 'litellm-venv', 'bin', 'python'),
    // Development: when cwd is project root
    join(process.cwd(), 'scripts', 'litellm-venv', 'bin', 'python'),
    // Development: relative to dist-electron output
    join(__dirname, '..', '..', '..', 'scripts', 'litellm-venv', 'bin', 'python'),
    // Desktop package scripts folder
    join(__dirname, '..', '..', 'scripts', 'litellm-venv', 'bin', 'python'),
  ];
}

/**
 * Get the Python executable to use for LiteLLM.
 * Prefers bundled venv, falls back to system Python.
 */
function getLiteLLMPython(): string | null {
  // Check bundled venv first
  const venvPaths = getVenvPaths();
  console.log('[LiteLLM] Checking venv paths:', venvPaths);

  for (const pythonPath of venvPaths) {
    const exists = existsSync(pythonPath);
    console.log(`[LiteLLM] Checking ${pythonPath}: ${exists ? 'FOUND' : 'not found'}`);
    if (exists) {
      console.log(`[LiteLLM] Using bundled venv: ${pythonPath}`);
      return pythonPath;
    }
  }

  // Fall back to system Python with proper environment
  console.log('[LiteLLM] No venv found, checking system Python...');
  const env = { ...process.env, HOME: process.env.HOME || homedir() };

  try {
    execSync('python3 -c "import litellm"', { timeout: 5000, stdio: 'ignore', env });
    console.log('[LiteLLM] Using system python3');
    return 'python3';
  } catch {
    try {
      execSync('python -c "import litellm"', { timeout: 5000, stdio: 'ignore', env });
      console.log('[LiteLLM] Using system python');
      return 'python';
    } catch {
      console.log('[LiteLLM] No Python with litellm found');
      return null;
    }
  }
}

/**
 * Check if LiteLLM is installed (bundled venv or system).
 */
export async function isLiteLLMInstalled(): Promise<boolean> {
  return getLiteLLMPython() !== null;
}

/**
 * Get installation info for status display.
 */
export function getLiteLLMInstallInfo(): { installed: boolean; path: string | null; isBundled: boolean } {
  for (const pythonPath of getVenvPaths()) {
    if (existsSync(pythonPath)) {
      return { installed: true, path: pythonPath, isBundled: true };
    }
  }

  const systemPython = getLiteLLMPython();
  if (systemPython) {
    return { installed: true, path: systemPython, isBundled: false };
  }

  return { installed: false, path: null, isBundled: false };
}

// =============================================================================
// RUNNING STATE DETECTION
// =============================================================================

/**
 * Check if LiteLLM proxy is responding at the configured port.
 */
export async function isLiteLLMRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`http://localhost:${currentPort}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

// =============================================================================
// CONFIG GENERATION
// =============================================================================

/**
 * Get the config directory path.
 */
function getConfigDir(): string {
  const configDir = join(app.getPath('userData'), 'litellm');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  return configDir;
}

/**
 * Get the config file path.
 */
function getConfigPath(): string {
  return join(getConfigDir(), 'config.yaml');
}

/**
 * Get the PID file path for orphan tracking.
 */
function getPidFilePath(): string {
  return join(app.getPath('userData'), 'litellm.pid');
}

/**
 * Generate LiteLLM config from stored credentials.
 */
async function generateConfig(): Promise<string> {
  const models: any[] = [];
  configuredModels = [];

  // Get LiteLLM settings from database
  const db = getRawDatabase();
  const settingsRows = db
    .prepare('SELECT key, value FROM litellm_settings')
    .all() as { key: string; value: string }[];
  const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));

  currentPort = parseInt(settings.port || '4000', 10);

  // Always add local Ollama as fallback (if available)
  models.push({
    model_name: 'extraction-local',
    litellm_params: {
      model: 'ollama/qwen2.5:7b',
      api_base: 'http://localhost:11434',
    },
  });
  configuredModels.push('extraction-local (Ollama)');

  // Add VLM model for image enhancement (Stage 2 tagging)
  models.push({
    model_name: 'vlm-local',
    litellm_params: {
      model: 'ollama/qwen2.5-vl:7b',
      api_base: 'http://localhost:11434',
    },
  });
  configuredModels.push('vlm-local (Ollama VLM)');

  // Add cloud providers if credentials exist
  const providers = await listCredentialProviders();

  if (providers.includes('anthropic')) {
    const key = await retrieveCredential('anthropic');
    if (key) {
      models.push({
        model_name: 'extraction-cloud-anthropic',
        litellm_params: {
          model: 'claude-3-5-sonnet-20241022',
          api_key: key,
        },
      });
      models.push({
        model_name: 'extraction-fast-anthropic',
        litellm_params: {
          model: 'claude-3-5-haiku-20241022',
          api_key: key,
        },
      });
      configuredModels.push('claude-3-5-sonnet (Anthropic)');
      configuredModels.push('claude-3-5-haiku (Anthropic)');
    }
  }

  if (providers.includes('openai')) {
    const key = await retrieveCredential('openai');
    if (key) {
      models.push({
        model_name: 'extraction-cloud-openai',
        litellm_params: {
          model: 'gpt-4o',
          api_key: key,
        },
      });
      models.push({
        model_name: 'extraction-fast-openai',
        litellm_params: {
          model: 'gpt-4o-mini',
          api_key: key,
        },
      });
      configuredModels.push('gpt-4o (OpenAI)');
      configuredModels.push('gpt-4o-mini (OpenAI)');
    }
  }

  if (providers.includes('google')) {
    const key = await retrieveCredential('google');
    if (key) {
      models.push({
        model_name: 'extraction-cloud-google',
        litellm_params: {
          model: 'gemini/gemini-1.5-pro',
          api_key: key,
        },
      });
      configuredModels.push('gemini-1.5-pro (Google)');
    }
  }

  if (providers.includes('groq')) {
    const key = await retrieveCredential('groq');
    if (key) {
      models.push({
        model_name: 'extraction-fast-groq',
        litellm_params: {
          model: 'groq/llama-3.1-70b-versatile',
          api_key: key,
        },
      });
      configuredModels.push('llama-3.1-70b (Groq)');
    }
  }

  // Build YAML config
  const routingStrategy = settings.routing_strategy || 'cost-based-routing';
  const retries = parseInt(settings.retries || '3', 10);
  const cacheEnabled = settings.cache_enabled === 'true';

  // Generate YAML manually (simple structure)
  let yaml = `# LiteLLM Proxy Configuration
# Auto-generated by AU Archive - DO NOT EDIT MANUALLY

model_list:
`;

  for (const model of models) {
    yaml += `  - model_name: ${model.model_name}
    litellm_params:
      model: ${model.litellm_params.model}
`;
    if (model.litellm_params.api_base) {
      yaml += `      api_base: ${model.litellm_params.api_base}
`;
    }
    if (model.litellm_params.api_key) {
      yaml += `      api_key: ${model.litellm_params.api_key}
`;
    }
  }

  yaml += `
router_settings:
  routing_strategy: ${routingStrategy}
  num_retries: ${retries}
  retry_policy:
    TimeoutErrorRetries: 3
    RateLimitErrorRetries: 3

litellm_settings:
  drop_params: true
  set_verbose: false
  cache: ${cacheEnabled}
`;

  return yaml;
}

// =============================================================================
// PROCESS MANAGEMENT
// =============================================================================

/**
 * Save our LiteLLM process PID to disk for orphan cleanup.
 */
function savePid(pid: number | undefined): void {
  if (!pid) return;

  try {
    writeFileSync(getPidFilePath(), String(pid), 'utf8');
  } catch (error) {
    console.warn('[LiteLLMLifecycle] Could not save PID file:', error);
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
      // Ignore
    }
  }
}

/**
 * Clean up orphan LiteLLM process from previous app crash.
 */
export function cleanupOrphanLiteLLM(): void {
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

    // Check if process exists
    try {
      process.kill(pid, 0);
      // Process exists - kill it
      process.kill(pid, 'SIGTERM');
      console.log(`[LiteLLMLifecycle] Killed orphan process ${pid}`);
    } catch {
      // Process doesn't exist
    }

    removePidFile();
  } catch (error) {
    console.warn('[LiteLLMLifecycle] Error cleaning up orphan:', error);
    removePidFile();
  }
}

/**
 * Start LiteLLM proxy server.
 */
export async function startLiteLLM(): Promise<boolean> {
  lastError = null;

  // Already running?
  if (await isLiteLLMRunning()) {
    console.log('[LiteLLMLifecycle] Already running');
    return true;
  }

  // Check if installed
  // Get Python executable (bundled venv or system)
  const pythonPath = getLiteLLMPython();
  if (!pythonPath) {
    lastError = 'LiteLLM not installed. Run: ./scripts/setup-litellm.sh';
    console.warn(`[LiteLLMLifecycle] ${lastError}`);
    return false;
  }

  // Generate config
  const configPath = getConfigPath();
  const configContent = await generateConfig();
  writeFileSync(configPath, configContent, 'utf8');

  // Determine if using bundled venv (has litellm executable) or system Python
  const venvBinDir = dirname(pythonPath);
  const litellmExe = join(venvBinDir, 'litellm');
  const useBundledExe = existsSync(litellmExe);

  console.log(`[LiteLLMLifecycle] Starting proxy on port ${currentPort}`);
  console.log(`[LiteLLMLifecycle] Config: ${configPath}`);
  console.log(`[LiteLLMLifecycle] Using: ${useBundledExe ? litellmExe : pythonPath}`);

  try {
    // Spawn LiteLLM proxy - use executable if bundled, otherwise python -m litellm.proxy
    const spawnCmd = useBundledExe ? litellmExe : pythonPath;
    const spawnArgs = useBundledExe
      ? ['--config', configPath, '--port', String(currentPort)]
      : ['-m', 'litellm.proxy', '--config', configPath, '--port', String(currentPort)];

    litellmProcess = spawn(
      spawnCmd,
      spawnArgs,
      {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          LITELLM_LOG: 'ERROR', // Reduce noise
        },
      }
    );

    litellmProcess.unref();
    weStartedIt = true;
    savePid(litellmProcess.pid);

    // Handle unexpected exit
    litellmProcess.on('exit', (code) => {
      console.log(`[LiteLLMLifecycle] Process exited with code ${code}`);
      litellmProcess = null;
      weStartedIt = false;
      removePidFile();
      clearHealthCheck();
    });

    // Wait for startup
    const startTime = Date.now();
    while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, STARTUP_POLL_INTERVAL_MS));

      if (await isLiteLLMRunning()) {
        console.log(
          `[LiteLLMLifecycle] Started successfully in ${Date.now() - startTime}ms`
        );
        startHealthCheck();
        return true;
      }
    }

    // Timeout
    lastError = `LiteLLM failed to start within ${STARTUP_TIMEOUT_MS / 1000}s`;
    console.error(`[LiteLLMLifecycle] ${lastError}`);

    // Clean up failed process
    if (litellmProcess) {
      litellmProcess.kill('SIGKILL');
      litellmProcess = null;
    }
    weStartedIt = false;
    removePidFile();

    return false;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error('[LiteLLMLifecycle] Failed to start:', lastError);
    return false;
  }
}

/**
 * Stop LiteLLM proxy (only if we started it).
 */
export function stopLiteLLM(): void {
  clearIdleTimer();
  clearHealthCheck();

  if (!weStartedIt) {
    console.log('[LiteLLMLifecycle] Not our instance - skipping shutdown');
    return;
  }

  if (litellmProcess) {
    try {
      litellmProcess.kill('SIGTERM');
      console.log('[LiteLLMLifecycle] Sent SIGTERM to process');
    } catch (error) {
      console.warn('[LiteLLMLifecycle] Error killing process:', error);
    }
    litellmProcess = null;
  }

  weStartedIt = false;
  removePidFile();
  console.log('[LiteLLMLifecycle] Stopped');
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Ensure LiteLLM is running. This is the main entry point.
 */
export async function ensureLiteLLMRunning(): Promise<boolean> {
  if (await isLiteLLMRunning()) {
    resetIdleTimer();
    return true;
  }

  const started = await startLiteLLM();
  if (started) {
    resetIdleTimer();
  }
  return started;
}

// =============================================================================
// IDLE TIMEOUT
// =============================================================================

/**
 * Reset the idle timer.
 */
export function resetIdleTimer(): void {
  if (!weStartedIt) return;

  clearIdleTimer();
  idleTimerStartedAt = Date.now();

  idleTimer = setTimeout(() => {
    console.log('[LiteLLMLifecycle] Idle timeout - stopping');
    stopLiteLLM();
  }, IDLE_TIMEOUT_MS);
}

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
    idleTimerStartedAt = null;
  }
}

// =============================================================================
// HEALTH CHECK
// =============================================================================

function startHealthCheck(): void {
  clearHealthCheck();

  healthCheckInterval = setInterval(async () => {
    if (!(await isLiteLLMRunning())) {
      console.warn('[LiteLLMLifecycle] Health check failed - proxy not responding');
      // Could auto-restart here if desired
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

function clearHealthCheck(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// =============================================================================
// STATUS
// =============================================================================

/**
 * Get current LiteLLM lifecycle status.
 */
export async function getLiteLLMStatus(): Promise<LiteLLMStatus> {
  const installed = await isLiteLLMInstalled();
  const running = await isLiteLLMRunning();

  let idleTimeRemainingMs: number | null = null;
  if (weStartedIt && idleTimerStartedAt) {
    const elapsed = Date.now() - idleTimerStartedAt;
    idleTimeRemainingMs = Math.max(0, IDLE_TIMEOUT_MS - elapsed);
  }

  return {
    installed,
    running,
    managedByApp: weStartedIt,
    port: currentPort,
    healthEndpoint: `http://localhost:${currentPort}/health`,
    configuredModels,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    idleTimeRemainingMs,
    lastError,
  };
}

/**
 * Reload config (after credential changes).
 */
export async function reloadConfig(): Promise<boolean> {
  if (!weStartedIt || !litellmProcess) {
    // Not running - will pick up new config on next start
    return true;
  }

  // Regenerate config and restart
  stopLiteLLM();
  await new Promise((r) => setTimeout(r, 1000)); // Brief pause
  return await startLiteLLM();
}

// =============================================================================
// COST TRACKING
// =============================================================================

/**
 * Get usage costs from LiteLLM.
 */
export async function getLiteLLMCosts(): Promise<{
  today: number;
  month: number;
  requestsToday: number;
} | null> {
  if (!(await isLiteLLMRunning())) {
    return null;
  }

  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split('T')[0];
    const today = now.toISOString().split('T')[0];

    const response = await fetch(
      `http://localhost:${currentPort}/spend/logs?start_date=${startOfMonth}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) {
      console.warn('[LiteLLMLifecycle] Cost endpoint not available');
      return null;
    }

    const logs = await response.json();

    let todayTotal = 0;
    let monthTotal = 0;
    let requestsToday = 0;

    for (const log of logs) {
      monthTotal += log.spend || 0;
      if (log.startTime?.startsWith(today)) {
        todayTotal += log.spend || 0;
        requestsToday++;
      }
    }

    return {
      today: todayTotal,
      month: monthTotal,
      requestsToday,
    };
  } catch (error) {
    console.warn('[LiteLLMLifecycle] Failed to get costs:', error);
    return null;
  }
}

// =============================================================================
// SINGLETON EXPORTS
// =============================================================================

export const LiteLLMLifecycle = {
  isInstalled: isLiteLLMInstalled,
  isRunning: isLiteLLMRunning,
  start: startLiteLLM,
  stop: stopLiteLLM,
  ensure: ensureLiteLLMRunning,
  getStatus: getLiteLLMStatus,
  reloadConfig,
  resetIdleTimer,
  cleanupOrphan: cleanupOrphanLiteLLM,
  getCosts: getLiteLLMCosts,
};

export default LiteLLMLifecycle;
