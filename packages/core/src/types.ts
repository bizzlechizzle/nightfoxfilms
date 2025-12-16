/**
 * Nightfox Films - Core Type Definitions
 *
 * This file contains all shared TypeScript interfaces used across
 * packages/core and packages/desktop.
 *
 * BLAKE3 Hash Format: 16 lowercase hex characters (64-bit output)
 * Example: "a7f3b2c1e9d4f086"
 */

// =============================================================================
// ENUMS
// =============================================================================

export type Medium = 'dadcam' | 'super8' | 'modern';

export type FileType = 'video' | 'sidecar' | 'audio' | 'other';

export type PatternType = 'filename' | 'folder' | 'extension';

export type ExportType = 'screenshot' | 'clip';

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '4:3';

export type JobStatus = 'pending' | 'processing' | 'complete' | 'error' | 'dead';

export type ImportStatus = 'pending' | 'hashing' | 'extracting' | 'copying' | 'complete' | 'error' | 'skipped';

export type SceneDetectionMethod = 'content' | 'adaptive' | 'threshold';

export type Theme = 'light' | 'dark' | 'system';

export type CoupleStatus = 'booked' | 'ingested' | 'editing' | 'delivered' | 'archived';

export type CameraCategory = 'cinema' | 'professional' | 'hybrid' | 'action' | 'consumer' | 'drone' | 'smartphone';

export type DeliverableType = 'highlight' | 'trailer' | 'full_length' | 'raw_footage' | 'social_clips' | 'ceremony' | 'reception';

export type DeliverableStatus = 'pending' | 'in_progress' | 'review' | 'delivered';

export type EmailType = 'booking_confirmation' | 'preview_ready' | 'delivery' | 'follow_up' | 'thank_you';

// Helper types for JSON fields
export interface CoupleDeliverable {
  type: DeliverableType;
  status: DeliverableStatus;
  notes?: string;
  delivered_at?: string;
}

export interface EmailLogEntry {
  date: string;
  type: EmailType;
  sent: boolean;
  notes?: string;
}

export interface SocialMedia {
  tiktok?: string;
  facebook?: string;
  youtube?: string;
}

// =============================================================================
// DATABASE RECORDS
// =============================================================================

export interface Setting {
  key: string;
  value: string | null;
  updated_at: string;
}

export interface Camera {
  id: number;
  name: string;
  nickname: string | null;
  medium: Medium;
  category: CameraCategory;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  color_profile: string | null;
  filename_pattern: string | null;
  color: string | null;
  is_active: number; // 0 or 1
  is_default: number; // 0 or 1 (deprecated, kept for compatibility)
  notes: string | null;
  lut_path: string | null;
  deinterlace: number; // 0 or 1
  audio_channels: 'stereo' | 'mono' | 'none';
  sharpness_baseline: number | null;
  transcode_preset: string | null;
  created_at: string;
  updated_at: string;
}

export interface CameraPattern {
  id: number;
  camera_id: number;
  pattern_type: PatternType;
  pattern: string;
  priority: number;
  created_at: string;
}

