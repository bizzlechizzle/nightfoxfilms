/**
 * Camera Matcher Service
 *
 * Matches files to camera profiles using pattern matching.
 * Pattern priority: filename > folder > extension > metadata
 */

import { minimatch } from 'minimatch';
import path from 'path';
import type { CameraPattern, Camera, Medium, CameraWithPatterns } from '@nightfox/core';

/**
 * Match result from camera detection
 */
export interface CameraMatchResult {
  camera_id: number;
  camera_name: string;
  medium: Medium;
  matched_by: 'filename' | 'folder' | 'extension' | 'metadata' | 'default';
  pattern_id?: number;
  confidence: number; // 0-1, higher is more confident
}

/**
 * Match a file against camera patterns
 *
 * @param filePath - Full path to the file
 * @param cameras - Array of cameras with their patterns
 * @param detectedMake - Camera make from metadata (optional)
 * @param detectedModel - Camera model from metadata (optional)
 * @returns Match result or null if no match
 */
export function matchFileToCamera(
  filePath: string,
  cameras: CameraWithPatterns[],
  detectedMake?: string | null,
  detectedModel?: string | null
): CameraMatchResult | null {
  const fileName = path.basename(filePath);
  const folderName = path.basename(path.dirname(filePath));
  const extension = path.extname(filePath).toLowerCase();

  // Build a list of all patterns with their cameras, sorted by priority
  const allPatterns: Array<{
    pattern: CameraPattern;
    camera: CameraWithPatterns;
  }> = [];

  for (const camera of cameras) {
    for (const pattern of camera.patterns) {
      allPatterns.push({ pattern, camera });
    }
  }

  // Sort by priority (lower number = higher priority)
  allPatterns.sort((a, b) => a.pattern.priority - b.pattern.priority);

  // Try filename patterns first
  for (const { pattern, camera } of allPatterns) {
    if (pattern.pattern_type === 'filename') {
      if (matchPattern(fileName, pattern.pattern)) {
        return {
          camera_id: camera.id,
          camera_name: camera.name,
          medium: camera.medium,
          matched_by: 'filename',
          pattern_id: pattern.id,
          confidence: 0.95,
        };
      }
    }
  }

  // Try folder patterns
  for (const { pattern, camera } of allPatterns) {
    if (pattern.pattern_type === 'folder') {
      if (matchPattern(folderName, pattern.pattern)) {
        return {
          camera_id: camera.id,
          camera_name: camera.name,
          medium: camera.medium,
          matched_by: 'folder',
          pattern_id: pattern.id,
          confidence: 0.85,
        };
      }
    }
  }

  // Try extension patterns
  for (const { pattern, camera } of allPatterns) {
    if (pattern.pattern_type === 'extension') {
      const patternExt = pattern.pattern.startsWith('.')
        ? pattern.pattern.toLowerCase()
        : `.${pattern.pattern.toLowerCase()}`;
      if (extension === patternExt) {
        return {
          camera_id: camera.id,
          camera_name: camera.name,
          medium: camera.medium,
          matched_by: 'extension',
          pattern_id: pattern.id,
          confidence: 0.6,
        };
      }
    }
  }

  // Try metadata match (make/model)
  if (detectedMake || detectedModel) {
    for (const camera of cameras) {
      // Match on make and model if both are provided
      if (camera.make && camera.model) {
        const makeMatch = detectedMake?.toLowerCase().includes(camera.make.toLowerCase());
        const modelMatch = detectedModel?.toLowerCase().includes(camera.model.toLowerCase());
        if (makeMatch && modelMatch) {
          return {
            camera_id: camera.id,
            camera_name: camera.name,
            medium: camera.medium,
            matched_by: 'metadata',
            confidence: 0.9,
          };
        }
      }
      // Match on model only if no make specified
      if (!camera.make && camera.model) {
        if (detectedModel?.toLowerCase().includes(camera.model.toLowerCase())) {
          return {
            camera_id: camera.id,
            camera_name: camera.name,
            medium: camera.medium,
            matched_by: 'metadata',
            confidence: 0.75,
          };
        }
      }
      // Match on make only if no model specified
      if (camera.make && !camera.model) {
        if (detectedMake?.toLowerCase().includes(camera.make.toLowerCase())) {
          return {
            camera_id: camera.id,
            camera_name: camera.name,
            medium: camera.medium,
            matched_by: 'metadata',
            confidence: 0.5,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Match a string against a glob pattern
 */
function matchPattern(str: string, pattern: string): boolean {
  // Support both glob patterns and simple contains
  if (pattern.includes('*') || pattern.includes('?') || pattern.includes('[')) {
    return minimatch(str, pattern, { nocase: true });
  }
  // Simple substring match for non-glob patterns
  return str.toLowerCase().includes(pattern.toLowerCase());
}

/**
 * Find the default camera for a given medium
 */
export function findDefaultCamera(
  cameras: CameraWithPatterns[],
  medium: Medium
): CameraWithPatterns | null {
  return cameras.find((c) => c.medium === medium && c.is_default === 1) ?? null;
}

/**
 * Match file with fallback to default camera
 */
export function matchFileWithDefault(
  filePath: string,
  cameras: CameraWithPatterns[],
  defaultMedium: Medium = 'modern',
  detectedMake?: string | null,
  detectedModel?: string | null
): CameraMatchResult {
  // Try pattern matching first
  const match = matchFileToCamera(filePath, cameras, detectedMake, detectedModel);
  if (match) return match;

  // Fall back to default camera for the medium
  const defaultCamera = findDefaultCamera(cameras, defaultMedium);
  if (defaultCamera) {
    return {
      camera_id: defaultCamera.id,
      camera_name: defaultCamera.name,
      medium: defaultCamera.medium,
      matched_by: 'default',
      confidence: 0.1,
    };
  }

  // Last resort: return a generic unknown camera (id 0 means unmatched)
  return {
    camera_id: 0,
    camera_name: 'Unknown Camera',
    medium: defaultMedium,
    matched_by: 'default',
    confidence: 0,
  };
}

/**
 * Detect medium from file characteristics
 *
 * Heuristics:
 * - dadcam: Low resolution (< 720p), specific codec patterns
 * - super8: Very low resolution, often 4:3 aspect
 * - modern: HD or higher resolution
 */
export function detectMediumFromMetadata(
  width: number | null,
  height: number | null,
  codec?: string | null,
  frameRate?: number | null
): Medium {
  // No dimensions available, assume modern
  if (!width || !height) return 'modern';

  const resolution = Math.max(width, height);
  const aspectRatio = width / height;

  // Super8 characteristics: very low res, often 4:3
  if (resolution < 480 && Math.abs(aspectRatio - 4 / 3) < 0.1) {
    return 'super8';
  }

  // Dadcam characteristics: SD resolution, standard definition codecs
  if (resolution < 720) {
    return 'dadcam';
  }

  // HD or higher is modern
  return 'modern';
}

/**
 * Common dadcam filename patterns
 */
export const DADCAM_PATTERNS = [
  'MVI_*',
  'MOV*',
  'DSCN*',
  'IMG_*',
  'VID_*',
  'CLIP*',
];

/**
 * Common super8 folder patterns
 */
export const SUPER8_PATTERNS = [
  '*super8*',
  '*8mm*',
  '*film*scan*',
  '*telecine*',
];

/**
 * Common modern camera patterns by manufacturer
 */
export const MODERN_PATTERNS = {
  sony: ['C*', 'XDROOT*', 'PRIVATE/M4ROOT*'],
  canon: ['MVI_*', 'CANON*'],
  panasonic: ['P*', 'PRIVATE/PANA_GRP*'],
  blackmagic: ['A*', 'B*'],
  dji: ['DJI_*'],
  gopro: ['GH*', 'GP*', 'GOPR*'],
  iphone: ['IMG_*', 'RPReplay_*'],
};
