/**
 * Storage Detection Utility
 *
 * Unified detection of storage types for network-aware I/O optimization.
 * Used by Orchestrator, Copier, Validator to apply consistent SMB/NFS handling.
 *
 * Detection hierarchy:
 * 1. Explicit network paths (smb://, nfs://, //)
 * 2. macOS mounted volumes (/Volumes/) - excludes known local volumes
 * 3. Linux mount points (/mnt/, /media/) - assumes network unless proven local
 * 4. Fallback: treat as local with conservative settings
 *
 * @module services/import/storage-detection
 */

/**
 * Storage type classification
 */
export type StorageType = 'local' | 'network';

/**
 * I/O configuration for different storage types
 */
export interface StorageConfig {
  /** Storage classification */
  type: StorageType;
  /** Recommended buffer size for streams (bytes) */
  bufferSize: number;
  /** Recommended concurrency for parallel operations */
  concurrency: number;
  /** Delay between sequential operations (ms) */
  operationDelayMs: number;
  /** Human-readable description */
  description: string;
}

/**
 * Known local volume names on macOS (case-insensitive partial match)
 */
const LOCAL_VOLUME_PATTERNS = [
  'macintosh hd',
  'ssd',
  'internal',
  'system',
  'data',  // macOS Catalina+ data volume
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
 */
const STORAGE_CONFIGS: Record<StorageType, Omit<StorageConfig, 'type'>> = {
  local: {
    bufferSize: 64 * 1024,         // 64KB - default Node.js
    concurrency: 22,                // High parallelism OK
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
 * @param path - File or directory path to check
 * @returns true if path appears to be on network storage
 */
export function isNetworkPath(path: string): boolean {
  // Check explicit network prefixes
  const lowerPath = path.toLowerCase();
  for (const prefix of NETWORK_PATH_PREFIXES) {
    if (lowerPath.startsWith(prefix)) {
      return true;
    }
  }

  // macOS mounted volumes check
  if (path.startsWith('/Volumes/')) {
    const volumeName = path.split('/')[2] || '';
    const lowerVolume = volumeName.toLowerCase();

    // Check if it matches known local volume patterns
    for (const pattern of LOCAL_VOLUME_PATTERNS) {
      if (lowerVolume.includes(pattern)) {
        return false; // Known local volume
      }
    }

    // Unknown volume under /Volumes/ - assume network
    return true;
  }

  // Linux network mount points (conservative - might be local)
  if (path.startsWith('/mnt/') || path.startsWith('/media/')) {
    // Could be local USB or network - treat as network to be safe
    return true;
  }

  // Default: treat as local
  return false;
}

/**
 * Get storage type for a path
 *
 * @param path - File or directory path to check
 * @returns Storage type classification
 */
export function getStorageType(path: string): StorageType {
  return isNetworkPath(path) ? 'network' : 'local';
}

/**
 * Get I/O configuration for a path
 *
 * @param path - File or directory path to check
 * @returns Storage configuration with recommended I/O settings
 */
export function getStorageConfig(path: string): StorageConfig {
  const type = getStorageType(path);
  return {
    type,
    ...STORAGE_CONFIGS[type],
  };
}

/**
 * Get storage type description for logging
 *
 * @param path - File or directory path to check
 * @returns Human-readable storage description
 */
export function getStorageDescription(path: string): string {
  const config = getStorageConfig(path);
  return config.description;
}

/**
 * Check multiple paths and return the most conservative (network) if any are network
 *
 * @param paths - Array of paths to check
 * @returns Storage configuration (network if ANY path is network)
 */
export function getStorageConfigForPaths(paths: string[]): StorageConfig {
  // If any path is network, use network config for all
  const hasNetworkPath = paths.some(isNetworkPath);
  const type: StorageType = hasNetworkPath ? 'network' : 'local';
  return {
    type,
    ...STORAGE_CONFIGS[type],
  };
}
