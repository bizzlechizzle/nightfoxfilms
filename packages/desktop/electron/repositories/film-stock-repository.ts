/**
 * Film Stock Repository
 *
 * CRUD operations for film stock inventory.
 * Tracks Super 8 cartridges, tapes, and other consumable media.
 */

import { getDatabase } from '../main/database';
import type { FilmStock, FilmStockInput, FilmFormat, StockType } from '@nightfox/core';

export class FilmStockRepository {
  /**
   * Find all film stock
   */
  findAll(): FilmStock[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM film_stock WHERE is_active = 1 ORDER BY name').all() as FilmStock[];
  }

  /**
   * Find all film stock including inactive
   */
  findAllIncludingInactive(): FilmStock[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM film_stock ORDER BY is_active DESC, name').all() as FilmStock[];
  }

  /**
   * Find film stock by ID
   */
  findById(id: number): FilmStock | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM film_stock WHERE id = ?').get(id) as FilmStock | undefined;
    return row ?? null;
  }

  /**
   * Find film stock by type (film or tape)
   */
  findByType(type: StockType): FilmStock[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM film_stock WHERE stock_type = ? AND is_active = 1 ORDER BY name')
      .all(type) as FilmStock[];
  }

  /**
   * Find film stock by format
   */
  findByFormat(format: FilmFormat): FilmStock[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM film_stock WHERE format = ? AND is_active = 1 ORDER BY name')
      .all(format) as FilmStock[];
  }

  /**
   * Find film stock with quantity available
   */
  findInStock(): FilmStock[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM film_stock WHERE quantity_on_hand > 0 AND is_active = 1 ORDER BY name')
      .all() as FilmStock[];
  }

  /**
   * Find film stock that's low (quantity <= threshold)
   */
  findLowStock(threshold: number = 2): FilmStock[] {
    const db = getDatabase();
    return db
      .prepare(
        'SELECT * FROM film_stock WHERE quantity_on_hand <= ? AND quantity_on_hand > 0 AND is_active = 1 ORDER BY quantity_on_hand'
      )
      .all(threshold) as FilmStock[];
  }

  /**
   * Find out of stock items
   */
  findOutOfStock(): FilmStock[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM film_stock WHERE quantity_on_hand <= 0 AND is_active = 1 ORDER BY name')
      .all() as FilmStock[];
  }

  /**
   * Create new film stock
   */
  create(input: FilmStockInput): FilmStock {
    const db = getDatabase();
    const result = db
      .prepare(
        `INSERT INTO film_stock (
          name, stock_type, format, manufacturer, asa_iso, is_daylight,
          quantity_on_hand, cost_per_unit, processing_cost, scan_cost,
          footage_yield_sec, expiration_date, storage_location, notes, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name,
        input.stock_type,
        input.format,
        input.manufacturer ?? null,
        input.asa_iso ?? null,
        input.is_daylight === true ? 1 : input.is_daylight === false ? 0 : null,
        input.quantity_on_hand ?? 0,
        input.cost_per_unit ?? null,
        input.processing_cost ?? null,
        input.scan_cost ?? null,
        input.footage_yield_sec ?? null,
        input.expiration_date ?? null,
        input.storage_location ?? null,
        input.notes ?? null,
        input.is_active === false ? 0 : 1
      );

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Update film stock
   */
  update(id: number, input: Partial<FilmStockInput>): FilmStock | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      values.push(input.name);
    }
    if (input.stock_type !== undefined) {
      updates.push('stock_type = ?');
      values.push(input.stock_type);
    }
    if (input.format !== undefined) {
      updates.push('format = ?');
      values.push(input.format);
    }
    if (input.manufacturer !== undefined) {
      updates.push('manufacturer = ?');
      values.push(input.manufacturer);
    }
    if (input.asa_iso !== undefined) {
      updates.push('asa_iso = ?');
      values.push(input.asa_iso);
    }
    if (input.is_daylight !== undefined) {
      updates.push('is_daylight = ?');
      values.push(input.is_daylight === true ? 1 : input.is_daylight === false ? 0 : null);
    }
    if (input.quantity_on_hand !== undefined) {
      updates.push('quantity_on_hand = ?');
      values.push(input.quantity_on_hand);
    }
    if (input.cost_per_unit !== undefined) {
      updates.push('cost_per_unit = ?');
      values.push(input.cost_per_unit);
    }
    if (input.processing_cost !== undefined) {
      updates.push('processing_cost = ?');
      values.push(input.processing_cost);
    }
    if (input.scan_cost !== undefined) {
      updates.push('scan_cost = ?');
      values.push(input.scan_cost);
    }
    if (input.footage_yield_sec !== undefined) {
      updates.push('footage_yield_sec = ?');
      values.push(input.footage_yield_sec);
    }
    if (input.expiration_date !== undefined) {
      updates.push('expiration_date = ?');
      values.push(input.expiration_date);
    }
    if (input.storage_location !== undefined) {
      updates.push('storage_location = ?');
      values.push(input.storage_location);
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
    db.prepare(`UPDATE film_stock SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.findById(id);
  }

  /**
   * Adjust quantity (add or subtract)
   */
  adjustQuantity(id: number, adjustment: number): FilmStock | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    db.prepare('UPDATE film_stock SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?').run(adjustment, id);

    return this.findById(id);
  }

  /**
   * Delete film stock (soft delete)
   */
  delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('UPDATE film_stock SET is_active = 0 WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get total inventory value
   */
  getTotalInventoryValue(): number {
    const db = getDatabase();
    const result = db
      .prepare(
        `SELECT SUM(quantity_on_hand * cost_per_unit) as total
         FROM film_stock
         WHERE is_active = 1 AND cost_per_unit IS NOT NULL`
      )
      .get() as { total: number | null };
    return result.total ?? 0;
  }

  /**
   * Get inventory summary by format
   */
  getInventoryByFormat(): Array<{ format: FilmFormat; count: number; total_units: number }> {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT format, COUNT(*) as count, SUM(quantity_on_hand) as total_units
         FROM film_stock WHERE is_active = 1
         GROUP BY format
         ORDER BY total_units DESC`
      )
      .all() as Array<{ format: FilmFormat; count: number; total_units: number }>;
  }
}

// Singleton instance
export const filmStockRepository = new FilmStockRepository();
