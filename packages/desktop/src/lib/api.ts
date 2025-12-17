/**
 * Typed API wrapper for Electron IPC
 *
 * Provides type-safe access to the electronAPI exposed by the preload script.
 */

import type {
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
  Scene,
  ImportProgress,
  ImportBatchResult,
  CameraMatchResult,
  DatabaseStats,
  DirectoryScanResult,
  ImportStatus,
  FileFilters,
  CoupleStats,
  DashboardStats,
  WhatsNextData,
  MonthlyStats,
  YearlyStats,
  JobStats,
  AIStatus,
  AISettings,
  AICaptionResult,
  AISceneCaptionResult,
  AICaptionProgress,
  WeddingMomentResult,
  // Equipment & inventory types
  Equipment,
  EquipmentInput,
  EquipmentType,
  EquipmentStatus,
  FilmStock,
  FilmStockInput,
  StockType,
  FilmFormat,
  ProcessingLab,
  ProcessingLabInput,
  // Camera loan types
  CameraLoan,
  CameraLoanInput,
  LoanStatus,
  LoanEventType,
  // Film usage types
  FilmUsage,
  FilmUsageInput,
  // Screenshot types
  Screenshot,
  ExportPreset,
  Job,
  JobProgress,
} from './types';

// Screenshot filter interface
export interface ScreenshotFilters {
  file_id?: number;
  couple_id?: number;
  is_selected?: boolean;
  is_broll?: boolean;
  is_audio_peak?: boolean;
  min_face_count?: number;
  min_smile_score?: number;
  scene_index?: number;
  limit?: number;
  offset?: number;
}

// Screenshot stats interface
export interface ScreenshotStats {
  total: number;
  selected: number;
  withFaces: number;
  broll: number;
  audioPeaks: number;
  byScene: Record<number, number>;
}

// Get the Electron API from the window object
declare global {
  interface Window {
    electronAPI: ElectronAPI;
    getDroppedFilePaths: () => string[];
    extractFilePaths: (files: FileList) => string[];
  }
}