export interface Lens {
  id: number;
  name: string;
  make: string | null;
  model: string | null;
  focal_length: string | null;
  aperture: string | null;
  mount: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Couple {
  id: number;
  name: string;
  wedding_date: string | null;
  folder_name: string | null;
  notes: string | null;
  file_count: number;
  total_duration_seconds: number;
  // Workflow fields
  status: CoupleStatus;
  email: string | null;
  phone: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_state: string | null;
  date_ingested: string | null;
  date_editing_started: string | null;
  date_delivered: string | null;
  date_archived: string | null;
  source_path: string | null;
  working_path: string | null;
  delivery_path: string | null;
  package_name: string | null;
  contracted_deliverables: number | null;
  // Detail view fields (migration 11)
  due_date: string | null;
  instagram: string | null;
  social_media_json: string | null;
  deliverables_json: string | null;
  email_log_json: string | null;
  turnaround_days: number;
  created_at: string;
  updated_at: string;
}

export interface File {
  id: number;
  blake3: string;
  original_filename: string;
  original_path: string | null;
  managed_path: string | null;
  extension: string;
  file_size: number | null;
  couple_id: number | null;
  camera_id: number | null;
  detected_make: string | null;
  detected_model: string | null;
  detected_lens: string | null;
  medium: Medium | null;
  file_type: FileType | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  frame_rate: number | null;
  codec: string | null;
  bitrate: number | null;
  is_processed: number;
  is_hidden: number;
  recorded_at: string | null;
  imported_at: string;
  updated_at: string;
}

export interface FileMetadata {
  file_id: number;
  exiftool_json: string | null;
  ffprobe_json: string | null;
  extracted_at: string;
}

export interface FileSidecar {
  video_file_id: number;
  sidecar_file_id: number;
  sidecar_type: string | null;
}

export interface Scene {
  id: number;
  file_id: number;
  scene_number: number;
  start_time: number;
  end_time: number;
  duration: number;
  start_frame: number | null;
  end_frame: number | null;
  detection_method: SceneDetectionMethod | null;
  confidence: number | null;
  best_frame_number: number | null;
  best_frame_sharpness: number | null;
  best_frame_path: string | null;
  scene_type: string | null;
  caption: string | null;
  wedding_moment: string | null;
  created_at: string;
}

export interface AIAnalysis {
  id: number;
  file_id: number | null;
  scene_id: number | null;
  analysis_type: string;
  result_json: string;
  model_name: string;
  provider_name: string;
  confidence: number | null;
  prompt_used: string | null;
  processing_time_ms: number | null;
  created_at: string;
}

export interface Export {
  id: number;
  file_id: number | null;
  scene_id: number | null;
  couple_id: number | null;
  export_type: ExportType;
  output_path: string;
  output_format: string | null;
  width: number | null;
  height: number | null;
  aspect_ratio: AspectRatio | null;
  start_time: number | null;
  end_time: number | null;
  duration: number | null;
  lut_applied: string | null;
  audio_normalized: number;
  crop_applied: string | null;
  caption: string | null;
  caption_ai_analysis_id: number | null;
  status: JobStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportQueueItem {
  id: number;
  source_path: string;
  original_filename: string;
  file_size: number | null;
  couple_id: number | null;
  status: ImportStatus;
  error_message: string | null;
  progress_percent: number;
  result_file_id: number | null;
  result_blake3: string | null;
  was_duplicate: number;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: number;
  job_type: string;
  payload_json: string;
  file_id: number | null;
  couple_id: number | null;
  priority: number;
  depends_on_job_id: number | null;
  status: JobStatus;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  started_at: string | null;
  completed_at: string | null;
  processing_time_ms: number | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// INPUT TYPES (for creating/updating records)
// =============================================================================

export interface CameraInput {
  name: string;
  nickname?: string | null;
  medium: Medium;
  category?: CameraCategory;
  make?: string | null;
  model?: string | null;
  serial_number?: string | null;
  color_profile?: string | null;
  filename_pattern?: string | null;
  color?: string | null;
  is_active?: boolean;
  is_default?: boolean; // deprecated
  notes?: string | null;
  lut_path?: string | null;
  deinterlace?: boolean;
  audio_channels?: 'stereo' | 'mono' | 'none';
  sharpness_baseline?: number | null;
  transcode_preset?: string | null;
}

export interface CameraPatternInput {
  camera_id: number;
  pattern_type: PatternType;
  pattern: string;
  priority?: number;
}

export interface LensInput {
  name: string;
  make?: string | null;
  model?: string | null;
  focal_length?: string | null;
  aperture?: string | null;
  mount?: string | null;
  notes?: string | null;
}

export interface CoupleInput {
  name: string;
  wedding_date?: string | null;
  notes?: string | null;
  // Workflow fields
  status?: CoupleStatus;
  email?: string | null;
  phone?: string | null;
  venue_name?: string | null;
  venue_city?: string | null;
  venue_state?: string | null;
  source_path?: string | null;
  working_path?: string | null;
  delivery_path?: string | null;
  package_name?: string | null;
  contracted_deliverables?: number | null;
  // Detail view fields
  due_date?: string | null;
  instagram?: string | null;
  social_media?: SocialMedia | null;
  deliverables?: CoupleDeliverable[] | null;
  email_log?: EmailLogEntry[] | null;
  turnaround_days?: number;
}

export interface ImportInput {
  files: Array<{
    filePath: string;
    originalName: string;
  }>;
  couple_id?: number | null;
}

export interface ExportInput {
  file_id: number;
  scene_id?: number | null;
  export_type: ExportType;
  aspect_ratio?: AspectRatio;
  lut?: string | null;
  normalize_audio?: boolean;
  include_caption?: boolean;
}

// =============================================================================
// EXTERNAL TOOL RESULTS
// =============================================================================

export interface FFProbeFormat {
  filename: string;
  duration: string;
  size: string;
  bit_rate: string;
  format_name: string;
  format_long_name: string;
  tags?: Record<string, string>;
}

export interface FFProbeStream {
  index: number;
  codec_type: 'video' | 'audio' | 'subtitle' | 'data';
  codec_name: string;
  codec_long_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  bit_rate?: string;
  channels?: number;
  sample_rate?: string;
  tags?: Record<string, string>;
}

export interface FFProbeResult {
  format: FFProbeFormat;
  streams: FFProbeStream[];
}

export interface ExifToolResult {
  SourceFile: string;
  FileName: string;
  FileSize: string;
  FileType: string;
  MIMEType: string;
  Make?: string;
  Model?: string;
  CreateDate?: string;
  ModifyDate?: string;
  Duration?: string | number;
  ImageWidth?: number;
  ImageHeight?: number;
  VideoFrameRate?: number;
  AudioChannels?: number;
  AudioSampleRate?: number;
  GPSLatitude?: string;
  GPSLongitude?: string;
  [key: string]: unknown;
}

export interface HashResult {
  hash: string;
  filePath: string;
  fileSize: number;
}

// =============================================================================
// SERVICE RESULTS
// =============================================================================

export interface ImportResult {
  success: boolean;
  hash: string;
  type: FileType | 'skipped';
  duplicate: boolean;
  skipped?: boolean;
  sidecarOnly?: boolean;
  archivePath?: string;
  error?: string;
  warnings?: string[];
}

export interface ImportBatchResult {
  total: number;
  imported: number;
  duplicates: number;
  skipped: number;
  errors: number;
  files: ImportResult[];
}

export interface SceneDetectionResult {
  scenes: Array<{
    scene_number: number;
    start_time: number;
    end_time: number;
    start_frame: number;
    end_frame: number;
    duration: number;
  }>;
  duration_ms: number;
  method: SceneDetectionMethod;
}

export interface SharpnessResult {
  frame_number: number;
  time_seconds: number;
  sharpness: number;
}

export interface FaceDetectionResult {
  faces: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
  }>;
  frame_number: number;
}

export interface SmartCropResult {
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  source_aspect: AspectRatio;
  target_aspect: AspectRatio;
  method: 'face' | 'saliency' | 'center';
}

// =============================================================================
// AI INTEGRATION
// =============================================================================

export interface LiteLLMConfig {
  baseUrl: string;
  modelVLM: string;
  modelLLM: string;
}

export interface AISource {
  model: string;
  provider: string;
  timestamp: Date;
  confidence?: number;
}

export interface CaptionResult {
  caption: string;
  hashtags?: string[];
  source: AISource;
}

export interface AIAnalysisResult {
  type: string;
  result: unknown;
  source: AISource;
}

// =============================================================================
// IPC MESSAGES
// =============================================================================

export interface ImportProgress {
  current: number;
  total: number;
  filename: string;
  status: ImportStatus;
}

export interface JobProgress {
  job_id: number;
  job_type: string;
  progress_percent: number;
  status: JobStatus;
  message?: string;
}

// =============================================================================
// VIEW TYPES (joined queries)
// =============================================================================

export interface FileWithCamera extends File {
  camera_name: string | null;
  camera_medium: Medium | null;
  camera_lut_path: string | null;
  couple_name: string | null;
  couple_wedding_date: string | null;
}

export interface CameraWithPatterns extends Camera {
  patterns: CameraPattern[];
}

export interface CoupleWithFiles extends Couple {
  files: File[];
}

export interface SceneWithFile extends Scene {
  file_blake3: string;
  file_original_filename: string;
}

// =============================================================================
// VALIDATION SCHEMAS (Zod patterns)
// =============================================================================

// Use these patterns with Zod for IPC validation:
//
// import { z } from 'zod';
//
// export const Blake3Schema = z.string().length(16).regex(/^[a-f0-9]+$/);
//
// export const MediumSchema = z.enum(['dadcam', 'super8', 'modern']);
//
// export const CameraInputSchema = z.object({
//   name: z.string().min(1),
//   medium: MediumSchema,
//   notes: z.string().nullable().optional(),
//   lut_path: z.string().nullable().optional(),
//   deinterlace: z.boolean().optional(),
//   audio_channels: z.enum(['stereo', 'mono', 'none']).optional(),
//   sharpness_baseline: z.number().nullable().optional(),
//   transcode_preset: z.string().nullable().optional(),
// });
//
// export const CoupleInputSchema = z.object({
//   name: z.string().min(1),
//   wedding_date: z.string().nullable().optional(),
//   notes: z.string().nullable().optional(),
// });
//
// export const ImportInputSchema = z.object({
//   files: z.array(z.object({
//     filePath: z.string(),
//     originalName: z.string(),
//   })),
//   couple_id: z.number().nullable().optional(),
// });
