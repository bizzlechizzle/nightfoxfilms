/**
 * Sidecar Service
 *
 * Writes JSON metadata sidecars alongside each media file.
 * Each video/audio file gets a companion .json file with the same base name.
 *
 * Example:
 *   source/modern/sony-a7s-iii/a1b2c3d4e5f67890.mp4
 *   source/modern/sony-a7s-iii/a1b2c3d4e5f67890.json  <- sidecar
 *
 * This makes each file self-documenting and orphan-proof.
 *
 * @module services/sidecar-service
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { File, FileMetadata, Camera, Couple, Medium, FootageType } from '@nightfox/core';

/**
 * Schema version for sidecar files
 * Increment when making breaking changes to the format
 */
const SIDECAR_SCHEMA_VERSION = '1.0';

/**
 * Sidecar file structure
 */
export interface FileSidecar {
  schema_version: string;
  generator: string;
  generated_at: string;

  // Identity
  blake3: string;
  original_filename: string;
  original_path: string | null;
  archive_path: string;

  // File info
  file_size: number | null;
  extension: string;
  file_type: string | null;
  footage_type: FootageType;

  // Technical metadata
  technical: {
    duration_seconds: number | null;
    width: number | null;
    height: number | null;
    frame_rate: number | null;
    codec: string | null;
    bitrate: number | null;
  };

  // Detection results
  detection: {
    medium: Medium | null;
    detected_make: string | null;
    detected_model: string | null;
    detected_lens: string | null;
  };

  // Camera info (if matched)
  camera: {
    id: number | null;
    name: string | null;
    nickname: string | null;
    medium: Medium | null;
    color_profile: string | null;
    lut_path: string | null;
  } | null;

  // Couple info
  couple: {
    id: number | null;
    name: string | null;
    wedding_date: string | null;
    folder_name: string | null;
  } | null;

  // Timestamps
  timestamps: {
    recorded_at: string | null;
    imported_at: string;
  };

  // Raw metadata (full extraction results)
  raw_metadata: {
    exiftool: Record<string, unknown> | null;
    ffprobe: Record<string, unknown> | null;
  };
}

/**
 * Build sidecar data from file and related records
 */
export function buildSidecarData(
  file: File,
  metadata: FileMetadata | null,
  camera: Camera | null,
  couple: Couple | null,
  archivePath: string
): FileSidecar {
  // Parse raw metadata JSON
  let exiftoolData: Record<string, unknown> | null = null;
  let ffprobeData: Record<string, unknown> | null = null;

  if (metadata?.exiftool_json) {
    try {
      exiftoolData = JSON.parse(metadata.exiftool_json);
    } catch {
      // Invalid JSON, leave as null
    }
  }

  if (metadata?.ffprobe_json) {
    try {
      ffprobeData = JSON.parse(metadata.ffprobe_json);
    } catch {
      // Invalid JSON, leave as null
    }
  }

  return {
    schema_version: SIDECAR_SCHEMA_VERSION,
    generator: 'nightfox-desktop',
    generated_at: new Date().toISOString(),

    blake3: file.blake3,
    original_filename: file.original_filename,
    original_path: file.original_path,
    archive_path: archivePath,

    file_size: file.file_size,
    extension: file.extension,
    file_type: file.file_type,
    footage_type: file.footage_type,

    technical: {
      duration_seconds: file.duration_seconds,
      width: file.width,
      height: file.height,
      frame_rate: file.frame_rate,
      codec: file.codec,
      bitrate: file.bitrate,
    },

    detection: {
      medium: file.medium,
      detected_make: file.detected_make,
      detected_model: file.detected_model,
      detected_lens: file.detected_lens,
    },

    camera: camera
      ? {
          id: camera.id,
          name: camera.name,
          nickname: camera.nickname,
          medium: camera.medium,
          color_profile: camera.color_profile,
          lut_path: camera.lut_path,
        }
      : null,

    couple: couple
      ? {
          id: couple.id,
          name: couple.name,
          wedding_date: couple.wedding_date,
          folder_name: couple.folder_name,
        }
      : null,

    timestamps: {
      recorded_at: file.recorded_at,
      imported_at: file.imported_at,
    },

    raw_metadata: {
      exiftool: exiftoolData,
      ffprobe: ffprobeData,
    },
  };
}

/**
 * Write sidecar JSON file next to the media file
 */
export async function writeSidecar(
  file: File,
  metadata: FileMetadata | null,
  camera: Camera | null,
  couple: Couple | null
): Promise<{ success: boolean; sidecarPath: string | null; error: string | null }> {
  // Need managed_path to know where to write sidecar
  if (!file.managed_path) {
    return {
      success: false,
      sidecarPath: null,
      error: 'No managed_path - file not in managed storage',
    };
  }

  // Build sidecar path (same name, .json extension)
  const parsed = path.parse(file.managed_path);
  const sidecarPath = path.join(parsed.dir, `${parsed.name}.json`);

  try {
    const sidecarData = buildSidecarData(file, metadata, camera, couple, file.managed_path);

    // Write with pretty formatting for human readability
    await fs.writeFile(sidecarPath, JSON.stringify(sidecarData, null, 2), 'utf-8');

    console.log(`[Sidecar] Written: ${sidecarPath}`);

    return {
      success: true,
      sidecarPath,
      error: null,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Sidecar] Failed to write ${sidecarPath}:`, errorMsg);

    return {
      success: false,
      sidecarPath: null,
      error: errorMsg,
    };
  }
}

/**
 * Write sidecars for multiple files
 */
export async function writeSidecars(
  files: Array<{
    file: File;
    metadata: FileMetadata | null;
    camera: Camera | null;
    couple: Couple | null;
  }>,
  options?: {
    onProgress?: (current: number, total: number, filename: string) => void;
  }
): Promise<{
  total: number;
  written: number;
  skipped: number;
  errors: number;
  results: Array<{ blake3: string; success: boolean; sidecarPath: string | null; error: string | null }>;
}> {
  const results: Array<{
    blake3: string;
    success: boolean;
    sidecarPath: string | null;
    error: string | null;
  }> = [];

  let written = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    const { file, metadata, camera, couple } = files[i];

    if (options?.onProgress) {
      options.onProgress(i + 1, files.length, file.original_filename);
    }

    // Skip files without managed_path
    if (!file.managed_path) {
      skipped++;
      results.push({
        blake3: file.blake3,
        success: false,
        sidecarPath: null,
        error: 'No managed_path',
      });
      continue;
    }

    const result = await writeSidecar(file, metadata, camera, couple);
    results.push({
      blake3: file.blake3,
      ...result,
    });

    if (result.success) {
      written++;
    } else {
      errors++;
    }
  }

  return {
    total: files.length,
    written,
    skipped,
    errors,
    results,
  };
}

/**
 * Read and parse an existing sidecar file
 */
export async function readSidecar(sidecarPath: string): Promise<FileSidecar | null> {
  try {
    const content = await fs.readFile(sidecarPath, 'utf-8');
    return JSON.parse(content) as FileSidecar;
  } catch {
    return null;
  }
}

/**
 * Get sidecar path for a media file
 */
export function getSidecarPath(mediaPath: string): string {
  const parsed = path.parse(mediaPath);
  return path.join(parsed.dir, `${parsed.name}.json`);
}

/**
 * Check if sidecar exists for a media file
 */
export async function sidecarExists(mediaPath: string): Promise<boolean> {
  const sidecarPath = getSidecarPath(mediaPath);
  try {
    await fs.access(sidecarPath);
    return true;
  } catch {
    return false;
  }
}
