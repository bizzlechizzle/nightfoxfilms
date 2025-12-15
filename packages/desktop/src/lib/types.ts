/**
 * TypeScript types for the Electron API
 *
 * These types mirror the core types but are used in the renderer process.
 */

// Re-export types from core
export type {
  Camera,
  CameraInput,
  CameraPattern,
  CameraPatternInput,
  CameraWithPatterns,
  Couple,
  CoupleInput,
  CoupleWithFiles,
  File,
  FileWithCamera,
  FileMetadata,
  Medium,
  FileType,
  PatternType,
  Scene,
  JobStatus,
  ImportProgress,
  ImportBatchResult,
  ImportResult,
} from '@nightfox/core';

/**
 * Camera match result from pattern matching
 */
export interface CameraMatchResult {
  camera_id: number;
  camera_name: string;
  medium: 'dadcam' | 'super8' | 'modern';
  matched_by: 'filename' | 'folder' | 'extension' | 'metadata' | 'default';
  pattern_id?: number;
  confidence: number;
}

/**
 * Database statistics
 */
export interface DatabaseStats {
  tables: number;
  totalRows: number;
  sizeBytes: number;
}

/**
 * Directory scan result
 */
export interface DirectoryScanResult {
  files: string[];
  stats: {
    totalFiles: number;
    videoFiles: number;
    sidecarFiles: number;
    audioFiles: number;
    otherFiles: number;
    totalSize: number;
  };
}

/**
 * Import status
 */
export interface ImportStatus {
  active: boolean;
  importId: string | null;
}

/**
 * File filters for queries
 */
export interface FileFilters {
  couple_id?: number;
  camera_id?: number;
  medium?: 'dadcam' | 'super8' | 'modern';
  file_type?: 'video' | 'sidecar' | 'audio' | 'other';
  is_processed?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Couple statistics
 */
export interface CoupleStats {
  fileCount: number;
  totalDuration: number;
}

/**
 * Job statistics
 */
export interface JobStats {
  pending: number;
  processing: number;
  complete: number;
  error: number;
}

/**
 * AI/LiteLLM status
 */
export interface AIStatus {
  installed: boolean;
  running: boolean;
  managedByApp: boolean;
  port: number;
  configuredModels: string[];
  lastError: string | null;
}

/**
 * AI settings for LiteLLM
 */
export interface AISettings {
  port: number;
  defaultModel: string;
  ollamaEnabled: boolean;
  ollamaModel: string;
  anthropicKey: string | null;
  openaiKey: string | null;
}

/**
 * AI caption result
 */
export interface AICaptionResult {
  success: boolean;
  caption?: string;
  model?: string;
  durationMs?: number;
  tokens?: {
    prompt: number;
    completion: number;
  };
  error?: string;
}

/**
 * AI scene caption result
 */
export interface AISceneCaptionResult {
  success: boolean;
  sceneNumber?: number;
  startTime?: number;
  endTime?: number;
  frameTime?: number;
  caption?: string;
  weddingMoment?: string;
  confidence?: number;
  durationMs?: number;
  error?: string;
}

/**
 * AI caption progress event
 */
export interface AICaptionProgress {
  current: number;
  total: number;
  sceneNumber: number;
  status: 'processing' | 'complete' | 'error';
  error?: string;
}

/**
 * Wedding moment detection result
 */
export interface WeddingMomentResult {
  success: boolean;
  moment?: string;
  confidence?: number;
  description?: string;
  error?: string;
}
