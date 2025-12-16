/**
 * Signature Matcher Service
 *
 * Matches imported files against the canonical camera signature database.
 * Automatically identifies cameras from EXIF metadata, filename patterns,
 * and folder structures.
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { minimatch } from 'minimatch';
import type { Medium } from '@nightfox/core';

// =============================================================================
// TYPES
// =============================================================================

export interface CameraSignature {
  id: string;
  make: string;
  model: string;
  model_variants: string[];
  category: string;
  medium: Medium;
  year_released?: number | null;
  matching: {
    exif_make: string[];
    exif_model: string[];
    filename_patterns: string[];
    folder_patterns: string[];
  };
  technical?: {
    sensor_width_mm?: number;
    sensor_height_mm?: number;
    max_resolution?: string;
  };
  processing: {
    deinterlace: boolean;
    audio_channels: 'stereo' | 'mono' | 'none';
    suggested_lut?: string | null;
  };
  source: string;
  verified: boolean;
}

export interface SignatureDatabase {
  version: string;
  generated_at: string;
  camera_count: number;
  cameras: CameraSignature[];
}

export interface SignatureMatchResult {
  signature: CameraSignature;
  confidence: number;
  matched_by: 'exif_exact' | 'exif_model' | 'exif_make' | 'filename' | 'folder';
}

// =============================================================================
// DATABASE LOADING
// =============================================================================

let signatureDb: SignatureDatabase | null = null;

/**
 * Get the path to the signature database
 */
function getSignatureDatabasePath(): string {
  // In development, use the resources folder
  const devPath = path.join(__dirname, '../../resources/camera-signatures.json');
  if (fs.existsSync(devPath)) {
    return devPath;
  }

  // In production, use app resources
  const prodPath = path.join(app.getAppPath(), 'resources/camera-signatures.json');
  if (fs.existsSync(prodPath)) {
    return prodPath;
  }

  // Fallback to package directory
  const fallbackPath = path.join(__dirname, '../../../resources/camera-signatures.json');
  return fallbackPath;
}

/**
 * Load the signature database
 */
export function loadSignatureDatabase(): SignatureDatabase {
  if (signatureDb) {
    return signatureDb;
  }

  const dbPath = getSignatureDatabasePath();

  if (!fs.existsSync(dbPath)) {
    console.warn(`[SignatureMatcher] Database not found at ${dbPath}`);
    // Return empty database
    signatureDb = {
      version: '0.0.0',
      generated_at: new Date().toISOString(),
      camera_count: 0,
      cameras: [],
    };
    return signatureDb;
  }

  try {
    const data = fs.readFileSync(dbPath, 'utf-8');
    signatureDb = JSON.parse(data);
    console.log(`[SignatureMatcher] Loaded ${signatureDb!.camera_count} camera signatures`);
    return signatureDb!;
  } catch (error) {
    console.error('[SignatureMatcher] Failed to load database:', error);
    signatureDb = {
      version: '0.0.0',
      generated_at: new Date().toISOString(),
      camera_count: 0,
      cameras: [],
    };
    return signatureDb;
  }
}

/**
 * Reload the signature database (for updates)
 */
export function reloadSignatureDatabase(): SignatureDatabase {
  signatureDb = null;
  return loadSignatureDatabase();
}

// =============================================================================
// MATCHING
// =============================================================================

/**
 * Match a file against the signature database
 */
