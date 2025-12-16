/**
 * Camera Loans Repository
 *
 * CRUD operations for camera loan workflow.
 * Manages the complete loan lifecycle from request to return.
 */

import { getDatabase } from '../main/database';
import type { CameraLoan, CameraLoanInput, LoanStatus, LoanEventType } from '@nightfox/core';

// Valid status transitions
const VALID_TRANSITIONS: Record<LoanStatus, LoanStatus[]> = {
  requested: ['approved', 'cancelled'],
  approved: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'lost'],
  delivered: ['active', 'lost'],
  active: ['return_shipped', 'lost', 'damaged'],
  return_shipped: ['received', 'lost'],
  received: ['inspected'],
  inspected: ['completed', 'damaged'],
  completed: [],
  cancelled: [],
  lost: [],
  damaged: ['completed'],
};

export interface CameraLoanWithDetails extends CameraLoan {
  equipment_name: string;
  equipment_medium: string | null;
  couple_name: string;
  couple_wedding_date: string | null;
}

export class CameraLoansRepository {
  /**
   * Find all loans
   */
  findAll(): CameraLoan[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM camera_loans ORDER BY created_at DESC').all() as CameraLoan[];
  }

  /**
   * Find all loans with equipment and couple details
   */
  findAllWithDetails(): CameraLoanWithDetails[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT cl.*,
                e.name as equipment_name,
                e.medium as equipment_medium,
                c.name as couple_name,
                c.wedding_date as couple_wedding_date
         FROM camera_loans cl
         JOIN equipment e ON cl.equipment_id = e.id
         JOIN couples c ON cl.couple_id = c.id
         ORDER BY cl.created_at DESC`
      )
      .all() as CameraLoanWithDetails[];
  }

  /**
   * Find loan by ID
   */
  findById(id: number): CameraLoan | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM camera_loans WHERE id = ?').get(id) as CameraLoan | undefined;
    return row ?? null;
  }

  /**
   * Find loan by ID with details
   */
  findByIdWithDetails(id: number): CameraLoanWithDetails | null {
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT cl.*,
                e.name as equipment_name,
                e.medium as equipment_medium,
                c.name as couple_name,
                c.wedding_date as couple_wedding_date
         FROM camera_loans cl
         JOIN equipment e ON cl.equipment_id = e.id
         JOIN couples c ON cl.couple_id = c.id
         WHERE cl.id = ?`
      )
      .get(id) as CameraLoanWithDetails | undefined;
    return row ?? null;
  }

  /**
   * Find loans by couple ID
   */
  findByCouple(coupleId: number): CameraLoanWithDetails[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT cl.*,
                e.name as equipment_name,
                e.medium as equipment_medium,
                c.name as couple_name,
                c.wedding_date as couple_wedding_date
         FROM camera_loans cl
         JOIN equipment e ON cl.equipment_id = e.id
         JOIN couples c ON cl.couple_id = c.id
         WHERE cl.couple_id = ?
         ORDER BY cl.created_at DESC`
      )
      .all(coupleId) as CameraLoanWithDetails[];
  }

  /**
   * Find loans by equipment ID
   */
  findByEquipment(equipmentId: number): CameraLoan[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM camera_loans WHERE equipment_id = ? ORDER BY created_at DESC')
      .all(equipmentId) as CameraLoan[];
  }

  /**
   * Find loans by status
   */
  findByStatus(status: LoanStatus): CameraLoanWithDetails[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT cl.*,
                e.name as equipment_name,
                e.medium as equipment_medium,
                c.name as couple_name,
                c.wedding_date as couple_wedding_date
         FROM camera_loans cl
         JOIN equipment e ON cl.equipment_id = e.id
         JOIN couples c ON cl.couple_id = c.id
         WHERE cl.status = ?
         ORDER BY cl.created_at DESC`
      )
      .all(status) as CameraLoanWithDetails[];
  }

  /**
   * Find active loans (not completed, cancelled, lost, or damaged)
   */
  findActive(): CameraLoanWithDetails[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT cl.*,
                e.name as equipment_name,
                e.medium as equipment_medium,
                c.name as couple_name,
                c.wedding_date as couple_wedding_date
         FROM camera_loans cl
         JOIN equipment e ON cl.equipment_id = e.id
         JOIN couples c ON cl.couple_id = c.id
         WHERE cl.status NOT IN ('completed', 'cancelled', 'lost', 'damaged')
         ORDER BY cl.event_date ASC`
      )
      .all() as CameraLoanWithDetails[];
  }

  /**
   * Find loans that need attention (action required)
   */
  findNeedingAttention(): CameraLoanWithDetails[] {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT cl.*,
                e.name as equipment_name,
                e.medium as equipment_medium,
                c.name as couple_name,
                c.wedding_date as couple_wedding_date
         FROM camera_loans cl
         JOIN equipment e ON cl.equipment_id = e.id
         JOIN couples c ON cl.couple_id = c.id
         WHERE cl.status IN ('requested', 'approved', 'received')
         ORDER BY cl.ship_by_date ASC`
      )
      .all() as CameraLoanWithDetails[];
  }

  /**
   * Find overdue returns
   */
  findOverdue(): CameraLoanWithDetails[] {
    const db = getDatabase();
    const today = new Date().toISOString().split('T')[0];
    return db
      .prepare(
        `SELECT cl.*,
                e.name as equipment_name,
                e.medium as equipment_medium,
                c.name as couple_name,
                c.wedding_date as couple_wedding_date
         FROM camera_loans cl
         JOIN equipment e ON cl.equipment_id = e.id
         JOIN couples c ON cl.couple_id = c.id
         WHERE cl.status IN ('delivered', 'active')
         AND cl.due_back_date < ?
         ORDER BY cl.due_back_date ASC`
      )
      .all(today) as CameraLoanWithDetails[];
  }

  /**
   * Check if equipment is available for loan during date range
   */
  checkAvailability(
    equipmentId: number,
    startDate: string,
    endDate: string,
    excludeLoanId?: number
  ): { available: boolean; conflicts: CameraLoan[] } {
    const db = getDatabase();

    let query = `
      SELECT * FROM camera_loans
      WHERE equipment_id = ?
      AND status NOT IN ('completed', 'cancelled', 'lost', 'damaged')
      AND (
        (ship_by_date <= ? AND due_back_date >= ?) OR
        (ship_by_date <= ? AND due_back_date >= ?) OR
        (ship_by_date >= ? AND due_back_date <= ?)
      )
    `;

    const params: unknown[] = [equipmentId, endDate, startDate, startDate, startDate, startDate, endDate];

    if (excludeLoanId) {
      query += ' AND id != ?';
      params.push(excludeLoanId);
    }

    const conflicts = db.prepare(query).all(...params) as CameraLoan[];

    return {
      available: conflicts.length === 0,
      conflicts,
    };
  }

  /**
   * Create new loan
   */
  create(input: CameraLoanInput): CameraLoan {
    const db = getDatabase();
    const now = new Date().toISOString();

    const result = db
      .prepare(
        `INSERT INTO camera_loans (
          equipment_id, couple_id, event_type, status, requested_at,
          ship_by_date, event_date, due_back_date,
          ship_carrier, ship_tracking, return_carrier, return_tracking,
          condition_rating, condition_notes, media_included,
          footage_received, footage_usable, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.equipment_id,
        input.couple_id,
        input.event_type,
        input.status ?? 'requested',
        now,
        input.ship_by_date ?? null,
        input.event_date ?? null,
        input.due_back_date ?? null,
        input.ship_carrier ?? null,
        input.ship_tracking ?? null,
        input.return_carrier ?? null,
        input.return_tracking ?? null,
        input.condition_rating ?? null,
        input.condition_notes ?? null,
        input.media_included ? JSON.stringify(input.media_included) : null,
        input.footage_received ? 1 : 0,
        input.footage_usable ? 1 : 0,
        input.notes ?? null
      );

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Update loan
   */
  update(id: number, input: Partial<CameraLoanInput>): CameraLoan | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.equipment_id !== undefined) {
      updates.push('equipment_id = ?');
      values.push(input.equipment_id);
    }
    if (input.couple_id !== undefined) {
      updates.push('couple_id = ?');
      values.push(input.couple_id);
    }
    if (input.event_type !== undefined) {
      updates.push('event_type = ?');
      values.push(input.event_type);
    }
    if (input.ship_by_date !== undefined) {
      updates.push('ship_by_date = ?');
      values.push(input.ship_by_date);
    }
    if (input.event_date !== undefined) {
      updates.push('event_date = ?');
      values.push(input.event_date);
    }
    if (input.due_back_date !== undefined) {
      updates.push('due_back_date = ?');
      values.push(input.due_back_date);
    }
    if (input.ship_carrier !== undefined) {
      updates.push('ship_carrier = ?');
      values.push(input.ship_carrier);
    }
    if (input.ship_tracking !== undefined) {
      updates.push('ship_tracking = ?');
      values.push(input.ship_tracking);
    }
    if (input.return_carrier !== undefined) {
      updates.push('return_carrier = ?');
      values.push(input.return_carrier);
    }
    if (input.return_tracking !== undefined) {
      updates.push('return_tracking = ?');
      values.push(input.return_tracking);
    }
    if (input.condition_rating !== undefined) {
      updates.push('condition_rating = ?');
      values.push(input.condition_rating);
    }
    if (input.condition_notes !== undefined) {
      updates.push('condition_notes = ?');
      values.push(input.condition_notes);
    }
    if (input.media_included !== undefined) {
      updates.push('media_included = ?');
      values.push(input.media_included ? JSON.stringify(input.media_included) : null);
    }
    if (input.footage_received !== undefined) {
      updates.push('footage_received = ?');
      values.push(input.footage_received ? 1 : 0);
    }
    if (input.footage_usable !== undefined) {
      updates.push('footage_usable = ?');
      values.push(input.footage_usable ? 1 : 0);
    }
    if (input.notes !== undefined) {
      updates.push('notes = ?');
      values.push(input.notes);
    }

    if (updates.length === 0) return existing;

    values.push(id);
    db.prepare(`UPDATE camera_loans SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.findById(id);
  }

  /**
   * Transition loan to new status with validation
   */
  transitionStatus(
    id: number,
    newStatus: LoanStatus,
    additionalData?: Partial<CameraLoanInput>
  ): { success: boolean; loan?: CameraLoan; error?: string } {
    const existing = this.findById(id);
    if (!existing) {
      return { success: false, error: 'Loan not found' };
    }

    const currentStatus = existing.status as LoanStatus;
    const validNextStatuses = VALID_TRANSITIONS[currentStatus];

    if (!validNextStatuses.includes(newStatus)) {
      return {
        success: false,
        error: `Cannot transition from '${currentStatus}' to '${newStatus}'. Valid transitions: ${validNextStatuses.join(', ') || 'none'}`,
      };
    }

    const db = getDatabase();
    const now = new Date().toISOString();

    // Build update with status and timestamp
    const updates: string[] = ['status = ?'];
    const values: unknown[] = [newStatus];

    // Add timestamp for the transition
    switch (newStatus) {
      case 'approved':
        updates.push('approved_at = ?');
        values.push(now);
        break;
      case 'shipped':
        updates.push('shipped_at = ?');
        values.push(now);
        break;
      case 'delivered':
        updates.push('delivered_at = ?');
        values.push(now);
        break;
      case 'return_shipped':
        updates.push('return_shipped_at = ?');
        values.push(now);
        break;
      case 'received':
        updates.push('return_received_at = ?');
        values.push(now);
        break;
      case 'inspected':
        updates.push('inspected_at = ?');
        values.push(now);
        break;
    }

    // Add any additional data
    if (additionalData) {
      if (additionalData.ship_carrier !== undefined) {
        updates.push('ship_carrier = ?');
        values.push(additionalData.ship_carrier);
      }
      if (additionalData.ship_tracking !== undefined) {
        updates.push('ship_tracking = ?');
        values.push(additionalData.ship_tracking);
      }
      if (additionalData.return_carrier !== undefined) {
        updates.push('return_carrier = ?');
        values.push(additionalData.return_carrier);
      }
      if (additionalData.return_tracking !== undefined) {
        updates.push('return_tracking = ?');
        values.push(additionalData.return_tracking);
      }
      if (additionalData.condition_rating !== undefined) {
        updates.push('condition_rating = ?');
        values.push(additionalData.condition_rating);
      }
      if (additionalData.condition_notes !== undefined) {
        updates.push('condition_notes = ?');
        values.push(additionalData.condition_notes);
      }
      if (additionalData.notes !== undefined) {
        updates.push('notes = ?');
        values.push(additionalData.notes);
      }
    }

    values.push(id);
    db.prepare(`UPDATE camera_loans SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return { success: true, loan: this.findById(id)! };
  }

  /**
   * Delete loan
   */
  delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM camera_loans WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get loan counts by status
   */
  getCountsByStatus(): Array<{ status: LoanStatus; count: number }> {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT status, COUNT(*) as count
         FROM camera_loans
         GROUP BY status
         ORDER BY count DESC`
      )
      .all() as Array<{ status: LoanStatus; count: number }>;
  }

  /**
   * Get loan counts by event type
   */
  getCountsByEventType(): Array<{ event_type: LoanEventType; count: number }> {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT event_type, COUNT(*) as count
         FROM camera_loans
         GROUP BY event_type
         ORDER BY count DESC`
      )
      .all() as Array<{ event_type: LoanEventType; count: number }>;
  }
}

// Singleton instance
export const cameraLoansRepository = new CameraLoansRepository();
