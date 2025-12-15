import { createHash } from 'blake3';
import { createReadStream } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { randomBytes } from 'crypto';

const execFileAsync = promisify(execFile);

/**
 * Hash length constant: 16 hex characters (64 bits)
 * BLAKE3 produces 256-bit output, we truncate to 64 bits for compact storage
 */
export const HASH_LENGTH = 16;

/**
 * Paths to check for b3sum binary (native ARM64 performance)
 */
const B3SUM_PATHS = [
  '/opt/homebrew/bin/b3sum', // Homebrew on Apple Silicon
  '/usr/local/bin/b3sum', // Homebrew on Intel or manual install
  '/usr/bin/b3sum', // System install
];

/**
 * Cached path to b3sum binary, or null if not found
 */
let b3sumPath: string | null | undefined = undefined;

/**
 * Find b3sum binary path
 */
function findB3sum(): string | null {
  if (b3sumPath !== undefined) {
    return b3sumPath;
  }

  for (const path of B3SUM_PATHS) {
    if (existsSync(path)) {
      b3sumPath = path;
      console.log(`[CryptoService] Using native b3sum at: ${path}`);
      return b3sumPath;
    }
  }

  b3sumPath = null;
  console.log('[CryptoService] b3sum not found, using WASM fallback');
  return null;
}

/**
 * Calculate BLAKE3 hash using native b3sum binary
 * @param filePath - Absolute path to the file
 * @returns Promise resolving to 16-char lowercase hex hash
 */
async function calculateHashNative(filePath: string): Promise<string> {
  const b3sum = findB3sum();
  if (!b3sum) {
    throw new Error('b3sum not available');
  }

  // b3sum outputs: "<hash>  <filename>"
  const { stdout } = await execFileAsync(b3sum, ['--no-names', filePath]);
  const fullHash = stdout.trim();
  return fullHash.substring(0, HASH_LENGTH);
}

/**
 * Calculate BLAKE3 hash using WASM fallback (blake3 npm package)
 * Uses 1MB buffer for SMB/network efficiency (vs 64KB default)
 * @param filePath - Absolute path to the file
 * @returns Promise resolving to 16-char lowercase hex hash
 */
async function calculateHashWasm(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hasher = createHash();
    // 1MB buffer for network efficiency - reduces SMB round-trips
    const BUFFER_SIZE = 1024 * 1024;
    const stream = createReadStream(filePath, { highWaterMark: BUFFER_SIZE });

    stream.on('data', (chunk: Buffer | string) => {
      hasher.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    stream.on('end', () => {
      // Take first 8 bytes (64 bits) = 16 hex chars
      const fullHash = hasher.digest('hex');
      resolve(fullHash.substring(0, HASH_LENGTH));
    });

    stream.on('error', (error: Error) => {
      reject(error);
    });
  });
}

/**
 * Calculate BLAKE3 hash of a file
 * Uses native b3sum binary if available (ARM64 optimized), falls back to WASM
 * @param filePath - Absolute path to the file
 * @returns Promise resolving to 16-char lowercase hex hash
 * @example
 * const hash = await calculateHash('/path/to/file.jpg');
 * // Returns: "a7f3b2c1e9d4f086"
 */
export async function calculateHash(filePath: string): Promise<string> {
  const b3sum = findB3sum();

  if (b3sum) {
    try {
      return await calculateHashNative(filePath);
    } catch (error) {
      // Fall back to WASM on error
      console.warn('[CryptoService] b3sum failed, falling back to WASM:', error);
      return calculateHashWasm(filePath);
    }
  }

  return calculateHashWasm(filePath);
}

/**
 * Calculate BLAKE3 hash of a buffer
 * Note: Always uses WASM - native b3sum only works with files
 * @param buffer - Buffer to hash
 * @returns 16-char lowercase hex hash
 */
export function calculateHashBuffer(buffer: Buffer): string {
  const fullHash = createHash().update(buffer).digest('hex');
  return fullHash.substring(0, HASH_LENGTH);
}

/**
 * Validate a hash string format
 * @param hash - String to validate
 * @returns true if valid 16-char lowercase hex
 */
export function isValidHash(hash: string): boolean {
  return /^[a-f0-9]{16}$/.test(hash);
}

/**
 * Check if native b3sum is available
 * @returns true if native ARM64 b3sum binary is found
 */
export function hasNativeB3sum(): boolean {
  return findB3sum() !== null;
}

/**
 * Generate a unique location ID using BLAKE3 hash of random bytes.
 * ADR-046: Replaces UUID + loc12 with single BLAKE3 16-char ID
 * @returns 16-character lowercase hex string
 * @example
 * const locid = generateLocationId();
 * // Returns: "a7f3b2c1e9d4f086"
 */
export function generateLocationId(): string {
  const bytes = randomBytes(32);
  return calculateHashBuffer(bytes);
}

/**
 * Generate a unique sub-location ID using BLAKE3 hash of random bytes.
 * ADR-046: Replaces UUID + sub12 with single BLAKE3 16-char ID
 * @returns 16-character lowercase hex string
 * @example
 * const subid = generateSubLocationId();
 * // Returns: "b8f4c3d2e0a5f197"
 */
export function generateSubLocationId(): string {
  const bytes = randomBytes(32);
  return calculateHashBuffer(bytes);
}

/**
 * CryptoService class wrapper for backward compatibility
 * Wraps the function-based API in a class interface
 */
export class CryptoService {
  /**
   * Calculate BLAKE3 hash of a file
   * @param filePath - Absolute path to the file
   * @returns Promise resolving to 16-char lowercase hex hash
   */
  async calculateHash(filePath: string): Promise<string> {
    return calculateHash(filePath);
  }

  /**
   * Alias for calculateHash - backward compatibility
   * @deprecated Use calculateHash instead
   */
  async calculateSHA256(filePath: string): Promise<string> {
    return calculateHash(filePath);
  }

  /**
   * Calculate BLAKE3 hash of a buffer
   * @param buffer - Buffer to hash
   * @returns 16-char lowercase hex hash
   */
  calculateHashBuffer(buffer: Buffer): string {
    return calculateHashBuffer(buffer);
  }

  /**
   * Alias for calculateHashBuffer - backward compatibility
   * @deprecated Use calculateHashBuffer instead
   */
  calculateSHA256Buffer(buffer: Buffer): string {
    return calculateHashBuffer(buffer);
  }

  /**
   * Validate a hash string format
   * @param hash - String to validate
   * @returns true if valid 16-char lowercase hex
   */
  isValidHash(hash: string): boolean {
    return isValidHash(hash);
  }

  /**
   * Check if native b3sum is available
   * @returns true if native ARM64 b3sum binary is found
   */
  hasNativeB3sum(): boolean {
    return hasNativeB3sum();
  }

  /**
   * Generate a unique location ID
   * ADR-046: BLAKE3 16-char hash
   */
  generateLocationId(): string {
    return generateLocationId();
  }

  /**
   * Generate a unique sub-location ID
   * ADR-046: BLAKE3 16-char hash
   */
  generateSubLocationId(): string {
    return generateSubLocationId();
  }
}