export function matchSignature(
  filePath: string,
  exifMake?: string | null,
  exifModel?: string | null
): SignatureMatchResult | null {
  const db = loadSignatureDatabase();

  if (db.cameras.length === 0) {
    return null;
  }

  const filename = path.basename(filePath);
  const folderPath = path.dirname(filePath);

  // Priority 1: Exact EXIF make + model match (95% confidence)
  if (exifMake && exifModel) {
    for (const sig of db.cameras) {
      const makeMatch = sig.matching.exif_make.some(
        (m) => m.toLowerCase() === exifMake.toLowerCase()
      );
      const modelMatch =
        sig.matching.exif_model.some(
          (m) => m.toLowerCase() === exifModel.toLowerCase()
        ) ||
        sig.model_variants.some(
          (v) => v.toLowerCase() === exifModel.toLowerCase()
        );

      if (makeMatch && modelMatch) {
        return {
          signature: sig,
          confidence: 0.95,
          matched_by: 'exif_exact',
        };
      }
    }
  }

  // Priority 2: EXIF model only match (85% confidence)
  if (exifModel) {
    for (const sig of db.cameras) {
      const modelMatch =
        sig.matching.exif_model.some((m) =>
          exifModel.toLowerCase().includes(m.toLowerCase())
        ) ||
        sig.model_variants.some((v) =>
          exifModel.toLowerCase().includes(v.toLowerCase())
        );

      if (modelMatch) {
        return {
          signature: sig,
          confidence: 0.85,
          matched_by: 'exif_model',
        };
      }
    }
  }

  // Priority 3: EXIF make only (60% confidence)
  if (exifMake) {
    for (const sig of db.cameras) {
      const makeMatch = sig.matching.exif_make.some(
        (m) => m.toLowerCase() === exifMake.toLowerCase()
      );

      if (makeMatch && sig.processing.deinterlace === false) {
        // Only match make for modern cameras (too ambiguous for dadcam)
        return {
          signature: sig,
          confidence: 0.6,
          matched_by: 'exif_make',
        };
      }
    }
  }

  // Priority 4: Filename pattern match (75% confidence)
  for (const sig of db.cameras) {
    for (const pattern of sig.matching.filename_patterns) {
      if (pattern && minimatch(filename, pattern, { nocase: true })) {
        return {
          signature: sig,
          confidence: 0.75,
          matched_by: 'filename',
        };
      }
    }
  }

  // Priority 5: Folder pattern match (70% confidence)
  for (const sig of db.cameras) {
    for (const pattern of sig.matching.folder_patterns) {
      if (pattern && matchFolderPattern(folderPath, pattern)) {
        return {
          signature: sig,
          confidence: 0.7,
          matched_by: 'folder',
        };
      }
    }
  }

  return null;
}

/**
 * Check if a folder path matches a pattern
 */
function matchFolderPattern(folderPath: string, pattern: string): boolean {
  // Normalize paths
  const normalized = folderPath.replace(/\\/g, '/');
  const parts = pattern.split('/').filter(Boolean);

  // Check if any part of the path matches the pattern parts
  for (const part of parts) {
    if (part === '*') continue;
    if (!normalized.toLowerCase().includes(part.toLowerCase())) {
      return false;
    }
  }

  return parts.length > 0;
}

/**
 * Find a signature by make and model
 */
export function findSignatureByMakeModel(
  make: string,
  model: string
): CameraSignature | null {
  const db = loadSignatureDatabase();

  for (const sig of db.cameras) {
    const makeMatch = sig.make.toLowerCase() === make.toLowerCase();
    const modelMatch =
      sig.model.toLowerCase() === model.toLowerCase() ||
      sig.model_variants.some((v) => v.toLowerCase() === model.toLowerCase());

    if (makeMatch && modelMatch) {
      return sig;
    }
  }

  return null;
}

/**
 * Search signatures by text query
 */
export function searchSignatures(query: string, limit = 20): CameraSignature[] {
  const db = loadSignatureDatabase();
  const queryLower = query.toLowerCase();

  const results: Array<{ sig: CameraSignature; score: number }> = [];

  for (const sig of db.cameras) {
    let score = 0;

    // Exact model match
    if (sig.model.toLowerCase() === queryLower) {
      score = 100;
    }
    // Model starts with query
    else if (sig.model.toLowerCase().startsWith(queryLower)) {
      score = 80;
    }
    // Model contains query
    else if (sig.model.toLowerCase().includes(queryLower)) {
      score = 60;
    }
    // Make + model contains query
    else if (`${sig.make} ${sig.model}`.toLowerCase().includes(queryLower)) {
      score = 40;
    }
    // Any variant matches
    else if (
      sig.model_variants.some((v) => v.toLowerCase().includes(queryLower))
    ) {
      score = 30;
    }

    if (score > 0) {
      results.push({ sig, score });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit).map((r) => r.sig);
}

/**
 * Get database statistics
 */
export function getSignatureDatabaseStats(): {
  version: string;
  camera_count: number;
  manufacturers: number;
  categories: Record<string, number>;
  mediums: Record<string, number>;
} {
  const db = loadSignatureDatabase();

  const manufacturers = new Set(db.cameras.map((c) => c.make));

  const categories: Record<string, number> = {};
  const mediums: Record<string, number> = {};

  for (const cam of db.cameras) {
    categories[cam.category] = (categories[cam.category] || 0) + 1;
    mediums[cam.medium] = (mediums[cam.medium] || 0) + 1;
  }

  return {
    version: db.version,
    camera_count: db.camera_count,
    manufacturers: manufacturers.size,
    categories,
    mediums,
  };
}
