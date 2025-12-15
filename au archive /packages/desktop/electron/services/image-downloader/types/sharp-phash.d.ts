/**
 * Type declarations for sharp-phash module
 * DCT-based perceptual hash using sharp
 */

declare module 'sharp-phash' {
  import type { Sharp } from 'sharp';

  /**
   * Calculate perceptual hash from sharp instance
   * Returns 64-character binary string
   */
  export default function phash(image: Sharp): Promise<string>;
}

declare module 'sharp-phash/distance' {
  /**
   * Calculate Hamming distance between two pHash strings
   * @param hash1 - First 64-char binary hash
   * @param hash2 - Second 64-char binary hash
   * @returns Hamming distance (0-64)
   */
  export default function hammingDistance(hash1: string, hash2: string): number;
}
