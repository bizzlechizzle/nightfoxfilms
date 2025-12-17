/**
 * Job Handlers
 *
 * Implementations for each background job type.
 */

import { spawn, exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import type { Job, JobType, ScreenshotInput } from '@nightfox/core';
import { filesRepository } from '../repositories/files-repository';
import { screenshotsRepository } from '../repositories/screenshots-repository';
import { camerasRepository } from '../repositories/cameras-repository';
import { couplesRepository } from '../repositories/couples-repository';
import { JobHandler, JobWorker } from './job-worker';

const execAsync = promisify(exec);

// ES Module compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Python venv path
const PYTHON_VENV = path.join(__dirname, '../../python/venv/bin/python');
const SCREENSHOT_TOOL = path.join(__dirname, '../../python/screenshot_tool/pipeline.py');

/**
 * Blake3 hash validation handler
 */
export const blake3Handler: JobHandler = async (job, onProgress) => {
  const payload = JSON.parse(job.payload_json);
  const filePath = payload.file_path;

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  onProgress(10, 'Computing BLAKE3 hash...');

  // Use b3sum command line tool
  const { stdout } = await execAsync(`b3sum "${filePath}"`);
  const hash = stdout.trim().split(/\s+/)[0];

  onProgress(80, 'Updating database...');

  // Update file record with hash
  if (job.file_id) {
    const file = filesRepository.findById(job.file_id);
    if (file && file.blake3 !== hash) {
      // Hash changed - this is a problem
      throw new Error(`Hash mismatch: expected ${file.blake3}, got ${hash}`);
    }
  }

  onProgress(100, 'Hash validated');
};

/**
 * Thumbnail generation handler
 */
export const thumbnailHandler: JobHandler = async (job, onProgress) => {
  const payload = JSON.parse(job.payload_json);
  const filePath = payload.file_path;

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const file = job.file_id ? filesRepository.findById(job.file_id) : null;
  if (!file) {
    throw new Error('File record not found');
  }

  onProgress(10, 'Generating thumbnail...');

  // Determine output path
  let thumbnailDir: string;
  if (file.couple_id) {
    const couple = couplesRepository.findById(file.couple_id);
    if (couple?.working_path) {
      thumbnailDir = path.join(couple.working_path, 'thumbnails');
    } else {
      thumbnailDir = path.join(path.dirname(filePath), 'thumbnails');
    }
  } else {
    thumbnailDir = path.join(path.dirname(filePath), 'thumbnails');
  }

  fs.mkdirSync(thumbnailDir, { recursive: true });
  const thumbnailPath = path.join(thumbnailDir, `${file.blake3}.jpg`);

  // Get LUT path from camera if available
  let lutFilter = '';
  if (file.camera_id) {
    const camera = camerasRepository.findById(file.camera_id);
    if (camera?.lut_path && fs.existsSync(camera.lut_path)) {
      lutFilter = `,lut3d='${camera.lut_path}'`;
    }
  }

  onProgress(30, 'Extracting frame...');

  // Extract thumbnail at 1 second mark (or middle if shorter)
  const duration = file.duration_seconds || 10;
  const timestamp = Math.min(1, duration / 2);

  const ffmpegCmd = `ffmpeg -y -ss ${timestamp} -i "${filePath}" -vframes 1 -vf "scale=480:-1${lutFilter}" -q:v 2 "${thumbnailPath}"`;

  await execAsync(ffmpegCmd);

  if (!fs.existsSync(thumbnailPath)) {
    throw new Error('Thumbnail generation failed');
  }

  onProgress(80, 'Updating database...');

  filesRepository.updateThumbnailPath(file.id, thumbnailPath);

  onProgress(100, 'Thumbnail generated');
};

/**
 * Proxy video generation handler
 */
export const proxyHandler: JobHandler = async (job, onProgress) => {
  const payload = JSON.parse(job.payload_json);
  const filePath = payload.file_path;

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const file = job.file_id ? filesRepository.findById(job.file_id) : null;
  if (!file) {
    throw new Error('File record not found');
  }

  onProgress(5, 'Preparing proxy generation...');

  // Determine output path
  let proxyDir: string;
  if (file.couple_id) {
    const couple = couplesRepository.findById(file.couple_id);
    if (couple?.working_path) {
      proxyDir = path.join(couple.working_path, 'proxies');
    } else {
      proxyDir = path.join(path.dirname(filePath), 'proxies');
    }
  } else {
    proxyDir = path.join(path.dirname(filePath), 'proxies');
  }

  fs.mkdirSync(proxyDir, { recursive: true });
  const proxyPath = path.join(proxyDir, `${file.blake3}_proxy.mp4`);

  // Get LUT path from camera if available
  let lutFilter = '';
  if (file.camera_id) {
    const camera = camerasRepository.findById(file.camera_id);
    if (camera?.lut_path && fs.existsSync(camera.lut_path)) {
      lutFilter = `,lut3d='${camera.lut_path}'`;
    }
  }

  onProgress(10, 'Generating proxy video...');

  // Generate 720p proxy with H.264
  // Using -progress pipe:1 to track progress
  const ffmpegArgs = [
    '-y',
    '-i', filePath,
    '-vf', `scale=1280:-2${lutFilter}`,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    proxyPath,
  ];

  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    let lastProgress = 10;

    ffmpeg.stderr.on('data', (data: Buffer) => {
      const line = data.toString();
      // Parse FFmpeg progress
      const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2})/);
      if (timeMatch && file.duration_seconds) {
        const hours = parseInt(timeMatch[1]);
        const mins = parseInt(timeMatch[2]);
        const secs = parseInt(timeMatch[3]);
        const currentTime = hours * 3600 + mins * 60 + secs;
        const progress = Math.min(95, 10 + Math.floor((currentTime / file.duration_seconds) * 85));
        if (progress > lastProgress) {
          lastProgress = progress;
          onProgress(progress, `Encoding: ${Math.floor(progress)}%`);
        }
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0 && fs.existsSync(proxyPath)) {
        onProgress(98, 'Updating database...');
        filesRepository.updateProxyPath(file.id, proxyPath);
        onProgress(100, 'Proxy generated');
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', reject);
  });
};

