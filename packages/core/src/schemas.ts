/**
 * Zod validation schemas for IPC validation
 */

import { z } from 'zod';

// =============================================================================
// BASE SCHEMAS
// =============================================================================

export const Blake3Schema = z.string().length(16).regex(/^[a-f0-9]+$/, 'Must be 16 hex characters');

export const MediumSchema = z.enum(['dadcam', 'super8', 'modern']);

export const FileTypeSchema = z.enum(['video', 'sidecar', 'audio', 'other']);

export const PatternTypeSchema = z.enum(['filename', 'folder', 'extension']);

export const ExportTypeSchema = z.enum(['screenshot', 'clip']);

export const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1', '4:5', '4:3']);

export const JobStatusSchema = z.enum(['pending', 'processing', 'complete', 'error', 'dead']);

export const ImportStatusSchema = z.enum(['pending', 'hashing', 'extracting', 'copying', 'complete', 'error', 'skipped']);

export const ThemeSchema = z.enum(['light', 'dark', 'system']);

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

export const CameraInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  medium: MediumSchema,
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  is_default: z.boolean().optional().default(false),
  notes: z.string().nullable().optional(),
  lut_path: z.string().nullable().optional(),
  deinterlace: z.boolean().optional().default(false),
  audio_channels: z.enum(['stereo', 'mono', 'none']).optional().default('stereo'),
  sharpness_baseline: z.number().nullable().optional(),
  transcode_preset: z.string().nullable().optional(),
});

export const CameraPatternInputSchema = z.object({
  camera_id: z.number().int().positive(),
  pattern_type: PatternTypeSchema,
  pattern: z.string().min(1, 'Pattern is required'),
  priority: z.number().int().optional().default(0),
});

export const CoupleInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  wedding_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const ImportInputSchema = z.object({
  directory: z.string().min(1),
  couple_id: z.number().int().positive().nullable().optional(),
  couple_folder: z.string().nullable().optional(),
});

export const FileImportInputSchema = z.object({
  files: z.array(z.object({
    filePath: z.string(),
    originalName: z.string(),
  })),
  couple_id: z.number().int().positive().nullable().optional(),
});

export const ExportInputSchema = z.object({
  file_id: z.number().int().positive(),
  scene_id: z.number().int().positive().nullable().optional(),
  export_type: ExportTypeSchema,
  aspect_ratio: AspectRatioSchema.optional(),
  lut: z.string().nullable().optional(),
  normalize_audio: z.boolean().optional().default(false),
  include_caption: z.boolean().optional().default(false),
});

export const SettingInputSchema = z.object({
  key: z.string().min(1),
  value: z.string().nullable(),
});

// =============================================================================
// TYPE EXPORTS FROM SCHEMAS
// =============================================================================

export type CameraInputValidated = z.infer<typeof CameraInputSchema>;
export type CameraPatternInputValidated = z.infer<typeof CameraPatternInputSchema>;
export type CoupleInputValidated = z.infer<typeof CoupleInputSchema>;
export type ImportInputValidated = z.infer<typeof ImportInputSchema>;
export type ExportInputValidated = z.infer<typeof ExportInputSchema>;
