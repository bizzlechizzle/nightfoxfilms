import { z } from 'zod';

/**
 * BLAKE3 hash validation: exactly 16 lowercase hex characters
 * ADR-046: Used for media hashes (imghash, vidhash, etc.)
 */
const HashSchema = z.string().length(16).regex(/^[a-f0-9]+$/, 'Must be 16 lowercase hex characters');

/**
 * BLAKE3 ID validation: exactly 16 lowercase hex characters
 * ADR-046: Used for location and sublocation IDs
 */
const Blake3IdSchema = z.string().length(16).regex(/^[a-f0-9]+$/, 'Must be 16 lowercase hex characters');

// Base Media Schema
// ADR-046: locid/subid use BLAKE3 16-char hex IDs
const BaseMediaSchema = z.object({
  locid: Blake3IdSchema.optional(),
  subid: Blake3IdSchema.optional(),
  auth_imp: z.string().optional()
});

// Image Schema
export const ImageSchema = BaseMediaSchema.extend({
  imghash: HashSchema,
  imgnam: z.string(),
  imgnamo: z.string(),
  imgloc: z.string(),
  imgloco: z.string(),
  imgadd: z.string().datetime(),
  meta_exiftool: z.record(z.unknown()).optional(),
  meta_width: z.number().optional(),
  meta_height: z.number().optional(),
  meta_date_taken: z.string().datetime().optional(),
  meta_camera_make: z.string().optional(),
  meta_camera_model: z.string().optional(),
  meta_gps_lat: z.number().optional(),
  meta_gps_lng: z.number().optional()
});

export type Image = z.infer<typeof ImageSchema>;

// Video Schema
export const VideoSchema = BaseMediaSchema.extend({
  vidhash: HashSchema,
  vidnam: z.string(),
  vidnamo: z.string(),
  vidloc: z.string(),
  vidloco: z.string(),
  vidadd: z.string().datetime(),
  meta_ffmpeg: z.record(z.unknown()).optional(),
  meta_exiftool: z.record(z.unknown()).optional(),
  meta_duration: z.number().optional(),
  meta_width: z.number().optional(),
  meta_height: z.number().optional(),
  meta_codec: z.string().optional(),
  meta_fps: z.number().optional(),
  meta_date_taken: z.string().datetime().optional()
});

export type Video = z.infer<typeof VideoSchema>;

// Document Schema
export const DocumentSchema = BaseMediaSchema.extend({
  dochash: HashSchema,
  docnam: z.string(),
  docnamo: z.string(),
  docloc: z.string(),
  docloco: z.string(),
  docadd: z.string().datetime(),
  meta_exiftool: z.record(z.unknown()).optional(),
  meta_page_count: z.number().optional(),
  meta_author: z.string().optional(),
  meta_title: z.string().optional()
});

export type Document = z.infer<typeof DocumentSchema>;

// Map Schema
export const MapSchema = BaseMediaSchema.extend({
  maphash: HashSchema,
  mapnam: z.string(),
  mapnamo: z.string(),
  maploc: z.string(),
  maploco: z.string(),
  mapadd: z.string().datetime(),
  meta_exiftool: z.record(z.unknown()).optional(),
  meta_map: z.record(z.unknown()).optional(),
  reference: z.string().optional(),
  map_states: z.string().optional(),
  map_verified: z.boolean().default(false)
});

export type Map = z.infer<typeof MapSchema>;
