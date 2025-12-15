import path from 'path';
import fs from 'fs/promises';
import { generateId } from '../main/ipc-validation';

/**
 * Import Phase States per whereswaldo11.md spec:
 * Phase 1: LOG IT - Validate inputs, create manifest
 * Phase 2: SERIALIZE IT - Batch metadata extraction
 * Phase 3: COPY & NAME IT - Copy files, verify integrity
 * Phase 4: DUMP - Single DB transaction
 */
export type ImportPhase = 'phase_1_log' | 'phase_2_serialize' | 'phase_3_copy' | 'phase_4_dump' | 'complete' | 'failed';

export type FileStatus = 'pending' | 'serialized' | 'copied' | 'verified' | 'complete' | 'duplicate' | 'error';

export type FileType = 'image' | 'video' | 'map' | 'document';

export interface ManifestFileEntry {
  index: number;
  original_path: string;
  original_name: string;
  size_bytes: number | null;
  sha256: string | null;
  type: FileType | null;
  is_duplicate: boolean;
  status: FileStatus;
  error?: string;

  // Phase 2: Serialized metadata
  metadata?: {
    width?: number | null;
    height?: number | null;
    date_taken?: string | null;
    camera_make?: string | null;
    camera_model?: string | null;
    duration?: number | null;
    codec?: string | null;
    fps?: number | null;
    gps?: { lat: number; lng: number } | null;
    raw_exif?: string | null;
    raw_ffmpeg?: string | null;
    map_data?: any | null;
  };
  gps_warning?: {
    message: string;
    distance: number;
    severity: 'minor' | 'major';
    location_gps: { lat: number; lng: number };
    media_gps: { lat: number; lng: number };
  };

  // Phase 3: Copy results
  archive_path?: string;
  archive_name?: string;
  verified?: boolean;

  // Phase 4: Database results
  database_id?: string;
}

/**
 * Location metadata for import manifests
 * ADR-046: Removed loc12/slocnam - folder paths now use locid directly
 */
export interface ManifestLocation {
  locid: string;
  locnam: string;
  state: string | null;
  category: string | null;
  gps?: { lat: number; lng: number } | null;
  address?: {
    street?: string | null;
    city?: string | null;
    county?: string | null;
    state?: string | null;
    zipcode?: string | null;
  } | null;
}

export interface ManifestOptions {
  verify_checksums: boolean;
}

export interface ManifestSummary {
  total: number;
  imported: number;
  duplicates: number;
  errors: number;
  images: number;
  videos: number;
  documents: number;
  maps: number;
}

export interface ImportManifestData {
  import_id: string;
  version: string;
  created_at: string;
  updated_at: string;
  status: ImportPhase;

  location: ManifestLocation;
  options: ManifestOptions;
  files: ManifestFileEntry[];

  // Phase 2 updates
  location_updates?: {
    address?: {
      street?: string | null;
      city?: string | null;
      county?: string | null;
      state?: string | null;
      zipcode?: string | null;
    } | null;
  };

  // Phase 4 results
  completed_at?: string;
  summary?: ManifestSummary;
}

/**
 * ImportManifest - Manages import state for recovery, audit, and progress tracking
 *
 * Per whereswaldo11.md spec:
 * - Creates manifest file at start of import
 * - Updates manifest at each phase transition
 * - Allows resume from any phase
 * - Provides audit trail
 */
export class ImportManifest {
  private data: ImportManifestData;
  private manifestPath: string | null = null;
  private archivePath: string;

  constructor(archivePath: string) {
    this.archivePath = archivePath;
    this.data = this.createEmptyManifest();
  }

  private createEmptyManifest(): ImportManifestData {
    return {
      import_id: `imp-${this.formatDate()}-${generateId().substring(0, 8)}`,
      version: '1.0',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'phase_1_log',
      location: {
        locid: '',
        locnam: '',
        state: null,
        category: null,
      },
      options: {
        verify_checksums: true,
      },
      files: [],
    };
  }

