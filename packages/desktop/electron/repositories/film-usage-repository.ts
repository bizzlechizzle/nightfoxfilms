/**
 * Film Usage Repository
 *
 * CRUD operations for film usage tracking.
 * Tracks film cartridge usage per project and lab processing lifecycle.
 */

import { getDatabase } from '../main/database';
import type { FilmUsage, FilmUsageInput } from '@nightfox/core';

export interface FilmUsageWithDetails extends FilmUsage {
  film_stock_name: string;
  film_stock_format: string;
  couple_name: string | null;
  lab_name: string | null;
  equipment_name: string | null;
}

export class FilmUsageRepository {
  /**
   * Find all film usage records
   */
  findAll(): FilmUsage[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM film_usage ORDER BY created_at DESC').all() as FilmUsage[];
  }

  /**
   * Find all film usage with details
   */
  findAllWithDetails(): FilmUsageWithDetails[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT fu.*,
                fs.name as film_stock_name,
                fs.format as film_stock_format,
                c.name as couple_name,
                pl.name as lab_name,
                e.name as equipment_name
         FROM film_usage fu
         JOIN film_stock fs ON fu.film_stock_id = fs.id
         LEFT JOIN couples c ON fu.couple_id = c.id
         LEFT JOIN processing_labs pl ON fu.lab_id = pl.id
         LEFT JOIN equipment e ON fu.equipment_id = e.id
         ORDER BY fu.created_at DESC`
      )
      .all() as FilmUsageWithDetails[];
  }

  /**
   * Find film usage by ID
   */
  findById(id: number): FilmUsage | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM film_usage WHERE id = ?').get(id) as FilmUsage | undefined;
    return row ?? null;
  }

  /**
   * Find film usage by ID with details
   */
  findByIdWithDetails(id: number): FilmUsageWithDetails | null {
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT fu.*,
                fs.name as film_stock_name,
                fs.format as film_stock_format,
                c.name as couple_name,
                pl.name as lab_name,
                e.name as equipment_name
         FROM film_usage fu
         JOIN film_stock fs ON fu.film_stock_id = fs.id
         LEFT JOIN couples c ON fu.couple_id = c.id
         LEFT JOIN processing_labs pl ON fu.lab_id = pl.id
         LEFT JOIN equipment e ON fu.equipment_id = e.id
         WHERE fu.id = ?`
      )
      .get(id) as FilmUsageWithDetails | undefined;
    return row ?? null;
  }

  /**
   * Find film usage by couple ID
   */
  findByCouple(coupleId: number): FilmUsageWithDetails[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT fu.*,
                fs.name as film_stock_name,
                fs.format as film_stock_format,
                c.name as couple_name,
                pl.name as lab_name,
                e.name as equipment_name
         FROM film_usage fu
         JOIN film_stock fs ON fu.film_stock_id = fs.id
         LEFT JOIN couples c ON fu.couple_id = c.id
         LEFT JOIN processing_labs pl ON fu.lab_id = pl.id
         LEFT JOIN equipment e ON fu.equipment_id = e.id
         WHERE fu.couple_id = ?
         ORDER BY fu.created_at DESC`
      )
      .all(coupleId) as FilmUsageWithDetails[];
  }

  /**
   * Find film usage by camera loan ID
   */
  findByLoan(loanId: number): FilmUsageWithDetails[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT fu.*,
                fs.name as film_stock_name,
                fs.format as film_stock_format,
                c.name as couple_name,
                pl.name as lab_name,
                e.name as equipment_name
         FROM film_usage fu
         JOIN film_stock fs ON fu.film_stock_id = fs.id
         LEFT JOIN couples c ON fu.couple_id = c.id
         LEFT JOIN processing_labs pl ON fu.lab_id = pl.id
         LEFT JOIN equipment e ON fu.equipment_id = e.id
         WHERE fu.camera_loan_id = ?
         ORDER BY fu.created_at DESC`
      )
      .all(loanId) as FilmUsageWithDetails[];
  }

  /**
   * Find film usage by lab ID
   */
  findByLab(labId: number): FilmUsageWithDetails[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT fu.*,
                fs.name as film_stock_name,
                fs.format as film_stock_format,
                c.name as couple_name,
                pl.name as lab_name,
                e.name as equipment_name
         FROM film_usage fu
         JOIN film_stock fs ON fu.film_stock_id = fs.id
         LEFT JOIN couples c ON fu.couple_id = c.id
         LEFT JOIN processing_labs pl ON fu.lab_id = pl.id
         LEFT JOIN equipment e ON fu.equipment_id = e.id
         WHERE fu.lab_id = ?
         ORDER BY fu.created_at DESC`
      )
      .all(labId) as FilmUsageWithDetails[];
  }

  /**
   * Find film usage pending at lab (sent but not received back)
   */
  findPendingAtLab(): FilmUsageWithDetails[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT fu.*,
                fs.name as film_stock_name,
                fs.format as film_stock_format,
                c.name as couple_name,
                pl.name as lab_name,
                e.name as equipment_name
         FROM film_usage fu
         JOIN film_stock fs ON fu.film_stock_id = fs.id
         LEFT JOIN couples c ON fu.couple_id = c.id
         LEFT JOIN processing_labs pl ON fu.lab_id = pl.id
         LEFT JOIN equipment e ON fu.equipment_id = e.id
         WHERE fu.lab_sent_at IS NOT NULL
         AND fu.scans_received_at IS NULL
         ORDER BY fu.lab_sent_at ASC`
      )
      .all() as FilmUsageWithDetails[];
  }

  /**
   * Find film usage awaiting physical return (scans received but not physical)
   */
  findAwaitingPhysicalReturn(): FilmUsageWithDetails[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT fu.*,
                fs.name as film_stock_name,
                fs.format as film_stock_format,
                c.name as couple_name,
                pl.name as lab_name,
                e.name as equipment_name
         FROM film_usage fu
         JOIN film_stock fs ON fu.film_stock_id = fs.id
         LEFT JOIN couples c ON fu.couple_id = c.id
         LEFT JOIN processing_labs pl ON fu.lab_id = pl.id
         LEFT JOIN equipment e ON fu.equipment_id = e.id
         WHERE fu.scans_received_at IS NOT NULL
         AND fu.physical_received_at IS NULL
         ORDER BY fu.scans_received_at ASC`
      )
      .all() as FilmUsageWithDetails[];
  }

  /**
   * Create new film usage record
   */
  create(input: FilmUsageInput): FilmUsage {
    const db = getDatabase();
    const result = db
      .prepare(
        `INSERT INTO film_usage (
          film_stock_id, couple_id, camera_loan_id, equipment_id,
          cartridges_used, shot_date, scene_notes,
          lab_id, lab_tracking_out, scans_download_url, lab_tracking_return,
          scan_resolution, scan_format, scan_asset_ids, total_cost, issues, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.film_stock_id,
        input.couple_id ?? null,
        input.camera_loan_id ?? null,
        input.equipment_id ?? null,
        input.cartridges_used,
        input.shot_date ?? null,
        input.scene_notes ?? null,
        input.lab_id ?? null,
        input.lab_tracking_out ?? null,
        input.scans_download_url ?? null,
        input.lab_tracking_return ?? null,
        input.scan_resolution ?? null,
        input.scan_format ?? null,
        input.scan_asset_ids ? JSON.stringify(input.scan_asset_ids) : null,
        input.total_cost ?? null,
        input.issues ?? null,
        input.notes ?? null
      );

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Update film usage record
   */
  update(id: number, input: Partial<FilmUsageInput>): FilmUsage | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.film_stock_id !== undefined) {
      updates.push('film_stock_id = ?');
      values.push(input.film_stock_id);
    }
    if (input.couple_id !== undefined) {
      updates.push('couple_id = ?');
      values.push(input.couple_id);
    }
    if (input.camera_loan_id !== undefined) {
      updates.push('camera_loan_id = ?');
      values.push(input.camera_loan_id);
    }
    if (input.equipment_id !== undefined) {
      updates.push('equipment_id = ?');
      values.push(input.equipment_id);
    }
    if (input.cartridges_used !== undefined) {
      updates.push('cartridges_used = ?');
      values.push(input.cartridges_used);
    }
    if (input.shot_date !== undefined) {
      updates.push('shot_date = ?');
      values.push(input.shot_date);
    }
    if (input.scene_notes !== undefined) {
      updates.push('scene_notes = ?');
      values.push(input.scene_notes);
    }
    if (input.lab_id !== undefined) {
      updates.push('lab_id = ?');
      values.push(input.lab_id);
    }
    if (input.lab_tracking_out !== undefined) {
      updates.push('lab_tracking_out = ?');
      values.push(input.lab_tracking_out);
    }
    if (input.scans_download_url !== undefined) {
      updates.push('scans_download_url = ?');
      values.push(input.scans_download_url);
    }
    if (input.lab_tracking_return !== undefined) {
      updates.push('lab_tracking_return = ?');
      values.push(input.lab_tracking_return);
    }
    if (input.scan_resolution !== undefined) {
      updates.push('scan_resolution = ?');
      values.push(input.scan_resolution);
    }
    if (input.scan_format !== undefined) {
      updates.push('scan_format = ?');
      values.push(input.scan_format);
    }
    if (input.scan_asset_ids !== undefined) {
      updates.push('scan_asset_ids = ?');
      values.push(input.scan_asset_ids ? JSON.stringify(input.scan_asset_ids) : null);
    }
    if (input.total_cost !== undefined) {
      updates.push('total_cost = ?');
      values.push(input.total_cost);
    }
    if (input.issues !== undefined) {
      updates.push('issues = ?');
      values.push(input.issues);
    }
    if (input.notes !== undefined) {
      updates.push('notes = ?');
      values.push(input.notes);
    }

    if (updates.length === 0) return existing;

    values.push(id);
    db.prepare(`UPDATE film_usage SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.findById(id);
  }

  /**
   * Mark film as sent to lab
   */
  markSentToLab(id: number, labId: number, trackingNumber?: string): FilmUsage | null {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE film_usage SET lab_id = ?, lab_sent_at = ?, lab_tracking_out = ? WHERE id = ?`
    ).run(labId, now, trackingNumber ?? null, id);
    return this.findById(id);
  }

  /**
   * Mark scans as received
   */
  markScansReceived(id: number, downloadUrl?: string, resolution?: string, format?: string): FilmUsage | null {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE film_usage SET scans_received_at = ?, scans_download_url = ?, scan_resolution = ?, scan_format = ? WHERE id = ?`
    ).run(now, downloadUrl ?? null, resolution ?? null, format ?? null, id);
    return this.findById(id);
  }

  /**
   * Mark physical film as received back
   */
  markPhysicalReceived(id: number, trackingNumber?: string): FilmUsage | null {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE film_usage SET physical_received_at = ?, lab_tracking_return = ? WHERE id = ?`
    ).run(now, trackingNumber ?? null, id);
    return this.findById(id);
  }

  /**
   * Delete film usage record
   */
  delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM film_usage WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get total cartridges used by couple
   */
  getTotalCartridgesByCouple(coupleId: number): number {
    const db = getDatabase();
    const result = db
      .prepare('SELECT SUM(cartridges_used) as total FROM film_usage WHERE couple_id = ?')
      .get(coupleId) as { total: number | null };
    return result.total ?? 0;
  }

  /**
   * Get total cost by couple
   */
  getTotalCostByCouple(coupleId: number): number {
    const db = getDatabase();
    const result = db
      .prepare('SELECT SUM(total_cost) as total FROM film_usage WHERE couple_id = ?')
      .get(coupleId) as { total: number | null };
    return result.total ?? 0;
  }

  /**
   * Get usage stats by film stock
   */
  getUsageByFilmStock(): Array<{ film_stock_id: number; film_stock_name: string; total_cartridges: number; total_cost: number }> {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT fu.film_stock_id, fs.name as film_stock_name,
                SUM(fu.cartridges_used) as total_cartridges,
                SUM(fu.total_cost) as total_cost
         FROM film_usage fu
         JOIN film_stock fs ON fu.film_stock_id = fs.id
         GROUP BY fu.film_stock_id
         ORDER BY total_cartridges DESC`
      )
      .all() as Array<{ film_stock_id: number; film_stock_name: string; total_cartridges: number; total_cost: number }>;
  }
}

// Singleton instance
export const filmUsageRepository = new FilmUsageRepository();
