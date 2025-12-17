/**
 * Screenshots Repository
 *
 * CRUD operations for extracted video screenshots.
 */

import { getDatabase } from '../main/database';
import type { Screenshot, ScreenshotInput } from '@nightfox/core';

export type FrameCategory = 'people_face' | 'people_roll' | 'broll' | 'detail';

export interface ScreenshotFilters {
  file_id?: number;
  couple_id?: number;
  is_selected?: boolean;
  is_broll?: boolean;
  is_audio_peak?: boolean;
  frame_category?: FrameCategory;
  min_face_count?: number;
  min_smile_score?: number;
  scene_index?: number;
  limit?: number;
  offset?: number;
}

export class ScreenshotsRepository {
  /**
   * Create a new screenshot record
   */
  create(input: ScreenshotInput): Screenshot {
    const db = getDatabase();
    const result = db
      .prepare(
        `INSERT INTO screenshots (
          file_id, couple_id, frame_number, timestamp_seconds, scene_index,
          preview_path, raw_path, sharpness_score, face_count, max_smile_score,
          is_broll, is_audio_peak, audio_type, frame_category, faces_json, crops_json, tags_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.file_id,
        input.couple_id ?? null,
        input.frame_number,
        input.timestamp_seconds,
        input.scene_index ?? 0,
        input.preview_path,
        input.raw_path ?? null,
        input.sharpness_score ?? 0,
        input.face_count ?? 0,
        input.max_smile_score ?? 0,
        input.is_broll ?? 0,
        input.is_audio_peak ?? 0,
        input.audio_type ?? null,
        input.frame_category ?? 'broll',
        input.faces_json ?? null,
        input.crops_json ?? null,
        input.tags_json ?? null
      );

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Create multiple screenshots in a transaction
   */
  createMany(inputs: ScreenshotInput[]): Screenshot[] {
    const db = getDatabase();
    const results: Screenshot[] = [];

    const insertStmt = db.prepare(
      `INSERT INTO screenshots (
        file_id, couple_id, frame_number, timestamp_seconds, scene_index,
        preview_path, raw_path, sharpness_score, face_count, max_smile_score,
        is_broll, is_audio_peak, audio_type, frame_category, faces_json, crops_json, tags_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const transaction = db.transaction(() => {
      for (const input of inputs) {
        const result = insertStmt.run(
          input.file_id,
          input.couple_id ?? null,
          input.frame_number,
          input.timestamp_seconds,
          input.scene_index ?? 0,
          input.preview_path,
          input.raw_path ?? null,
          input.sharpness_score ?? 0,
          input.face_count ?? 0,
          input.max_smile_score ?? 0,
          input.is_broll ?? 0,
          input.is_audio_peak ?? 0,
          input.audio_type ?? null,
          input.frame_category ?? 'broll',
          input.faces_json ?? null,
          input.crops_json ?? null,
          input.tags_json ?? null
        );
        const screenshot = this.findById(result.lastInsertRowid as number);
        if (screenshot) results.push(screenshot);
      }
    });

    transaction();
    return results;
  }

  /**
   * Find screenshot by ID
   */
  findById(id: number): Screenshot | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM screenshots WHERE id = ?').get(id) as Screenshot | undefined;
    return row ?? null;
  }

  /**
   * Find all screenshots for a file
   */
  findByFile(fileId: number): Screenshot[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM screenshots WHERE file_id = ? ORDER BY timestamp_seconds ASC')
      .all(fileId) as Screenshot[];
  }

  /**
   * Find all screenshots for a couple
   */
  findByCouple(coupleId: number): Screenshot[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT s.* FROM screenshots s
         JOIN files f ON s.file_id = f.id
         WHERE s.couple_id = ? OR f.couple_id = ?
         ORDER BY f.recorded_at DESC, s.timestamp_seconds ASC`
      )
      .all(coupleId, coupleId) as Screenshot[];
  }

  /**
   * Find screenshots with filters
   */
  findAll(filters?: ScreenshotFilters): Screenshot[] {
    const db = getDatabase();
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters?.file_id !== undefined) {
      conditions.push('file_id = ?');
      values.push(filters.file_id);
    }
    if (filters?.couple_id !== undefined) {
      conditions.push('couple_id = ?');
      values.push(filters.couple_id);
    }
    if (filters?.is_selected !== undefined) {
      conditions.push('is_selected = ?');
      values.push(filters.is_selected ? 1 : 0);
    }
    if (filters?.is_broll !== undefined) {
      conditions.push('is_broll = ?');
      values.push(filters.is_broll ? 1 : 0);
    }
    if (filters?.is_audio_peak !== undefined) {
      conditions.push('is_audio_peak = ?');
      values.push(filters.is_audio_peak ? 1 : 0);
    }
    if (filters?.frame_category !== undefined) {
      conditions.push('frame_category = ?');
      values.push(filters.frame_category);
    }
    if (filters?.min_face_count !== undefined) {
      conditions.push('face_count >= ?');
      values.push(filters.min_face_count);
    }
    if (filters?.min_smile_score !== undefined) {
      conditions.push('max_smile_score >= ?');
      values.push(filters.min_smile_score);
    }
    if (filters?.scene_index !== undefined) {
      conditions.push('scene_index = ?');
      values.push(filters.scene_index);
    }

    let sql = `SELECT * FROM screenshots`;
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ` ORDER BY timestamp_seconds ASC`;

    if (filters?.limit) {
      sql += ` LIMIT ${filters.limit}`;
      if (filters?.offset) {
        sql += ` OFFSET ${filters.offset}`;
      }
    }

    return db.prepare(sql).all(...values) as Screenshot[];
  }

  /**
   * Find the best screenshot for a file (highest smile score with faces)
   */
  findBestForFile(fileId: number): Screenshot | null {
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM screenshots
         WHERE file_id = ? AND face_count > 0
         ORDER BY max_smile_score DESC, face_count DESC, sharpness_score DESC
         LIMIT 1`
      )
      .get(fileId) as Screenshot | undefined;

    // If no faces, get sharpest frame
    if (!row) {
      const fallback = db
        .prepare(
          `SELECT * FROM screenshots
           WHERE file_id = ?
           ORDER BY sharpness_score DESC
           LIMIT 1`
        )
        .get(fileId) as Screenshot | undefined;
      return fallback ?? null;
    }

    return row;
  }