/**
 * Screenshot extraction handler - runs the Python ML pipeline
 */
export const screenshotExtractHandler: JobHandler = async (job, onProgress) => {
  const payload = JSON.parse(job.payload_json);
  const filePath = payload.file_path;

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const file = job.file_id ? filesRepository.findById(job.file_id) : null;
  if (!file) {
    throw new Error('File record not found');
  }

  onProgress(5, 'Preparing screenshot extraction...');

  // Determine output directory
  let screenshotDir: string;
  if (file.couple_id) {
    const couple = couplesRepository.findById(file.couple_id);
    if (couple?.working_path) {
      screenshotDir = path.join(couple.working_path, 'screenshots', file.blake3);
    } else {
      screenshotDir = path.join(path.dirname(filePath), 'screenshots', file.blake3);
    }
  } else {
    screenshotDir = path.join(path.dirname(filePath), 'screenshots', file.blake3);
  }

  fs.mkdirSync(screenshotDir, { recursive: true });

  // Get LUT path from camera
  let lutPath: string | null = null;
  if (file.camera_id) {
    const camera = camerasRepository.findById(file.camera_id);
    if (camera?.lut_path && fs.existsSync(camera.lut_path)) {
      lutPath = camera.lut_path;
    }
  }

  onProgress(10, 'Running ML pipeline...');

  // Build options JSON
  const options = {
    lut_path: lutPath,
    analyze_audio: true,
    select_variety: true,
    min_per_scene: 1,
    sharpness_threshold: 100.0,
  };

  // Run Python pipeline
  return new Promise<void>((resolve, reject) => {
    const pythonArgs = [
      SCREENSHOT_TOOL,
      filePath,
      screenshotDir,
      '--options', JSON.stringify(options),
    ];

    const python = spawn(PYTHON_VENV, pythonArgs, {
      cwd: path.dirname(SCREENSHOT_TOOL),
    });

    let stdout = '';
    let stderr = '';
    let lastProgress = 10;

    python.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      // Parse progress from output
      const progressMatch = data.toString().match(/\[(\d+)%\]/);
      if (progressMatch) {
        const pct = parseInt(progressMatch[1]);
        if (pct > lastProgress) {
          lastProgress = pct;
          onProgress(pct, `Processing: ${pct}%`);
        }
      }
    });

    python.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
      // Also check stderr for progress
      const progressMatch = data.toString().match(/\[(\d+)%\]/);
      if (progressMatch) {
        const pct = parseInt(progressMatch[1]);
        if (pct > lastProgress) {
          lastProgress = pct;
          onProgress(pct, `Processing: ${pct}%`);
        }
      }
    });

    python.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`Python pipeline failed: ${stderr}`));
        return;
      }

      try {
        onProgress(95, 'Saving screenshots to database...');

        // Read results JSON
        const resultsPath = path.join(screenshotDir, 'results.json');
        if (!fs.existsSync(resultsPath)) {
          throw new Error('Results file not found');
        }

        const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
        const candidates = results.candidates || [];

        // Clear existing screenshots for this file
        screenshotsRepository.deleteByFile(file.id);

        // Insert new screenshots
        const screenshotInputs: ScreenshotInput[] = candidates.map((c: any) => ({
          file_id: file.id,
          couple_id: file.couple_id,
          frame_number: c.frame_number,
          timestamp_seconds: c.timestamp,
          scene_index: c.scene_index || 0,
          preview_path: c.image_path,
          raw_path: c.raw_path || null,
          sharpness_score: c.sharpness_score || 0,
          face_count: c.faces?.length || 0,
          max_smile_score: c.faces?.reduce(
            (max: number, f: any) => Math.max(max, f.smile_score || 0),
            0
          ) || 0,
          is_broll: c.is_broll ? 1 : 0,
          is_audio_peak: c.is_audio_peak ? 1 : 0,
          audio_type: c.audio_type || null,
          faces_json: c.faces ? JSON.stringify(c.faces) : null,
          crops_json: c.crops ? JSON.stringify(c.crops) : null,
          tags_json: c.tags ? JSON.stringify(c.tags) : null,
        }));

        screenshotsRepository.createMany(screenshotInputs);

        onProgress(98, 'Setting best thumbnail...');

        // Auto-set best screenshot as thumbnail
        const best = screenshotsRepository.autoSetThumbnail(file.id);
        if (best) {
          filesRepository.updateThumbnailPath(file.id, best.preview_path);
        }

        onProgress(100, `Extracted ${candidates.length} screenshots`);
        resolve();
      } catch (error) {
        reject(error);
      }
    });

    python.on('error', reject);
  });
};

/**
 * Thumbnail update handler - sets best screenshot as file thumbnail
 */
export const thumbnailUpdateHandler: JobHandler = async (job, onProgress) => {
  const file = job.file_id ? filesRepository.findById(job.file_id) : null;
  if (!file) {
    throw new Error('File record not found');
  }

  onProgress(20, 'Finding best screenshot...');

  const best = screenshotsRepository.findBestForFile(file.id);
  if (!best) {
    throw new Error('No screenshots found for file');
  }

  onProgress(60, 'Updating thumbnail...');

  screenshotsRepository.setAsThumbnail(file.id, best.id);
  filesRepository.updateThumbnailPath(file.id, best.preview_path);

  onProgress(100, 'Thumbnail updated');
};

/**
 * Register all handlers with the job worker
 */
export function registerJobHandlers(worker: JobWorker): void {
  worker.registerHandler('blake3', blake3Handler);
  worker.registerHandler('thumbnail', thumbnailHandler);
  worker.registerHandler('proxy', proxyHandler);
  worker.registerHandler('screenshot_extract', screenshotExtractHandler);
  worker.registerHandler('thumbnail_update', thumbnailUpdateHandler);
}
