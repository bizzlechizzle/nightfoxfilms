/**
 * Equipment Repository
 *
 * CRUD operations for physical equipment inventory.
 * Tracks cameras, lenses, audio gear, and other equipment you own.
 */

import { getDatabase } from '../main/database';
import type { Equipment, EquipmentInput, EquipmentStatus, EquipmentType, Medium } from '@nightfox/core';

export class EquipmentRepository {
  /**
   * Find all equipment
   */
  findAll(): Equipment[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM equipment WHERE is_active = 1 ORDER BY name').all() as Equipment[];
  }

  /**
   * Find all equipment including inactive
   */
  findAllIncludingInactive(): Equipment[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM equipment ORDER BY is_active DESC, name').all() as Equipment[];
  }

  /**
   * Find equipment by ID
   */
  findById(id: number): Equipment | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id) as Equipment | undefined;
    return row ?? null;
  }

  /**
   * Find equipment by type
   */
  findByType(type: EquipmentType): Equipment[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM equipment WHERE equipment_type = ? AND is_active = 1 ORDER BY name')
      .all(type) as Equipment[];
  }

  /**
   * Find equipment by medium
   */
  findByMedium(medium: Medium): Equipment[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM equipment WHERE medium = ? AND is_active = 1 ORDER BY name')
      .all(medium) as Equipment[];
  }

  /**
   * Find equipment by status
   */
  findByStatus(status: EquipmentStatus): Equipment[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM equipment WHERE status = ? AND is_active = 1 ORDER BY name')
      .all(status) as Equipment[];
  }

  /**
   * Find available equipment
   */
  findAvailable(): Equipment[] {
    const db = getDatabase();
    return db
      .prepare("SELECT * FROM equipment WHERE status = 'available' AND is_active = 1 ORDER BY name")
      .all() as Equipment[];
  }

  /**
   * Find loaner-eligible equipment
   */
  findLoanerEligible(): Equipment[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM equipment WHERE loaner_eligible = 1 AND is_active = 1 ORDER BY name')
      .all() as Equipment[];
  }

  /**
   * Find available loaner-eligible equipment (for creating loans)
   */
  findAvailableForLoan(): Equipment[] {
    const db = getDatabase();
    return db
      .prepare(
        "SELECT * FROM equipment WHERE loaner_eligible = 1 AND status = 'available' AND is_active = 1 ORDER BY name"
      )
      .all() as Equipment[];
  }

  /**
   * Search equipment by name, make, or model
   */
  search(query: string): Equipment[] {
    const db = getDatabase();
    const pattern = `%${query}%`;
    return db
      .prepare(
        `SELECT * FROM equipment
         WHERE (name LIKE ? OR make LIKE ? OR model LIKE ? OR serial_number LIKE ?)
         AND is_active = 1
         ORDER BY name`
      )
      .all(pattern, pattern, pattern, pattern) as Equipment[];
  }

  /**
   * Create new equipment
   */
  create(input: EquipmentInput): Equipment {
    const db = getDatabase();
    const result = db
      .prepare(
        `INSERT INTO equipment (
          name, equipment_type, category, medium, camera_id, make, model, serial_number,
          purchase_date, purchase_price, status, loaner_eligible, tutorial_url, image_path, notes, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name,
        input.equipment_type,
        input.category ?? null,
        input.medium ?? null,
        input.camera_id ?? null,
        input.make ?? null,
        input.model ?? null,
        input.serial_number ?? null,
        input.purchase_date ?? null,
        input.purchase_price ?? null,
        input.status ?? 'available',
        input.loaner_eligible ? 1 : 0,
        input.tutorial_url ?? null,
        input.image_path ?? null,
        input.notes ?? null,
        input.is_active === false ? 0 : 1
      );

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Update equipment
   */
  update(id: number, input: Partial<EquipmentInput>): Equipment | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      values.push(input.name);
    }
    if (input.equipment_type !== undefined) {
      updates.push('equipment_type = ?');
      values.push(input.equipment_type);
    }
    if (input.category !== undefined) {
      updates.push('category = ?');
      values.push(input.category);
    }
    if (input.medium !== undefined) {
      updates.push('medium = ?');
      values.push(input.medium);
    }
    if (input.camera_id !== undefined) {
      updates.push('camera_id = ?');
      values.push(input.camera_id);
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
    if (input.purchase_date !== undefined) {
      updates.push('purchase_date = ?');
      values.push(input.purchase_date);
    }
    if (input.purchase_price !== undefined) {
      updates.push('purchase_price = ?');
      values.push(input.purchase_price);
    }
    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
    }
    if (input.loaner_eligible !== undefined) {
      updates.push('loaner_eligible = ?');
      values.push(input.loaner_eligible ? 1 : 0);
    }
    if (input.tutorial_url !== undefined) {
      updates.push('tutorial_url = ?');
      values.push(input.tutorial_url);
    }
    if (input.image_path !== undefined) {
      updates.push('image_path = ?');
      values.push(input.image_path);
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
    db.prepare(`UPDATE equipment SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.findById(id);
  }

  /**
   * Update equipment status
   */
  updateStatus(id: number, status: EquipmentStatus): Equipment | null {
    return this.update(id, { status });
  }

  /**
   * Delete equipment (soft delete - sets is_active to 0)
   */
  delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('UPDATE equipment SET is_active = 0 WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Hard delete equipment (permanent)
   */
  hardDelete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM equipment WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get equipment counts by type
   */
  getCountsByType(): Array<{ type: EquipmentType; count: number }> {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT equipment_type as type, COUNT(*) as count
         FROM equipment WHERE is_active = 1
         GROUP BY equipment_type
         ORDER BY count DESC`
      )
      .all() as Array<{ type: EquipmentType; count: number }>;
  }

  /**
   * Get equipment counts by status
   */
  getCountsByStatus(): Array<{ status: EquipmentStatus; count: number }> {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT status, COUNT(*) as count
         FROM equipment WHERE is_active = 1
         GROUP BY status
         ORDER BY count DESC`
      )
      .all() as Array<{ status: EquipmentStatus; count: number }>;
  }
}

// Singleton instance
export const equipmentRepository = new EquipmentRepository();