  /**
   * Find selected screenshots for a couple (user favorites)
   */
  findSelected(coupleId: number): Screenshot[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT s.* FROM screenshots s
         JOIN files f ON s.file_id = f.id
         WHERE (s.couple_id = ? OR f.couple_id = ?) AND s.is_selected = 1
         ORDER BY f.recorded_at DESC, s.timestamp_seconds ASC`
      )
      .all(coupleId, coupleId) as Screenshot[];
  }

  /**
   * Get the current thumbnail screenshot for a file
   */
  findThumbnail(fileId: number): Screenshot | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM screenshots WHERE file_id = ? AND is_thumbnail = 1 LIMIT 1')
      .get(fileId) as Screenshot | undefined;
    return row ?? null;
  }

  /**
   * Toggle selected status for a screenshot
   */
  setSelected(id: number, selected: boolean): boolean {
    const db = getDatabase();
    const result = db
      .prepare('UPDATE screenshots SET is_selected = ? WHERE id = ?')
      .run(selected ? 1 : 0, id);
    return result.changes > 0;
  }

  /**
   * Set rating for a screenshot (0-5 scale, 0 = unrated)
   */
  setRating(id: number, rating: number): boolean {
    const db = getDatabase();
    const clampedRating = Math.max(0, Math.min(5, Math.floor(rating)));
    const result = db
      .prepare('UPDATE screenshots SET rating = ? WHERE id = ?')
      .run(clampedRating, id);
    return result.changes > 0;
  }

  /**
   * Set a screenshot as the thumbnail for its file (clears previous)
   */
  setAsThumbnail(fileId: number, screenshotId: number): boolean {
    const db = getDatabase();

    const transaction = db.transaction(() => {
      // Clear existing thumbnail flag for this file
      db.prepare('UPDATE screenshots SET is_thumbnail = 0 WHERE file_id = ?').run(fileId);
      // Set new thumbnail
      db.prepare('UPDATE screenshots SET is_thumbnail = 1 WHERE id = ? AND file_id = ?').run(
        screenshotId,
        fileId
      );
    });

    transaction();

    // Update the file's thumbnail_path
    const screenshot = this.findById(screenshotId);
    if (screenshot) {
      db.prepare('UPDATE files SET thumbnail_path = ? WHERE id = ?').run(
        screenshot.preview_path,
        fileId
      );
      return true;
    }
    return false;
  }

  /**
   * Auto-set the best screenshot as thumbnail for a file
   */
  autoSetThumbnail(fileId: number): Screenshot | null {
    const best = this.findBestForFile(fileId);
    if (best) {
      this.setAsThumbnail(fileId, best.id);
      return best;
    }
    return null;
  }

  /**
   * Update AI caption and hashtags for a screenshot
   */
  updateAIContent(
    id: number,
    caption: string | null,
    hashtags: string | null,
    momentType: string | null
  ): boolean {
    const db = getDatabase();
    const result = db
      .prepare(
        'UPDATE screenshots SET ai_caption = ?, ai_hashtags = ?, ai_moment_type = ? WHERE id = ?'
      )
      .run(caption, hashtags, momentType, id);
    return result.changes > 0;
  }

  /**
   * Update tags for a screenshot
   */
  updateTags(id: number, tags: string[]): boolean {
    const db = getDatabase();
    const result = db
      .prepare('UPDATE screenshots SET tags_json = ? WHERE id = ?')
      .run(JSON.stringify(tags), id);
    return result.changes > 0;
  }

  /**
   * Delete a screenshot by ID
   */
  delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM screenshots WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Delete all screenshots for a file
   */
  deleteByFile(fileId: number): number {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM screenshots WHERE file_id = ?').run(fileId);
    return result.changes;
  }

  /**
   * Delete all screenshots for a couple
   */
  deleteByCouple(coupleId: number): number {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM screenshots WHERE couple_id = ?').run(coupleId);
    return result.changes;
  }

  /**
   * Count screenshots by filter
   */
  count(filters?: Omit<ScreenshotFilters, 'limit' | 'offset'>): number {
    const db = getDatabase();
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters?.file_id !== undefined) {
      conditions.push('file_id = ?');
      values.push(filters.file_id);
    }
    if (filters?.couple_id !== undefined) {
      conditions.push('couple_id = ?');
      values.push(filters.couple_id);
    }
    if (filters?.is_selected !== undefined) {
      conditions.push('is_selected = ?');
      values.push(filters.is_selected ? 1 : 0);
    }
    if (filters?.is_broll !== undefined) {
      conditions.push('is_broll = ?');
      values.push(filters.is_broll ? 1 : 0);
    }
    if (filters?.min_face_count !== undefined) {
      conditions.push('face_count >= ?');
      values.push(filters.min_face_count);
    }

    let sql = `SELECT COUNT(*) as count FROM screenshots`;
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    const result = db.prepare(sql).get(...values) as { count: number };
    return result.count;
  }

  /**
   * Get screenshot stats for a couple
   */
  getStats(coupleId: number): {
    total: number;
    selected: number;
    withFaces: number;
    broll: number;
    audioPeaks: number;
    byScene: Record<number, number>;
    byCategory: Record<FrameCategory, number>;
  } {
    const db = getDatabase();

    const total = this.count({ couple_id: coupleId });
    const selected = this.count({ couple_id: coupleId, is_selected: true });
    const withFaces = this.count({ couple_id: coupleId, min_face_count: 1 });
    const broll = this.count({ couple_id: coupleId, is_broll: true });
    const audioPeaks = this.count({ couple_id: coupleId, is_audio_peak: true });

    // Count by scene
    const sceneResults = db
      .prepare(
        `SELECT scene_index, COUNT(*) as count FROM screenshots
         WHERE couple_id = ?
         GROUP BY scene_index
         ORDER BY scene_index`
      )
      .all(coupleId) as Array<{ scene_index: number; count: number }>;

    const byScene: Record<number, number> = {};
    for (const row of sceneResults) {
      byScene[row.scene_index] = row.count;
    }

    // Count by category
    const categoryResults = db
      .prepare(
        `SELECT frame_category, COUNT(*) as count FROM screenshots
         WHERE couple_id = ?
         GROUP BY frame_category`
      )
      .all(coupleId) as Array<{ frame_category: FrameCategory; count: number }>;

    const byCategory: Record<FrameCategory, number> = {
      people_face: 0,
      people_roll: 0,
      broll: 0,
      detail: 0,
    };
    for (const row of categoryResults) {
      if (row.frame_category) {
        byCategory[row.frame_category] = row.count;
      }
    }

    return { total, selected, withFaces, broll, audioPeaks, byScene, byCategory };
  }
}

export const screenshotsRepository = new ScreenshotsRepository();
