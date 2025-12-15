/**
 * Hash Worker - BLAKE3 file hashing in worker thread
 *
 * Per Import Spec v2.0:
 * - Runs BLAKE3 hashing in separate thread to avoid blocking main
 * - Uses native b3sum binary when available (ARM64 optimized)
 * - Falls back to WASM implementation
 * - Returns 16-char hex hash (64-bit truncation)
 *
 * @module workers/hash.worker
 */

import { parentPort, workerData } from 'worker_threads';
import { createHash } from 'blake3';
import { createReadStream, existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Hash length: 16 hex characters (64 bits)
const HASH_LENGTH = 16;

// Paths to check for native b3sum binary
const B3SUM_PATHS = [
  '/opt/homebrew/bin/b3sum', // Homebrew on Apple Silicon
  '/usr/local/bin/b3sum',   // Homebrew on Intel or manual install
  '/usr/bin/b3sum',         // System install
];

// Cached path to b3sum binary
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
      return b3sumPath;
    }
  }

  b3sumPath = null;
  return null;
}

/**
 * Calculate hash using native b3sum binary
 */
async function calculateHashNative(filePath: string): Promise<string> {
  const b3sum = findB3sum();
  if (!b3sum) {
    throw new Error('b3sum not available');
  }

  const { stdout } = await execFileAsync(b3sum, ['--no-names', filePath]);
  const fullHash = stdout.trim();
  return fullHash.substring(0, HASH_LENGTH);
}

/**
 * Calculate hash using WASM fallback
 * Uses 1MB buffer for SMB/network efficiency (vs 64KB default)
 */
async function calculateHashWasm(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hasher = createHash();
    // 1MB buffer for network efficiency - reduces SMB round-trips
    const BUFFER_SIZE = 1024 * 1024;
    const stream = createReadStream(filePath, { highWaterMark: BUFFER_SIZE });

    stream.on('data', (chunk: Buffer | string) => {
      hasher.update(chunk);
    });

    stream.on('end', () => {
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
 * Uses native b3sum if available, falls back to WASM
 */
async function calculateHash(filePath: string): Promise<string> {
  const b3sum = findB3sum();

  if (b3sum) {
    try {
      return await calculateHashNative(filePath);
    } catch (error) {
      // Fall back to WASM on error
      return calculateHashWasm(filePath);
    }
  }

  return calculateHashWasm(filePath);
}

/**
 * Worker message types
 */
interface HashRequest {
  type: 'hash';
  id: string;
  filePath: string;
}

interface HashResponse {
  type: 'hash';
  id: string;
  hash?: string;
  error?: string;
}

interface ReadyMessage {
  type: 'ready';
  hasNativeB3sum: boolean;
}

// Check if we're running as a worker thread
if (parentPort) {
  // Notify parent that worker is ready
  const readyMsg: ReadyMessage = {
    type: 'ready',
    hasNativeB3sum: findB3sum() !== null,
  };
  parentPort.postMessage(readyMsg);

  // Handle incoming messages
  parentPort.on('message', async (message: HashRequest) => {
    if (message.type === 'hash') {
      console.log(`[HashWorker] Received hash request: ${message.id} for ${message.filePath.substring(0, 50)}...`);
      const response: HashResponse = {
        type: 'hash',
        id: message.id,
      };

      try {
        const startTime = Date.now();
        response.hash = await calculateHash(message.filePath);
        console.log(`[HashWorker] Completed ${message.id} in ${Date.now() - startTime}ms: ${response.hash}`);
      } catch (error) {
        console.error(`[HashWorker] Error hashing ${message.id}:`, error);
        response.error = error instanceof Error ? error.message : String(error);
      }

      parentPort!.postMessage(response);
    }
  });
}

// Export for testing
export { calculateHash, HASH_LENGTH };
