/**
 * Document Sync Service
 *
 * Generates self-documenting folder structure for couple archives.
 * Creates a /documents folder with:
 *   - manifest.json    - Complete file inventory with hashes
 *   - couple.json      - Couple record, contacts, package, deliverables
 *   - cameras.json     - Camera equipment used on this project
 *   - import-log.json  - Import session history
 *   - README.txt       - Human-readable summary
 *
 * This makes each couple folder orphan-proof - if the database is lost,
 * all metadata survives in the folder itself.
 *
 * @module services/document-sync-service
 */

import { promises as fs } from 'fs';
import path from 'path';
import type {
  File,
  Couple,
  Camera,
  Medium,
  FootageType,
  ContractDeliverable,
} from '@nightfox/core';
import { filesRepository } from '../repositories/files-repository';
import { camerasRepository } from '../repositories/cameras-repository';
import { couplesRepository } from '../repositories/couples-repository';
import { getDatabase } from '../main/database';

/**
 * Schema versions for document files
 */
const SCHEMA_VERSIONS = {
  manifest: '1.0',
  couple: '1.0',
  cameras: '1.0',
  importLog: '1.0',
};

// =============================================================================
// MANIFEST TYPES
// =============================================================================

interface ManifestFile {
  blake3: string;
  path: string;
  original_filename: string;
  original_path: string | null;
  file_size: number | null;
  file_type: string | null;
  medium: Medium | null;
  footage_type: FootageType;
  recorded_at: string | null;
  imported_at: string;
  camera_slug: string | null;
  camera_name: string | null;
  metadata: {
    duration_seconds: number | null;
    width: number | null;
    height: number | null;
    frame_rate: number | null;
    codec: string | null;
    bitrate: number | null;
    detected_make: string | null;
    detected_model: string | null;
  };
}

interface ManifestSummary {
  total_files: number;
  total_bytes: number;
  total_duration_seconds: number;
  by_medium: Record<string, { count: number; bytes: number; duration: number }>;
  by_footage_type: Record<string, number>;
  by_camera: Record<string, { count: number; duration: number }>;
}

interface Manifest {
  schema_version: string;
  generator: string;
  generated_at: string;
  hash_algorithm: string;
  couple_folder: string;
  files: ManifestFile[];
  summary: ManifestSummary;
}

// =============================================================================
// COUPLE DOCUMENT TYPES
// =============================================================================

interface CoupleDocument {
  schema_version: string;
  exported_at: string;
  database_id: number;

  couple: {
    name: string;
    folder_name: string | null;
    wedding_date: string | null;
    date_night_date: string | null;
    status: string;
  };

  partners: {
    partner_1: {
      name: string | null;
      email: string | null;
      phone: string | null;
      instagram: string | null;
    };
    partner_2: {
      name: string | null;
      email: string | null;
      phone: string | null;
      instagram: string | null;
    };
    mailing_address: string | null;
  };

  venue: {
    name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
  };

  package: {
    name: string | null;
    price: number | null;
    videographer_count: number;
    mediums: Medium[];
    deliverables: ContractDeliverable[];
  };

  timeline: {
    booked_at: string | null;
    date_ingested: string | null;
    date_editing_started: string | null;
    date_delivered: string | null;
    due_date: string | null;
    turnaround_days: number;
  };

  notes: string | null;
}

// =============================================================================
// CAMERAS DOCUMENT TYPES
// =============================================================================

interface CameraUsage {
  database_id: number;
  name: string;
  nickname: string | null;
  slug: string;
  medium: Medium;
  make: string | null;
  model: string | null;
  category: string;
  color_profile: string | null;
  lut_path: string | null;
  usage: {
    file_count: number;
    total_bytes: number;
    total_duration_seconds: number;
  };
}

interface CamerasDocument {
  schema_version: string;
  generated_at: string;
  cameras: CameraUsage[];
}

// =============================================================================
// IMPORT LOG TYPES
// =============================================================================

interface ImportSession {
  session_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  source_paths: string[];
  results: {
    files_imported: number;
    duplicates_skipped: number;
    errors: number;
    total_bytes: number;
  };
  notes?: string;
}

