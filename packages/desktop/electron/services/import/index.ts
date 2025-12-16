/**
 * Import Services
 *
 * Network-safe import system for wedding video files.
 * Provides storage detection, copy with verification, and validation.
 *
 * @module services/import
 */

// Types
export * from './types';

// Storage detection
export {
  isNetworkPath,
  getStorageType,
  getStorageConfig,
  getStorageDescription,
  getStorageConfigForPaths,
  getVolumeName,
} from './storage-detection';

// Copy service
export {
  CopyService,
  createCopyService,
  NetworkFailureError,
  type CopyOptions,
  type CouplePathInfo,
} from './copy-service';

// Validator service
export {
  ValidatorService,
  createValidatorService,
  type ValidatorOptions,
} from './validator-service';
