/**
 * Cameras Repository
 *
 * CRUD operations for camera profiles.
 */

import { getDatabase } from '../main/database';
import type { Camera, CameraInput, CameraPattern, CameraWithPatterns } from '@nightfox/core';

export class CamerasRepository {
  /**
   * Find all cameras
   */
  findAll(): Camera[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM cameras ORDER BY name').all() as Camera[];
  }

  /**
   * Find camera by ID
   */
  findById(id: number): Camera | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM cameras WHERE id = ?').get(id) as Camera | undefined;
    return row ?? null;
  }

  /**
   * Find camera with patterns
   */
  findWithPatterns(id: number): CameraWithPatterns | null {
    const camera = this.findById(id);
    if (!camera) return null;

    const db = getDatabase();
    const patterns = db
      .prepare('SELECT * FROM camera_patterns WHERE camera_id = ? ORDER BY priority DESC')
      .all(id) as CameraPattern[];

    return { ...camera, patterns };
  }

  /**
   * Find all cameras with their patterns
   */
  findAllWithPatterns(): CameraWithPatterns[] {
    const cameras = this.findAll();
    const db = getDatabase();

    return cameras.map((camera) => {
      const patterns = db
        .prepare('SELECT * FROM camera_patterns WHERE camera_id = ? ORDER BY priority DESC')
        .all(camera.id) as CameraPattern[];
      return { ...camera, patterns };
    });
  }

  /**
   * Create a new camera
   */
  create(input: CameraInput): Camera {
    const db = getDatabase();
    const result = db
      .prepare(
        `INSERT INTO cameras (name, nickname, medium, make, model, serial_number, color_profile, filename_pattern, color, is_active, is_default, notes, lut_path, deinterlace, audio_channels, sharpness_baseline, transcode_preset)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name,
        input.nickname ?? null,
        input.medium,
        input.make ?? null,
        input.model ?? null,
        input.serial_number ?? null,
        input.color_profile ?? null,
        input.filename_pattern ?? null,
        input.color ?? null,
        input.is_active !== false ? 1 : 0,
        input.is_default ? 1 : 0,
        input.notes ?? null,
        input.lut_path ?? null,
        input.deinterlace ? 1 : 0,
        input.audio_channels ?? 'stereo',
        input.sharpness_baseline ?? null,
        input.transcode_preset ?? null
      );

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Update a camera
   */
  update(id: number, input: Partial<CameraInput>): Camera | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      values.push(input.name);
    }
    if (input.nickname !== undefined) {
      updates.push('nickname = ?');
      values.push(input.nickname);
    }
    if (input.medium !== undefined) {
      updates.push('medium = ?');
      values.push(input.medium);
    }
    if (input.make !== undefined) {
      updates.push('make = ?');
      values.push(input.make);
    }
    if (input.model !== undefined) {
      updates.push('model = ?');
      values.push(input.model);
    }
    if (input.serial_number !== undefined) {
      updates.push('serial_number = ?');
      values.push(input.serial_number);
    }
    if (input.color_profile !== undefined) {
      updates.push('color_profile = ?');
      values.push(input.color_profile);
    }
    if (input.filename_pattern !== undefined) {
      updates.push('filename_pattern = ?');
      values.push(input.filename_pattern);
    }
    if (input.color !== undefined) {
      updates.push('color = ?');
      values.push(input.color);
    }
    if (input.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(input.is_active ? 1 : 0);
    }
    if (input.is_default !== undefined) {
      updates.push('is_default = ?');
      values.push(input.is_default ? 1 : 0);
    }
    if (input.notes !== undefined) {
      updates.push('notes = ?');
      values.push(input.notes);
    }
    if (input.lut_path !== undefined) {
      updates.push('lut_path = ?');
      values.push(input.lut_path);
    }
    if (input.deinterlace !== undefined) {
      updates.push('deinterlace = ?');
      values.push(input.deinterlace ? 1 : 0);
    }
    if (input.audio_channels !== undefined) {
      updates.push('audio_channels = ?');
      values.push(input.audio_channels);
    }
    if (input.sharpness_baseline !== undefined) {
      updates.push('sharpness_baseline = ?');
      values.push(input.sharpness_baseline);
    }
    if (input.transcode_preset !== undefined) {
      updates.push('transcode_preset = ?');
      values.push(input.transcode_preset);
    }

    if (updates.length === 0) return existing;

    values.push(id);
    db.prepare(`UPDATE cameras SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.findById(id);
  }

  /**
   * Delete a camera
   */
  delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM cameras WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Find cameras by medium type
   */
  findByMedium(medium: Camera['medium']): Camera[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM cameras WHERE medium = ? ORDER BY name').all(medium) as Camera[];
  }

  /**
   * Find default camera for a medium
   */
  findDefaultByMedium(medium: Camera['medium']): Camera | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM cameras WHERE medium = ? AND is_default = 1 LIMIT 1')
      .get(medium) as Camera | undefined;
    return row ?? null;
  }

  /**
   * Set a camera as default for its medium
   * Clears other defaults for the same medium
   */
  setDefault(id: number): Camera | null {
    const camera = this.findById(id);
    if (!camera) return null;

    const db = getDatabase();

    // Clear other defaults for this medium
    db.prepare('UPDATE cameras SET is_default = 0 WHERE medium = ? AND id != ?').run(camera.medium, id);

    // Set this camera as default
    db.prepare('UPDATE cameras SET is_default = 1 WHERE id = ?').run(id);

    return this.findById(id);
  }

  /**
   * Find cameras by make/model
   */
  findByMakeModel(make?: string | null, model?: string | null): Camera[] {
    const db = getDatabase();

    if (make && model) {
      return db
        .prepare('SELECT * FROM cameras WHERE make = ? AND model = ? ORDER BY name')
        .all(make, model) as Camera[];
    } else if (make) {
      return db
        .prepare('SELECT * FROM cameras WHERE make = ? ORDER BY name')
        .all(make) as Camera[];
    } else if (model) {
      return db
        .prepare('SELECT * FROM cameras WHERE model = ? ORDER BY name')
        .all(model) as Camera[];
    }

    return [];
  }
}

export const camerasRepository = new CamerasRepository();