interface ElectronAPI {
  versions: {
    node: () => string;
    chrome: () => string;
    electron: () => string;
  };
  platform: string;
  settings: {
    get: (key: string) => Promise<string | null>;
    getAll: () => Promise<Record<string, string | null>>;
    set: (key: string, value: string | null) => Promise<boolean>;
  };
  dialog: {
    selectFolder: () => Promise<string | null>;
    selectFiles: () => Promise<string[]>;
    selectLutFile: () => Promise<string | null>;
  };
  database: {
    getLocation: () => Promise<string>;
    getStats: () => Promise<DatabaseStats>;
  };
  couples: {
    findAll: () => Promise<Couple[]>;
    findById: (id: number) => Promise<Couple | null>;
    findWithFiles: (id: number) => Promise<CoupleWithFiles | null>;
    findByStatus: (status: string) => Promise<Couple[]>;
    search: (query: string) => Promise<Couple[]>;
    getStats: (id: number) => Promise<CoupleStats | null>;
    getForMonth: (year: number, month: number) => Promise<Couple[]>;
    getDashboardStats: () => Promise<DashboardStats>;
    getWhatsNextData: () => Promise<WhatsNextData>;
    getMonthlyStats: (year: number, month: number) => Promise<MonthlyStats>;
    getYearlyStats: (year: number) => Promise<YearlyStats>;
    create: (input: CoupleInput) => Promise<Couple>;
    update: (id: number, input: Partial<CoupleInput>) => Promise<Couple | null>;
    delete: (id: number) => Promise<boolean>;
    exportJson: (id: number) => Promise<string | null>;
  };
  cameras: {
    findAll: () => Promise<CameraWithPatterns[]>;
    findById: (id: number) => Promise<CameraWithPatterns | null>;
    findByMedium: (medium: Medium) => Promise<Camera[]>;
    create: (input: CameraInput) => Promise<Camera>;
    update: (id: number, input: Partial<CameraInput>) => Promise<Camera | null>;
    delete: (id: number) => Promise<boolean>;
    setDefault: (id: number) => Promise<Camera | null>;
    matchFile: (filePath: string) => Promise<CameraMatchResult | null>;
  };
  cameraPatterns: {
    findByCamera: (cameraId: number) => Promise<CameraPattern[]>;
    create: (input: CameraPatternInput) => Promise<CameraPattern>;
    delete: (id: number) => Promise<boolean>;
  };
  files: {
    findAll: (filters?: FileFilters) => Promise<FileWithCamera[]>;
    findById: (id: number) => Promise<File | null>;
    findByCouple: (coupleId: number) => Promise<File[]>;
    findByHash: (hash: string) => Promise<File | null>;
    getMetadata: (id: number) => Promise<FileMetadata | null>;
    updateCamera: (id: number, cameraId: number | null) => Promise<boolean>;
    delete: (id: number) => Promise<boolean>;
    getThumbnail: (fileId: number) => Promise<string | null>;
    getThumbnailByHash: (hash: string, coupleId: number) => Promise<string | null>;
    getProxyByHash: (hash: string, coupleId: number) => Promise<string | null>;
    regenerateThumbnails: (coupleId: number) => Promise<{ success: boolean; regenerated: number; total?: number; error?: string; errors?: string[] }>;
  };
  screenshots: {
    findByFile: (fileId: number) => Promise<Screenshot[]>;
    findByCouple: (coupleId: number) => Promise<Screenshot[]>;
    findSelected: (coupleId: number) => Promise<Screenshot[]>;
    findAll: (filters?: ScreenshotFilters) => Promise<Screenshot[]>;
    getStats: (coupleId: number) => Promise<ScreenshotStats>;
    setSelected: (id: number, selected: boolean) => Promise<boolean>;
    setAsThumbnail: (fileId: number, screenshotId: number) => Promise<boolean>;
    autoSetThumbnail: (fileId: number) => Promise<Screenshot | null>;
    delete: (id: number) => Promise<boolean>;
    export: (screenshotId: number, presetId: number, outputPath: string) => Promise<{ success: boolean; outputPath?: string; error?: string }>;
    getImage: (screenshotId: number) => Promise<string | null>;
  };
  jobs: {
    getStats: () => Promise<JobStats>;
    findPending: (limit?: number) => Promise<Job[]>;
    findByFile: (fileId: number) => Promise<Job[]>;
    findDead: () => Promise<Job[]>;
    retry: (id: number) => Promise<Job | null>;
    cancel: (id: number) => Promise<boolean>;
    queueScreenshots: (fileId: number) => Promise<{ success: boolean; jobId?: number; error?: string }>;
    onProgress: (callback: (progress: JobProgress) => void) => () => void;
  };
  exportPresets: {
    findAll: () => Promise<ExportPreset[]>;
    findById: (id: number) => Promise<ExportPreset | null>;
  };
  import: {
    files: (filePaths: string[], options?: { coupleId?: number; copyToManaged?: boolean; managedStoragePath?: string; footageTypeOverride?: 'wedding' | 'date_night' | 'rehearsal' | 'other' }) => Promise<ImportBatchResult>;
    directory: (dirPath: string, options?: { coupleId?: number; copyToManaged?: boolean; managedStoragePath?: string; footageTypeOverride?: 'wedding' | 'date_night' | 'rehearsal' | 'other' }) => Promise<ImportBatchResult>;
    scan: (dirPath: string) => Promise<DirectoryScanResult>;
    cancel: () => Promise<boolean>;
    status: () => Promise<ImportStatus>;
    onProgress: (callback: (progress: ImportProgress) => void) => () => void;
    onComplete: (callback: (result: ImportBatchResult) => void) => () => void;
    onPaused: (callback: (data: { sessionId: string; error: string; canResume: boolean }) => void) => () => void;
    onError: (callback: (data: { sessionId: string; error: string }) => void) => () => void;
  };
  documents: {
    sync: (coupleId: number) => Promise<{ success: boolean; documentsUpdated: string[]; error?: string }>;
  };
  export: {
    screenshot: (input: unknown) => Promise<string | null>;
    clip: (input: unknown) => Promise<string | null>;
    onProgress: (callback: (progress: unknown) => void) => () => void;
  };
  scenes: {
    detect: (fileId: number) => Promise<Scene[]>;
    findByFile: (fileId: number) => Promise<Scene[]>;
    update: (sceneId: number, updates: unknown) => Promise<Scene | null>;
    delete: (sceneId: number) => Promise<boolean>;
  };
  sharpness: {
    analyze: (fileId: number) => Promise<unknown>;
    getScore: (fileId: number) => Promise<number | null>;
  };
  ai: {
    getStatus: () => Promise<AIStatus>;
    start: (settings: AISettings) => Promise<{ success: boolean; error?: string }>;
    stop: () => Promise<{ success: boolean; error?: string }>;
    caption: (input: { fileId: number; timeSeconds: number; model?: string; prompt?: string }) => Promise<AICaptionResult>;
    captionScene: (input: { fileId: number; sceneId: number; model?: string; useSharpestFrame?: boolean }) => Promise<AISceneCaptionResult>;
    captionAllScenes: (input: { fileId: number; model?: string }) => Promise<{ success: boolean; results?: AISceneCaptionResult[]; error?: string }>;
    detectMoment: (input: { fileId: number; timeSeconds: number; model?: string }) => Promise<WeddingMomentResult>;
    onCaptionProgress: (callback: (progress: AICaptionProgress) => void) => () => void;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
    openPath: (path: string) => Promise<void>;
    showItemInFolder: (path: string) => Promise<void>;
  };
  signatures: {
    search: (query: string, limit?: number) => Promise<unknown[]>;
    getStats: () => Promise<{
      version: string;
      camera_count: number;
      manufacturers: number;
      categories: Record<string, number>;
      mediums: Record<string, number>;
    }>;
    match: (filePath: string, exifMake?: string, exifModel?: string) => Promise<unknown>;
    load: () => Promise<{ version: string; camera_count: number; generated_at: string } | null>;
  };
  cameraTrainer: {
    startSession: () => Promise<{
      id: string;
      files: Array<{ path: string; filename: string; metadata: unknown; error: string | null }>;
      status: 'collecting' | 'analyzing' | 'ready' | 'error';
      minimumFiles: number;
      error: string | null;
    }>;
    getSession: () => Promise<{
      id: string;
      files: Array<{ path: string; filename: string; metadata: unknown; error: string | null }>;
      status: 'collecting' | 'analyzing' | 'ready' | 'error';
      minimumFiles: number;
      error: string | null;
    } | null>;
    cancelSession: () => Promise<boolean>;
    addFiles: (paths: string[]) => Promise<{
      added: number;
      total: number;
      minimumMet: boolean;
      errors: string[];
    }>;
    removeFile: (filePath: string) => Promise<{
      id: string;
      files: Array<{ path: string; filename: string; metadata: unknown; error: string | null }>;
      status: 'collecting' | 'analyzing' | 'ready' | 'error';
      minimumFiles: number;
      error: string | null;
    } | null>;
    analyze: () => Promise<{
      success: boolean;
      fingerprint: unknown;
      suggestedName: string;
      suggestedMedium: Medium;
      signature: unknown;
      filesAnalyzed: number;
      errors: string[];
    }>;
    exportSignature: (signature: unknown) => Promise<string | null>;
    selectFiles: () => Promise<string[]>;
    selectFolder: () => Promise<string | null>;
  };
  usb: {
    getDevices: () => Promise<USBDevice[]>;
    getCameras: () => Promise<USBDevice[]>;
    getJVCDevices: () => Promise<USBDevice[]>;
    syncCameras: () => Promise<{ connected: Array<{ device: USBDevice; camera: RegisteredCamera }>; unregistered: USBDevice[] }>;
  };
  cameraRegistry: {
    getAll: () => Promise<RegisteredCamera[]>;
    register: (input: RegisterCameraInput) => Promise<RegisteredCamera>;
    registerConnected: (input: { volumeUUID: string; cameraName: string; physicalSerial?: string; notes?: string }) => Promise<RegisteredCamera | null>;
    update: (input: { cameraId: string; updates: { name?: string; notes?: string; physicalSerial?: string; volumeUUID?: string } }) => Promise<RegisteredCamera | null>;
    delete: (cameraId: string) => Promise<boolean>;
    findBySerial: (serial: string) => Promise<RegisteredCamera | null>;
    findByVolumeUUID: (volumeUUID: string) => Promise<RegisteredCamera | null>;
    findForMountPoint: (mountPoint: string) => Promise<RegisteredCamera | null>;
  };
  equipment: {
    findAll: () => Promise<Equipment[]>;
    findById: (id: number) => Promise<Equipment | null>;
    findByType: (type: EquipmentType) => Promise<Equipment[]>;
    findByMedium: (medium: Medium) => Promise<Equipment[]>;
    findByStatus: (status: EquipmentStatus) => Promise<Equipment[]>;
    findAvailable: () => Promise<Equipment[]>;
    findLoanerEligible: () => Promise<Equipment[]>;
    findAvailableForLoan: (startDate: string, endDate: string, excludeLoanId?: number) => Promise<Equipment[]>;
    search: (query: string) => Promise<Equipment[]>;
    create: (input: EquipmentInput) => Promise<Equipment>;
    update: (id: number, input: Partial<EquipmentInput>) => Promise<Equipment | null>;
    updateStatus: (id: number, status: EquipmentStatus) => Promise<Equipment | null>;
    linkToCameraProfile: (id: number, cameraId: number | null) => Promise<Equipment | null>;
    delete: (id: number) => Promise<boolean>;
    getCountsByType: () => Promise<Array<{ type: EquipmentType; count: number }>>;
    getCountsByStatus: () => Promise<Array<{ status: EquipmentStatus; count: number }>>;
  };
  filmStock: {
    findAll: () => Promise<FilmStock[]>;
    findById: (id: number) => Promise<FilmStock | null>;
    findByType: (type: StockType) => Promise<FilmStock[]>;
    findByFormat: (format: FilmFormat) => Promise<FilmStock[]>;
    findInStock: () => Promise<FilmStock[]>;
    findLowStock: (threshold?: number) => Promise<FilmStock[]>;
    findOutOfStock: () => Promise<FilmStock[]>;
    search: (query: string) => Promise<FilmStock[]>;
    create: (input: FilmStockInput) => Promise<FilmStock>;
    update: (id: number, input: Partial<FilmStockInput>) => Promise<FilmStock | null>;
    adjustQuantity: (id: number, delta: number) => Promise<FilmStock | null>;
    delete: (id: number) => Promise<boolean>;
    getTotalValue: () => Promise<number>;
    getUsageStats: () => Promise<Array<{ film_stock_id: number; name: string; total_used: number }>>;
  };
  processingLabs: {
    findAll: () => Promise<ProcessingLab[]>;
    findById: (id: number) => Promise<ProcessingLab | null>;
    findByMinRating: (rating: number) => Promise<ProcessingLab[]>;
    findByService: (service: string) => Promise<ProcessingLab[]>;
    search: (query: string) => Promise<ProcessingLab[]>;
    create: (input: ProcessingLabInput) => Promise<ProcessingLab>;
    update: (id: number, input: Partial<ProcessingLabInput>) => Promise<ProcessingLab | null>;
    delete: (id: number) => Promise<boolean>;
  };
  loans: {
    findAll: () => Promise<CameraLoan[]>;
    findAllWithDetails: () => Promise<CameraLoanWithDetails[]>;
    findById: (id: number) => Promise<CameraLoan | null>;
    findByIdWithDetails: (id: number) => Promise<CameraLoanWithDetails | null>;
    findByCouple: (coupleId: number) => Promise<CameraLoanWithDetails[]>;
    findByEquipment: (equipmentId: number) => Promise<CameraLoan[]>;
    findByStatus: (status: LoanStatus) => Promise<CameraLoanWithDetails[]>;
    findActive: () => Promise<CameraLoanWithDetails[]>;
    findNeedingAttention: () => Promise<CameraLoanWithDetails[]>;
    findOverdue: () => Promise<CameraLoanWithDetails[]>;
    checkAvailability: (equipmentId: number, startDate: string, endDate: string, excludeLoanId?: number) => Promise<{ available: boolean; conflicts: CameraLoan[] }>;
    create: (input: CameraLoanInput) => Promise<CameraLoan>;
    update: (id: number, input: Partial<CameraLoanInput>) => Promise<CameraLoan | null>;
    transitionStatus: (id: number, newStatus: LoanStatus, additionalData?: Partial<CameraLoanInput>) => Promise<{ success: boolean; loan?: CameraLoan; error?: string }>;
    delete: (id: number) => Promise<boolean>;
    getCountsByStatus: () => Promise<Array<{ status: LoanStatus; count: number }>>;
    getCountsByEventType: () => Promise<Array<{ event_type: LoanEventType; count: number }>>;
  };
  filmUsage: {
    findAll: () => Promise<FilmUsage[]>;
    findAllWithDetails: () => Promise<FilmUsageWithDetails[]>;
    findById: (id: number) => Promise<FilmUsage | null>;
    findByIdWithDetails: (id: number) => Promise<FilmUsageWithDetails | null>;
    findByCouple: (coupleId: number) => Promise<FilmUsageWithDetails[]>;
    findByLoan: (loanId: number) => Promise<FilmUsageWithDetails[]>;
    findByLab: (labId: number) => Promise<FilmUsageWithDetails[]>;
    findPendingAtLab: () => Promise<FilmUsageWithDetails[]>;
    findAwaitingPhysicalReturn: () => Promise<FilmUsageWithDetails[]>;
    create: (input: FilmUsageInput) => Promise<FilmUsage>;
    update: (id: number, input: Partial<FilmUsageInput>) => Promise<FilmUsage | null>;
    markSentToLab: (id: number, labId: number, trackingNumber?: string) => Promise<FilmUsage | null>;
    markScansReceived: (id: number, downloadUrl?: string, resolution?: string, format?: string) => Promise<FilmUsage | null>;
    markPhysicalReceived: (id: number, trackingNumber?: string) => Promise<FilmUsage | null>;
    delete: (id: number) => Promise<boolean>;
    getTotalCartridgesByCouple: (coupleId: number) => Promise<number>;
    getTotalCostByCouple: (coupleId: number) => Promise<number>;
    getUsageByFilmStock: () => Promise<Array<{ film_stock_id: number; film_stock_name: string; total_cartridges: number; total_cost: number }>>;
  };
  screenshotTool: {
    start: () => Promise<ScreenshotToolResult>;
    stop: () => Promise<ScreenshotToolResult>;
    health: () => Promise<ScreenshotToolHealthResult>;
    progress: () => Promise<ScreenshotToolProgress>;
    analyze: (input: ScreenshotToolAnalyzeInput) => Promise<ScreenshotToolAnalyzeResponse>;
    detectScenes: (input: { videoPath: string; threshold?: number }) => Promise<ScreenshotToolScenesResponse>;
    detectFaces: (input: { imagePath: string }) => Promise<ScreenshotToolFacesResponse>;
    tagImage: (input: { imagePath: string }) => Promise<ScreenshotToolTagsResponse>;
    generateCrops: (input: { imagePath: string; faces?: FaceData[] }) => Promise<ScreenshotToolCropsResponse>;
    qualityScore: (input: { imagePath: string }) => Promise<ScreenshotToolQualityResponse>;
    clusterFaces: (input: { embeddings: number[][]; eps?: number; minSamples?: number }) => Promise<ScreenshotToolClusterResponse>;
    onAnalysisComplete: (callback: (result: ScreenshotToolAnalyzeResult) => void) => () => void;
  };
}

