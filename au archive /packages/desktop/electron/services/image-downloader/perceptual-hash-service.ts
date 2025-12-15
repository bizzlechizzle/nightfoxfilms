/**
 * Perceptual Hash Service
 *
 * Uses sharp-phash for 64-bit perceptual hashing.
 * Stores as 16-char hex for consistency with BLAKE3 format.
 *
 * Hamming distance thresholds:
 * - 0-5: Nearly identical (different resolutions/compressions of same image)
 * - 6-10: Very similar (minor edits, crops)
 * - 11-15: Similar (same subject, different angle/time)
 * - 16+: Different images
 *
 * @module services/image-downloader/perceptual-hash-service
 */

import phash from 'sharp-phash';
import dist from 'sharp-phash/distance';
import sharp from 'sharp';
import { readFile } from 'fs/promises';
import type Database from 'better-sqlite3';
import { getLogger } from '../logger-service';

const logger = getLogger();

export interface PHashResult {
  /** 16-char hex representation */
  hash: string;
  /** 64-char binary string (for distance calculation) */
  binary: string;
}

export interface SimilarImage {
  imghash: string;
  phash: string;
  distance: number;
}

/**
 * Perceptual Hash Service
 *
 * Singleton service for computing and comparing perceptual hashes.
 */
export class PerceptualHashService {
  private static instance: PerceptualHashService;

  private constructor() {}

  static getInstance(): PerceptualHashService {
    if (!PerceptualHashService.instance) {
      PerceptualHashService.instance = new PerceptualHashService();
    }
    return PerceptualHashService.instance;
  }

  /**
   * Calculate perceptual hash from file path
   * @param filePath - Absolute path to image file
   * @returns PHashResult with hex and binary representations
   */
  async hashFile(filePath: string): Promise<PHashResult> {
    try {
      const buffer = await readFile(filePath);
      return this.hashBuffer(buffer);
    } catch (error) {
      logger.error('PerceptualHashService', 'Failed to hash file', error as Error, { filePath });
      throw error;
    }
  }

  /**
   * Calculate perceptual hash from buffer
   * @param buffer - Image data buffer
   * @returns PHashResult with hex and binary representations
   */
  async hashBuffer(buffer: Buffer): Promise<PHashResult> {
    try {
      // Wrap buffer with sharp, then pass to phash
      // sharp-phash expects a Sharp instance and returns a 64-character binary string
      const image = sharp(buffer);
      const binary = await phash(image);
      const hash = this.binaryToHex(binary);

      return { hash, binary };
    } catch (error) {
      logger.error('PerceptualHashService', 'Failed to hash buffer', error as Error);
      throw error;
    }
  }

  /**
   * Calculate perceptual hash from Sharp instance
   * Useful when image is already being processed with Sharp
   * @param image - Sharp instance
   * @returns PHashResult with hex and binary representations
   */
  async hashSharp(image: sharp.Sharp): Promise<PHashResult> {
    try {
      // sharp-phash expects a Sharp instance directly
      const binary = await phash(image);
      const hash = this.binaryToHex(binary);
      return { hash, binary };
    } catch (error) {
      logger.error('PerceptualHashService', 'Failed to hash sharp instance', error as Error);
      throw error;
    }
  }

  /**
   * Calculate Hamming distance between two hashes
   * @param hash1 - 16-char hex or 64-char binary
   * @param hash2 - 16-char hex or 64-char binary
   * @returns Distance 0-64 (lower = more similar)
   */
  distance(hash1: string, hash2: string): number {
    const b1 = hash1.length === 16 ? this.hexToBinary(hash1) : hash1;
    const b2 = hash2.length === 16 ? this.hexToBinary(hash2) : hash2;
    return dist(b1, b2);
  }

  /**
   * Check if two images are perceptually similar
   * @param hash1 - First hash (hex or binary)
   * @param hash2 - Second hash (hex or binary)
   * @param threshold - Maximum distance to consider similar (default: 5)
   * @returns true if images are similar
   */
  areSimilar(hash1: string, hash2: string, threshold = 5): boolean {
    return this.distance(hash1, hash2) <= threshold;
  }

