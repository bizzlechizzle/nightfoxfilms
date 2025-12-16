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
} from './types';

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
  };
  database: {
    getLocation: () => Promise<string>;
    getStats: () => Promise<DatabaseStats>;
  };
  couples: {
    findAll: () => Promise<Couple[]>;
    findById: (id: number) => Promise<Couple | null>;
    findWithFiles: (id: number) => Promise<CoupleWithFiles | null>;
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
  };
  import: {
    files: (filePaths: string[], coupleId?: number) => Promise<ImportBatchResult>;
    directory: (dirPath: string, coupleId?: number) => Promise<ImportBatchResult>;
    scan: (dirPath: string) => Promise<DirectoryScanResult>;
    cancel: () => Promise<boolean>;
    status: () => Promise<ImportStatus>;
    onProgress: (callback: (progress: ImportProgress) => void) => () => void;
    onComplete: (callback: (result: ImportBatchResult) => void) => () => void;
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
  jobs: {
    status: () => Promise<JobStats>;
    cancel: (jobId: number) => Promise<boolean>;
    onProgress: (callback: (progress: unknown) => void) => () => void;
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
