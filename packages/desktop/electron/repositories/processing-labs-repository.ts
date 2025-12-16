/**
 * Processing Labs Repository
 *
 * CRUD operations for film processing labs.
 * Tracks labs where you send Super 8 film for processing and scanning.
 */

import { getDatabase } from '../main/database';
import type { ProcessingLab, ProcessingLabInput } from '@nightfox/core';

export class ProcessingLabsRepository {
  /**
   * Find all labs
   */
  findAll(): ProcessingLab[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM processing_labs WHERE is_active = 1 ORDER BY name').all() as ProcessingLab[];
  }

  /**
   * Find all labs including inactive
   */
  findAllIncludingInactive(): ProcessingLab[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM processing_labs ORDER BY is_active DESC, name').all() as ProcessingLab[];
  }

  /**
   * Find lab by ID
   */
  findById(id: number): ProcessingLab | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM processing_labs WHERE id = ?').get(id) as ProcessingLab | undefined;
    return row ?? null;
  }

  /**
   * Find labs by rating (minimum)
   */
  findByMinRating(minRating: number): ProcessingLab[] {
    const db = getDatabase();
    return db
      .prepare(
        'SELECT * FROM processing_labs WHERE your_rating >= ? AND is_active = 1 ORDER BY your_rating DESC, name'
      )
      .all(minRating) as ProcessingLab[];
  }

  /**
   * Find labs by service type
   */
  findByService(service: string): ProcessingLab[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM processing_labs WHERE services LIKE ? AND is_active = 1 ORDER BY name')
      .all(`%${service}%`) as ProcessingLab[];
  }

  /**
   * Search labs by name or address
   */
  search(query: string): ProcessingLab[] {
    const db = getDatabase();
    const pattern = `%${query}%`;
    return db
      .prepare(
        `SELECT * FROM processing_labs
         WHERE (name LIKE ? OR address LIKE ?)
         AND is_active = 1
         ORDER BY name`
      )
      .all(pattern, pattern) as ProcessingLab[];
  }

  /**
   * Create new lab
   */
  create(input: ProcessingLabInput): ProcessingLab {
    const db = getDatabase();
    const result = db
      .prepare(
        `INSERT INTO processing_labs (
          name, website, email, phone, address, turnaround_days,
          services, scan_resolutions, scan_formats, your_rating, notes, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name,
        input.website ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.address ?? null,
        input.turnaround_days ?? null,
        input.services ?? null,
        input.scan_resolutions ? JSON.stringify(input.scan_resolutions) : null,
        input.scan_formats ? JSON.stringify(input.scan_formats) : null,
        input.your_rating ?? null,
        input.notes ?? null,
        input.is_active === false ? 0 : 1
      );

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Update lab
   */
  update(id: number, input: Partial<ProcessingLabInput>): ProcessingLab | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      values.push(input.name);
    }
    if (input.website !== undefined) {
      updates.push('website = ?');
      values.push(input.website);
    }
    if (input.email !== undefined) {
      updates.push('email = ?');
      values.push(input.email);
    }
    if (input.phone !== undefined) {
      updates.push('phone = ?');
      values.push(input.phone);
    }
    if (input.address !== undefined) {
      updates.push('address = ?');
      values.push(input.address);
    }
    if (input.turnaround_days !== undefined) {
      updates.push('turnaround_days = ?');
      values.push(input.turnaround_days);
    }
    if (input.services !== undefined) {
      updates.push('services = ?');
      values.push(input.services);
    }
    if (input.scan_resolutions !== undefined) {
      updates.push('scan_resolutions = ?');
      values.push(input.scan_resolutions ? JSON.stringify(input.scan_resolutions) : null);
    }
    if (input.scan_formats !== undefined) {
      updates.push('scan_formats = ?');
      values.push(input.scan_formats ? JSON.stringify(input.scan_formats) : null);
    }
    if (input.your_rating !== undefined) {
      updates.push('your_rating = ?');
      values.push(input.your_rating);
    }
    if (input.notes !== undefined) {
      updates.push('notes = ?');
      values.push(input.notes);
    }
    if (input.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(input.is_active ? 1 : 0);
    }

    if (updates.length === 0) return existing;

    values.push(id);
    db.prepare(`UPDATE processing_labs SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.findById(id);
  }

  /**
   * Delete lab (soft delete)
   */
  delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('UPDATE processing_labs SET is_active = 0 WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get lab usage stats (how many film usages per lab)
   */
  getLabUsageStats(): Array<{ lab_id: number; lab_name: string; usage_count: number }> {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT pl.id as lab_id, pl.name as lab_name, COUNT(fu.id) as usage_count
         FROM processing_labs pl
         LEFT JOIN film_usage fu ON fu.lab_id = pl.id
         WHERE pl.is_active = 1
         GROUP BY pl.id
         ORDER BY usage_count DESC`
      )
      .all() as Array<{ lab_id: number; lab_name: string; usage_count: number }>;
  }
}

// Singleton instance
export const processingLabsRepository = new ProcessingLabsRepository();
