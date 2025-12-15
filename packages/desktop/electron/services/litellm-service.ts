/**
 * LiteLLM Service
 *
 * Lightweight LiteLLM integration for video captioning.
 * Supports local (Ollama) and cloud (OpenAI, Anthropic) vision models.
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { app } from 'electron';
import { homedir } from 'os';

// =============================================================================
// TYPES
// =============================================================================

export interface LiteLLMStatus {
  installed: boolean;
  running: boolean;
  managedByApp: boolean;
  port: number;
  configuredModels: string[];
  lastError: string | null;
}

export interface LiteLLMSettings {
  port: number;
  defaultModel: string;
  ollamaEnabled: boolean;
  ollamaModel: string;
  anthropicKey: string | null;
  openaiKey: string | null;
}

export interface CaptionResult {
  caption: string;
  model: string;
  durationMs: number;
  tokens?: {
    prompt: number;
    completion: number;
  };
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_PORT = 4000;
const STARTUP_TIMEOUT_MS = 30000;
const STARTUP_POLL_INTERVAL_MS = 1000;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

// =============================================================================
// STATE
// =============================================================================

let litellmProcess: ChildProcess | null = null;
let weStartedIt = false;
let idleTimer: NodeJS.Timeout | null = null;
let lastError: string | null = null;
let currentPort = DEFAULT_PORT;
let configuredModels: string[] = [];

// =============================================================================
// INSTALLATION DETECTION
// =============================================================================

function getVenvPaths(): string[] {
  return [
    join(app.getPath('userData'), 'litellm-venv', 'bin', 'python'),
    join(process.cwd(), 'scripts', 'litellm-venv', 'bin', 'python'),
    join(process.cwd(), '..', '..', 'scripts', 'litellm-venv', 'bin', 'python'),
  ];
}

function getLiteLLMPython(): string | null {
  for (const pythonPath of getVenvPaths()) {
    if (existsSync(pythonPath)) {
      return pythonPath;
    }
  }

  const env = { ...process.env, HOME: process.env.HOME || homedir() };

  try {
    execSync('python3 -c "import litellm"', { timeout: 5000, stdio: 'ignore', env });
    return 'python3';
  } catch {
    try {
      execSync('python -c "import litellm"', { timeout: 5000, stdio: 'ignore', env });
      return 'python';
    } catch {
      return null;
    }
  }
}

export async function isLiteLLMInstalled(): Promise<boolean> {
  return getLiteLLMPython() !== null;
}

// =============================================================================
// RUNNING STATE DETECTION
// =============================================================================

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
// CONFIG
// =============================================================================

function getConfigDir(): string {
  const configDir = join(app.getPath('userData'), 'litellm');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  return configDir;
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.yaml');
}

function getPidFilePath(): string {
  return join(app.getPath('userData'), 'litellm.pid');
}

export async function generateConfig(settings: LiteLLMSettings): Promise<string> {
  const models: any[] = [];
  configuredModels = [];
  currentPort = settings.port || DEFAULT_PORT;

  // Add Ollama if enabled
  if (settings.ollamaEnabled) {
    models.push({
      model_name: 'caption-local',
      litellm_params: {
        model: `ollama/${settings.ollamaModel || 'llava:7b'}`,
        api_base: 'http://localhost:11434',
      },
    });
    configuredModels.push(`caption-local (${settings.ollamaModel || 'llava:7b'})`);
  }

  // Add Anthropic if key provided
  if (settings.anthropicKey) {
    models.push({
      model_name: 'caption-anthropic',
      litellm_params: {
        model: 'claude-3-5-sonnet-20241022',
        api_key: settings.anthropicKey,
      },
    });
    configuredModels.push('caption-anthropic (claude-3-5-sonnet)');
  }

  // Add OpenAI if key provided
  if (settings.openaiKey) {
    models.push({
      model_name: 'caption-openai',
      litellm_params: {
        model: 'gpt-4o',
        api_key: settings.openaiKey,
      },
    });
    configuredModels.push('caption-openai (gpt-4o)');
  }

  // Generate YAML
  let yaml = `# LiteLLM Proxy Configuration
# Auto-generated by Nightfox Films

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
  routing_strategy: simple-shuffle
  num_retries: 2

litellm_settings:
  drop_params: true
  set_verbose: false
`;

  return yaml;
}

// =============================================================================
// PROCESS MANAGEMENT
// =============================================================================

function savePid(pid: number | undefined): void {
  if (!pid) return;
  try {
    writeFileSync(getPidFilePath(), String(pid), 'utf8');
  } catch {
    // Ignore
  }
}

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

export function cleanupOrphan(): void {
  const pidFile = getPidFilePath();
  if (!existsSync(pidFile)) return;

  try {
    const pidStr = readFileSync(pidFile, 'utf8').trim();
    const pid = parseInt(pidStr, 10);
    if (isNaN(pid)) {
      removePidFile();
      return;
    }

    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGTERM');
      console.log(`[LiteLLM] Killed orphan process ${pid}`);
    } catch {
      // Process doesn't exist
    }

    removePidFile();
  } catch {
    removePidFile();
  }
}

export async function startLiteLLM(settings: LiteLLMSettings): Promise<boolean> {
  lastError = null;

  if (await isLiteLLMRunning()) {
    console.log('[LiteLLM] Already running');
    return true;
  }

  const pythonPath = getLiteLLMPython();
  if (!pythonPath) {
    lastError = 'LiteLLM not installed. Run: pip install litellm';
    console.warn(`[LiteLLM] ${lastError}`);
    return false;
  }

  const configPath = getConfigPath();
  const configContent = await generateConfig(settings);
  writeFileSync(configPath, configContent, 'utf8');

  const venvBinDir = dirname(pythonPath);
  const litellmExe = join(venvBinDir, 'litellm');
  const useBundledExe = existsSync(litellmExe);

  console.log(`[LiteLLM] Starting proxy on port ${currentPort}`);

  try {
    const spawnCmd = useBundledExe ? litellmExe : pythonPath;
    const spawnArgs = useBundledExe
      ? ['--config', configPath, '--port', String(currentPort)]
      : ['-m', 'litellm.proxy', '--config', configPath, '--port', String(currentPort)];

    litellmProcess = spawn(spawnCmd, spawnArgs, {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        LITELLM_LOG: 'ERROR',
      },
    });

    litellmProcess.unref();
    weStartedIt = true;
    savePid(litellmProcess.pid);

    litellmProcess.on('exit', (code) => {
      console.log(`[LiteLLM] Process exited with code ${code}`);
      litellmProcess = null;
      weStartedIt = false;
      removePidFile();
      clearIdleTimer();
    });

    // Wait for startup
    const startTime = Date.now();
    while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, STARTUP_POLL_INTERVAL_MS));

      if (await isLiteLLMRunning()) {
        console.log(`[LiteLLM] Started in ${Date.now() - startTime}ms`);
        resetIdleTimer();
        return true;
      }
    }

    lastError = `LiteLLM failed to start within ${STARTUP_TIMEOUT_MS / 1000}s`;
    console.error(`[LiteLLM] ${lastError}`);

    if (litellmProcess) {
      litellmProcess.kill('SIGKILL');
      litellmProcess = null;
    }
    weStartedIt = false;
    removePidFile();

    return false;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error('[LiteLLM] Failed to start:', lastError);
    return false;
  }
}

export function stopLiteLLM(): void {
  clearIdleTimer();

  if (!weStartedIt) {
    console.log('[LiteLLM] Not our instance - skipping shutdown');
    return;
  }

  if (litellmProcess) {
    try {
      litellmProcess.kill('SIGTERM');
      console.log('[LiteLLM] Sent SIGTERM');
    } catch (error) {
      console.warn('[LiteLLM] Error killing process:', error);
    }
    litellmProcess = null;
  }

  weStartedIt = false;
  removePidFile();
}

// =============================================================================
// IDLE TIMEOUT
// =============================================================================

export function resetIdleTimer(): void {
  if (!weStartedIt) return;

  clearIdleTimer();

  idleTimer = setTimeout(() => {
    console.log('[LiteLLM] Idle timeout - stopping');
    stopLiteLLM();
  }, IDLE_TIMEOUT_MS);
}

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

// =============================================================================
// STATUS
// =============================================================================

export async function getStatus(): Promise<LiteLLMStatus> {
  const installed = await isLiteLLMInstalled();
  const running = await isLiteLLMRunning();

  return {
    installed,
    running,
    managedByApp: weStartedIt,
    port: currentPort,
    configuredModels,
    lastError,
  };
}

// =============================================================================
// CAPTIONING
// =============================================================================

/**
 * Caption an image using vision model
 */