// USB Device types
export interface VolumeInfo {
  name: string;
  mountPoint: string;
  volumeUUID: string;
  capacity: number;
  freeSpace: number;
  fileSystem: string;
}

export interface USBDevice {
  vendorId: number;
  productId: number;
  vendorName: string;
  productName: string;
  usbSerial: string | null;
  locationId: string;
  volumes: VolumeInfo[];
  primaryVolumeUUID: string | null;
}

export interface RegisteredCamera {
  id: string;
  name: string;
  usbSerial: string | null;
  volumeUUID: string | null;
  vendorId: number | null;
  productId: number | null;
  make: string;
  model: string;
  physicalSerial: string | null;
  registeredAt: string;
  lastSeen: string | null;
  notes: string | null;
}

export interface RegisterCameraInput {
  name: string;
  make: string;
  model: string;
  volumeUUID?: string | null;
  usbSerial?: string | null;
  vendorId?: number | null;
  productId?: number | null;
  physicalSerial?: string | null;
  notes?: string | null;
}

export interface CameraLoanWithDetails extends CameraLoan {
  equipment_name: string;
  equipment_medium: string | null;
  couple_name: string;
  couple_wedding_date: string | null;
}

export interface FilmUsageWithDetails extends FilmUsage {
  film_stock_name: string;
  film_stock_format: string;
  couple_name: string | null;
  lab_name: string | null;
  equipment_name: string | null;
}