interface ImportLogDocument {
  schema_version: string;
  sessions: ImportSession[];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate camera slug from name
 */
function generateCameraSlug(cameraName: string | null): string {
  if (!cameraName) return 'unknown';
  return cameraName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Format seconds as human-readable duration
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Get relative path from working_path
 */
function getRelativePath(absolutePath: string, workingPath: string): string {
  if (absolutePath.startsWith(workingPath)) {
    return absolutePath.slice(workingPath.length).replace(/^\//, '');
  }
  return absolutePath;
}

// =============================================================================
// DOCUMENT GENERATION
// =============================================================================

/**
 * Generate manifest.json content
 */
export function generateManifest(
  couple: Couple,
  files: File[],
  cameras: Map<number, Camera>
): Manifest {
  const workingPath = couple.working_path || '';
  const folderName = couple.folder_name || 'unknown';

  // Build file entries
  const manifestFiles: ManifestFile[] = files
    .filter(f => f.managed_path) // Only files in managed storage
    .map(f => {
      const camera = f.camera_id ? cameras.get(f.camera_id) : null;
      const cameraSlug = camera ? generateCameraSlug(camera.nickname || camera.name) : null;

      return {
        blake3: f.blake3,
        path: getRelativePath(f.managed_path!, workingPath),
        original_filename: f.original_filename,
        original_path: f.original_path,
        file_size: f.file_size,
        file_type: f.file_type,
        medium: f.medium,
        footage_type: f.footage_type,
        recorded_at: f.recorded_at,
        imported_at: f.imported_at,
        camera_slug: cameraSlug,
        camera_name: camera?.name || null,
        metadata: {
          duration_seconds: f.duration_seconds,
          width: f.width,
          height: f.height,
          frame_rate: f.frame_rate,
          codec: f.codec,
          bitrate: f.bitrate,
          detected_make: f.detected_make,
          detected_model: f.detected_model,
        },
      };
    });

  // Calculate summary
  const summary: ManifestSummary = {
    total_files: manifestFiles.length,
    total_bytes: manifestFiles.reduce((sum, f) => sum + (f.file_size || 0), 0),
    total_duration_seconds: manifestFiles.reduce(
      (sum, f) => sum + (f.metadata.duration_seconds || 0),
      0
    ),
    by_medium: {},
    by_footage_type: {},
    by_camera: {},
  };

  // Aggregate by medium
  for (const f of manifestFiles) {
    const medium = f.medium || 'unknown';
    if (!summary.by_medium[medium]) {
      summary.by_medium[medium] = { count: 0, bytes: 0, duration: 0 };
    }
    summary.by_medium[medium].count++;
    summary.by_medium[medium].bytes += f.file_size || 0;
    summary.by_medium[medium].duration += f.metadata.duration_seconds || 0;
  }

  // Aggregate by footage type
  for (const f of manifestFiles) {
    const footageType = f.footage_type || 'other';
    summary.by_footage_type[footageType] = (summary.by_footage_type[footageType] || 0) + 1;
  }

  // Aggregate by camera
  for (const f of manifestFiles) {
    const cameraKey = f.camera_slug || 'unknown';
    if (!summary.by_camera[cameraKey]) {
      summary.by_camera[cameraKey] = { count: 0, duration: 0 };
    }
    summary.by_camera[cameraKey].count++;
    summary.by_camera[cameraKey].duration += f.metadata.duration_seconds || 0;
  }

  return {
    schema_version: SCHEMA_VERSIONS.manifest,
    generator: 'nightfox-desktop',
    generated_at: new Date().toISOString(),
    hash_algorithm: 'blake3-64',
    couple_folder: folderName,
    files: manifestFiles,
    summary,
  };
}

/**
 * Generate couple.json content
 */
export function generateCoupleDocument(couple: Couple): CoupleDocument {
  // Parse JSON fields
  let mediums: Medium[] = [];
  let deliverables: ContractDeliverable[] = [];

  if (couple.mediums_json) {
    try {
      mediums = JSON.parse(couple.mediums_json);
    } catch {
      // Invalid JSON
    }
  }

  if (couple.deliverables_json) {
    try {
      deliverables = JSON.parse(couple.deliverables_json);
    } catch {
      // Invalid JSON
    }
  }

  return {
    schema_version: SCHEMA_VERSIONS.couple,
    exported_at: new Date().toISOString(),
    database_id: couple.id,

    couple: {
      name: couple.name,
      folder_name: couple.folder_name,
      wedding_date: couple.wedding_date,
      date_night_date: couple.date_night_date,
      status: couple.status,
    },

    partners: {
      partner_1: {
        name: couple.partner_1_name,
        email: couple.partner_1_email,
        phone: couple.phone,
        instagram: couple.partner_1_instagram,
      },
      partner_2: {
        name: couple.partner_2_name,
        email: couple.partner_2_email,
        phone: couple.phone_2,
        instagram: couple.partner_2_instagram,
      },
      mailing_address: couple.mailing_address,
    },

    venue: {
      name: couple.venue_name,
      address: couple.venue_address,
      city: couple.venue_city,
      state: couple.venue_state,
    },

    package: {
      name: couple.package_name,
      price: couple.package_price,
      videographer_count: couple.videographer_count,
      mediums,
      deliverables,
    },

    timeline: {
      booked_at: couple.created_at,
      date_ingested: couple.date_ingested,
      date_editing_started: couple.date_editing_started,
      date_delivered: couple.date_delivered,
      due_date: couple.due_date,
      turnaround_days: couple.turnaround_days,
    },

    notes: couple.notes,
  };
}

/**
 * Generate cameras.json content
 */
export function generateCamerasDocument(
  files: File[],
  cameras: Map<number, Camera>
): CamerasDocument {
  // Aggregate usage per camera
  const usageMap = new Map<
    number,
    { count: number; bytes: number; duration: number }
  >();

  for (const f of files) {
    if (!f.camera_id || !f.managed_path) continue;

    const usage = usageMap.get(f.camera_id) || { count: 0, bytes: 0, duration: 0 };
    usage.count++;
    usage.bytes += f.file_size || 0;
    usage.duration += f.duration_seconds || 0;
    usageMap.set(f.camera_id, usage);
  }

  // Build camera entries
  const cameraEntries: CameraUsage[] = [];

  for (const [cameraId, usage] of usageMap.entries()) {
    const camera = cameras.get(cameraId);
    if (!camera) continue;

    cameraEntries.push({
      database_id: camera.id,
      name: camera.name,
      nickname: camera.nickname,
      slug: generateCameraSlug(camera.nickname || camera.name),
      medium: camera.medium,
      make: camera.make,
      model: camera.model,
      category: camera.category,
      color_profile: camera.color_profile,
      lut_path: camera.lut_path,
      usage: {
        file_count: usage.count,
        total_bytes: usage.bytes,
        total_duration_seconds: usage.duration,
      },
    });
  }

  // Sort by file count descending
  cameraEntries.sort((a, b) => b.usage.file_count - a.usage.file_count);

  return {
    schema_version: SCHEMA_VERSIONS.cameras,
    generated_at: new Date().toISOString(),
    cameras: cameraEntries,
  };
}

/**
 * Generate import-log.json content from database
 */
export function generateImportLog(coupleId: number): ImportLogDocument {
  const db = getDatabase();

  const sessions = db
    .prepare(
      `
      SELECT
        session_id,
        started_at,
        completed_at,
        status,
        source_paths,
        processed_files,
        duplicate_files,
        error_files,
        total_bytes
      FROM import_sessions
      WHERE couple_id = ?
      ORDER BY started_at DESC
    `
    )
    .all(coupleId) as Array<{
    session_id: string;
    started_at: string;
    completed_at: string | null;
    status: string;
    source_paths: string;
    processed_files: number;
    duplicate_files: number;
    error_files: number;
    total_bytes: number;
  }>;

  const importSessions: ImportSession[] = sessions.map(s => ({
    session_id: s.session_id,
    started_at: s.started_at,
    completed_at: s.completed_at,
    status: s.status,
    source_paths: JSON.parse(s.source_paths || '[]'),
    results: {
      files_imported: s.processed_files - s.duplicate_files,
      duplicates_skipped: s.duplicate_files,
      errors: s.error_files,
      total_bytes: s.total_bytes,
    },
  }));

  return {
    schema_version: SCHEMA_VERSIONS.importLog,
    sessions: importSessions,
  };
}

/**
 * Generate README.txt content
 */
export function generateReadme(
  couple: Couple,
  manifest: Manifest,
  camerasDoc: CamerasDocument
): string {
  // Parse deliverables
  let deliverables: ContractDeliverable[] = [];
  if (couple.deliverables_json) {
    try {
      deliverables = JSON.parse(couple.deliverables_json);
    } catch {
      // Invalid JSON
    }
  }

  // Format wedding date
  const weddingDateStr = couple.wedding_date
    ? new Date(couple.wedding_date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Not set';

  // Build venue string
  const venueStr = [couple.venue_name, couple.venue_city, couple.venue_state]
    .filter(Boolean)
    .join(', ');

  // Build medium breakdown
  const mediumLines = Object.entries(manifest.summary.by_medium)
    .map(([medium, stats]) => `  ${medium}: ${stats.count} files (${formatBytes(stats.bytes)})`)
    .join('\n');

  // Build camera list
  const cameraLines = camerasDoc.cameras
    .map(c => `  - ${c.name}${c.nickname ? ` (${c.nickname})` : ''}: ${c.usage.file_count} files, ${formatDuration(c.usage.total_duration_seconds)}`)
    .join('\n');

  // Build deliverables checklist
  const deliverableLines = deliverables
    .map(d => `[${d.status === 'delivered' ? 'x' : ' '}] ${d.name}${d.medium ? ` (${d.medium})` : ''}`)
    .join('\n');

  return `NIGHTFOX FILMS - PROJECT ARCHIVE
================================

Couple:        ${couple.name}
Wedding Date:  ${weddingDateStr}
Venue:         ${venueStr || 'Not set'}
Package:       ${couple.package_name || 'Not set'}

ARCHIVE CONTENTS
----------------
Total Files:    ${manifest.summary.total_files} video files
Total Size:     ${formatBytes(manifest.summary.total_bytes)}
Total Duration: ${formatDuration(manifest.summary.total_duration_seconds)}

By Medium:
${mediumLines}

By Camera:
${cameraLines}

DELIVERABLES
------------
${deliverableLines || '(No deliverables configured)'}

FOLDER STRUCTURE
----------------
source/           Raw footage organized by medium and camera
  modern/         Digital video (4K, HD)
  super8/         Film scans
  dadcam/         Vintage camcorder footage
documents/        This folder - metadata and manifests

FILE NAMING
-----------
Files are named by their BLAKE3 hash (64-bit, 16 hex characters).
Example: a1b2c3d4e5f67890.mp4

To verify a file's integrity:
  1. Compute BLAKE3 hash of the file
  2. Truncate to first 8 bytes (16 hex chars)
  3. Compare to filename

MACHINE-READABLE DATA
---------------------
manifest.json    Complete file inventory with hashes and metadata
couple.json      Couple record, contacts, package, deliverables
cameras.json     Camera equipment used on this project
import-log.json  Import session history

Each video file also has a companion .json sidecar with full metadata.

---
Generated by Nightfox Desktop
Archive created: ${new Date().toISOString().split('T')[0]}

For support: hello@nightfoxfilms.com
`;
}

// =============================================================================
// MAIN SYNC FUNCTION
// =============================================================================

export interface SyncDocumentsResult {
  success: boolean;
  documentsPath: string | null;
  filesWritten: string[];
  errors: string[];
}

/**
 * Sync all documents for a couple
 * Creates/updates the /documents folder with all metadata files
 */
export async function syncCoupleDocuments(
  coupleId: number
): Promise<SyncDocumentsResult> {
  const result: SyncDocumentsResult = {
    success: false,
    documentsPath: null,
    filesWritten: [],
    errors: [],
  };

  // Load couple
  const couple = couplesRepository.findById(coupleId);
  if (!couple) {
    result.errors.push('Couple not found');
    return result;
  }

  // Need working_path and folder_name
  if (!couple.working_path || !couple.folder_name) {
    result.errors.push('Couple has no working_path or folder_name configured');
    return result;
  }

  // Build documents path
  // Handle both cases: working_path is storage root OR working_path includes folder_name
  let coupleFolderPath: string;
  if (couple.working_path.endsWith(couple.folder_name)) {
    // working_path already includes folder_name (e.g., /Volumes/nightfox/12-31 Julia & Sven)
    coupleFolderPath = couple.working_path;
  } else {
    // working_path is just the storage root (e.g., /Volumes/nightfox)
    coupleFolderPath = path.join(couple.working_path, couple.folder_name);
  }
  const documentsPath = path.join(coupleFolderPath, 'documents');
  result.documentsPath = documentsPath;
  console.log(`[DocumentSync] Couple folder path: ${coupleFolderPath}`);

  // Ensure documents directory exists
  try {
    await fs.mkdir(documentsPath, { recursive: true });
  } catch (error) {
    result.errors.push(`Failed to create documents directory: ${error}`);
    return result;
  }

  // Load files for this couple
  const files = filesRepository.findByCouple(coupleId);

  // Load cameras (build map for quick lookup)
  const allCameras = camerasRepository.findAll();
  const camerasMap = new Map<number, Camera>();
  for (const camera of allCameras) {
    camerasMap.set(camera.id, camera);
  }

  // Generate documents
  const manifest = generateManifest(couple, files, camerasMap);
  const coupleDoc = generateCoupleDocument(couple);
  const camerasDoc = generateCamerasDocument(files, camerasMap);
  const importLog = generateImportLog(coupleId);
  const readme = generateReadme(couple, manifest, camerasDoc);

  // Write files
  const filesToWrite: Array<{ name: string; content: string }> = [
    { name: 'manifest.json', content: JSON.stringify(manifest, null, 2) },
    { name: 'couple.json', content: JSON.stringify(coupleDoc, null, 2) },
    { name: 'cameras.json', content: JSON.stringify(camerasDoc, null, 2) },
    { name: 'import-log.json', content: JSON.stringify(importLog, null, 2) },
    { name: 'README.txt', content: readme },
  ];

  for (const file of filesToWrite) {
    const filePath = path.join(documentsPath, file.name);
    try {
      await fs.writeFile(filePath, file.content, 'utf-8');
      result.filesWritten.push(file.name);
      console.log(`[DocumentSync] Written: ${filePath}`);
    } catch (error) {
      result.errors.push(`Failed to write ${file.name}: ${error}`);
    }
  }

  result.success = result.errors.length === 0;

  if (result.success) {
    console.log(`[DocumentSync] Completed for couple ${couple.name}: ${result.filesWritten.length} files`);
  } else {
    console.warn(`[DocumentSync] Completed with errors for couple ${couple.name}:`, result.errors);
  }

  return result;
}

/**
 * Update manifest after import (incremental update)
 * Faster than full sync - only updates manifest.json
 */
export async function updateManifestAfterImport(
  coupleId: number
): Promise<{ success: boolean; error: string | null }> {
  const couple = couplesRepository.findById(coupleId);
  if (!couple || !couple.working_path || !couple.folder_name) {
    return { success: false, error: 'Couple not configured for managed storage' };
  }

  // Handle both cases: working_path is storage root OR working_path includes folder_name
  const coupleFolderPath = couple.working_path.endsWith(couple.folder_name)
    ? couple.working_path
    : path.join(couple.working_path, couple.folder_name);
  const documentsPath = path.join(coupleFolderPath, 'documents');

  // Ensure directory exists
  try {
    await fs.mkdir(documentsPath, { recursive: true });
  } catch {
    // Directory may already exist
  }

  // Load files and cameras
  const files = filesRepository.findByCouple(coupleId);
  const allCameras = camerasRepository.findAll();
  const camerasMap = new Map<number, Camera>();
  for (const camera of allCameras) {
    camerasMap.set(camera.id, camera);
  }

  // Generate and write manifest
  const manifest = generateManifest(couple, files, camerasMap);
  const manifestPath = path.join(documentsPath, 'manifest.json');

  try {
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`[DocumentSync] Updated manifest: ${manifestPath}`);
    return { success: true, error: null };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMsg };
  }
}