export async function captionImage(
  imageBase64: string,
  model: string,
  prompt: string = 'Describe this wedding video frame in one sentence. Focus on the people, their actions, and the setting.'
): Promise<CaptionResult> {
  const startTime = Date.now();

  if (!(await isLiteLLMRunning())) {
    throw new Error('LiteLLM proxy not running');
  }

  resetIdleTimer();

  const response = await fetch(`http://localhost:${currentPort}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LiteLLM error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const caption = data.choices?.[0]?.message?.content || '';

  return {
    caption: caption.trim(),
    model: data.model || model,
    durationMs: Date.now() - startTime,
    tokens: data.usage
      ? {
          prompt: data.usage.prompt_tokens,
          completion: data.usage.completion_tokens,
        }
      : undefined,
  };
}

/**
 * Detect wedding moment type from image
 */
export async function detectWeddingMoment(
  imageBase64: string,
  model: string
): Promise<{
  moment: string;
  confidence: number;
  description: string;
}> {
  const startTime = Date.now();

  if (!(await isLiteLLMRunning())) {
    throw new Error('LiteLLM proxy not running');
  }

  resetIdleTimer();

  const prompt = `Analyze this wedding video frame and identify the type of moment.

Respond in JSON format:
{
  "moment": "one of: ceremony, vows, first_kiss, ring_exchange, walking_aisle, first_dance, parent_dance, cake_cutting, toasts, bouquet_toss, garter_toss, reception, getting_ready, portraits, group_photo, candid, other",
  "confidence": 0.0-1.0,
  "description": "brief description of what's happening"
}

Only respond with valid JSON.`;

  const response = await fetch(`http://localhost:${currentPort}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LiteLLM error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';

  try {
    const parsed = JSON.parse(content);
    return {
      moment: parsed.moment || 'other',
      confidence: parsed.confidence ?? 0.5,
      description: parsed.description || '',
    };
  } catch {
    return {
      moment: 'other',
      confidence: 0,
      description: content,
    };
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const litellmService = {
  isInstalled: isLiteLLMInstalled,
  isRunning: isLiteLLMRunning,
  start: startLiteLLM,
  stop: stopLiteLLM,
  getStatus,
  resetIdleTimer,
  cleanupOrphan,
  captionImage,
  detectWeddingMoment,
};

export default litellmService;
