/**
 * Proxy Service
 *
 * Generates 1080p proxy files for preview playback.
 * Simple transcodes with no color correction - LUTs applied manually in NLE.
 *
 * Output structure:
 *   {working_path}/{folder_name}/proxies/{hash}_proxy.mp4
 *
 * @module services/proxy-service
 */

import { promises as fs, existsSync } from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

/**
 * Result of proxy generation
 */
export interface ProxyResult {
  success: boolean;
  proxyPath: string | null;
  error: string | null;
  durationMs: number;
}

/**
 * Default proxy settings
 */
const DEFAULT_PROXY_HEIGHT = 1080;
const DEFAULT_CRF = 23;
const DEFAULT_PRESET = 'fast';
const PROXY_SUFFIX = '_proxy';

/**
 * Generate a 1080p proxy with optional LUT application
 *
 * @param inputPath - Source video file path
 * @param outputDir - Directory to save proxy (e.g., {couple_folder}/proxies)
 * @param hash - BLAKE3 hash of the file (used as filename)
 * @param lutPath - Optional LUT file path (e.g., for S-Log to Rec.709 conversion)
 * @returns ProxyResult with path to generated proxy
 */
export async function generateProxy(
  inputPath: string,
  outputDir: string,
  hash: string,
  lutPath?: string
): Promise<ProxyResult> {
  const startTime = Date.now();

  try {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, `${hash}${PROXY_SUFFIX}.mp4`);

    // Check if proxy already exists
    try {
      await fs.access(outputPath);
      console.log(`[ProxyService] Proxy already exists: ${outputPath}`);
      return {
        success: true,
        proxyPath: outputPath,
        error: null,
        durationMs: Date.now() - startTime,
      };
    } catch {
      // File doesn't exist, continue with generation
    }

    // Build filter chain: scale first, then LUT if provided
    const filters: string[] = [`scale=-2:${DEFAULT_PROXY_HEIGHT}`];
    if (lutPath && existsSync(lutPath)) {
      filters.push(`lut3d='${lutPath}'`);
      console.log(`[ProxyService] Applying LUT: ${lutPath}`);
    }

    // Generate proxy - 1080p transcode with optional LUT
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          `-preset ${DEFAULT_PRESET}`,
          `-crf ${DEFAULT_CRF}`,
          '-c:a aac',
          '-b:a 128k',
          '-movflags +faststart',
        ])
        .videoFilters(filters)
        .output(outputPath)
        .on('start', (cmdLine) => {
          console.log(`[ProxyService] FFmpeg command: ${cmdLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`[ProxyService] Progress: ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('error', (error) => {
          reject(new Error(`FFmpeg error: ${error.message}`));
        })
        .on('end', () => {
          resolve();
        })
        .run();
    });

    const durationMs = Date.now() - startTime;
    console.log(`[ProxyService] Generated proxy in ${(durationMs / 1000).toFixed(1)}s: ${outputPath}`);

    return {
      success: true,
      proxyPath: outputPath,
      error: null,
      durationMs,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ProxyService] Failed to generate proxy for ${inputPath}: ${errorMsg}`);
    return {
      success: false,
      proxyPath: null,
      error: errorMsg,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Generate proxy for a camera file
 *
 * @param inputPath - Source video file path
 * @param coupleDir - Couple folder path
 * @param hash - BLAKE3 hash of the file
 * @param lutPath - Optional LUT file path (e.g., for S-Log to Rec.709 conversion)
 * @returns ProxyResult
 */
export async function generateCameraProxy(
  inputPath: string,
  coupleDir: string,
  hash: string,
  lutPath?: string
): Promise<ProxyResult> {
  const proxyDir = path.join(coupleDir, 'proxies');
  return generateProxy(inputPath, proxyDir, hash, lutPath);
}

/**
 * Batch generate proxies for multiple files
 *
 * @param files - Array of files to process (with optional per-file lutPath)
 * @param coupleDir - Couple folder path
 * @param onProgress - Progress callback
 * @param defaultLutPath - Default LUT to apply if file doesn't have its own
 * @returns Array of results
 */
export async function batchGenerateProxies(
  files: Array<{
    inputPath: string;
    hash: string;
    lutPath?: string;
  }>,
  coupleDir: string,
  onProgress?: (current: number, total: number, filename: string) => void,
  defaultLutPath?: string
): Promise<ProxyResult[]> {
  const results: ProxyResult[] = [];
  const proxyDir = path.join(coupleDir, 'proxies');

  // Ensure directory exists
  await fs.mkdir(proxyDir, { recursive: true });

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i, files.length, path.basename(file.inputPath));

    const lutToUse = file.lutPath || defaultLutPath;
    const result = await generateProxy(file.inputPath, proxyDir, file.hash, lutToUse);
    results.push(result);
  }

  onProgress?.(files.length, files.length, 'Complete');

  return results;
}

/**
 * Check if proxy exists for a file
 */
export async function proxyExists(coupleDir: string, hash: string): Promise<boolean> {
  const proxyPath = path.join(coupleDir, 'proxies', `${hash}${PROXY_SUFFIX}.mp4`);
  try {
    await fs.access(proxyPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get proxy path for a file (doesn't check existence)
 */
export function getProxyPath(coupleDir: string, hash: string): string {
  return path.join(coupleDir, 'proxies', `${hash}${PROXY_SUFFIX}.mp4`);
}
