/**
 * Lenses Repository
 *
 * CRUD operations for lens inventory tracking.
 * Tracks all lenses you own for wedding videography.
 */

import { getDatabase } from '../main/database';
import type { Lens, LensInput } from '@nightfox/core';

export class LensesRepository {
  /**
   * Find all lenses
   */
  findAll(): Lens[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM lenses ORDER BY name').all() as Lens[];
  }

  /**
   * Find lens by ID
   */
  findById(id: number): Lens | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM lenses WHERE id = ?').get(id) as Lens | undefined;
    return row ?? null;
  }

  /**
   * Find lenses by make
   */
  findByMake(make: string): Lens[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM lenses WHERE make = ? ORDER BY name')
      .all(make) as Lens[];
  }

  /**
   * Find lenses by mount type
   */
  findByMount(mount: string): Lens[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM lenses WHERE mount = ? ORDER BY name')
      .all(mount) as Lens[];
  }

  /**
   * Search lenses by name, make, or model
   */
  search(query: string): Lens[] {
    const db = getDatabase();
    const pattern = `%${query}%`;
    return db
      .prepare(
        `SELECT * FROM lenses
         WHERE name LIKE ? OR make LIKE ? OR model LIKE ? OR focal_length LIKE ?
         ORDER BY name`
      )
      .all(pattern, pattern, pattern, pattern) as Lens[];
  }

  /**
   * Get unique lens makes
   */
  getUniqueMakes(): string[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT DISTINCT make FROM lenses WHERE make IS NOT NULL ORDER BY make')
      .all() as { make: string }[];
    return rows.map((r) => r.make);
  }

  /**
   * Get unique mount types
   */
  getUniqueMounts(): string[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT DISTINCT mount FROM lenses WHERE mount IS NOT NULL ORDER BY mount')
      .all() as { mount: string }[];
    return rows.map((r) => r.mount);
  }

  /**
   * Create a new lens
   */
  create(input: LensInput): Lens {
    const db = getDatabase();
    const result = db
      .prepare(
        `INSERT INTO lenses (name, make, model, focal_length, aperture, mount, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name,
        input.make ?? null,
        input.model ?? null,
        input.focal_length ?? null,
        input.aperture ?? null,
        input.mount ?? null,
        input.notes ?? null
      );

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Update a lens
   */
  update(id: number, input: Partial<LensInput>): Lens | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      values.push(input.name);
    }
    if (input.make !== undefined) {
      updates.push('make = ?');
      values.push(input.make);
    }
    if (input.model !== undefined) {
      updates.push('model = ?');
      values.push(input.model);
    }
    if (input.focal_length !== undefined) {
      updates.push('focal_length = ?');
      values.push(input.focal_length);
    }
    if (input.aperture !== undefined) {
      updates.push('aperture = ?');
      values.push(input.aperture);
    }
    if (input.mount !== undefined) {
      updates.push('mount = ?');
      values.push(input.mount);
    }
    if (input.notes !== undefined) {
      updates.push('notes = ?');
      values.push(input.notes);
    }

    if (updates.length === 0) return existing;

    values.push(id);
    db.prepare(`UPDATE lenses SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.findById(id);
  }

  /**
   * Delete a lens
   */
  delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM lenses WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get lens usage stats (how many files use each detected lens)
   */
  getLensUsageStats(): Array<{ lens: string; count: number }> {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT detected_lens as lens, COUNT(*) as count
         FROM files
         WHERE detected_lens IS NOT NULL
         GROUP BY detected_lens
         ORDER BY count DESC`
      )
      .all() as Array<{ lens: string; count: number }>;
  }
}

// Singleton instance
export const lensesRepository = new LensesRepository();