  private formatDate(): string {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Initialize manifest for a new import session (Phase 1: LOG IT)
   */
  async initializePhase1(
    location: ManifestLocation,
    filePaths: Array<{ filePath: string; originalName: string }>,
    options: Partial<ManifestOptions> = {}
  ): Promise<void> {
    console.log('[Manifest] Phase 1: LOG IT - Initializing manifest');

    this.data.location = location;
    this.data.options = {
      verify_checksums: options.verify_checksums ?? true,
    };

    // Create file entries
    this.data.files = await Promise.all(
      filePaths.map(async (f, index) => {
        let sizeBytes: number | null = null;
        try {
          const stat = await fs.stat(f.filePath);
          sizeBytes = stat.size;
        } catch {
          // File may not exist or be inaccessible
        }

        return {
          index,
          original_path: f.filePath,
          original_name: f.originalName,
          size_bytes: sizeBytes,
          sha256: null,
          type: null,
          is_duplicate: false,
          status: 'pending' as FileStatus,
        };
      })
    );

    this.data.status = 'phase_1_log';
    this.data.updated_at = new Date().toISOString();

    // Save manifest to disk
    await this.save();
    console.log('[Manifest] Phase 1 complete:', this.data.files.length, 'files logged');
  }

  /**
   * Update file entry with serialized metadata (Phase 2: SERIALIZE IT)
   */
  updateFileMetadata(
    index: number,
    updates: {
      sha256?: string;
      type?: FileType;
      is_duplicate?: boolean;
      metadata?: ManifestFileEntry['metadata'];
      gps_warning?: ManifestFileEntry['gps_warning'];
      status?: FileStatus;
      error?: string;
    }
  ): void {
    const file = this.data.files[index];
    if (!file) return;

    if (updates.sha256 !== undefined) file.sha256 = updates.sha256;
    if (updates.type !== undefined) file.type = updates.type;
    if (updates.is_duplicate !== undefined) file.is_duplicate = updates.is_duplicate;
    if (updates.metadata !== undefined) file.metadata = updates.metadata;
    if (updates.gps_warning !== undefined) file.gps_warning = updates.gps_warning;
    if (updates.status !== undefined) file.status = updates.status;
    if (updates.error !== undefined) file.error = updates.error;

    this.data.updated_at = new Date().toISOString();
  }

  /**
   * Transition to Phase 2: SERIALIZE IT
   */
  async transitionToPhase2(): Promise<void> {
    console.log('[Manifest] Transitioning to Phase 2: SERIALIZE IT');
    this.data.status = 'phase_2_serialize';
    this.data.updated_at = new Date().toISOString();
    await this.save();
  }

  /**
   * Update file entry with copy results (Phase 3: COPY & NAME IT)
   */
  updateFileCopy(
    index: number,
    updates: {
      archive_path?: string;
      archive_name?: string;
      verified?: boolean;
      status?: FileStatus;
      error?: string;
    }
  ): void {
    const file = this.data.files[index];
    if (!file) return;

    if (updates.archive_path !== undefined) file.archive_path = updates.archive_path;
    if (updates.archive_name !== undefined) file.archive_name = updates.archive_name;
    if (updates.verified !== undefined) file.verified = updates.verified;
    if (updates.status !== undefined) file.status = updates.status;
    if (updates.error !== undefined) file.error = updates.error;

    this.data.updated_at = new Date().toISOString();
  }

  /**
   * Transition to Phase 3: COPY & NAME IT
   */
  async transitionToPhase3(): Promise<void> {
    console.log('[Manifest] Transitioning to Phase 3: COPY & NAME IT');
    this.data.status = 'phase_3_copy';
    this.data.updated_at = new Date().toISOString();
    await this.save();
  }

  /**
   * Transition to Phase 4: DUMP
   */
  async transitionToPhase4(): Promise<void> {
    console.log('[Manifest] Transitioning to Phase 4: DUMP');
    this.data.status = 'phase_4_dump';
    this.data.updated_at = new Date().toISOString();
    await this.save();
  }

  /**
   * Update file entry with database results (Phase 4: DUMP)
   */
  updateFileDump(
    index: number,
    updates: {
      database_id?: string;
      status?: FileStatus;
    }
  ): void {
    const file = this.data.files[index];
    if (!file) return;

    if (updates.database_id !== undefined) file.database_id = updates.database_id;
    if (updates.status !== undefined) file.status = updates.status;

    this.data.updated_at = new Date().toISOString();
  }

  /**
   * Set location address updates (from reverse geocoding)
   */
  setLocationUpdates(updates: { address?: ManifestLocation['address'] }): void {
    this.data.location_updates = updates;
    this.data.updated_at = new Date().toISOString();
  }

  /**
   * Mark import as complete
   */
  async complete(): Promise<void> {
    console.log('[Manifest] Import complete');

    const files = this.data.files;
    this.data.summary = {
      total: files.length,
      imported: files.filter(f => f.status === 'complete' && !f.is_duplicate).length,
      duplicates: files.filter(f => f.is_duplicate).length,
      errors: files.filter(f => f.status === 'error').length,
      images: files.filter(f => f.type === 'image' && f.status === 'complete' && !f.is_duplicate).length,
      videos: files.filter(f => f.type === 'video' && f.status === 'complete' && !f.is_duplicate).length,
      documents: files.filter(f => f.type === 'document' && f.status === 'complete' && !f.is_duplicate).length,
      maps: files.filter(f => f.type === 'map' && f.status === 'complete' && !f.is_duplicate).length,
    };

    this.data.status = 'complete';
    this.data.completed_at = new Date().toISOString();
    this.data.updated_at = new Date().toISOString();
    await this.save();
  }

  /**
   * Mark import as failed
   */
  async fail(error: string): Promise<void> {
    console.log('[Manifest] Import failed:', error);
    this.data.status = 'failed';
    this.data.updated_at = new Date().toISOString();
    await this.save();
  }

  /**
   * Get current manifest data
   */
  getData(): ImportManifestData {
    return this.data;
  }

  /**
   * Get import ID
   */
  getImportId(): string {
    return this.data.import_id;
  }

  /**
   * Get current phase
   */
  getPhase(): ImportPhase {
    return this.data.status;
  }

  /**
   * Get files by status
   */
  getFilesByStatus(status: FileStatus): ManifestFileEntry[] {
    return this.data.files.filter(f => f.status === status);
  }

  /**
   * Get non-duplicate files
   */
  getNonDuplicateFiles(): ManifestFileEntry[] {
    return this.data.files.filter(f => !f.is_duplicate && f.status !== 'error');
  }

  /**
   * Get summary statistics
   */
  getSummary(): ManifestSummary {
    if (this.data.summary) return this.data.summary;

    const files = this.data.files;
    return {
      total: files.length,
      imported: files.filter(f => f.status === 'complete' && !f.is_duplicate).length,
      duplicates: files.filter(f => f.is_duplicate).length,
      errors: files.filter(f => f.status === 'error').length,
      images: files.filter(f => f.type === 'image' && !f.is_duplicate).length,
      videos: files.filter(f => f.type === 'video' && !f.is_duplicate).length,
      documents: files.filter(f => f.type === 'document' && !f.is_duplicate).length,
      maps: files.filter(f => f.type === 'map' && !f.is_duplicate).length,
    };
  }

  /**
   * Get the manifest file path
   */
  getManifestPath(): string | null {
    return this.manifestPath;
  }

  /**
   * Save manifest to disk
   */
  async save(): Promise<void> {
    if (!this.manifestPath) {
      // Create imports directory if it doesn't exist
      const importsDir = path.join(this.archivePath, 'imports');
      await fs.mkdir(importsDir, { recursive: true });
      this.manifestPath = path.join(importsDir, `${this.data.import_id}.json`);
    }

    const json = JSON.stringify(this.data, null, 2);
    await fs.writeFile(this.manifestPath, json, 'utf-8');
    console.log('[Manifest] Saved to:', this.manifestPath);
  }

  /**
   * Load manifest from disk
   */
  static async load(manifestPath: string, archivePath: string): Promise<ImportManifest> {
    const json = await fs.readFile(manifestPath, 'utf-8');
    const data = JSON.parse(json) as ImportManifestData;

    const manifest = new ImportManifest(archivePath);
    manifest.data = data;
    manifest.manifestPath = manifestPath;

    console.log('[Manifest] Loaded from:', manifestPath, 'Status:', data.status);
    return manifest;
  }

  /**
   * List all manifests in the imports directory
   */
  static async listManifests(archivePath: string): Promise<string[]> {
    const importsDir = path.join(archivePath, 'imports');
    try {
      const files = await fs.readdir(importsDir);
      return files
        .filter(f => f.startsWith('imp-') && f.endsWith('.json'))
        .map(f => path.join(importsDir, f));
    } catch {
      return [];
    }
  }
}
