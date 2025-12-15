/**
 * Camera Patterns Repository
 *
 * CRUD operations for camera file matching patterns.
 */

import { getDatabase } from '../main/database';
import type { CameraPattern, CameraPatternInput } from '@nightfox/core';

export class CameraPatternsRepository {
  /**
   * Find all patterns for a camera
   */
  findByCamera(cameraId: number): CameraPattern[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM camera_patterns WHERE camera_id = ? ORDER BY priority DESC')
      .all(cameraId) as CameraPattern[];
  }

  /**
   * Find pattern by ID
   */
  findById(id: number): CameraPattern | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM camera_patterns WHERE id = ?')
      .get(id) as CameraPattern | undefined;
    return row ?? null;
  }

  /**
   * Create a new pattern
   */
  create(input: CameraPatternInput): CameraPattern {
    const db = getDatabase();
    const result = db
      .prepare(
        `INSERT INTO camera_patterns (camera_id, pattern_type, pattern, priority)
         VALUES (?, ?, ?, ?)`
      )
      .run(input.camera_id, input.pattern_type, input.pattern, input.priority ?? 0);

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Delete a pattern
   */
  delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM camera_patterns WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Delete all patterns for a camera
   */
  deleteByCamera(cameraId: number): number {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM camera_patterns WHERE camera_id = ?').run(cameraId);
    return result.changes;
  }

  /**
   * Find all patterns ordered by priority (for matching)
   */
  findAllOrderedByPriority(): CameraPattern[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM camera_patterns ORDER BY priority DESC, id')
      .all() as CameraPattern[];
  }

  /**
   * Find patterns by type
   */
  findByType(patternType: CameraPattern['pattern_type']): CameraPattern[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM camera_patterns WHERE pattern_type = ? ORDER BY priority DESC')
      .all(patternType) as CameraPattern[];
  }
}

export const cameraPatternsRepository = new CameraPatternsRepository();
