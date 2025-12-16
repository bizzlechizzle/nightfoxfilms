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
 * Dashboard statistics
 */
export interface DashboardStats {
  byStatus: Record<string, number>;
  deliveredThisMonth: number;
  upcomingWeddings: Array<{
    couple: import('@nightfox/core').Couple;
    daysUntil: number;
  }>;
  recentActivity: Array<{
    couple: import('@nightfox/core').Couple;
    action: string;
    timestamp: string;
  }>;
}

/**
 * What's Next item for dashboard
 */
export interface WhatsNextItem {
  coupleId: number;
  date: string;
  coupleName: string;
  venue: string;
  daysUntil: number;
  isUrgent: boolean;
}

/**
 * What's Next section for dashboard
 */
export interface WhatsNextSection {
  label: string;
  key: string;
  items: WhatsNextItem[];
  emptyMessage: string;
}

/**
 * What's Next data for dashboard
 */
export interface WhatsNextData {
  sections: WhatsNextSection[];
}

/**
 * Monthly statistics
 */
export interface MonthlyStats {
  weddingsOccurred: number;
  weddingsDelivered: number;
  inProgress: number;
  filesImported: number;
}

/**
 * Yearly statistics
 */
export interface YearlyStats {
  totalWeddings: number;
  totalDelivered: number;
  deliveryRate: number;
  avgDaysToDelivery: number;
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
 * AI/LiteLLM status (enhanced with provider info)
 */
export interface AIStatus {
  installed: boolean;
  running: boolean;
  managedByApp: boolean;
  port: number;
  configuredModels: string[];
  lastError: string | null;
  ollamaAvailable: boolean;
  configuredProviders: string[];
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