  /**
   * Find similar images in database using bucket pre-filtering
   *
   * Uses 4-char prefix (bucket) to pre-filter candidates, reducing
   * the number of Hamming distance calculations needed.
   *
   * @param db - Database instance
   * @param targetHash - 16-char hex hash to search for
   * @param threshold - Maximum Hamming distance (default: 5)
   * @returns Array of similar images sorted by distance
   */
  findSimilarInDb(
    db: Database.Database,
    targetHash: string,
    threshold = 5
  ): SimilarImage[] {
    // Extract 4-char bucket prefix for pre-filtering
    const bucket = targetHash.substring(0, 4);

    // Pre-filter by bucket (reduces comparisons by ~65536x theoretical, ~256x practical)
    const candidates = db
      .prepare(
        `
      SELECT imghash, phash FROM imgs
      WHERE substr(phash, 1, 4) = ? AND phash IS NOT NULL
    `
      )
      .all(bucket) as Array<{ imghash: string; phash: string }>;

    // Calculate exact distance for candidates
    const similar: SimilarImage[] = [];

    for (const candidate of candidates) {
      const d = this.distance(targetHash, candidate.phash);
      if (d <= threshold) {
        similar.push({
          imghash: candidate.imghash,
          phash: candidate.phash,
          distance: d,
        });
      }
    }

    // Sort by distance (closest first)
    return similar.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Find all similar images across entire database
   * More thorough but slower than bucket-filtered search
   *
   * @param db - Database instance
   * @param targetHash - 16-char hex hash to search for
   * @param threshold - Maximum Hamming distance (default: 5)
   * @returns Array of similar images sorted by distance
   */
  findSimilarInDbFull(
    db: Database.Database,
    targetHash: string,
    threshold = 5
  ): SimilarImage[] {
    // Get all images with pHash
    const allImages = db
      .prepare(`SELECT imghash, phash FROM imgs WHERE phash IS NOT NULL`)
      .all() as Array<{ imghash: string; phash: string }>;

    const similar: SimilarImage[] = [];

    for (const img of allImages) {
      const d = this.distance(targetHash, img.phash);
      if (d <= threshold) {
        similar.push({
          imghash: img.imghash,
          phash: img.phash,
          distance: d,
        });
      }
    }

    return similar.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Check if an image already exists in the archive (by perceptual hash)
   * @param db - Database instance
   * @param targetHash - 16-char hex hash to check
   * @param threshold - Maximum distance to consider duplicate (default: 5)
   * @returns The most similar image if found, null otherwise
   */
  findDuplicate(
    db: Database.Database,
    targetHash: string,
    threshold = 5
  ): SimilarImage | null {
    const similar = this.findSimilarInDb(db, targetHash, threshold);
    return similar.length > 0 ? similar[0] : null;
  }

  /**
   * Get the bucket prefix for a hash (first 4 characters)
   * Used for efficient database indexing
   */
  getBucket(hash: string): string {
    return hash.substring(0, 4);
  }

  // ============================================================================
  // Conversion utilities
  // ============================================================================

  /**
   * Convert 64-char binary string to 16-char hex string
   */
  binaryToHex(binary: string): string {
    let hex = '';
    for (let i = 0; i < binary.length; i += 4) {
      const nibble = binary.substring(i, i + 4);
      hex += parseInt(nibble, 2).toString(16);
    }
    return hex;
  }

  /**
   * Convert 16-char hex string to 64-char binary string
   */
  hexToBinary(hex: string): string {
    return hex
      .split('')
      .map((c) => parseInt(c, 16).toString(2).padStart(4, '0'))
      .join('');
  }

  /**
   * Validate a pHash string format
   * @param hash - String to validate
   * @returns true if valid 16-char lowercase hex
   */
  isValidHash(hash: string): boolean {
    return /^[a-f0-9]{16}$/.test(hash);
  }
}

/**
 * Singleton instance export
 */
export const perceptualHashService = PerceptualHashService.getInstance();

/**
 * Convenience function exports
 */
export async function calculatePHash(filePath: string): Promise<PHashResult> {
  return perceptualHashService.hashFile(filePath);
}

export async function calculatePHashBuffer(buffer: Buffer): Promise<PHashResult> {
  return perceptualHashService.hashBuffer(buffer);
}

export function pHashDistance(hash1: string, hash2: string): number {
  return perceptualHashService.distance(hash1, hash2);
}

export function arePHashSimilar(hash1: string, hash2: string, threshold = 5): boolean {
  return perceptualHashService.areSimilar(hash1, hash2, threshold);
}
