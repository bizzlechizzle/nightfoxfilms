import { calculateHash } from './crypto-service';
import fs from 'fs/promises';
import path from 'path';

/**
 * Lightweight file integrity verification using BLAKE3
 * Replaces complex BagIt validation for day-to-day operations
 */

/**
 * Verify a single file's hash matches expected value
 * @param filePath - Absolute path to the file
 * @param expectedHash - Expected 16-char BLAKE3 hash
 * @returns true if hash matches, false otherwise (including if file doesn't exist)
 */
export async function verifyFile(filePath: string, expectedHash: string): Promise<boolean> {
  try {
    const actualHash = await calculateHash(filePath);
    return actualHash === expectedHash;
  } catch {
    return false;
  }
}

/**
 * Generate a manifest of all files in a directory
 * @param directory - Root directory to scan
 * @returns Map of relative paths to BLAKE3 hashes
 */
export async function generateManifest(directory: string): Promise<Map<string, string>> {
  const manifest = new Map<string, string>();

  async function scan(dir: string, base: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(base, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath, relativePath);
      } else if (entry.isFile()) {
        const hash = await calculateHash(fullPath);
        manifest.set(relativePath, hash);
      }
    }
  }

  await scan(directory, '');
  return manifest;
}

/**
 * Result of manifest verification
 */
export interface ManifestVerificationResult {
  validCount: number;
  invalidFiles: string[];
  missingFiles: string[];
}

/**
 * Verify all files in a manifest
 * @param directory - Root directory containing files
 * @param manifest - Map of relative paths to expected hashes
 * @returns Object with valid count, invalid files, and missing files
 */
export async function verifyManifest(
  directory: string,
  manifest: Map<string, string>
): Promise<ManifestVerificationResult> {
  const result: ManifestVerificationResult = {
    validCount: 0,
    invalidFiles: [],
    missingFiles: [],
  };

  for (const [relativePath, expectedHash] of manifest) {
    const fullPath = path.join(directory, relativePath);
    try {
      await fs.access(fullPath);
      const isValid = await verifyFile(fullPath, expectedHash);
      if (isValid) {
        result.validCount++;
      } else {
        result.invalidFiles.push(relativePath);
      }
    } catch {
      result.missingFiles.push(relativePath);
    }
  }

  return result;
}
