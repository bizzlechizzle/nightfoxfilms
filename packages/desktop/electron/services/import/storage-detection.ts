/**
 * Storage Detection Service
 *
 * Detects network vs local storage for network-aware I/O optimization.
 * Used by copy-service and validator-service to apply appropriate settings.
 *
 * Detection hierarchy:
 * 1. Explicit network paths (smb://, nfs://, //)
 * 2. macOS mounted volumes (/Volumes/) - excludes known local volumes
 * 3. Linux mount points (/mnt/, /media/) - assumes network unless proven local
 * 4. Fallback: treat as local with default settings
 *
 * @module services/import/storage-detection
 */

import type { StorageType, StorageConfig } from './types';

/**
 * Known local volume name patterns on macOS (case-insensitive partial match)
 * These are excluded from network detection
 */
const LOCAL_VOLUME_PATTERNS = [
  'macintosh hd',
  'ssd',
  'internal',
  'system',
  'data',           // macOS Catalina+ data volume
  'preboot',
  'recovery',
  'vm',
];

/**
 * Explicit network path prefixes
 */
const NETWORK_PATH_PREFIXES = [
  '//',       // UNC paths (Windows-style, sometimes used on macOS)
  'smb://',   // SMB protocol
  'nfs://',   // NFS protocol
  'afp://',   // AFP protocol (legacy macOS)
  'cifs://',  // CIFS (SMB variant)
];

/**
 * Storage configurations by type
 *
 * Local: Optimized for speed (small buffers, high parallelism)
 * Network: Optimized for reliability (large buffers, sequential, delays)
 */
const STORAGE_CONFIGS: Record<StorageType, Omit<StorageConfig, 'type'>> = {
  local: {
    bufferSize: 64 * 1024,         // 64KB - default Node.js
    concurrency: 4,                 // Parallel operations OK
    operationDelayMs: 0,            // No delay needed
    description: 'Local storage (SSD/HDD)',
  },
  network: {
    bufferSize: 1024 * 1024,        // 1MB - fewer round-trips
    concurrency: 1,                 // Sequential to prevent overwhelm
    operationDelayMs: 50,           // Breathing room between ops
    description: 'Network storage (SMB/NFS)',
  },
};

/**
 * Detect if a path is on network storage
 *
 * @param filePath - File or directory path to check
 * @returns true if path appears to be on network storage
 */
export function isNetworkPath(filePath: string): boolean {
  if (!filePath) return false;

  const lowerPath = filePath.toLowerCase();

  // Check explicit network prefixes
  for (const prefix of NETWORK_PATH_PREFIXES) {
    if (lowerPath.startsWith(prefix)) {
      return true;
    }
  }

  // macOS mounted volumes check
  if (filePath.startsWith('/Volumes/')) {
    const volumeName = filePath.split('/')[2] || '';
    const lowerVolume = volumeName.toLowerCase();

    // Check if it matches known local volume patterns
    for (const pattern of LOCAL_VOLUME_PATTERNS) {
      if (lowerVolume.includes(pattern)) {
        return false; // Known local volume
      }
    }

    // SD cards and camera media are local (external but not network)
    // Common patterns: SDCARD, DCIM, NO NAME, UNTITLED, EOS_DIGITAL
    const externalMediaPatterns = [
      'sdcard',
      'sd card',
      'dcim',
      'no name',
      'untitled',
      'eos_digital',
      'canon',
      'nikon',
      'sony',
      'panasonic',
      'fuji',
      'gopro',
    ];

    for (const pattern of externalMediaPatterns) {
      if (lowerVolume.includes(pattern)) {
        return false; // External media, not network
      }
    }

    // Unknown volume under /Volumes/ - could be network mount
    // Be conservative: treat as network for safety
    return true;
  }

  // Linux network mount points
  if (filePath.startsWith('/mnt/') || filePath.startsWith('/media/')) {
    // Could be local USB or network - treat as network to be safe
    return true;
  }

  // Default: treat as local
  return false;
}

/**
 * Get storage type for a path
 *
 * @param filePath - File or directory path to check
 * @returns Storage type classification
 */
export function getStorageType(filePath: string): StorageType {
  return isNetworkPath(filePath) ? 'network' : 'local';
}

/**
 * Get I/O configuration for a path
 *
 * @param filePath - File or directory path to check
 * @returns Storage configuration with recommended I/O settings
 */
export function getStorageConfig(filePath: string): StorageConfig {
  const type = getStorageType(filePath);
  return {
    type,
    ...STORAGE_CONFIGS[type],
  };
}

/**
 * Get storage type description for logging
 *
 * @param filePath - File or directory path to check
 * @returns Human-readable storage description
 */
export function getStorageDescription(filePath: string): string {
  const config = getStorageConfig(filePath);
  return config.description;
}

/**
 * Check multiple paths and return the most conservative config
 * If ANY path is network, use network config for all
 *
 * @param paths - Array of paths to check
 * @returns Storage configuration (network if ANY path is network)
 */
export function getStorageConfigForPaths(paths: string[]): StorageConfig {
  if (paths.length === 0) {
    return getStorageConfig('/'); // Default to local
  }

  // If any path is network, use network config for all
  const hasNetworkPath = paths.some(isNetworkPath);
  const type: StorageType = hasNetworkPath ? 'network' : 'local';
  return {
    type,
    ...STORAGE_CONFIGS[type],
  };
}

/**
 * Extract volume name from a macOS path
 *
 * @param filePath - Full file path
 * @returns Volume name or null if not a /Volumes/ path
 */
export function getVolumeName(filePath: string): string | null {
  if (!filePath.startsWith('/Volumes/')) {
    return null;
  }
  return filePath.split('/')[2] || null;
}
