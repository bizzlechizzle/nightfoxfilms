/**
 * Hash Service
 *
 * BLAKE3 hashing for file identification.
 * Uses 64-bit output (16 hex characters) for compact IDs.
 *
 * Pattern: Stream file through BLAKE3, output first 8 bytes as hex.
 */

import fs from 'fs';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { HashResult } from '@nightfox/core';

// BLAKE3 module (native Node.js bindings)
let blake3Module: any = null;

/**
 * Load BLAKE3 module
 */
async function loadBlake3(): Promise<any> {
  if (blake3Module) return blake3Module;

  // Use native BLAKE3 - Electron main process is Node.js
  const { createHash } = await import('blake3');
  blake3Module = { createHash };
  console.log('[HashService] Using native BLAKE3');

  return blake3Module;
}

/**
 * Hash length in bytes (64-bit = 8 bytes = 16 hex chars)
 */
export const HASH_LENGTH_BYTES = 8;
export const HASH_LENGTH_HEX = 16;

/**
 * Calculate BLAKE3 hash for a file
 *
 * @param filePath - Absolute path to file
 * @returns Hash result with 16-char hex string
 */
export async function calculateHash(filePath: string): Promise<HashResult> {
  const blake3 = await loadBlake3();

  return new Promise((resolve, reject) => {
    // Get file size first
    stat(filePath)
      .then((stats) => {
        const hasher = blake3.createHash();
        const stream = createReadStream(filePath);

        stream.on('data', (chunk: Buffer | string) => {
          hasher.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        stream.on('end', () => {
          // Get digest and truncate to 8 bytes (64 bits)
          const fullDigest = hasher.digest();
          const truncated = fullDigest.slice(0, HASH_LENGTH_BYTES);
          const hash = Buffer.from(truncated).toString('hex');

          resolve({
            hash,
            filePath,
            fileSize: stats.size,
          });
        });

        stream.on('error', (error) => {
          reject(new Error(`Failed to hash file ${filePath}: ${error.message}`));
        });
      })
      .catch((error) => {
        reject(new Error(`Failed to stat file ${filePath}: ${error.message}`));
      });
  });
}

/**
 * Calculate hash for a buffer
 *
 * @param buffer - Buffer to hash
 * @returns 16-char hex string
 */
export async function calculateHashFromBuffer(buffer: Buffer): Promise<string> {
  const blake3 = await loadBlake3();

  const hasher = blake3.createHash();
  hasher.update(buffer);

  const fullDigest = hasher.digest();
  const truncated = fullDigest.slice(0, HASH_LENGTH_BYTES);
  return Buffer.from(truncated).toString('hex');
}

/**
 * Calculate hash for a string
 *
 * @param str - String to hash
 * @returns 16-char hex string
 */
export async function calculateHashFromString(str: string): Promise<string> {
  return calculateHashFromBuffer(Buffer.from(str, 'utf-8'));
}

/**
 * Verify a file matches an expected hash
 *
 * @param filePath - Absolute path to file
 * @param expectedHash - Expected 16-char hex hash
 * @returns True if hash matches
 */
export async function verifyHash(filePath: string, expectedHash: string): Promise<boolean> {
  const result = await calculateHash(filePath);
  return result.hash === expectedHash;
}

/**
 * Validate hash format
 *
 * @param hash - Hash string to validate
 * @returns True if valid 16-char lowercase hex
 */
export function isValidHash(hash: string): boolean {
  return typeof hash === 'string' && hash.length === HASH_LENGTH_HEX && /^[a-f0-9]+$/.test(hash);
}

/**
 * Hash multiple files in parallel
 *
 * @param filePaths - Array of file paths
 * @param concurrency - Max concurrent hashes (default: 4)
 * @returns Array of hash results
 */
export async function calculateHashBatch(
  filePaths: string[],
  concurrency = 4
): Promise<HashResult[]> {
  const results: HashResult[] = [];
  const errors: Error[] = [];

  // Process in chunks
  for (let i = 0; i < filePaths.length; i += concurrency) {
    const chunk = filePaths.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(chunk.map(calculateHash));

    for (const result of chunkResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        errors.push(result.reason);
      }
    }
  }

  if (errors.length > 0) {
    console.warn(`[HashService] ${errors.length} files failed to hash`);
  }

  return results;
}