// Screenshot Tool types (ML Pipeline)
export interface ScreenshotToolResult {
  success: boolean;
  error?: string;
}

export interface ScreenshotToolHealthResult {
  healthy: boolean;
  status?: string;
  models_loaded?: boolean;
  device?: string;
  current_job?: string | null;
  job_progress?: number;
  job_message?: string;
  error?: string;
}

export interface ScreenshotToolProgress {
  job_id: string | null;
  progress: number;
  message: string;
  complete: boolean;
  error?: string;
}

export interface ScreenshotToolAnalyzeInput {
  videoPath: string;
  outputDir: string;
  options?: {
    sharpness_threshold?: number;
    cluster_eps?: number;
    cluster_min_samples?: number;
    ram_model_path?: string;
  };
}

export interface CropCoordinates {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
}

export interface FaceData {
  bbox: number[];
  confidence: number;
  landmarks?: number[][];
  embedding?: number[];
  age?: number;
  gender?: string;
  pose?: number[];
  smile_score?: number;
}

export interface FrameCandidate {
  frame_number: number;
  timestamp: number;
  image_path: string;
  sharpness_score: number;
  nima_score: number;
  faces: FaceData[];
  tags: string[];
  caption?: string;
  crops: Record<string, CropCoordinates>;
  aesthetic_score: number;
  is_broll: boolean;
  scene_index: number;
  cluster_labels: Record<string, number>;
}

