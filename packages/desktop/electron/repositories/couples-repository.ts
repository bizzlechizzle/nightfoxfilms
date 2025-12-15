/**
 * Couples Repository
 *
 * CRUD operations for wedding couples/projects.
 */

import { getDatabase } from '../main/database';
import type { Couple, CoupleInput, CoupleWithFiles, File } from '@nightfox/core';
import path from 'path';

export class CouplesRepository {
  /**
   * Find all couples
   */
  findAll(): Couple[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM couples ORDER BY wedding_date DESC, name').all() as Couple[];
  }

  /**
   * Find couple by ID
   */
  findById(id: number): Couple | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM couples WHERE id = ?').get(id) as Couple | undefined;
    return row ?? null;
  }

  /**
   * Find couple with files
   */
  findWithFiles(id: number): CoupleWithFiles | null {
    const couple = this.findById(id);
    if (!couple) return null;

    const db = getDatabase();
    const files = db
      .prepare('SELECT * FROM files WHERE couple_id = ? AND is_hidden = 0 ORDER BY recorded_at DESC')
      .all(id) as File[];

    return { ...couple, files };
  }

  /**
   * Create a new couple
   */
  create(input: CoupleInput): Couple {
    const db = getDatabase();

    // Generate folder name
    const folderName = this.generateFolderName(input.name, input.wedding_date ?? null);

    const result = db
      .prepare(
        `INSERT INTO couples (name, wedding_date, folder_name, notes)
         VALUES (?, ?, ?, ?)`
      )
      .run(input.name, input.wedding_date ?? null, folderName, input.notes ?? null);

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Update a couple
   */
  update(id: number, input: Partial<CoupleInput>): Couple | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      values.push(input.name);

      // Regenerate folder name if name changes
      const folderName = this.generateFolderName(
        input.name,
        input.wedding_date ?? existing.wedding_date
      );
      updates.push('folder_name = ?');
      values.push(folderName);
    }
    if (input.wedding_date !== undefined) {
      updates.push('wedding_date = ?');
      values.push(input.wedding_date);

      // Regenerate folder name if date changes
      if (input.name === undefined) {
        const folderName = this.generateFolderName(existing.name, input.wedding_date);
        updates.push('folder_name = ?');
        values.push(folderName);
      }
    }
    if (input.notes !== undefined) {
      updates.push('notes = ?');
      values.push(input.notes);
    }

    if (updates.length === 0) return existing;

    values.push(id);
    db.prepare(`UPDATE couples SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.findById(id);
  }

  /**
   * Delete a couple
   */
  delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM couples WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Find couples by wedding date range
   */
  findByDateRange(startDate: string, endDate: string): Couple[] {
    const db = getDatabase();
    return db
      .prepare(
        'SELECT * FROM couples WHERE wedding_date >= ? AND wedding_date <= ? ORDER BY wedding_date'
      )
      .all(startDate, endDate) as Couple[];
  }

  /**
   * Find couples by name search
   */
  search(query: string): Couple[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM couples WHERE name LIKE ? ORDER BY wedding_date DESC, name')
      .all(`%${query}%`) as Couple[];
  }

  /**
   * Get couple statistics
   */
  getStats(id: number): { fileCount: number; totalDuration: number } | null {
    const couple = this.findById(id);
    if (!couple) return null;

    return {
      fileCount: couple.file_count,
      totalDuration: couple.total_duration_seconds,
    };
  }

  /**
   * Update couple export timestamp
   */
  updateExportTimestamp(id: number, exportPath: string): void {
    const db = getDatabase();
    db.prepare(
      'UPDATE couples SET last_export_at = CURRENT_TIMESTAMP, export_path = ? WHERE id = ?'
    ).run(exportPath, id);
  }

  /**
   * Generate folder name from couple name and date
   * Format: "2024-06-15-smith-jones"
   */
  private generateFolderName(name: string, weddingDate: string | null): string {
    // Sanitize name: lowercase, replace spaces/special chars with hyphens
    const sanitizedName = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    if (weddingDate) {
      return `${weddingDate}-${sanitizedName}`;
    }

    return sanitizedName;
  }

  /**
   * Export couple data to JSON
   */
  exportToJson(id: number): object | null {
    const couple = this.findWithFiles(id);
    if (!couple) return null;

    const db = getDatabase();

    // Get all scenes for this couple's files
    const fileIds = couple.files.map((f) => f.id);
    let scenes: any[] = [];
    if (fileIds.length > 0) {
      const placeholders = fileIds.map(() => '?').join(',');
      scenes = db
        .prepare(`SELECT * FROM scenes WHERE file_id IN (${placeholders}) ORDER BY file_id, scene_number`)
        .all(...fileIds);
    }

    // Get all exports for this couple
    const exports = db
      .prepare('SELECT * FROM exports WHERE couple_id = ? ORDER BY created_at DESC')
      .all(id);

    return {
      couple: {
        id: couple.id,
        name: couple.name,
        wedding_date: couple.wedding_date,
        notes: couple.notes,
        file_count: couple.file_count,
        total_duration_seconds: couple.total_duration_seconds,
        created_at: couple.created_at,
        updated_at: couple.updated_at,
      },
      files: couple.files.map((f) => ({
        blake3: f.blake3,
        original_filename: f.original_filename,
        extension: f.extension,
        file_size: f.file_size,
        medium: f.medium,
        file_type: f.file_type,
        duration_seconds: f.duration_seconds,
        width: f.width,
        height: f.height,
        frame_rate: f.frame_rate,
        codec: f.codec,
        recorded_at: f.recorded_at,
        camera_id: f.camera_id,
        detected_make: f.detected_make,
        detected_model: f.detected_model,
      })),
      scenes,
      exports,
      exported_at: new Date().toISOString(),
    };
  }
}

export const couplesRepository = new CouplesRepository();
