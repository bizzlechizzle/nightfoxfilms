/**
 * Scenes Repository
 *
 * CRUD operations for detected scenes within video files.
 */

import { getDatabase } from '../main/database';
import type { Scene, SceneWithFile, SceneDetectionMethod } from '@nightfox/core';

export interface SceneCreateInput {
  file_id: number;
  scene_number: number;
  start_time: number;
  end_time: number;
  duration: number;
  start_frame?: number | null;
  end_frame?: number | null;
  detection_method?: SceneDetectionMethod | null;
  confidence?: number | null;
}

export interface SceneUpdateInput {
  best_frame_number?: number | null;
  best_frame_sharpness?: number | null;
  best_frame_path?: string | null;
  scene_type?: string | null;
  thumbnail_path?: string | null;
  caption?: string | null;
  wedding_moment?: string | null;
}

export class ScenesRepository {
  /**
   * Find all scenes for a file
   */
  findByFile(fileId: number): Scene[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM scenes WHERE file_id = ? ORDER BY scene_number')
      .all(fileId) as Scene[];
  }

  /**
   * Find scene by ID
   */
  findById(id: number): Scene | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id) as Scene | undefined;
    return row ?? null;
  }

  /**
   * Find scene with file info
   */
  findWithFile(id: number): SceneWithFile | null {
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT s.*,
                f.blake3 AS file_blake3,
                f.original_filename AS file_original_filename
         FROM scenes s
         JOIN files f ON s.file_id = f.id
         WHERE s.id = ?`
      )
      .get(id) as SceneWithFile | undefined;
    return row ?? null;
  }

  /**
   * Create a new scene
   */
  create(input: SceneCreateInput): Scene {
    const db = getDatabase();
    const result = db
      .prepare(
        `INSERT INTO scenes (
          file_id, scene_number, start_time, end_time, duration,
          start_frame, end_frame, detection_method, confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.file_id,
        input.scene_number,
        input.start_time,
        input.end_time,
        input.duration,
        input.start_frame ?? null,
        input.end_frame ?? null,
        input.detection_method ?? null,
        input.confidence ?? null
      );

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Create multiple scenes (batch insert)
   */
  createMany(scenes: SceneCreateInput[]): Scene[] {
    const db = getDatabase();
    const insert = db.prepare(
      `INSERT INTO scenes (
        file_id, scene_number, start_time, end_time, duration,
        start_frame, end_frame, detection_method, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertMany = db.transaction((items: SceneCreateInput[]) => {
      const ids: number[] = [];
      for (const item of items) {
        const result = insert.run(
          item.file_id,
          item.scene_number,
          item.start_time,
          item.end_time,
          item.duration,
          item.start_frame ?? null,
          item.end_frame ?? null,
          item.detection_method ?? null,
          item.confidence ?? null
        );
        ids.push(result.lastInsertRowid as number);
      }
      return ids;
    });

    const ids = insertMany(scenes);
    return ids.map((id) => this.findById(id)!);
  }

  /**
   * Update a scene
   */
  update(id: number, input: SceneUpdateInput): Scene | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.best_frame_number !== undefined) {
      updates.push('best_frame_number = ?');
      values.push(input.best_frame_number);
    }
    if (input.best_frame_sharpness !== undefined) {
      updates.push('best_frame_sharpness = ?');
      values.push(input.best_frame_sharpness);
    }
    if (input.best_frame_path !== undefined) {
      updates.push('best_frame_path = ?');
      values.push(input.best_frame_path);
    }
    if (input.scene_type !== undefined) {
      updates.push('scene_type = ?');
      values.push(input.scene_type);
    }
    if (input.thumbnail_path !== undefined) {
      updates.push('thumbnail_path = ?');
      values.push(input.thumbnail_path);
    }
    if (input.caption !== undefined) {
      updates.push('caption = ?');
      values.push(input.caption);
    }
    if (input.wedding_moment !== undefined) {
      updates.push('wedding_moment = ?');
      values.push(input.wedding_moment);
    }

    if (updates.length === 0) return existing;

    values.push(id);
    db.prepare(`UPDATE scenes SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.findById(id);
  }

  /**
   * Delete a scene
   */
  delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM scenes WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Delete all scenes for a file
   */
  deleteByFile(fileId: number): number {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM scenes WHERE file_id = ?').run(fileId);
    return result.changes;
  }

  /**
   * Count scenes for a file
   */
  countByFile(fileId: number): number {
    const db = getDatabase();
    const result = db
      .prepare('SELECT COUNT(*) as count FROM scenes WHERE file_id = ?')
      .get(fileId) as { count: number };
    return result.count;
  }

  /**
   * Find scene at a specific time in a file
   */
  findAtTime(fileId: number, time: number): Scene | null {
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM scenes
         WHERE file_id = ? AND start_time <= ? AND end_time >= ?
         LIMIT 1`
      )
      .get(fileId, time, time) as Scene | undefined;
    return row ?? null;
  }

  /**
   * Get scenes by type
   */
  findByType(sceneType: string): SceneWithFile[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT s.*,
                f.blake3 AS file_blake3,
                f.original_filename AS file_original_filename
         FROM scenes s
         JOIN files f ON s.file_id = f.id
         WHERE s.scene_type = ?
         ORDER BY f.original_filename, s.scene_number`
      )
      .all(sceneType) as SceneWithFile[];
  }

  /**
   * Get scenes with best frame info (for export/selection)
   */
  findWithBestFrames(fileId: number): Scene[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT * FROM scenes
         WHERE file_id = ? AND best_frame_path IS NOT NULL
         ORDER BY scene_number`
      )
      .all(fileId) as Scene[];
  }
}

export const scenesRepository = new ScenesRepository();