export interface ScreenshotToolAnalyzeResult {
  success: boolean;
  job_id?: string;
  candidates: FrameCandidate[];
  errors: string[];
  total_scenes: number;
  total_candidates: number;
}

export interface ScreenshotToolAnalyzeResponse {
  success: boolean;
  result?: ScreenshotToolAnalyzeResult;
  error?: string;
}

export interface ScreenshotToolScenesResponse {
  success: boolean;
  scenes?: Array<{ start: number; end: number }>;
  error?: string;
}

export interface ScreenshotToolFacesResponse {
  success: boolean;
  faces?: FaceData[];
  error?: string;
}

export interface ScreenshotToolTagsResponse {
  success: boolean;
  tags?: string[];
  error?: string;
}

export interface ScreenshotToolCropsResponse {
  success: boolean;
  crops?: Record<string, CropCoordinates>;
  error?: string;
}

export interface ScreenshotToolQualityResponse {
  success: boolean;
  sharpness?: number;
  is_sharp?: boolean;
  error?: string;
}

export interface ScreenshotToolClusterResponse {
  success: boolean;
  labels?: number[];
  cluster_info?: Record<string, { count: number; indices: number[] }>;
  error?: string;
}

/**
 * Get the Electron API
 */
export function getAPI(): ElectronAPI {
  if (!window.electronAPI) {
    throw new Error('Electron API not available. Are you running in Electron?');
  }
  return window.electronAPI;
}

/**
 * Check if running in Electron
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI;
}

/**
 * Get file paths from a drop event
 */
export function getDroppedPaths(): string[] {
  return window.getDroppedFilePaths?.() ?? [];
}

/**
 * Format bytes as human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format duration in seconds as readable string
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) {
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

/**
 * Format date for display
 */
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'No date';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Get medium display name
 */
export function getMediumName(medium: Medium): string {
  switch (medium) {
    case 'dadcam':
      return 'Dad Cam';
    case 'super8':
      return 'Super 8';
    case 'modern':
      return 'Modern Digital';
    default:
      return medium;
  }
}

/**
 * Get medium color class
 */
export function getMediumColor(medium: Medium): string {
  switch (medium) {
    case 'dadcam':
      return 'bg-medium-dadcam';
    case 'super8':
      return 'bg-medium-super8';
    case 'modern':
      return 'bg-medium-modern';
    default:
      return 'bg-gray-500';
  }
}
