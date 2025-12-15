import { z } from 'zod';
import { randomBytes } from 'crypto';

/**
 * IPC Input Validation Schemas
 * Validates all user inputs from renderer process
 */

/**
 * ADR-049: Unified 16-char hex ID format
 * All IDs use 16 lowercase hex characters (64 bits)
 * - Sufficient entropy for local archive (2^64 = 18 quintillion)
 * - Consistent format across all entity types
 * - Smaller than UUID (16 chars vs 36 chars)
 */
export const Hex16IdSchema = z.string().length(16).regex(/^[a-f0-9]+$/, 'Must be 16-char lowercase hex');

/**
 * Generate a new 16-char hex ID
 */
export function generateId(): string {
  return randomBytes(8).toString('hex');
}

// Semantic aliases for specific ID types (all use same format)
export const LocIdSchema = Hex16IdSchema;      // Location ID
export const SubIdSchema = Hex16IdSchema;      // Sub-location ID
export const UserIdSchema = Hex16IdSchema;     // User ID
export const NoteIdSchema = Hex16IdSchema;     // Note ID
export const BookmarkIdSchema = Hex16IdSchema; // Bookmark ID
export const ProjectIdSchema = Hex16IdSchema;  // Project ID
export const ImportIdSchema = Hex16IdSchema;   // Import record ID
export const MapIdSchema = Hex16IdSchema;      // Reference map ID
export const PointIdSchema = Hex16IdSchema;    // Reference map point ID
export const ViewIdSchema = Hex16IdSchema;     // Location view ID
export const ExclusionIdSchema = Hex16IdSchema; // Location exclusion ID
export const VersionIdSchema = Hex16IdSchema;  // Websource version ID

// Legacy alias (deprecated - use Hex16IdSchema)
export const Blake3IdSchema = Hex16IdSchema;
export const PositiveIntSchema = z.number().int().positive();
export const NonNegativeIntSchema = z.number().int().nonnegative();
export const LimitSchema = z.number().int().positive().max(1000).default(10);
export const OffsetSchema = z.number().int().nonnegative().default(0);
export const FilePathSchema = z.string().min(1).max(4096);
export const UrlSchema = z.string().url().max(2048);

// OPT-058: Chunk progress tracking for unified progress bars
export const ChunkOffsetSchema = z.number().int().min(0).default(0);
export const TotalOverallSchema = z.number().int().min(1).optional();

// Validation helper function
export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new Error(`Validation error: ${messages}`);
    }
    throw error;
  }
}

// Common parameter schemas (ADR-049: unified 16-char hex)
export const IdParamSchema = z.object({
  id: Hex16IdSchema,
});

export const TwoIdParamsSchema = z.object({
  id1: Hex16IdSchema,
  id2: Hex16IdSchema,
});

// Location/SubLocation ID parameter schemas
export const LocIdParamSchema = z.object({
  locid: Blake3IdSchema,
});

export const SubIdParamSchema = z.object({
  subid: Blake3IdSchema,
});

export const LocSubIdParamsSchema = z.object({
  locid: Blake3IdSchema,
  subid: Blake3IdSchema.nullable().optional(),
});

export const PaginationSchema = z.object({
  limit: LimitSchema,
  offset: OffsetSchema,
});

// Settings validation - whitelist of allowed setting keys
export const SettingKeySchema = z.enum([
  // UI preferences
  'theme',
  'defaultView',
  'sortBy',
  'sortOrder',
  // Backup settings
  'enableBackups',
  'backupInterval',
  'maxBackups',
  'last_backup_date',
  // Core app settings (used by Setup/Settings pages)
  'archive_folder',
  'current_user',
  'current_user_id',
  'setup_complete',
  'app_mode',
  'require_login',
  'login_required',
  'import_map',
  'map_import',
]);

export const SettingValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
