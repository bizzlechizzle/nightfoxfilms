/**
 * Screenshot Tool Service
 *
 * Manages the Python ML server for screenshot extraction.
 * Handles server lifecycle, health checks, and API communication.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// API response types
export interface HealthResponse {
  status: string;
  models_loaded: boolean;
  device: string;
  current_job: string | null;
  job_progress: number;
  job_message: string;
}

export interface AnalyzeOptions {
  sharpness_threshold?: number;
  cluster_eps?: number;
  cluster_min_samples?: number;
  ram_model_path?: string;
  lut_path?: string;  // Auto-detected from camera or manually specified
}

export interface CropCoordinates {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
}

export interface FaceData {
  bbox: number[];
  confidence: number;
  landmarks?: number[][];
  embedding?: number[];
  age?: number;
  gender?: string;
  pose?: number[];
  smile_score?: number;
}

export interface FrameCandidate {
  frame_number: number;
  timestamp: number;
  image_path: string;  // LUT-graded preview (for ML analysis and display)
  raw_path?: string;   // Original LOG/RAW frame (for final export)
  sharpness_score: number;
  nima_score: number;
  faces: FaceData[];
  tags: string[];
  caption?: string;
  crops: Record<string, CropCoordinates>;
  aesthetic_score: number;
  is_broll: boolean;
  scene_index: number;
  cluster_labels: Record<string, number>;
}

export interface AnalyzeResult {
  success: boolean;
  job_id?: string;
  candidates: FrameCandidate[];
  errors: string[];
  total_scenes: number;
  total_candidates: number;
}

export interface ProgressInfo {
  job_id: string | null;
  progress: number;
  message: string;
  complete: boolean;
}

class ScreenshotToolService {
  private serverProcess: ChildProcess | null = null;
  private serverUrl: string = 'http://127.0.0.1:8765';
  private isReady: boolean = false;
  private startupPromise: Promise<void> | null = null;

  /**
   * Get the path to the Python directory.
   */
  private getPythonDir(): string {
    // In development, it's relative to the electron directory
    // In production, it may be in resources
    const devPath = path.join(__dirname, '../../python');
    if (fs.existsSync(devPath)) {
      return devPath;
    }

    // Try resources path for packaged app
    const resourcesPath = path.join(process.resourcesPath || '', 'python');
    if (fs.existsSync(resourcesPath)) {
      return resourcesPath;
    }

    return devPath;
  }

  /**
   * Find Python executable.
   */
  private findPython(): string {
    // Check for virtual environment first
    const pythonDir = this.getPythonDir();
    const venvPython = path.join(pythonDir, 'venv', 'bin', 'python');
    const venvPythonWin = path.join(pythonDir, 'venv', 'Scripts', 'python.exe');

    if (fs.existsSync(venvPython)) {
      return venvPython;
    }
    if (fs.existsSync(venvPythonWin)) {
      return venvPythonWin;
    }

    // Fall back to system Python
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  /**
   * Check if Python dependencies are installed.
   */
  async checkDependencies(): Promise<{ installed: boolean; missing: string[] }> {
    const python = this.findPython();
    const missing: string[] = [];

    // Check for required packages
    const requiredPackages = [
      'fastapi',
      'uvicorn',
      'torch',
      'cv2',
      'numpy',
      'PIL',
    ];

    for (const pkg of requiredPackages) {
      try {
        const { execSync } = await import('child_process');
        execSync(`${python} -c "import ${pkg}"`, { stdio: 'pipe' });
      } catch {
        missing.push(pkg);
      }
    }

    return {
      installed: missing.length === 0,
      missing,
    };
  }

  /**
   * Start the Python server.
   */
  async start(): Promise<void> {
    if (this.isReady) {
      return;
    }

    if (this.startupPromise) {
      return this.startupPromise;
    }

    this.startupPromise = new Promise((resolve, reject) => {
      const python = this.findPython();
      const pythonDir = this.getPythonDir();

      console.log('[ScreenshotTool] Starting Python server...');
      console.log('[ScreenshotTool] Python:', python);
      console.log('[ScreenshotTool] Python dir:', pythonDir);

      // Start the server as a module
      this.serverProcess = spawn(python, ['-m', 'screenshot_tool.server'], {
        cwd: pythonDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONPATH: pythonDir,
        },
      });

      let startupComplete = false;
      const timeout = setTimeout(() => {
        if (!startupComplete) {
          console.error('[ScreenshotTool] Server startup timeout');
          this.startupPromise = null;
          reject(new Error('Server startup timeout'));
        }
      }, 120000); // 2 minute timeout for model loading

      // Handle stdout
      this.serverProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        console.log(`[ScreenshotTool] ${output.trim()}`);

        // Check if server is ready
        if (output.includes('Uvicorn running') || output.includes('Application startup complete')) {
          startupComplete = true;
          clearTimeout(timeout);
          this.isReady = true;
          this.startupPromise = null;
          resolve();
        }
      });

      // Handle stderr
      this.serverProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        // Uvicorn logs to stderr, so check for startup message here too
        if (output.includes('Uvicorn running') || output.includes('Application startup complete')) {
          startupComplete = true;
          clearTimeout(timeout);
          this.isReady = true;
          this.startupPromise = null;
          resolve();
        }
        console.error(`[ScreenshotTool] ${output.trim()}`);
      });

      // Handle process exit
      this.serverProcess.on('close', (code: number | null) => {
        console.log(`[ScreenshotTool] Process exited with code ${code}`);
        this.isReady = false;
        this.serverProcess = null;
        this.startupPromise = null;

        if (!startupComplete) {
          clearTimeout(timeout);
          reject(new Error(`Server process exited with code ${code}`));
        }
      });

      // Handle process error
      this.serverProcess.on('error', (error: Error) => {
        console.error('[ScreenshotTool] Process error:', error);
        this.isReady = false;
        this.serverProcess = null;
        this.startupPromise = null;
        clearTimeout(timeout);
        reject(error);
      });
    });

    return this.startupPromise;
  }

  /**
   * Stop the Python server.
   */
  stop(): void {
    if (this.serverProcess) {
      console.log('[ScreenshotTool] Stopping server...');
      this.serverProcess.kill();
      this.serverProcess = null;
      this.isReady = false;
    }
  }

  /**
   * Check if server is healthy.
   */
  async healthCheck(): Promise<HealthResponse | null> {
    try {
      const response = await fetch(`${this.serverUrl}/health`);
      if (response.ok) {
        return await response.json() as HealthResponse;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Wait for server to be ready.
   */
  async waitForReady(timeoutMs: number = 60000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const health = await this.healthCheck();
      if (health?.status === 'healthy') {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return false;
  }

  /**
   * Ensure server is running.
   */
  async ensureRunning(): Promise<void> {
    const health = await this.healthCheck();
    if (!health) {
      await this.start();
      const ready = await this.waitForReady();
      if (!ready) {
        throw new Error('Failed to start screenshot tool server');
      }
    }
  }

  /**
   * Get current job progress.
   */
  async getProgress(): Promise<ProgressInfo> {
    await this.ensureRunning();

    const response = await fetch(`${this.serverUrl}/progress`);
    if (!response.ok) {
      throw new Error(`Progress request failed: ${response.statusText}`);
    }

    return await response.json() as ProgressInfo;
  }

  /**
   * Run full analysis on a video.
   */
  async analyzeVideo(
    videoPath: string,
    outputDir: string,
    options: AnalyzeOptions = {}
  ): Promise<AnalyzeResult> {
    await this.ensureRunning();

    const response = await fetch(`${this.serverUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_path: videoPath,
        output_dir: outputDir,
        options,
      }),
    });

    if (!response.ok) {
      throw new Error(`Analysis request failed: ${response.statusText}`);
    }

    return await response.json() as AnalyzeResult;
  }

  /**
   * Detect scenes in a video.
   */
  async detectScenes(
    videoPath: string,
    threshold: number = 0.5
  ): Promise<{ start: number; end: number }[]> {
    await this.ensureRunning();

    const response = await fetch(`${this.serverUrl}/detect-scenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_path: videoPath, threshold }),
    });

    if (!response.ok) {
      throw new Error(`Scene detection failed: ${response.statusText}`);
    }

    const result = await response.json() as { success: boolean; scenes: { start: number; end: number }[]; error?: string };
    if (!result.success) {
      throw new Error(result.error || 'Scene detection failed');
    }

    return result.scenes;
  }

  /**
   * Detect faces in an image.
   */
  async detectFaces(imagePath: string): Promise<FaceData[]> {
    await this.ensureRunning();

    const response = await fetch(`${this.serverUrl}/detect-faces-path?image_path=${encodeURIComponent(imagePath)}`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Face detection failed: ${response.statusText}`);
    }

    const result = await response.json() as { success: boolean; faces: FaceData[]; error?: string };
    if (!result.success) {
      throw new Error(result.error || 'Face detection failed');
    }

    return result.faces;
  }

  /**
   * Generate tags for an image.
   */
  async tagImage(imagePath: string): Promise<string[]> {
    await this.ensureRunning();

    const response = await fetch(`${this.serverUrl}/tag-path?image_path=${encodeURIComponent(imagePath)}`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Tagging failed: ${response.statusText}`);
    }

    const result = await response.json() as { success: boolean; tags: string[]; error?: string };
    if (!result.success) {
      throw new Error(result.error || 'Tagging failed');
    }

    return result.tags;
  }

  /**
   * Generate smart crops for an image.
   */
  async generateCrops(
    imagePath: string,
    faces?: FaceData[]
  ): Promise<Record<string, CropCoordinates>> {
    await this.ensureRunning();

    const response = await fetch(`${this.serverUrl}/generate-crops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_path: imagePath, faces }),
    });

    if (!response.ok) {
      throw new Error(`Crop generation failed: ${response.statusText}`);
    }

    const result = await response.json() as { success: boolean; crops: Record<string, CropCoordinates>; error?: string };
    if (!result.success) {
      throw new Error(result.error || 'Crop generation failed');
    }

    return result.crops;
  }

  /**
   * Get quality score for an image.
   */
  async getQualityScore(imagePath: string): Promise<{ sharpness: number; is_sharp: boolean }> {
    await this.ensureRunning();

    const response = await fetch(`${this.serverUrl}/quality-score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_path: imagePath }),
    });

    if (!response.ok) {
      throw new Error(`Quality scoring failed: ${response.statusText}`);
    }

    const result = await response.json() as { success: boolean; sharpness: number; is_sharp: boolean; error?: string };
    if (!result.success) {
      throw new Error(result.error || 'Quality scoring failed');
    }

    return { sharpness: result.sharpness, is_sharp: result.is_sharp };
  }

  /**
   * Cluster face embeddings.
   */
  async clusterFaces(
    embeddings: number[][],
    eps: number = 0.5,
    minSamples: number = 2
  ): Promise<{ labels: number[]; cluster_info: Record<string, { count: number; indices: number[] }> }> {
    await this.ensureRunning();

    const response = await fetch(`${this.serverUrl}/cluster-faces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeddings, eps, min_samples: minSamples }),
    });

    if (!response.ok) {
      throw new Error(`Clustering failed: ${response.statusText}`);
    }

    const result = await response.json() as {
      success: boolean;
      labels: number[];
      cluster_info: Record<string, { count: number; indices: number[] }>;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'Clustering failed');
    }

    return { labels: result.labels, cluster_info: result.cluster_info };
  }
}

// Export singleton instance
export const screenshotToolService = new ScreenshotToolService();
