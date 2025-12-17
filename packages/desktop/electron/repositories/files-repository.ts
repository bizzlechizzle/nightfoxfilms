/**
 * Files Repository
 *
 * CRUD operations for imported video files.
 */

import { getDatabase } from '../main/database';
import type {
  File,
  FileWithCamera,
  FileMetadata,
  FileSidecar,
  FileType,
  FootageType,
  Medium,
} from '@nightfox/core';

export interface FileCreateInput {
  blake3: string;
  original_filename: string;
  original_path?: string | null;
  managed_path?: string | null;
  extension: string;
  file_size?: number | null;
  couple_id?: number | null;
  camera_id?: number | null;
  detected_make?: string | null;
  detected_model?: string | null;
  medium?: Medium | null;
  file_type?: FileType | null;
  footage_type?: FootageType | null;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
  frame_rate?: number | null;
  codec?: string | null;
  bitrate?: number | null;
  recorded_at?: string | null;
  thumbnail_path?: string | null;
  proxy_path?: string | null;
}

export interface FileFilters {
  couple_id?: number;
  camera_id?: number;
  medium?: Medium;
  file_type?: FileType;
  is_processed?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export class FilesRepository {
  /**
   * Find all files (with optional filters)
   */
  findAll(filters?: FileFilters): File[] {
    const db = getDatabase();
    const conditions: string[] = ['is_hidden = 0'];
    const values: unknown[] = [];

    if (filters?.couple_id !== undefined) {
      conditions.push('couple_id = ?');
      values.push(filters.couple_id);
    }
    if (filters?.camera_id !== undefined) {
      conditions.push('camera_id = ?');
      values.push(filters.camera_id);
    }
    if (filters?.medium !== undefined) {
      conditions.push('medium = ?');
      values.push(filters.medium);
    }
    if (filters?.file_type !== undefined) {
      conditions.push('file_type = ?');
      values.push(filters.file_type);
    }
    if (filters?.is_processed !== undefined) {
      conditions.push('is_processed = ?');
      values.push(filters.is_processed ? 1 : 0);
    }
    if (filters?.search) {
      conditions.push('original_filename LIKE ?');
      values.push(`%${filters.search}%`);
    }

    let sql = `SELECT * FROM files WHERE ${conditions.join(' AND ')} ORDER BY recorded_at DESC, imported_at DESC`;

    if (filters?.limit) {
      sql += ` LIMIT ${filters.limit}`;
      if (filters?.offset) {
        sql += ` OFFSET ${filters.offset}`;
      }
    }

    return db.prepare(sql).all(...values) as File[];
  }

  /**
   * Find all files with camera info
   */
  findAllWithCamera(filters?: FileFilters): FileWithCamera[] {
    const db = getDatabase();
    const conditions: string[] = ['f.is_hidden = 0'];
    const values: unknown[] = [];

    if (filters?.couple_id !== undefined) {
      conditions.push('f.couple_id = ?');
      values.push(filters.couple_id);
    }
    if (filters?.camera_id !== undefined) {
      conditions.push('f.camera_id = ?');
      values.push(filters.camera_id);
    }
    if (filters?.medium !== undefined) {
      conditions.push('f.medium = ?');
      values.push(filters.medium);
    }
    if (filters?.file_type !== undefined) {
      conditions.push('f.file_type = ?');
      values.push(filters.file_type);
    }
    if (filters?.is_processed !== undefined) {
      conditions.push('f.is_processed = ?');
      values.push(filters.is_processed ? 1 : 0);
    }
    if (filters?.search) {
      conditions.push('f.original_filename LIKE ?');
      values.push(`%${filters.search}%`);
    }

    let sql = `
      SELECT f.*,
             c.name AS camera_name,
             c.medium AS camera_medium,
             c.lut_path AS camera_lut_path,
             cp.name AS couple_name,
             cp.wedding_date AS couple_wedding_date
      FROM files f
      LEFT JOIN cameras c ON f.camera_id = c.id
      LEFT JOIN couples cp ON f.couple_id = cp.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY f.recorded_at DESC, f.imported_at DESC
    `;

    if (filters?.limit) {
      sql += ` LIMIT ${filters.limit}`;
      if (filters?.offset) {
        sql += ` OFFSET ${filters.offset}`;
      }
    }

    return db.prepare(sql).all(...values) as FileWithCamera[];
  }

  /**
   * Find file by ID
   */
  findById(id: number): File | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id) as File | undefined;
    return row ?? null;
  }

  /**
   * Find file by BLAKE3 hash
   */
  findByHash(blake3: string): File | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM files WHERE blake3 = ?').get(blake3) as File | undefined;
    return row ?? null;
  }

  /**
   * Find file by path (original_path or managed_path)
   */
  findByPath(filePath: string): File | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM files WHERE original_path = ? OR managed_path = ? LIMIT 1')
      .get(filePath, filePath) as File | undefined;
    return row ?? null;
  }

  /**
   * Find file with camera info by path
   */
  findByPathWithCamera(filePath: string): FileWithCamera | null {
    const db = getDatabase();
    const row = db
      .prepare(`
        SELECT f.*,
               c.name AS camera_name,
               c.medium AS camera_medium,
               c.lut_path AS camera_lut_path,
               cp.name AS couple_name,
               cp.wedding_date AS couple_wedding_date
        FROM files f
        LEFT JOIN cameras c ON f.camera_id = c.id
        LEFT JOIN couples cp ON f.couple_id = cp.id
        WHERE f.original_path = ? OR f.managed_path = ?
        LIMIT 1
      `)
      .get(filePath, filePath) as FileWithCamera | undefined;
    return row ?? null;
  }

  /**
   * Find files by couple
   */
  findByCouple(coupleId: number): File[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM files WHERE couple_id = ? AND is_hidden = 0 ORDER BY recorded_at DESC')
      .all(coupleId) as File[];
  }

  /**
   * Create a new file
   */
  create(input: FileCreateInput): File {
    const db = getDatabase();
    const result = db
      .prepare(
        `INSERT INTO files (
          blake3, original_filename, original_path, managed_path, extension, file_size,
          couple_id, camera_id, detected_make, detected_model, medium, file_type,
          footage_type, duration_seconds, width, height, frame_rate, codec, bitrate, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.blake3,
        input.original_filename,
        input.original_path ?? null,
        input.managed_path ?? null,
        input.extension,
        input.file_size ?? null,
        input.couple_id ?? null,
        input.camera_id ?? null,
        input.detected_make ?? null,
        input.detected_model ?? null,
        input.medium ?? null,
        input.file_type ?? null,
        input.footage_type ?? 'other',
        input.duration_seconds ?? null,
        input.width ?? null,
        input.height ?? null,
        input.frame_rate ?? null,
        input.codec ?? null,
        input.bitrate ?? null,
        input.recorded_at ?? null
      );

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Upsert a file (insert or update by blake3)
   */
  upsert(input: FileCreateInput): File {
    const existing = this.findByHash(input.blake3);
    if (existing) {
      return this.update(existing.id, input) ?? existing;
    }
    return this.create(input);
  }

  /**
   * Update a file
   */
  update(id: number, input: Partial<FileCreateInput>): File | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    const updates: string[] = [];
    const values: unknown[] = [];

    const fields: (keyof FileCreateInput)[] = [
      'original_filename',
      'original_path',
      'managed_path',
      'extension',
      'file_size',
      'couple_id',
      'camera_id',
      'detected_make',
      'detected_model',
      'medium',
      'file_type',
      'footage_type',
      'duration_seconds',
      'width',
      'height',
      'frame_rate',
      'codec',
      'bitrate',
      'recorded_at',
    ];

    for (const field of fields) {
      if (input[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(input[field]);
      }
    }

    if (updates.length === 0) return existing;

    values.push(id);
    db.prepare(`UPDATE files SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.findById(id);
  }

  /**
   * Update camera assignment for a file
   */
  updateCamera(id: number, cameraId: number | null): boolean {
    const db = getDatabase();
    const result = db.prepare('UPDATE files SET camera_id = ? WHERE id = ?').run(cameraId, id);
    return result.changes > 0;
  }

  /**
   * Mark file as processed
   */
  markProcessed(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('UPDATE files SET is_processed = 1 WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Mark file as hidden
   */
  setHidden(id: number, hidden: boolean): boolean {
    const db = getDatabase();
    const result = db.prepare('UPDATE files SET is_hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id);
    return result.changes > 0;
  }

  /**
   * Update thumbnail path for a file
   */
  updateThumbnailPath(id: number, thumbnailPath: string | null): boolean {
    const db = getDatabase();
    const result = db.prepare('UPDATE files SET thumbnail_path = ? WHERE id = ?').run(thumbnailPath, id);
    return result.changes > 0;
  }

  /**
   * Update proxy path for a file
   */
  updateProxyPath(id: number, proxyPath: string | null): boolean {
    const db = getDatabase();
    const result = db.prepare('UPDATE files SET proxy_path = ? WHERE id = ?').run(proxyPath, id);
    return result.changes > 0;
  }

  /**
   * Delete a file
   */
  delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM files WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Count files by filter
   */
  count(filters?: Omit<FileFilters, 'limit' | 'offset'>): number {
    const db = getDatabase();
    const conditions: string[] = ['is_hidden = 0'];
    const values: unknown[] = [];

    if (filters?.couple_id !== undefined) {
      conditions.push('couple_id = ?');
      values.push(filters.couple_id);
    }
    if (filters?.camera_id !== undefined) {
      conditions.push('camera_id = ?');
      values.push(filters.camera_id);
    }
    if (filters?.medium !== undefined) {
      conditions.push('medium = ?');
      values.push(filters.medium);
    }
    if (filters?.file_type !== undefined) {
      conditions.push('file_type = ?');
      values.push(filters.file_type);
    }
    if (filters?.is_processed !== undefined) {
      conditions.push('is_processed = ?');
      values.push(filters.is_processed ? 1 : 0);
    }

    const sql = `SELECT COUNT(*) as count FROM files WHERE ${conditions.join(' AND ')}`;
    const result = db.prepare(sql).get(...values) as { count: number };
    return result.count;
  }

  /**
   * Get unmatched files (no camera assigned but has detected make/model)
   */
  findUnmatched(): File[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT * FROM files
         WHERE camera_id IS NULL
         AND (detected_make IS NOT NULL OR detected_model IS NOT NULL)
         AND is_hidden = 0
         ORDER BY detected_make, detected_model`
      )
      .all() as File[];
  }

  // ===== METADATA =====

  /**
   * Get file metadata
   */
  getMetadata(fileId: number): FileMetadata | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM file_metadata WHERE file_id = ?')
      .get(fileId) as FileMetadata | undefined;
    return row ?? null;
  }

  /**
   * Save file metadata
   */
  saveMetadata(fileId: number, exiftoolJson: string | null, ffprobeJson: string | null): void {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO file_metadata (file_id, exiftool_json, ffprobe_json)
       VALUES (?, ?, ?)
       ON CONFLICT(file_id) DO UPDATE SET
         exiftool_json = excluded.exiftool_json,
         ffprobe_json = excluded.ffprobe_json,
         extracted_at = CURRENT_TIMESTAMP`
    ).run(fileId, exiftoolJson, ffprobeJson);
  }

  // ===== SIDECARS =====

  /**
   * Link a sidecar file to a video file
   */
  linkSidecar(videoFileId: number, sidecarFileId: number, sidecarType?: string): void {
    const db = getDatabase();
    db.prepare(
      `INSERT OR IGNORE INTO file_sidecars (video_file_id, sidecar_file_id, sidecar_type)
       VALUES (?, ?, ?)`
    ).run(videoFileId, sidecarFileId, sidecarType ?? null);
  }

  /**
   * Get sidecars for a video file
   */
  getSidecars(videoFileId: number): File[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT f.* FROM files f
         JOIN file_sidecars fs ON f.id = fs.sidecar_file_id
         WHERE fs.video_file_id = ?`
      )
      .all(videoFileId) as File[];
  }

  /**
   * Get video file for a sidecar
   */
  getVideoForSidecar(sidecarFileId: number): File | null {
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT f.* FROM files f
         JOIN file_sidecars fs ON f.id = fs.video_file_id
         WHERE fs.sidecar_file_id = ?`
      )
      .get(sidecarFileId) as File | undefined;
    return row ?? null;
  }
}

export const filesRepository = new FilesRepository();
